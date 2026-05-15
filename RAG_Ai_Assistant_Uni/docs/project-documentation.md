# AlphaWave AI Assistant — Full Technical Documentation

## 1. System Overview

AlphaWave is a full-stack, self-hosted **Retrieval-Augmented Generation (RAG)** AI assistant. Users authenticate, then ask questions in natural language against a private knowledge base scraped from `alphawave.hr`. All AI inference runs locally via Ollama — no data leaves the machine.

**Architecture:**
- **Python backend** — FastAPI REST API, RAG pipeline, hybrid search, SSE streaming
- **React frontend** — Auth, chat UI (widget + full-screen), analytics dashboard
- **PostgreSQL + pgvector** — document store with vector search
- **Supabase** — user authentication (JWT) and per-user chat history
- **Ollama** — local embedding model (`nomic-embed-text`) and LLM (`qwen2.5:7b`)

---

## 2. Backend

### 2.1 `app/api.py` — REST API (FastAPI)

Entry point for all client requests. Auth is enforced on every endpoint via Supabase JWT.

**Authentication:**

Every protected endpoint requires an `Authorization: Bearer <token>` header. The `get_current_user` dependency calls `supabase.auth.get_user(token)` to validate the JWT. Invalid or expired tokens return `401 Unauthorized`.

**Endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/chat` | Required | Blocking Q&A — returns full answer at once |
| `POST` | `/chat/stream` | Required | Streaming Q&A via SSE — tokens arrive in real-time |
| `GET` | `/history` | Required | Fetch full chat history for the logged-in user |
| `POST` | `/history` | Required | Save a message (user or assistant) to chat history |
| `GET` | `/logs` | Required | Fetch last 500 interaction logs (reverse chronological) |
| `GET` | `/health` | None | Returns `{ "status": "ok" }` |

**`POST /chat` — Request / Response:**
```json
// Request
{ "question": "string", "session_start": "2024-01-01T10:00:00Z" }

// Response
{ "answer": "string", "sources": [{ "url": "...", "title": "...", "chunk": 1 }] }
```

**`POST /chat/stream` — SSE Protocol:**

Returns `text/event-stream`. Each line is `data: <payload>\n\n`.

| Payload | Meaning |
|---------|---------|
| `data: <token>` | One LLM output token (newlines escaped as `\n`) |
| `data: [SOURCES]{json}` | JSON array of source objects, sent after full answer |
| `data: [ERROR] <msg>` | Error occurred during generation |
| `data: [DONE]` | Stream complete |

**Session Memory:**

Before calling the RAG pipeline, both `/chat` and `/chat/stream` fetch the last 10 messages from Supabase `chat_history` filtered to the current `session_start` timestamp (ISO 8601). This gives the LLM recent conversation context for pronoun resolution. History is formatted as `AI: ...\nUser: ...` chronologically.

**CORS:** `allow_origins=["*"]` — restrict to frontend domain in production.

---

### 2.2 `app/rag.py` — RAG Pipeline

Core AI layer using LangChain LCEL.

**Models:**
- LLM: `qwen2.5:7b` via `ChatOllama`
- Settings: `temperature=0` (deterministic/factual), `num_ctx=4096`

**LCEL Chain:**
```python
chain = RAG_PROMPT | ChatOllama(model="qwen2.5:7b") | StrOutputParser()
```
Supports both `.invoke()` (blocking) and `.stream()` (token-by-token).

**Prompt Template:**
```
Answer using ONLY the Context below. If the answer isn't in the Context,
say "I don't have that information." Use Chat History to resolve pronouns.

Chat History:
{chat_history}

Context:
{context}

Question: {question}
Answer:
```

**`normalize_question(question)`** — if the question is fewer than 3 words, prepends `"Explain"` to make it a proper query.

**`generate_answer(question, user_email, user_name, chat_history)`** — blocking call:
1. Normalizes question
2. Runs hybrid search (top 5 chunks)
3. Builds context string
4. Calls `chain.invoke()`
5. Logs interaction
6. Returns `(answer, sources)`

**`stream_answer(question, user_email, user_name, chat_history, session_start)`** — SSE generator:
1. Normalizes question
2. Runs hybrid search
3. Calls `chain.stream()`, yielding each token as `data: <token>\n\n`
4. After streaming: logs interaction, yields `[SOURCES]` if answer is not "I don't have that information"
5. Yields `data: [DONE]\n\n`

**`extract_sources(results)`** — deduplicates results by URL, keeps best-scored chunk per URL, strips `(chunk N)` from titles, sorts by score descending.

---

### 2.3 `app/database.py` — PostgreSQL + pgvector + FlashRank

All database logic. Uses raw `psycopg2` for full query planner control.

**Connection Config:**

| Parameter | Value |
|-----------|-------|
| Host | `localhost` |
| Port | `5433` |
| Database | `alphawave_ai` |
| User | `postgres` |
| Password | `postgres` |

**`documents` table schema:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | `SERIAL PRIMARY KEY` | Auto-increment row ID |
| `url` | `TEXT` | Source page URL |
| `title` | `TEXT` | Page title + chunk label (`"Page Title (chunk N)"`) |
| `content` | `TEXT` | Raw text chunk |
| `embedding` | `VECTOR(768)` | 768-dim embedding from `nomic-embed-text` |

**Reranker (module-level, loaded once at startup):**
```python
reranker = Ranker(model_name="ms-marco-MiniLM-L-12-v2", cache_dir="/tmp/flashrank")
```
FlashRank cross-encoder — scores passages by semantic relevance to the query.

**`extract_keywords(query)`:**
- Lowercases and splits the query
- Removes stop words (`what`, `where`, `the`, `and`, etc.) and words shorter than 3 chars
- Keeps special short acronyms: `ai`, `io`, `ux`, `3d`

**`search_similar_documents(query, limit=5)` — 4-stage hybrid search pipeline:**

**Stage 1 — Vector Search:**
```sql
SELECT id, url, title, content, (1 - (embedding <=> %s)) as score
FROM documents WHERE embedding IS NOT NULL
ORDER BY embedding <=> %s LIMIT 40;
```
Fetches top 40 by cosine similarity using pgvector's `<=>` operator.

**Stage 2 — Keyword Search:**
Dynamically builds SQL with `ILIKE` clauses for each extracted keyword against both `title` and `content`. Scores each row by how many keywords matched. Fetches top 40.

**Stage 3 — Reciprocal Rank Fusion (RRF):**
Merges both ranked lists using the formula:
```
score(doc) += 1 / (rank + 1 + k)   where k = 60
```
Deduplicates by `doc_id`. Caps at max 2 chunks per source URL. Takes top 20 candidates.

**Stage 4 — FlashRank Reranking:**
Cross-encoder rescores all 20 candidates against the original query. Returns top `limit` results sorted by `rerank_score`.

**`insert_document(url, title, content)`:**
Generates embedding for the content, formats it as a pgvector string `[f1,f2,...]`, inserts into `documents`, returns the new row `id`.

---

### 2.4 `app/embeddings.py` — Embedding Generation

```python
embeddings = OllamaEmbeddings(model="nomic-embed-text")
generate_embedding(text: str) -> list[float]  # 768-dimensional vector
```

Uses LangChain's `OllamaEmbeddings` wrapper. Called by `database.py` on both insert (document embedding) and search (query embedding).

---

### 2.5 `app/chunking.py` — Text Splitting

```python
splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=120)
chunk_text(text: str) -> list[str]
```

`RecursiveCharacterTextSplitter` splits on paragraphs → sentences → words → characters, preserving semantic coherence. Each chunk is max 800 characters with 120-character overlap between adjacent chunks to preserve cross-boundary context.

---

### 2.6 `app/scraper.py` — Web Crawler & Ingestion

BFS crawler for populating the database from a live website.

**`scrape_page(url)`:**
1. HTTP GET with `requests`
2. Parse HTML with `BeautifulSoup`
3. Remove `script`, `style`, `noscript`, `nav`, `header`, `footer` tags
4. Extract title from `<title>`
5. Prefer `<main>` content; fall back to full body
6. Strip extra whitespace line by line

**`extract_internal_links(soup, base_url)`:**
Finds all `<a href>` tags, filters to same-domain only, strips anchor fragments (`#...`).

**Main crawl loop (`if __name__ == "__main__"`):**
1. Starts from `base_url = "https://alphawave.hr/"`
2. BFS with `visited` and `to_visit` sets
3. Per page: scrape → `chunk_text()` → `insert_document()` for each chunk with title `"Page Title (chunk N)"`
4. After full crawl: runs `ANALYZE documents;` to update PostgreSQL query planner statistics

---

### 2.7 `app/logger.py` — Interaction Logger

Logs every RAG interaction to `chat_logs.jsonl` (JSONL = one JSON object per line, in the project root).

**Rolling window:** `MAX_LOGS = 500` — oldest entries are dropped when the cap is exceeded.

**Log entry fields:**

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | ISO string | When the query was processed |
| `session_start` | ISO string / null | Session start time for grouping |
| `user_email` | string | Authenticated user email |
| `user_name` | string | User display name from Supabase metadata |
| `query` | string | Original user question |
| `normalized_query` | string | After `normalize_question()` |
| `retrieved_chunks` | array | `[{title, url, rrf_score}]` — top retrieved chunks |
| `answer` | string | Final LLM answer |
| `latency_ms` | float | Total wall-clock time in milliseconds |

---

## 3. Frontend

All frontend code lives in `frontend/src/`. Entry point: `main.jsx` → `App.jsx`.

### 3.1 File Structure

| File | Purpose |
|------|---------|
| `main.jsx` | React DOM root render |
| `App.jsx` | Root component — auth gate, session management, idle timeout, routing |
| `Auth.jsx` | Login / registration form backed by Supabase Auth |
| `ChatWidget.jsx` | Floating popup chat widget (bottom-right) |
| `FullChat.jsx` | Full-screen chat overlay |
| `Dashboard.jsx` | Analytics dashboard — live log viewer grouped by user and session |
| `supabaseClient.js` | Singleton Supabase client (prevents HMR duplicate instances) |
| `*.css` | Component-scoped stylesheets |

---

### 3.2 `supabaseClient.js` — Auth Client

```js
// Reads from Vite env vars:
// VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

// Singleton pattern — stored on window to survive HMR
if (!window.supabaseInstance) {
    window.supabaseInstance = createClient(supabaseUrl, supabaseAnonKey)
}
export const supabase = window.supabaseInstance
```

---

### 3.3 `App.jsx` — Root Component

**State:**
- `session` — current Supabase session (null = not logged in)
- `sessionStart` — ISO timestamp set on login, used to scope chat history fetches
- `showFullChat` — toggles `FullChat` overlay
- `showDashboard` — toggles `Dashboard` overlay

**Auth Gate:** If `session` is null, renders only `<Auth />`. Once Supabase fires `onAuthStateChange`, `session` is set and the main UI loads.

**Idle Timeout Auto-Logout:** After 2 minutes (120 000ms) of no user interaction (no `mousemove`, `mousedown`, `keydown`, `touchstart`, or `scroll`), calls `supabase.auth.signOut()` automatically.

**Rendered UI (when authenticated):**
- Navbar with user display name, "Dashboard" button, "Logout" button
- Hero landing section
- `<ChatWidget>` (always visible unless `showFullChat`)
- `<FullChat>` (rendered when `showFullChat = true`)
- `<Dashboard>` (rendered when `showDashboard = true`)

---

### 3.4 `Auth.jsx` — Login / Registration

Toggles between **Login** and **Register** modes.

- **Login:** `supabase.auth.signInWithPassword({ email, password })`
- **Register:** `supabase.auth.signUp({ email, password, options: { data: { full_name } } })`

On successful login, `onAuthStateChange` in `App.jsx` picks up the session automatically. On failed login/register, shows inline error message.

---

### 3.5 `ChatWidget.jsx` — Floating Chat Popup

- Fixed bottom-right floating button; click to open popup.
- "Expand" button in the popup header calls `onExpand()` prop → switches to `FullChat`.
- **Enter** to send, **Shift+Enter** for new line.
- Textarea auto-resizes using `scrollHeight`.
- Shows 3-dot bouncing typing indicator while waiting for first token.

**Streaming SSE flow:**
1. Appends empty assistant message placeholder.
2. Fetches `POST /chat/stream` with `Authorization: Bearer <token>` and `{ question, session_start }`.
3. Reads `response.body` as a `ReadableStream`, decodes chunks, splits on `\n\n`.
4. Parses each `data:` line:
   - Regular token → appends to `fullAnswer`, updates last message in state.
   - `[SOURCES]{json}` → parses and attaches to last message.
   - `[DONE]` → stops loading, calls `saveToHistory('user', ...)` and `saveToHistory('assistant', fullAnswer)`.
   - `[ERROR]` → shows error message.
5. Sources render as a single clickable chip below the AI message (first source only).

---

### 3.6 `FullChat.jsx` — Full-Screen Chat Interface

Functionally identical SSE implementation as `ChatWidget`. Differences:
- Full-screen `position: fixed` overlay.
- Larger layout with header logo and tagline.
- `onClose` prop returns to landing page.
- Same `saveToHistory` + SSE streaming pattern.

---

### 3.7 `Dashboard.jsx` — Analytics Dashboard

Live analytics viewer that polls `GET /logs` every **2 seconds**.

**Data grouping (`groupByUser`):**
Logs are grouped into a two-level tree:
```
User (email)
  └── Session (session_start timestamp)
        └── Individual queries (log entries)
```

**`UserGroup` component:** Expandable row showing user name, email, total queries, total sessions.

**`SessionGroup` component:** Expandable row showing session timestamp, query count, average latency (colored green if ≤ 2000ms, red if > 2000ms).

**Log table columns (per session):** Time, Query, Latency, Top Chunk title, RRF Score.

**Detail modal:** Clicking any log row opens a modal with the full raw JSON of that log entry.

---

## 4. Full Request Lifecycle (SSE Path)

```
User types question → Enter
  │
  ├── ChatWidget / FullChat
  │     POST /chat/stream
  │     Authorization: Bearer <supabase_jwt>
  │     Body: { question, session_start }
  │
  ├── api.py — get_current_user()
  │     supabase.auth.get_user(token) → validates JWT
  │
  ├── api.py — chat_stream()
  │     Fetch last 10 messages from supabase.table("chat_history")
  │     WHERE user_id = user.id AND created_at >= session_start
  │     Format as "AI: ...\nUser: ..." string
  │
  ├── rag.stream_answer()
  │     normalize_question()
  │     database.search_similar_documents(query, limit=5)
  │       │
  │       ├── embeddings.generate_embedding(query)   [nomic-embed-text via Ollama]
  │       ├── Stage 1: Vector search top 40          [pgvector <=> cosine distance]
  │       ├── Stage 2: Keyword search top 40         [ILIKE on title + content]
  │       ├── Stage 3: RRF merge → top 20 candidates [1/(rank+1+60)]
  │       └── Stage 4: FlashRank rerank → top 5      [ms-marco-MiniLM-L-12-v2]
  │
  │     Build context = join top 5 chunks
  │     chain.stream({ context, chat_history, question })
  │       └── qwen2.5:7b via Ollama (temperature=0, ctx=4096)
  │
  ├── SSE tokens streamed to browser
  │     data: token1\n\n
  │     data: token2\n\n
  │     ...
  │     data: [SOURCES][{"url":...,"title":...}]\n\n
  │     data: [DONE]\n\n
  │
  ├── logger.log_interaction()   [writes to chat_logs.jsonl]
  │
  └── Frontend
        POST /history (user message)
        POST /history (assistant message)
        → stored in supabase chat_history table
```

---

## 5. Infrastructure

### Docker — PostgreSQL + pgvector

```bash
docker run -d --name alphawave-db --restart unless-stopped \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=alphawave_ai \
  -p 5433:5432 \
  ankane/pgvector
```

Enable the extension after first run:
```sql
CREATE EXTENSION vector;
```

The container maps host port **5433** to PostgreSQL's default **5432** inside the container.

### Ollama — Local LLM Server

```bash
ollama pull nomic-embed-text   # 768-dim embeddings
ollama pull qwen2.5:7b         # Text generation (replaces deepseek-r1/llama3)
```

Ollama runs on `http://localhost:11434` (default). LangChain connects to it automatically.

### Supabase

- Provides user authentication (JWT tokens, email/password)
- Stores `chat_history` table with Row Level Security (RLS) — each user can only see their own rows
- Backend reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `.env`
- Frontend reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env`

---

## 6. Environment Variables

**Backend `.env` (project root):**
```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon_key>
```

**Frontend `.env` (inside `frontend/`):**
```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
```

---

## 7. Startup Order

1. Start Docker Desktop — verify `alphawave-db` container is running.
2. Start Ollama (must have `nomic-embed-text` and `qwen2.5:7b` pulled).
3. Activate Python virtualenv and start the backend:
   ```bash
   .\venv\Scripts\activate
   uvicorn app.api:app --reload
   # Runs on http://127.0.0.1:8000
   ```
4. Start the frontend dev server:
   ```bash
   cd frontend
   npm run dev
   # Runs on http://localhost:5173
   ```
5. Open `http://localhost:5173` — login screen appears.

---

## 8. Key Dependencies

### Python

| Package | Purpose |
|---------|---------|
| `fastapi` | REST API framework |
| `uvicorn` | ASGI server |
| `langchain-core` | Prompts, parsers, LCEL primitives |
| `langchain-ollama` | `ChatOllama`, `OllamaEmbeddings` |
| `langchain-text-splitters` | `RecursiveCharacterTextSplitter` |
| `flashrank` | Cross-encoder reranker (`ms-marco-MiniLM-L-12-v2`) |
| `psycopg2-binary` | PostgreSQL driver |
| `supabase` | Supabase client (auth + database) |
| `beautifulsoup4` | HTML parsing for scraper |
| `requests` | HTTP client for scraper |
| `python-dotenv` | Load `.env` variables |

### Node.js / Frontend

| Package | Purpose |
|---------|---------|
| `react` + `react-dom` | UI library |
| `@supabase/supabase-js` | Supabase auth client |
| `vite` | Build tool and dev server |

---

## 9. Security Notes

- **Local inference:** All LLM calls stay on-machine via Ollama. No data sent to OpenAI or any external AI API.
- **JWT auth:** Every API endpoint (except `/health`) validates the Supabase JWT. Tokens expire per Supabase defaults.
- **Idle auto-logout:** Frontend signs out after 2 minutes of inactivity.
- **RLS on chat history:** Supabase Row Level Security ensures users cannot read each other's history.
- **CORS:** Currently `allow_origins=["*"]` — restrict to `http://localhost:5173` (or production domain) before deployment.
- **Database credentials:** Hardcoded in `database.py` — move to `.env` before any public deployment.
