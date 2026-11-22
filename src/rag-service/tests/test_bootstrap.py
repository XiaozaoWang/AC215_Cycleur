"""Check immutable-release restoration without cloud calls or new embeddings."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
from unittest.mock import patch, Mock

import chromadb
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rag import indexing as bootstrap
from rag import indexing as cli
def release(tmp_path, tamper=False):
    md = b"# Safety\nCheck brakes."
    row = {"chunk_id": "test-1", "source_id": "TEST", "chunk": "Check brakes."}
    chunk = (json.dumps(row) + "\n").encode()
    embedded = (json.dumps(dict(row, embedding=[1 / 16] * 256)) + "\n").encode()
    digest = lambda data: hashlib.sha256(data).hexdigest()
    manifest = {"inputs": {"source.md": digest(md)}, "chunks": {"chunks.jsonl": digest(chunk)},
                "embeddings": {"embeddings.jsonl": digest(embedded)}, "total_chunks": 1,
                "embedding_model": cli.EMBEDDING_MODEL, "embedding_dimension": 256}
    files = {"input-datasets/source.md": md, "outputs/chunks.jsonl": chunk,
             "outputs/embeddings.jsonl": embedded + (b"\n" if tamper else b""),
             "outputs/manifest-markdown-split.json": json.dumps(manifest).encode()}
    archive = tmp_path / "index.tar.gz"
    with tarfile.open(archive, "w:gz") as package:
        for name, data in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            package.addfile(member, io.BytesIO(data))
    return archive


def test_restored_release_survives_reopen_without_embeddings(tmp_path, monkeypatch):
    original_paths = (cli.INPUT_FOLDER, cli.OUTPUT_FOLDER)
    archive = release(tmp_path)
    database = tmp_path / "database"
    with patch.object(cli, "generate_embeddings") as embed:
        assert bootstrap.restore_index(archive, tmp_path / "release", database, 1) == 1
    embed.assert_not_called()
    assert (cli.INPUT_FOLDER, cli.OUTPUT_FOLDER) == original_paths
    reopened = chromadb.PersistentClient(path=str(database))
    try:
        assert reopened.get_collection("greenpath-docs-markdown-split").count() == 1
    finally:
        reopened.close()


def test_tampered_vectors_fail_before_creating_database(tmp_path, monkeypatch):
    with pytest.raises(ValueError, match="Embedding file changed"):
        bootstrap.restore_index(release(tmp_path, tamper=True), tmp_path / "release", tmp_path / "database", 1)
    assert not (tmp_path / "database").exists()


def test_wrong_release_count_fails_before_creating_database(tmp_path, monkeypatch):
    with pytest.raises(ValueError, match="release count"):
        bootstrap.restore_index(release(tmp_path), tmp_path / "release", tmp_path / "database", 398)
    assert not (tmp_path / "database").exists()


def test_unsafe_archive_is_rejected(tmp_path):
    archive = tmp_path / "unsafe.tar.gz"
    with tarfile.open(archive, "w:gz") as package:
        member = tarfile.TarInfo("../escape")
        member.size = 1
        package.addfile(member, io.BytesIO(b"x"))
    with pytest.raises(ValueError, match="Unsafe"):
        bootstrap.restore_index(archive, tmp_path / "release", tmp_path / "database", 1)
    assert not (tmp_path / "escape").exists()


def test_download_checks_archive_checksum_before_writing(tmp_path):
    destination = tmp_path / "archive.tar.gz"
    session = Mock()
    session.get.return_value.content = b"stored vectors"
    with patch.object(bootstrap.google.auth, "default", return_value=(Mock(), None)), patch.object(
            bootstrap, "AuthorizedSession") as factory:
        factory.return_value.__enter__.return_value = session
        with pytest.raises(ValueError, match="checksum"):
            bootstrap.download_index("gs://bucket/path/index.tar.gz", destination, "0" * 64)
        assert not destination.exists()
        checksum = hashlib.sha256(b"stored vectors").hexdigest()
        bootstrap.download_index("gs://bucket/path/index.tar.gz", destination, checksum)
    assert destination.read_bytes() == b"stored vectors"
    assert "path%2Findex.tar.gz?alt=media" in session.get.call_args.args[0]
