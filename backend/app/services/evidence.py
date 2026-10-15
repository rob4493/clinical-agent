"""Fail-closed read-only packages; never loads candidates or extracts documents."""

import hashlib
import json
import os
import stat
from pathlib import Path, PureWindowsPath

from backend.app.models.evidence import ClaimSet, ChunkFile, EvidenceManifest, EvidencePackage, ReviewSet
from backend.app.models.module import ClinicalModuleConfig
from backend.app.models.retrieval import ChunkStatus
from backend.app.modules.catalog import CatalogStore, checkPairs, resolveFile
from backend.app.modules.registry import ModuleRegistry
from backend.app.modules.reviews import ApprovalGate, ReviewStore, metadataDigest

ArtifactLimit = 16 * 1024 * 1024


class EvidenceUnavailableError(ValueError):
    """Generic unavailable result; never exposes content, credentials or paths."""


def readArtifact(root: Path, relativePath: str, limit: int = ArtifactLimit) -> bytes:
    """Read verified handles; reject observed replacements and symlink/reparse paths."""
    if any(part.lower() == "sourceintake" for part in PureWindowsPath(relativePath).parts):
        raise ValueError()
    path = checkArtifactPath(root, relativePath)
    before = path.stat()
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        opened = os.fstat(stream.fileno())
        if fileIdentity(before) != fileIdentity(opened) or not stat.S_ISREG(opened.st_mode):
            raise ValueError()
        content = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    current = checkArtifactPath(root, relativePath)
    if len(content) > limit or len(content) != opened.st_size or current != path or fileIdentity(opened) != fileIdentity(after) or fileIdentity(after) != fileIdentity(current.stat()):
        raise ValueError()
    return content


def fileIdentity(metadata):
    # Windows path stat/CRT fstat disagree on ctime semantics for unchanged files.
    identity = (metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns)
    return identity if os.name == "nt" else identity + (metadata.st_ctime_ns,)


def checkArtifactPath(root: Path, relativePath: str) -> Path:
    """Reject every module-local symbolic link and Windows reparse point."""
    root = Path(root).absolute()
    if root.resolve(strict=True) != root:
        raise ValueError()
    path = resolveFile(root, relativePath)
    if not path.is_relative_to(root):
        raise ValueError()
    candidate = root
    for segment in (root / relativePath).relative_to(root).parts:
        candidate = candidate / segment
        metadata = candidate.lstat()
        if stat.S_ISLNK(metadata.st_mode) or getattr(metadata, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
            raise ValueError()
    return path


def parseArtifact(modelClass, content: bytes):
    json.loads(content, object_pairs_hook=checkPairs)
    return modelClass.model_validate_json(content)


def artifactHash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


class EvidenceLoader:
    """Require configured administrative trust and current governed provenance."""

    def __init__(self, registry: ModuleRegistry):
        self.registry = registry

    def load(self, moduleId: str) -> list[EvidencePackage]:
        try:
            config = self.registry.resolveModule(moduleId)
            root = self.registry.moduleRoots[config.moduleId]
            currentConfig = parseArtifact(ClinicalModuleConfig, readArtifact(root, "config.json", 65536))
            if currentConfig != config or not config.evidencePackages or config.evidenceDirectory is None:
                raise ValueError()
            directoryPath = PureWindowsPath(config.evidenceDirectory)
            if directoryPath.drive or directoryPath.root or ".." in directoryPath.parts or ":" in config.evidenceDirectory:
                raise ValueError()
            directory = (root / config.evidenceDirectory).resolve(strict=True)
            if not directory.is_relative_to(root) or not directory.is_dir():
                raise ValueError()
            files = list(directory.iterdir())
            expectedFiles = {str(packageId) + ".json" for packageId in config.evidencePackages}
            if len(files) > 100 or {path.name for path in files} != expectedFiles:
                raise ValueError()
            # Refresh disk snapshots so a later rejection cannot be hidden by registry caches.
            catalog = CatalogStore(root, config.sourceCatalog, config.knowledgeChecksums)
            oldGate = self.registry.approvalGates[config.moduleId]
            reviews = ReviewStore(root, config.reviewDirectory, config.moduleId, oldGate.settings)
            gate = ApprovalGate(config.moduleId, catalog, config.knowledgeChecksums, config.requiredSourceIds, reviews, oldGate.settings)
            if not gate.evaluateModuleApproval().eligible or not self.registry.evaluateModuleApproval(config.moduleId).eligible:
                raise ValueError()
            for sourceId in config.requiredSourceIds:
                if catalog.getSource(sourceId).status != "approved":
                    raise ValueError()
            packages = []
            chunkIds = set()
            packageIds = set()
            for filename in sorted(expectedFiles):
                manifestBytes = readArtifact(root, config.evidenceDirectory + "/" + filename, 65536)
                manifest = parseArtifact(EvidenceManifest, manifestBytes)
                if manifest.packageId in packageIds or filename != str(manifest.packageId) + ".json" or artifactHash(manifestBytes) != config.evidencePackages.get(manifest.packageId):
                    raise ValueError()
                if manifest.packageHash is None or json.loads(manifestBytes).get("packageHash") is None:
                    raise ValueError()
                packageIds.add(manifest.packageId)
                package = self.loadPackage(root, config, manifest, catalog, reviews, gate)
                for chunk in package.chunks:
                    if chunk.chunkId in chunkIds:
                        raise ValueError()
                    chunkIds.add(chunk.chunkId)
                packages.append(package)
            return packages
        except (OSError, RuntimeError, ValueError, TypeError, KeyError, AttributeError):
            raise EvidenceUnavailableError("Approved evidence is unavailable.") from None

    def loadPackage(self, root, config, manifest, catalog, reviews, gate):
        """Hash every artifact before parsing; all references remain module-local."""
        if manifest.moduleId != config.moduleId or manifest.evidenceVersion != config.kbVersion or manifest.status != ChunkStatus.approved:
            raise ValueError()
        if manifest.sourceCatalogFile != config.sourceCatalog or config.knowledgeChecksums.get(manifest.knowledgeFile) != manifest.knowledgeHash:
            raise ValueError()
        artifacts = {}
        for field, hashField in [("chunksFile", "chunksHash"), ("claimsFile", "claimsHash"), ("reviewSetFile", "reviewSetHash"),
                ("sourceCatalogFile", "sourceCatalogHash"), ("knowledgeFile", "knowledgeHash")]:
            content = readArtifact(root, getattr(manifest, field))
            if artifactHash(content) != getattr(manifest, hashField):
                raise ValueError()
            artifacts[field] = content
        rawChunks = json.loads(artifacts["chunksFile"], object_pairs_hook=checkPairs)
        if not isinstance(rawChunks, dict) or any(not chunk.get("contentHash") for chunk in rawChunks.get("chunks", []) if isinstance(chunk, dict)):
            raise ValueError()
        chunks = parseArtifact(ChunkFile, artifacts["chunksFile"]).chunks
        claims = parseArtifact(ClaimSet, artifacts["claimsFile"]).claims
        reviewSet = parseArtifact(ReviewSet, artifacts["reviewSetFile"]).reviews
        claimMap = {claim.claimId: claim for claim in claims}
        reviewMap = {review.reviewId: review for review in reviewSet}
        if len(claimMap) != len(claims) or len(reviewMap) != len(reviewSet) or len(chunks) != manifest.chunkCount:
            raise ValueError()
        for sourceId, artifact in manifest.sourceArtifacts.items():
            source = catalog.getSource(sourceId)
            if source.status != "approved" or artifactHash(readArtifact(root, artifact.file)) != artifact.sourceHash:
                raise ValueError()
        for review in reviewSet:
            source = catalog.getSource(review.sourceId)
            latest = reviews.latestReview(review.sourceId)
            if source.status != "approved" or latest is None or latest != review or review.moduleId != config.moduleId or not gate.evaluateReview(source, review).eligible or not self.registry.evaluateReview(config.moduleId, source, review).eligible:
                raise ValueError()
        for claim in claims:
            if claim.moduleId != config.moduleId or claim.evidenceVersion != manifest.evidenceVersion or claim.knowledgeHash != manifest.knowledgeHash:
                raise ValueError()
            if catalog.getSource(claim.sourceId).status != "approved":
                raise ValueError()
            for reviewId in claim.approvedReviewIds:
                if reviewId not in reviewMap or reviewMap[reviewId].sourceId != claim.sourceId:
                    raise ValueError()
        chunkIds = set()
        for chunk in chunks:
            if chunk.chunkId in chunkIds or chunk.moduleId != config.moduleId or chunk.packageId != manifest.packageId or chunk.evidenceVersion != manifest.evidenceVersion or chunk.knowledgeHash != manifest.knowledgeHash or chunk.status != ChunkStatus.approved:
                raise ValueError()
            chunkIds.add(chunk.chunkId)
            source = catalog.getSource(chunk.sourceId)
            artifact = manifest.sourceArtifacts.get(chunk.sourceId)
            if source.status != "approved" or source.knowledgeFile != manifest.knowledgeFile or artifact is None or chunk.sourceHash != artifact.sourceHash:
                raise ValueError()
            if source.verifiedUrl != chunk.verifiedUrl or source.title != chunk.documentTitle or source.jurisdiction != chunk.jurisdiction:
                raise ValueError()
            if metadataDigest(source) != metadataDigest(self.registry.getSource(config.moduleId, chunk.sourceId)):
                raise ValueError()
            for reviewId in chunk.approvedReviewIds:
                if reviewId not in reviewMap or reviewMap[reviewId].sourceId != chunk.sourceId:
                    raise ValueError()
            for claimId in chunk.claimIds:
                claim = claimMap.get(claimId)
                if claim is None or claim.sourceId != chunk.sourceId or not set(chunk.approvedReviewIds).issubset(claim.approvedReviewIds):
                    raise ValueError()
        return EvidencePackage(manifest=manifest, chunks=chunks)
