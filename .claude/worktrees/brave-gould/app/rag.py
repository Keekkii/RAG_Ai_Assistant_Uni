from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_ollama import ChatOllama
from app.database import search_similar_documents

LLM_MODEL = "qwen2.5:7b"

llm = ChatOllama(
    model=LLM_MODEL,
    num_ctx=4096,     # Optimized context window for speed and accuracy
    temperature=0     # Factual responses, no creative drifting
)

RAG_PROMPT = PromptTemplate(
    input_variables=["context", "chat_history", "question"],
    template="""You are the AlphaWave AI Assistant. 

STRICT INSTRUCTIONS:
1. If the user uses pronouns (like "his", "it", or "that"), use the Chat History below to identify who or what they are talking about.
2. Answer the question DIRECTLY. Do not say "To answer your question" or explain your reasoning.
3. Be concise and professional.

Chat History:
{chat_history}

Context:
{context}

User Question: {question}

Answer:"""
)

# Modern LCEL chain: prompt | llm | output parser
chain = RAG_PROMPT | llm | StrOutputParser()


def normalize_question(question: str) -> str:
    normalized = question.strip()
    if len(normalized.split()) < 3:
        return f"Explain {normalized}"
    return normalized



import time
from app.logger import log_interaction

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


if __name__ == "__main__":
    question = "What is the UNIRI Sports Center AI Assistant?"
    answer = generate_answer(question)
    print("\nAI Answer:\n")
    print(answer)
