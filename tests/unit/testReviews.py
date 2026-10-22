"""Synthetic review attestations only; authentic sources remain pending and inactive."""

import json
import hashlib
import shutil
from datetime import datetime, timezone, timedelta
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.models.catalog import SourceRecord
from backend.app.models.review import SourceReview
from backend.app.modules.catalog import CatalogStore
from backend.app.modules.reviews import ApprovalGate, ReviewStore, ReviewConfigError, RequiredCriteria, metadataDigest


def makeGate(tmp_path, sourceUrl=None, requiredSourceIds=None):
    (tmp_path / "mirror.bin").write_bytes(b"Synthetic")
    checksums = {"mirror.bin": hashlib.sha256(b"Synthetic").hexdigest()}
    source = SourceRecord(sourceId="Synthetic", organization="Synthetic", title="Synthetic", knowledgeFile="mirror.bin", verifiedUrl=sourceUrl)
    (tmp_path / "sources.json").write_text(json.dumps({"sources": [source.model_dump(mode="json")]}), encoding="utf-8")
    (tmp_path / "reviews").mkdir()
    catalog = CatalogStore(tmp_path, "sources.json", checksums)
    gate = ApprovalGate("SyntheticModule", catalog, checksums, ["Synthetic"] if requiredSourceIds is None else requiredSourceIds,
                        ReviewStore(tmp_path, "reviews", "SyntheticModule"))
    return gate, source


def makeReview(gate, source, **changes):
    fields = dict(reviewId=UUID("00000000-0000-4000-8000-000000000001"), moduleId=gate.moduleId, sourceId=source.sourceId,
                  reviewerId="synthetic-reviewer", reviewedAt=datetime(2026, 10, 7, tzinfo=timezone.utc),
                  knowledgeHash=gate.knowledgeChecksums[source.knowledgeFile], metadataHash=metadataDigest(source),
                  identityVerified=True, authorityVerified=True, versionVerified=True, jurisdictionReviewed=True,
                  scopeReviewed=True, limitationsReviewed=True, urlVerified=True if source.verifiedUrl else None,
                  outcome="approved", notes="synthetic administrative check")
    fields.update(changes)
    return SourceReview(**fields)


def saveReview(root, filename, review):
    (root / "reviews" / filename).write_text(review.model_dump_json(), encoding="utf-8")


def testCompleteReviewAndNoStateMutation(tmp_path):
    gate, source = makeGate(tmp_path)
    review = makeReview(gate, source)
    result = gate.evaluateReview(source, review)
    assert result.eligible is True and result.failedCriteria == [] and result.reviewId == review.reviewId
    assert source.status == "pendingReview"
    assert gate.catalog.getSource("Synthetic").status == "pendingReview"


@pytest.mark.parametrize("criterion", RequiredCriteria)
def testEveryFalseCriterionBlocks(tmp_path, criterion):
    gate, source = makeGate(tmp_path)
    result = gate.evaluateReview(source, makeReview(gate, source, **{criterion: False}))
    assert result.eligible is False and criterion in result.failedCriteria


@pytest.mark.parametrize("criterion", RequiredCriteria + ("urlVerified",))
def testMissingCriteriaFailClosed(tmp_path, criterion):
    gate, source = makeGate(tmp_path)
    fields = makeReview(gate, source).model_dump()
    del fields[criterion]
    with pytest.raises(ValidationError):
        SourceReview(**fields)
    assert gate.evaluateReview(source, SourceReview.model_construct(**fields)).failedCriteria == ["reviewValid"]


@pytest.mark.parametrize("urlVerified,eligible", [(True, True), (False, False), (None, False)])
def testUrlRequiresTrue(tmp_path, urlVerified, eligible):
    gate, source = makeGate(tmp_path, "https://example.test/source")
    assert gate.evaluateReview(source, makeReview(gate, source, urlVerified=urlVerified)).eligible is eligible


@pytest.mark.parametrize("outcome", ["rejected", "changesRequired"])
def testNonApprovalOutcomeBlocks(tmp_path, outcome):
    gate, source = makeGate(tmp_path)
    result = gate.evaluateReview(source, makeReview(gate, source, outcome=outcome))
    assert result.eligible is False and "outcome" in result.failedCriteria


@pytest.mark.parametrize("changes,criterion", [({"moduleId": "OtherModule"}, "moduleId"), ({"sourceId": "OtherSource"}, "sourceId"),
    ({"knowledgeHash": "0" * 64}, "knowledgeHash"), ({"metadataHash": "0" * 64}, "metadataHash")])
def testBindingMismatchesBlock(tmp_path, changes, criterion):
    gate, source = makeGate(tmp_path)
    result = gate.evaluateReview(source, makeReview(gate, source, **changes))
    assert result.eligible is False and criterion in result.failedCriteria


def testHashChangesMakeReviewStale(tmp_path):
    gate, source = makeGate(tmp_path)
    review = makeReview(gate, source)
    changed = source.model_copy(update={"title": "Synthetic changed title"})
    assert "sourceMetadata" in gate.evaluateReview(changed, review).failedCriteria
    gate.catalog.sources[source.sourceId] = changed
    assert "metadataHash" in gate.evaluateReview(changed, review).failedCriteria
    gate.knowledgeChecksums[source.knowledgeFile] = "1" * 64
    assert "knowledgeHash" in gate.evaluateReview(changed, review).failedCriteria


@pytest.mark.parametrize("changes", [{"reviewedAt": datetime(2026, 10, 7)}, {"reviewId": "not-uuid"}, {"reviewerId": "personal@example.test"},
    {"identityVerified": "true"}, {"identityVerified": 1}, {"knowledgeHash": "invalid"}, {"notes": "x" * 501}])
def testStrictReviewFields(tmp_path, changes):
    gate, source = makeGate(tmp_path)
    with pytest.raises(ValidationError):
        makeReview(gate, source, **changes)


@pytest.mark.parametrize("field", ["patientName", "caseText", "clinicalNotes", "retrievedEvidence", "generatedResponse"])
def testCaseFieldsAreForbidden(tmp_path, field):
    gate, source = makeGate(tmp_path)
    with pytest.raises(ValidationError):
        makeReview(gate, source, **{field: "synthetic prohibited content"})


@pytest.mark.parametrize("notes", ["synthetic@example.test", "Jane Example", "1990-01-01", "MRN12345678"])
def testNotesPrivacyIsAlwaysEnabled(tmp_path, notes, caplog):
    gate, source = makeGate(tmp_path)
    fields = makeReview(gate, source).model_dump()
    fields["notes"] = notes
    with pytest.raises(ValidationError) as failure:
        SourceReview.model_validate(fields, context=Settings(piiFilterEnabled=False))
    assert notes not in str(failure.value) and notes not in caplog.text


def testCustomPrivacyPatternsAreApplied(tmp_path):
    gate, source = makeGate(tmp_path)
    fields = makeReview(gate, source).model_dump()
    fields["notes"] = "synthetic forbidden marker"
    with pytest.raises(ValidationError):
        SourceReview.model_validate(fields, context=Settings(piiFilterPatterns=["forbidden marker"]))


def testDuplicateReviewIdsFailClosed(tmp_path):
    gate, source = makeGate(tmp_path)
    review = makeReview(gate, source)
    saveReview(tmp_path, "a.json", review)
    saveReview(tmp_path, "b.json", review)
    with pytest.raises(ReviewConfigError, match="^Invalid source review configuration.$"):
        ReviewStore(tmp_path, "reviews", gate.moduleId)


def testLatestReviewAndRejectionSupersedesApproval(tmp_path):
    gate, source = makeGate(tmp_path)
    earlier = makeReview(gate, source)
    later = makeReview(gate, source, reviewId=UUID("00000000-0000-4000-8000-000000000002"), reviewedAt=earlier.reviewedAt + timedelta(hours=1), outcome="rejected")
    saveReview(tmp_path, "z.json", earlier)
    saveReview(tmp_path, "a.json", later)
    store = ReviewStore(tmp_path, "reviews", gate.moduleId)
    assert store.latestReview(source.sourceId).reviewId == later.reviewId
    gate.reviews = store
    assert gate.evaluateModuleApproval().eligible is False
    assert gate.evaluateModuleApproval().sourceResults[0].failedCriteria == ["outcome"]


def testUuidTieBreakerAndTimezoneOrdering(tmp_path):
    gate, source = makeGate(tmp_path)
    first = makeReview(gate, source)
    second = makeReview(gate, source, reviewId=UUID("00000000-0000-4000-8000-000000000002"),
                        reviewedAt=first.reviewedAt.astimezone(timezone(timedelta(hours=2))), outcome="changesRequired")
    saveReview(tmp_path, "a.json", first)
    saveReview(tmp_path, "z.json", second)
    assert ReviewStore(tmp_path, "reviews", gate.moduleId).latestReview(source.sourceId).reviewId == second.reviewId


def testAllRequiredSourcesAndEmptyRequirements(tmp_path):
    gate, source = makeGate(tmp_path)
    assert gate.evaluateModuleApproval().eligible is False
    assert gate.evaluateModuleApproval().sourceResults[0].failedCriteria == ["reviewMissing"]
    saveReview(tmp_path, "approval.json", makeReview(gate, source))
    gate.reviews = ReviewStore(tmp_path, "reviews", gate.moduleId)
    assert gate.evaluateModuleApproval().eligible is True
    gate.requiredSourceIds = ("Synthetic", "Unknown")
    assert gate.evaluateModuleApproval().eligible is False
    assert "sourceAvailable" in gate.evaluateModuleApproval().sourceResults[1].failedCriteria
    gate.requiredSourceIds = ()
    assert gate.evaluateModuleApproval().eligible is False
    assert gate.evaluateModuleApproval().failedCriteria == ["requiredSources"]


@pytest.mark.parametrize("reviewDirectory", ["../outside", "C:/outside", "/outside", "reviews/../../outside", "missing", ""])
def testReviewDirectoryPathsAreContained(tmp_path, reviewDirectory):
    gate, source = makeGate(tmp_path)
    with pytest.raises(ReviewConfigError):
        ReviewStore(tmp_path, reviewDirectory, gate.moduleId)


@pytest.mark.parametrize("target", ["reviews", "record.json"])
def testCanonicalReviewPathEscapes(tmp_path, monkeypatch, target):
    gate, source = makeGate(tmp_path)
    saveReview(tmp_path, "record.json", makeReview(gate, source))
    outside = tmp_path.parent / (tmp_path.name + "Outside")
    originalResolve = Path.resolve

    def resolvePath(path, *args, **options):
        return outside if path.name == target else originalResolve(path, *args, **options)

    monkeypatch.setattr(Path, "resolve", resolvePath)
    with pytest.raises(ReviewConfigError):
        ReviewStore(tmp_path, "reviews", gate.moduleId)


@pytest.mark.parametrize("content", ["{", "{}", '{"reviewId":1,"reviewId":2}', "x" * 16385], ids=["malformed", "missingFields", "duplicateKeys", "oversized"])
def testInvalidReviewFilesFailClosed(tmp_path, content, caplog):
    gate, source = makeGate(tmp_path)
    (tmp_path / "reviews/record.json").write_text(content, encoding="utf-8")
    with pytest.raises(ReviewConfigError) as failure:
        ReviewStore(tmp_path, "reviews", gate.moduleId)
    assert str(failure.value) == "Invalid source review configuration."
    assert caplog.text == ""


def testMismatchedModuleInStoreFailsClosed(tmp_path):
    gate, source = makeGate(tmp_path)
    saveReview(tmp_path, "record.json", makeReview(gate, source, moduleId="Other"))
    with pytest.raises(ReviewConfigError):
        ReviewStore(tmp_path, "reviews", gate.moduleId)


def testRealModuleHasTenMissingReviewsAndRemainsInactive():
    app = createApp()
    registry = app.state.registry
    result = registry.evaluateModuleApproval("module_01_endo")
    assert result.eligible is False and len(result.sourceResults) == 10
    assert all(not result.eligible and result.failedCriteria == ["reviewMissing"] and result.reviewId is None for result in result.sourceResults)
    assert all(source.status == "pendingReview" for source in registry.listSources("module_01_endo"))
    assert registry.getModule("module_01_endo").active is False
    assert list((Settings().moduleRoot / "module01Endo/reviews").glob("*.json")) == []
    with TestClient(app) as client:
        assert client.get("/ready").status_code == 503
        assert client.get("/v1/modules").json() == {"modules": []}
        assert client.get("/v1/modules/module_01_endo").status_code == 404
        for path in ["/ready", "/v1/modules", "/v1/modules/module_01_endo"]:
            for internal in ["reviewerId", "reviewId", "notes", "knowledgeHash", "metadataHash", "reviewDirectory"]:
                assert internal not in client.get(path).text


def testUnknownSourceNeverGainsEligibility(tmp_path):
    gate, source = makeGate(tmp_path)
    unknown = source.model_copy(update={"sourceId": "Unknown"})
    result = gate.evaluateReview(unknown, makeReview(gate, source))
    assert result.eligible is False and result.failedCriteria == ["sourceAvailable"]


def testLaterStaleReviewNeverFallsBackToApproval(tmp_path):
    gate, source = makeGate(tmp_path)
    earlier = makeReview(gate, source)
    later = makeReview(gate, source, reviewId=UUID("00000000-0000-4000-8000-000000000002"),
                       reviewedAt=earlier.reviewedAt + timedelta(hours=1), metadataHash="0" * 64)
    saveReview(tmp_path, "a.json", earlier)
    saveReview(tmp_path, "b.json", later)
    gate.reviews = ReviewStore(tmp_path, "reviews", gate.moduleId)
    assert gate.evaluateModuleApproval().sourceResults[0].failedCriteria == ["metadataHash"]


def testRegistryIntegrationAndPublicPrivacyWithSyntheticApproval(tmp_path):
    gate, source = makeGate(tmp_path)
    saveReview(tmp_path, "record.json", makeReview(gate, source))
    config = dict(moduleId=gate.moduleId, moduleName="Synthetic", moduleHintValue=gate.moduleId, version="1", kbVersion="1", reviewDate="2026-10-07",
                  jurisdictionNotes="", sourceRegister={}, active=True, status="approved", sourceCatalog="sources.json",
                  knowledgeChecksums=gate.knowledgeChecksums, reviewDirectory="reviews", requiredSourceIds=[source.sourceId])
    (tmp_path / "config.json").write_text(json.dumps(config), encoding="utf-8")
    # A dedicated parent root contains only this module, matching registry layout.
    registryRoot = tmp_path / "registry"
    registryRoot.mkdir()
    moduleRoot = registryRoot / "module"
    moduleRoot.mkdir()
    for filename in ["mirror.bin", "sources.json", "config.json"]:
        shutil.copyfile(tmp_path / filename, moduleRoot / filename)
    shutil.copytree(tmp_path / "reviews", moduleRoot / "reviews")
    app = createApp(Settings(moduleRoot=registryRoot))
    secondApp = createApp(Settings(moduleRoot=registryRoot))
    result = app.state.registry.evaluateModuleApproval(gate.moduleId)
    assert result.eligible is True
    assert app.state.registry.evaluateReview(gate.moduleId, source, makeReview(gate, source)).eligible is True
    assert app.state.registry.approvalGates[gate.moduleId].reviews is not secondApp.state.registry.approvalGates[gate.moduleId].reviews
    result.sourceResults[0].eligible = False
    assert secondApp.state.registry.evaluateModuleApproval(gate.moduleId).eligible is True
    with TestClient(app) as client:
        for path in ["/v1/modules", "/v1/modules/" + gate.moduleId, "/ready"]:
            response = client.get(path)
            assert response.status_code == (503 if path == "/ready" else 200)
            if path == "/ready":
                assert response.json()["reasonCode"] == "analysisUnavailable"
            for private in ["synthetic-reviewer", "administrative", "reviewDirectory", "requiredSourceIds", "knowledgeHash", "metadataHash", str(tmp_path)]:
                assert private not in response.text


def testNotesCannotBypassGateThroughMutation(tmp_path):
    gate, source = makeGate(tmp_path)
    review = makeReview(gate, source)
    review.notes = "synthetic@example.test"
    assert gate.evaluateReview(source, review).failedCriteria == ["reviewValid"]


def testUnreadableReviewFailsClosed(tmp_path, monkeypatch):
    gate, source = makeGate(tmp_path)
    saveReview(tmp_path, "record.json", makeReview(gate, source))
    originalOpen = Path.open

    def openFile(path, *args, **options):
        if path.name == "record.json":
            raise PermissionError("Synthetic private details")
        return originalOpen(path, *args, **options)

    monkeypatch.setattr(Path, "open", openFile)
    with pytest.raises(ReviewConfigError, match="^Invalid source review configuration.$"):
        ReviewStore(tmp_path, "reviews", gate.moduleId)
