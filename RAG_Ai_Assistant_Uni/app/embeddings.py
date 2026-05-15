from langchain_ollama import OllamaEmbeddings

EMBED_MODEL = "nomic-embed-text"

embeddings = OllamaEmbeddings(model=EMBED_MODEL)


def generate_embedding(text: str) -> list[float]:
    return embeddings.embed_query(text)


if __name__ == "__main__":
    test_text = "Alphawave provides AI consulting and digital solutions."
    embedding = generate_embedding(test_text)
    print("Embedding generated!")
    print(f"Vector length: {len(embedding)}")
    print("First 5 values:", embedding[:5])