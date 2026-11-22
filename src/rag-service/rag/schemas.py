"""Stable HTTP and tool evidence contracts."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    n_results: int = Field(default=5, ge=1, le=10, strict=True)


class Source(BaseModel):
    chunk_id: str
    text: str
    distance: float | None
    metadata: dict


class Result(BaseModel):
    question: str
    sources: list[Source]
    answer: str | None = None
    generator: Literal["base", "finetuned"] | None = None


def sources_from(results):
    return [Source(chunk_id=chunk_id, text=document or "", metadata=metadata or {}, distance=distance)
            for chunk_id, document, metadata, distance in zip(
                results["ids"][0], results["documents"][0],
                results["metadatas"][0], results["distances"][0])]
