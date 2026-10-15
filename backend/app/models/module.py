"""
Module configuration models.

ClinicalModuleConfig defines registry-loaded operational metadata.

Design rules:
- No model identifier fields (LLM or embedding). Those are in Settings only.
- sourceRegister is a dict keyed by source tag (e.g. "NICE-NG73").
- active controls operational enablement independently of approval status.
- Adding a future module requires only a new config.json and no model changes.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StrictBool, StringConstraints, field_validator
from backend.app.models.contracts import ModuleId
from backend.app.models.input import CaseType
from backend.app.models.catalog import CatalogText, Digest

ModuleText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=200)]


class ModuleStatus(str, Enum):
    """Review status plus the preserved legacy inactive state."""
    approved = "approved"
    pendingReview = "pending_review"
    inactive = "inactive"


class SourceEntry(BaseModel):
    """One entry in a module's source register."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    org: str = Field(..., description="Organisation that published the source.")
    title: str = Field(..., description="Full title of the source document.")
    date: str | None = Field(
        default=None,
        description="Publication or last-reviewed date (ISO 8601 or year string).",
    )
    jurisdiction: str = Field(
        ...,
        description="Applicable jurisdiction (e.g. 'UK', 'US', 'Global').",
    )
    # Valid syntax is not approval. Only administratively approved, verified
    # metadata may supply a future clickable source link; never fill a missing URL.
    url: HttpUrl | None = Field(default=None, description="Optional HTTP/HTTPS source URL; syntax validation does not establish approval.")
    freshnessWarning: str | None = Field(
        default=None,
        alias="freshnessWarning",
        description=(
            "Free-text warning when the source is older than other core sources "
            "and must not automatically override newer applicable guidelines."
        ),
    )


class ClinicalModuleConfig(BaseModel):
    """
    Clinical module configuration loaded from config.json.

    No model identifiers. LLM and embedding model IDs are in Settings only.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    moduleId: ModuleId = Field(
        ...,
        alias="moduleId",
        description="Unique module identifier (e.g. 'module_01_endo').",
    )
    moduleName: ModuleText = Field(
        ...,
        alias="moduleName",
        description="Human-readable module name.",
    )
    moduleHintValue: ModuleId = Field(
        ...,
        alias="moduleHintValue",
        description=(
            "The explicit selection identifier that maps to this module "
            "(e.g. 'EndometriosisChronicPelvicPain')."
        ),
    )
    version: ModuleText = Field(..., description="Module version string (e.g. '2.0').")
    active: StrictBool = Field(default=False, description="Operationally enabled; independently requires approved status.")
    description: str = Field(default="", max_length=2000)
    supportedCaseTypes: list[CaseType] = Field(default_factory=list, max_length=2)
    knowledgePath: str | None = Field(default=None, max_length=1024, description="Optional existing content location relative to the configured module root.")
    sourceCatalog: str | None = Field(default=None, strict=True, max_length=500, description="Internal provenance catalog path relative to this module directory.")
    knowledgeChecksums: dict[CatalogText, Digest] = Field(default_factory=dict, max_length=200, description="Trusted SHA-256 digests of module-local runtime mirrors.")
    reviewDirectory: str | None = Field(default=None, strict=True, max_length=500)
    evidenceDirectory: str | None = Field(default=None, strict=True, max_length=500, repr=False)
    evidencePackages: dict[UUID, Digest] = Field(default_factory=dict, max_length=100, repr=False, description="Trusted raw manifest SHA-256 by package UUID; empty grants no evidence loading.")
    requiredSourceIds: list[ModuleId] = Field(default_factory=list, max_length=200)
    status: ModuleStatus = Field(
        ...,
        description="Review status; approved is required independently of active. Legacy inactive status always blocks resolution.",
    )
    kbVersion: ModuleText | None = Field(
        default=None,
        alias="kbVersion",
        description="Knowledge-base version, or Unknown for an evidence-free inactive scaffold.",
    )
    reviewDate: ModuleText | None = Field(
        default=None,
        alias="reviewDate",
        description="Last clinical evidence review date, or Unknown when no review has occurred.",
    )
    jurisdictionNotes: str = Field(
        ...,
        max_length=2000,
        alias="jurisdictionNotes",
        description=(
            "Notes on applicable jurisdictions and when jurisdiction "
            "should be stated in responses."
        ),
    )
    retrievalTopK: int = Field(
        default=8,
        ge=1,
        alias="retrievalTopK",
        description="Maximum number of KB chunks to retrieve per query.",
    )
    sourceRegister: dict[str, SourceEntry] = Field(
        ...,
        alias="sourceRegister",
        description=(
            "Map of source tag (e.g. 'NICE-NG73') to source metadata. "
            "Every clinical claim must carry a tag present in this register."
        ),
    )
    excludedFunctions: list[str] = Field(
        default_factory=list,
        alias="excludedFunctions",
        description="Functions explicitly prohibited for this module.",
    )
    urgentRuleIds: list[ModuleId] = Field(
        default_factory=list,
        max_length=100,
        alias="urgentRuleIds",
        description="List of urgent rule identifiers active for this module.",
    )

    @field_validator("evidencePackages", mode="before")
    @classmethod
    def checkPackages(cls, packages):
        # Different UUID spellings must not silently collapse into the same key.
        if isinstance(packages, dict):
            if any(not isinstance(packageId, (UUID, str)) for packageId in packages):
                raise ValueError("Invalid evidence package identifiers.")
            identifiers = [packageId if isinstance(packageId, UUID) else UUID(packageId) for packageId in packages]
            if len(set(identifiers)) != len(identifiers):
                raise ValueError("Duplicate evidence package identifiers.")
        return packages
