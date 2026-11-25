"""Request metadata and single-line operational logs; no payloads or credentials."""
import json
import time
import uuid
from contextvars import ContextVar

from starlette.datastructures import Headers, MutableHeaders

request_context = ContextVar("request_context", default=None)


def log_event(event, message, severity="INFO", **fields):
    context = request_context.get() or {}
    print(json.dumps({"severity": severity, "message": message, "service": "api-service",
                      "event": event, "request_id": context.get("request_id"),
                      "trace_id": context.get("trace_id"), **fields}), flush=True)


def record_fields(**fields):
    context = request_context.get()
    if context is not None:
        context.update(fields)


def downstream_headers():
    context = request_context.get() or {}
    return {"X-Request-ID": context["request_id"]} if context.get("request_id") else {}


class RequestLoggingMiddleware:
    """Wrap the complete ASGI response, including streamed bodies and their workers."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        trace_id = headers.get("x-cloud-trace-context", "").split("/")[0]
        if len(trace_id) != 32 or any(c not in "0123456789abcdef" for c in trace_id.lower()):
            trace_id = None
        context = {"request_id": headers.get("x-request-id") or uuid.uuid4().hex, "trace_id": trace_id}
        token = request_context.set(context)
        started, status = time.perf_counter(), 500

        async def send_response(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message)["X-Request-ID"] = context["request_id"]
            await send(message)

        try:
            await self.app(scope, receive, send_response)
        except Exception as error:
            context["error_type"] = type(error).__name__
            raise
        finally:
            try:
                failed = status >= 400 or "error_type" in context
                route = scope["path"] == "/route" or scope["path"].startswith("/route/")
                event = "route_failed" if route and failed else "route_completed" if route else "request_failed" if failed else "request_completed"
                fields = {k: context[k] for k in ("region", "cell_count", "model_batch_count", "route_count",
                                                 "used_fallback", "error_type", "stream_status_code") if k in context}
                log_event(event, "Route request completed" if route and not failed else "Request failed" if failed else "Request completed",
                          severity="ERROR" if failed else "INFO", http_method=scope["method"],
                          http_path=scope["path"], status_code=status,
                          latency_ms=round((time.perf_counter() - started) * 1000, 2), **fields)
            finally:
                request_context.reset(token)
