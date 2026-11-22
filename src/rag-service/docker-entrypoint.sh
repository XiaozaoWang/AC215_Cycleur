#!/bin/bash

# Container startup, following the api-service entrypoint style.
set -e

echo "Container is running!!!"

# Activate the Python environment installed by uv.
source "${UV_PROJECT_ENVIRONMENT:-/.venv}/bin/activate"

# Development API: restart when code changes.
uvicorn_server() {
    exec uvicorn rag.service:app --host 0.0.0.0 --port "${PORT:-8001}" --reload "$@"
}

# Production API: forward shutdown signals directly to Uvicorn.
uvicorn_server_production() {
    exec uvicorn rag.service:app --host 0.0.0.0 --port "${PORT:-8001}" --lifespan on
}

export -f uvicorn_server
export -f uvicorn_server_production

# Explicit commands take priority, including Bash and CLI/test commands.
if [ "$#" -gt 0 ]; then
    exec "$@"
elif [ "${RAG_MODE:-production}" = "development" ]; then
    uvicorn_server
elif [ "${RAG_MODE:-production}" = "chroma" ]; then
    # Restore stored vectors, then start Chroma. No document embedding calls.
    exec python cli.py --serve-chroma
elif [ "${RAG_MODE:-production}" = "production" ]; then
    uvicorn_server_production
else
    echo "RAG_MODE must be development, production or chroma" >&2
    exit 2
fi
