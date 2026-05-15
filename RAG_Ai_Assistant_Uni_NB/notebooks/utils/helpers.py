"""Shared helpers for experiment notebooks."""

import sys
import os
import time
import json
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# Path bootstrap — run once at the top of every notebook
# ---------------------------------------------------------------------------

def bootstrap():
    """Add RAG_Ai_Assistant_Uni/ to sys.path so `from app.xxx import xxx` works."""
    scripts_root = str(Path(__file__).resolve().parents[3] / "RAG_Ai_Assistant_Uni")
    if scripts_root not in sys.path:
        sys.path.insert(0, scripts_root)


# ---------------------------------------------------------------------------
# Cosine similarity
# ---------------------------------------------------------------------------

def cosine_similarity(a: list[float], b: list[float]) -> float:
    a, b = np.array(a), np.array(b)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


# ---------------------------------------------------------------------------
# Chunk statistics
# ---------------------------------------------------------------------------

def chunk_stats(chunks: list[str]) -> dict:
    lengths = [len(c) for c in chunks]
    return {
        "count": len(chunks),
        "avg_len": round(sum(lengths) / len(lengths), 1) if lengths else 0,
        "min_len": min(lengths) if lengths else 0,
        "max_len": max(lengths) if lengths else 0,
    }


# ---------------------------------------------------------------------------
# Timing helper
# ---------------------------------------------------------------------------

class Timer:
    def __enter__(self):
        self._start = time.time()
        return self

    def __exit__(self, *_):
        self.elapsed_ms = (time.time() - self._start) * 1000

    def __str__(self):
        return f"{self.elapsed_ms:.1f} ms"


# ---------------------------------------------------------------------------
# Results loader (for evaluation notebook)
# ---------------------------------------------------------------------------

def load_results(path: str | Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def results_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "RAG_Ai_Assistant_Uni" / "results"
