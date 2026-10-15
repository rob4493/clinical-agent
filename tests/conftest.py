"""
Shared pytest configuration and fixtures.

Fixtures defined here are available to all test modules.
No patient data, real credentials, or KB content is placed in this file.
"""

from __future__ import annotations

import pytest

from backend.app.config import Settings
from backend.app.main import createApp
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def minimalSettings() -> Settings:
    """
    Minimal Settings instance suitable for unit and integration tests.
    All credentials are placeholder strings with no real values.
    """
    return Settings(
        watsonxApiKey="test-api-key",
        watsonxProjectId="test-project-id",
        watsonxLlmModelId="test-llm-model",
        watsonxEmbeddingModelId="test-embedding-model",
        watsonxEmbeddingDimension=384,
        milvusHost="localhost",
        milvusPort=19530,
        adminApiKey="test-admin-key",
        auditLogPath="testAudit.jsonl",
        piiFilterEnabled=True,
        debug=False,
    )


@pytest.fixture(scope="session")
def testClient(minimalSettings: Settings) -> TestClient:
    """
    FastAPI TestClient backed by the minimal Settings fixture.
    No external services are contacted.
    """
    app = createApp(settings=minimalSettings)
    return TestClient(app)
