"""Answer generation is independent of retrieval and the public API schema."""
from typing import Protocol

from rag.indexing import llm_client
from google.genai import types
from rag.settings import GENERATIVE_MODEL, CHAT_SYSTEM_INSTRUCTION, generator_name


class AnswerGenerator(Protocol):
    def generate(self, question: str, results: dict) -> str: ...


class BaseGeminiGenerator:
    def __init__(self, online=False):
        self.online = online

    def generate(self, question: str, results: dict) -> str:
        return answer_from_results(question, results, client_factory=(lambda: llm_client(online=True)) if self.online else None)


class FineTunedGenerator:
    def __init__(self):
        raise NotImplementedError(
            "RAG_GENERATOR=finetuned is not implemented. Configure RAG_GENERATOR=base."
        )

    def generate(self, question: str, results: dict) -> str:
        raise NotImplementedError("Connect the future fine-tuned model endpoint here.")


def get_generator(online=False) -> AnswerGenerator:
    name = generator_name()
    if name == "base":
        return BaseGeminiGenerator(online=online)
    if name == "finetuned":
        return FineTunedGenerator()
    raise ValueError(f"Unknown RAG_GENERATOR: {name}")


def answer_from_results(question, results, *, client_factory=None):
    """Generate from already retrieved evidence, shared by CLI and API generators."""
    passages = []
    for document, metadata in zip(results["documents"][0], results["metadatas"][0]):
        if not document or not document.strip():
            continue
        metadata = metadata or {}
        # Keep source scope available to the model without requiring displayed citations.
        context = "\n".join(
            f"{key}: {metadata[key]}"
            for key in ("title", "section", "region", "jurisdiction", "scope_note")
            if metadata.get(key)
        )
        passages.append(f"{context}\n{document}".strip())
    if not passages:
        return "The knowledge base did not return enough information to answer this question."
    context = "\n\n---\n\n".join(passages)
    prompt = f"Question:\n{question}\n\nReference passages:\n{context}"
    response = (client_factory() if client_factory is not None else llm_client()).models.generate_content(
        model=GENERATIVE_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=CHAT_SYSTEM_INSTRUCTION,
            temperature=0.3,
            max_output_tokens=1000,
        ),
    )
    if not response.text or not response.text.strip():
        raise RuntimeError("Gemini returned no answer text. Check model access or retry.")
    return response.text.strip()
