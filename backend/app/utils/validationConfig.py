"""Request-local validation configuration; never share mutable app settings globally."""

from contextvars import ContextVar

from backend.app.config import Settings


ValidationSettings: ContextVar[Settings | None] = ContextVar("validationSettings", default=None)


class ValidationConfig:
    """Bind active app settings through validation, with cleanup even on failure."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        requestToken = ValidationSettings.set(scope["app"].state.settings)
        try:
            await self.app(scope, receive, send)
        finally:
            ValidationSettings.reset(requestToken)
