"""Provider-neutral language generation; injected adapters never grant clinical approval."""

from typing import Protocol

from backend.app.models.analysis import ModelRequest


class LanguageProvider(Protocol):
    """Return an untrusted structured mapping; never log requests, drafts or exceptions."""
    def generate(self, request: ModelRequest) -> dict: ...
