"""Fictional evidence only; adversarial package and current-provenance checks."""

import json
from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.models.evidence import EvidencePackage
from backend.app.models.module import ClinicalModuleConfig
from backend.app.models.retrieval import KnowledgeChunk, canonicalHash
from backend.app.modules.registry import ModuleRegistry
from backend.app.services.evidence import EvidenceLoader, EvidenceUnavailableError
from tests.support.evidenceFixture import SyntheticPackage, SyntheticReview, SyntheticTime, buildModule, fileHash, makeChunk, refreshManifest, saveJson


def testValidChunkIsImmutableBoundAndEmbeddingFree():
    chunk = makeChunk()
    assert chunk.contentHash == canonicalHash(chunk.model_dump(mode="json", exclude={"contentHash"}))
    assert makeChunk().contentHash == chunk.contentHash
    assert "embeddingVector" not in chunk.model_fields
    assert chunk.sourcePages[0].printedPage == "alpha-1"
    assert chunk.verifiedUrl is None
    with pytest.raises(ValidationError):
        chunk.chunkId = UUID(int=100)
    fields = chunk.model_dump()
    fields["text"] = "synthetic test beta"
    with pytest.raises(ValidationError):
        KnowledgeChunk(**fields)
    assert makeChunk(text="synthetic test beta").contentHash != chunk.contentHash


def testTitleCaseSourceMetadataIsNotTreatedAsPatientNarrative(tmp_path):
    directory = buildModule(tmp_path)
    sources = json.loads((directory / "sources.json").read_bytes())
    sources["sources"][0]["title"] = "Synthetic Evidence Manual"
    saveJson(directory / "sources.json", sources)
    from backend.app.models.catalog import SourceRecord
    from backend.app.modules.reviews import metadataDigest
    review = json.loads((directory / "reviewSet.json").read_bytes())["reviews"][0]
    review["metadataHash"] = metadataDigest(SourceRecord.model_validate(sources["sources"][0]))
    saveJson(directory / "reviewSet.json", {"reviews": [review]})
    saveJson(directory / "reviews/first.json", review)
    chunk = makeChunk(documentTitle="Synthetic Evidence Manual", documentSection="Synthetic Evidence Section", citationLabel="Synthetic Evidence Manual")
    saveJson(directory / "chunks.json", {"chunks": [chunk.model_dump(mode="json")]})
    registry = refreshManifest(directory, sourceCatalogHash=fileHash(directory / "sources.json"),
        reviewSetHash=fileHash(directory / "reviewSet.json"), chunksHash=fileHash(directory / "chunks.json"))
    assert EvidenceLoader(registry).load("SyntheticAlpha")[0].chunks[0].documentTitle == "Synthetic Evidence Manual"


@pytest.mark.parametrize("changes", [{"claimIds": []}, {"text": ""}, {"text": "   "}, {"text": "x" * 8001},
    {"createdAt": datetime(2026, 10, 7)}, {"approvedReviewIds": []}, {"contentHash": "0" * 64}, {"moduleId": None},
    {"sourcePages": []}, {"sourcePages": [{"pdfPage": 0}]}, {"sourcePages": [{"pdfPage": True}]},
    {"claimIds": ["SyntheticClaim", "SyntheticClaim"]}, {"approvedReviewIds": [SyntheticReview, SyntheticReview]}, {"status": "candidate"},
    {"sourcePages": [{"pdfPage": 1, "printedPage": "  "}]}])
def testInvalidChunk(changes):
    with pytest.raises(ValidationError):
        makeChunk(**changes)


@pytest.mark.parametrize("field", ["patientName", "caseText", "symptoms", "additionalNotes", "prompt", "response", "unknown", "embeddingVector"])
def testChunkRejectsCaseAndUnknownFields(field):
    with pytest.raises(ValidationError):
        makeChunk(**{field: "synthetic prohibited content"})


@pytest.mark.parametrize("url", ["ftp://source.invalid/a", "file:///synthetic", "https://user:password@source.invalid/a", "https://source.invalid/a#fragment", "https://source.invalid/a?token=synthetic", "invalid", "https://"])
def testInvalidChunkUrl(url):
    with pytest.raises(ValidationError):
        makeChunk(verifiedUrl=url)


@pytest.mark.parametrize("url", [None, "http://source.invalid/a", "https://source.invalid/a"])
def testOptionalHttpChunkUrl(url):
    assert makeChunk(verifiedUrl=url).verifiedUrl == url


def testEvidenceBodyIdentifierSafeguardRemainsEnabled():
    with pytest.raises(ValidationError):
        makeChunk(text="synthetic.person@example.invalid")


@pytest.mark.parametrize("status", ["pendingReview", "retired"])
def testNonapprovedChunkRemainsExplicit(status):
    assert makeChunk(status=status, approvedReviewIds=[]).status.value == status


def testCorrectManifestAndApprovedPackageLoad(tmp_path):
    directory = buildModule(tmp_path)
    registry = ModuleRegistry(tmp_path)
    packages = EvidenceLoader(registry).load("SyntheticAlpha")
    assert len(packages) == 1 and len(packages[0].chunks) == 1
    manifest = packages[0].manifest
    assert manifest.packageHash == canonicalHash(manifest.model_dump(mode="json", exclude={"packageHash"}))
    assert registry.getModule("SyntheticAlpha").evidencePackages[SyntheticPackage] == fileHash(directory / "evidence" / (str(SyntheticPackage) + ".json"))


@pytest.mark.parametrize("changes", [{"moduleId": "SyntheticOther"}, {"evidenceVersion": "synthetic-v2"}, {"chunkCount": 2}, {"status": "pendingReview"}, {"status": "retired"}])
def testManifestSemanticMismatchFailsEvenWhenPinned(tmp_path, changes):
    directory = buildModule(tmp_path)
    registry = refreshManifest(directory, **changes)
    with pytest.raises(EvidenceUnavailableError):
        EvidenceLoader(registry).load("SyntheticAlpha")


@pytest.mark.parametrize("artifact", ["source.bin", "knowledge.bin", "sources.json", "approvedClaims.json", "reviewSet.json", "chunks.json"])
def testChangedArtifactFailsClosed(tmp_path, artifact, caplog):
    directory = buildModule(tmp_path)
    loader = EvidenceLoader(ModuleRegistry(tmp_path))
    with (directory / artifact).open("ab") as stream:
        stream.write(b"\n")
    with pytest.raises(EvidenceUnavailableError) as failure:
        loader.load("SyntheticAlpha")
    assert str(failure.value) == "Approved evidence is unavailable."
    assert str(tmp_path) not in str(failure.value) and caplog.text == ""


@pytest.mark.parametrize("hashField", ["sourceCatalogHash", "claimsHash", "reviewSetHash", "knowledgeHash", "chunksHash"])
def testStaleManifestBindingFails(tmp_path, hashField):
    directory = buildModule(tmp_path)
    registry = refreshManifest(directory, **{hashField: "0" * 64})
    with pytest.raises(EvidenceUnavailableError):
        EvidenceLoader(registry).load("SyntheticAlpha")


@pytest.mark.parametrize("path", ["../chunks.json", "..\\chunks.json", "C:\\outside.json", "/outside.json", "sourceIntake/chunks.json"])
def testArtifactTraversalAndAdministrativeStagingRejected(tmp_path, path):
    directory = buildModule(tmp_path)
    registry = refreshManifest(directory, chunksFile=path)
    with pytest.raises(EvidenceUnavailableError):
        EvidenceLoader(registry).load("SyntheticAlpha")


def testArtifactResolvedEscapeFailsClosed(tmp_path, monkeypatch):
    directory = buildModule(tmp_path)
    loader = EvidenceLoader(ModuleRegistry(tmp_path))
    outside = tmp_path / "outside.json"
    outside.write_bytes((directory / "chunks.json").read_bytes())
    original = Path.resolve
    def resolvePath(path, *args, **options):
        return outside if path == directory / "chunks.json" else original(path, *args, **options)
    monkeypatch.setattr(Path, "resolve", resolvePath)
    with pytest.raises(EvidenceUnavailableError):
        loader.load("SyntheticAlpha")


def testArtifactSymlinkEscapeRejectedWhenSupported(tmp_path):
    directory = buildModule(tmp_path)
    outside = tmp_path / "outside.json"
    outside.write_bytes((directory / "chunks.json").read_bytes())
    try:
        (directory / "escape.json").symlink_to(outside)
    except OSError:
        pytest.skip("Platform cannot create symlink without privileges.")
    registry = refreshManifest(directory, chunksFile="escape.json")
    with pytest.raises(EvidenceUnavailableError):
        EvidenceLoader(registry).load("SyntheticAlpha")


@pytest.mark.parametrize("change", ["duplicate", "pending", "retired", "module", "version", "package", "knowledge", "review", "source", "claim", "url", "title", "missingHash", "content"])
def testChunkMembershipAndIntegrityFailures(tmp_path, change):
    directory = buildModule(tmp_path)
    chunk = makeChunk().model_dump(mode="json")
    chunk.pop("contentHash")
    changes = {"pending": {"status": "pendingReview"}, "retired": {"status": "retired"}, "module": {"moduleId": "SyntheticOther"},
        "version": {"evidenceVersion": "synthetic-v2"}, "package": {"packageId": str(UUID(int=20))}, "knowledge": {"knowledgeHash": "0" * 64},
        "review": {"approvedReviewIds": [str(UUID(int=21))]}, "source": {"sourceId": "UnknownSource"}, "claim": {"claimIds": ["UnknownClaim"]},
        "url": {"verifiedUrl": "https://source.invalid/a"}, "title": {"documentTitle": "synthetic changed title"}}
    chunk.update(changes.get(change, {}))
    chunk = KnowledgeChunk.model_validate_json(json.dumps(chunk)).model_dump(mode="json")
    if change == "missingHash":
        chunk.pop("contentHash")
    if change == "content":
        chunk["text"] = "synthetic tampered content"
    chunks = [chunk, chunk] if change == "duplicate" else [chunk]
    saveJson(directory / "chunks.json", {"chunks": chunks})
    registry = refreshManifest(directory, chunksHash=fileHash(directory / "chunks.json"), chunkCount=len(chunks))
    with pytest.raises(EvidenceUnavailableError):
        EvidenceLoader(registry).load("SyntheticAlpha")


@pytest.mark.parametrize("field", ["moduleId", "sourceId", "knowledgeHash", "evidenceVersion", "approvedReviewIds", "status", "claimId"])
def testInvalidApprovedClaimAuthorizationFails(tmp_path, field):
    directory = buildModule(tmp_path)
    content = json.loads((directory / "approvedClaims.json").read_bytes())
    replacements = {"moduleId": "SyntheticOther", "sourceId": "UnknownSource", "knowledgeHash": "0" * 64, "evidenceVersion": "synthetic-v2",
        "approvedReviewIds": [str(UUID(int=21))], "status": "candidate", "claimId": "UnknownClaim"}
    content["claims"][0][field] = replacements[field]
    saveJson(directory / "approvedClaims.json", content)
    registry = refreshManifest(directory, claimsHash=fileHash(directory / "approvedClaims.json"))
    with pytest.raises(EvidenceUnavailableError):
        EvidenceLoader(registry).load("SyntheticAlpha")


def testLaterRejectionInvalidatesExistingLoader(tmp_path):
    directory = buildModule(tmp_path)
    loader = EvidenceLoader(ModuleRegistry(tmp_path))
    assert loader.load("SyntheticAlpha")
    review = json.loads((directory / "reviews/first.json").read_bytes())
    review.update(reviewId=str(UUID(int=22)), reviewedAt=(SyntheticTime + timedelta(days=1)).isoformat(), outcome="rejected")
    saveJson(directory / "reviews/later.json", review)
    with pytest.raises(EvidenceUnavailableError):
        loader.load("SyntheticAlpha")


@pytest.mark.parametrize("change", ["duplicatePackage", "malformed", "oversized", "unpinned", "wrongPackageHash", "missing", "duplicateKey"])
def testManifestIntegrityAndFileBounds(tmp_path, change):
    directory = buildModule(tmp_path)
    path = directory / "evidence" / (str(SyntheticPackage) + ".json")
    registry = ModuleRegistry(tmp_path)
    if change == "duplicatePackage":
        (directory / "evidence/copy.json").write_bytes(path.read_bytes())
    elif change == "missing":
        path.unlink()
    else:
        content = {"malformed": b"{", "oversized": b" " * 65537, "unpinned": path.read_bytes() + b"\n",
            "wrongPackageHash": path.read_bytes().replace(json.loads(path.read_bytes())["packageHash"].encode(), b"0" * 64),
            "duplicateKey": path.read_bytes().replace(b'"chunkCount": 1', b'"chunkCount": 1, "chunkCount": 1')}[change]
        path.write_bytes(content)
    with pytest.raises(EvidenceUnavailableError):
        EvidenceLoader(registry).load("SyntheticAlpha")


def testAuthenticContentCannotLoadAndStateIsUnchanged():
    settings = Settings()
    paths = [path for path in settings.moduleRoot.rglob("*") if path.is_file()]
    before = {path: fileHash(path) for path in paths}
    registry = ModuleRegistry(settings.moduleRoot)
    loader = EvidenceLoader(registry)
    for moduleId, config in registry.moduleConfigs.items():
        assert config.active is False and config.status.value == "pending_review"
        assert config.evidenceDirectory is None and config.evidencePackages == {}
        with pytest.raises(EvidenceUnavailableError):
            loader.load(moduleId)
    for selection in [None, "", "NotSure", "UnknownModule"]:
        with pytest.raises(EvidenceUnavailableError):
            loader.load(selection)
    moduleRoot = settings.moduleRoot / "module02EarlyPregnancy"
    for path in [moduleRoot / "candidateClaims.json", *list((moduleRoot / "knowledge/sources").glob("*.pdf"))]:
        with pytest.raises((ValueError, UnicodeError)):
            KnowledgeChunk.model_validate_json(path.read_bytes())
    with TestClient(createApp()) as client:
        assert client.get("/v1/modules").json() == {"modules": []}
        assert client.get("/ready").status_code == 503
        assert not hasattr(client.app.state, "retrieval")
    assert before == {path: fileHash(path) for path in paths}


def testDuplicateCanonicalPackageKeysRejected(tmp_path):
    directory = buildModule(tmp_path)
    config = json.loads((directory / "config.json").read_bytes())
    config["evidencePackages"] = {str(SyntheticPackage): "0" * 64, SyntheticPackage.hex: "0" * 64}
    with pytest.raises(ValidationError):
        ClinicalModuleConfig.model_validate(config)


@pytest.mark.parametrize("status", ["pendingReview", "retired"])
def testApprovedPackageContractRejectsNonapprovedChunks(tmp_path, status):
    buildModule(tmp_path)
    package = EvidenceLoader(ModuleRegistry(tmp_path)).load("SyntheticAlpha")[0]
    with pytest.raises(ValidationError):
        EvidencePackage(manifest=package.manifest, chunks=[makeChunk(status=status, approvedReviewIds=[])])


def testCachedConfigurationCannotOverrideDeactivation(tmp_path):
    directory = buildModule(tmp_path)
    loader = EvidenceLoader(ModuleRegistry(tmp_path))
    config = json.loads((directory / "config.json").read_bytes())
    config["active"] = False
    saveJson(directory / "config.json", config)
    with pytest.raises(EvidenceUnavailableError):
        loader.load("SyntheticAlpha")
