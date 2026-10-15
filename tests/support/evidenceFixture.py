"""Fictional approved artifacts only, placed exclusively in temporary test roots."""

import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID

from backend.app.models.catalog import SourceRecord
from backend.app.models.evidence import EvidenceManifest
from backend.app.models.retrieval import KnowledgeChunk
from backend.app.models.review import SourceReview
from backend.app.modules.registry import ModuleRegistry
from backend.app.modules.reviews import metadataDigest

SyntheticTime = datetime(2026, 10, 7, tzinfo=timezone.utc)
SyntheticReview = UUID("00000000-0000-4000-8000-000000000001")
SyntheticPackage = UUID("00000000-0000-4000-8000-000000000010")


def makeChunk(**changes):
    fields = dict(chunkId=UUID("00000000-0000-4000-8000-000000000002"), packageId=SyntheticPackage,
        moduleId="SyntheticAlpha", sourceId="SyntheticSource", claimIds=["SyntheticClaim"], category="synthetic",
        text="synthetic condition alpha", jurisdiction="synthetic", documentTitle="synthetic source", documentSection="alpha",
        sourcePages=[{"pdfPage": 1, "printedPage": "alpha-1"}], citationLabel="synthetic source alpha",
        sourceHash=hashlib.sha256(b"synthetic source bytes").hexdigest(), knowledgeHash=hashlib.sha256(b"synthetic knowledge bytes").hexdigest(),
        evidenceVersion="synthetic-v1", status="approved", createdAt=SyntheticTime, approvedReviewIds=[SyntheticReview])
    fields.update(changes)
    return KnowledgeChunk(**fields)


def saveJson(path, content):
    path.write_text(json.dumps(content, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def fileHash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def buildModule(root, moduleId="SyntheticAlpha", packageId=SyntheticPackage):
    directory = root / moduleId
    directory.mkdir(parents=True)
    (directory / "evidence").mkdir()
    (directory / "reviews").mkdir()
    (directory / "knowledge.bin").write_bytes(b"synthetic knowledge bytes")
    (directory / "source.bin").write_bytes(b"synthetic source bytes")
    chunk = makeChunk(moduleId=moduleId, packageId=packageId)
    source = SourceRecord(sourceId=chunk.sourceId, organization="synthetic", title=chunk.documentTitle, jurisdiction=chunk.jurisdiction,
        knowledgeFile="knowledge.bin", verifiedUrl=chunk.verifiedUrl, status="approved")
    review = SourceReview(reviewId=SyntheticReview, moduleId=moduleId, sourceId=source.sourceId, reviewerId="synthetic-reviewer",
        reviewedAt=SyntheticTime, knowledgeHash=chunk.knowledgeHash, metadataHash=metadataDigest(source), identityVerified=True,
        authorityVerified=True, versionVerified=True, jurisdictionReviewed=True, scopeReviewed=True, limitationsReviewed=True,
        urlVerified=None, outcome="approved")
    saveJson(directory / "sources.json", {"sources": [source.model_dump(mode="json")]})
    saveJson(directory / "reviews/first.json", review.model_dump(mode="json"))
    saveJson(directory / "reviewSet.json", {"reviews": [review.model_dump(mode="json")]})
    saveJson(directory / "approvedClaims.json", {"claims": [{"claimId": "SyntheticClaim", "moduleId": moduleId, "sourceId": chunk.sourceId,
        "knowledgeHash": chunk.knowledgeHash, "evidenceVersion": chunk.evidenceVersion, "status": "approved", "approvedReviewIds": [str(SyntheticReview)]}]})
    saveJson(directory / "chunks.json", {"chunks": [chunk.model_dump(mode="json")]})
    manifest = EvidenceManifest(packageId=packageId, moduleId=moduleId, evidenceVersion=chunk.evidenceVersion, createdAt=SyntheticTime,
        knowledgeHash=chunk.knowledgeHash, sourceCatalogHash=fileHash(directory / "sources.json"), claimsHash=fileHash(directory / "approvedClaims.json"),
        reviewSetHash=fileHash(directory / "reviewSet.json"), chunksHash=fileHash(directory / "chunks.json"), chunkCount=1,
        chunksFile="chunks.json", knowledgeFile="knowledge.bin", sourceCatalogFile="sources.json", claimsFile="approvedClaims.json", reviewSetFile="reviewSet.json",
        sourceArtifacts={chunk.sourceId: {"file": "source.bin", "sourceHash": chunk.sourceHash}}, status="approved")
    saveJson(directory / "evidence" / (str(packageId) + ".json"), manifest.model_dump(mode="json"))
    config = dict(moduleId=moduleId, moduleName="synthetic module", moduleHintValue=moduleId, version="synthetic-v1", active=True,
        status="approved", kbVersion=chunk.evidenceVersion, reviewDate="synthetic review", jurisdictionNotes="synthetic", sourceRegister={},
        sourceCatalog="sources.json", knowledgeChecksums={"knowledge.bin": chunk.knowledgeHash}, reviewDirectory="reviews", requiredSourceIds=[chunk.sourceId],
        evidenceDirectory="evidence", evidencePackages={str(packageId): fileHash(directory / "evidence" / (str(packageId) + ".json"))})
    saveJson(directory / "config.json", config)
    return directory


def refreshManifest(directory, **changes):
    """Re-pin synthetic fixtures only, allowing tests to reach deeper integrity gates."""
    path = next((directory / "evidence").glob("*.json"))
    fields = json.loads(path.read_bytes())
    fields.pop("packageHash")
    fields.update(changes)
    manifest = EvidenceManifest.model_validate_json(json.dumps(fields))
    saveJson(path, manifest.model_dump(mode="json"))
    config = json.loads((directory / "config.json").read_bytes())
    config["evidencePackages"] = {str(manifest.packageId): fileHash(path)}
    saveJson(directory / "config.json", config)
    return ModuleRegistry(directory.parent)
