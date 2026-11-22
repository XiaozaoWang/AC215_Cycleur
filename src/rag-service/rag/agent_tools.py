"""Google GenAI tool declarations and evidence-only execution; no agent loop."""
from collections.abc import Mapping
from functools import partial

from google.genai import types
from pydantic import ValidationError

from rag.retrieval import retrieve
from rag.schemas import Question, sources_from
from rag.settings import CHUNK_TYPE


search_cycling_knowledge_func = types.FunctionDeclaration(
    name="search_cycling_knowledge",
    description=("Retrieve cycling knowledge passages and their source metadata. "
                 "Use these as evidence, preserving jurisdiction and scope; no answer is generated."),
    parameters={
        "type": "object",
        "properties": {
            "question": {"type": "string", "minLength": 1, "maxLength": 2000,
                         "description": "A cycling knowledge question or search sentence."},
            "n_results": {"type": "integer", "minimum": 1, "maximum": 10,
                          "description": "Maximum passages to retrieve (default 5)."},
        },
        "required": ["question"],
    },
)
cycling_knowledge_tool = types.Tool(function_declarations=[search_cycling_knowledge_func])


def search_cycling_knowledge(question, n_results=5, *, retriever=None):
    """Return passages, chunk IDs, distances and all source metadata.

    Inject a callable `(method, question, n_results) -> Chroma result` for offline
    use or a remote /query adapter. The default accesses Chroma and embeds only
    the query, with bounded online retries.
    """
    request = Question(question=question, n_results=n_results)
    retriever = retriever if retriever is not None else partial(
        retrieve, max_attempts=1, max_retries=0, online=True)
    results = retriever(CHUNK_TYPE, request.question, request.n_results)
    return {"question": request.question,
            "sources": [source.model_dump(mode="json") for source in sources_from(results)]}


def execute_tool(name, arguments, *, retriever=None):
    """Dispatch one call; validation and dependency errors become structured results."""
    if name != "search_cycling_knowledge":
        return {"error": {"code": "unknown_tool", "message": "Unknown cycling knowledge tool"}}
    try:
        if not isinstance(arguments, Mapping):
            return {"error": {"code": "invalid_arguments", "message": "Arguments must be an object"}}
        request = Question.model_validate(dict(arguments))
    except ValidationError:
        return {"error": {"code": "invalid_arguments",
                          "message": "Provide question (1-2000 characters) and optional n_results (integer 1-10) only"}}
    try:
        return search_cycling_knowledge(**request.model_dump(), retriever=retriever)
    except Exception:
        # Do not expose credentials, request text or dependency details to a model.
        return {"error": {"code": "retrieval_failed", "message": "Cycling knowledge is unavailable"}}


def execute_function_calls(function_calls, *, retriever=None):
    """Adapt SDK FunctionCalls into Parts for a future caller's next model turn."""
    parts = []
    for call in function_calls:
        result = execute_tool(call.name, call.args, retriever=retriever)
        response = types.FunctionResponse(name=call.name or "unknown_tool", response=result, id=call.id)
        parts.append(types.Part(function_response=response))
    return parts
