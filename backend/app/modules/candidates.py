"""Bounded candidate-artifact verification, separate from clinical registry loading."""

import hashlib
import json
from pathlib import Path

from backend.app.models.candidate import CandidateCatalog, CandidateRecord, FileLimit
from backend.app.modules.catalog import checkPairs, resolveFile


class CandidateError(ValueError):
    """Sanitized acquisition metadata or integrity failure."""


class CandidateStore:
    """Verify collected bytes without parsing clinical content or granting approval."""

    def __init__(self, moduleRoot: Path, catalogPath: str = "candidates.json"):
        try:
            root = moduleRoot.resolve(strict=True)
            catalogFile = resolveFile(root, catalogPath)
            with catalogFile.open("rb") as stream:
                catalogBytes = stream.read(65537)
            if len(catalogBytes) > 65536:
                raise ValueError()
            catalog = CandidateCatalog.model_validate(json.loads(catalogBytes, object_pairs_hook=checkPairs))
            for candidate in catalog.candidates:
                if candidate.localFile is not None:
                    sourceFile = resolveFile(root, candidate.localFile)
                    with sourceFile.open("rb") as stream:
                        sourceBytes = stream.read(FileLimit + 1)
                    # MIME declaration alone cannot make HTML or executable bytes a PDF.
                    if len(sourceBytes) > FileLimit or len(sourceBytes) != candidate.fileSize or not sourceBytes.startswith(b"%PDF-") or hashlib.sha256(sourceBytes).hexdigest() != candidate.sha256:
                        raise ValueError()
            self.candidates = {candidate.candidateId: candidate for candidate in catalog.candidates}
        except (OSError, RuntimeError, ValueError, TypeError):
            raise CandidateError("Invalid candidate catalog.") from None

    def listCandidates(self) -> list[CandidateRecord]:
        """Return isolated metadata in identifier order; no approval conversion exists."""
        return [candidate.model_copy(deep=True) for candidateId, candidate in sorted(self.candidates.items())]
