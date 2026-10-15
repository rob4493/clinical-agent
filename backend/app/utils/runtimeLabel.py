"""Plain ASGI mode labeling preserves the request's native disconnect channel."""

from starlette.datastructures import MutableHeaders


class RuntimeLabel:
    """Label every HTTP outcome without buffering or wrapping the receive callable."""
    def __init__(self, app, mode):
        self.app = app
        self.mode = mode

    async def __call__(self, scope, receive, send):
        async def label(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Clinical-Mode"] = self.mode
                headers["Cache-Control"] = "no-store"
            await send(message)
        await self.app(scope, receive, label if scope["type"] == "http" else send)
