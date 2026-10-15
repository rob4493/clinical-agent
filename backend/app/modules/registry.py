"""Resolve explicit selections using reviewed operational configuration only."""

import json
from pathlib import Path
from types import MappingProxyType

from pydantic import ValidationError

from backend.app.models.module import ClinicalModuleConfig, ModuleStatus
from backend.app.models.catalog import SourceRecord
from backend.app.modules.catalog import CatalogStore, resolveFile
from backend.app.modules.reviews import ApprovalGate, ReviewStore
from backend.app.models.review import ModuleApprovalResult, SourceApprovalResult, SourceReview


class RegistryConfigError(ValueError):
    """Configuration failure that prevents application creation."""


class ModuleUnavailableError(ValueError):
    """Safe domain failure suitable for the ModuleUnavailable response."""


class ModuleSelectionError(ValueError):
    """Explicit unselected option requires module selection before analysis."""


def parsePairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    """Reject duplicate JSON keys rather than silently accepting the last value."""
    fields = {}
    for fieldName, fieldContent in pairs:
        if fieldName in fields:
            raise RegistryConfigError("Invalid module configuration.")
        fields[fieldName] = fieldContent
    return fields


class ModuleRegistry:
    """Fail-closed module metadata registry; never consumes symptoms or case text."""

    def __init__(self, moduleRoot: Path, settings=None):
        self.moduleConfigs: dict[str, ClinicalModuleConfig] = {}
        self.selections: dict[str, str] = {}
        self.catalogs: dict[str, CatalogStore] = {}
        self.approvalGates: dict[str, ApprovalGate] = {}
        self.moduleRoots: dict[str, Path] = {}
        try:
            root = Path(moduleRoot).resolve(strict=True)
            if not root.is_dir():
                raise ValueError()
            # Canonical paths contain symlink/junction targets, not just lexical paths.
            for directory in sorted(root.iterdir()):
                if not directory.is_dir() or directory.name == "__pycache__":
                    continue
                localRoot = directory.resolve(strict=True)
                if not localRoot.is_relative_to(root):
                    raise ValueError()
                configPath = directory / "config.json"
                resolvedPath = configPath.resolve(strict=True)
                if not resolvedPath.is_relative_to(localRoot) or resolvedPath.stat().st_size > 65536:
                    raise ValueError()
                config = ClinicalModuleConfig.model_validate(json.loads(
                    resolvedPath.read_text(encoding="utf-8"), object_pairs_hook=parsePairs))
                if config.knowledgePath is not None:
                    # Preserve the root-relative compatibility field, but enforce module ownership.
                    resolvedKnowledge = resolveFile(root, config.knowledgePath)
                    if not resolvedKnowledge.is_relative_to(localRoot):
                        raise ValueError()
                if config.moduleId in self.moduleConfigs:
                    raise ValueError()
                self.moduleConfigs[config.moduleId] = config
                self.moduleRoots[config.moduleId] = localRoot
                self.catalogs[config.moduleId] = CatalogStore(localRoot, config.sourceCatalog, config.knowledgeChecksums)
                # Registration may omit evidence only while both inactive and unapproved.
                if config.active or config.status == ModuleStatus.approved:
                    if config.sourceCatalog is None or not config.knowledgeChecksums or not self.catalogs[config.moduleId].listSources() or config.kbVersion is None or config.reviewDate is None:
                        raise ValueError()
                if len(config.requiredSourceIds) != len(set(config.requiredSourceIds)):
                    raise ValueError()
                reviews = ReviewStore(localRoot, config.reviewDirectory, config.moduleId, settings)
                self.approvalGates[config.moduleId] = ApprovalGate(config.moduleId, self.catalogs[config.moduleId], config.knowledgeChecksums, config.requiredSourceIds, reviews, settings)
                for selection in {config.moduleId, config.moduleHintValue}:
                    if selection == "NotSure" or selection in self.selections:
                        raise ValueError()
                    self.selections[selection] = config.moduleId
        except (OSError, RuntimeError, ValueError, TypeError, ValidationError):
            # Never expose config content, paths, or Pydantic input in startup errors.
            raise RegistryConfigError("Invalid module configuration.") from None
        self.moduleConfigs = MappingProxyType(dict(sorted(self.moduleConfigs.items())))
        self.selections = MappingProxyType(self.selections)
        self.catalogs = MappingProxyType(dict(sorted(self.catalogs.items())))
        self.approvalGates = MappingProxyType(dict(sorted(self.approvalGates.items())))
        self.moduleRoots = MappingProxyType(dict(sorted(self.moduleRoots.items())))

    def evaluateReview(self, moduleId: str, source: SourceRecord, review: SourceReview | None) -> SourceApprovalResult:
        self.getModule(moduleId)
        return self.approvalGates[moduleId].evaluateReview(source, review)

    def evaluateModuleApproval(self, moduleId: str) -> ModuleApprovalResult:
        """Internal evidence eligibility only; never changes discovery, readiness, or activation."""
        self.getModule(moduleId)
        return self.approvalGates[moduleId].evaluateModuleApproval()

    def listSources(self, moduleId: str) -> list[SourceRecord]:
        """Internal canonical-ID provenance lookup; grants no analysis permission."""
        self.getModule(moduleId)
        return self.catalogs[moduleId].listSources()

    def getSource(self, moduleId: str, sourceId: str) -> SourceRecord:
        """Never search across modules or accept a clinical case as a selection."""
        self.getModule(moduleId)
        return self.catalogs[moduleId].getSource(sourceId)

    def getModule(self, moduleId: str) -> ClinicalModuleConfig:
        """Return an isolated metadata copy by canonical ID, including disabled modules."""
        if not isinstance(moduleId, str) or moduleId not in self.moduleConfigs:
            raise ModuleUnavailableError("Selected module is unavailable.")
        return self.moduleConfigs[moduleId].model_copy(deep=True)

    def resolveModule(self, moduleId: str) -> ClinicalModuleConfig:
        """Resolve an exact canonical ID or configured explicit selection alias."""
        if moduleId == "NotSure":
            raise ModuleSelectionError("Select a clinical module.")
        if not isinstance(moduleId, str) or moduleId not in self.selections:
            raise ModuleUnavailableError("Selected module is unavailable.")
        config = self.getModule(self.selections[moduleId])
        if not config.active or config.status != ModuleStatus.approved:
            raise ModuleUnavailableError("Selected module is unavailable.")
        return config

    def listModules(self) -> list[ClinicalModuleConfig]:
        """List resolvable modules in canonical identifier order, without shared objects."""
        return [self.getModule(moduleId) for moduleId, config in sorted(self.moduleConfigs.items())
                if config.active and config.status == ModuleStatus.approved]
