"""Offline administrative PDF intake; never imported by runtime evidence services."""

import hashlib
import io
import logging
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath

from backend.app.models.candidate import FileLimit


class IntakeError(ValueError):
    """Sanitized document verification failure with no document text or local path."""


@dataclass(frozen=True)
class DocumentSpec:
    """Trusted byte identity and first-page identity requirements, not clinical approval."""

    sha256: str
    fileSize: int
    pageCount: int
    title: str
    identityTerms: tuple[str, ...]
    creationPrefix: str | None = None
    authorTerm: str | None = None


@dataclass(frozen=True)
class PdfInfo:
    """Inspection outcome containing only bounded operational metadata."""

    sha256: str
    fileSize: int
    pageCount: int
    creationDate: str | None
    mimeType: str = "application/pdf"


AcepSpec = DocumentSpec(
    "8c6a3af4a3439d03d9a81d0edebe101b3aa27beb9591e0a303375df2997e25e4", 11166962, 30,
    "Clinical Policy: Critical Issues in the Initial Evaluation and Management of Patients Presenting to the Emergency Department in Early Pregnancy",
    ("American College of Emergency Physicians", "Annals of Emergency Medicine", "10.1016/j.annemergmed.2016.11.002", "February 2017"))
NiceSpec = DocumentSpec(
    "f27f86a8779b2b1de7ede51e6c3d65564f656d3ec65a73ae3701fdda49833045", 243087, 52,
    "Ectopic pregnancy and miscarriage: diagnosis and initial management",
    ("NICE guideline", "ng126", "17 April 2019", "17 June 2026"), "D:202606", "National Institute for Health and Care Excellence")


def inspectPdf(sourceBytes: bytes, spec: DocumentSpec | None = None) -> PdfInfo:
    """Parse PDF structure locally; extract only the first page to verify identity."""
    try:
        if len(sourceBytes) > FileLimit or not sourceBytes.startswith(b"%PDF-"):
            raise ValueError()
        digest = hashlib.sha256(sourceBytes).hexdigest()
        if spec is not None and (digest != spec.sha256 or len(sourceBytes) != spec.fileSize):
            raise ValueError()
        # pypdf is an existing bundled inspection tool, not an application dependency.
        # Suppress parser diagnostics, which can expose untrusted document text.
        from pypdf import PdfReader
        from pypdf.generic import IndirectObject
        previousLevel = logging.root.manager.disable
        logging.disable(logging.CRITICAL)
        try:
            reader = PdfReader(io.BytesIO(sourceBytes), strict=True)
            if reader.is_encrypted:
                raise ValueError()
            unsafeKeys = {"/JS", "/JavaScript", "/EmbeddedFiles", "/EF", "/XFA", "/RichMediaContent"}
            unsafeActions = {"/JavaScript", "/Launch", "/RichMediaExecute", "/SubmitForm", "/ImportData"}
            # Inspect every indexed object, including object streams, without executing
            # actions or opening attachments. All embedded files are conservatively denied.
            references = {(generation, number) for generation, objects in reader.xref.items() for number in objects if number}
            references.update((0, number) for number in reader.xref_objStm)
            visited = set()
            def checkObject(pdfObject):
                if isinstance(pdfObject, IndirectObject):
                    return
                if id(pdfObject) in visited:
                    return
                visited.add(id(pdfObject))
                if isinstance(pdfObject, dict):
                    if unsafeKeys.intersection(pdfObject) or str(pdfObject.get("/S", "")) in unsafeActions or str(pdfObject.get("/Type", "")) == "/EmbeddedFile":
                        raise ValueError()
                    for child in pdfObject.values():
                        checkObject(child)
                elif isinstance(pdfObject, list):
                    for child in pdfObject:
                        checkObject(child)
            for generation, number in sorted(references):
                checkObject(reader.get_object(IndirectObject(number, generation, reader)))
            pageCount = len(reader.pages)
            if pageCount < 1:
                raise ValueError()
            metadata = reader.metadata or {}
            creationDate = metadata.get("/CreationDate")
            if spec is not None:
                firstPage = " ".join(reader.pages[0].extract_text().split()).casefold()
                metadataTitle = " ".join(str(metadata.get("/Title", "")).split()).casefold()
                title = " ".join(spec.title.split()).casefold()
                if pageCount != spec.pageCount or metadataTitle != title or any(term.casefold() not in firstPage for term in (spec.title,) + spec.identityTerms):
                    raise ValueError()
                if spec.creationPrefix is not None and (not isinstance(creationDate, str) or not creationDate.startswith(spec.creationPrefix)):
                    raise ValueError()
                # NICE's organizational cover logo is graphical; metadata author plus
                # visible guideline identity supports the separately rendered cover check.
                if spec.authorTerm is not None and spec.authorTerm.casefold() not in str(metadata.get("/Author", "")).casefold():
                    raise ValueError()
            return PdfInfo(digest, len(sourceBytes), pageCount, str(creationDate)[:64] if creationDate is not None else None)
        finally:
            logging.disable(previousLevel)
    except Exception:
        raise IntakeError("Document verification failed.") from None


def checkLink(path: Path):
    if path.is_symlink() or path.is_junction():
        raise IntakeError("Document verification failed.")


def readIntake(intakeRoot: Path, fileName: str) -> bytes:
    """Accept one regular direct child; no recursive enumeration or link following."""
    try:
        checkLink(intakeRoot)
        root = intakeRoot.resolve(strict=True)
        if not fileName or Path(fileName).name != fileName or PureWindowsPath(fileName).name != fileName or ":" in fileName or fileName in {".", ".."}:
            raise ValueError()
        source = root / fileName
        checkLink(source)
        canonical = source.resolve(strict=True)
        if canonical.parent != root or not canonical.is_file():
            raise ValueError()
        with canonical.open("rb") as stream:
            sourceBytes = stream.read(FileLimit + 1)
        if len(sourceBytes) > FileLimit:
            raise ValueError()
        return sourceBytes
    except Exception:
        raise IntakeError("Document verification failed.") from None


def copyVerified(intakeRoot: Path, fileName: str, moduleRoot: Path, relativePath: str, spec: DocumentSpec) -> tuple[PdfInfo, bool]:
    """Copy verified bytes once; matching existing files are reused, conflicts stop."""
    try:
        sourceBytes = readIntake(intakeRoot, fileName)
        info = inspectPdf(sourceBytes, spec)
        checkLink(moduleRoot)
        root = moduleRoot.resolve(strict=True)
        path = Path(relativePath)
        windowsPath = PureWindowsPath(relativePath)
        if not relativePath or path.is_absolute() or windowsPath.drive or windowsPath.root or ".." in path.parts or ".." in windowsPath.parts or ":" in relativePath or "\\" in relativePath:
            raise ValueError()
        destination = root / path
        for component in [destination, *destination.parents]:
            if component == root:
                break
            checkLink(component)
        canonical = destination.resolve()
        if not canonical.is_relative_to(root) or not canonical.parent.is_dir():
            raise ValueError()
        copied = not canonical.exists()
        if not copied:
            with canonical.open("rb") as stream:
                existingBytes = stream.read(FileLimit + 1)
            if existingBytes != sourceBytes:
                raise ValueError()
            inspectPdf(existingBytes, spec)
        else:
            with canonical.open("xb") as stream:
                stream.write(sourceBytes)
            with canonical.open("rb") as stream:
                copiedBytes = stream.read(FileLimit + 1)
            if copiedBytes != sourceBytes or hashlib.sha256(copiedBytes).hexdigest() != info.sha256:
                raise ValueError()
        return info, copied
    except Exception:
        raise IntakeError("Document integration failed.") from None
