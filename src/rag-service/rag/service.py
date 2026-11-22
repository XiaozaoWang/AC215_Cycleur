"""Independent RAG API. Startup/readiness never embed or call Gemini."""
import asyncio
import logging
import json
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from starlette.responses import JSONResponse

from rag.generators import get_generator
from rag.indexing import close_online_clients
from rag.settings import CHUNK_TYPE, COLLECTION, generator_name, gcp_project
from rag.schemas import Question, Result, sources_from
from rag import retrieval
logger = logging.getLogger(__name__)

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
    request_id = uuid.uuid4().hex
    status = 500
    try:
        # Keep a stuck optional dependency from holding the HTTP response open.
        async with asyncio.timeout(4 if request.url.path == "/ready" else 45):
            response = await call_next(request)
    except TimeoutError:
        response = JSONResponse({"detail": "RAG request timed out"}, status_code=504)
    finally:
        # Log only operational fields; questions, passages and credentials stay out of logs.
        if "response" in locals():
            status = response.status_code
        event = {"severity": "ERROR" if status >= 500 else "WARNING" if status >= 400 else "INFO",
                 "message": "rag_request", "request_id": request_id,
                 "method": request.method, "path": request.url.path, "status": status,
                 "duration_ms": round((time.perf_counter() - started) * 1000, 2)}
        trace_id = request.headers.get("x-cloud-trace-context", "").split("/")[0]
        if len(trace_id) == 32 and all(c in "0123456789abcdef" for c in trace_id.lower()) and gcp_project():
            event["logging.googleapis.com/trace"] = f"projects/{gcp_project()}/traces/{trace_id}"
        print(json.dumps(event), flush=True)
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
        logger.warning("RAG readiness failed: %s", error)
        raise HTTPException(503, "RAG knowledge base is unavailable or incompatible") from error


def retrieve(request):
    # Disable long embedding retry loops in the web service only.
    return retrieval.retrieve(CHUNK_TYPE, request.question, request.n_results,
                              max_attempts=1, max_retries=0, online=True)


def run(request, generate=False):
    try:
        results = retrieve(request)
        answer = app.state.generator.generate(request.question, results) if generate else None
        return Result(question=request.question, sources=sources_from(results), answer=answer,
                      generator=generator_name() if generate else None)
    except Exception as error:
        logger.exception("RAG request failed")
        raise HTTPException(503, "RAG could not complete the request. Please try again later.") from error


@app.post("/query", response_model=Result)
def query(request: Question):
    return run(request)


@app.post("/chat", response_model=Result)
def chat(request: Question):
    return run(request, generate=True)
