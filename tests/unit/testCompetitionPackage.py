"""Competition eligibility and byte provenance never grant production approval."""

import hashlib
import json
import shutil
from pathlib import Path

import pytest

from backend.competition.integrity import PackageHash
from backend.competition.package import PackageError, loadPackage

EvidenceRoot = Path(__file__).resolve().parents[2] / "backend/competition/evidence"


def copyPackage(root):
    destination = root / "evidence"
    shutil.copytree(EvidenceRoot, destination)
    return destination


def writeManifest(root, manifest):
    contents = json.dumps(manifest).encode("utf-8")
    (root / "package.json").write_bytes(contents)
    return hashlib.sha256(contents).hexdigest()


def testCompetitionPackageSourceAndClaimBindings():
    package = loadPackage(EvidenceRoot, PackageHash, "competition")
    assert len(package.sources) == 6 and len(package.claims) == 57
    assert package.moduleId == "module_01_endo"
    assert package.moduleHint == "EndometriosisChronicPelvicPain"
    assert package.productionApproved is False
    assert len({claim.claimId for claim in package.claims}) == len(package.claims)
    assert all(claim.competitionStatus == "competitionEligible" and claim.productionApproved is False for claim in package.claims)
    assert all(claim.sourceLocation and claim.conditions and claim.limitations and claim.verificationTimestamp.utcoffset() is not None for claim in package.claims)
    sources = {source.sourceId: source for source in package.sources}
    assert set(sources) == {"WHO-2025", "NICE-NG73", "NICHD-DX", "ACOG-CPP", "ACOG-ECTOPIC", "CDC-PID"}
    for claim in package.claims:
        assert claim.sourceFileHash == sources[claim.sourceId].sha256
        assert claim.sourceOrganization == sources[claim.sourceId].organization
    for sourceId in ("NICE-NG73", "ACOG-CPP", "ACOG-ECTOPIC"):
        assert sources[sourceId].urlVerificationStatus == "unresolved"
    assert sources["ACOG-CPP"].provenance == sources["ACOG-ECTOPIC"].provenance == "user-supplied browser capture"
    assert {claim.claimId for claim in package.claims}.isdisjoint({"N10", "N11", "N23", "N24", "N28", "N29", "C12", "C13", "C15"})


@pytest.mark.parametrize("runtimeMode", ["standard", "synthetic", "production", "", "Competition"])
def testOtherModesCannotLoadCompetitionEvidence(runtimeMode, caplog):
    with pytest.raises(PackageError) as failure:
        loadPackage(EvidenceRoot, PackageHash, runtimeMode)
    assert str(failure.value) == "Competition evidence is unavailable." and not caplog.text


@pytest.mark.parametrize("fileName", ["package.json", "NICE-NG73-Endometriosis.pdf", "ACOG-Chronic-Pelvic-Pain.pdf", "ACOG-Ectopic-Pregnancy.pdf", "WHO-2025.html", "NICHD-DX.html", "CDC-PID.html"])
def testChangedOrMissingArtifactsFailClosed(fileName, tmp_path, caplog):
    root = copyPackage(tmp_path)
    artifact = root / fileName
    original = artifact.read_bytes()
    artifact.write_bytes(original + b"Synthetic tampering")
    with pytest.raises(PackageError):
        loadPackage(root, PackageHash, "competition")
    artifact.unlink()
    with pytest.raises(PackageError):
        loadPackage(root, PackageHash, "competition")
    assert not caplog.text


@pytest.mark.parametrize("mutation", ["duplicateClaim", "duplicateSource", "module", "approval", "sourceHash", "sourceTitle", "sourceOrganization", "sourceUrl", "eligibility", "naiveTime", "unknownField", "traversal", "windowsTraversal", "absolutePath"])
def testMalformedOrMismatchedManifestFailsClosed(mutation, tmp_path, caplog):
    root = copyPackage(tmp_path)
    manifest = json.loads((root / "package.json").read_bytes())
    claim = manifest["claims"][0]
    if mutation == "duplicateClaim":
        manifest["claims"].append(claim)
    elif mutation == "duplicateSource":
        manifest["sources"][1] = manifest["sources"][0]
    elif mutation == "module":
        claim["moduleId"] = "SyntheticOtherModule"
    elif mutation == "approval":
        claim["productionApproved"] = True
    elif mutation == "sourceHash":
        claim["sourceFileHash"] = "0" * 64
    elif mutation == "sourceTitle":
        claim["documentTitle"] = "Synthetic substituted title"
    elif mutation == "sourceOrganization":
        claim["sourceOrganization"] = "Synthetic substituted organization"
    elif mutation == "sourceUrl":
        claim["officialUrl"] = "https://example.invalid/substituted"
    elif mutation == "eligibility":
        claim["competitionStatus"] = "approved"
    elif mutation == "naiveTime":
        claim["verificationTimestamp"] = "2026-10-13T12:00:00"
    elif mutation == "unknownField":
        claim["caseText"] = "Synthetic forbidden field"
    else:
        manifest["sources"][0]["fileName"] = {"traversal":"../outside.pdf", "windowsTraversal":"..\\outside.pdf", "absolutePath":"C:\\outside.pdf"}[mutation]
    digest = writeManifest(root, manifest)
    with pytest.raises(PackageError) as failure:
        loadPackage(root, digest, "competition")
    assert str(failure.value) == "Competition evidence is unavailable." and not caplog.text


def testDuplicateJsonKeysFailClosed(tmp_path):
    root = copyPackage(tmp_path)
    contents = (root / "package.json").read_bytes()
    contents = contents.replace(b'"productionApproved": false,', b'"productionApproved": false, "productionApproved": false,', 1)
    (root / "package.json").write_bytes(contents)
    with pytest.raises(PackageError):
        loadPackage(root, hashlib.sha256(contents).hexdigest(), "competition")


def testLinkedArtifactRejectedWithoutFollowingIt(tmp_path, monkeypatch):
    root = copyPackage(tmp_path)
    originalCheck = Path.is_symlink
    def checkLink(path):
        return path.name == "WHO-2025.html" or originalCheck(path)
    monkeypatch.setattr(Path, "is_symlink", checkLink)
    with pytest.raises(PackageError):
        loadPackage(root, PackageHash, "competition")


def testLinkedRootRejected(tmp_path, monkeypatch):
    root = copyPackage(tmp_path)
    originalCheck = Path.is_junction
    def checkJunction(path):
        return path == root or originalCheck(path)
    monkeypatch.setattr(Path, "is_junction", checkJunction)
    with pytest.raises(PackageError):
        loadPackage(root, PackageHash, "competition")


def testPackagePinIsExact():
    assert hashlib.sha256((EvidenceRoot / "package.json").read_bytes()).hexdigest() == PackageHash


@pytest.mark.parametrize("sourceUrl", ["javascript:synthetic", "ftp://example.invalid/source", "https://user:synthetic@example.invalid/source", "https://example.invalid/source#fragment", "not a URL"])
def testInvalidSourceUrlRejectedEvenWithMatchingBindings(sourceUrl, tmp_path):
    root = copyPackage(tmp_path)
    manifest = json.loads((root / "package.json").read_bytes())
    source = manifest["sources"][0]
    source["officialUrl"] = sourceUrl
    for claim in manifest["claims"]:
        if claim["sourceId"] == source["sourceId"]:
            claim["officialUrl"] = sourceUrl
    digest = writeManifest(root, manifest)
    with pytest.raises(PackageError):
        loadPackage(root, digest, "competition")


def testCompetitionPackageDoesNotPromoteAuthenticReadiness():
    from fastapi.testclient import TestClient
    from backend.app.config import Settings
    from backend.app.main import createApp
    app = createApp(Settings())
    assert len(app.state.authenticRegistry.moduleConfigs) == 4
    assert all(not config.active and config.status != "approved" for config in app.state.authenticRegistry.moduleConfigs.values())
    moduleCatalog = app.state.authenticRegistry.catalogs["module_01_endo"]
    assert len(moduleCatalog.listSources()) == 10
    assert all(source.status == "pendingReview" for source in moduleCatalog.listSources())
    with TestClient(app) as client:
        assert client.get("/ready").status_code == 503
        assert client.get("/v1/runtime").json()["mode"] == "standard"
        assert client.get("/v1/modules").json()["modules"] == []


def testPackageAndOrdinaryConstructionMakeNoConnectionAttempts(monkeypatch):
    import socket
    import grpc
    import httpx
    from backend.app.config import Settings
    from backend.app.main import createApp
    counts = {"socket": 0, "dns": 0, "http": 0, "grpc": 0}
    def block(category):
        def reject(*arguments, **options):
            counts[category] += 1
            raise AssertionError("External operation prohibited.")
        return reject
    for method in ("connect", "connect_ex"):
        monkeypatch.setattr(socket.socket, method, block("socket"))
    monkeypatch.setattr(socket, "getaddrinfo", block("dns"))
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", block("http"))
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", block("http"))
    for owner in (grpc, grpc.aio):
        for method in ("secure_channel", "insecure_channel"):
            monkeypatch.setattr(owner, method, block("grpc"))
    package = loadPackage(EvidenceRoot, PackageHash, "competition")
    app = createApp(Settings())
    assert len(package.sources) == 6 and app.state.analysis is None
    assert counts == {"socket": 0, "dns": 0, "http": 0, "grpc": 0}
