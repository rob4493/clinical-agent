"""Explicit reproductive-status contradictions halt processing without quoting input."""

import re

from backend.app.models.input import ClinicalCaseInput
from backend.app.models.output import DataConflict, ClarificationRequired
from backend.app.utils.assertions import currentClauses, Negation, Uncertainty, DeniedSuffix, UncertainSuffix

StatusPatterns = {
    "pregnancyPossible": (
        r"pregnancy (?:is )?(?:confirmed|possible|known)|patient is pregnant|positive pregnancy test|pregnancy test (?:is )?positive",
        r"pregnancy (?:(?:is|was) )?ruled out|(?:patient is )?not pregnant|pregnancy test (?:is )?negative"),
    "pidDiagnosedOrPresumed": (
        r"pid (?:is |was )?diagnosed|diagnosed with pid|presumptive pid diagnosis|pid (?:is )?presumptively diagnosed|clinician presumptively diagnosed pid",
        r"pid (?:(?:is|was) )?ruled out|pid (?:(?:is|was) )?not diagnosed|no presumptive pid diagnosis")}


class ConflictService:
    """Conservative explicit-status checks; symptoms and silence establish no status."""

    def checkConflict(self, caseInput: ClinicalCaseInput) -> DataConflict | ClarificationRequired | None:
        conflicts = []
        clarifications = []
        # Historical/family/treatment fields are deliberately not current-case assertions.
        texts = [caseInput.additionalNotes, caseInput.fertilityStatus, caseInput.painLocation, caseInput.painQuality,
                 caseInput.painSeverity, caseInput.symptomTiming, caseInput.bowelUrinarySymptoms, caseInput.sexualPain, caseInput.menstrualHistory]
        for fieldName, (positive, negative) in StatusPatterns.items():
            statements = set()
            for text in texts:
                for clause in currentClauses(text):
                    for pattern, status in [(positive, True), (negative, False)]:
                        for match in re.finditer(r"\b(?:" + pattern + r")\b", clause):
                            # Negated status phrases such as 'not ruled out' establish neither status.
                            if not Negation.search(clause[:match.start()]) and not Uncertainty.search(clause[:match.start()]) and not DeniedSuffix.search(clause[match.end():]) and not UncertainSuffix.search(clause[match.end():]):
                                statements.add(status)
            structured = getattr(caseInput, fieldName)
            question = "Please confirm or correct the structured pregnancy status." if fieldName == "pregnancyPossible" else "Please confirm or correct the structured PID diagnostic status."
            if statements and structured is None:
                clarifications.append(ClarificationRequired(fieldName=fieldName, clarificationRequest=question))
            elif statements and (len(statements) > 1 or structured not in statements):
                conflicts.append(DataConflict(fieldName=fieldName, structuredValue=str(structured),
                    conflictDescription="Structured status and explicit current-case text are inconsistent.", clarificationRequest=question))
        # Explicit different scores for the current pelvic-pain event require clarification;
        # scores never establish acute severity, a threshold, or disease stage.
        scores = set()
        for clause in currentClauses(caseInput.additionalNotes):
            for match in re.finditer(r"\b(?:current|same event) pelvic pain (?:score|severity) (?:is )?(\d+(?:\.\d+)?)/10\b", clause):
                if not Negation.search(clause[:match.start()]) and not Uncertainty.search(clause[:match.start()]):
                    scores.add(float(match.group(1)))
        if len(scores) > 1:
            clarifications.append(ClarificationRequired(fieldName="painSeverity", clarificationRequest="Please clarify whether the differing pain scores refer to the same current event."))
        # A definite contradiction takes precedence over an incomplete field; neither runs rules.
        return conflicts[0] if conflicts else clarifications[0] if clarifications else None
