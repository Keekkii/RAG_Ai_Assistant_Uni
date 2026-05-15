import json
import os
from datetime import datetime

LOG_FILE = "chat_logs.jsonl"
MAX_LOGS = 500

def log_interaction(query: str, normalized_query: str, results: list, answer: str, latency_ms: float, user_email: str = "Anonymous", user_name: str = "Guest", session_start: str = None):
    """
    Logs the RAG interaction to a .jsonl file for dashboard viewing.
    Keeps a rolling window of MAX_LOGS entries — oldest are dropped when cap is reached.
    """
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "session_start": session_start,
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
        # Read existing lines
        lines = []
        if os.path.exists(LOG_FILE):
            with open(LOG_FILE, "r", encoding="utf-8") as f:
                lines = [l for l in f if l.strip()]

        # Append new entry, then trim oldest if over cap
        lines.append(json.dumps(log_entry, ensure_ascii=False) + "\n")
        if len(lines) > MAX_LOGS:
            lines = lines[-MAX_LOGS:]

        with open(LOG_FILE, "w", encoding="utf-8") as f:
            f.writelines(lines)
    except Exception as e:
        print(f"Failed to write log: {e}")
