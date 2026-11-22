# Like model-service: install dependencies, copy code, then start through the entrypoint.
# One Dockerfile provides three targets: development, rag (cloud API), and chroma (cloud database).
FROM python:3.12-slim-bookworm AS base
# Use UTF-8 and immediate logs; keep the virtual environment outside /app so code mounts cannot hide dependencies.
ENV LANG=C.UTF-8
ENV PYTHONUNBUFFERED=1
ENV UV_LINK_MODE=copy
ENV UV_PROJECT_ENVIRONMENT=/.venv
ENV PATH="/.venv/bin:$PATH"
# Pin uv and create the app user; use root only for installation and directory permissions.
RUN pip install --no-cache-dir uv==0.12.10 && useradd -m -u 1000 app \
    && mkdir /app /.venv && chown app:app /app /.venv
USER app
WORKDIR /app
COPY --chown=app:app pyproject.toml uv.lock ./
# Install dependencies first to reuse the build cache; --frozen uses uv.lock and --no-dev excludes test dependencies.
RUN uv sync --frozen --no-dev
# Copy runtime code only. .dockerignore excludes credentials, source documents, archives, and local databases.
COPY --chown=app:app cli.py docker-entrypoint.sh ./
COPY --chown=app:app rag ./rag
ENTRYPOINT ["/bin/bash", "/app/docker-entrypoint.sh"]

# Local Compose and docker-shell.sh select this target, with test tools and automatic code reload.
FROM base AS development
RUN uv sync --frozen --group dev
COPY --chown=app:app tests ./tests
COPY --chown=app:app *.sh ./
ENV RAG_MODE=development

# Cloud database image: prepare /data and select the restore-then-start mode through RAG_MODE.
# The build does not download knowledge archives; restoration happens only when this container starts.
FROM base AS chroma
USER root
RUN mkdir -p /data && chown app:app /data
USER app
ENV RAG_MODE=chroma

# Cloud API image: excludes test dependencies and disables automatic reload.
# The final target is also the default when docker build is called without --target.
FROM base AS rag
ENV RAG_MODE=production
