"""Independent RAG API. Startup/readiness never embed or call Gemini."""
import asyncio
import json
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from starlette.responses import JSONResponse

from rag.generators import get_generator
from rag.indexing import close_online_clients
from rag.settings import CHUNK_TYPE, COLLECTION, GENERATIVE_MODEL, generator_name, gcp_project
from rag.schemas import Question, Result, sources_from
from rag import retrieval
from rag.logging import record_fields, request_context

def collection_status():
    return retrieval.collection_status(COLLECTION)


@asynccontextmanager
async def lifespan(app):
    # Fail clearly at startup for an unimplemented/unknown generator.
    app.state.generator = get_generator(online=True)
    # No cloud, indexing or database calls on service startup.
    try:
        yield
    finally:
        close_online_clients()


app = FastAPI(title="GreenPath RAG", lifespan=lifespan)


@app.middleware("http")
async def request_timeout(request, call_next):
    started = time.perf_counter()
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    context = {"request_id": request_id}
    token = request_context.set(context)
    status = 500
    try:
        # Keep a stuck optional dependency from holding the HTTP response open.
        async with asyncio.timeout(4 if request.url.path == "/ready" else 45):
            response = await call_next(request)
    except TimeoutError:
        record_fields(failure_event="rag_timeout", error_type="TimeoutError")
        response = JSONResponse({"detail": "RAG request timed out"}, status_code=504)
    except Exception as error:
        record_fields(error_type=type(error).__name__)
        raise
    finally:
        # Log only operational fields; questions, passages and credentials stay out of logs.
        if "response" in locals():
            status = response.status_code
        failed = status >= 400
        event = {"severity": "ERROR" if failed else "INFO", "service": "rag-service",
                 "event": context.get("failure_event", "rag_failed") if failed else "rag_completed" if request.url.path in ("/chat", "/query") else "request_completed",
                 "message": "RAG request failed" if failed else "RAG request completed", "request_id": request_id,
                 "trace_id": None, "http_method": request.method, "http_path": request.url.path, "status_code": status,
                 "latency_ms": round((time.perf_counter() - started) * 1000, 2),
                 **{k: context[k] for k in ("retrieved_chunk_count", "generator_model", "error_type") if k in context}}
        trace_id = request.headers.get("x-cloud-trace-context", "").split("/")[0]
        if len(trace_id) == 32 and all(c in "0123456789abcdef" for c in trace_id.lower()) and gcp_project():
            event["trace_id"] = trace_id
            event["logging.googleapis.com/trace"] = f"projects/{gcp_project()}/traces/{trace_id}"
        try:
            print(json.dumps(event), flush=True)
        finally:
            request_context.reset(token)
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    try:
        return {"ready": True, "collection": COLLECTION, "count": collection_status(),
                "generator": generator_name()}
    except Exception as error:
        record_fields(failure_event="vector_db_unavailable", error_type=type(error).__name__)
        raise HTTPException(503, "RAG knowledge base is unavailable or incompatible") from error


def retrieve(request):
    # Disable long embedding retry loops in the web service only.
    return retrieval.retrieve(CHUNK_TYPE, request.question, request.n_results,
                              max_attempts=1, max_retries=0, online=True)


def run(request, generate=False):
    stage = "retrieval"
    try:
        results = retrieve(request)
        record_fields(retrieved_chunk_count=len(results["ids"][0]))
        stage = "generation"
        if generate:
            record_fields(generator_model=GENERATIVE_MODEL)
        answer = app.state.generator.generate(request.question, results) if generate else None
        return Result(question=request.question, sources=sources_from(results), answer=answer,
                      generator=generator_name() if generate else None)
    except Exception as error:
        record_fields(failure_event="generation_failed" if generate and stage == "generation" else "retrieval_failed",
                      error_type=type(error).__name__)
        raise HTTPException(503, "RAG could not complete the request. Please try again later.") from error


@app.post("/query", response_model=Result)
def query(request: Question):
    return run(request)


@app.post("/chat", response_model=Result)
def chat(request: Question):
    return run(request, generate=True)
