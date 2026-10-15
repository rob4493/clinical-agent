"""Integrity-bound competition evidence; not loaded by standard application startup."""

import hashlib
import json
from pathlib import Path, PureWindowsPath
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, field_validator

from backend.app.models.catalog import Digest, SourceRecord
from backend.app.models.contracts import ModuleId
from backend.app.modules.registry import parsePairs

Text = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=2000)]


class PackageError(ValueError):
    """Fixed failure contains no document, local path or provider configuration."""


class CompetitionClaim(BaseModel):
    """Source-verified competition claim with no production-approval capability."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True, frozen=True)
    claimId: ModuleId
    moduleId: Literal["module_01_endo"]
    sourceId: ModuleId
    sourceOrganization: Text
    documentTitle: Text
    publicationDate: Text | None
    reviewDate: Text | None
    officialUrl: Text
    urlVerificationStatus: Literal["verifiedOfficialRetrieval", "unresolved"]
    sourceLocation: Text
    supportedStatement: Text = Field(repr=False)
    limitations: tuple[Text, ...] = Field(min_length=1, max_length=10, repr=False)
    conditions: tuple[Text, ...] = Field(min_length=1, max_length=10)
    jurisdiction: Text
    intendedPopulation: Text
    recommendationStrength: Text | None
    sourceFileHash: Digest
    competitionStatus: Literal["competitionEligible"]
    retrievalText: Text = Field(repr=False)
    verificationTimestamp: AwareDatetime
    productionApproved: Literal[False]


class CompetitionSource(BaseModel):
    """Immutable acquisition identity; URL verification remains independent of eligibility."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True, frozen=True)
    sourceId: ModuleId
    organization: Text
    title: Text
    publicationDate: Text | None
    reviewDate: Text | None
    officialUrl: Text
    urlVerificationStatus: Literal["verifiedOfficialRetrieval", "unresolved"]
    provenance: Text
    fileName: Text
    sha256: Digest
    byteSize: int = Field(strict=True, gt=0, le=20000000)
    pageCount: int | None = Field(default=None, strict=True, ge=1, le=1000)
    mimeType: Literal["application/pdf", "text/html"]
    productionApproved: Literal[False]

    @field_validator("officialUrl")
    @classmethod
    def validateUrl(cls, sourceUrl: str) -> str:
        # Syntax validation never changes unresolved acquisition provenance.
        if not sourceUrl.startswith("https://"):
            raise ValueError("Invalid source URL.")
        return SourceRecord.checkUrl(sourceUrl)


class CompetitionPackage(BaseModel):
    """One selected module, separate eligibility and source-bound controlled statements."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True, frozen=True)
    packageId: Literal["Module01Competition20261013"]
    moduleId: Literal["module_01_endo"]
    moduleHint: Literal["EndometriosisChronicPelvicPain"]
    competitionStatus: Literal["competitionEligible"]
    productionApproved: Literal[False]
    sources: tuple[CompetitionSource, ...] = Field(min_length=6, max_length=6)
    claims: tuple[CompetitionClaim, ...] = Field(min_length=1, max_length=100)


class Module2Claim(CompetitionClaim):
    """Same evidence contract with an explicit Module 2 identity boundary."""
    moduleId: Literal["module_02_early_pregnancy"]


class Module2Package(CompetitionPackage):
    """Specialize the shared package contract without changing Module 1 policy."""
    packageId: Literal["Module02Competition20261014"]
    moduleId: Literal["module_02_early_pregnancy"]
    moduleHint: Literal["module_02_early_pregnancy"]
    sources: tuple[CompetitionSource, ...] = Field(min_length=5, max_length=5)
    claims: tuple[Module2Claim, ...] = Field(min_length=1, max_length=100)


def readBounded(root: Path, fileName: str, limit: int) -> bytes:
    """Deny all linked components and traversal before accepting local bytes."""
    lexicalRoot = Path(root).absolute()
    for component in (lexicalRoot, *lexicalRoot.parents):
        if component.is_symlink() or component.is_junction():
            raise ValueError()
    if (Path(fileName).name != fileName or PureWindowsPath(fileName).name != fileName
            or fileName in {"", ".", ".."} or ":" in fileName):
        raise ValueError()
    source = lexicalRoot / fileName
    if source.is_symlink() or source.is_junction():
        raise ValueError()
    canonicalRoot = lexicalRoot.resolve(strict=True)
    canonical = source.resolve(strict=True)
    if canonical.parent != canonicalRoot or not canonical.is_file():
        raise ValueError()
    with canonical.open("rb") as stream:
        contents = stream.read(limit + 1)
    if not contents or len(contents) > limit:
        raise ValueError()
    return contents


def loadPackage(root: Path, expectedHash: str, runtimeMode: str, moduleId: str = "module_01_endo") -> CompetitionPackage:
    """Explicit competition-only load and fresh integrity check on every invocation.

    The caller must pin expectedHash in trusted configuration. Original HTML/PDF
    bytes are hashed only; this loader never executes or renders their contents.
    """
    try:
        if runtimeMode != "competition" or len(expectedHash) != 64:
            raise ValueError()
        manifest = readBounded(root, "package.json", 1000000)
        if hashlib.sha256(manifest).hexdigest() != expectedHash:
            raise ValueError()
        # Reject duplicate keys before model validation; JSON validation preserves
        # strict tuples, timestamps and Literal types without coercing Python input.
        parsed = json.loads(manifest, object_pairs_hook=parsePairs)
        packageType = CompetitionPackage if moduleId == "module_01_endo" else Module2Package if moduleId == "module_02_early_pregnancy" else None
        if packageType is None:
            raise ValueError()
        package = packageType.model_validate_json(json.dumps(parsed))
        sourceMap = {source.sourceId: source for source in package.sources}
        requiredIds = {"WHO-2025", "NICE-NG73", "NICHD-DX", "ACOG-CPP", "ACOG-ECTOPIC", "CDC-PID"} if moduleId == "module_01_endo" else {"NICE-NG126-2026", "ACEP-EARLYPREG-2017", "ACOG-ECTOPIC-FAQ155", "CDC-MATERNAL-WARNINGS-2024", "CDC-MATERNAL-WARNINGS-POSTER"}
        if (set(sourceMap) != requiredIds or len(sourceMap) != len(package.sources)
                or len({claim.claimId for claim in package.claims}) != len(package.claims)
                or len({source.fileName for source in package.sources}) != len(package.sources)):
            raise ValueError()
        for source in package.sources:
            contents = readBounded(root, source.fileName, source.byteSize)
            if len(contents) != source.byteSize or hashlib.sha256(contents).hexdigest() != source.sha256:
                raise ValueError()
            if source.mimeType == "application/pdf" and not contents.startswith(b"%PDF-"):
                raise ValueError()
        # Matching bytes alone cannot bind a claim to the right source identity;
        # require the claim and registered source metadata to agree as well.
        for claim in package.claims:
            source = sourceMap.get(claim.sourceId)
            if source is None or (claim.sourceFileHash, claim.sourceOrganization, claim.documentTitle,
                    claim.publicationDate, claim.reviewDate, claim.officialUrl, claim.urlVerificationStatus) != (
                    source.sha256, source.organization, source.title, source.publicationDate,
                    source.reviewDate, source.officialUrl, source.urlVerificationStatus):
                raise ValueError()
        return package
    except Exception:
        raise PackageError("Competition evidence is unavailable.") from None
