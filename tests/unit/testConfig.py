"""
Unit tests for backend/app/config.py (Settings model).

Tests confirm:
- Default values are populated correctly.
- Environment variable overrides are respected.
- Validators reject invalid port numbers and embedding dimensions.
- No real credentials or model identifiers appear as defaults.
- Model identifiers are NOT present in module config (validated by absence).
"""

from __future__ import annotations

import pytest

from backend.app.config import Settings, getSettings


# Default value tests

class TestSettingsDefaults:
    """Settings instantiated with no environment overrides."""

    def testWatsonxApiKeyDefaultIsEmpty(self) -> None:
        s = Settings()
        assert s.watsonxApiKey.get_secret_value() == "", (
            "Default API key must be empty. No credential should ship as a default."
        )

    def testWatsonxProjectIdDefaultIsEmpty(self) -> None:
        s = Settings()
        assert s.watsonxProjectId == ""

    def testWatsonxUrlDefaultIsUsSouth(self) -> None:
        s = Settings()
        assert s.watsonxUrl == "https://us-south.ml.cloud.ibm.com"

    def testLlmModelIdDefaultIsEmpty(self) -> None:
        """Model identifiers must not be hard-coded (plan Correction A)."""
        s = Settings()
        assert s.watsonxLlmModelId == "", (
            "LLM model ID must not have a hard-coded default (Correction A)."
        )

    def testEmbeddingModelIdDefaultIsEmpty(self) -> None:
        """Model identifiers must not be hard-coded (plan Correction A)."""
        s = Settings()
        assert s.watsonxEmbeddingModelId == "", (
            "Embedding model ID must not have a hard-coded default (Correction A)."
        )

    def testEmbeddingDimensionDefaultIsNone(self) -> None:
        """
        Dimension must default to None; never assume 384 or any other value.
        The embedding adapter determines the correct dimension at startup.
        """
        s = Settings()
        assert s.watsonxEmbeddingDimension is None, (
            "Embedding dimension must default to None (plan Sub-Task 1 correction 1)."
        )

    def testMilvusHostDefault(self) -> None:
        s = Settings()
        assert s.milvusHost == "localhost"

    def testMilvusPortDefault(self) -> None:
        s = Settings()
        assert s.milvusPort == 19530

    def testMilvusCollectionNameDefault(self) -> None:
        s = Settings()
        assert s.milvusCollectionName == "knowledge_chunks"

    def testAdminApiKeyDefaultIsEmpty(self) -> None:
        s = Settings()
        assert s.adminApiKey.get_secret_value() == "", (
            "Admin API key must not have a hard-coded default."
        )

    def testAuditLogPathDefault(self) -> None:
        s = Settings()
        assert s.auditLogPath == "audit.jsonl"

    def testPiiFilterEnabledDefaultIsTrue(self) -> None:
        s = Settings()
        assert s.piiFilterEnabled is True, (
            "PII safeguard filter must default to enabled."
        )

    def testDebugDefaultIsFalse(self) -> None:
        s = Settings()
        assert s.debug is False, (
            "DEBUG must default to False. Never ship in debug mode."
        )


# Environment override tests

class TestSettingsOverrides:
    """Settings instantiated with explicit keyword overrides (simulates env vars)."""

    def testWatsonxApiKeyOverride(self) -> None:
        s = Settings(watsonxApiKey="test-key-value")
        assert s.watsonxApiKey.get_secret_value() == "test-key-value"

    def testLlmModelIdOverride(self) -> None:
        s = Settings(watsonxLlmModelId="some-model-id")
        assert s.watsonxLlmModelId == "some-model-id"

    def testEmbeddingModelIdOverride(self) -> None:
        s = Settings(watsonxEmbeddingModelId="some-embedding-model-id")
        assert s.watsonxEmbeddingModelId == "some-embedding-model-id"

    def testMilvusHostOverride(self) -> None:
        s = Settings(milvusHost="milvus-service")
        assert s.milvusHost == "milvus-service"

    def testEmbeddingDimensionOverrideInteger(self) -> None:
        s = Settings(watsonxEmbeddingDimension=768)
        assert s.watsonxEmbeddingDimension == 768

    def testEmbeddingDimensionOverrideNoneExplicit(self) -> None:
        s = Settings(watsonxEmbeddingDimension=None)
        assert s.watsonxEmbeddingDimension is None

    def testDebugOverride(self) -> None:
        s = Settings(debug=True)
        assert s.debug is True

    def testPiiFilterCanBeDisabled(self) -> None:
        s = Settings(piiFilterEnabled=False)
        assert s.piiFilterEnabled is False

    def testAdminApiKeyOverride(self) -> None:
        s = Settings(adminApiKey="super-secret")
        assert s.adminApiKey.get_secret_value() == "super-secret"


# Validator tests

class TestSettingsValidators:
    """Pydantic validators reject invalid values."""

    def testMilvusPortZeroIsInvalid(self) -> None:
        with pytest.raises(Exception):
            Settings(milvusPort=0)

    def testMilvusPortAbove65535IsInvalid(self) -> None:
        with pytest.raises(Exception):
            Settings(milvusPort=65536)

    def testMilvusPortValidBoundaryLow(self) -> None:
        s = Settings(milvusPort=1)
        assert s.milvusPort == 1

    def testMilvusPortValidBoundaryHigh(self) -> None:
        s = Settings(milvusPort=65535)
        assert s.milvusPort == 65535

    def testEmbeddingDimensionZeroIsInvalid(self) -> None:
        with pytest.raises(Exception):
            Settings(watsonxEmbeddingDimension=0)

    def testEmbeddingDimensionNegativeIsInvalid(self) -> None:
        with pytest.raises(Exception):
            Settings(watsonxEmbeddingDimension=-1)

    def testEmbeddingDimensionOneIsValid(self) -> None:
        s = Settings(watsonxEmbeddingDimension=1)
        assert s.watsonxEmbeddingDimension == 1

    def testEmbeddingDimensionNonePassesValidator(self) -> None:
        """None is the expected default; validator must accept it."""
        s = Settings(watsonxEmbeddingDimension=None)
        assert s.watsonxEmbeddingDimension is None

    def testEmbeddingDimensionEmptyStringBecomesNone(self) -> None:
        """
        Empty string arriving from an unset env var must be treated as None.
        Validator is tested directly because pydantic-settings coerces env values
        before field assignment.
        """
        result = Settings.validateEmbeddingDimension.__func__(  # type: ignore[attr-defined]
            Settings, ""
        )
        assert result is None


# getSettings() factory test

class TestGetSettings:
    def testReturnsSettingsInstance(self) -> None:
        s = getSettings()
        assert isinstance(s, Settings)

    def testTwoCallsReturnIndependentInstances(self) -> None:
        """getSettings() must not cache; each call reads fresh from env."""
        s1 = getSettings()
        s2 = getSettings()
        # They should be equal in value (same env) but independent objects.
        assert s1.milvusHost == s2.milvusHost
        assert s1 is not s2


# Model identifier isolation test

class TestModelIdentifierIsolation:
    """
    Plan Correction A: LLM and embedding model IDs must be in Settings only.
    This test confirms no hard-coded model ID exists in Settings defaults.
    """

    def testNoModelIdInLlmDefault(self) -> None:
        s = Settings()
        assert "/" not in s.watsonxLlmModelId, (
            "Default LLM model ID must not contain a real model path."
        )

    def testNoModelIdInEmbeddingDefault(self) -> None:
        s = Settings()
        assert "/" not in s.watsonxEmbeddingModelId, (
            "Default embedding model ID must not contain a real model path."
        )


# Sensitive value redaction tests

class TestSensitiveValueRedaction:
    """
    Confirm that sensitive values never appear in validation error messages,
    repr strings, or health-related model outputs.
    """

    def testSettingsReprDoesNotContainApiKey(self) -> None:
        secretText = "synthetic-secret-key-12345"
        settings = Settings(watsonxApiKey=secretText, adminApiKey=secretText)
        assert secretText not in repr(settings)
        assert secretText not in str(settings)
        assert secretText not in str(settings.model_dump())
        assert secretText not in settings.model_dump_json()

    def testInvalidPortErrorDoesNotContainAdminKey(self) -> None:
        """Validation error messages must not echo unrelated sensitive fields."""
        from pydantic import ValidationError
        adminKey = "top-secret-admin-key-xyz"
        with pytest.raises(ValueError) as caught:
            Settings(adminApiKey=adminKey, milvusPort=0)
        assert adminKey not in str(caught.value)
        assert adminKey not in repr(caught.value)

    def testHealthResponseFieldsAreOnlyStatusAndVersion(self) -> None:
        """Health endpoint must return only non-sensitive liveness fields."""
        from fastapi.testclient import TestClient
        from backend.app.main import createApp
        s = Settings(watsonxApiKey="leak-check-key", adminApiKey="leak-admin-key")
        app = createApp(settings=s)
        client = TestClient(app)
        data = client.get("/health").json()
        assert set(data.keys()) == {"status", "version"}, (
            f"Health response must contain only 'status' and 'version'. Got: {set(data.keys())}"
        )
        assert "leak-check-key" not in str(data)
        assert "leak-admin-key" not in str(data)
