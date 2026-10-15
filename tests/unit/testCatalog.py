"""Source provenance, mirror integrity, and internal-only catalog regressions."""

import hashlib
import json
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.models.catalog import SourceRecord
from backend.app.modules.catalog import CatalogError, CatalogStore, SourceUnavailableError
from backend.app.modules.registry import ModuleRegistry, RegistryConfigError, ModuleUnavailableError


def makeSource(sourceId="Synthetic", **changes):
    source = dict(sourceId=sourceId, organization="Synthetic organization", title="Synthetic title",
                  knowledgeFile="knowledge/mirror.bin", status="pendingReview")
    source.update(changes)
    return source


def writeCatalog(root, sources=None):
    root.mkdir(parents=True, exist_ok=True)
    (root / "knowledge").mkdir(exist_ok=True)
    mirror = root / "knowledge/mirror.bin"
    mirror.write_bytes(b"Synthetic document")
    (root / "sources.json").write_text(json.dumps({"sources": [makeSource()] if sources is None else sources}), encoding="utf-8")
    return {"knowledge/mirror.bin": hashlib.sha256(mirror.read_bytes()).hexdigest()}


def writeModule(root, moduleId, sources=None):
    directory = root / moduleId
    checksums = writeCatalog(directory, sources)
    config = dict(moduleId=moduleId, moduleName="Synthetic", moduleHintValue=moduleId, version="1", kbVersion="1",
                  reviewDate="2026-10-07", jurisdictionNotes="", active=True, status="approved", sourceRegister={},
                  sourceCatalog="sources.json", knowledgeChecksums=checksums)
    (directory / "config.json").write_text(json.dumps(config), encoding="utf-8")
    return directory


def testAuthenticMirrorChecksumIdentifiersAndMetadata():
    authoritative = Path("docs/ClinicianDecisionKnowledgeBaseV2.1.docx")
    root = Settings().moduleRoot / "module01Endo"
    config = json.loads((root / "config.json").read_text(encoding="utf-8"))
    mirrorName = "knowledge/ClinicianDecisionKnowledgeBaseV2.1.docx"
    expected = "9c978751f88e7adf27dc8dbc2402d75ff518f34494a7a5cdc4a89f8c5fbd3162"
    assert authoritative.read_bytes() == (root / mirrorName).read_bytes()
    assert hashlib.sha256(authoritative.read_bytes()).hexdigest() == expected
    assert config["knowledgeChecksums"] == {mirrorName: expected}
    assert config["version"] == config["kbVersion"] == "2.1"
    assert config["reviewDate"] == "2026-10-13"
    assert config["active"] is False and config["status"] == "pending_review"
    registry = ModuleRegistry(Settings().moduleRoot)
    sources = registry.listSources("module_01_endo")
    expectedIds = ["ACOG-CPP", "ACOG-ECTOPIC", "ACOG-ENDO-DX-2026", "ACOG-FIBROIDS",
                   "CDC-PID", "ESHRE-ENDO-2022", "NICE-NG73", "NICHD-DX", "SRU-US-2024", "WHO-2025"]
    assert [source.sourceId for source in sources] == expectedIds
    assert len(sources) == len({source.sourceId for source in sources}) == 10
    assert config["requiredSourceIds"] == expectedIds
    assert config["sourceRegister"] == {} and config["urgentRuleIds"] == []
    assert all(source.status == "pendingReview" and source.knowledgeFile == mirrorName for source in sources)
    with ZipFile(authoritative) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
        paragraphs = ["".join(node.text or "" for node in paragraph.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"))
                      for paragraph in document.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p")]
    register = paragraphs[paragraphs.index("13 Source register") + 1:paragraphs.index("14 Maintenance and validation")]
    aliases = {"WHO-2025": "WHO-ENDO-2025", "ACOG-CPP": "ACOG-CPP-2025", "NICHD-DX": "NICHD-DX-2020",
               "ACOG-ECTOPIC": "ACOG-ECTOPIC-2026", "CDC-PID": "CDC-PID-2021"}
    newIds = {"ACOG-ENDO-DX-2026", "ACOG-FIBROIDS", "ESHRE-ENDO-2022", "SRU-US-2024"}
    for source in sources:
        registerId = aliases.get(source.sourceId, source.sourceId)
        index = next(index for index, entry in enumerate(register) if entry.endswith("] " + registerId))
        metadata = register[index + 1]
        assert "Organization: " + source.organization + "Title:" in metadata
        assert "Title: " + source.title + "Date:" in metadata
        assert "Jurisdiction: " + source.jurisdiction + "Official URL:" in metadata
        assert "V2.1 register ID: " + registerId + "." in source.notes
        assert "not independently reverified" in source.notes
        if source.sourceId in newIds:
            assert source.verifiedUrl is None
            candidateUrl = metadata.split("Official URL: ", 1)[1].split("Approved use:", 1)[0]
            assert "Candidate official URL (not verified): " + candidateUrl in source.notes
        else:
            assert "Official URL: " + source.verifiedUrl + "Approved use:" in metadata
        if source.publicationDate is not None:
            assert source.publicationDate in metadata
        if source.reviewDate is not None:
            assert source.reviewDate in metadata
    assert registry.getSource("module_01_endo", "NICE-NG73").publicationDate == "6 September 2017"
    assert registry.getSource("module_01_endo", "NICE-NG73").reviewDate == "2 September 2025"
    assert registry.getSource("module_01_endo", "NICHD-DX").reviewDate == "21 February 2020"
    assert registry.getSource("module_01_endo", "WHO-2025").publicationDate == "15 October 2025"
    assert registry.getSource("module_01_endo", "ACOG-CPP").reviewDate == "July 2025"
    assert registry.getSource("module_01_endo", "ACOG-ECTOPIC").reviewDate == "April 2026"
    assert registry.getSource("module_01_endo", "CDC-PID").reviewDate == "21 September 2022"
    assert registry.getSource("module_01_endo", "ACOG-FIBROIDS").publicationDate is None
    assert registry.getSource("module_01_endo", "ACOG-FIBROIDS").reviewDate is None


def testVersionMigrationPreservesCompetitionAndModule2Boundaries():
    # The reference migration must not substitute new claims into the pinned package.
    manifest = Path("backend/competition/evidence/package.json")
    assert hashlib.sha256(manifest.read_bytes()).hexdigest() == "24a45eff098781766f8db4ed3da7ef237eccbbb285d1907440e33b8828d10d79"
    package = json.loads(manifest.read_bytes())
    assert len(package["claims"]) == 57
    assert all(source["productionApproved"] is False for source in package["sources"])
    registry = ModuleRegistry(Settings().moduleRoot)
    module2 = registry.getModule("module_02_early_pregnancy")
    assert module2.active is False and module2.status.value == "pending_review"
    assert module2.kbVersion == "1.0" and module2.sourceCatalog == "sources.json" and module2.knowledgePath is None
    assert len(module2.knowledgeChecksums) == 5 and module2.sourceRegister == {}
    assert all(source.status == "pendingReview" for source in registry.listSources(module2.moduleId))
    assert all(config.active is False for config in registry.listModules())
    with TestClient(createApp()) as client:
        assert client.get("/ready").status_code == 503
        assert client.get("/v1/modules").json() == {"modules": []}


@pytest.mark.parametrize("sourceUrl", [None, "http://example.test/source", "https://example.test/source"])
def testOptionalAndHttpUrls(tmp_path, sourceUrl):
    checksums = writeCatalog(tmp_path, [makeSource(verifiedUrl=sourceUrl)])
    assert CatalogStore(tmp_path, "sources.json", checksums).getSource("Synthetic").verifiedUrl == sourceUrl


@pytest.mark.parametrize("sourceUrl", ["ftp://example.test/a", "file:///secret", "javascript:alert(1)",
    "https://user:password@example.test/a", "https://@example.test/a", "https://example.test/a#section", "https://example.test/a#",
    "https://bad_host.test/a", "https://-bad.test/a", "https://bad..test/a", "https:///missing", "https://example.test:99999/a",
    "https://example.test/a b", "https://example.test/\nsecret", "https://999.999.999.999/a", "https://example.test\\secret"])
def testUnsafeUrlsFailClosed(tmp_path, sourceUrl, caplog):
    checksums = writeCatalog(tmp_path, [makeSource(verifiedUrl=sourceUrl)])
    with pytest.raises(CatalogError) as failure:
        CatalogStore(tmp_path, "sources.json", checksums)
    assert str(failure.value) == "Invalid source catalog."
    assert caplog.text == ""


@pytest.mark.parametrize("changes", [{"unexpected": "Synthetic secret"}, {"organization": " "}, {"title": "\t"},
    {"title": "x" * 501}, {"sourceId": "bad id"}, {"organization": 123}, {"status": "active"}, {"knowledgeFile": ""}])
def testInvalidSourceMetadata(tmp_path, changes):
    checksums = writeCatalog(tmp_path, [makeSource(**changes)])
    with pytest.raises(CatalogError):
        CatalogStore(tmp_path, "sources.json", checksums)


def testDuplicateSourcesAndJsonKeys(tmp_path):
    checksums = writeCatalog(tmp_path, [makeSource(), makeSource()])
    with pytest.raises(CatalogError):
        CatalogStore(tmp_path, "sources.json", checksums)
    (tmp_path / "sources.json").write_text('{"sources": [], "sources": []}', encoding="utf-8")
    with pytest.raises(CatalogError):
        CatalogStore(tmp_path, "sources.json", checksums)


@pytest.mark.parametrize("unsafePath", ["../outside", "knowledge/../../outside", "C:/outside", "/outside", "knowledge/missing", "C:outside", "knowledge/file:stream"])
def testKnowledgePathsFailClosed(tmp_path, unsafePath):
    checksums = writeCatalog(tmp_path, [makeSource(knowledgeFile=unsafePath)])
    with pytest.raises(CatalogError):
        CatalogStore(tmp_path, "sources.json", checksums)


@pytest.mark.parametrize("unsafePath", ["../sources.json", "/sources.json", "missing.json"])
def testCatalogPathsFailClosed(tmp_path, unsafePath):
    checksums = writeCatalog(tmp_path)
    with pytest.raises(CatalogError):
        CatalogStore(tmp_path, unsafePath, checksums)


@pytest.mark.parametrize("failureMode", ["changed", "missing", "wrongDigest", "untrusted", "oversized"])
def testMirrorIntegrityFailsClosed(tmp_path, failureMode):
    checksums = writeCatalog(tmp_path)
    mirror = tmp_path / "knowledge/mirror.bin"
    if failureMode == "changed":
        mirror.write_bytes(b"Synthetic changed document")
    elif failureMode == "missing":
        mirror.unlink()
    elif failureMode == "wrongDigest":
        checksums["knowledge/mirror.bin"] = "0" * 64
    elif failureMode == "untrusted":
        checksums = {}
    else:
        mirror.write_bytes(b"x" * (16 * 1024 * 1024 + 1))
        checksums["knowledge/mirror.bin"] = hashlib.sha256(mirror.read_bytes()).hexdigest()
    with pytest.raises(CatalogError):
        CatalogStore(tmp_path, "sources.json", checksums)


@pytest.mark.parametrize("content", ["{", "[]", '{"sources":[],"unknown":"Synthetic secret"}', "x" * 65537], ids=["malformed", "wrongShape", "extraField", "oversized"])
def testMalformedAndOversizedCatalogs(tmp_path, content):
    checksums = writeCatalog(tmp_path)
    (tmp_path / "sources.json").write_text(content, encoding="utf-8")
    with pytest.raises(CatalogError):
        CatalogStore(tmp_path, "sources.json", checksums)


def testUnreadableCatalog(tmp_path, monkeypatch):
    checksums = writeCatalog(tmp_path)
    originalOpen = Path.open

    def openFile(path, *args, **options):
        if path.name == "sources.json":
            raise PermissionError("Synthetic private path")
        return originalOpen(path, *args, **options)

    monkeypatch.setattr(Path, "open", openFile)
    with pytest.raises(CatalogError, match="^Invalid source catalog.$"):
        CatalogStore(tmp_path, "sources.json", checksums)


def testSourceOrderingLifecycleAndIsolatedCopies(tmp_path):
    checksums = writeCatalog(tmp_path, [makeSource("Zulu", status="retired"), makeSource("Alpha", status="approved")])
    store = CatalogStore(tmp_path, "sources.json", checksums)
    assert [source.sourceId for source in store.listSources()] == ["Alpha", "Zulu"]
    assert [source.status for source in store.listSources()] == ["approved", "retired"]
    sourceCopy = store.getSource("Alpha")
    sourceCopy.status = "retired"
    assert store.getSource("Alpha").status == "approved"


def testRegistrySourceIsolationAndSeparateApps(tmp_path):
    firstRoot = tmp_path / "first"
    secondRoot = tmp_path / "second"
    writeModule(firstRoot, "First", [makeSource("FirstSource")])
    writeModule(firstRoot, "Other", [makeSource("OtherSource")])
    writeModule(secondRoot, "First", [makeSource("SecondSource")])
    first = createApp(Settings(moduleRoot=firstRoot))
    second = createApp(Settings(moduleRoot=secondRoot))
    assert first.state.registry.getSource("First", "FirstSource").sourceId == "FirstSource"
    with pytest.raises(SourceUnavailableError):
        first.state.registry.getSource("First", "OtherSource")
    with pytest.raises(SourceUnavailableError):
        second.state.registry.getSource("First", "FirstSource")
    with pytest.raises(ModuleUnavailableError):
        first.state.registry.listSources("Unknown")
    first.state.registry.getSource("First", "FirstSource").status = "approved"
    assert second.state.registry.getSource("First", "SecondSource").status == "pendingReview"
    with TestClient(first) as client:
        for path in ["/v1/modules", "/v1/modules/First", "/ready"]:
            response = client.get(path)
            assert response.status_code == (503 if path == "/ready" else 200)
            if path == "/ready":
                assert response.json()["reasonCode"] == "analysisUnavailable"
            for internal in [str(tmp_path), "FirstSource", "knowledgeFile", "knowledgeChecksums", "sourceCatalog", "mirror.bin", "verifiedUrl"]:
                assert internal not in response.text


def testRegistryFailsStartupOnMirrorTampering(tmp_path):
    directory = writeModule(tmp_path, "First")
    (directory / "knowledge/mirror.bin").write_bytes(b"Synthetic tampering")
    with pytest.raises(RegistryConfigError, match="^Invalid module configuration.$"):
        createApp(Settings(moduleRoot=tmp_path))


def testRealModuleStaysInactiveAndNotReady():
    app = createApp()
    config = app.state.registry.getModule("module_01_endo")
    assert config.active is False and config.status == "pending_review"
    assert config.sourceRegister == {} and config.urgentRuleIds == []
    with TestClient(app) as client:
        assert client.get("/v1/modules").json() == {"modules": []}
        assert client.get("/v1/modules/module_01_endo").status_code == 404
        assert client.get("/ready").status_code == 503


@pytest.mark.parametrize("target", ["sources.json", "mirror.bin"])
def testCanonicalPathEscape(tmp_path, monkeypatch, target):
    root = tmp_path / "root"
    checksums = writeCatalog(root)
    outside = tmp_path / "outside"
    outside.write_bytes(b"Synthetic document")
    originalResolve = Path.resolve

    def resolvePath(path, *args, **options):
        return outside if path.name == target else originalResolve(path, *args, **options)

    monkeypatch.setattr(Path, "resolve", resolvePath)
    with pytest.raises(CatalogError):
        CatalogStore(root, "sources.json", checksums)


def testActualSymlinkEscape(tmp_path):
    root = tmp_path / "root"
    checksums = writeCatalog(root)
    outside = tmp_path / "outside"
    outside.write_bytes(b"Synthetic document")
    mirror = root / "knowledge/mirror.bin"
    mirror.unlink()
    try:
        mirror.symlink_to(outside)
    except OSError:
        pytest.skip("Platform does not permit symlink creation; canonical escape tested separately.")
    with pytest.raises(CatalogError):
        CatalogStore(root, "sources.json", checksums)


def testTooManySourceRecords(tmp_path):
    checksums = writeCatalog(tmp_path, [makeSource("Source" + str(index)) for index in range(201)])
    with pytest.raises(CatalogError):
        CatalogStore(tmp_path, "sources.json", checksums)


def testInvalidTrustedChecksumFailsStartup(tmp_path):
    directory = writeModule(tmp_path, "First")
    configPath = directory / "config.json"
    config = json.loads(configPath.read_text(encoding="utf-8"))
    config["knowledgeChecksums"]["knowledge/mirror.bin"] = "invalid"
    configPath.write_text(json.dumps(config), encoding="utf-8")
    with pytest.raises(RegistryConfigError):
        createApp(Settings(moduleRoot=tmp_path))
