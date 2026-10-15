"""Synthetic private-installation and source-free export boundaries; no publisher bytes."""

import hashlib
import json
from pathlib import Path

import pytest

from tools.evidenceInstall import InstallationError, safePath, verifyFiles, installEvidence
from tools.releaseExport import checkRelease, exportRelease
from backend.competition.storage import evidenceRoot


def syntheticManifest(root):
    content = b"Synthetic nonclinical identity fixture"
    name = "backend/competition/evidence/Synthetic.txt"
    target = root / name
    target.parent.mkdir(parents=True)
    target.write_bytes(content)
    return {"files": [{"path": name, "moduleId": "module_01_endo", "byteSize": len(content),
                      "sha256": hashlib.sha256(content).hexdigest()}]}


def testExactSyntheticBytes(tmp_path, caplog):
    manifest = syntheticManifest(tmp_path)
    assert verifyFiles(tmp_path, manifest) == 1
    assert not caplog.text


@pytest.mark.parametrize("mutation", ["missing", "changed", "stale", "size", "module", "duplicate", "traversal", "absolute", "windows"])
def testPrivateEvidenceFailsClosed(mutation, tmp_path, caplog):
    manifest = syntheticManifest(tmp_path)
    record = manifest["files"][0]
    path = tmp_path / record["path"]
    if mutation == "missing":
        path.unlink()
    elif mutation == "changed":
        path.write_bytes(b"Synthetic altered clinical content and credentials")
    elif mutation == "stale":
        record["sha256"] = "0" * 64
    elif mutation == "size":
        record["byteSize"] += 1
    elif mutation == "module":
        record["moduleId"] = "module_02_early_pregnancy"
    elif mutation == "duplicate":
        manifest["files"].append(dict(record))
    else:
        record["path"] = {"traversal": "../outside.txt", "absolute": "/outside.txt", "windows": "C:\\outside.txt"}[mutation]
    with pytest.raises(InstallationError) as failure:
        verifyFiles(tmp_path, manifest)
    assert str(failure.value) == "Private evidence verification failed."
    assert not caplog.text


def testLinkedAncestorRejected(tmp_path, monkeypatch):
    manifest = syntheticManifest(tmp_path)
    original = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda path: path.name == "competition" or original(path))
    with pytest.raises(InstallationError):
        verifyFiles(tmp_path, manifest)


def testJunctionRejected(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "is_junction", lambda path: path.name == "linked")
    with pytest.raises(InstallationError):
        safePath(tmp_path / "linked", "Synthetic.txt", existing=False)


def testExplicitPrivateRootHasNoFallback(monkeypatch, tmp_path):
    monkeypatch.setenv("CLINICAL_EVIDENCE_ROOT", str(tmp_path / "missing"))
    assert evidenceRoot("evidence") == tmp_path / "missing/backend/competition/evidence"
    monkeypatch.setenv("CLINICAL_EVIDENCE_ROOT", "relative")
    with pytest.raises(ValueError, match="Private evidence is unavailable"):
        evidenceRoot("evidence")


def testInstallationCannotWriteCheckout(tmp_path):
    manifest = syntheticManifest(tmp_path / "intake")
    with pytest.raises(InstallationError):
        installEvidence(tmp_path / "intake", tmp_path / "checkout/private", tmp_path / "checkout", manifest)


def testInstallationVerifiesAfterCopy(tmp_path, monkeypatch):
    from tools import evidenceInstall
    source = tmp_path / "intake"
    manifest = syntheticManifest(source)
    project = tmp_path / "project"
    project.mkdir()
    observed = []
    monkeypatch.setattr(evidenceInstall, "verifyRuntime", lambda root: observed.append(root))
    destination = tmp_path / "private"
    installEvidence(source, destination, project, manifest)
    assert verifyFiles(destination, manifest) == 1 and observed == [destination]
    assert (source / manifest["files"][0]["path"]).exists()
    with pytest.raises(InstallationError):
        installEvidence(source, destination, project, manifest)


def testMetadataHasNoClinicalPassages():
    project = Path(__file__).resolve().parents[2]
    manifest = json.loads((project / "EvidenceSources.example.json").read_bytes())
    assert len(manifest["packages"]) == 2
    assert len(manifest["packages"][0]["claimIds"]) == 57
    assert len(manifest["packages"][1]["claimIds"]) == 21
    forbidden = {"supportedStatement", "sourceStatement", "retrievalText", "statement", "claims"}
    def inspectFields(content):
        if isinstance(content, dict):
            assert not forbidden.intersection(content)
            for nested in content.values():
                inspectFields(nested)
        elif isinstance(content, list):
            for nested in content:
                inspectFields(nested)
    inspectFields(manifest)


def testReleaseContainsNoProtectedFiles(tmp_path):
    project = Path(__file__).resolve().parents[2]
    names = (project / "ReleaseFiles.txt").read_text().splitlines()
    digests = checkRelease(project, names)
    assert "LICENSE" in digests and "THIRD_PARTY_NOTICES.md" in digests
    destination = tmp_path / "release"
    assert exportRelease(project, destination) == digests
    assert sorted(path.relative_to(destination).as_posix() for path in destination.rglob("*") if path.is_file()) == names
    private = json.loads((project / "EvidenceSources.example.json").read_bytes())["files"][0]["path"]
    with pytest.raises(InstallationError):
        checkRelease(project, sorted(set(names + [private])))


def testCompletePrivateInstallationAndTampering(tmp_path):
    """Existing local authorized fixtures remain private; no source content is printed."""
    from tools.evidenceInstall import verifyRuntime
    project = Path(__file__).resolve().parents[2]
    manifest = json.loads((project / "EvidenceSources.example.json").read_bytes())
    if not all((project / record["path"]).is_file() for record in manifest["files"]):
        pytest.skip("Private integration fixtures require an authorized evidence installation.")
    public = tmp_path / "public"
    exportRelease(project, public)
    private = tmp_path / "private"
    installEvidence(project, private, public, manifest)
    assert verifyFiles(private, manifest) == 30
    verifyRuntime(private)
    altered = private / "backend/competition/module02Evidence/package.json"
    altered.write_bytes(altered.read_bytes() + b" ")
    with pytest.raises(InstallationError):
        verifyRuntime(private)


@pytest.mark.parametrize("mode", ["synthetic", "standard"])
def testSourceFreeAppWithoutEvidence(mode, monkeypatch):
    from tools.runDemo import configureDemo
    from backend.app.config import Settings
    from backend.app.main import createApp
    from fastapi.testclient import TestClient
    # Restore environment after checking the explicit source-free composition.
    for name in ["MODULE_ROOT", "CLINICAL_RUNTIME_MODE", "CLINICAL_DEMO_MODE", "LANGUAGE_PROVIDER", "CLINICAL_EVIDENCE_ROOT"]:
        monkeypatch.setenv(name, "")
    configureDemo(mode)
    client = TestClient(createApp(Settings()))
    assert client.get("/health").status_code == 200
    assert client.get("/ready").status_code == (200 if mode == "synthetic" else 503)
    assert all(not config.active for config in client.app.state.authenticRegistry.moduleConfigs.values())
    assert client.app.state.authenticRegistry.listModules() == []


def testMissingPrivateInstallationCannotEnableCompetition(tmp_path):
    from tools.runDemo import configureDemo
    with pytest.raises(InstallationError):
        configureDemo("competition", tmp_path / "missing")
