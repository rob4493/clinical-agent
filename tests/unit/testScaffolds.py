"""Inactive structural modules only; no new clinical evidence or rule ownership."""

import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.models.input import ClinicalCaseInput
from backend.app.models.module import ClinicalModuleConfig, ModuleStatus
from backend.app.modules.catalog import SourceUnavailableError
from backend.app.modules.module01Endo.urgent import Module1Rules
from backend.app.modules.registry import ModuleRegistry, ModuleUnavailableError, RegistryConfigError

Scaffolds = [
    ("module_02_early_pregnancy", "module02EarlyPregnancy", "Early Pregnancy Pain and Bleeding"),
    ("module_03_pid", "module03Pid", "Pelvic Inflammatory Disease"),
    ("module_04_pcos", "module04Pcos", "Polycystic Ovary Syndrome")]
ModuleIds = ["module_01_endo"] + [moduleId for moduleId, folder, title in Scaffolds]


def readConfig(folder):
    return json.loads((Settings().moduleRoot / folder / "config.json").read_text(encoding="utf-8"))


def writeScaffold(root, folder="scaffold", **changes):
    directory = root / folder
    directory.mkdir(parents=True)
    config = readConfig("module02EarlyPregnancy")
    # This helper builds an evidence-free synthetic scaffold, not the authentic KB.
    config.update(kbVersion=None, reviewDate=None, sourceCatalog=None, reviewDirectory=None, knowledgeChecksums={}, requiredSourceIds=[])
    config.update(changes)
    (directory / "config.json").write_text(json.dumps(config), encoding="utf-8")
    return directory


def testAllFourConfigurationsLoadInCanonicalOrder():
    registry = ModuleRegistry(Settings().moduleRoot)
    assert list(registry.moduleConfigs) == ModuleIds
    assert list(registry.catalogs) == list(registry.approvalGates) == ModuleIds
    assert registry.getModule("module_01_endo").moduleHintValue == "EndometriosisChronicPelvicPain"
    assert registry.listModules() == []


@pytest.mark.parametrize("moduleId,folder,title", Scaffolds)
def testScaffoldHasOnlyDeclaredArtifactsAndUnknownEvidenceMetadata(moduleId, folder, title):
    directory = Settings().moduleRoot / folder
    assert "_" not in directory.name
    expectedFiles = ["candidateClaims.json", "candidatePolicies", "candidates.json", "config.json", "knowledge", "maternal.py", "reviewTemplates", "reviews", "safety.py", "sources.json"] if folder == "module02EarlyPregnancy" else ["config.json"]
    assert sorted(path.name for path in directory.iterdir() if path.name != "__pycache__") == expectedFiles
    registry = ModuleRegistry(Settings().moduleRoot)
    config = registry.getModule(moduleId)
    assert config.moduleId == config.moduleHintValue == moduleId
    assert config.moduleName == title and config.active is False
    assert config.status == ModuleStatus.pendingReview
    assert config.sourceRegister == {} and config.knowledgePath is None and config.urgentRuleIds == []
    assert [caseType.value for caseType in config.supportedCaseTypes] == ["brief", "detailed"]
    assert registry.approvalGates[moduleId].reviews.reviews == []
    eligibility = registry.evaluateModuleApproval(moduleId)
    assert eligibility.eligible is False
    if moduleId == "module_02_early_pregnancy":
        assert config.kbVersion == "1.0" and config.sourceCatalog == "sources.json" and config.reviewDirectory == "reviews"
        assert len(config.knowledgeChecksums) == 5 and len(config.requiredSourceIds) == 15
        assert len(registry.listSources(moduleId)) == 15
        assert all(source.status == "pendingReview" for source in registry.listSources(moduleId))
        assert all(not source.eligible and source.failedCriteria == ["reviewMissing"] for source in eligibility.sourceResults)
    else:
        assert config.kbVersion is config.reviewDate is config.sourceCatalog is config.reviewDirectory is None
        assert config.knowledgeChecksums == {} and config.requiredSourceIds == []
        assert registry.listSources(moduleId) == []
        assert eligibility.failedCriteria == ["requiredSources"]



@pytest.mark.parametrize("moduleId,folder,title", Scaffolds)
def testFormatAcceptanceDoesNotAuthorizeSelection(moduleId, folder, title):
    caseInput = ClinicalCaseInput(moduleHint=moduleId)
    assert caseInput.moduleHint == moduleId
    with pytest.raises(ModuleUnavailableError, match="^Selected module is unavailable.$"):
        ModuleRegistry(Settings().moduleRoot).resolveModule(caseInput.moduleHint)
    with pytest.raises(ValidationError):
        ClinicalCaseInput()


def testAuthenticEndpointsRemainUniformlyUnavailable():
    with TestClient(createApp()) as client:
        assert client.get("/v1/modules").json() == {"modules": []}
        response = client.get("/ready")
        assert response.status_code == 503
        assert response.json() == {"status": "notReady", "availableModuleCount": 0, "reasonCode": "noAvailableModules"}
        outcomes = []
        for moduleId in ModuleIds + ["UnknownModule"]:
            response = client.get("/v1/modules/" + moduleId)
            assert response.status_code == 404
            content = response.json()
            assert content.pop("moduleHint") == moduleId
            outcomes.append(content)
        assert all(content == outcomes[0] for content in outcomes)
        assert outcomes[0]["responseType"] == "ModuleUnavailable"
        assert client.post("/v1/analyze", json={}).status_code == 422


@pytest.mark.parametrize("moduleId,folder,title", Scaffolds)
def testSourcesAndModuleOneRulesNeverAttachToScaffolds(moduleId, folder, title):
    app = createApp()
    for source in app.state.registry.listSources("module_01_endo"):
        with pytest.raises(SourceUnavailableError):
            app.state.registry.getSource(moduleId, source.sourceId)
    caseInput = ClinicalCaseInput(moduleHint=moduleId, pregnancyPossible=True, pidDiagnosedOrPresumed=True,
        urgentFindings={"dizziness": True, "severeIllness": True})
    assert app.state.safety.evaluateCase(caseInput).responseType == "ModuleUnavailable"
    with pytest.raises(ValueError, match="^Safety rules are unavailable for the selected module.$"):
        Module1Rules().evaluate(caseInput, moduleId, ["U1", "U2", "U3"])
    assert app.state.registry.catalogs[moduleId] is not app.state.registry.catalogs["module_01_endo"]
    assert app.state.registry.approvalGates[moduleId] is not app.state.registry.approvalGates["module_01_endo"]


def testInactiveScaffoldCanOmitEveryEvidenceArtifact(tmp_path):
    directory = writeScaffold(tmp_path)
    registry = ModuleRegistry(tmp_path)
    assert registry.getModule("module_02_early_pregnancy").active is False
    assert registry.listSources("module_02_early_pregnancy") == []
    assert list(directory.iterdir()) == [directory / "config.json"]


@pytest.mark.parametrize("changes", [{"active": True}, {"status": "approved"}, {"active": True, "status": "approved"}])
@pytest.mark.parametrize("artifact", ["none", "emptyCatalog", "unreferencedMirror", "missingMirror"])
def testActiveOrApprovedMissingEvidenceFailsClosed(tmp_path, changes, artifact, caplog):
    directory = writeScaffold(tmp_path, **changes)
    config = json.loads((directory / "config.json").read_text(encoding="utf-8"))
    config.update(kbVersion="Synthetic", reviewDate="2026-10-07")
    if artifact != "none":
        config["sourceCatalog"] = "sources.json"
        (directory / "sources.json").write_text('{"sources": []}', encoding="utf-8")
    if artifact in {"unreferencedMirror", "missingMirror"}:
        config["knowledgeChecksums"] = {"mirror.bin": hashlib.sha256(b"Synthetic").hexdigest()}
        if artifact == "unreferencedMirror":
            (directory / "mirror.bin").write_bytes(b"Synthetic")
    (directory / "config.json").write_text(json.dumps(config), encoding="utf-8")
    with pytest.raises(RegistryConfigError) as failure:
        ModuleRegistry(tmp_path)
    assert str(failure.value) == "Invalid module configuration."
    assert str(tmp_path) not in str(failure.value) and caplog.text == ""


@pytest.mark.parametrize("resource", ["knowledgePath", "sourceCatalog", "reviewDirectory", "knowledgeChecksums"])
def testSiblingResourcesFailClosed(tmp_path, resource):
    writeScaffold(tmp_path, "owner", moduleId="Owner", moduleHintValue="Owner")
    directory = writeScaffold(tmp_path, "borrower")
    owner = tmp_path / "owner"
    (owner / "mirror.bin").write_bytes(b"Synthetic")
    (owner / "sources.json").write_text('{"sources": []}', encoding="utf-8")
    (owner / "reviews").mkdir()
    changes = {"knowledgePath": "owner/mirror.bin"} if resource == "knowledgePath" else {
        "sourceCatalog": "../owner/sources.json"} if resource == "sourceCatalog" else {
        "reviewDirectory": "../owner/reviews"} if resource == "reviewDirectory" else {
        "knowledgeChecksums": {"../owner/mirror.bin": hashlib.sha256(b"Synthetic").hexdigest()}}
    config = json.loads((directory / "config.json").read_text(encoding="utf-8"))
    config.update(changes)
    (directory / "config.json").write_text(json.dumps(config), encoding="utf-8")
    with pytest.raises(RegistryConfigError):
        ModuleRegistry(tmp_path)


def testSiblingConfigurationRedirectionFailsClosed(tmp_path, monkeypatch):
    owner = writeScaffold(tmp_path, "owner", moduleId="Owner", moduleHintValue="Owner")
    borrower = writeScaffold(tmp_path, "borrower")
    originalResolve = Path.resolve
    def resolvePath(path, *args, **options):
        if path == borrower / "config.json":
            return owner / "config.json"
        return originalResolve(path, *args, **options)
    monkeypatch.setattr(Path, "resolve", resolvePath)
    with pytest.raises(RegistryConfigError):
        ModuleRegistry(tmp_path)


@pytest.mark.parametrize("duplicate", ["moduleId", "moduleHintValue"])
def testDuplicateScaffoldIdentifiersOrAliasesFailClosed(tmp_path, duplicate):
    writeScaffold(tmp_path, "first")
    changes = {"moduleId": "Other", "moduleHintValue": "Other"}
    changes[duplicate] = "module_02_early_pregnancy"
    writeScaffold(tmp_path, "second", **changes)
    with pytest.raises(RegistryConfigError):
        ModuleRegistry(tmp_path)


def testRegistryOrderDoesNotFollowDirectoryOrCreationOrder(tmp_path):
    for sequence, entries in [("forward", Scaffolds), ("reverse", list(reversed(Scaffolds)))]:
        root = tmp_path / sequence
        for position, (moduleId, folder, title) in enumerate(entries):
            writeScaffold(root, "folder" + str(position), moduleId=moduleId, moduleHintValue=moduleId)
        registry = ModuleRegistry(root)
        assert list(registry.moduleConfigs) == ModuleIds[1:]
        assert list(registry.catalogs) == list(registry.approvalGates) == ModuleIds[1:]


def testFourModuleAppsAndMetadataCopiesRemainIsolated():
    first = createApp()
    second = createApp()
    assert first.state.registry is not second.state.registry
    assert first.state.safety is not second.state.safety
    for moduleId in ModuleIds:
        assert first.state.registry.moduleConfigs[moduleId] is not second.state.registry.moduleConfigs[moduleId]
        assert first.state.registry.catalogs[moduleId] is not second.state.registry.catalogs[moduleId]
        config = first.state.registry.getModule(moduleId)
        config.active = True
        config.urgentRuleIds.append("Synthetic")
        assert first.state.registry.getModule(moduleId).active is False
        assert second.state.registry.getModule(moduleId).urgentRuleIds == []


@pytest.mark.parametrize("extra", [{"approved": False}, {"displayName": "Synthetic"}, {"clinicalCriteria": []}])
def testScaffoldUsesExistingStrictMetadataContract(extra):
    config = readConfig("module02EarlyPregnancy")
    config.update(extra)
    with pytest.raises(ValidationError):
        ClinicalModuleConfig.model_validate(config)
