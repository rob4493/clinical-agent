"""Internal candidate appraisal loader; no runtime registry, retrieval or rule integration."""

import json
from pathlib import Path

from backend.app.models.claim import CandidateClaim, ClaimMatrix
from backend.app.modules.candidates import CandidateStore
from backend.app.modules.catalog import checkPairs, resolveFile

# Bounds and hashes identify only the two verified artifacts authorized for appraisal.
AppraisalSources = {
    "m2AcepEarly": ("8c6a3af4a3439d03d9a81d0edebe101b3aa27beb9591e0a303375df2997e25e4", 30, "US"),
    "m2NiceNg126": ("f27f86a8779b2b1de7ede51e6c3d65564f656d3ec65a73ae3701fdda49833045", 52, "UK")}


class ClaimError(ValueError):
    """Sanitized candidate appraisal verification failure."""


class ClaimStore:
    """Verify source-bound candidate records without producing clinical evidence chunks."""

    def __init__(self, moduleRoot: Path, claimsPath: str = "candidateClaims.json"):
        try:
            root = moduleRoot.resolve(strict=True)
            sources = {source.candidateId: source for source in CandidateStore(root).listCandidates()}
            claimsFile = resolveFile(root, claimsPath)
            with claimsFile.open("rb") as stream:
                claimBytes = stream.read(262145)
            if len(claimBytes) > 262144:
                raise ValueError()
            matrix = ClaimMatrix.model_validate(json.loads(claimBytes, object_pairs_hook=checkPairs))
            self.claims = {claim.claimId: claim for claim in matrix.claims}
            for claim in matrix.claims:
                source = sources.get(claim.sourceCandidateId)
                expected = AppraisalSources.get(claim.sourceCandidateId)
                if source is None or expected is None or source.localFile is None or source.accessStatus != "downloaded" or source.status != "candidate":
                    raise ValueError()
                digest, pageCount, jurisdiction = expected
                if claim.sourceDigest != source.sha256 or claim.sourceDigest != digest or claim.pdfPage > pageCount or claim.jurisdiction != jurisdiction or source.jurisdiction != jurisdiction:
                    raise ValueError()
                # Scope comparisons never imply a clinical contradiction; actual
                # conflicts remain separate and cannot be resolved by this loader.
                for relation in ["conflictsWith", "comparedWith"]:
                    for comparisonId in getattr(claim, relation):
                        comparison = self.claims.get(comparisonId)
                        if comparison is None or comparison.sourceCandidateId == claim.sourceCandidateId or claim.claimId not in getattr(comparison, relation):
                            raise ValueError()
        except (OSError, RuntimeError, ValueError, TypeError):
            raise ClaimError("Invalid candidate claims.") from None

    def listClaims(self) -> list[CandidateClaim]:
        """Deterministic isolated administrative copies, with no evidence conversion API."""
        return [claim.model_copy(deep=True) for claimId, claim in sorted(self.claims.items())]
