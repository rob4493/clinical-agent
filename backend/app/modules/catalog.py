"""Module-local source provenance with trusted runtime-mirror integrity checks."""

import hashlib
import json
from pathlib import Path, PureWindowsPath

from backend.app.models.catalog import SourceCatalog, SourceRecord


class CatalogError(ValueError):
    """Sanitized fail-closed provenance or integrity failure."""


class SourceUnavailableError(ValueError):
    """No source with this identifier exists in the explicitly selected catalog."""


def resolveFile(root: Path, relativePath: str) -> Path:
    """Canonicalize within a module root, rejecting traversal and Windows drive paths."""
    path = Path(relativePath)
    windowsPath = PureWindowsPath(relativePath)
    if not relativePath or path.is_absolute() or windowsPath.drive or windowsPath.root or ".." in path.parts or ".." in windowsPath.parts or ":" in relativePath:
        raise CatalogError("Invalid source catalog.")
    resolved = (root / path).resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise CatalogError("Invalid source catalog.")
    return resolved


def checkPairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    fields = {}
    for fieldName, fieldContent in pairs:
        if fieldName in fields:
            raise CatalogError("Invalid source catalog.")
        fields[fieldName] = fieldContent
    return fields


class CatalogStore:
    """Internal reviewed provenance metadata; no clinical content parsing or publication."""

    def __init__(self, moduleRoot: Path, catalogPath: str | None, knowledgeChecksums: dict[str, str]):
        self.sources: dict[str, SourceRecord] = {}
        try:
            root = moduleRoot.resolve(strict=True)
            verifiedFiles = set()
            # Digests come from trusted module config, never from the untrusted catalog.
            for knowledgeFile, expectedDigest in knowledgeChecksums.items():
                mirror = resolveFile(root, knowledgeFile)
                with mirror.open("rb") as stream:
                    document = stream.read(16 * 1024 * 1024 + 1)
                if len(document) > 16 * 1024 * 1024 or hashlib.sha256(document).hexdigest() != expectedDigest:
                    raise ValueError()
                verifiedFiles.add(knowledgeFile)
            if catalogPath is not None:
                catalogFile = resolveFile(root, catalogPath)
                with catalogFile.open("rb") as stream:
                    catalogBytes = stream.read(65537)
                if len(catalogBytes) > 65536:
                    raise ValueError()
                catalog = SourceCatalog.model_validate(json.loads(catalogBytes, object_pairs_hook=checkPairs))
                for source in catalog.sources:
                    # Every source must reference an independently checksum-verified mirror.
                    resolveFile(root, source.knowledgeFile)
                    if source.knowledgeFile not in verifiedFiles or source.sourceId in self.sources:
                        raise ValueError()
                    self.sources[source.sourceId] = source
        except (OSError, RuntimeError, ValueError, TypeError):
            raise CatalogError("Invalid source catalog.") from None

    def listSources(self) -> list[SourceRecord]:
        """Return deterministic isolated copies, including pending and retired metadata."""
        return [source.model_copy(deep=True) for sourceId, source in sorted(self.sources.items())]

    def getSource(self, sourceId: str) -> SourceRecord:
        if not isinstance(sourceId, str) or sourceId not in self.sources:
            raise SourceUnavailableError("Selected source is unavailable.")
        return self.sources[sourceId].model_copy(deep=True)
