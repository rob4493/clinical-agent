"""Read-only review snapshots and deterministic source approval evidence gates."""

import hashlib
import json
from pathlib import Path, PureWindowsPath

from backend.app.models.catalog import SourceRecord
from backend.app.models.review import SourceReview, SourceApprovalResult, ModuleApprovalResult
from backend.app.modules.catalog import CatalogStore, SourceUnavailableError, resolveFile, checkPairs

RequiredCriteria = ("identityVerified", "authorityVerified", "versionVerified", "jurisdictionReviewed", "scopeReviewed", "limitationsReviewed")


class ReviewConfigError(ValueError):
    """Sanitized review-store failure that prevents registry initialization."""


def metadataDigest(source: SourceRecord) -> str:
    """Hash all validated metadata, including nulls and lifecycle, in stable UTF-8 JSON."""
    canonical = json.dumps(source.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class ReviewStore:
    """Separate module-local administrative records, with no write or approval actions."""

    def __init__(self, moduleRoot: Path, reviewDirectory: str | None, moduleId: str, settings=None):
        self.reviews: list[SourceReview] = []
        try:
            if reviewDirectory is None:
                return
            root = moduleRoot.resolve(strict=True)
            path = Path(reviewDirectory)
            windowsPath = PureWindowsPath(reviewDirectory)
            if not reviewDirectory or path.is_absolute() or windowsPath.drive or windowsPath.root or ".." in path.parts or ".." in windowsPath.parts or ":" in reviewDirectory:
                raise ValueError()
            directory = (root / path).resolve(strict=True)
            if not directory.is_relative_to(root) or not directory.is_dir():
                raise ValueError()
            files = sorted(directory.glob("*.json"))
            if len(files) > 200:
                raise ValueError()
            reviewIds = set()
            for reviewPath in files:
                resolved = resolveFile(directory, reviewPath.name)
                with resolved.open("rb") as stream:
                    reviewBytes = stream.read(16385)
                if len(reviewBytes) > 16384:
                    raise ValueError()
                # Inspect JSON keys before Pydantic parsing; duplicate keys cannot hide decisions.
                json.loads(reviewBytes, object_pairs_hook=checkPairs)
                review = SourceReview.model_validate_json(reviewBytes, context=settings)
                if review.moduleId != moduleId or review.reviewId in reviewIds:
                    raise ValueError()
                reviewIds.add(review.reviewId)
                self.reviews.append(review)
        except (OSError, RuntimeError, ValueError, TypeError):
            raise ReviewConfigError("Invalid source review configuration.") from None

    def latestReview(self, sourceId: str) -> SourceReview | None:
        candidates = [review for review in self.reviews if review.sourceId == sourceId]
        if not candidates:
            return None
        # Never skip a later rejection or stale attestation to resurrect an earlier approval.
        selected = max(candidates, key=lambda review: (review.reviewedAt, review.reviewId.int))
        return selected.model_copy(deep=True)


class ApprovalGate:
    """Evaluate human attestations against trusted snapshots, without changing state."""

    def __init__(self, moduleId: str, catalog: CatalogStore, knowledgeChecksums: dict[str, str], requiredSourceIds: list[str], reviews: ReviewStore, settings=None):
        self.moduleId = moduleId
        self.catalog = catalog
        self.knowledgeChecksums = dict(knowledgeChecksums)
        self.requiredSourceIds = tuple(sorted(requiredSourceIds))
        self.reviews = reviews
        self.settings = settings

    def evaluateReview(self, source: SourceRecord, review: SourceReview | None) -> SourceApprovalResult:
        failed = []
        reviewId = None
        try:
            current = self.catalog.getSource(source.sourceId)
        except SourceUnavailableError:
            return SourceApprovalResult(sourceId=source.sourceId, eligible=False, failedCriteria=["sourceAvailable"], reviewId=None)
        if review is None:
            return SourceApprovalResult(sourceId=source.sourceId, eligible=False, failedCriteria=["reviewMissing"], reviewId=None)
        try:
            # Revalidate even model_construct or mutated instances; never trust bypassed schemas.
            review = SourceReview.model_validate(review.model_dump(warnings=False), context=self.settings)
            reviewId = review.reviewId
        except (ValueError, TypeError, AttributeError):
            return SourceApprovalResult(sourceId=source.sourceId, eligible=False, failedCriteria=["reviewValid"], reviewId=None)
        if review.moduleId != self.moduleId:
            failed.append("moduleId")
        if review.sourceId != current.sourceId:
            failed.append("sourceId")
        if metadataDigest(source) != metadataDigest(current):
            failed.append("sourceMetadata")
        for criterion in RequiredCriteria:
            if getattr(review, criterion) is not True:
                failed.append(criterion)
        if (current.verifiedUrl is not None and review.urlVerified is not True) or (current.verifiedUrl is None and review.urlVerified is False):
            failed.append("urlVerified")
        if review.outcome != "approved":
            failed.append("outcome")
        trustedHash = self.knowledgeChecksums.get(current.knowledgeFile)
        if trustedHash is None or review.knowledgeHash != trustedHash:
            failed.append("knowledgeHash")
        if review.metadataHash != metadataDigest(current):
            failed.append("metadataHash")
        return SourceApprovalResult(sourceId=current.sourceId, eligible=not failed, failedCriteria=failed, reviewId=reviewId)

    def evaluateModuleApproval(self) -> ModuleApprovalResult:
        results = []
        for sourceId in self.requiredSourceIds:
            try:
                source = self.catalog.getSource(sourceId)
            except SourceUnavailableError:
                results.append(SourceApprovalResult(sourceId=sourceId, eligible=False, failedCriteria=["sourceAvailable"], reviewId=None))
                continue
            results.append(self.evaluateReview(source, self.reviews.latestReview(sourceId)))
        failed = [] if self.requiredSourceIds else ["requiredSources"]
        return ModuleApprovalResult(moduleId=self.moduleId, eligible=bool(results) and all(result.eligible for result in results), failedCriteria=failed, sourceResults=results)
