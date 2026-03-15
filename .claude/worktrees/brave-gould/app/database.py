import psycopg2
from psycopg2.extras import RealDictCursor
from app.embeddings import generate_embedding


DB_CONFIG = {
    "host": "localhost",
    "port": 5433,
    "dbname": "alphawave_ai",
    "user": "postgres",
    "password": "postgres"
}


def get_connection():
    return psycopg2.connect(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        dbname=DB_CONFIG["dbname"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
        cursor_factory=RealDictCursor
    )


# -------------------------
# Keyword extraction (simple)
# -------------------------
def extract_keywords(query: str):
    words = query.lower().split()
    # Common words we want to ignore
    stop_words = {"what", "where", "when", "how", "who", "this", "that", "with", "from", "the", "and", "for", "your", "with", "is", "are"}
    
    keywords = []
    for w in words:
        clean = w.strip("?,.!")
        # Keep words that are 3+ chars and NOT in stop_words
        # OR special important acronyms
        if (len(clean) >= 3 and clean not in stop_words) or clean in ["ai", "io", "ux", "3d"]:
            keywords.append(clean)
    
    return keywords


# -------------------------
# Insert document
# -------------------------
def insert_document(url: str, title: str, content: str):
    embedding = generate_embedding(content)
    vector_str = "[" + ",".join(map(str, embedding)) + "]"

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO documents (url, title, content, embedding)
        VALUES (%s, %s, %s, %s)
        RETURNING id;
    """, (url, title, content, vector_str))

    new_id = cursor.fetchone()["id"]
    conn.commit()

    cursor.close()
    conn.close()

    return new_id


# -------------------------
# Hybrid search
# -------------------------
def search_similar_documents(query: str, limit: int = 5):
    embedding = generate_embedding(query)
    vector_str = "[" + ",".join(map(str, embedding)) + "]"
    keywords = extract_keywords(query)

    conn = get_connection()
    cursor = conn.cursor()

    # 1. Fetch Top 20 by Vector Similarity
    sql_vector = """
        SELECT id, url, title, content, 
               (1 - (embedding <=> %s)) as score
        FROM documents
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> %s
        LIMIT 20;
    """
    cursor.execute(sql_vector, (vector_str, vector_str))
    vector_results = cursor.fetchall()

    # 2. Fetch Top 20 by Keyword Matching
    keyword_results = []
    if keywords:
        like_clauses = []
        params = []
        for word in keywords:
            like_clauses.append("(title ILIKE %s OR content ILIKE %s)")
            params.extend([f"%{word}%", f"%{word}%"])
        
        keyword_sql = " + ".join([f"(CASE WHEN {clause} THEN 1 ELSE 0 END)" for clause in like_clauses])
        
        sql_keyword = f"""
            SELECT id, url, title, content,
                   ({keyword_sql}) as score
            FROM documents
            WHERE { " OR ".join(like_clauses) }
            ORDER BY ({keyword_sql}) DESC
            LIMIT 20;
        """
        # We need to repeat params for: 1. SELECT, 2. WHERE, 3. ORDER BY
        all_params = params * 3
        cursor.execute(sql_keyword, all_params)
        keyword_results = cursor.fetchall()

    cursor.close()
    conn.close()

    # 3. Reciprocal Rank Fusion (RRF)
    # RRF Score = 1 / (rank + k), where k is a constant (e.g., 60)
    k = 60
    scores = {}
    doc_map = {}

    def add_to_scores(results):
        for rank, doc in enumerate(results):
            doc_id = doc["id"]
            doc_map[doc_id] = doc
            if doc_id not in scores:
                scores[doc_id] = 0
            scores[doc_id] += 1.0 / (rank + 1 + k)

    add_to_scores(vector_results)
    add_to_scores(keyword_results)

    # Sort by RRF score
    sorted_ids = sorted(scores.keys(), key=lambda x: scores[x], reverse=True)
    
    # Return top 'limit' results
    final_results = []
    for doc_id in sorted_ids[:limit]:
        doc = doc_map[doc_id]
        # Attach the RRF score for visibility
        doc["rrf_score"] = scores[doc_id]
        # Map distance for compatibility with rag.py logs
        doc["distance"] = 1 - doc.get("score", 0) if "score" in doc else 1.0
        final_results.append(doc)

    return final_results


# -------------------------
# Manual test
# -------------------------
if __name__ == "__main__":
    try:
        query = "What is the DPP-Compliant Asset Management Platform?"

        results = search_similar_documents(query)

        print("\nSearch Results:\n")
        for r in results:
            print(f"ID: {r['id']}")
            print(f"Title: {r['title']}")
            print(f"Distance: {r['distance']}")
            print(f"Content Preview: {r['content'][:150]}...")
            print("-" * 50)

    except Exception as e:
        print("Operation failed:")
        print(e)