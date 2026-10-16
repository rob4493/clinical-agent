"""Public evaluation summaries; never a substitute for authentic source approval."""

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from backend.app.modules.registry import parsePairs
from backend.competition.package import PackageError, readBounded

ProjectRoot = Path(__file__).resolve().parents[2]
EvaluationRoot = ProjectRoot / "evaluation"
EvaluationNotice = "Reviewed with healthcare professionals for evaluation and feedback. Not validated or approved for patient care."
ModulePaths = {"module_01_endo": "module1", "module_02_early_pregnancy": "module2"}


def contentDigest(content):
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def publicRoot(root):
    return Path(root).absolute() in {EvaluationRoot / "modules" / name for name in ModulePaths.values()}


def verifyReview():
    """Revalidate the reviewed code/data boundary, including warning and citation policy."""
    try:
        from backend.competition.evaluationSeal import ReviewHash
        reviewBytes = readBounded(EvaluationRoot, "review.json", 65536)
        if hashlib.sha256(reviewBytes).hexdigest() != ReviewHash:
            raise ValueError()
        review = json.loads(reviewBytes, object_pairs_hook=parsePairs)
        if (review["reviewStatus"] != "reviewedForEvaluation" or review["competitionStatus"] != "competitionReady"
                or review["notice"] != EvaluationNotice or review["productionApproved"] is not False):
            raise ValueError()
        for name, expected in review["files"].items():
            relative = Path(name)
            if relative.is_absolute() or ".." in relative.parts or "\\" in name or ":" in name:
                raise ValueError()
            contents = readBounded(ProjectRoot / relative.parent, relative.name, 1000000)
            if hashlib.sha256(contents).hexdigest() != expected:
                raise ValueError()
        return review
    except Exception:
        raise PackageError("Evaluation evidence is unavailable.") from None


@dataclass(frozen=True, repr=False)
class EvaluationSource:
    """Read-only metadata adapter; no original file identity is fabricated."""
    fields: object

    def __getattr__(self, name):
        if name == "reviewDate":
            return None
        if name == "provenance":
            return "Project-authored evaluation summary; underlying publication not distributed."
        if name in self.fields:
            return self.fields[name]
        raise AttributeError(name)


@dataclass(frozen=True, repr=False)
class EvaluationClaim:
    """Provider-neutral claim view with explicitly separate evaluation eligibility."""
    fields: object
    attribution: EvaluationSource

    def __getattr__(self, name):
        if name == "publicEvaluation":
            return True
        if name == "competitionStatus":
            return "competitionEligible"
        if name == "sourceLocation":
            return "Project-authored evaluation summary"
        if name in {"sourceOrganization", "documentTitle"}:
            return getattr(self.attribution, {"sourceOrganization": "organization", "documentTitle": "title"}[name])
        if name in {"publicationDate", "reviewDate", "officialUrl", "urlVerificationStatus"}:
            return getattr(self.attribution, name)
        if name in self.fields:
            return self.fields[name]
        raise AttributeError(name)


@dataclass(frozen=True, repr=False)
class EvaluationPackage:
    """Immutable public package projection consumed by existing competition services."""
    packageId: str
    moduleId: str
    moduleHint: str
    sources: tuple
    claims: tuple
    productionApproved: bool = False


def loadEvaluation(root, expectedHash, moduleId):
    try:
        review = verifyReview()
        if moduleId not in ModulePaths or Path(root).absolute() != EvaluationRoot / "modules" / ModulePaths[moduleId]:
            raise ValueError()
        relative = f"evaluation/modules/{ModulePaths[moduleId]}/claims.json"
        if review["files"].get(relative) != expectedHash:
            raise ValueError()
        contents = readBounded(root, "claims.json", 200000)
        if hashlib.sha256(contents).hexdigest() != expectedHash:
            raise ValueError()
        package = json.loads(contents, object_pairs_hook=parsePairs)
        unsigned = {key: field for key, field in package.items() if key != "contentHash"}
        if (contentDigest(unsigned) != package["contentHash"] or package["moduleId"] != moduleId
                or package["productionApproved"] is not False or package["reviewStatus"] != "reviewedForEvaluation"
                or package["competitionStatus"] != "competitionReady" or package["contentKind"] != "projectAuthoredEvaluationSummaries"):
            raise ValueError()
        sources = {source["sourceId"]: EvaluationSource(MappingProxyType(source)) for source in package["sources"]}
        if len(sources) != len(package["sources"]) or any(source.lifecycleStatus != "pendingReview" for source in sources.values()):
            raise ValueError()
        claims = []
        for claim in package["claims"]:
            if (claim["moduleId"] != moduleId or claim["sourceId"] not in sources or claim["productionApproved"] is not False
                    or contentDigest({key: field for key, field in claim.items() if key != "contentHash"}) != claim["contentHash"]):
                raise ValueError()
            immutable = {key: tuple(field) if isinstance(field, list) else field for key, field in claim.items()}
            claims.append(EvaluationClaim(MappingProxyType(immutable), sources[claim["sourceId"]]))
        if len(claims) != (57 if moduleId == "module_01_endo" else 21) or len({claim.claimId for claim in claims}) != len(claims):
            raise ValueError()
        return EvaluationPackage(package["packageId"], moduleId, "EndometriosisChronicPelvicPain" if moduleId == "module_01_endo" else moduleId, tuple(sources.values()), tuple(claims))
    except Exception:
        raise PackageError("Evaluation evidence is unavailable.") from None
