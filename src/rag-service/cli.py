"""Argument parsing and dispatch for the GreenPath knowledge service."""
import argparse
import json
from pathlib import Path
from rag.indexing import package_index, serve_chroma
from rag.indexing import chunk, embed, load
from rag.retrieval import query, retrieve
from rag.generators import answer_from_results
from rag.settings import CHUNK_TYPE, CHUNK_TYPES


def chat(method, question, n_results=5):
    return answer_from_results(question, retrieve(method, question, n_results))


def main(args=None):
    if getattr(args, "serve_chroma", False):
        serve_chroma()
        return
    if getattr(args, "package_index", False):
        if args.archive is None or args.archive.exists():
            raise ValueError("Choose a new --archive path; existing archives are never overwritten")
        checksum, manifest = package_index(args.source, args.archive)
        print(json.dumps({"sha256": checksum, "count": manifest["total_chunks"]}))
        return
    print("CLI Arguments:", args)

    if not any((args.chunk, args.embed, args.load, args.query, args.chat)):
        raise ValueError("Choose --chunk, --embed, --load, --query or --chat; see --help")
    if args.replace and not args.load:
        raise ValueError("--replace requires --load")

    if args.chunk:
        chunk(args.chunk_type)

    if args.embed:
        embed(args.chunk_type)

    if args.load:
        load(args.chunk_type, replace=args.replace)

    if args.query:
        query(args.chunk_type, args.question, args.n_results)
    if args.chat:
        print(chat(args.chunk_type, args.question, args.n_results))


if __name__ == "__main__":
    # Run python cli.py --help to see the flags below
    parser = argparse.ArgumentParser(description="GreenPath vector-db CLI")

    parser.add_argument("--serve-chroma", action="store_true", help="Restore stored vectors and start cloud Chroma")
    parser.add_argument("--package-index", action="store_true", help="Package an existing index without embedding")
    parser.add_argument("--source", type=Path, default=Path.cwd())
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--chunk", action="store_true", help="Split source documents into chunks")
    parser.add_argument("--embed", action="store_true", help="Generate document embeddings")
    parser.add_argument("--load", action="store_true", help="Load stored embeddings into ChromaDB")
    parser.add_argument("--replace", action="store_true", help="After validation, delete and rebuild the collection; use when documents have changed or been removed")
    parser.add_argument("--query", action="store_true", help="Retrieve relevant passages")
    parser.add_argument("--chat", action="store_true", help="Generate an answer from retrieved passages")
    parser.add_argument("--n_results", type=int, default=5, help="Number of passages to retrieve")
    parser.add_argument("--chunk_type", default=CHUNK_TYPE, choices=CHUNK_TYPES)
    parser.add_argument("--question", default="Can I ride a bike on the sidewalk in Massachusetts?")

    args = parser.parse_args()
    if args.n_results < 1:
        parser.error("--n_results must be at least 1")

    main(args)
