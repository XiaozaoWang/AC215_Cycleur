"""Request-local operational metadata; never include questions or generated text."""
from contextvars import ContextVar
import json

request_context = ContextVar("rag_request_context", default=None)


def log_event(event, message, severity="INFO", **fields):
    context = request_context.get() or {}
    print(json.dumps({"severity": severity, "message": message, "service": "rag-service", "event": event,
                      "request_id": context.get("request_id"), "trace_id": context.get("trace_id"), **fields}), flush=True)


def record_fields(**fields):
    context = request_context.get()
    if context is not None:
        context.update(fields)
