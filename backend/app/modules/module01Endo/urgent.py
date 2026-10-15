"""Version 2.1 Section 10 rules; fixed warning text and exact submitted criteria only."""

import re
from decimal import Decimal

from backend.app.models.input import ClinicalCaseInput
from backend.app.models.output import DataConflict, ClarificationRequired
from backend.app.models.safety import UrgentFindings, UrgentWarning, SafetyResult
from backend.app.utils.assertions import phraseState, phraseStates, currentClauses, Negation, Uncertainty, DeniedSuffix, UncertainSuffix

RuleSources = {"U1": "ACOG-ECTOPIC", "U2": "ACOG-CPP", "U3": "CDC-PID"}
WarningText = {
    "U1": "Immediate emergency assessment is recommended. These findings do not confirm ectopic pregnancy. A ruptured ectopic pregnancy can cause life-threatening internal bleeding.",
    "U2": "Sudden or severe acute pelvic pain should not be treated as routine chronic endometriosis without prompt independent assessment.",
    "U3": "The reported findings meet a listed CDC PID hospitalization criterion for disposition consideration after clinician diagnosis or presumptive diagnosis. These criteria do not diagnose or prove PID."}
FindingPatterns = {
    "suddenSevereAbdominalOrPelvicPain": r"sudden severe (?:abdominal|pelvic) pain",
    "shoulderPain": r"shoulder pain", "weakness": r"weakness", "dizziness": r"dizziness", "fainting": r"fainting",
    "suddenAcutePelvicPain": r"sudden acute pelvic pain", "severeAcutePelvicPain": r"severe acute pelvic pain",
    "surgicalEmergencyCannotBeExcluded": r"(?:unable|inability) to exclude a surgical emergency|surgical emergency cannot be excluded",
    "tuboOvarianAbscess": r"tubo[- ]ovarian abscess", "severeIllness": r"severe illness", "nauseaAndVomiting": r"nausea and vomiting",
    "cannotFollowOrTolerateOutpatientOralTherapy": r"(?:unable|inability) to (?:follow(?: or tolerate)?|tolerate) outpatient oral therapy|cannot (?:follow(?: or tolerate)?|tolerate) outpatient oral therapy",
    "noClinicalResponseToOralTherapy": r"no clinical response to oral therapy"}


class Module1Rules:
    """Module 1 only; no status inference, unit conversion, prescribing, or diagnosis."""

    def checkFindingConflict(self, caseInput: ClinicalCaseInput) -> DataConflict | ClarificationRequired | None:
        findings = caseInput.urgentFindings or UrgentFindings()
        for name, pattern in FindingPatterns.items():
            structured = getattr(findings, name)
            statements = phraseStates(caseInput.additionalNotes, pattern)
            if structured is not None and any(structured is not statement for statement in statements):
                return DataConflict(fieldName="urgentFindings." + name, structuredValue=str(structured),
                    conflictDescription="Structured urgent finding and explicit current-case text are inconsistent.",
                    clarificationRequest="Please confirm or correct the conflicting urgent finding.")
            if len(statements) > 1:
                return ClarificationRequired(fieldName="urgentFindings." + name,
                    clarificationRequest="Please clarify the opposing current urgent-finding statements.")
        return None

    def evaluate(self, caseInput: ClinicalCaseInput, moduleId: str, enabledRules: list[str]) -> SafetyResult:
        if moduleId != "module_01_endo":
            raise ValueError("Safety rules are unavailable for the selected module.")
        findings = caseInput.urgentFindings or UrgentFindings()
        states = {}
        evaluated = []
        warnings = []

        def readFinding(name: str) -> bool | None:
            structured = getattr(findings, name)
            explicit = phraseState(caseInput.additionalNotes, FindingPatterns[name])
            # Contradictory findings remain Unknown; never select one version.
            return explicit if structured is None else structured if explicit is None or explicit is structured else None

        def addWarning(ruleId: str):
            warnings.append(UrgentWarning(ruleId=ruleId, text=WarningText[ruleId], sourceTags=[RuleSources[ruleId]]))

        if "U1" in enabledRules and caseInput.pregnancyPossible is True:
            evaluated.append("U1")
            compatible = ["suddenSevereAbdominalOrPelvicPain", "shoulderPain", "weakness", "dizziness", "fainting"]
            for name in compatible:
                states[name] = readFinding(name)
            if any(states[name] is True for name in compatible):
                addWarning("U1")
        if "U2" in enabledRules:
            evaluated.append("U2")
            for name in ["suddenAcutePelvicPain", "severeAcutePelvicPain"]:
                states[name] = readFinding(name)
            if states["suddenAcutePelvicPain"] is True or states["severeAcutePelvicPain"] is True:
                addWarning("U2")
        # The structured PID gate is checked before reading any U3 criterion.
        if "U3" in enabledRules and caseInput.pidDiagnosedOrPresumed is True:
            evaluated.append("U3")
            disposition = ["surgicalEmergencyCannotBeExcluded", "tuboOvarianAbscess", "severeIllness", "nauseaAndVomiting",
                           "cannotFollowOrTolerateOutpatientOralTherapy", "noClinicalResponseToOralTherapy"]
            for name in disposition:
                states[name] = readFinding(name)
            # Possible pregnancy is not inferred to be established pregnancy for the U3 criterion.
            states["pregnancy"] = phraseState(caseInput.additionalNotes, r"pregnancy (?:is )?confirmed|patient is pregnant")
            celsius = findings.oralTemperatureCelsius
            fahrenheit = findings.oralTemperatureFahrenheit
            temperatures = ([celsius > 38.5] if celsius is not None else []) + ([fahrenheit > 101] if fahrenheit is not None else [])
            for clause in currentClauses(caseInput.additionalNotes):
                for match in re.finditer(r"\boral temperature (?:is )?([+-]?\d+(?:\.\d+)?)\s*(?:\u00b0\s*)?(celsius|fahrenheit|c|f)\b", clause):
                    if not Negation.search(clause[:match.start()]) and not Uncertainty.search(clause[:match.start()]) and not DeniedSuffix.search(clause[match.end():]) and not UncertainSuffix.search(clause[match.end():]):
                        threshold = Decimal("38.5") if match.group(2) in {"c", "celsius"} else Decimal("101")
                        temperatures.append(Decimal(match.group(1)) > threshold)
            states["oralTemperatureAboveThreshold"] = temperatures[0] if temperatures and len(set(temperatures)) == 1 else None
            if any(states[name] is True for name in disposition + ["pregnancy", "oralTemperatureAboveThreshold"]):
                addWarning("U3")
        return SafetyResult(moduleId=moduleId, rulesEvaluated=evaluated, warningsTriggered=warnings, criterionStates=states)
