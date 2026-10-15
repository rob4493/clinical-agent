"""
Centralised application configuration.

All credentials, model identifiers, and service URLs are loaded exclusively from
environment variables.  No default contains a real credential, model name, or
patient data.

Clinical module config files (config.json) must NOT contain model identifiers;
those live here only.
"""

from __future__ import annotations

import re
from typing import Literal
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict, SettingsError


class Settings(BaseSettings):
    """Load configuration; credentials require explicit extraction and are never serialized."""

    moduleRoot: Path = Field(default=Path(__file__).parent / "modules", validation_alias="MODULE_ROOT", repr=False, exclude=True)
    clinicalDemoMode: bool = Field(default=False, validation_alias="CLINICAL_DEMO_MODE")
    clinicalRuntimeMode: Literal["standard", "synthetic", "competition", "production"] = Field(default="standard", validation_alias="CLINICAL_RUNTIME_MODE")
    corsOrigins: list[str] = Field(default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"], validation_alias="CORS_ORIGINS", repr=False, exclude=True)

    @model_validator(mode="after")
    def validateRuntime(self):
        if type(self.clinicalDemoMode) is not bool or type(self.clinicalRuntimeMode) is not str or self.clinicalRuntimeMode not in {"standard", "synthetic", "competition", "production"}:
            raise ValueError("Invalid runtime configuration.")
        if self.clinicalDemoMode and self.clinicalRuntimeMode not in {"standard", "synthetic"}:
            raise ValueError("Invalid runtime configuration.")
        if self.clinicalRuntimeMode == "synthetic" and self.languageProvider != "disabled":
            raise ValueError("Invalid runtime configuration.")
        if self.clinicalRuntimeMode == "synthetic":
            self.clinicalDemoMode = True
        return self

    def runtimeMode(self) -> str:
        """Preserve the original exact demo opt-in without permitting mixed runtimes."""
        return "synthetic" if self.clinicalDemoMode else self.clinicalRuntimeMode

    @field_validator("clinicalDemoMode", mode="before")
    @classmethod
    def validateDemo(cls, optIn):
        # Environment strings must be exact; permissive boolean coercion cannot enable demo mode.
        if type(optIn) is bool:
            return optIn
        if optIn == "true":
            return True
        if optIn == "false":
            return False
        raise ValueError("Invalid demonstration configuration.")

    @field_validator("corsOrigins")
    @classmethod
    def validateOrigins(cls, origins):
        if len(origins) > 10 or len(origins) != len(set(origins)):
            raise ValueError("Invalid origin configuration.")
        for origin in origins:
            parsed = urlsplit(origin)
            if (parsed.scheme not in {"http", "https"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
                    or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
                    or any(character.isspace() for character in origin) or "\\" in origin
                    or parsed.port is None or not 1 <= parsed.port <= 65535
                    or origin != parsed.scheme + "://" + parsed.netloc):
                raise ValueError("Invalid origin configuration.")
        return origins

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        populate_by_name=True,
        hide_input_in_errors=True,
    )

    # IBM watsonx.ai
    languageProvider: Literal["disabled", "watsonx"] = Field(default="disabled", validation_alias="LANGUAGE_PROVIDER")
    watsonxSpaceId: str = Field(default="", validation_alias="WATSONX_SPACE_ID", repr=False, exclude=True)
    watsonxIamUrl: str = Field(default="", validation_alias="WATSONX_IAM_URL", repr=False, exclude=True)
    watsonxApiVersion: str = Field(default="", validation_alias="WATSONX_API_VERSION")
    watsonxTimeout: float = Field(default=10, gt=0, le=30, allow_inf_nan=False, validation_alias="WATSONX_TIMEOUT")
    watsonxDeadline: float = Field(default=30, gt=0, le=120, allow_inf_nan=False, validation_alias="WATSONX_DEADLINE")
    watsonxRetries: int = Field(default=0, ge=0, le=2, strict=True, validation_alias="WATSONX_RETRIES")
    watsonxMaxTokens: int = Field(default=1024, ge=1, le=4096, strict=True, validation_alias="WATSONX_MAX_TOKENS")
    watsonxTemperature: float = Field(default=0, ge=0, le=0.3, allow_inf_nan=False, validation_alias="WATSONX_TEMPERATURE")
    watsonxRefreshMargin: float = Field(default=60, ge=1, le=300, allow_inf_nan=False, validation_alias="WATSONX_REFRESH_MARGIN")

    @field_validator("watsonxRetries", "watsonxMaxTokens", mode="before")
    @classmethod
    def validateLanguageIntegers(cls, configured):
        if isinstance(configured, str) and configured.isascii() and configured.isdigit():
            return int(configured)
        return configured

    @field_validator("watsonxTimeout", "watsonxDeadline", "watsonxTemperature", "watsonxRefreshMargin", mode="before")
    @classmethod
    def validateLanguageNumbers(cls, configured):
        if isinstance(configured, bool):
            raise ValueError("Invalid language configuration.")
        return configured

    @model_validator(mode="after")
    def validateLanguage(self):
        from datetime import date
        from uuid import UUID
        if self.languageProvider != "watsonx":
            return self
        if (self.clinicalDemoMode or not self.watsonxApiKey.get_secret_value().strip()
                or "watsonxUrl" not in self.model_fields_set or not self.watsonxLlmModelId
                or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9./-]{0,199}", self.watsonxLlmModelId)
                or bool(self.watsonxProjectId) == bool(self.watsonxSpaceId)
                or self.watsonxTimeout > self.watsonxDeadline):
            raise ValueError("Invalid language configuration.")
        scopeId = self.watsonxProjectId or self.watsonxSpaceId
        if str(UUID(scopeId)) != scopeId or date.fromisoformat(self.watsonxApiVersion).isoformat() != self.watsonxApiVersion:
            raise ValueError("Invalid language configuration.")
        for endpoint in (self.watsonxUrl, self.watsonxIamUrl):
            parsed = urlsplit(endpoint)
            if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                    or parsed.port not in (None, 443) or parsed.query or parsed.fragment
                    or any(character.isspace() for character in endpoint) or "\\" in endpoint):
                raise ValueError("Invalid language configuration.")
        base = urlsplit(self.watsonxUrl)
        iam = urlsplit(self.watsonxIamUrl)
        if (base.path not in ("", "/") or not base.hostname.endswith((".ml.cloud.ibm.com", ".aws.wxai.ibm.com"))
                or iam.hostname != "iam.cloud.ibm.com" or iam.path != "/identity/token"):
            raise ValueError("Invalid language configuration.")
        return self

    watsonxApiKey: SecretStr = Field(
        repr=False, exclude=True,
        validation_alias="WATSONX_API_KEY",
        default="",
        description="IBM watsonx.ai API key.",
    )
    watsonxProjectId: str = Field(
        repr=False, exclude=True,
        validation_alias="WATSONX_PROJECT_ID",
        default="",
        description="IBM watsonx.ai project ID.",
    )
    watsonxUrl: str = Field(
        repr=False, exclude=True,
        validation_alias="WATSONX_URL",
        default="https://us-south.ml.cloud.ibm.com",
        description="IBM watsonx.ai endpoint URL.",
    )

    # Model identifiers (centralised here; never in module config.json)
    watsonxLlmModelId: str = Field(
        validation_alias="WATSONX_LLM_MODEL_ID",
        default="",
        description=(
            "Watsonx.ai foundation model ID used for response generation. "
            "Set via WATSONX_LLM_MODEL_ID environment variable."
        ),
    )
    watsonxEmbeddingModelId: str = Field(
        validation_alias="WATSONX_EMBEDDING_MODEL_ID",
        default="",
        description=(
            "Watsonx.ai embedding model ID used for vector encoding. "
            "Set via WATSONX_EMBEDDING_MODEL_ID environment variable."
        ),
    )
    watsonxEmbeddingDimension: int | None = Field(
        validation_alias="WATSONX_EMBEDDING_DIMENSION",
        default=None,
        description=(
            "Dimension of the embedding vectors produced by the configured model. "
            "Must match the Milvus collection schema. "
            "When None, the embedding adapter must determine and validate the dimension "
            "at startup before the Milvus collection is created. "
            "If the adapter cannot establish a valid dimension, retrieval component "
            "startup must fail with a clear configuration error."
        ),
    )

    # Milvus vector store
    milvusPrefix: str | None = Field(default=None, validation_alias="MILVUS_PREFIX", pattern=r"^[A-Za-z][A-Za-z0-9]{0,31}$", repr=False, exclude=True)
    milvusMetric: Literal["COSINE", "IP", "L2"] = Field(default="COSINE", validation_alias="MILVUS_METRIC")
    milvusIndexType: Literal["FLAT"] = Field(default="FLAT", validation_alias="MILVUS_INDEX_TYPE")
    milvusTimeout: float = Field(default=30.0, gt=0, le=120, allow_inf_nan=False, validation_alias="MILVUS_TIMEOUT")
    milvusHost: str = Field(
        repr=False, exclude=True,
        validation_alias="MILVUS_HOST",
        default="localhost",
        description="Hostname of the Milvus instance (Docker sidecar for dev/demo).",
    )
    milvusPort: int = Field(
        validation_alias="MILVUS_PORT",
        default=19530,
        ge=1,
        le=65535,
        description="Port of the Milvus instance.",
    )
    milvusCollectionName: str = Field(
        validation_alias="MILVUS_COLLECTION_NAME",
        default="knowledge_chunks",
        description="Name of the Milvus collection that stores approved KB chunks.",
    )

    # Administrative access
    adminApiKey: SecretStr = Field(
        repr=False, exclude=True,
        validation_alias="ADMIN_API_KEY",
        default="",
        description=(
            "Secret key required in the X-Admin-Key header for all /v1/admin/* "
            "endpoints. Must be set before running in any environment."
        ),
    )

    # Audit logging
    auditLogPath: str = Field(
        validation_alias="AUDIT_LOG_PATH",
        default="audit.jsonl",
        description=(
            "Path to the append-only JSON-lines audit log file. "
            "Never contains case text, clinical passages, or patient identifiers."
        ),
    )

    # PII safeguard filter
    piiFilterEnabled: bool = Field(
        validation_alias="PII_FILTER_ENABLED",
        default=True,
        description="Enable the regex-based PII data minimisation safeguard filter.",
    )
    piiFilterPatterns: list[str] = Field(
        default_factory=list,
        validation_alias="PII_FILTER_PATTERNS",
        repr=False, exclude=True,
        description="Additional regex patterns; default safeguards remain active.",
    )

    # Application behaviour
    appTitle: str = Field(
        validation_alias="APP_TITLE",
        default="Clinical Evidence Assistant",
        description="Title shown in the OpenAPI docs.",
    )
    appVersion: str = Field(
        validation_alias="APP_VERSION",
        default="0.1.0",
        description="Application version string.",
    )
    debug: bool = Field(
        default=False,
        description="Enable FastAPI debug mode. Must be False in production.",
    )

    def __init__(self, **settingsInput) -> None:
        # Pydantic/source errors can retain raw input, regexes, or credentials.
        # Discard their details and suppress chaining before callers can log them.
        try:
            super().__init__(**settingsInput)
        except (ValidationError, SettingsError, ValueError, TypeError):
            raise ValueError("Invalid application configuration. Check configured types and constraints.") from None

    @field_validator("piiFilterPatterns")
    @classmethod
    def validatePatterns(cls, configuredPatterns: list[str]) -> list[str]:
        """Reject invalid regex configuration at startup without exposing patterns."""
        try:
            for configuredPattern in configuredPatterns:
                re.compile(configuredPattern)
        except re.error:
            raise ValueError("Invalid PII pattern configuration.") from None
        return configuredPatterns

    @field_validator("milvusTimeout", mode="before")
    @classmethod
    def validateTimeout(cls, timeout):
        if isinstance(timeout, bool):
            raise ValueError("Invalid vector timeout configuration.")
        return timeout

    # Validators
    @field_validator("watsonxEmbeddingDimension", mode="before")
    @classmethod
    def validateEmbeddingDimension(cls, v: object) -> int | None:
        """
        Accept None (dimension will be resolved by the embedding adapter at startup)
        or a positive integer supplied explicitly.  Reject zero, negatives, and
        non-numeric strings so mis-configured deployments fail fast.
        """
        if v is None or v == "":
            return None
        try:
            value = int(v)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            raise ValueError(
                "WATSONX_EMBEDDING_DIMENSION must be a positive integer or unset."
            ) from None
        if value < 1:
            raise ValueError(
                "WATSONX_EMBEDDING_DIMENSION must be >= 1 when provided."
            )
        return value

    @field_validator("milvusPort", mode="before")
    @classmethod
    def validateMilvusPort(cls, v: object) -> int:
        try:
            value = int(v)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            raise ValueError("MILVUS_PORT must be an integer between 1 and 65535.") from None
        if not 1 <= value <= 65535:
            raise ValueError("MILVUS_PORT must be an integer between 1 and 65535.")
        return value


def getSettings() -> Settings:
    """Return a fresh Settings instance (reads from env / .env file)."""
    return Settings()
