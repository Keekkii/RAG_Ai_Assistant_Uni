import json
import os
from datetime import datetime

LOG_FILE = "chat_logs.jsonl"

def log_interaction(query: str, normalized_query: str, results: list, answer: str, latency_ms: float, user_email: str = "Anonymous", user_name: str = "Guest"):
    """
    Logs the RAG interaction to a .jsonl file for dashboard viewing.
    """
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "user_email": user_email,
        "user_name": user_name,
        "query": query,
        "normalized_query": normalized_query,
        "retrieved_chunks": [
            {
                "title": r.get("title"),
                "url": r.get("url"),
                "rrf_score": round(r.get("rrf_score", 0), 4)
            } for r in results
        ],
        "answer": answer,
        "latency_ms": round(latency_ms, 2)
    }

    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"Failed to write log: {e}")
