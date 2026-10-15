"""Offline identity and safety checks; negative cases never alter authentic PDFs."""

import hashlib
import io
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.models.module import ModuleStatus
from backend.app.modules.candidates import CandidateStore
from backend.app.modules.registry import ModuleUnavailableError
from tools.sourceIntake import AcepSpec, DocumentSpec, IntakeError, NiceSpec, copyVerified, inspectPdf, readIntake


def makePdf(kind="plain"):
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=300)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 12 Tf 20 200 Td (Synthetic document Synthetic organization) Tj ET")
    page[NameObject("/Contents")] = stream
    writer.add_metadata({"/Title": "Synthetic document", "/Author": "Synthetic organization", "/CreationDate": "D:20261007000000Z"})
    if kind == "encrypted":
        writer.encrypt("syntheticPassword")
    elif kind == "javascript":
        writer.add_js("/* synthetic nonexecuted test */")
    elif kind == "attachment":
        writer.add_attachment("synthetic.exe", b"Synthetic nonexecuted attachment")
    elif kind == "launch":
        writer.root_object[NameObject("/OpenAction")] = DictionaryObject({NameObject("/S"): NameObject("/Launch")})
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def makeSpec(contents):
    return DocumentSpec(hashlib.sha256(contents).hexdigest(), len(contents), 1, "Synthetic document", ("Synthetic organization",), "D:202610", "Synthetic organization")


def makeRoots(root):
    intake = root / "intake"
    module = root / "module"
    intake.mkdir()
    (module / "knowledge" / "sources").mkdir(parents=True)
    return intake, module


@pytest.mark.parametrize("candidateId,spec", [("m2AcepEarly", AcepSpec), ("m2NiceNg126", NiceSpec)])
def testTrustedDocumentsAndPostCopyEquality(candidateId, spec):
    root = Settings().moduleRoot / "module02EarlyPregnancy"
    candidate = next(record for record in CandidateStore(root).listCandidates() if record.candidateId == candidateId)
    contents = (root / candidate.localFile).read_bytes()
    info = inspectPdf(contents, spec)
    assert info.sha256 == candidate.sha256 == spec.sha256
    assert info.fileSize == candidate.fileSize == spec.fileSize
    assert info.pageCount == spec.pageCount and info.mimeType == candidate.mimeType == "application/pdf"
    assert candidate.status == "candidate" and candidate.accessedAt == "2026-10-07"
    # Ignored staging files are optional in fresh checkouts; controlled module copies
    # are mandatory. When originals are present their exact equality is verified.
    intake = Path(__file__).resolve().parents[2] / "sourceIntake"
    fileName = "ACEP-Early-Pregnancy-Clinical-Policy.pdf" if candidateId == "m2AcepEarly" else "NICE-NG126-Ectopic-Pregnancy-and-Miscarriage.pdf"
    if intake.exists():
        assert readIntake(intake, fileName) == contents


@pytest.mark.parametrize("spec", [AcepSpec, NiceSpec], ids=["modifiedAcep", "modifiedNice"])
def testModifiedDocumentRejected(spec):
    with pytest.raises(IntakeError):
        inspectPdf(makePdf(), spec)


@pytest.mark.parametrize("kind", ["encrypted", "javascript", "attachment", "launch"])
def testUnsafePdfRejected(kind, caplog):
    contents = makePdf(kind)
    with pytest.raises(IntakeError) as failure:
        inspectPdf(contents)
    assert str(failure.value) == "Document verification failed." and caplog.text == ""


def testRenamedNonPdfRejected(tmp_path):
    intake, module = makeRoots(tmp_path)
    (intake / "renamed.pdf").write_bytes(b"<html>Synthetic</html>")
    with pytest.raises(IntakeError):
        inspectPdf(readIntake(intake, "renamed.pdf"))


@pytest.mark.parametrize("changes", [{"title": "Wrong document"}, {"pageCount": 2}, {"fileSize": 1}, {"identityTerms": ("Wrong organization",)}, {"creationPrefix": "D:2025"}, {"authorTerm": "Wrong author"}])
def testIdentityMismatchRejected(changes):
    contents = makePdf()
    with pytest.raises(IntakeError):
        inspectPdf(contents, replace(makeSpec(contents), **changes))


def testCopyAndMatchingExistingFileAreIdempotent(tmp_path):
    intake, module = makeRoots(tmp_path)
    contents = makePdf()
    source = intake / "source.pdf"
    source.write_bytes(contents)
    spec = makeSpec(contents)
    destination = module / "knowledge/sources/source.pdf"
    info, copied = copyVerified(intake, "source.pdf", module, "knowledge/sources/source.pdf", spec)
    assert copied is True and info.sha256 == spec.sha256
    assert source.read_bytes() == destination.read_bytes() == contents
    modifiedAt = destination.stat().st_mtime_ns
    info, copied = copyVerified(intake, "source.pdf", module, "knowledge/sources/source.pdf", spec)
    assert copied is False and destination.stat().st_mtime_ns == modifiedAt
    assert list(destination.parent.iterdir()) == [destination]


def testConflictingExistingFileIsNeverOverwritten(tmp_path, caplog):
    intake, module = makeRoots(tmp_path)
    contents = makePdf()
    (intake / "source.pdf").write_bytes(contents)
    destination = module / "knowledge/sources/source.pdf"
    destination.write_bytes(b"Synthetic conflicting bytes")
    with pytest.raises(IntakeError) as failure:
        copyVerified(intake, "source.pdf", module, "knowledge/sources/source.pdf", makeSpec(contents))
    assert destination.read_bytes() == b"Synthetic conflicting bytes"
    assert (intake / "source.pdf").read_bytes() == contents
    assert str(failure.value) == "Document integration failed." and caplog.text == ""
    assert str(tmp_path) not in str(failure.value)


@pytest.mark.parametrize("relativePath", ["../outside.pdf", "..\\outside.pdf", "C:\\outside.pdf", "/outside.pdf"])
def testDestinationTraversalRejected(tmp_path, relativePath):
    intake, module = makeRoots(tmp_path)
    contents = makePdf()
    (intake / "source.pdf").write_bytes(contents)
    with pytest.raises(IntakeError):
        copyVerified(intake, "source.pdf", module, relativePath, makeSpec(contents))
    assert list((module / "knowledge/sources").iterdir()) == []


def testIntakeSymlinkRejected(tmp_path, monkeypatch):
    intake, module = makeRoots(tmp_path)
    source = intake / "source.pdf"
    source.write_bytes(makePdf())
    originalCheck = Path.is_symlink
    def checkSymlink(path):
        return path == source or originalCheck(path)
    monkeypatch.setattr(Path, "is_symlink", checkSymlink)
    with pytest.raises(IntakeError):
        readIntake(intake, "source.pdf")


def testDestinationSymlinkEscapeRejected(tmp_path, monkeypatch):
    intake, module = makeRoots(tmp_path)
    contents = makePdf()
    (intake / "source.pdf").write_bytes(contents)
    originalResolve = Path.resolve
    def resolvePath(path, *args, **options):
        if path == module / "knowledge/sources/source.pdf":
            return tmp_path / "outside.pdf"
        return originalResolve(path, *args, **options)
    monkeypatch.setattr(Path, "resolve", resolvePath)
    with pytest.raises(IntakeError):
        copyVerified(intake, "source.pdf", module, "knowledge/sources/source.pdf", makeSpec(contents))
    assert not (tmp_path / "outside.pdf").exists()


@pytest.mark.parametrize("fileName", ["../source.pdf", "nested/source.pdf", "nested\\source.pdf", "C:\\source.pdf", "folder"])
def testIntakeIsFlatAndRegular(tmp_path, fileName):
    (tmp_path / "folder").mkdir()
    with pytest.raises(IntakeError):
        readIntake(tmp_path, fileName)


def testCandidateDocumentsNeverGrantReadiness():
    app = createApp()
    registry = app.state.registry
    config = registry.getModule("module_02_early_pregnancy")
    assert config.active is False and config.status == ModuleStatus.pendingReview
    assert config.sourceCatalog == "sources.json" and config.knowledgePath is None and config.reviewDirectory == "reviews" and config.kbVersion == "1.0"
    assert config.urgentRuleIds == [] and len(config.requiredSourceIds) == 15 and len(config.knowledgeChecksums) == 5
    assert len(registry.listSources(config.moduleId)) == 15
    assert all(source.status == "pendingReview" for source in registry.listSources(config.moduleId))
    assert registry.approvalGates[config.moduleId].reviews.reviews == []
    with pytest.raises(ModuleUnavailableError):
        registry.resolveModule(config.moduleId)
    with TestClient(app) as client:
        assert client.get("/v1/modules").json() == {"modules": []}
        assert client.get("/ready").status_code == 503
        response = client.get("/v1/modules/" + config.moduleId)
        assert response.status_code == 404
        assert "candidate" not in response.text and "localFile" not in response.text and "knowledge/sources" not in response.text


def testIntakeAndRuntimeSourcesRemainPrivate():
    ignoreText = (Path(__file__).resolve().parents[2] / ".gitignore").read_text(encoding="utf-8")
    assert "/sourceIntake/" in ignoreText.splitlines()
    # The source-free release withholds runtime mirrors and source-derived JSON
    # as well as administrative originals; metadata alone remains distributable.
    for pattern in ["*.pdf", "*.docx", "*.html", "/backend/app/modules/*/knowledge/",
                    "/backend/competition/evidence/", "/backend/competition/module02Evidence/",
                    "/backend/app/modules/*/candidateClaims.json", "/backend/app/modules/*/candidatePolicies/"]:
        assert pattern in ignoreText.splitlines()
