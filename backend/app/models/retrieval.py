"""Strict module-neutral runtime evidence; candidate annotations are incompatible."""

import hashlib
import json
import math
from datetime import timezone
from enum import Enum
from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, StringConstraints, field_validator, model_validator

from backend.app.models.catalog import Digest, SourceRecord
from backend.app.models.contracts import ModuleId
from backend.app.models.input import MaxLong
from backend.app.utils.piiFilter import filterFreeText

EvidenceText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=8000)]
MetadataText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=500)]


def canonicalHash(content: dict) -> str:
    """Hash stable UTF-8 JSON; preserve list and page order."""
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")).hexdigest()


class UrgencyClass(str, Enum):
    """Descriptive metadata; never executes or authorizes an urgent rule."""
    urgent = "urgent"
    standard = "standard"
    none = "none"


class ChunkStatus(str, Enum):
    """Evidence lifecycle; syntax alone never grants administrative approval."""
    pendingReview = "pendingReview"
    approved = "approved"
    retired = "retired"


class EvidenceModel(BaseModel):
    """Unknown fields and implicit primitive coercions are forbidden."""
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True, hide_input_in_errors=True)

    @field_validator("*", mode="after")
    @classmethod
    def checkBlank(cls, fieldText):
        if isinstance(fieldText, str) and not fieldText.strip():
            raise ValueError("Blank evidence metadata.")
        return fieldText


class SourcePage(EvidenceModel):
    """Exact physical and optional printed-page reference, without normalization."""
    pdfPage: int = Field(ge=1, le=100000)
    printedPage: MetadataText | None = None

    @field_validator("printedPage")
    @classmethod
    def checkPage(cls, printedPage):
        if printedPage is not None and not printedPage.strip():
            raise ValueError("Blank page reference.")
        return printedPage


class KnowledgeChunk(EvidenceModel):
    """Immutable evidence provenance; no embedding required at construction."""
    chunkId: UUID
    packageId: UUID
    moduleId: ModuleId
    sourceId: ModuleId
    claimIds: list[ModuleId] = Field(min_length=1, max_length=100)
    category: ModuleId
    text: EvidenceText = Field(repr=False)
    jurisdiction: MetadataText
    documentTitle: MetadataText
    documentSection: MetadataText
    sourcePages: list[SourcePage] = Field(min_length=1, max_length=100)
    citationLabel: MetadataText
    verifiedUrl: str | None = Field(default=None, strict=True, max_length=2048)
    sourceHash: Digest
    knowledgeHash: Digest
    evidenceVersion: MetadataText
    status: ChunkStatus = Field(strict=False)
    createdAt: AwareDatetime
    approvedReviewIds: list[UUID] = Field(max_length=100)
    contentHash: Digest | None = None
    urgencyClass: UrgencyClass = Field(default=UrgencyClass.none, strict=False)
    prohibitedInferences: list[MetadataText] = Field(default_factory=list, max_length=100, repr=False)

    @field_validator("chunkId", mode="before")
    @classmethod
    def parseId(cls, chunkId):
        # Preserve the existing internal UUID-string construction boundary.
        return UUID(chunkId) if isinstance(chunkId, str) else chunkId

    @field_validator("createdAt")
    @classmethod
    def normalizeTime(cls, timestamp):
        return timestamp.astimezone(timezone.utc)

    @field_validator("text", "jurisdiction", "documentTitle", "documentSection", "citationLabel", "evidenceVersion")
    @classmethod
    def checkText(cls, text):
        if not text.strip():
            raise ValueError("Blank evidence field.")
        return text

    @field_validator("text")
    @classmethod
    def checkContent(cls, text):
        # Do not run case-name regexes over official titles or section headings.
        # Metadata is hash-bound and catalog-checked; body filtering is heuristic.
        filterFreeText(text)
        return text

    @field_validator("verifiedUrl")
    @classmethod
    def checkUrl(cls, sourceUrl):
        SourceRecord.checkUrl(sourceUrl)
        if sourceUrl is not None and "?" in sourceUrl:
            raise ValueError("Invalid evidence URL.")
        return sourceUrl

    @model_validator(mode="after")
    def checkProvenance(self):
        if len(set(self.claimIds)) != len(self.claimIds) or len(set(self.approvedReviewIds)) != len(self.approvedReviewIds):
            raise ValueError("Duplicate evidence provenance.")
        if self.status == ChunkStatus.approved and not self.approvedReviewIds:
            raise ValueError("Approved evidence requires review references.")
        expectedHash = canonicalHash(self.model_dump(mode="json", exclude={"contentHash"}))
        if self.contentHash is not None and self.contentHash != expectedHash:
            raise ValueError("Invalid evidence content hash.")
        object.__setattr__(self, "contentHash", expectedHash)
        return self


class RetrievalQuery(EvidenceModel):
    """Bounded untrusted query; module selection and filters are separate controls."""
    queryText: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=MaxLong)] = Field(repr=False)
    moduleId: ModuleId
    topK: int = Field(default=8, ge=1, le=50)
    urgencyBoost: StrictBool = False

    @field_validator("queryText")
    @classmethod
    def checkQuery(cls, queryText):
        if not queryText.strip():
            raise ValueError("Blank retrieval query.")
        filterFreeText(queryText)
        return queryText


class RetrievalResult(EvidenceModel):
    """One approved hit; no query, vectors, paths or review identities."""
    chunkId: UUID
    moduleId: ModuleId
    sourceId: ModuleId
    claimIds: list[ModuleId] = Field(min_length=1, max_length=100)
    category: ModuleId
    text: EvidenceText = Field(repr=False)
    citationLabel: MetadataText
    verifiedUrl: str | None = Field(default=None, strict=True, max_length=2048)
    sourcePages: list[SourcePage] = Field(min_length=1, max_length=100)
    score: float
    evidenceVersion: MetadataText

    @field_validator("score")
    @classmethod
    def checkScore(cls, score):
        if not math.isfinite(score):
            raise ValueError("Invalid retrieval score.")
        return score

    @field_validator("verifiedUrl")
    @classmethod
    def checkUrl(cls, sourceUrl):
        return KnowledgeChunk.checkUrl(sourceUrl)
