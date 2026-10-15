"""Competition-only orchestration over verified eligibility, never authentic approval."""

import json
import re

from backend.app.models.analysis import AnalysisResult, CitedSource, ModelRequest
from backend.app.models.input import ClinicalCaseInput
from backend.app.models.output import AgentResponse, ClinicalConsideration, CompetitionNotice, EvidenceCitation, EvidenceInsufficientResponse, OutsideScope, ProviderUnavailable, ReportedFacts
from backend.app.models.safety import SafetyResult
from backend.app.services.analysis import AnalysisService
from backend.app.services.cancellation import checkCancelled
from backend.app.services.safety import SafetyInputError, SafetyService
from backend.app.services.watsonx import LanguageOutputError
from backend.competition.generation import CompetitionDraft, DirectAnswers, Instructions, claimWording
from backend.competition.grounding import GroundingPolicy
from backend.competition.package import PackageError, loadPackage
from backend.competition.retrieval import CompetitionRetrieval, isNonspecific
from backend.competition.synthesis import buildFocus, hasUnsupportedFindings

WarningClaims = {"U1": ("E01", "E02"), "U2": ("C14",), "U3": (
    "CdcSurgicalEmergency", "CdcAbscess", "CdcPregnancy", "CdcSevereIllness", "CdcTemperature", "CdcTolerance", "CdcResponse")}
OutsidePattern = re.compile(r"\b(?:diagnose me|give a diagnosis|do i have|probability|what stage|prescribe|dosage|what dose|which medication|which drug|which treatment|postmenopausal)\b", re.IGNORECASE)
InjectionPattern = re.compile(r"ignore (?:all |previous |the )?(?:instructions|rules)|system prompt|reveal (?:your |the )?(?:prompt|credentials)|fabricate (?:a |the )?(?:citation|source)", re.IGNORECASE)


class CompetitionAnalysis(AnalysisService):
    """Same safety gates, distinct evidence policy and strictly injected language provider."""

    def __init__(self, registry, settings, language=None):
        if settings.runtimeMode() != "competition":
            raise ValueError("Invalid competition configuration.")
        self.registry = registry
        self.safety = SafetyService(registry, settings)
        self.retrieval = CompetitionRetrieval(registry.root, registry.expectedHash, registry)
        self.language = language
        from backend.competition.earlyPregnancy import PregnancyAnalysis
        self.early = PregnancyAnalysis(registry, settings, language) if "module_02_early_pregnancy" in registry.moduleConfigs else None

    def isReady(self):
        try:
            loadPackage(self.registry.root, self.registry.expectedHash, "competition")
            return callable(getattr(self.language, "generate", None)) and (self.early is None or self.early.isReady())
        except Exception:
            return False

    def analyzeCase(self, caseInput):
        checkCancelled()
        try:
            case = ClinicalCaseInput.model_validate(caseInput.model_dump() if isinstance(caseInput, ClinicalCaseInput) else caseInput, context=self.safety.settings)
        except Exception:
            raise SafetyInputError("Invalid clinical case input.") from None
        if case.moduleHint == "module_02_early_pregnancy" and self.early is not None:
            return self.early.analyzeCase(case)
        safety = self.safety.evaluateCase(case)
        if not isinstance(safety, SafetyResult):
            return self.presentCompetition(safety, [], [], None)
        warnings = safety.warningsTriggered
        try:
            package = loadPackage(self.registry.root, self.registry.expectedHash, "competition")
            byId = {claim.claimId: claim for claim in package.claims}
            warningClaims = [byId[claimId] for warning in warnings for claimId in WarningClaims[warning.ruleId.value]]
            if any(warning.ruleId.value == "U1" for warning in warnings):
                # Emergency action must not depend on ordinary retrieval or a model.
                # Explain only positively established criteria, never echo case text.
                labels = {"suddenSevereAbdominalOrPelvicPain": "sudden severe abdominal or pelvic pain",
                    "shoulderPain": "shoulder pain", "weakness": "weakness", "dizziness": "dizziness", "fainting": "fainting"}
                findings = [label for name, label in labels.items() if safety.criterionStates.get(name) is True]
                immediate = next(warning for warning in warnings if warning.ruleId.value == "U1")
                findingText = findings[0] if len(findings) == 1 else ", ".join(findings[:-1]) + " and " + findings[-1]
                immediate = immediate.model_copy(update={"text": "Immediate emergency assessment is recommended. Possible or known pregnancy with "
                    + findingText + " requires urgent evaluation. These findings do not confirm ectopic pregnancy."})
                focusedSafety = safety.model_copy(update={"warningsTriggered": [immediate]})
                outcome = AgentResponse(moduleId=package.moduleId, caseType=case.caseType,
                    urgentWarnings=[immediate], urgentWarningResult=focusedSafety,
                    reportedFacts=ReportedFacts(ageRange=case.ageRange or "Unknown", pregnancyPossible="Yes",
                        pidDiagnosedOrPresumed="Unknown" if case.pidDiagnosedOrPresumed is None else "Yes" if case.pidDiagnosedOrPresumed else "No"),
                    supportedInterpretations=[], evidenceSufficient=True, decisionSupportNotice=CompetitionNotice)
                return self.presentCompetition(outcome, [immediate], [byId["E01"]], package)
            if InjectionPattern.search(case.additionalNotes or ""):
                return self.presentCompetition(EvidenceInsufficientResponse(moduleId=package.moduleId, message="The submitted instructions cannot be used as clinical evidence. Please provide only de-identified case information."), warnings, warningClaims, package)
            if OutsidePattern.search(case.additionalNotes or ""):
                return self.presentCompetition(OutsideScope(moduleId=package.moduleId), warnings, warningClaims, package)
            claims = self.retrieval.retrieve(case)
            focus = buildFocus(case, package)
            if hasUnsupportedFindings(case, fibroidCovered=focus is not None):
                return self.presentCompetition(EvidenceInsufficientResponse(moduleId=package.moduleId,
                    message="The verified evidence cannot support a complete, finding-specific review of the reported abnormal findings. They must not be treated as normal."), warnings, warningClaims, package)
            if focus is not None:
                claims, focusedWording = focus
            if not claims:
                if not any(isinstance(field, str) and field.strip() for fieldName, field in case.model_dump().items() if fieldName not in {"moduleHint", "caseType", "ageRange"}):
                    return self.presentCompetition(EvidenceInsufficientResponse(moduleId=package.moduleId, message="No clinical details were provided to support an evidence review."), warnings, warningClaims, package)
                return self.presentCompetition(OutsideScope(moduleId=package.moduleId), warnings, warningClaims, package)
            if re.search(r"negative (?:home|urine|pregnancy) (?:pregnancy )?test|\b(?:home|urine)\s+(?:pregnancy\s+)?test\b|pregnancy test[^.!?]{0,60}\b(?:home|urine)\b|hcg (?:threshold|cut.?off)|\bhcg\s*(?:level\s*)?(?:of\s*)?\d", case.additionalNotes or "", re.IGNORECASE):
                return self.presentCompetition(EvidenceInsufficientResponse(moduleId=package.moduleId, message="The verified sources do not support a negative-home-test exclusion rule or an hCG threshold for this question."), warnings, warningClaims, package)
            if not callable(getattr(self.language, "generate", None)):
                return self.presentCompetition(ProviderUnavailable(moduleId=package.moduleId), warnings, warningClaims, package).model_copy(update={"serviceUnavailable": True})
            narrative = (case.additionalNotes or "").casefold()
            namedTests = {name for name, pattern in {"ultrasound": r"ultrasound|tvus", "mri": r"\bmri\b", "ca125": r"ca[ -]?125"}.items() if re.search(pattern, narrative)}
            if focus is None and namedTests and re.search(r"\babnormal\s+(?:pelvic\s+|transvaginal\s+)?(?:mri|ultrasound|ca[ -]?125)\b|\b(?:mri|ultrasound|ca[ -]?125)\b[^.!?]{0,40}\b(?:is|was|reported as)\s+abnormal\b", narrative):
                return self.presentCompetition(EvidenceInsufficientResponse(moduleId=package.moduleId,
                    message="The reported test abnormality needs a precise finding-specific description for an evidence-bound interpretation."), warnings, warningClaims, package)
            directClaim = None
            # "Abnormal" contains "normal"; only a whole-word normal premise may
            # select normal-result wording, and the abnormality must concern this test.
            # Narrow only an explicit single-test interpretation question; broader
            # requested review, referral or procedure discussion retains its scope.
            if focus is None and "?" in narrative and len(namedTests) == 1 and not re.search(r"referr|laparosc|procedure|other tests|differential|complete|broad|next steps", narrative):
                if "ca125" in namedTests:
                    directClaim = "N22"
                elif re.search(r"\bnormal\b", narrative):
                    directClaim = "N18" if "ultrasound" in namedTests else "N20"
            if directClaim is not None:
                claims = tuple(claim for claim in claims if claim.claimId == directClaim)
            wording = {claim.claimId: DirectAnswers[claim.claimId] if claim.claimId == directClaim else claimWording(claim) for claim in claims}
            if directClaim == "N22" and re.search(r"\bnormal\b", narrative) and re.search(r"exclude|rule out|absen", narrative):
                wording["N22"] = "A normal CA-125 result must not be treated as proof that endometriosis is absent. CA-125 should not be used diagnostically."
            if directClaim == "N20" and re.search(r"exclude|rule out|absen", narrative):
                wording["N20"] = "A normal MRI does not establish that endometriosis is absent."
            if focus is not None:
                wording = focusedWording
            preliminary = isNonspecific(case) and not warnings
            if preliminary:
                wording.update({
                    "N01": "The submitted pelvic discomfort is nonspecific; the available information does not identify a likely contributor. Endometriosis is one consideration, but this symptom alone does not establish it.",
                    "C01": "Urinary and bowel contributors may overlap; sometimes no cause is found.",
                    "C11": "Musculoskeletal contributors may also be relevant.",
                })
            sourceIds = list(dict.fromkeys(claim.sourceId for claim in (*warningClaims, *claims)))
            numbers = {sourceId: index + 1 for index, sourceId in enumerate(sourceIds)}
            # Familiar definitions consume limited response space without answering
            # ordinary case questions. Keep the evidence intact, but offer this atom
            # only when the clinician explicitly asks about meaning or duration.
            needsDefinition = bool(re.search(r"\b(?:define|definition|meaning|how long|six months|6 months)\b", (case.additionalNotes or "").casefold()))
            grounding = GroundingPolicy(case, claims, wording)
            atoms = grounding.statements(numbers, [claim.claimId for claim in claims if claim.claimId != "CppDefinition" or needsDefinition])
            allowedQuestions = ["Is the reported family history specifically of endometriosis?"] if any(claim.claimId == "N07" for claim in claims) and re.search(r"family history|first.degree", case.additionalNotes or "", re.IGNORECASE) and not re.search(r"family history of endometriosis|relative\w* (?:with|had) endometriosis", case.additionalNotes or "", re.IGNORECASE) else []
            if preliminary:
                allowedQuestions = ["Is the discomfort related to menstruation, intercourse, bowel movements, or urination, and how much does it affect daily activities?"]
            request = ModelRequest(instructions=Instructions, content=json.dumps({
                "CaseData": case.model_dump(mode="json"),
                "EvidenceData": [{"claimId": claim.claimId, "sourceId": claim.sourceId,
                    "supportedStatement": claim.supportedStatement, "conditions": claim.conditions,
                    "limitations": claim.limitations, "jurisdiction": claim.jurisdiction,
                    "intendedPopulation": claim.intendedPopulation, "sourceLocation": claim.sourceLocation,
                    "organization": claim.sourceOrganization, "title": claim.documentTitle,
                    "publicationDate": claim.publicationDate, "reviewDate": claim.reviewDate} for claim in claims],
                "AllowedStatements": atoms, "EligibleQuestions": allowedQuestions,
            }, ensure_ascii=False))
            try:
                checkCancelled()
                draft = self.language.generate(request)
                checkCancelled()
            except LanguageOutputError:
                checkCancelled()
                return self.presentCompetition(EvidenceInsufficientResponse(moduleId=package.moduleId, message="The generated output did not match the evidence-bound response contract."), warnings, warningClaims, package)
            except Exception:
                checkCancelled()
                return self.presentCompetition(ProviderUnavailable(moduleId=package.moduleId), warnings, warningClaims, package).model_copy(update={"serviceUnavailable": True})
            draft = CompetitionDraft.model_validate_json(json.dumps(draft, allow_nan=False))
            if draft.responseType == "EvidenceInsufficient":
                if draft.considerations or draft.question is not None:
                    raise ValueError()
                return self.presentCompetition(EvidenceInsufficientResponse(moduleId=package.moduleId), warnings, warningClaims, package)
            if not draft.considerations or len(draft.considerations) > (2 if case.caseType.value == "brief" else 3) or draft.question not in [None, *allowedQuestions]:
                raise ValueError()
            if preliminary and (len(draft.considerations) != 1 or draft.question != allowedQuestions[0]):
                raise ValueError()
            retrieved = {claim.claimId: claim for claim in claims}
            used = set()
            considerations = []
            clinicalClaims = []
            for statement in draft.considerations:
                if len(set(statement.claimIds)) != len(statement.claimIds) or used.intersection(statement.claimIds):
                    raise ValueError()
                selected = [retrieved[claimId] for claimId in statement.claimIds]
                grounding.validate(statement.text, statement.claimIds)
                expected = list(dict.fromkeys(numbers[claim.sourceId] for claim in selected))
                if statement.citationNumbers != expected:
                    raise ValueError()
                used.update(statement.claimIds)
                clinicalClaims.extend(selected)
                considerations.append(ClinicalConsideration(text=statement.text, isInterpretation=False,
                    citations=[EvidenceCitation(sourceTag=sourceId) for sourceId in dict.fromkeys(claim.sourceId for claim in selected)]))
            if draft.question is not None and not preliminary and "N07" not in used:
                raise ValueError()
            narrative = (case.additionalNotes or "").casefold()
            if focus is not None and used != set(wording):
                raise ValueError()
            if focus is not None and draft.considerations[0].claimIds[0] != "C07":
                raise ValueError()
            if focus is None and "?" in narrative:
                required = {"N22"} if re.search(r"ca[ -]?125", narrative) else {"N20", "NichdMriLimits"} if "mri" in narrative and re.search(r"\bnormal\b", narrative) else {"N18"} if "ultrasound" in narrative and re.search(r"\bnormal\b", narrative) else set()
                if required and draft.considerations[0].claimIds[0] not in required:
                    raise ValueError()
            if sum(len(consideration.text.split()) for consideration in considerations) > (150 if case.caseType.value == "brief" else 300):
                raise ValueError()
            outcome = AgentResponse(urgentWarnings=warnings, moduleId=package.moduleId, caseType=case.caseType,
                reportedFacts=ReportedFacts(ageRange=case.ageRange or "Unknown", pregnancyPossible="Unknown" if case.pregnancyPossible is None else "Yes" if case.pregnancyPossible else "No", pidDiagnosedOrPresumed="Unknown" if case.pidDiagnosedOrPresumed is None else "Yes" if case.pidDiagnosedOrPresumed else "No"),
                supportedInterpretations=considerations, urgentWarningResult=safety, evidenceSufficient=True,
                decisionSupportNotice=CompetitionNotice)
            return self.presentCompetition(outcome, warnings, [*warningClaims, *clinicalClaims], package, draft.question)
        except Exception:
            checkCancelled()
            return self.presentCompetition(EvidenceInsufficientResponse(moduleId="module_01_endo", message="The available verified evidence could not support a validated response to this question."), warnings, [], None)

    def presentCompetition(self, outcome, warnings, claims, package, question=None):
        checkCancelled()
        if package is not None:
            # A provider cannot race mutable evidence into a response after generation.
            selectedRoot, selectedHash = self.registry.packageBinding(package.moduleId)
            current = loadPackage(selectedRoot, selectedHash, "competition", package.moduleId)
            if current != package:
                raise PackageError("Competition evidence is unavailable.")
        outcome = outcome.model_copy(update={"decisionSupportNotice": CompetitionNotice})
        sourceIds = list(dict.fromkeys(claim.sourceId for claim in claims))
        sources = [CitedSource(number=index + 1, source=self.registry.getSource(package.moduleId, sourceId)) for index, sourceId in enumerate(sourceIds)]
        numbers = {source.source.sourceId: source.number for source in sources}
        paragraphs = [warning.text + (" [" + ",".join(str(numbers[sourceId]) for sourceId in warning.sourceTags if sourceId in numbers) + "]" if any(sourceId in numbers for sourceId in warning.sourceTags) else "") for warning in warnings]
        if isinstance(outcome, AgentResponse):
            paragraphs.extend(consideration.text + " [" + ",".join(str(numbers[citation.sourceTag]) for citation in consideration.citations) + "]" for consideration in outcome.supportedInterpretations)
        elif hasattr(outcome, "conflictDescription"):
            paragraphs.extend([outcome.conflictDescription, outcome.clarificationRequest])
        elif hasattr(outcome, "clarificationRequest"):
            paragraphs.append(outcome.clarificationRequest)
        else:
            paragraphs.append(outcome.message)
        if question is not None:
            paragraphs.append(question)
        if sources:
            paragraphs.extend(["Sources", "\n".join(f"[{source.number}] {source.source.organization} — {source.source.title}" + (f" — <{source.source.verifiedUrl}>" if source.source.verifiedUrl else "") for source in sources)])
        paragraphs.append(CompetitionNotice)
        return AnalysisResult(warnings=warnings, response=outcome, sources=sources, renderedText="\n\n".join(paragraphs))
