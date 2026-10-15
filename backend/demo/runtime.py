"""Opt-in fictional composition; never activates or loads authentic clinical evidence."""

import json
from pathlib import Path
from threading import RLock

from backend.app.models.analysis import ResponseStatement, FollowupQuestion
from backend.demo.cases import BriefNarrative, DetailedNarrative, CaseParts, CaseQuestions, OutsideNarrative
from backend.demo.policy import TestParts, selectParts, explainLimit
from backend.app.models.output import EvidenceInsufficientResponse
from backend.app.services.cancellation import checkCancelled
from backend.app.models.safety import UrgentWarning
from backend.app.modules.registry import ModuleRegistry
from backend.app.modules.module01Endo.urgent import Module1Rules
from backend.app.services.analysis import AnalysisService
from backend.app.services.evidence import EvidenceLoader
from backend.app.services.retrieval import RetrievalService
from backend.app.services.safety import SafetyService, SafetyInputError
from backend.app.models.input import ClinicalCaseInput
from backend.demo.synthetic import MemoryVectors, SyntheticEmbedding

DemoModule = "SyntheticDemo"
DemoNotice = "Synthetic demonstration — uses fictional test evidence and must not be used for clinical care."
DemoWarnings = {
    "U1": "Possible or known pregnancy with a predefined acute symptom pattern requires immediate emergency assessment. This warning does not establish a cause.",
    "U2": "Sudden or severe acute pelvic pain requires prompt independent assessment. Do not treat this presentation as routine chronic pelvic pain.",
    "U3": "With PID explicitly marked Yes, a predefined disposition consideration has triggered. Review the applicable disposition criteria independently; symptoms alone do not establish PID status.",
}
BriefParts = CaseParts[BriefNarrative.casefold()]
DetailedParts = CaseParts[DetailedNarrative.casefold()]
BriefText = " ".join(BriefParts)
DetailedText = " ".join(DetailedParts)


class DemoLanguage:
    """Stateless injected fake; reads request-local sections without retaining case data."""

    def generate(self, request):
        sections = json.loads(request.content)
        case = sections["CaseData"]
        # An exact fictional scenario exercises the existing insufficient-output fallback.
        if (case.get("additionalNotes") or "").strip().casefold() in ("demo evidence unavailable", OutsideNarrative.casefold()):
            return {"considerations": []}
        narrative = (case.get("additionalNotes") or "").strip().casefold()
        # Older demo scripts may still send the prefix; it never affects interpretation.
        narrative = narrative.removeprefix("fictional demonstration:").strip()
        caseInput = ClinicalCaseInput.model_validate(case)
        texts, questionKey = selectParts(caseInput)
        if not texts:
            return {"considerations": []}
        # Exact case templates are selected from submitted fields, never a UI preset ID.
        # No arbitrary narrative is copied into the trusted response vocabulary.
        statements = [next(statement for statement in sections["AllowedStatements"] if statement["text"] == text) for text in texts]
        question = CaseQuestions.get(questionKey)
        questionId = question[0] if question and any(candidate["questionId"] == question[0] for candidate in sections["EligibleQuestions"]) else None
        return {"considerations": statements, "questionId": questionId}


class DemoAnalysis(AnalysisService):
    """Keep the real pipeline; specialize only its safe demo insufficiency explanation."""

    def analyzeCase(self, caseInput):
        result = super().analyzeCase(caseInput)
        checkCancelled()
        if isinstance(result.response, EvidenceInsufficientResponse) and not result.serviceUnavailable:
            case = ClinicalCaseInput.model_validate(caseInput.model_dump() if isinstance(caseInput, ClinicalCaseInput) else caseInput, context=self.safety.settings)
            response = EvidenceInsufficientResponse(moduleId=result.response.moduleId, message=explainLimit(case))
            return self.present(response, result.warnings)
        return result


class DemoSafety(SafetyService):
    """Reuse real validation/conflicts/rule predicates with fictional source projection only."""

    def evaluateCase(self, caseInput):
        try:
            case = ClinicalCaseInput.model_validate(caseInput.model_dump(), context=self.settings)
        except Exception:
            raise SafetyInputError("Invalid clinical case input.") from None
        config = self.registry.resolveModule(case.moduleHint)
        if config.moduleId != DemoModule:
            raise ValueError("Synthetic module is unavailable.")
        halted = self.conflicts.checkConflict(case) or self.rules.checkFindingConflict(case)
        if halted is not None:
            return halted
        # Pure existing predicates require the compatibility Module 1 ID; no authentic
        # registry, source, warning wording or evidence is loaded into this graph.
        result = self.rules.evaluate(case, "module_01_endo", ["U1", "U2", "U3"])
        result.moduleId = DemoModule
        result.warningsTriggered = [UrgentWarning(ruleId=warning.ruleId,
            text=DemoWarnings[warning.ruleId],
            sourceTags=["SyntheticSource"]) for warning in result.warningsTriggered]
        return result


class DemoVectors(MemoryVectors):
    """Process-local guarded evidence-only index; no query storage or distributed claims."""

    def __init__(self):
        super().__init__()
        self.lock = RLock()

    def ensureCollection(self, moduleId, dimension):
        with self.lock:
            return super().ensureCollection(moduleId, dimension)

    def upsertChunks(self, moduleId, chunks, vectors):
        with self.lock:
            return super().upsertChunks(moduleId, chunks, vectors)

    def search(self, moduleId, queryVector, limit, filters):
        with self.lock:
            return super().search(moduleId, queryVector, limit, filters)

    def deletePackage(self, moduleId, packageId):
        with self.lock:
            return super().deletePackage(moduleId, packageId)


def composeDemo(settings):
    """Read only the dedicated fictional root after exact explicit configuration opt-in."""
    if settings.clinicalDemoMode is not True:
        raise ValueError("Synthetic runtime is disabled.")
    try:
        registry = ModuleRegistry(Path(__file__).parent / "artifacts", settings)
        if [config.moduleId for config in registry.listModules()] != [DemoModule]:
            raise ValueError()
        loader = EvidenceLoader(registry)
        chunks = [chunk for package in loader.load(DemoModule) for chunk in package.chunks]
        if len(chunks) != 1:
            raise ValueError()
        chunk = chunks[0]
        texts = list(dict.fromkeys(text for parts in (*CaseParts.values(), *TestParts.values()) for text in parts))
        # Runtime vocabulary and the hash-pinned source must move together deliberately.
        if chunk.text != "Available review statements: " + " ".join(texts + list(DemoWarnings.values())):
            raise ValueError()
        statements = [ResponseStatement(moduleId=DemoModule, text=text,
            references=[{"chunkId": chunk.chunkId, "claimId": chunk.claimIds[0]}], contentHashes=[chunk.contentHash])
            for text in texts]
        questions = [FollowupQuestion(questionId=questionId, moduleId=DemoModule, fieldName="symptomTiming",
            claimIds=[chunk.claimIds[0]], text=questionText) for questionId, questionText in CaseQuestions.values()]
        retrieval = RetrievalService(loader, SyntheticEmbedding(4), DemoVectors(), 4)
        from backend.app.services.watsonx import selectLanguage
        service = DemoAnalysis(registry, DemoSafety(registry, settings, rules=Module1Rules()), retrieval, selectLanguage(settings), statements, questions)
        if not service.isReady():
            raise ValueError()
        return registry, service
    except Exception:
        raise ValueError("Synthetic runtime configuration is unavailable.") from None

