import time
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_ollama import ChatOllama
from app.database import search_similar_documents
from app.logger import log_interaction

LLM_MODEL = "qwen2.5:7b"

llm = ChatOllama(
    model=LLM_MODEL,
    num_ctx=4096,     # vjv ce morat drugi
    temperature=0.1     # Factual responses, no creative drifting
)

RAG_PROMPT = PromptTemplate(
    input_variables=["context", "chat_history", "question"],
    template="""Answer using ONLY the Context below. If the answer isn't in the Context, say "I don't have that information." Use Chat History to resolve pronouns.

Chat History:
{chat_history}

Context:
{context}

Question: {question}
Answer:"""
)

# Modern LCEL chain: prompt | llm | output parser
chain = RAG_PROMPT | llm | StrOutputParser()


def normalize_question(question: str) -> str:
    normalized = question.strip()
    if len(normalized.split()) < 3:
        return f"Explain {normalized}"
    return normalized



def generate_answer(question: str, user_email: str = "Anonymous", user_name: str = "Guest", chat_history: str = "") -> str:
    start_time = time.time()
    normalized_question = normalize_question(question)
    
    # Use the fast, high-quality RRF hybrid search
    # retrieving 5 chunks for maximum speed while keeping high relevance
    print(f"DEBUG: Contextual Memory (History Buffer):\n{chat_history}\n")
    print(f"\nPerforming fast RRF search for: {normalized_question}")
    results = search_similar_documents(normalized_question, limit=5)
    
    if not results:
        return "I don't know."

    print("\nRetrieved Chunks (RRF Ranked):\n")
    for r in results:
        print(f"TITLE: {r['title']}")
        print(f"RRF SCORE: {r.get('rrf_score', 0):.4f}")
        print("-" * 50)

    context = "\n\n".join([r["content"] for r in results])

    # Only one LLM call now - for the final answer!
    answer = chain.invoke({
        "context": context, 
        "chat_history": chat_history, 
        "question": normalized_question
    })
    
    elapsed_time = (time.time() - start_time) * 1000  # ms
    
    # Log the interaction for the dashboard
    log_interaction(
        query=question,
        normalized_query=normalized_question,
        results=results,
        answer=answer,
        latency_ms=elapsed_time,
        user_email=user_email,
        user_name=user_name
    )

    return answer


def stream_answer(question: str, user_email: str = "Anonymous", user_name: str = "Guest", chat_history: str = "", session_start: str = None):
    """Generator that yields SSE-formatted token strings from the LLM."""
    start_time = time.time()
    normalized_question = normalize_question(question)

    print(f"DEBUG: Contextual Memory (History Buffer):\n{chat_history}\n")
    print(f"\nPerforming fast RRF search for: {normalized_question}")

    results = []
    full_answer_parts = []
    error_msg = None

    try:
        results = search_similar_documents(normalized_question, limit=5)

        if not results:
            yield "data: I don't know.\n\n"
        else:
            print("\nRetrieved Chunks (RRF Ranked):\n")
            for r in results:
                print(f"TITLE: {r['title']}")
                print(f"RRF SCORE: {r.get('rrf_score', 0):.4f}")
                print("-" * 50)

            context = "\n\n".join([r["content"] for r in results])

            for chunk in chain.stream({
                "context": context,
                "chat_history": chat_history,
                "question": normalized_question
            }):
                if chunk:
                    full_answer_parts.append(chunk)
                    safe_chunk = chunk.replace("\n", "\\n")
                    yield f"data: {safe_chunk}\n\n"

    except Exception as e:
        error_msg = str(e)
        print(f"ERROR in stream_answer: {error_msg}")
        yield f"data: [ERROR] {error_msg}\n\n"

    full_answer = "".join(full_answer_parts) if full_answer_parts else (f"[ERROR] {error_msg}" if error_msg else "I don't know.")
    elapsed_ms = (time.time() - start_time) * 1000
    log_interaction(
        query=question,
        normalized_query=normalized_question,
        results=results,
        answer=full_answer,
        latency_ms=elapsed_ms,
        user_email=user_email,
        user_name=user_name,
        session_start=session_start
    )

    yield "data: [DONE]\n\n"


if __name__ == "__main__":
    question = "What is the UNIRI Sports Center AI Assistant?"
    answer = generate_answer(question)
    print("\nAI Answer:\n")
    print(answer)
