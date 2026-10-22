"""Synthetic annotation validation and authentic packet/runtime isolation regressions."""

import hashlib
import json
import re
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.main import createApp
from backend.app.models.retrieval import KnowledgeChunk
from backend.app.models.review import SourceReview
from backend.app.modules.catalog import CatalogError, CatalogStore
from tools.clinicalPacket import PacketError, PacketSnapshot, Questions, renderPacket

Root = Path(__file__).resolve().parents[2]
ModulePath = "backend/app/modules/module02EarlyPregnancy"
TemplatePath = ModulePath + "/reviewTemplates/Module02BlankReview.json"


def readTemplate():
    return json.loads((Root / TemplatePath).read_bytes())


def encoded(template):
    return json.dumps(template).encode("utf-8")


def completedTemplate():
    template = readTemplate()
    template["header"].update(reviewerId="synthetic-reviewer", qualification="synthetic clinician role", jurisdiction="US",
        reviewDate="2026-10-07", scopeVersion="sha256:" + template["binding"]["scopeHash"],
        conflictDeclaration="synthetic declaration", overallStatus="completed", completedAt="2026-10-07T12:00:00Z")
    for field in ["acepHash", "niceHash", "claimsHash", "catalogHash"]:
        template["header"][field] = template["binding"][field]
    for claim in template["claims"]:
        claim.update(decision="approve", futureUses=["notForAgentUse"])
        claim["questions"] = {field: "yes" for field in Questions}
        for section in ["urgentReview", "thresholdReview"]:
            if claim[section] is not None:
                claim[section] = {field: "synthetic verification" for field in claim[section]}
        if claim["urgentReview"] is not None:
            claim["urgentReview"].update(deterministicAppropriate="no", retrievalOnly="yes")
        if claim["thresholdReview"] is not None:
            claim["thresholdReview"].update(repeatRequired="yes", interpretation="neither")
    for source in template["sources"]:
        source.update({field: "yes" for field in source if field not in {"candidateId", "comments", "outcome"}})
        source.update(knowledgeHashVerified="notApplicable", outcome="changesRequired", comments="synthetic source limitations")
    return template


def copyArtifacts(root):
    moduleRoot = root / ModulePath
    shutil.copytree(Root / ModulePath, moduleRoot)
    (root / "docs").mkdir()
    shutil.copyfile(Root / "docs/Module02Scope.md", root / "docs/Module02Scope.md")
    return moduleRoot


def testAuthenticPacketContainsEachClaimExactlyOnceAndPreservesText():
    snapshot = PacketSnapshot(Root)
    packet = (Root / "docs/Module02ClinicalReviewPacket.md").read_text(encoding="utf-8")
    ids = re.findall(r"^### Claim: (\S+)$", packet, re.MULTILINE)
    assert len(ids) == len(set(ids)) == len(snapshot.claims) == 30
    assert set(ids) == {claim.claimId for claim in snapshot.claims}
    for claim in snapshot.claims:
        card = packet.split("### Claim: " + claim.claimId + "\n", 1)[1].split("### Claim:", 1)[0]
        assert claim.statement in card
        assert claim.population in card and claim.conditions in card and claim.limitations in card
        assert all(question in card for question in Questions.values())
    assert packet.count("#### Explicit urgent-rule verification") == 3
    assert packet.count("#### Explicit threshold verification") == 1
    assert str(Root) not in packet and "knowledge/sources" not in packet and "backend/app" not in packet


def testAuthenticTemplateIsBlankBoundAndDeterministic():
    snapshot = PacketSnapshot(Root)
    template = snapshot.validateTemplate((Root / TemplatePath).read_bytes())
    assert template == snapshot.blankTemplate()
    assert all(answer is None for answer in template.header.model_dump().values())
    assert len(template.claims) == 30
    for claim in template.claims:
        assert claim.decision is claim.correction is claim.comments is claim.futureUses is None
        assert all(answer is None for answer in claim.questions.model_dump().values())
        for section in [claim.urgentReview, claim.thresholdReview]:
            assert section is None or all(answer is None for answer in section.model_dump().values())
    for source in template.sources:
        assert all(answer is None for field, answer in source.model_dump().items() if field != "candidateId")
    assert renderPacket(snapshot) == renderPacket(PacketSnapshot(Root)) == (Root / "docs/Module02ClinicalReviewPacket.md").read_text(encoding="utf-8")
    assert template.model_dump_json(indent=2) + "\n" == (Root / TemplatePath).read_text(encoding="utf-8")
    paths = {"claimsHash": ModulePath + "/candidateClaims.json", "catalogHash": ModulePath + "/candidates.json", "scopeHash": "docs/Module02Scope.md"}
    for field, path in paths.items():
        assert getattr(template.binding, field) == hashlib.sha256((Root / path).read_bytes()).hexdigest()
    for field, sourceId in [("acepHash", "m2AcepEarly"), ("niceHash", "m2NiceNg126")]:
        source = snapshot.sources[sourceId]
        assert getattr(template.binding, field) == source.sha256 == hashlib.sha256((Root / ModulePath / source.localFile).read_bytes()).hexdigest()


@pytest.mark.parametrize("change", ["unknown", "duplicate", "missing"])
def testInvalidClaimMembershipRejected(change):
    template = readTemplate()
    if change == "unknown":
        template["claims"][0]["claimId"] = "syntheticUnknown"
    elif change == "duplicate":
        template["claims"].append(template["claims"][0])
    else:
        template["claims"].pop()
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(encoded(template))


@pytest.mark.parametrize("field", ["acepHash", "niceHash", "claimsHash", "catalogHash", "scopeHash"])
def testStaleBindingRejected(field):
    template = readTemplate()
    template["binding"][field] = "0" * 64
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(encoded(template))


@pytest.mark.parametrize("artifact", ["acep", "nice", "claims", "catalog", "scope"])
def testChangesAfterSnapshotCreationInvalidatePacket(tmp_path, artifact):
    moduleRoot = copyArtifacts(tmp_path)
    snapshot = PacketSnapshot(tmp_path)
    paths = {"acep": moduleRoot / snapshot.sources["m2AcepEarly"].localFile,
        "nice": moduleRoot / snapshot.sources["m2NiceNg126"].localFile,
        "claims": moduleRoot / "candidateClaims.json", "catalog": moduleRoot / "candidates.json", "scope": tmp_path / "docs/Module02Scope.md"}
    with paths[artifact].open("ab") as stream:
        stream.write(b"\n")
    with pytest.raises(PacketError):
        snapshot.validateTemplate((Root / TemplatePath).read_bytes())


@pytest.mark.parametrize("decision,field", [("approveWithEdits", "correction"), ("reject", "comments"), ("needsAdditionalEvidence", "comments"), ("outOfScope", "comments")])
@pytest.mark.parametrize("response", [None, "", "   "])
def testDecisionDependencies(decision, field, response):
    template = readTemplate()
    template["claims"][0].update(decision=decision)
    template["claims"][0][field] = response
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(encoded(template))


def testSyntheticCompletedReviewAndCorrectedDraftValidateWithoutMutation():
    snapshot = PacketSnapshot(Root)
    complete = completedTemplate()
    assert snapshot.validateTemplate(encoded(complete), completed=True).header.overallStatus == "completed"
    draft = readTemplate()
    draft["claims"][0].update(decision="approveWithEdits", correction="synthetic evidence correction")
    assert snapshot.validateTemplate(encoded(draft)).claims[0].correction == "synthetic evidence correction"
    assert all(claim.decision is None for claim in snapshot.blankTemplate().claims)


@pytest.mark.parametrize("field", ["qualification", "jurisdiction", "completedAt", "reviewerId", "conflictDeclaration"])
def testIncompleteReviewHeaderRejected(field):
    template = completedTemplate()
    template["header"][field] = None
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(encoded(template), completed=True)


def testBlankDraftCannotPassCompletionGate():
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate((Root / TemplatePath).read_bytes(), completed=True)


@pytest.mark.parametrize("timestamp", ["2026-10-07T12:00:00", "2026-10-07", "invalid"])
def testNaiveOrInvalidTimestampRejected(timestamp):
    template = completedTemplate()
    template["header"]["completedAt"] = timestamp
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(encoded(template))


@pytest.mark.parametrize("section", ["root", "header", "claim", "questions", "source", "urgent", "threshold", "binding"])
@pytest.mark.parametrize("field", ["unknown", "patientName", "caseText"])
def testExtraAndPatientFieldsRejected(section, field, caplog):
    template = readTemplate()
    targets = {"root": template, "header": template["header"], "claim": template["claims"][0],
        "questions": template["claims"][0]["questions"], "source": template["sources"][0], "binding": template["binding"],
        "urgent": next(claim["urgentReview"] for claim in template["claims"] if claim["urgentReview"] is not None),
        "threshold": next(claim["thresholdReview"] for claim in template["claims"] if claim["thresholdReview"] is not None)}
    targets[section][field] = "synthetic confidential submission"
    with pytest.raises(PacketError) as failure:
        PacketSnapshot(Root).validateTemplate(encoded(template))
    assert str(failure.value) == "Invalid or stale review template." and caplog.text == ""
    assert "synthetic confidential submission" not in str(failure.value)


def testDuplicateJsonKeysRejected():
    content = (Root / TemplatePath).read_bytes().replace(b'"decision": null', b'"decision": null, "decision": "approve"', 1)
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(content)


@pytest.mark.parametrize("section", ["urgentReview", "thresholdReview"])
def testSafetySectionsCannotBeRemovedOrLeftIncomplete(section):
    template = readTemplate()
    claim = next(claim for claim in template["claims"] if claim[section] is not None)
    claim[section] = None
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(encoded(template))
    template = completedTemplate()
    claim = next(claim for claim in template["claims"] if claim[section] is not None)
    claim[section][next(iter(claim[section]))] = None
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(encoded(template), completed=True)


def testReviewAnnotationsCannotBecomeEvidenceOrAuthenticApproval():
    template = readTemplate()
    with pytest.raises(ValidationError):
        KnowledgeChunk.model_validate(template["claims"][0])
    with pytest.raises(ValidationError):
        SourceReview.model_validate(template["sources"][0])
    with pytest.raises(CatalogError):
        CatalogStore(Root / ModulePath, "reviewTemplates/Module02BlankReview.json", {})
    with TestClient(createApp()) as client:
        registry = client.app.state.registry
        config = registry.getModule("module_02_early_pregnancy")
        assert config.active is False and config.status.value == "pending_review"
        assert config.reviewDirectory == "reviews" and config.sourceCatalog == "sources.json" and config.knowledgePath is None
        assert config.sourceRegister == {} and len(config.knowledgeChecksums) == 5
        assert len(config.requiredSourceIds) == 15 and config.urgentRuleIds == []
        assert len(registry.listSources(config.moduleId)) == 15
        assert all(source.status == "pendingReview" for source in registry.listSources(config.moduleId))
        assert registry.approvalGates[config.moduleId].reviews.reviews == []
        assert client.get("/v1/modules").json() == {"modules": []}
        assert client.get("/ready").status_code == 503
    assert list((Root / ModulePath / "reviews").glob("*.json")) == []


def testValidationNeverWritesEvidenceOrApprovals():
    paths = [path for path in (Root / ModulePath).rglob("*") if path.is_file()]
    before = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    PacketSnapshot(Root).validateTemplate(encoded(completedTemplate()), completed=True)
    assert before == {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    assert set(paths) == {path for path in (Root / ModulePath).rglob("*") if path.is_file()}


def testKnowledgeHashCannotBeFalselyAttested():
    template = completedTemplate()
    template["sources"][0]["knowledgeHashVerified"] = "yes"
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(encoded(template), completed=True)


def testDirectIdentifierInNotesRejectedWithoutEcho(caplog):
    template = readTemplate()
    template["claims"][0]["comments"] = "synthetic.person@example.invalid"
    with pytest.raises(PacketError) as failure:
        PacketSnapshot(Root).validateTemplate(encoded(template))
    assert "example.invalid" not in str(failure.value) and caplog.text == ""


@pytest.mark.parametrize("missing", ["decision", "question", "futureUses", "sourceOutcome", "headerHash", "scopeVersion"])
def testCompletedReviewRequiresDecisionsQuestionsUsesAndVerifiedBinding(missing):
    template = completedTemplate()
    if missing == "decision":
        template["claims"][0].update(decision=None, futureUses=None)
    elif missing == "question":
        template["claims"][0]["questions"]["faithfulParaphrase"] = None
    elif missing == "futureUses":
        template["claims"][0]["futureUses"] = None
    elif missing == "sourceOutcome":
        template["sources"][0]["outcome"] = None
    elif missing == "headerHash":
        template["header"]["acepHash"] = "0" * 64
    else:
        template["header"]["scopeVersion"] = "sha256:" + "0" * 64
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(encoded(template), completed=True)


@pytest.mark.parametrize("uses", [["unknown"], ["notForAgentUse", "retrievalExplanation"], ["retrievalExplanation", "retrievalExplanation"], []])
def testInvalidFutureUsesRejected(uses):
    template = readTemplate()
    template["claims"][0].update(decision="approve", futureUses=uses)
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(encoded(template))


def testNewUrgentUseCannotBypassSeparatelyScopedSafetyReview():
    template = readTemplate()
    template["claims"][0].update(decision="approve", futureUses=["urgentRuleCandidate"])
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(encoded(template))


@pytest.mark.parametrize("sourceId", ["m2Unknown", "m2NiceNg126"])
def testUnknownAndDuplicateSourceAnnotationsRejected(sourceId):
    template = readTemplate()
    template["sources"][0]["candidateId"] = sourceId
    with pytest.raises(PacketError):
        PacketSnapshot(Root).validateTemplate(encoded(template))
