"""Approved-package contracts; no candidate promotion or approval actions."""

from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, model_validator

from backend.app.models.catalog import Digest
from backend.app.models.contracts import ModuleId
from backend.app.models.retrieval import ChunkStatus, EvidenceModel, KnowledgeChunk, MetadataText, canonicalHash
from backend.app.models.review import SourceReview


class ClaimApproval(EvidenceModel):
    """Trusted future-workflow authorization metadata, not a clinical annotation."""
    claimId: ModuleId
    moduleId: ModuleId
    sourceId: ModuleId
    knowledgeHash: Digest
    evidenceVersion: MetadataText
    status: Literal["approved"]
    approvedReviewIds: list[UUID] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def checkReviews(self):
        if len(set(self.approvedReviewIds)) != len(self.approvedReviewIds):
            raise ValueError("Duplicate claim review references.")
        return self


class ClaimSet(EvidenceModel):
    """Approved identifiers; candidate matrices cannot parse as this type."""
    claims: list[ClaimApproval] = Field(min_length=1, max_length=10000)


class ReviewSet(EvidenceModel):
    """Governed source reviews; external annotation templates are incompatible."""
    reviews: list[SourceReview] = Field(min_length=1, max_length=200, repr=False)


class SourceArtifact(EvidenceModel):
    """Source bytes and digest, distinct from the authoritative knowledge hash."""
    file: MetadataText = Field(repr=False)
    sourceHash: Digest


class EvidenceManifest(EvidenceModel):
    """Canonical package hash plus exact-byte artifact hashes; paths remain internal."""
    packageId: UUID
    moduleId: ModuleId
    evidenceVersion: MetadataText
    createdAt: AwareDatetime
    knowledgeHash: Digest
    sourceCatalogHash: Digest
    claimsHash: Digest
    reviewSetHash: Digest
    chunksHash: Digest
    chunkCount: int = Field(ge=1, le=10000)
    chunksFile: MetadataText = Field(repr=False)
    knowledgeFile: MetadataText = Field(repr=False)
    sourceCatalogFile: MetadataText = Field(repr=False)
    claimsFile: MetadataText = Field(repr=False)
    reviewSetFile: MetadataText = Field(repr=False)
    sourceArtifacts: dict[ModuleId, SourceArtifact] = Field(min_length=1, max_length=200, repr=False)
    packageHash: Digest | None = None
    status: ChunkStatus = Field(strict=False)

    @model_validator(mode="after")
    def checkHash(self):
        expectedHash = canonicalHash(self.model_dump(mode="json", exclude={"packageHash"}))
        if self.packageHash is not None and self.packageHash != expectedHash:
            raise ValueError("Invalid evidence package hash.")
        object.__setattr__(self, "packageHash", expectedHash)
        return self


class ChunkFile(EvidenceModel):
    """Bounded serialized chunk container; loader verifies identifier uniqueness."""
    chunks: list[KnowledgeChunk] = Field(min_length=1, max_length=10000)


class EvidencePackage(EvidenceModel):
    """Validated internal package; construction alone grants no retrieval rights."""
    manifest: EvidenceManifest
    chunks: list[KnowledgeChunk] = Field(repr=False)

    @model_validator(mode="after")
    def checkChunks(self):
        manifest = self.manifest
        if len(self.chunks) != manifest.chunkCount or len({chunk.chunkId for chunk in self.chunks}) != len(self.chunks):
            raise ValueError("Invalid package chunk membership.")
        for chunk in self.chunks:
            if (chunk.moduleId, chunk.packageId, chunk.evidenceVersion, chunk.knowledgeHash) != (manifest.moduleId, manifest.packageId, manifest.evidenceVersion, manifest.knowledgeHash):
                raise ValueError("Invalid package chunk provenance.")
            if manifest.status == ChunkStatus.approved and chunk.status != ChunkStatus.approved:
                raise ValueError("Approved package requires approved chunks.")
        return self
