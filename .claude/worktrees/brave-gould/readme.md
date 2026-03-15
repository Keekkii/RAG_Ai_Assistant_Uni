# AlphaWave AI Assistant

Self-hosted Retrieval-Augmented Generation (RAG) AI assistant platform. It combines a Python/PostgreSQL backend with a React frontend to deliver private, context-aware AI interactions powered entirely by local infrastructure.

---

## What It Does

Users ask questions via a chat interface. The system searches a private knowledge base for the most relevant documents, injects them as context, and generates a grounded answer using a local LLM — without sending any data to external services.

---

## Tech Stack

### Backend
| Component        | Technology                        |
|------------------|-----------------------------------|
| API Framework    | FastAPI + Uvicorn                 |
| Language         | Python 3                          |
| Database         | PostgreSQL 18 with pgvector       |
| DB Driver        | psycopg2                          |
| Infrastructure   | Docker Desktop                    |

### AI / RAG Layer
| Component        | Technology                        |
|------------------|-----------------------------------|
| Orchestration    | LangChain (LCEL)                  |
| LLM              | Ollama — deepseek-r1                   |
| Embeddings       | Ollama — nomic-embed-text (768-d) |
| Vector Similarity| Cosine Distance via pgvector      |
| Web Scraping     | BeautifulSoup + Requests          |

### Frontend
| Component        | Technology                        |
|------------------|-----------------------------------|
| Framework        | React + Vite                      |
| Styling          | Vanilla CSS                       |
| Communication    | Fetch API (REST)                  |

---

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js and npm
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Ollama](https://ollama.com/)

### 1. Database

Run PostgreSQL with pgvector in Docker:

```bash
docker run --name alphawave-db \
  -e POSTGRES_DB=alphawave_ai \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5433:5432 \
  -d ankane/pgvector
```

### 2. AI Models

Pull the required models via Ollama:

```bash
ollama pull deepseek-r1
ollama pull nomic-embed-text
```

### 3. Backend

```bash
python -m venv venv
venv\Scripts\activate
pip install fastapi uvicorn langchain langchain-ollama langchain-text-splitters psycopg2-binary beautifulsoup4 requests python-dotenv
uvicorn app.api:app --reload
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in a browser.

---

## Startup Order

| Step | What              | Command                              |
|------|-------------------|--------------------------------------|
| 1    | Docker container  | `docker start alphawave-db`          |
| 2    | Ollama            | Open Ollama app or `ollama serve`    |
| 3    | Python backend    | `uvicorn app.api:app --reload`       |
| 4    | React frontend    | `cd frontend && npm run dev`         |

---

## Documentation

Full technical documentation is available in [`docs/technical-documentation.md`](docs/technical-documentation.md).

