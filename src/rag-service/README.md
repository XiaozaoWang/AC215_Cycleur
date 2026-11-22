# GreenPath RAG

Self-contained cycling knowledge service. HTTP paths, request/response contracts,
model names, 256-dimensional embeddings, collection names and chunking remain
unchanged. No agent orchestrator or cloud deployment tool is included.

## Layout

```text
rag-service/
  cli.py                 # pipeline/command entry point
  rag/
    __init__.py
    service.py
    settings.py
    schemas.py
    retrieval.py
    generators.py
    indexing.py
    agent_tools.py
  tests/
  Dockerfile
  docker-*.sh
  pyproject.toml
  uv.lock
  README.md
  .dockerignore
```

Implementation modules live in the `rag` package. Run commands from the service
root; the HTTP import target is `rag.service:app`. Root `cli.py` remains the only
Python pipeline entry point. Runtime knowledge data stays in its existing paths.

## Files and responsibilities

| File | Structure and purpose |
| --- | --- |
| Dockerfile | Shared locked dependencies, then development, rag and chroma targets. One file builds both cloud containers. |
| docker-entrypoint.sh | Explicit commands use exec; development starts reload, production starts API, chroma restores stored vectors and starts Chroma. |
| docker-shell.sh | Finds its own directory, builds development image, starts dependent Chroma and opens a shell or runs supplied command. |
| ../../docker-compose.yml | Repository-wide service definitions, including rag-api and chromadb; code/credential mounts, connectivity and persistent storage. |
| docker-build-push.sh | Only build/upload entry; project, region, version and optional --no-push; builds both images without deploying endpoints. |
| cli.py | Argument parsing and dispatch for chunk/embed/load/query/chat, archive packaging and explicit cloud Chroma startup. |
| rag/service.py | FastAPI health/ready/query/chat endpoints, lifecycle, request deadlines and operational logging. |
| rag/agent_tools.py | Google GenAI declaration, validated evidence search, dispatcher and SDK FunctionResponses; no intermediate answer. |
| rag/settings.py | Shared environment configuration, models, chunking constants and collection names. |
| rag/schemas.py | Validated questions, HTTP results and complete source evidence schemas. |
| rag/retrieval.py | Read-only HTTP Chroma access, collection compatibility checks, query embeddings and passage retrieval. |
| rag/generators.py | Evidence-grounded answers and generator selection; fine-tuned mode remains unsupported. |
| rag/indexing.py | Markdown/front matter, checksums/manifests, chunk/embed/load, lazy model clients, retry policies, deterministic archive packaging and verified restoration. |
| pyproject.toml | Existing dependencies, development test group and pytest settings. |
| uv.lock | Existing exact dependency versions, consumed with --frozen; no upgrades. |
| tests/ | Offline tests using synthetic temporary indexes, mocked models, shell executables and error paths; optional full-stack test. |
| README.md | Operating instructions and responsibility map. |
| .dockerignore | Excludes credentials, knowledge data, archives, databases, virtual environments and caches from image build contexts. |

## Cloud endpoint versus local operation

Cloud callers only need RAG_SERVICE_URL and a Google ID token; they do not need
local Chroma or knowledge loading. The last recorded endpoint is
https://greenpath-rag-service-nahb4gvswq-uc.a.run.app (not verified by this refactor).
For a service-account caller, obtain an ID token with audience equal to that URL:

```python
from google.auth.transport.requests import Request
from google.oauth2.id_token import fetch_id_token
headers = {"Authorization": "Bearer " + fetch_id_token(Request(), rag_service_url)}
```

The identity needs roles/run.invoker. Use attached identity/ADC, never bake keys
into images. POST /query or /chat with {"question":"How should I prepare?","n_results":5}.
Questions are trimmed, nonblank and at most 2000 characters; n_results is integer
1-10, default 5; extra fields are rejected. Results contain question, sources
(chunk_id, text, distance, metadata), answer and generator. /query leaves the last
two null; /chat returns a generated answer. /health is process health; /ready
checks existing collection metadata/count without model calls. Missing knowledge
returns 503. Root Compose accepts RAG_SERVICE_URL; cloud callers can start only
`docker compose up api-service frontend`.

## Local development

From the repository root, with Docker Compose and a Bash:

```sh
docker compose --env-file .env up --build rag-api chromadb
bash src/rag-service/docker-shell.sh
# Or retain the full application workflow:
docker compose up --build
```

The shell script works from any caller directory and accepts explicit commands.
Compose exposes RAG at localhost:8001, uses chromadb:8000 internally, and preserves
the existing docker-volumes/chromadb storage. It mounts source at /app and
credentials read-only under /secrets. SECRETS_DIR overrides the host credential
folder; GOOGLE_APPLICATION_CREDENTIALS_CONTAINER overrides the container filename.
ADC may instead be mounted read-only with a Compose override. RAG_MODE controls
container startup; PORT defaults to 8001. Ordinary local startup never loads,
replaces or rebuilds knowledge; an empty database is not ready.

Compose maps RAG_GCP_PROJECT, RAG_GCP_LOCATION, RAG_GENERATIVE_MODEL to Python's
GCP_PROJECT, GCP_LOCATION, GENERATIVE_MODEL. Other settings include RAG_GENERATOR,
RAG_CHUNK_TYPE, RAG_CLOUD_TIMEOUT_MS, CHROMADB_HOST/PORT/SSL. Python never reads .env.

## CLI and existing knowledge

Inside the development shell, or from this folder after `uv sync --frozen`:

```sh
python cli.py --chunk --chunk_type markdown-split
python cli.py --embed --chunk_type markdown-split  # paid document embeddings
python cli.py --load --chunk_type markdown-split   # stored vectors only
python cli.py --query --question "How should I prepare?" --n_results 3
python cli.py --chat --question "How should I prepare?"
python cli.py --package-index --source /path/to/release --archive /path/to/new-index.tar.gz
```

char-split and recursive-split remain supported. Use one chunk_type consistently.
Loading validates document/chunk/vector checksums and embedding compatibility,
then upserts existing vectors; it can update matching IDs. --replace explicitly
rebuilds a collection after validation and is never automatic.

If a trusted index archive already exists, verify its published SHA256 and extract
it into a new empty staging directory; run `python /app/cli.py --load` there with
PYTHONPATH=/app inside the development container. Mount the archive read-only.
Do not run --embed again for an existing release. Never load test data into the
real database. Source URLs, scope, checksums and license metadata are preserved.
Packaging is local-only, deterministic, validates stored files and refuses an
existing destination. Publish new immutable archive versions separately through
your release process; this repository workflow does not upload knowledge data.

## Agent entry point

```python
from rag.agent_tools import execute_tool, cycling_knowledge_tool
result = execute_tool("search_cycling_knowledge", {"question": "How should I prepare?"})
```

Pass tools=[cycling_knowledge_tool] to a future Google GenAI caller. Use
execute_function_calls for SDK calls/FunctionResponse Parts, including call IDs.
Results preserve full passages, IDs, distances and metadata. Errors are structured.
Inject retriever(method, question, n_results) for offline use or future adapters.
The default tool calls only a query embedding model and never generates an answer.

## Build/upload and Chroma restoration

From the repository root:

```sh
bash src/rag-service/docker-build-push.sh --project PROJECT --region us-central1 --version v2 --no-push
# Remove --no-push only when intentionally uploading both images.
```

This builds Dockerfile targets rag and chroma, tagged greenpath-rag-service and
greenpath-rag-chroma in the selected Artifact Registry repository. Authenticate
Docker separately. RAG_GCP_PROJECT (or GOOGLE_CLOUD_PROJECT/GCP_PROJECT),
GOOGLE_CLOUD_LOCATION and APP_IMAGE_TAG also supply defaults.
There is no Cloud Build YAML, independent Chroma Dockerfile or deployment automation.
No shared deployment files are changed by this cleanup.

The chroma target sets RAG_MODE=chroma. Its entry point calls cli.py --serve-chroma,
which restores a release before exec-ing the Chroma process. Supply RAG_INDEX_URI
(gs://bucket/object), RAG_INDEX_SHA256 and RAG_EXPECTED_COUNT; runtime identity
must already have object-read access. RAG_DATABASE_ROOT defaults to /data and
CHROMA_PORT to 8000. Restoration verifies archive and manifest checksums, rejects
unsafe entries, checks model/dimension/count and loads existing vectors without
embedding documents. Only explicitly selecting chroma mode performs this restore;
it is intended for disposable cloud instance storage, not an existing local DB.
A two-container runtime should start Chroma before RAG and set the API's
CHROMADB_HOST=127.0.0.1. Updating Cloud Run itself is outside this service's scripts.

## Offline verification and costs

```sh
uv run --frozen pytest -q
# Self-contained Linux test image using the same Dockerfile:
docker build --target development -t rag-tests .
docker run --rm --network none rag-tests python -m pytest -q
```

Default tests use temporary synthetic data and mocked cloud calls. POSIX execution
tests skip on Windows. The optional RAG_STACK_CHECK=1 test requires an existing
Chroma/frontend stack, reads stored vectors and mocks paid models; it is not run
by default. Chunking, stored-vector loading, packaging, restoration and health
checks do not call paid models. Embedding documents, queries, agent searches and
chat do. Image uploads and cloud runtime can incur infrastructure costs.

The three Docker scripts follow api-service conventions: Bash, set -e, named
variables, environment activation, and Uvicorn helper functions. Invoke them with
`bash`, not `sh`. The build script keeps explicit project/region/version flags and
--no-push. The shell script uses Compose to reuse the existing Chroma and mount
configuration; it uses the root docker-compose.yml; there is no service-local Compose file.
