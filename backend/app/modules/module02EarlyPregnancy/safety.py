"""Module 2 current-fact conflicts and urgent rules; no diagnostic thresholds."""

import re

from backend.app.models.output import ClarificationRequired, DataConflict
from backend.app.models.pregnancy import PregnancyContext
from backend.app.models.safety import SafetyResult, UrgentWarning
from backend.app.utils.assertions import currentClauses, phraseStates

Module2Id = "module_02_early_pregnancy"
Patterns = {
    "suddenSevereAbdominalOrPelvicPain": r"sudden severe (?:abdominal|pelvic) pain",
    "shoulderPain": r"shoulder(?: tip)? pain",
    "weakness": r"(?:marked |severe )?weakness",
    "dizziness": r"dizziness",
    "fainting": r"fainting|syncope",
    "heavyBleeding": r"heavy(?: vaginal)? bleeding",
    "hemodynamicInstability": r"ha?emodynamic(?:ally)? (?:instability|unstable)",
    "significantConcernAboutPainOrBleeding": r"clinician reports significant concern about (?:pain|bleeding)",
    "worseningPelvicPain": r"(?:rapidly )?worsening (?:pelvic|abdominal) pain",
    "suddenAcutePelvicPain": r"sudden (?:acute )?pelvic pain",
    "severeAcutePelvicPain": r"severe (?:acute )?pelvic pain",
}


def reportedStates(text, pattern):
    """Additional explicit uncertainty wording never establishes a Module 2 fact."""
    # Preserve a single explicit denial across a bare symptom list before the
    # shared matcher splits commas. An explicit predicate ends this narrow list.
    symptom = r"(?:shoulder(?: tip)? pain|weakness|dizziness|fainting|syncope)"
    deniedList = r"\b(?:no|denies|without)\s+" + symptom + r"(?:\s*(?:,\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)" + symptom + r")+(?=\s*(?:[.;!?]|$))"
    text = re.sub(deniedList, lambda match: match.group().replace(",", " and "), text or "", flags=re.IGNORECASE)
    clauses = [clause for clause in currentClauses(text)
        if not re.search(r"\b(?:uncertain|unsure|unclear|uncertainty|possibly|potential|maybe)\b", clause)]
    return phraseStates(". ".join(clauses), pattern)


def haltConflict(fieldName):
    return DataConflict(fieldName=fieldName, structuredValue="Reported context",
        conflictDescription="Explicit current findings are inconsistent.",
        clarificationRequest="Please confirm or correct the conflicting reported information.")


class PregnancySafety:
    """Use explicit reported states; negative testing never establishes nonpregnancy."""

    def __init__(self, registry, settings):
        self.registry = registry
        self.settings = settings

    def checkConflict(self, case):
        context = case.earlyPregnancy or PregnancyContext()
        # Test positivity and explicitly asserted pregnancy are distinct from symptoms.
        positive = reportedStates(case.additionalNotes, r"positive (?:urine |serum )?pregnancy test|pregnancy (?:is )?confirmed|patient is pregnant")
        denied = reportedStates(case.additionalNotes, r"pregnancy (?:is )?ruled out|patient is not pregnant")
        positiveStatus = True in positive or context.pregnancyTestResult == "positive"
        negativeStatus = True in denied
        if positiveStatus and negativeStatus:
            return haltConflict("pregnancyPossible")
        if positiveStatus or negativeStatus:
            if case.pregnancyPossible is None:
                return ClarificationRequired(fieldName="pregnancyPossible", clarificationRequest="Please confirm the structured pregnancy status.")
            if case.pregnancyPossible != positiveStatus:
                return haltConflict("pregnancyPossible")
        # Opposite laboratory results must be clarified, without treating a negative
        # urine result as proof that pregnancy or ectopic pregnancy is excluded.
        testStates = reportedStates(case.additionalNotes, r"(?:urine |serum )?pregnancy test (?:is )?positive|positive (?:urine |serum )?pregnancy test")
        negativeTest = True in reportedStates(case.additionalNotes, r"negative (?:urine |serum )?pregnancy test|pregnancy test (?:is )?negative")
        if (True in testStates and negativeTest) or (context.pregnancyTestResult == "negative" and True in testStates) or (context.pregnancyTestResult == "positive" and negativeTest):
            return haltConflict("earlyPregnancy.pregnancyTestResult")
        if context.clinicallyStable is True and context.hemodynamicInstability is True:
            return haltConflict("earlyPregnancy.clinicallyStable")
        routeStates = {route for route in ("transvaginal", "transabdominal") if True in reportedStates(case.additionalNotes, r"current scan route is " + route)}
        if len(routeStates) > 1 or (routeStates and context.ultrasoundRoute is not None and context.ultrasoundRoute not in routeStates):
            return haltConflict("earlyPregnancy.ultrasoundRoute")
        # Module 2 never uses PID symptoms to establish a diagnostic status.
        pidStates = reportedStates(case.additionalNotes, r"pid (?:is |was )?diagnosed|diagnosed with pid|presumptive pid diagnosis")
        if True in reportedStates(case.additionalNotes, r"pid (?:is |was )?not diagnosed|no presumptive pid diagnosis"):
            pidStates.add(False)
        if pidStates:
            if case.pidDiagnosedOrPresumed is None:
                return ClarificationRequired(fieldName="pidDiagnosedOrPresumed", clarificationRequest="Please confirm the structured PID diagnostic status.")
            if len(pidStates) > 1 or case.pidDiagnosedOrPresumed not in pidStates:
                return haltConflict("pidDiagnosedOrPresumed")
        return None

    def evaluateCase(self, case):
        self.registry.resolveModule(case.moduleHint)
        conflict = self.checkConflict(case)
        if conflict is not None:
            return conflict
        context = case.earlyPregnancy or PregnancyContext()
        findings = {}
        for name, pattern in Patterns.items():
            structured = getattr(context, name, None) if name in PregnancyContext.model_fields else getattr(case.urgentFindings, name, None) if case.urgentFindings else None
            observed = reportedStates(case.additionalNotes, pattern)
            if len(observed) > 1 or (observed and structured is not None and structured not in observed):
                return haltConflict("earlyPregnancy." + name)
            findings[name] = structured if structured is not None else next(iter(observed)) if observed else None
        if context.clinicallyStable is True and findings["hemodynamicInstability"] is True:
            return haltConflict("earlyPregnancy.clinicallyStable")
        # The rule IDs are scoped by Module 2; U3 here is not Module 1's PID gate.
        warnings = []
        compatible = [name for name in ("suddenSevereAbdominalOrPelvicPain", "shoulderPain", "weakness", "dizziness", "fainting") if findings[name] is True]
        if case.pregnancyPossible is True and compatible:
            labels = {"suddenSevereAbdominalOrPelvicPain": "sudden severe abdominal or pelvic pain", "shoulderPain": "shoulder pain", "weakness": "weakness", "dizziness": "dizziness", "fainting": "fainting"}
            related = [name for name in ("heavyBleeding", "hemodynamicInstability", "significantConcernAboutPainOrBleeding") if findings[name] is True]
            labels.update(heavyBleeding="heavy bleeding", hemodynamicInstability="clinician-reported hemodynamic instability", significantConcernAboutPainOrBleeding="significant clinician concern about pain or bleeding")
            text = "Immediate emergency assessment is recommended. Possible or known pregnancy with " + ", ".join(labels[name] for name in [*compatible, *related]) + " requires urgent evaluation. This does not confirm ectopic pregnancy or rupture."
            warnings.append(UrgentWarning(ruleId="U1", text=text, sourceTags=["ACOG-ECTOPIC-FAQ155"]))
        urgent = [name for name in ("heavyBleeding", "hemodynamicInstability", "significantConcernAboutPainOrBleeding") if findings[name] is True]
        if urgent and not warnings:
            labels = {"heavyBleeding": "heavy bleeding", "hemodynamicInstability": "clinician-reported hemodynamic instability", "significantConcernAboutPainOrBleeding": "significant clinician concern about pain or bleeding"}
            warnings.append(UrgentWarning(ruleId="U2", text="Immediate independent emergency assessment is recommended for " + ", ".join(labels[name] for name in urgent) + ". This follows the UK early-pregnancy pathway; the cause is not established.", sourceTags=["NICE-NG126-2026"]))
        pain = [name for name in ("suddenAcutePelvicPain", "severeAcutePelvicPain", "worseningPelvicPain") if findings[name] is True]
        if not warnings and case.pregnancyPossible is True and pain:
            labels = {"suddenAcutePelvicPain": "sudden pelvic pain", "severeAcutePelvicPain": "severe pelvic pain", "worseningPelvicPain": "worsening pelvic or abdominal pain"}
            # NICE 1.4.9 is assessment/referral guidance; urgency remains contextual.
            warnings.append(UrgentWarning(ruleId="U3", text="Prompt independent early-pregnancy assessment is recommended for " + ", ".join(labels[name] for name in pain) + ". In the UK pathway, referral urgency depends on the clinical situation. This does not establish a cause.", sourceTags=["NICE-NG126-2026"]))
        return SafetyResult(moduleId=Module2Id, rulesEvaluated=["U1", "U2", "U3"], warningsTriggered=warnings, criterionStates=findings)
