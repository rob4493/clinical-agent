"""Public discovery contracts deliberately exclude internal configuration."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.contracts import ModuleId
from backend.app.models.input import CaseType


class ModuleSummary(BaseModel):
    """Frontend-safe metadata for an available explicitly selectable module."""

    model_config = ConfigDict(extra="forbid", strict=True)

    moduleId: ModuleId
    displayName: str = Field(min_length=1, max_length=200)
    version: str = Field(min_length=1, max_length=200)
    description: str = Field(max_length=2000)
    supportedCaseTypes: list[CaseType]


class ModuleList(BaseModel):
    """Available modules; an empty collection is a valid discovery result."""

    model_config = ConfigDict(extra="forbid", strict=True)

    modules: list[ModuleSummary]


class ReadinessResponse(BaseModel):
    """Offline dependency readiness; never claims live provider health."""

    model_config = ConfigDict(extra="forbid", strict=True)

    status: Literal["ready", "notReady"]
    availableModuleCount: int = Field(ge=0)
    reasonCode: Literal["ready", "noAvailableModules", "registryUnavailable", "analysisUnavailable"]


class ServiceUnavailable(BaseModel):
    """Sanitized discovery dependency failure."""

    model_config = ConfigDict(extra="forbid", strict=True)

    reasonCode: Literal["registryUnavailable"] = "registryUnavailable"
    message: Literal["Module discovery is unavailable."] = "Module discovery is unavailable."
