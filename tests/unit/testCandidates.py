"""Synthetic acquisition fixtures; no network or clinical interpretation."""

import hashlib
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.models.candidate import CandidateCatalog, CandidateRecord, FileLimit
from backend.app.models.catalog import SourceRecord
from backend.app.modules.candidates import CandidateError, CandidateStore


def makeRecord(**changes):
    record = dict(candidateId="Synthetic", organization="Synthetic", title="Synthetic", documentType="guideline", jurisdiction="US", officialUrl="https://example.org/document", accessedAt="2026-10-07", fullContentAccessible=None, evidenceCategories=["ectopic"], accessStatus="unresolved", currencyStatus="unresolved", status="candidate", notes="Synthetic metadata only.")
    record.update(changes)
    return record


def writeCatalog(root, records):
    (root / "candidates.json").write_text(json.dumps(dict(moduleId="module_02_early_pregnancy", candidates=records)), encoding="utf-8")


def writeArtifact(root, content=b"%PDF-1.7\nSynthetic"):
    (root / "source.pdf").write_bytes(content)
    record = makeRecord(localFile="source.pdf", sha256=hashlib.sha256(content).hexdigest(), fileSize=len(content), mimeType="application/pdf", accessStatus="downloaded", fullContentAccessible=True)
    writeCatalog(root, [record])
    return record


def testOptionalMetadataAndCandidateBoundary():
    candidate = CandidateRecord.model_validate(makeRecord())
    assert candidate.publicationDate is candidate.reviewDate is candidate.version is candidate.localFile is candidate.sha256 is None
    assert candidate.status == "candidate"
    with pytest.raises(ValidationError):
        SourceRecord.model_validate(candidate.model_dump())


@pytest.mark.parametrize("changes", [{"status": "approved"}, {"status": "pendingReview"}, {"clinicalText": "Synthetic"}, {"mimeType": "application/octet-stream"}, {"fileSize": FileLimit + 1}, {"accessedAt": "2026-02-30"}, {"evidenceCategories": ["ectopic", "ectopic"]}, {"sha256": "a" * 64}, {"accessStatus": "downloaded"}])
def testStrictCandidateValidation(changes):
    with pytest.raises(ValidationError):
        CandidateRecord.model_validate(makeRecord(**changes))


@pytest.mark.parametrize("sourceUrl", ["http://example.org/source", "https://example.org/source"])
def testHttpUrlsAccepted(sourceUrl):
    assert CandidateRecord.model_validate(makeRecord(officialUrl=sourceUrl)).officialUrl == sourceUrl


@pytest.mark.parametrize("sourceUrl", ["file:///document", "ftp://example.org/source", "https://user:secret@example.org/source", "https://example.org/source?token=synthetic", "https://", "https://example.org/\nsource"])
def testUnsafeUrlsRejected(sourceUrl):
    for fieldName in ["officialUrl", "metadataUrls"]:
        with pytest.raises(ValidationError):
            CandidateRecord.model_validate(makeRecord(**{fieldName: [sourceUrl] if fieldName == "metadataUrls" else sourceUrl}))


def testDuplicateIdsRejected(tmp_path):
    writeCatalog(tmp_path, [makeRecord(), makeRecord()])
    with pytest.raises(CandidateError):
        CandidateStore(tmp_path)
    with pytest.raises(ValidationError):
        CandidateCatalog.model_validate(dict(moduleId="module_02_early_pregnancy", candidates=[makeRecord(), makeRecord()]))


def testOrderingAndCopies(tmp_path):
    writeCatalog(tmp_path, [makeRecord(candidateId="Zulu"), makeRecord(candidateId="Alpha")])
    store = CandidateStore(tmp_path)
    records = store.listCandidates()
    assert [record.candidateId for record in records] == ["Alpha", "Zulu"]
    records[0].evidenceCategories.clear()
    assert store.listCandidates()[0].evidenceCategories == ["ectopic"]


def testHashAndSizeVerified(tmp_path):
    record = writeArtifact(tmp_path)
    assert CandidateStore(tmp_path).listCandidates()[0].sha256 == record["sha256"]


@pytest.mark.parametrize("failure", ["modified", "missing", "digest", "size", "mime", "signature"])
def testArtifactFailuresArePrivate(tmp_path, failure, caplog):
    record = writeArtifact(tmp_path)
    source = tmp_path / "source.pdf"
    if failure == "modified":
        source.write_bytes(b"%PDF-1.7\nModified!")
    elif failure == "missing":
        source.unlink()
    elif failure == "signature":
        record = writeArtifact(tmp_path, b"<html>Synthetic</html>")
    else:
        record.update({"sha256": "0" * 64} if failure == "digest" else {"fileSize": 1} if failure == "size" else {"mimeType": "text/html"})
    writeCatalog(tmp_path, [record])
    with pytest.raises(CandidateError) as failureResult:
        CandidateStore(tmp_path)
    assert str(failureResult.value) == "Invalid candidate catalog."
    assert failureResult.value.__cause__ is None and caplog.text == ""
    assert str(tmp_path) not in str(failureResult.value)


@pytest.mark.parametrize("relativePath", ["../source.pdf", "..\\source.pdf", "C:\\source.pdf", "/source.pdf"])
def testTraversalRejected(tmp_path, relativePath):
    record = writeArtifact(tmp_path)
    record["localFile"] = relativePath
    writeCatalog(tmp_path, [record])
    with pytest.raises(CandidateError):
        CandidateStore(tmp_path)


def testResolvedSymlinkEscapeRejected(tmp_path, monkeypatch):
    writeArtifact(tmp_path)
    originalResolve = Path.resolve
    def resolvePath(path, *args, **options):
        if path == tmp_path / "source.pdf":
            return tmp_path.parent / "outside.pdf"
        return originalResolve(path, *args, **options)
    monkeypatch.setattr(Path, "resolve", resolvePath)
    with pytest.raises(CandidateError):
        CandidateStore(tmp_path)


def testOversizedArtifactRejected(tmp_path):
    record = writeArtifact(tmp_path)
    (tmp_path / "source.pdf").write_bytes(b"%PDF-" + b"x" * FileLimit)
    writeCatalog(tmp_path, [record])
    with pytest.raises(CandidateError):
        CandidateStore(tmp_path)


@pytest.mark.parametrize("catalogBytes", [b'{"moduleId":"module_02_early_pregnancy","candidates":[],"candidates":[]}', b"x" * 65537, b"not JSON"], ids=["duplicateField", "oversized", "malformed"])
def testMalformedCatalogRejected(tmp_path, catalogBytes):
    (tmp_path / "candidates.json").write_bytes(catalogBytes)
    with pytest.raises(CandidateError):
        CandidateStore(tmp_path)


def testRealCandidatesAndDownloadedDigest():
    root = Settings().moduleRoot / "module02EarlyPregnancy"
    records = CandidateStore(root).listCandidates()
    assert len(records) == 8 and all(record.status == "candidate" for record in records)
    assert len({record.candidateId for record in records}) == 8
    acquired = [record for record in records if record.localFile is not None]
    assert [record.candidateId for record in acquired] == ["m2AcepEarly", "m2NiceNg126"]
    assert acquired[0].sha256 == "8c6a3af4a3439d03d9a81d0edebe101b3aa27beb9591e0a303375df2997e25e4"
    assert acquired[0].fileSize == 11166962
    assert acquired[1].sha256 == "f27f86a8779b2b1de7ede51e6c3d65564f656d3ec65a73ae3701fdda49833045"
    assert acquired[1].fileSize == 243087
