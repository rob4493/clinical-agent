"""Internal transient drafts and rendering bindings; never grant evidence approval."""

from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints, GetPydanticSchema, WithJsonSchema
from pydantic_core import core_schema

from backend.app.models.catalog import Digest, SourceRecord
from backend.app.models.contracts import ModuleId
from backend.app.models.output import AgentResponse, ClarificationRequired, DataConflict, EvidenceInsufficientResponse, ModuleUnavailable, SelectModuleRequired, OutsideScope, ProviderUnavailable
from backend.app.models.retrieval import EvidenceModel
from backend.app.models.safety import UrgentWarning

ResponseText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=6000)]
AnalysisResponse = Annotated[AgentResponse | ClarificationRequired | DataConflict | EvidenceInsufficientResponse | ModuleUnavailable | SelectModuleRequired | OutsideScope | ProviderUnavailable, Field(discriminator="responseType")]


class ClaimReference(EvidenceModel):
    """Exact retrieved chunk/claim reference; source tags alone cannot ground a claim."""
    chunkId: UUID
    claimId: ModuleId


class ResponseStatement(EvidenceModel):
    """Trusted rendering vocabulary bound to evidence bytes, not a promotion record."""
    moduleId: ModuleId
    text: ResponseText = Field(repr=False)
    references: list[ClaimReference] = Field(min_length=1, max_length=8)
    contentHashes: list[Digest] = Field(min_length=1, max_length=8)


class DraftConsideration(EvidenceModel):
    """Untrusted model text must match the trusted evidence-bound vocabulary exactly."""
    text: ResponseText = Field(repr=False)
    references: list[ClaimReference] = Field(min_length=1, max_length=8)


class FollowupQuestion(EvidenceModel):
    """Trusted question for one unknown field, relevant only to specified claims."""
    questionId: ModuleId
    moduleId: ModuleId
    fieldName: ModuleId
    claimIds: list[ModuleId] = Field(min_length=1, max_length=8)
    text: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=200)] = Field(repr=False)


class AnalysisDraft(EvidenceModel):
    """Bounded structured output; no URLs, facts, prompts or warning fields accepted."""
    considerations: list[DraftConsideration] = Field(min_length=1, max_length=3, repr=False)
    questionId: ModuleId | None = None


class ModelRequest(EvidenceModel):
    """Ephemeral fixed instructions and separately labelled untrusted JSON sections."""
    instructions: str
    content: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=96000)] = Field(repr=False)


PublicSourceFields = ("sourceId", "organization", "title", "publicationDate", "reviewDate", "jurisdiction", "verifiedUrl")
PublicSourceSchema = {"type": "object", "additionalProperties": False, "properties": {
    field: SourceRecord.model_json_schema()["properties"][field] for field in PublicSourceFields
}, "required": list(PublicSourceFields)}


def projectSource(source: SourceRecord) -> dict:
    """Allow only citation metadata; never expose catalog paths or review notes."""
    return source.model_dump(mode="json", include=set(PublicSourceFields))


def validateSource(source) -> SourceRecord:
    return SourceRecord.model_validate(source)


# Keep the internal type for provenance checks without registering its catalog
# schema as an OpenAPI component. Only this boundary has public serialization.
PublicSource = Annotated[SourceRecord, GetPydanticSchema(lambda sourceType, handler:
    core_schema.no_info_plain_validator_function(validateSource, serialization=
        core_schema.plain_serializer_function_ser_schema(projectSource))), WithJsonSchema(PublicSourceSchema)]


class CitedSource(EvidenceModel):
    """Numbered source metadata accepted by the active policy; preserve verified URLs."""
    number: int = Field(ge=1, le=32)
    source: PublicSource


class AnalysisResult(EvidenceModel):
    """Public response envelope; warning-first fallbacks retain safety output."""
    warnings: list[UrgentWarning] = Field(default_factory=list)
    response: AnalysisResponse
    sources: list[CitedSource] = Field(default_factory=list)
    renderedText: str = Field(repr=False)
    # Transport classification is internal and excluded from public serialization.
    serviceUnavailable: bool = Field(default=False, exclude=True, repr=False)
