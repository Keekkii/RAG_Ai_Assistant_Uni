"""
RAG Evaluation Script — Ablation Study + Two-Track Evaluation
=============================================================

Retrieval modes (--mode):
  embedding   Pure vector search only (cosine similarity, no reranking)
  keyword     Pure keyword (ILIKE) search only
  hybrid      Vector + keyword + RRF, no reranker
  full        Full pipeline: hybrid + FlashRank reranker  [default]

Track A: Retrieval-only metrics (fast, no LLM)
  - Hit Rate @ 1, 3, 5
  - MRR (Mean Reciprocal Rank)
  - Precision @ 5

Track B: RAGAS end-to-end metrics (slow, uses LLM-as-judge via Ollama)
  - Faithfulness, Answer Relevancy, Context Precision, Context Recall

Usage:
  python -m app.evaluate --mode embedding --retrieval-only --verbose
  python -m app.evaluate --mode keyword   --retrieval-only --verbose
  python -m app.evaluate --mode hybrid    --retrieval-only --verbose
  python -m app.evaluate --mode full      --retrieval-only --verbose
  python -m app.evaluate --mode full      # full evaluation (Track A + B)
"""

import argparse
import json
import os
import re
import time
from datetime import datetime

import psycopg2
from psycopg2.extras import RealDictCursor

from app.embeddings import generate_embedding
from app.database import extract_keywords, DB_CONFIG, search_similar_documents
from app.rag import chain, normalize_question

try:
    from datasets import Dataset
    from ragas import evaluate as ragas_evaluate
    from ragas.metrics import faithfulness, answer_relevancy, context_precision, context_recall
    from ragas.llms import LangchainLLMWrapper
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from langchain_ollama import ChatOllama, OllamaEmbeddings
    RAGAS_AVAILABLE = True
except ImportError:
    RAGAS_AVAILABLE = False

GOLDEN_DATASET_PATH = os.path.join(os.path.dirname(__file__), "golden_dataset.json")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "..", "results")


def get_connection():
    return psycopg2.connect(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        dbname=DB_CONFIG["dbname"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
        cursor_factory=RealDictCursor,
    )


# ---------------------------------------------------------------------------
# Retrieval backends (one per ablation mode)
# ---------------------------------------------------------------------------

def search_embedding_only(query: str, limit: int = 5) -> list[dict]:
    """Pure vector similarity search, no keyword, no reranking."""
    embedding = generate_embedding(query)
    vector_str = "[" + ",".join(map(str, embedding)) + "]"

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, url, title, content,
               (1 - (embedding <=> %s)) AS score
        FROM documents
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> %s
        LIMIT %s;
    """, (vector_str, vector_str, limit))
    results = [dict(r) for r in cursor.fetchall()]
    cursor.close()
    conn.close()
    return results


def search_keyword_only(query: str, limit: int = 5) -> list[dict]:
    """Pure keyword (ILIKE) search, no vector, no reranking."""
    keywords = extract_keywords(query)
    if not keywords:
        return []

    like_clauses = []
    params = []
    for word in keywords:
        like_clauses.append("(title ILIKE %s OR content ILIKE %s)")
        params.extend([f"%{word}%", f"%{word}%"])

    keyword_sql = " + ".join(
        [f"(CASE WHEN {c} THEN 1 ELSE 0 END)" for c in like_clauses]
    )
    where_clause = " OR ".join(like_clauses)

    sql = f"""
        SELECT id, url, title, content,
               ({keyword_sql}) AS score
        FROM documents
        WHERE {where_clause}
        ORDER BY ({keyword_sql}) DESC
        LIMIT %s;
    """
    all_params = params * 2 + [limit]  # SELECT score, WHERE
    # Need params for score expr + WHERE + ORDER BY + LIMIT
    all_params = params + params + params + [limit]

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(sql, all_params)
    results = [dict(r) for r in cursor.fetchall()]
    cursor.close()
    conn.close()
    return results


def search_hybrid_no_rerank(query: str, limit: int = 5) -> list[dict]:
    """Vector + keyword + RRF merge, but NO FlashRank reranking."""
    embedding = generate_embedding(query)
    vector_str = "[" + ",".join(map(str, embedding)) + "]"
    keywords = extract_keywords(query)

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, url, title, content,
               (1 - (embedding <=> %s)) AS score
        FROM documents
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> %s
        LIMIT 40;
    """, (vector_str, vector_str))
    vector_results = [dict(r) for r in cursor.fetchall()]

    keyword_results = []
    if keywords:
        like_clauses = []
        params = []
        for word in keywords:
            like_clauses.append("(title ILIKE %s OR content ILIKE %s)")
            params.extend([f"%{word}%", f"%{word}%"])
        keyword_sql = " + ".join(
            [f"(CASE WHEN {c} THEN 1 ELSE 0 END)" for c in like_clauses]
        )
        where_clause = " OR ".join(like_clauses)
        sql = f"""
            SELECT id, url, title, content,
                   ({keyword_sql}) AS score
            FROM documents
            WHERE {where_clause}
            ORDER BY ({keyword_sql}) DESC
            LIMIT 40;
        """
        cursor.execute(sql, params * 3)
        keyword_results = [dict(r) for r in cursor.fetchall()]

    cursor.close()
    conn.close()

    # RRF
    k = 60
    scores = {}
    doc_map = {}
    for rank, doc in enumerate(vector_results):
        doc_map[doc["id"]] = doc
        scores[doc["id"]] = scores.get(doc["id"], 0) + 1.0 / (rank + 1 + k)
    for rank, doc in enumerate(keyword_results):
        doc_map[doc["id"]] = doc
        scores[doc["id"]] = scores.get(doc["id"], 0) + 1.0 / (rank + 1 + k)

    sorted_ids = sorted(scores, key=lambda x: scores[x], reverse=True)
    candidates = []
    url_counts = {}
    for doc_id in sorted_ids:
        if len(candidates) >= limit:
            break
        doc = doc_map[doc_id]
        url = doc.get("url", "")
        if url_counts.get(url, 0) >= 2:
            continue
        url_counts[url] = url_counts.get(url, 0) + 1
        doc["rrf_score"] = scores[doc_id]
        candidates.append(doc)

    return candidates


def search_full(query: str, limit: int = 5) -> list[dict]:
    """Full pipeline: hybrid RRF + FlashRank reranker."""
    return search_similar_documents(query, limit=limit)


SEARCH_FN = {
    "embedding": search_embedding_only,
    "keyword":   search_keyword_only,
    "hybrid":    search_hybrid_no_rerank,
    "full":      search_full,
}


# ---------------------------------------------------------------------------
# Dataset loading
# ---------------------------------------------------------------------------

def load_golden_dataset(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    for item in data:
        assert "id" in item and "question" in item and "expected_urls" in item, \
            f"Missing required fields in item: {item.get('id', '?')}"
    return data


# ---------------------------------------------------------------------------
# Track A: Retrieval evaluation
# ---------------------------------------------------------------------------

def run_retrieval_evaluation(dataset: list[dict], search_fn, k_values: list[int] = None, verbose: bool = False) -> dict:
    if k_values is None:
        k_values = [1, 3, 5]

    max_k = max(k_values)
    positive_items = [item for item in dataset if item.get("expected_urls")]

    hits = {k: 0 for k in k_values}
    reciprocal_ranks = []
    precisions_at_k = {k: [] for k in k_values}
    per_query = []

    print(f"\n[Track A] Evaluating retrieval on {len(positive_items)} positive questions...")

    for item in positive_items:
        qid = item["id"]
        question = item["question"]
        expected_urls = set(item["expected_urls"])

        normalized = normalize_question(question)
        results = search_fn(normalized, limit=max_k)
        retrieved_urls = [r["url"] for r in results]

        first_hit_rank = None
        for rank, url in enumerate(retrieved_urls, start=1):
            if url in expected_urls:
                first_hit_rank = rank
                break

        for k in k_values:
            if any(u in expected_urls for u in retrieved_urls[:k]):
                hits[k] += 1

        rr = (1.0 / first_hit_rank) if first_hit_rank is not None else 0.0
        reciprocal_ranks.append(rr)

        for k in k_values:
            relevant = sum(1 for u in retrieved_urls[:k] if u in expected_urls)
            precisions_at_k[k].append(relevant / k)

        per_query.append({
            "id": qid,
            "question": question,
            "expected_urls": list(expected_urls),
            "retrieved_urls": retrieved_urls,
            "first_hit_rank": first_hit_rank,
            "reciprocal_rank": rr,
        })

        if verbose:
            status = f"rank {first_hit_rank}" if first_hit_rank else "MISS"
            print(f"  [{qid}] {question[:60]:<60} → {status}")

    n = len(positive_items)
    metrics = {
        "n_questions": n,
        "hit_rate": {f"@{k}": round(hits[k] / n, 4) for k in k_values},
        "mrr": round(sum(reciprocal_ranks) / n, 4),
        "precision": {f"@{k}": round(sum(precisions_at_k[k]) / n, 4) for k in k_values},
    }
    return {"metrics": metrics, "per_query": per_query}


# ---------------------------------------------------------------------------
# Track B: RAGAS end-to-end evaluation
# ---------------------------------------------------------------------------

def run_ragas_evaluation(dataset: list[dict], search_fn, verbose: bool = False) -> dict:
    if not RAGAS_AVAILABLE:
        print("\n[Track B] ERROR: RAGAS not installed.")
        print("Install with: pip install ragas==0.1.21 datasets")
        return {}

    ragas_llm = LangchainLLMWrapper(ChatOllama(model="qwen2.5:7b", temperature=0, num_ctx=8192))
    ragas_embeddings = LangchainEmbeddingsWrapper(OllamaEmbeddings(model="nomic-embed-text"))

    metrics = [faithfulness, answer_relevancy, context_precision, context_recall]
    for metric in metrics:
        metric.llm = ragas_llm
        if hasattr(metric, "embeddings"):
            metric.embeddings = ragas_embeddings

    eval_items = [item for item in dataset if item.get("ground_truth") and item.get("expected_urls")]
    print(f"\n[Track B] Running RAGAS on {len(eval_items)} questions (this may take ~15 minutes)...")

    questions, answers, contexts, ground_truths = [], [], [], []

    for i, item in enumerate(eval_items):
        qid = item["id"]
        question = item["question"]
        normalized = normalize_question(question)

        if verbose:
            print(f"  [{i+1}/{len(eval_items)}] {qid}: {question[:60]}")

        try:
            results = search_fn(normalized, limit=5)
            context_str = "\n\n".join([r["content"] for r in results])
            answer = chain.invoke({"context": context_str, "chat_history": "", "question": normalized})
            questions.append(question)
            answers.append(answer)
            contexts.append([r["content"] for r in results])
            ground_truths.append(item["ground_truth"])
        except Exception as e:
            print(f"  [WARN] Skipping {qid}: {e}")

    if not questions:
        print("[Track B] No questions could be evaluated.")
        return {}

    ragas_dataset = Dataset.from_dict({
        "question": questions, "answer": answers,
        "contexts": contexts, "ground_truth": ground_truths,
    })

    print(f"\n[Track B] Running RAGAS metrics on {len(questions)} samples...")
    try:
        result = ragas_evaluate(ragas_dataset, metrics=metrics)
        scores = {
            "faithfulness":      round(float(result["faithfulness"]), 4),
            "answer_relevancy":  round(float(result["answer_relevancy"]), 4),
            "context_precision": round(float(result["context_precision"]), 4),
            "context_recall":    round(float(result["context_recall"]), 4),
            "n_questions": len(questions),
        }
        return {"metrics": scores, "ragas_result": result.to_pandas().to_dict(orient="records")}
    except Exception as e:
        print(f"[Track B] ERROR during RAGAS evaluate(): {e}")
        return {}


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def print_retrieval_report(result: dict, mode: str):
    m = result["metrics"]
    print("\n" + "=" * 55)
    print(f"  TRACK A — RETRIEVAL METRICS  [mode: {mode}]")
    print("=" * 55)
    print(f"  Questions evaluated : {m['n_questions']}")
    for k_label, v in m["hit_rate"].items():
        bar = "#" * int(v * 30)
        print(f"  Hit Rate {k_label:<4}       : {v:.4f}  [{bar:<30}]")
    print(f"  MRR                 : {m['mrr']:.4f}")
    for k_label, v in m["precision"].items():
        print(f"  Precision {k_label:<4}      : {v:.4f}")
    print()


def print_ragas_report(result: dict, mode: str):
    if not result:
        return
    m = result["metrics"]
    print("=" * 55)
    print(f"  TRACK B — RAGAS METRICS  [mode: {mode}]")
    print("=" * 55)
    print(f"  Questions evaluated : {m['n_questions']}")
    for name in ["faithfulness", "answer_relevancy", "context_precision", "context_recall"]:
        v = m[name]
        bar = "#" * int(v * 30)
        print(f"  {name.replace('_', ' ').title():<22} : {v:.4f}  [{bar:<30}]")
    print()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Evaluate the AlphaWave RAG pipeline")
    parser.add_argument("--mode", choices=["embedding", "keyword", "hybrid", "full"],
                        default="full", help="Retrieval mode for ablation study")
    parser.add_argument("--chunk-config", default="chunk800",
                        help="Label for chunking config, e.g. chunk400, chunk800, chunk1200 (default: chunk800)")
    parser.add_argument("--retrieval-only", action="store_true", help="Only run Track A (no LLM)")
    parser.add_argument("--ragas-only", action="store_true", help="Only run Track B (RAGAS)")
    parser.add_argument("--dataset", default=GOLDEN_DATASET_PATH, help="Path to golden_dataset.json")
    parser.add_argument("--output", default=None, help="Path to write JSON results")
    parser.add_argument("--verbose", action="store_true", help="Print per-question detail")
    args = parser.parse_args()

    search_fn = SEARCH_FN[args.mode]

    print(f"\nAlphaWave RAG Evaluation — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Mode: {args.mode}  |  Chunks: {args.chunk_config}  |  Dataset: {args.dataset}")

    dataset = load_golden_dataset(args.dataset)
    print(f"Loaded {len(dataset)} questions ({sum(1 for d in dataset if d['expected_urls'])} positive, "
          f"{sum(1 for d in dataset if not d['expected_urls'])} negative)")

    results = {"timestamp": datetime.now().isoformat(), "mode": args.mode,
               "chunk_config": args.chunk_config, "retrieval": {}, "generation": {}}

    if not args.ragas_only:
        t0 = time.time()
        retrieval_result = run_retrieval_evaluation(dataset, search_fn, verbose=args.verbose)
        results["retrieval"] = retrieval_result
        print_retrieval_report(retrieval_result, args.mode)
        print(f"  Track A completed in {time.time() - t0:.1f}s")

    if not args.retrieval_only:
        t0 = time.time()
        ragas_result = run_ragas_evaluation(dataset, search_fn, verbose=args.verbose)
        results["generation"] = ragas_result
        print_ragas_report(ragas_result, args.mode)
        if ragas_result:
            print(f"  Track B completed in {time.time() - t0:.1f}s")

    # Negative question check (Track A only)
    if not args.ragas_only:
        negative_items = [d for d in dataset if not d.get("expected_urls")]
        if negative_items:
            print("=" * 55)
            print(f"  NEGATIVE QUESTIONS  [mode: {args.mode}]")
            print("=" * 55)
            for item in negative_items:
                neg_results = search_fn(normalize_question(item["question"]), limit=5)
                top_url = neg_results[0]["url"] if neg_results else "none"
                print(f"  [{item['id']}] {item['question']}")
                print(f"    Top retrieved: {top_url}")
            print()

    # Save results
    os.makedirs(RESULTS_DIR, exist_ok=True)
    if args.output:
        out_path = args.output
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    else:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = os.path.join(RESULTS_DIR, f"eval_{args.mode}_{args.chunk_config}_{ts}.json")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"Results saved to: {out_path}")


if __name__ == "__main__":
    main()
