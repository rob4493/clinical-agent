"""Validate, resolve explicit selection, halt conflicts, then coordinate module rules."""

from backend.app.config import Settings
from backend.app.models.input import ClinicalCaseInput
from backend.app.models.output import DataConflict, ClarificationRequired, ModuleUnavailable, SelectModuleRequired
from backend.app.models.safety import SafetyResult
from backend.app.modules.registry import ModuleRegistry, ModuleUnavailableError, ModuleSelectionError
from backend.app.modules.module01Endo.urgent import Module1Rules, RuleSources
from backend.app.services.conflicts import ConflictService


class SafetyInputError(ValueError):
    """Invalid input without submitted content in the exception."""


class SafetyConfigError(ValueError):
    """Unsupported module rules or missing source provenance; no analysis is permitted."""


class SafetyService:
    """Per-app internal coordinator; no clinical thresholds or generation logic."""

    def __init__(self, registry: ModuleRegistry, settings: Settings, conflicts: ConflictService | None = None, rules: Module1Rules | None = None):
        self.registry = registry
        self.settings = settings
        self.conflicts = conflicts if conflicts is not None else ConflictService()
        self.rules = rules if rules is not None else Module1Rules()

    def evaluateCase(self, caseInput: ClinicalCaseInput | dict) -> SafetyResult | DataConflict | ClarificationRequired | ModuleUnavailable | SelectModuleRequired:
        try:
            payload = caseInput.model_dump(warnings=False) if isinstance(caseInput, ClinicalCaseInput) else caseInput
            validated = ClinicalCaseInput.model_validate(payload, context=self.settings)
        except (ValueError, TypeError):
            raise SafetyInputError("Invalid clinical case input.") from None
        try:
            config = self.registry.resolveModule(validated.moduleHint)
        except ModuleSelectionError:
            return SelectModuleRequired()
        except ModuleUnavailableError:
            return ModuleUnavailable(moduleHint=validated.moduleHint, message="The selected module is unavailable.")
        halted = self.conflicts.checkConflict(validated)
        if halted is not None:
            return halted
        if config.moduleId != "module_01_endo" or any(ruleId not in RuleSources for ruleId in config.urgentRuleIds):
            raise SafetyConfigError("Safety rules are unavailable for the selected module.")
        findingConflict = self.rules.checkFindingConflict(validated)
        if findingConflict is not None:
            return findingConflict
        sourceIds = {source.sourceId for source in self.registry.listSources(config.moduleId)}
        if any(RuleSources[ruleId] not in sourceIds for ruleId in config.urgentRuleIds):
            raise SafetyConfigError("Safety source provenance is unavailable.")
        result = self.rules.evaluate(validated, config.moduleId, config.urgentRuleIds)
        # Preserve module-defined priority while deduplicating exact rule/source warnings.
        seen = set()
        unique = []
        for warning in result.warningsTriggered:
            if any(sourceId not in sourceIds for sourceId in warning.sourceTags):
                raise SafetyConfigError("Safety source provenance is unavailable.")
            signature = (warning.ruleId, tuple(warning.sourceTags), warning.text)
            if signature not in seen:
                seen.add(signature)
                unique.append(warning)
        result.warningsTriggered = unique
        return result
