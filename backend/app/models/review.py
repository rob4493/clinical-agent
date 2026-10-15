"""Administrative source-review contracts; no patient or clinical-case storage."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, StringConstraints, ValidationInfo, field_validator

from backend.app.models.catalog import Digest
from backend.app.models.contracts import ModuleId
from backend.app.utils.piiFilter import filterFreeText

ReviewerId = Annotated[str, StringConstraints(strict=True, pattern=r"^[a-z][a-z0-9-]{0,31}$")]
ReviewCriterion = Literal["identityVerified", "authorityVerified", "versionVerified", "jurisdictionReviewed", "scopeReviewed", "limitationsReviewed", "urlVerified", "outcome", "moduleId", "sourceId", "knowledgeHash", "metadataHash", "sourceAvailable", "sourceMetadata", "reviewValid", "reviewMissing", "requiredSources"]


class SourceReview(BaseModel):
    """Explicit human review attestation bound to a source and knowledge snapshot."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)

    reviewId: UUID
    moduleId: ModuleId
    sourceId: ModuleId
    reviewerId: ReviewerId = Field(repr=False)
    reviewedAt: AwareDatetime
    knowledgeHash: Digest
    metadataHash: Digest
    identityVerified: StrictBool
    authorityVerified: StrictBool
    versionVerified: StrictBool
    jurisdictionReviewed: StrictBool
    scopeReviewed: StrictBool
    limitationsReviewed: StrictBool
    urlVerified: StrictBool | None
    outcome: Literal["approved", "rejected", "changesRequired"]
    notes: str | None = Field(default=None, strict=True, max_length=500, repr=False)

    @field_validator("notes")
    @classmethod
    def checkNotes(cls, notes: str | None, info: ValidationInfo) -> str | None:
        # Administrative review filtering cannot be disabled by clinical-input settings.
        extraPatterns = getattr(info.context, "piiFilterPatterns", None)
        return filterFreeText(notes.strip() if notes is not None else None, extraPatterns=extraPatterns)


class SourceApprovalResult(BaseModel):
    """Calculated eligibility; never a lifecycle mutation or clinical approval claim."""

    model_config = ConfigDict(extra="forbid", strict=True)

    sourceId: ModuleId
    eligible: StrictBool
    failedCriteria: list[ReviewCriterion]
    reviewId: UUID | None


class ModuleApprovalResult(BaseModel):
    """All configured required sources must have current eligible review evidence."""

    model_config = ConfigDict(extra="forbid", strict=True)

    moduleId: ModuleId
    eligible: StrictBool
    failedCriteria: list[ReviewCriterion]
    sourceResults: list[SourceApprovalResult]
