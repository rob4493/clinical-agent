"""
Integration test for GET /health.

Uses FastAPI's TestClient with no external services required.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import createApp


def makeTestClient() -> TestClient:
    """Return a TestClient using a minimal Settings override (no real credentials)."""
    settings = Settings(
        watsonxApiKey="test",
        adminApiKey="test-admin",
        debug=False,
    )
    app = createApp(settings=settings)
    return TestClient(app)


class TestHealthEndpoint:
    def testHealthReturns200(self) -> None:
        client = makeTestClient()
        response = client.get("/health")
        assert response.status_code == 200

    def testHealthResponseHasStatusOk(self) -> None:
        client = makeTestClient()
        data = client.get("/health").json()
        assert data["status"] == "ok"

    def testHealthResponseHasVersion(self) -> None:
        client = makeTestClient()
        data = client.get("/health").json()
        assert "version" in data
        assert isinstance(data["version"], str)
        assert len(data["version"]) > 0

    def testHealthDoesNotExposeCredentials(self) -> None:
        """Health response must never contain API keys or secrets."""
        client = makeTestClient()
        body = client.get("/health").text
        assert "test" not in body
        # More specifically: neither the watsonx key nor admin key should appear.
        assert "test-admin" not in body
