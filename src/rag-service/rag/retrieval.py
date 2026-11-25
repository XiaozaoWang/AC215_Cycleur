"""Read-only Chroma access shared by the API, CLI and future agent tools."""
import time
import chromadb
from rag.indexing import generate_embeddings, llm_client
from rag.settings import CHROMADB_HOST, CHROMADB_PORT, CHROMADB_SSL, EMBEDDING_MODEL, EMBEDDING_DIMENSION
from rag.logging import log_event

def chroma_client(max_attempts=15):
    for attempt in range(max_attempts):
        try:
            client = chromadb.HttpClient(host=CHROMADB_HOST, port=CHROMADB_PORT, ssl=CHROMADB_SSL)
            client.heartbeat()
            return client
        except (ValueError, ConnectionError, OSError):
            if attempt == max_attempts - 1:
                raise
            time.sleep(2)

def retrieve(method, question, n_results=5, *, client_factory=None, embed_func=None,
             max_attempts=15, max_retries=5, online=False):
    """Return Chroma results for a question, shared by query and chat."""
    if not question.strip():
        raise ValueError("Question cannot be blank")
    if n_results < 1:
        raise ValueError("n_results must be at least 1")
    client = client_factory() if client_factory is not None else chroma_client(max_attempts=max_attempts)
    from chromadb.errors import NotFoundError
    try:
        try:
            collection = client.get_collection(name=f"greenpath-docs-{method}")
        except NotFoundError as error:
            raise ValueError(
                f"Collection is missing. Run python cli.py --load --chunk_type {method} first."
            ) from error
        count = collection.count()
        if not count:
            raise ValueError("Collection is empty. Load existing embeddings before querying.")
        validate_collection(collection)
        if embed_func is not None:
            query_embedding = embed_func([question], "RETRIEVAL_QUERY")[0]
        else:
            query_embedding = generate_embeddings(
                [question], "RETRIEVAL_QUERY", max_retries=max_retries,
                client=llm_client(online=True) if online else None,
            )[0]
        return collection.query(
            query_embeddings=[query_embedding],
            n_results=min(n_results, count),
            include=["documents", "metadatas", "distances"],
        )
    finally:
        client.close()


def query(method, question, n_results=5):
    """Retrieve without generating an answer; log counts rather than private text."""
    results = retrieve(method, question, n_results)
    log_event("rag_completed", "RAG retrieval completed", retrieved_chunk_count=len(results["documents"][0]))


def validate_collection(collection):
    meta = collection.metadata or {}
    expected = {"embedding_model": EMBEDDING_MODEL, "embedding_dimension": EMBEDDING_DIMENSION,
                "hnsw:space": "cosine"}
    if any(meta.get(key) != value for key, value in expected.items()):
        raise ValueError("Collection embedding configuration does not match the RAG service")


def collection_status(name, *, max_attempts=1):
    client = chroma_client(max_attempts=max_attempts)
    try:
        collection = client.get_collection(name=name)
        validate_collection(collection)
        count = collection.count()
        if not count:
            raise ValueError("Collection is empty; load existing embeddings")
        return count
    finally:
        client.close()
