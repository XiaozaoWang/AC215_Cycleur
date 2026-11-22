"""Markdown indexing and validated loading of stored document embeddings."""

import gzip
import hashlib
import io
import json
import math
import os
import re
import sys
import tarfile
import time
from pathlib import Path, PureWindowsPath
from urllib.parse import quote, urlparse

import chromadb
import google.auth
import yaml
from google import genai
from google.auth.transport.requests import AuthorizedSession
from google.genai import types, errors
from langchain_text_splitters import CharacterTextSplitter, RecursiveCharacterTextSplitter, MarkdownHeaderTextSplitter

from rag.settings import (
    INPUT_FOLDER, OUTPUT_FOLDER, META_KEYS, HEADERS, CHUNK_SIZE, CHUNK_OVERLAP,
    EMBEDDING_MODEL, EMBEDDING_DIMENSION, GCP_LOCATION, CLOUD_TIMEOUT_MS, gcp_project,
)


def read_md(path):
    text = Path(path).read_text(encoding="utf-8-sig")
    meta = {}
    match = re.match(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|$)", text, re.S)
    if text.startswith("---") and not match:
        raise ValueError(f"{path}: unclosed YAML front matter")
    if match:
        meta = yaml.safe_load(match.group(1)) or {}
        if not isinstance(meta, dict):
            raise ValueError(f"{path}: YAML front matter must be a mapping")
        text = text[match.end():]
    meta = {k: (",".join(map(str, meta[k])) if isinstance(meta[k], list)
                else str(meta[k])) for k in META_KEYS if meta.get(k) is not None}
    meta["source_id"] = meta.get("source_id") or Path(path).stem
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    return meta, text.strip()


# Split the body into chunks, returns [(heading it belongs to, chunk text), ...]
def split_text(text, method):
    recursive = RecursiveCharacterTextSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)

    # Control group: hard cut at a fixed number of characters, ignores sentences and paragraphs
    if method == "char-split":
        splitter = CharacterTextSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP,
                                         separator="", strip_whitespace=False)
        return [("", c) for c in splitter.split_text(text)]

    # Split by paragraph first, if still too long then by newline, sentence, space
    if method == "recursive-split":
        return [("", c) for c in recursive.split_text(text)]

    # First split by # / ## / ### headings into sections, each chunk keeps its heading; if a section is too long, split it again with recursive
    # A file with no headings is one section, same result as recursive-split
    if method == "markdown-split":
        sections = MarkdownHeaderTextSplitter(HEADERS, strip_headers=False).split_text(text)
        out = []
        for s in sections:
            section = " > ".join(s.metadata[name].replace("**", "") for _, name in HEADERS if name in s.metadata)
            out += [(section, c) for c in recursive.split_text(s.page_content)]
        return out

    raise ValueError(f"unknown chunk_type: {method}")

def write_jsonl(path, rows):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
    temporary.replace(path)


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def safe_relative(name):
    """Read manifests made on Windows or Linux without allowing path traversal."""
    path = Path(name.replace("\\", "/"))
    if path.anchor or PureWindowsPath(name).drive or ".." in path.parts or not path.parts:
        raise ValueError("Unsafe manifest filename")
    return path


def manifest_path(method, output_folder=None):
    output_folder = OUTPUT_FOLDER if output_folder is None else output_folder
    return Path(output_folder) / f"manifest-{method}.json"


def save_manifest(method, manifest):
    path = manifest_path(method)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def checked_manifest(method, embedded=False, *, input_folder=None, output_folder=None):
    input_folder = INPUT_FOLDER if input_folder is None else input_folder
    output_folder = OUTPUT_FOLDER if output_folder is None else output_folder
    m = json.loads(manifest_path(method, output_folder).read_text(encoding="utf-8"))
    current = {p.relative_to(input_folder).as_posix(): digest(p)
               for p in sorted(Path(input_folder).rglob("*.md"))}
    if current != {safe_relative(name).as_posix(): checksum for name, checksum in m["inputs"].items()}:
        raise ValueError("Input files changed; run --chunk --embed again")
    for filename, checksum in m["chunks"].items():
        if digest(Path(output_folder) / safe_relative(filename)) != checksum:
            raise ValueError("Chunks changed; run --chunk --embed again")
    if embedded:
        if not m.get("embeddings"):
            raise ValueError("Run --embed before --load")
        if m["embedding_model"] != EMBEDDING_MODEL or m["embedding_dimension"] != EMBEDDING_DIMENSION:
            raise ValueError("Embedding configuration mismatch")
        for filename, checksum in m["embeddings"].items():
            if digest(Path(output_folder) / safe_relative(filename)) != checksum:
                raise ValueError("Embedding file changed; run --embed again")
    return m


def chunk(method):
    print("chunk()")
    Path(OUTPUT_FOLDER).mkdir(parents=True, exist_ok=True)
    files = sorted(Path(INPUT_FOLDER).rglob("*.md"))
    if not files:
        raise ValueError(f"No Markdown files in {INPUT_FOLDER}")
    # Check all inputs first, so a duplicate source_id can't overwrite another file.
    sources = [(p, *read_md(p)) for p in files]
    ids = [meta["source_id"] for _, meta, _ in sources]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate source_id; each document needs a unique source_id")
    manifest_path(method).unlink(missing_ok=True)
    manifest = {"inputs": {}, "chunks": {}, "chunk_type": method,
                "chunk_size": CHUNK_SIZE, "chunk_overlap": CHUNK_OVERLAP}
    lengths = []
    for path, meta, body in sources:
        rows = []
        for section, content in split_text(body, method):
            if not content.strip():
                continue
            i = len(rows)
            prefix = hashlib.sha256(meta["source_id"].encode()).hexdigest()[:16]
            rows.append({"chunk": content, "section": section, **meta,
                         "source_file": str(path.relative_to(INPUT_FOLDER)),
                         "chunk_id": f"{prefix}-{i}", "chunk_index": i, "input_sha256": digest(path)})
        # File names use a hash, source_id is not used to build the path.
        filename = f"chunks-{method}-{hashlib.sha256(meta['source_id'].encode()).hexdigest()[:16]}.jsonl"
        target = Path(OUTPUT_FOLDER) / filename
        write_jsonl(target, rows)
        manifest["inputs"][str(path.relative_to(INPUT_FOLDER))] = digest(path)
        manifest["chunks"][filename] = digest(target)
        lengths.extend(len(r["chunk"]) for r in rows)
        print(f"{meta['source_id']}: {len(body)} chars -> {len(rows)} chunks")
    if not lengths:
        raise ValueError("All input documents are empty")
    manifest["total_chunks"] = len(lengths)
    manifest["length_min"] = min(lengths)
    manifest["length_max"] = max(lengths)
    manifest["length_mean"] = round(sum(lengths) / len(lengths), 1)
    save_manifest(method, manifest)
    print(f"[{method}] {len(files)} files, {len(lengths)} chunks; "
          f"length min/mean/max: {min(lengths)}/{manifest['length_mean']}/{max(lengths)}")


def embedding_text(row):
    return f"Title: {row.get('title', '')}\nSection: {row.get('section', '')}\n\n{row['chunk']}"


def embed(method):
    print("embed()")
    manifest = checked_manifest(method)
    manifest.pop("embeddings", None)
    save_manifest(method, manifest)  # if it stops halfway, --load can't pick up the previous round's results
    hashes = {}
    for filename in manifest["chunks"]:
        rows = read_jsonl(Path(OUTPUT_FOLDER) / filename)
        vectors = generate_embeddings([embedding_text(r) for r in rows], "RETRIEVAL_DOCUMENT")
        for row, vector in zip(rows, vectors):
            row["embedding"] = vector
        target = Path(OUTPUT_FOLDER) / filename.replace("chunks-", "embeddings-", 1)
        write_jsonl(target, rows)
        hashes[target.name] = digest(target)
        print(f"{target.name}: {len(rows)} embeddings")
    manifest.update(embeddings=hashes, embedding_model=EMBEDDING_MODEL,
                    embedding_dimension=EMBEDDING_DIMENSION)
    save_manifest(method, manifest)

def load(method, replace=False, client=None, *, input_folder=None, output_folder=None):
    output_folder = OUTPUT_FOLDER if output_folder is None else output_folder
    print("load()")
    manifest = checked_manifest(method, embedded=True, input_folder=input_folder, output_folder=output_folder)
    rows = [r for name in manifest["embeddings"] for r in read_jsonl(Path(output_folder) / safe_relative(name))]
    if not rows or len({r["chunk_id"] for r in rows}) != len(rows):
        raise ValueError("Empty dataset or duplicate chunk IDs")
    for row in rows:
        v = row["embedding"]
        if len(v) != EMBEDDING_DIMENSION or not all(math.isfinite(x) for x in v) or not any(v):
            raise ValueError("Invalid vector; existing collection has not been modified")
    owned = client is None
    client = client if client is not None else chroma_client()
    try:
        name = f"greenpath-docs-{method}"
        from chromadb.errors import NotFoundError
        try:
            existing = client.get_collection(name=name)
        except NotFoundError:
            existing = None
        if existing and replace:
            client.delete_collection(name=name)
            existing = None
        metadata = {"hnsw:space": "cosine", "embedding_model": EMBEDDING_MODEL,
                    "embedding_dimension": EMBEDDING_DIMENSION}
        if existing and any((existing.metadata or {}).get(k) != v for k, v in metadata.items()):
            raise ValueError("Existing collection settings differ; use --replace to rebuild")
        collection = existing if existing is not None else client.create_collection(name=name, metadata=metadata)
        batch_size = min(500, client.get_max_batch_size())
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            collection.upsert(
                ids=[r["chunk_id"] for r in batch],
                documents=[r["chunk"] for r in batch],
                embeddings=[r["embedding"] for r in batch],
                metadatas=[{k: v for k, v in r.items() if k not in ("chunk", "embedding", "chunk_id")} for r in batch],
            )
        print(f"Upserted {len(rows)} chunks into '{name}'; collection count={collection.count()}")
    finally:
        if owned:
            client.close()


# Lazy model clients and embedding execution.

_clients = {}


def llm_client(online=False):
    project = gcp_project()
    if not project:
        raise ValueError("Set GCP_PROJECT before --embed, --query or --chat")
    key = (project, online)
    if key in _clients:
        return _clients[key]
    options = {"http_options": types.HttpOptions(
        timeout=CLOUD_TIMEOUT_MS, retry_options=types.HttpRetryOptions(attempts=1)
    )} if online else {}
    _clients[key] = genai.Client(vertexai=True, project=project, location=GCP_LOCATION, **options)
    return _clients[key]


def close_online_clients():
    for key in list(_clients):
        if key[1]:
            _clients.pop(key).close()

def generate_embeddings(texts, task_type, max_retries=5, retry_delay=2, *, client=None):
    embeddings = []
    for text in texts:
        for attempt in range(max_retries + 1):
            try:
                response = (client if client is not None else llm_client()).models.embed_content(
                    model=EMBEDDING_MODEL, contents=text,
                    config=types.EmbedContentConfig(
                        output_dimensionality=EMBEDDING_DIMENSION,
                        task_type=task_type, auto_truncate=False),
                )
                if not response.embeddings or len(response.embeddings) != 1:
                    raise ValueError("Embedding API returned an unexpected number of vectors")
                vector = response.embeddings[0].values
                if len(vector) != EMBEDDING_DIMENSION or not all(math.isfinite(v) for v in vector):
                    raise ValueError("Invalid embedding dimension or non-finite values")
                norm = math.sqrt(sum(v * v for v in vector))
                if norm == 0:
                    raise ValueError("Zero embedding")
                embeddings.append([v / norm for v in vector])
                break
            except errors.APIError as e:
                if e.code not in (429, 500, 502, 503, 504) or attempt == max_retries:
                    raise
                wait = retry_delay * 2 ** attempt
                print(f"API error ({e.code}). Retrying in {wait}s ...")
                time.sleep(wait)
    return embeddings


def chroma_client(*args, **kwargs):
    from rag.retrieval import chroma_client as connect
    return connect(*args, **kwargs)


# Verified restoration of an existing knowledge release.




def download_index(uri, destination, expected_sha256):
    parsed = urlparse(uri)
    if parsed.scheme != "gs" or not parsed.netloc or not parsed.path.strip("/"):
        raise ValueError("RAG_INDEX_URI must identify a gs://bucket/object")
    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/devstorage.read_only"])
    url = "https://storage.googleapis.com/storage/v1/b/" + quote(parsed.netloc, safe="")
    url += "/o/" + quote(parsed.path.lstrip("/"), safe="") + "?alt=media"
    with AuthorizedSession(credentials) as session:
        response = session.get(url, timeout=60)
        response.raise_for_status()
        data = response.content
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError("GCS index archive checksum mismatch")
    Path(destination).write_bytes(data)


def restore_index(archive, release_dir, database_dir, expected_count):
    release_dir = Path(release_dir)
    release_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as package:
        members = package.getmembers()
        if sum(member.size for member in members) > 100 * 1024 * 1024:
            raise ValueError("Index archive exceeds the deployment size limit")
        for member in members:
            parts = Path(member.name).parts
            if (not member.isfile() or Path(member.name).is_absolute()
                    or ".." in parts or parts[0] not in ("outputs", "input-datasets")):
                raise ValueError("Unsafe or unexpected index archive entry")
        package.extractall(release_dir, filter="data")
    paths = {"input_folder": release_dir / "input-datasets", "output_folder": release_dir / "outputs"}
    manifest = checked_manifest("markdown-split", embedded=True, **paths)
    if manifest["total_chunks"] != expected_count:
        raise ValueError("Index release count does not match deployment configuration")
    client = chromadb.PersistentClient(path=str(database_dir))
    try:
        load("markdown-split", client=client, **paths)
        count = client.get_collection("greenpath-docs-markdown-split").count()
        if count != expected_count:
            raise ValueError("Restored database count does not match the index release")
        print(json.dumps({"severity": "INFO", "message": "index_restored", "count": count,
                          "embedding_model": EMBEDDING_MODEL,
                          "dimension": EMBEDDING_DIMENSION}), flush=True)
    finally:
        client.close()
    return count


def serve_chroma():
    root = Path(os.getenv("RAG_DATABASE_ROOT", "/data"))
    root.mkdir(parents=True, exist_ok=True)
    archive = root / "index-data.tar.gz"
    download_index(os.environ["RAG_INDEX_URI"], archive, os.environ["RAG_INDEX_SHA256"])
    restore_index(archive, root / "release", root / "chroma", int(os.environ["RAG_EXPECTED_COUNT"]))
    # A new interpreter/native process must open SQLite/HNSW after the loader closes it.
    executable = str(Path(sys.executable).with_name("chroma"))
    os.execv(executable, [executable, "run", "--path", str(root / "chroma"),
                         "--host", "0.0.0.0", "--port", os.getenv("CHROMA_PORT", "8000")])




# Deterministic packaging of stored vectors.


def package_index(source, archive):
    source, archive = Path(source), Path(archive)
    checked_manifest("markdown-split", embedded=True,
                     input_folder=source / "input-datasets", output_folder=source / "outputs")
    manifest_bytes = (source / "outputs/manifest-markdown-split.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    files = {"outputs/manifest-markdown-split.json": manifest_bytes}
    actual_inputs = {path.relative_to(source / "input-datasets").as_posix()
                     for path in (source / "input-datasets").rglob("*.md")}
    if actual_inputs != {safe_relative(name).as_posix() for name in manifest["inputs"]}:
        raise ValueError("Source documents do not match the index manifest")
    for group, folder in [("inputs", "input-datasets"), ("chunks", "outputs"), ("embeddings", "outputs")]:
        for name, expected in manifest[group].items():
            path = Path(folder) / safe_relative(name)
            content = (source / path).read_bytes()
            if hashlib.sha256(content).hexdigest() != expected:
                raise ValueError("Checksum mismatch: " + str(path))
            files[path.as_posix()] = content
    with archive.open("wb") as output, gzip.GzipFile(fileobj=output, mode="wb", filename="", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w") as package:
            for name, content in sorted(files.items()):
                member = tarfile.TarInfo(name)
                member.mode = 0o644
                member.size = len(content)
                package.addfile(member, io.BytesIO(content))
    return hashlib.sha256(archive.read_bytes()).hexdigest(), manifest
