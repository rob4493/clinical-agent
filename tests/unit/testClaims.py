"""Synthetic appraisal failures plus real document-bound isolation regressions."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.models.candidate import CandidateRecord
from backend.app.models.claim import CandidateClaim, ClaimMatrix, ClaimThreshold
from backend.app.models.module import ModuleStatus
from backend.app.models.retrieval import KnowledgeChunk
from backend.app.modules import claims
from backend.app.modules.claims import AppraisalSources, ClaimError, ClaimStore
from backend.app.modules.registry import ModuleRegistry, ModuleUnavailableError, RegistryConfigError


def makeClaim(**changes):
    claim = dict(claimId="Synthetic", moduleId="module_02_early_pregnancy", category="hcg", statement="Synthetic constrained paraphrase.", sourceStatement="Synthetic source meaning.", sourceCandidateId="m2NiceNg126", sourceDigest=AppraisalSources["m2NiceNg126"][0], jurisdiction="UK", documentSection="Synthetic section", pdfPage=1, evidenceType="agentParaphrase", population="Synthetic population", conditions="Synthetic conditions", limitations="Synthetic limitation", testName="Synthetic serum test", conflictsWith=[], comparedWith=[], status="candidate", useAssessment="neither", recommendationStrength="Synthetic strength")
    claim.update(changes)
    return claim


def makeThreshold(**changes):
    threshold = dict(comparator=">=", amount="48", unit="hours", sourceAmount="48", sourceUnit="hours", population="Synthetic population", context="Synthetic spacing context", sourceCandidateId="m2NiceNg126", documentSection="Synthetic section", pdfPage=1)
    threshold.update(changes)
    return threshold


def writeClaims(root, records):
    (root / "candidateClaims.json").write_text(json.dumps(dict(moduleId="module_02_early_pregnancy", status="candidate", claims=records)), encoding="utf-8")


@pytest.fixture
def sourceCatalog(monkeypatch):
    class SyntheticStore:
        def __init__(self, root):
            pass

        def listCandidates(self):
            return [CandidateRecord(candidateId=sourceId, organization="Synthetic", title="Synthetic", documentType="guideline", jurisdiction=jurisdiction, officialUrl="https://example.org/document", accessedAt="2026-10-07", fullContentAccessible=True, localFile="source.pdf", sha256=digest, fileSize=10, mimeType="application/pdf", evidenceCategories=["hcg"], accessStatus="downloaded", currencyStatus="unresolved", status="candidate", notes="Synthetic fixture only.") for sourceId, (digest, pageCount, jurisdiction) in AppraisalSources.items()]

    monkeypatch.setattr(claims, "CandidateStore", SyntheticStore)


def testStrictValidClaimAndThreshold():
    record = CandidateClaim.model_validate(makeClaim(threshold=makeThreshold()))
    assert record.status == "candidate" and record.threshold.amount == "48"
    assert record.threshold.unit == record.threshold.sourceUnit == "hours"


@pytest.mark.parametrize("fieldName", ["sourceCandidateId", "jurisdiction", "limitations", "documentSection", "pdfPage", "population", "conditions", "status"])
def testRequiredClaimMetadata(fieldName):
    claim = makeClaim()
    claim.pop(fieldName)
    with pytest.raises(ValidationError):
        CandidateClaim.model_validate(claim)


@pytest.mark.parametrize("changes", [{"moduleId": "module_01_endo"}, {"status": "approved"}, {"status": "pendingReview"}, {"unknownField": "Synthetic"}, {"pdfPage": 0}, {"pdfPage": True}, {"pdfPage": "1"}, {"documentSection": " "}, {"limitations": " "}, {"jurisdiction": "Global"}, {"sourceCandidateId": ["m2AcepEarly", "m2NiceNg126"]}, {"testName": None}, {"evidenceType": "sourceDifference"}, {"conflictsWith": ["Synthetic"]}])
def testInvalidClaimContract(changes):
    with pytest.raises(ValidationError):
        CandidateClaim.model_validate(makeClaim(**changes))


@pytest.mark.parametrize("category", ["pregnancyTest", "hcg", "ultrasound"])
def testTestCategoriesRequireTestName(category):
    with pytest.raises(ValidationError):
        CandidateClaim.model_validate(makeClaim(category=category, testName=None))


@pytest.mark.parametrize("fieldName", ["comparator", "amount", "unit", "sourceAmount", "sourceUnit", "population", "context", "sourceCandidateId", "documentSection", "pdfPage"])
def testThresholdRequiresCompleteSourceContext(fieldName):
    threshold = makeThreshold()
    threshold.pop(fieldName)
    with pytest.raises(ValidationError):
        ClaimThreshold.model_validate(threshold)


@pytest.mark.parametrize("changes", [{"amount": "2", "unit": "days"}, {"unit": "minutes"}, {"amount": "48.0"}, {"amount": 48}, {"comparator": "approximately"}, {"context": " "}])
def testThresholdConversionOrRoundingRejected(changes):
    with pytest.raises(ValidationError):
        ClaimThreshold.model_validate(makeThreshold(**changes))


@pytest.mark.parametrize("changes", [{"pdfPage": 2}, {"sourceCandidateId": "m2AcepEarly"}, {"population": "Other population"}, {"documentSection": "Other section"}])
def testThresholdMustMatchClaimProvenance(changes):
    with pytest.raises(ValidationError):
        CandidateClaim.model_validate(makeClaim(threshold=makeThreshold(**changes)))


def testDuplicateClaimIdsRejected(tmp_path, sourceCatalog):
    writeClaims(tmp_path, [makeClaim(), makeClaim()])
    with pytest.raises(ClaimError):
        ClaimStore(tmp_path)
    with pytest.raises(ValidationError):
        ClaimMatrix.model_validate(dict(moduleId="module_02_early_pregnancy", status="candidate", claims=[makeClaim(), makeClaim()]))


@pytest.mark.parametrize("changes", [{"sourceCandidateId": "Missing"}, {"sourceCandidateId": "m2AcogRh"}, {"sourceDigest": "0" * 64}, {"pdfPage": 53}, {"jurisdiction": "US"}, {"comparedWith": ["Missing"]}])
def testSourceAndLocationFailuresArePrivate(tmp_path, sourceCatalog, changes, caplog):
    writeClaims(tmp_path, [makeClaim(**changes)])
    with pytest.raises(ClaimError) as failure:
        ClaimStore(tmp_path)
    assert str(failure.value) == "Invalid candidate claims." and failure.value.__cause__ is None
    assert str(tmp_path) not in str(failure.value) and caplog.text == ""


@pytest.mark.parametrize("relation", ["conflictsWith", "comparedWith"])
def testRelatedClaimsStaySeparate(tmp_path, sourceCatalog, relation):
    first = makeClaim(claimId="First", **{relation: ["Second"]})
    second = makeClaim(claimId="Second", sourceCandidateId="m2AcepEarly", sourceDigest=AppraisalSources["m2AcepEarly"][0], jurisdiction="US", statement="Synthetic distinct statement.", **{relation: ["First"]})
    writeClaims(tmp_path, [second, first])
    store = ClaimStore(tmp_path)
    records = store.listClaims()
    assert [record.claimId for record in records] == ["First", "Second"]
    assert records[0].statement != records[1].statement and all(record.status == "candidate" for record in records)
    records[0].statement = "Changed copy"
    assert store.listClaims()[0].statement == "Synthetic constrained paraphrase."


def testComparisonsCannotManufactureConflict():
    with pytest.raises(ValidationError):
        CandidateClaim.model_validate(makeClaim(conflictsWith=["Other"], comparedWith=["Other"]))


@pytest.mark.parametrize("claimBytes", [b"not JSON", b"x" * 262145, b'{"moduleId":"module_02_early_pregnancy","status":"candidate","claims":[],"claims":[]}'], ids=["malformed", "oversized", "duplicateField"])
def testMalformedClaimFile(tmp_path, sourceCatalog, claimBytes):
    (tmp_path / "candidateClaims.json").write_bytes(claimBytes)
    with pytest.raises(ClaimError):
        ClaimStore(tmp_path)


@pytest.mark.parametrize("relativePath", ["../candidateClaims.json", "..\\candidateClaims.json", "C:\\candidateClaims.json", "/candidateClaims.json"])
def testClaimPathTraversalRejected(tmp_path, sourceCatalog, relativePath):
    with pytest.raises(ClaimError):
        ClaimStore(tmp_path, relativePath)


def testClaimResolvedEscapeRejected(tmp_path, sourceCatalog, monkeypatch):
    writeClaims(tmp_path, [makeClaim()])
    originalResolve = Path.resolve
    def resolvePath(path, *args, **options):
        if path == tmp_path / "candidateClaims.json":
            return tmp_path.parent / "outside.json"
        return originalResolve(path, *args, **options)
    monkeypatch.setattr(Path, "resolve", resolvePath)
    with pytest.raises(ClaimError):
        ClaimStore(tmp_path)


def testAuthenticClaimsAreLocatedCandidates():
    root = Settings().moduleRoot / "module02EarlyPregnancy"
    records = ClaimStore(root).listClaims()
    assert len(records) == len({record.claimId for record in records}) == 30
    assert sum(record.sourceCandidateId == "m2AcepEarly" for record in records) == 8
    assert sum(record.sourceCandidateId == "m2NiceNg126" for record in records) == 22
    assert all(record.moduleId == "module_02_early_pregnancy" and record.status == "candidate" and record.documentSection.strip() and record.pdfPage > 0 and record.limitations.strip() for record in records)
    assert all(record.conflictsWith == [] for record in records)
    for record in records:
        with pytest.raises(ValidationError):
            KnowledgeChunk.model_validate(record.model_dump())


def testClaimsCannotBecomeRuntimeSourceCatalog(tmp_path):
    root = Settings().moduleRoot / "module02EarlyPregnancy"
    module = tmp_path / "module"
    module.mkdir()
    config = json.loads((root / "config.json").read_text(encoding="utf-8"))
    config["sourceCatalog"] = "candidateClaims.json"
    (module / "config.json").write_text(json.dumps(config), encoding="utf-8")
    (module / "candidateClaims.json").write_bytes((root / "candidateClaims.json").read_bytes())
    with pytest.raises(RegistryConfigError):
        ModuleRegistry(tmp_path)


def testCandidateClaimsDoNotAlterServicesOrReadiness():
    app = createApp()
    config = app.state.registry.getModule("module_02_early_pregnancy")
    assert config.active is False and config.status == ModuleStatus.pendingReview
    assert config.sourceCatalog == "sources.json" and config.knowledgePath is None and config.reviewDirectory == "reviews"
    assert config.urgentRuleIds == [] and len(config.requiredSourceIds) == 15
    assert len(config.knowledgeChecksums) == 5
    assert len(app.state.registry.listSources(config.moduleId)) == 15
    assert all(source.status == "pendingReview" for source in app.state.registry.listSources(config.moduleId))
    assert app.state.registry.approvalGates[config.moduleId].reviews.reviews == []
    assert not hasattr(app.state, "claims") and not hasattr(app.state, "claimStore")
    with pytest.raises(ModuleUnavailableError):
        app.state.registry.resolveModule(config.moduleId)
    with TestClient(app) as client:
        response = client.get("/v1/modules")
        assert response.json() == {"modules": []}
        assert "claimId" not in response.text and "candidateClaims" not in response.text
        assert client.get("/ready").status_code == 503
        assert client.get("/v1/modules/" + config.moduleId).status_code == 404
        assert client.post("/v1/analyze", json={}).status_code == 422


def testCurrentlyListedDoesNotApproveOrReaffirm():
    from backend.app.modules.candidates import CandidateStore
    source = next(source for source in CandidateStore(Settings().moduleRoot / "module02EarlyPregnancy").listCandidates() if source.candidateId == "m2AcepEarly")
    assert source.currencyStatus == "currentlyListed" and source.status == "candidate"
    assert source.reaffirmationDate is source.reviewDate is None
    assert "indexing" in source.notes and "age" in source.notes
