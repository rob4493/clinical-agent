"""Bounded Module 2 graph over a separately pinned NICE/ACEP evidence package."""

import json
import re
from pathlib import Path
from types import SimpleNamespace

from backend.app.models.analysis import ModelRequest
from backend.app.models.input import ClinicalCaseInput
from backend.app.models.output import AgentResponse, ClinicalConsideration, ClarificationRequired, CompetitionNotice, EvidenceCitation, EvidenceInsufficientResponse, OutsideScope, ProviderUnavailable, ReportedFacts
from backend.app.models.pregnancy import PregnancyContext
from backend.app.models.safety import SafetyResult
from backend.app.modules.module02EarlyPregnancy.safety import Module2Id, PregnancySafety
from backend.app.modules.module02EarlyPregnancy.safety import haltConflict, reportedStates
from backend.app.modules.module02EarlyPregnancy.maternal import MaternalCandidates
from backend.app.modules.candidates import CandidateError
from backend.app.models.safety import UrgentWarning
from backend.app.services.analysis import AnalysisService
from backend.app.services.cancellation import checkCancelled
from backend.app.services.watsonx import LanguageOutputError
from backend.competition.generation import CompetitionDraft, Instructions
from backend.competition.integrity import Module2PackageHash
from backend.competition.grounding import GroundingPolicy
from backend.competition.package import loadPackage

from backend.competition.storage import evidenceRoot

EvidenceRoot = evidenceRoot("module02Evidence")


class CoverageUnavailable(ValueError):
    """A detected pattern has no directly supported action under its reported conditions."""


class ContextConflict(ValueError):
    """Explicit current duration or pregnancy assertions require clarification."""


def readPackage():
    return loadPackage(EvidenceRoot, Module2PackageHash, "competition", Module2Id)


class PregnancyRetrieval:
    """Apply exact test/population qualifiers before selecting any bounded atom."""

    def __init__(self, registry):
        self.loader = SimpleNamespace(registry=registry)

    def retrieve(self, case, package):
        context = case.earlyPregnancy or PregnancyContext()
        narrative = (case.additionalNotes or "").casefold()
        # A missing gestation/route/result is never filled from source assumptions.
        if context.gestationalWeeks is None or context.gestationalWeeks > 13 or case.pregnancyPossible is not True:
            return ()
        if context.pregnancyTestResult == "negative" or re.search(r"rh\b|anti.d|urine|medication|dose|threshold|cut.?off|\bcrl\b|\bmsd\b", narrative):
            return ()
        byId = {claim.claimId: claim for claim in package.claims}
        locationUnknown = (context.pregnancyTestResult == "positive" and context.ultrasoundRoute == "transvaginal"
            and context.ultrasoundFinding == "noPregnancyVisualized" and context.previousIntrauterinePregnancyConfirmed is False)
        acep = (context.pregnancyTestResult == "positive" and context.careSetting == "emergencyDepartment" and context.clinicallyStable is True
            and context.previousIntrauterinePregnancyConfirmed is False and context.assistedReproduction is False
            and context.abdominalTrauma is False and context.ultrasoundRoute == "transvaginal"
            and context.ultrasoundFinding == "indeterminate")
        if re.search(r"\bhcg\b|serum|pregnancy location|where.*pregnancy", narrative):
            selected = ["M2NSerialLimits" if re.search(r"serial|trend|repeat", narrative) else "M2NHcgLocation"] if locationUnknown else ["M2AIndeterminateHcg", "M2ASerialScope"] if acep and "serial" in narrative else ["M2AIndeterminateHcg"] if acep else []
            if locationUnknown and re.search(r"new|chang|worsen|reassur|trend", narrative):
                selected.append("M2NSymptomsOverHcg")
            if locationUnknown and re.search(r"ultrasound|scan", narrative):
                selected.append("M2NEmptyUterus")
        elif re.search(r"unknown location|\bpul\b", narrative) and locationUnknown:
            selected = ["M2NPulDefinition", "M2NPulPossibility"]
        elif re.search(r"ultrasound|scan", narrative) and context.ultrasoundRoute == "transvaginal":
            selected = ["M2NEmptyUterus"] if context.ultrasoundFinding == "noPregnancyVisualized" else ["M2NSingleScan"] if context.ultrasoundFinding == "indeterminate" and re.search(r"loss|miscarriage|viab", narrative) else []
        elif True in reportedStates(case.additionalNotes, r"(?:pelvic|abdominal) pain|spotting|(?:heavy |vaginal )?bleeding"):
            pain = True in reportedStates(case.additionalNotes, r"(?:pelvic|abdominal) pain")
            selected = ["M2NSymptoms", "M2NPainAssessment"] if pain else ["M2NSymptoms"]
            if locationUnknown:
                selected.extend(["M2NEmptyUterus", "M2NHcgLocation"] if case.caseType.value == "detailed" else ["M2NPulPossibility"])
        else:
            selected = []
        checkCancelled()
        return tuple(byId[claimId] for claimId in selected)


class PregnancyAnalysis(AnalysisService):
    """No automatic provider fallback; output is restricted to retrieved trusted atoms."""

    def __init__(self, registry, settings, language):
        self.registry = registry
        self.safety = PregnancySafety(registry, settings)
        self.retrieval = PregnancyRetrieval(registry)
        self.language = language
        self.maternal = MaternalCandidates(settings.moduleRoot / "module02EarlyPregnancy")

    def isReady(self):
        try:
            from backend.competition.integrity import Module2CompetitionEnabled
            if not Module2CompetitionEnabled:
                return False
            package = readPackage()
            # A technical test pass cannot confer missing urgent-source coverage.
            if not any(claim.claimId == "M2EctopicEmergency" for claim in package.claims):
                return False
            return callable(getattr(self.language, "generate", None))
        except Exception:
            return False

    def warningClaims(self, case, safety, package):
        """Require direct action evidence, not merely a symptom list or a nearby citation."""
        context = case.earlyPregnancy or PregnancyContext()
        findings = safety.criterionStates
        selected = []
        warnings = []
        for warning in safety.warningsTriggered:
            if warning.ruleId.value == "U1":
                if any(findings.get(name) is True for name in ("suddenSevereAbdominalOrPelvicPain", "shoulderPain", "weakness")):
                    claimId = "M2EctopicEmergency"
                else:
                    # Candidate condition matching does not approve authentic sources.
                    # The separately verified competition package grants only this scope.
                    try:
                        matched = self.maternal.assessCase(case)
                    except CandidateError:
                        raise ContextConflict() from None
                    if not matched:
                        raise CoverageUnavailable()
                    selected.extend(next(claim for claim in package.claims if claim.claimId == claimId) for claimId in matched)
                    symptoms = []
                    if "CDCPersistentDizzinessCare" in matched:
                        ongoing = True in reportedStates(case.additionalNotes, r"ongoing (?:dizziness|lightheadedness)|(?:dizziness|lightheadedness) (?:is |remains )?ongoing")
                        symptoms.append("ongoing dizziness or lightheadedness" if ongoing else "dizziness or lightheadedness recurring over many days")
                    if "CDCFaintingCare" in matched:
                        symptoms.append("current fainting")
                    text = "Seek medical care immediately. Reported current pregnancy with " + " and ".join(symptoms) + " warrants urgent assessment."
                    if "CDCEmergencyAccess" in matched:
                        text += " If a healthcare provider cannot be reached, go to the emergency department."
                    text += " These findings do not establish a cause."
                    warnings.append(UrgentWarning(ruleId="U1", text=text, sourceTags=list(dict.fromkeys(claim.sourceId for claim in selected))))
                    continue
            else:
                if case.pregnancyPossible is not True or context.gestationalWeeks is None or context.gestationalWeeks > 13:
                    raise CoverageUnavailable()
                if warning.ruleId.value == "U2":
                    if not any(findings.get(name) is True for name in ("hemodynamicInstability", "significantConcernAboutPainOrBleeding")):
                        raise CoverageUnavailable()
                    claimId = "M2NUrgentReferral"
                elif warning.ruleId.value == "U3":
                    claimId = "M2NPainAssessment"
                else:
                    raise ValueError()
            claim = next(claim for claim in package.claims if claim.claimId == claimId)
            if claim.moduleId != Module2Id or list(warning.sourceTags) != [claim.sourceId]:
                raise ValueError()
            selected.append(claim)
            warnings.append(warning)
        return warnings, selected

    def present(self, outcome, warnings=(), claims=(), package=None, question=None):
        # Reuse the existing safe envelope/rendering contract, including its recheck.
        from backend.competition.analysis import CompetitionAnalysis
        return CompetitionAnalysis.presentCompetition(self, outcome, list(warnings), list(claims), package, question)

    def analyzeCase(self, caseInput):
        checkCancelled()
        case = ClinicalCaseInput.model_validate(caseInput.model_dump(), context=self.safety.settings)
        context = case.earlyPregnancy or PregnancyContext()
        safety = self.safety.evaluateCase(case)
        if not isinstance(safety, SafetyResult):
            return self.present(safety)
        warnings = safety.warningsTriggered
        try:
            package = readPackage()
            if context.gestationalWeeks is not None and context.gestationalWeeks > 13:
                return self.present(OutsideScope(moduleId=Module2Id), package=package)
            if any(warning.ruleId.value == "U1" for warning in warnings) and not any(claim.claimId == "M2EctopicEmergency" for claim in package.claims):
                return self.present(ProviderUnavailable(moduleId=Module2Id, message="Analysis is unavailable for this request."), package=package).model_copy(update={"serviceUnavailable": True})
            if warnings:
                # Urgent output has no model call or ordinary considerations.
                try:
                    warnings, claims = self.warningClaims(case, safety, package)
                    safety = safety.model_copy(update={"warningsTriggered": warnings})
                except ContextConflict:
                    return self.present(haltConflict("additionalNotes"), package=package)
                except CoverageUnavailable:
                    return self.present(EvidenceInsufficientResponse(moduleId=Module2Id,
                        message="Evidence coverage is insufficient to provide a validated urgent action for this reported pattern. No routine clinical analysis was generated."), package=package).model_copy(update={"serviceUnavailable": True})
                except Exception:
                    checkCancelled()
                    return self.present(ProviderUnavailable(moduleId=Module2Id, message="Analysis is unavailable for this request.")).model_copy(update={"serviceUnavailable": True})
                outcome = AgentResponse(moduleId=Module2Id, caseType=case.caseType, urgentWarnings=warnings,
                    urgentWarningResult=safety, supportedInterpretations=[], evidenceSufficient=True,
                    reportedFacts=ReportedFacts(ageRange=case.ageRange or "Unknown",
                        pregnancyPossible="Unknown" if case.pregnancyPossible is None else "Yes" if case.pregnancyPossible else "No"),
                    decisionSupportNotice=CompetitionNotice)
                return self.present(outcome, warnings, claims, package)
            from backend.competition.analysis import InjectionPattern, OutsidePattern
            narrative = case.additionalNotes or ""
            if InjectionPattern.search(narrative):
                return self.present(EvidenceInsufficientResponse(moduleId=Module2Id), package=package)
            if OutsidePattern.search(narrative) or case.pregnancyPossible is False:
                return self.present(OutsideScope(moduleId=Module2Id), package=package)
            if case.pregnancyPossible is None:
                return self.present(ClarificationRequired(fieldName="pregnancyPossible", clarificationRequest="Please confirm whether pregnancy is possible or known."), package=package)
            if context.gestationalWeeks is None:
                return self.present(ClarificationRequired(fieldName="earlyPregnancy.gestationalWeeks", clarificationRequest="Please provide the reported gestational context; missing information remains unknown."), package=package)
            claims = self.retrieval.retrieve(case, package)
            if not claims:
                return self.present(EvidenceInsufficientResponse(moduleId=Module2Id,
                    message="The verified Module 2 package does not support this question with the reported test and population context."), package=package)
            if not callable(getattr(self.language, "generate", None)):
                return self.present(ProviderUnavailable(moduleId=Module2Id), package=package).model_copy(update={"serviceUnavailable": True})
            numbers = {sourceId: index + 1 for index, sourceId in enumerate(dict.fromkeys(claim.sourceId for claim in claims))}
            grounding = GroundingPolicy(case, claims, {claim.claimId: claim.supportedStatement for claim in claims})
            request = ModelRequest(instructions=Instructions, content=json.dumps({
                "CaseData": case.model_dump(mode="json"),
                "EvidenceData": [dict(claimId=claim.claimId, sourceId=claim.sourceId, supportedStatement=claim.supportedStatement,
                    conditions=claim.conditions, limitations=claim.limitations, jurisdiction=claim.jurisdiction,
                    intendedPopulation=claim.intendedPopulation, sourceLocation=claim.sourceLocation) for claim in claims],
                "AllowedStatements": grounding.statements(numbers),
                "EligibleQuestions": [],
            }))
            try:
                checkCancelled()
                result = self.language.generate(request)
                checkCancelled()
            except LanguageOutputError:
                return self.present(EvidenceInsufficientResponse(moduleId=Module2Id), package=package)
            except Exception:
                checkCancelled()
                return self.present(ProviderUnavailable(moduleId=Module2Id), package=package).model_copy(update={"serviceUnavailable": True})
            draft = CompetitionDraft.model_validate_json(json.dumps(result, allow_nan=False))
            if draft.responseType == "EvidenceInsufficient":
                if draft.considerations or draft.question is not None:
                    raise ValueError()
                return self.present(EvidenceInsufficientResponse(moduleId=Module2Id), package=package)
            if not draft.considerations or len(draft.considerations) > (2 if case.caseType.value == "brief" else 3) or draft.question is not None:
                raise ValueError()
            byId = {claim.claimId: claim for claim in claims}
            used = set()
            considerations = []
            for statement in draft.considerations:
                if len(statement.claimIds) != len(set(statement.claimIds)) or used.intersection(statement.claimIds):
                    raise ValueError()
                selected = [byId[claimId] for claimId in statement.claimIds]
                grounding.validate(statement.text, statement.claimIds)
                if statement.citationNumbers != list(dict.fromkeys(numbers[claim.sourceId] for claim in selected)):
                    raise ValueError()
                used.update(statement.claimIds)
                considerations.append(ClinicalConsideration(text=statement.text, isInterpretation=False,
                    citations=[EvidenceCitation(sourceTag=sourceId) for sourceId in dict.fromkeys(claim.sourceId for claim in selected)]))
            # Answer coverage is exact: generation may not omit the requested limitation.
            if used != set(byId) or sum(len(statement.text.split()) for statement in draft.considerations) > (150 if case.caseType.value == "brief" else 300):
                raise ValueError()
            question = None
            if set(byId) == {"M2NSymptoms", "M2NPainAssessment"}:
                # Ask once only when neither structured context nor notes address
                # urgent features; unknown information never becomes a negative.
                urgentContext = (context.clinicallyStable, context.hemodynamicInstability,
                    context.heavyBleeding, context.significantConcernAboutPainOrBleeding, context.worseningPelvicPain)
                if all(finding is None for finding in urgentContext) and not re.search(
                    r"instab|stable|severe|worsen|heavy|shoulder|weakness|dizz|faint", narrative, re.IGNORECASE):
                    question = "Are there signs of instability, severe or worsening pain, heavy bleeding, shoulder pain, weakness, dizziness, or fainting?"
            outcome = AgentResponse(moduleId=Module2Id, caseType=case.caseType, urgentWarnings=[],
                urgentWarningResult=safety, supportedInterpretations=considerations, evidenceSufficient=True,
                reportedFacts=ReportedFacts(ageRange=case.ageRange or "Unknown", pregnancyPossible="Yes"), decisionSupportNotice=CompetitionNotice)
            return self.present(outcome, claims=claims, package=package, question=question)
        except Exception:
            checkCancelled()
            if warnings:
                # Provenance failure must never return an uncited partial warning.
                return self.present(ProviderUnavailable(moduleId=Module2Id, message="Analysis is unavailable for this request.")).model_copy(update={"serviceUnavailable": True})
            return self.present(EvidenceInsufficientResponse(moduleId=Module2Id), warnings=warnings)
