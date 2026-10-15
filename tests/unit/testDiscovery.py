"""Read-only API privacy, module gates, and current readiness regressions."""

import json
import hashlib

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.models.discovery import ModuleSummary, ModuleList, ReadinessResponse


def writeModule(root, moduleId="module_01_endo", **changes):
    directory = root / moduleId
    directory.mkdir(parents=True)
    (directory / "content.txt").write_text("Synthetic fixture", encoding="utf-8")
    config = dict(moduleId=moduleId, moduleName="Synthetic module", moduleHintValue="Selection" + moduleId,
                  version="1", kbVersion="1", reviewDate="2026-10-07", jurisdictionNotes="Synthetic internal notes",
                  sourceRegister={"SyntheticSource": {"org": "Synthetic", "title": "Internal source", "jurisdiction": "Synthetic"}},
                  active=True, status="approved", description="Synthetic description", supportedCaseTypes=["brief", "detailed"],
                  knowledgePath=moduleId + "/content.txt", urgentRuleIds=["U1"])
    config.update(changes)
    (directory / "sources.json").write_text(json.dumps({"sources": [dict(sourceId="SyntheticSource", organization="Synthetic", title="Synthetic", knowledgeFile="content.txt", status="pendingReview")]}), encoding="utf-8")
    config["sourceCatalog"] = "sources.json"
    config["knowledgeChecksums"] = {"content.txt": hashlib.sha256((directory / "content.txt").read_bytes()).hexdigest()}
    (directory / "config.json").write_text(json.dumps(config), encoding="utf-8")


def testDefaultLivenessReadinessAndEmptyDiscovery():
    with TestClient(createApp()) as client:
        assert client.get("/health").status_code == 200
        ready = client.get("/ready")
        assert ready.status_code == 503
        assert ready.json() == dict(status="notReady", availableModuleCount=0, reasonCode="noAvailableModules")
        listed = client.get("/v1/modules")
        assert listed.status_code == 200 and listed.json() == {"modules": []}
        assert client.get("/v1/modules/module_01_endo").status_code == 404
        assert client.post("/v1/analyze", json={}).status_code == 422


def testAvailableOnlyAndPublicFields(tmp_path):
    writeModule(tmp_path)
    writeModule(tmp_path, "Disabled", active=False)
    writeModule(tmp_path, "Pending", status="pending_review")
    app = createApp(Settings(moduleRoot=tmp_path, watsonxApiKey="SyntheticApiSecret"))
    with TestClient(app) as client:
        listed = client.get("/v1/modules")
        assert listed.status_code == 200
        summary = listed.json()["modules"]
        assert summary == [dict(moduleId="module_01_endo", displayName="Synthetic module", version="1",
                                description="Synthetic description", supportedCaseTypes=["brief", "detailed"])]
        detail = client.get("/v1/modules/module_01_endo")
        assert detail.status_code == 200 and detail.json() == summary[0]
        ready = client.get("/ready")
        assert ready.status_code == 503
        assert ready.json() == dict(status="notReady", availableModuleCount=1, reasonCode="analysisUnavailable")
        for response in [listed, detail, ready]:
            for internal in [str(tmp_path), "content.txt", "knowledgePath", "Selection", "jurisdictionNotes", "Synthetic internal notes", "SyntheticSource", "urgentRuleIds", "SyntheticApiSecret", "config.json"]:
                assert internal not in response.text


def testUnavailableReasonsAreIndistinguishable(tmp_path):
    responses = []
    for folder, changes in [("unknown", None), ("inactive", {"active": False}), ("pending", {"status": "pending_review"})]:
        root = tmp_path / folder
        root.mkdir()
        if changes is not None:
            writeModule(root, **changes)
        with TestClient(createApp(Settings(moduleRoot=root))) as client:
            response = client.get("/v1/modules/module_01_endo")
            assert response.status_code == 404
            responses.append(response.json())
    assert responses[0] == responses[1] == responses[2]
    assert responses[0]["responseType"] == "ModuleUnavailable"
    assert responses[0]["moduleHint"] == "module_01_endo"
    assert "decisionSupportNotice" in responses[0]


@pytest.mark.parametrize("moduleId", ["Synthetic%20unsafe%20notes", "9Invalid", "a" * 65, "Synthetic%3Csvg%3E"])
def testInvalidIdentifiersNeverEcho(moduleId, caplog):
    with TestClient(createApp()) as client:
        response = client.get("/v1/modules/" + moduleId)
        assert response.status_code == 422
        assert set(response.json()) == {"detail"}
        assert moduleId not in response.text
        assert "Synthetic" not in response.text
        assert "Invalid" not in response.text.replace("Invalid request", "")
    assert "Synthetic" not in caplog.text


def testSeparateAppsAndDependencyOverride(tmp_path):
    firstRoot = tmp_path / "first"
    secondRoot = tmp_path / "second"
    writeModule(firstRoot)
    writeModule(secondRoot, "Other")
    firstApp = createApp(Settings(moduleRoot=firstRoot))
    secondApp = createApp(Settings(moduleRoot=secondRoot))
    with TestClient(firstApp) as first, TestClient(secondApp) as second:
        assert first.get("/v1/modules").json()["modules"][0]["moduleId"] == "module_01_endo"
        assert second.get("/v1/modules").json()["modules"][0]["moduleId"] == "Other"
        assert second.get("/v1/modules/module_01_endo").status_code == 404
        assert first.get("/v1/modules/module_01_endo").status_code == 200


@pytest.mark.parametrize("failureMode", ["missing", "invalid", "listFailure", "resolveFailure"])
def testRegistryFailuresAreSanitized(tmp_path, monkeypatch, failureMode, caplog):
    writeModule(tmp_path)
    app = createApp(Settings(moduleRoot=tmp_path))

    def failRegistry(*args):
        raise RuntimeError("Synthetic secret " + str(tmp_path))

    if failureMode == "missing":
        del app.state.registry
    elif failureMode == "invalid":
        app.state.registry = object()
    else:
        monkeypatch.setattr(app.state.registry, "listModules" if failureMode == "listFailure" else "resolveModule", failRegistry)
    with TestClient(app) as client:
        endpoints = ["/v1/modules/module_01_endo"] if failureMode == "resolveFailure" else ["/ready", "/v1/modules"]
        if failureMode in ["missing", "invalid"]:
            endpoints.append("/v1/modules/module_01_endo")
        for endpoint in endpoints:
            response = client.get(endpoint)
            assert response.status_code == 503
            expected = (dict(status="notReady", availableModuleCount=0, reasonCode="registryUnavailable")
                        if endpoint == "/ready" else dict(reasonCode="registryUnavailable", message="Module discovery is unavailable."))
            assert response.json() == expected
            assert str(tmp_path) not in response.text and "Synthetic secret" not in response.text
        assert client.get("/health").status_code == 200
    assert "Synthetic secret" not in caplog.text and str(tmp_path) not in caplog.text


@pytest.mark.parametrize("model,fields", [
    (ModuleSummary, dict(moduleId="Synthetic", displayName="Synthetic", version="1", description="", supportedCaseTypes=[])),
    (ModuleList, dict(modules=[])),
    (ReadinessResponse, dict(status="notReady", availableModuleCount=0, reasonCode="noAvailableModules"))])
def testPublicModelsRejectExtras(model, fields):
    with pytest.raises(ValidationError):
        model(**fields, knowledgePath="Synthetic/internal")


@pytest.mark.parametrize("count", [-1, True, "1"])
def testReadinessCountIsStrict(count):
    with pytest.raises(ValidationError):
        ReadinessResponse(status="notReady", availableModuleCount=count, reasonCode="noAvailableModules")


def testNotSureDoesNotBecomeAnAnalysisSelection():
    with TestClient(createApp()) as client:
        response = client.get("/v1/modules/NotSure")
        assert response.status_code == 404
        assert response.json()["responseType"] == "ModuleUnavailable"


def testDiscoveryIsReadOnlyAndOpenApiDocumentsErrors():
    with TestClient(createApp()) as client:
        for path in ["/v1/modules", "/v1/modules/module_01_endo", "/ready"]:
            assert client.post(path).status_code == 405
        paths = client.get("/openapi.json").json()["paths"]
        assert "404" in paths["/v1/modules/{moduleId}"]["get"]["responses"]
        assert "503" in paths["/ready"]["get"]["responses"]
