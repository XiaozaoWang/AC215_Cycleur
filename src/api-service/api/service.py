"""FastAPI application: health check, browser access, and API routers."""
from fastapi import FastAPI
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware

from api.routers import rag, route, score, source
from api.logging import RequestLoggingMiddleware, record_fields

app = FastAPI(title="SmartPath API", description="Scenery preference parsing + tile scoring", version="v1")
# Retain browser access for local development; Cloud Run access is enforced by IAM.
app.add_middleware(CORSMiddleware, allow_credentials=False, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])
app.add_middleware(RequestLoggingMiddleware)


@app.exception_handler(HTTPException)
async def http_error(request, error):
    record_fields(error_type=type(error.__cause__ or error).__name__)
    return await http_exception_handler(request, error)


@app.exception_handler(RequestValidationError)
async def validation_error(request, error):
    record_fields(error_type=type(error).__name__)
    return await request_validation_exception_handler(request, error)


@app.get("/")
def get_index():
    return {"message": "Welcome to the SmartPath API Service"}


app.include_router(score.router)
app.include_router(source.router)
app.include_router(rag.router)
app.include_router(route.router)
