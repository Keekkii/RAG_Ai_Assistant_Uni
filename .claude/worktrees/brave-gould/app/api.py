from fastapi import FastAPI, Depends, HTTPException, status
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from supabase import create_client, Client
from app.rag import generate_answer
from dotenv import load_dotenv
import json
import os

# Load variables from root .env
load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env")

# Initialize Supabase Admin/Client (for token verification)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

# --- Security Dependency ---
async def get_current_user(token: str = Depends(oauth2_scheme)):
    """
    Verifies the Supabase JWT token.
    Supabase's auth.get_user(token) will return the user object if the token is valid.
    """
    try:
        # This call validates the JWT with Supabase Auth service
        response = supabase.auth.get_user(token)
        if response.user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired session",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return response.user
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Could not validate credentials: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

# --- Models ---
class QuestionRequest(BaseModel):
    question: str

class HistoryRequest(BaseModel):
    role: str
    content: str

# --- Endpoints ---
@app.post("/chat")
def chat(request: QuestionRequest, token: str = Depends(oauth2_scheme), user=Depends(get_current_user)):
    # 1. Fetch recent history for Contextual Memory
    chat_history_str = ""
    try:
        supabase.postgrest.auth(token)
        history_res = supabase.table("chat_history") \
            .select("role", "content") \
            .eq("user_id", str(user.id)) \
            .order("created_at", desc=True) \
            .limit(10) \
            .execute()
        
        # Format history: Assistant: ..., User: ... (reversed to get chronological)
        history_parts = []
        for msg in reversed(history_res.data):
            role = "AI" if msg['role'] == "assistant" else "User"
            history_parts.append(f"{role}: {msg['content']}")
        chat_history_str = "\n".join(history_parts)
    except Exception as e:
        print(f"Memory Fetch Warning: {e}")

    # 2. Generate answer with memory
    user_email = user.email
    user_name = user.user_metadata.get("full_name", "User")
    
    answer = generate_answer(
        request.question, 
        user_email=user_email, 
        user_name=user_name,
        chat_history=chat_history_str
    )
    return {"answer": answer}

@app.get("/history")
def get_history(token: str = Depends(oauth2_scheme), user=Depends(get_current_user)):
    """
    Fetches the chat history for the logged-in user.
    Uses the user's token to satisfy RLS.
    """
    try:
        # We use a fresh client or set the token for RLS
        # Supabase Python SDK handles token headers via postgrest.auth(token)
        supabase.postgrest.auth(token)
        
        response = supabase.table("chat_history") \
            .select("*") \
            .eq("user_id", str(user.id)) \
            .order("created_at", desc=False) \
            .execute()
        return response.data
    except Exception as e:
        print(f"DEBUG: get_history error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"History Fetch Error: {str(e)}")

@app.post("/history")
def save_history(request: HistoryRequest, token: str = Depends(oauth2_scheme), user=Depends(get_current_user)):
    """
    Saves a new chat message to the history table.
    """
    try:
        supabase.postgrest.auth(token)
        
        data = {
            "user_id": str(user.id),
            "role": request.role,
            "content": request.content
        }
        response = supabase.table("chat_history").insert(data).execute()
        return response.data
    except Exception as e:
        print(f"DEBUG: save_history error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"History Save Error: {str(e)}")

@app.get("/logs")
def get_logs(user=Depends(get_current_user)):
    log_file = "chat_logs.jsonl"
    if not os.path.exists(log_file):
        return []
    
    logs = []
    with open(log_file, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    logs.append(json.loads(line))
                except:
                    continue
    
    return logs[::-1][:50]

@app.get("/health")
def health():
    return {"status": "ok"}