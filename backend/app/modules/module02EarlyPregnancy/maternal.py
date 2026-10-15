"""Hash-bound CDC candidate appraisal; never clinical approval or runtime evidence."""

import hashlib
import json
from pathlib import Path

from backend.app.models.module import ClinicalModuleConfig
from backend.app.modules.candidates import CandidateError
from backend.app.modules.catalog import CatalogStore, checkPairs, resolveFile
from backend.app.modules.module02EarlyPregnancy.safety import Module2Id, PregnancySafety, reportedStates
from backend.app.utils.assertions import InstructionContext


class MaternalCandidates:
    """Match only explicit source-qualified facts for offline candidate review."""

    def __init__(self, moduleRoot: Path):
        try:
            config = ClinicalModuleConfig.model_validate(json.loads((moduleRoot / "config.json").read_bytes(), object_pairs_hook=checkPairs))
            CatalogStore(moduleRoot, config.sourceCatalog, config.knowledgeChecksums)
            policyPath = "candidatePolicies/maternal.json"
            if config.moduleId != Module2Id or policyPath not in config.knowledgeChecksums:
                raise ValueError()
            policyBytes = resolveFile(moduleRoot.resolve(), policyPath).read_bytes()
            if len(policyBytes) > 65536 or hashlib.sha256(policyBytes).hexdigest() != config.knowledgeChecksums[policyPath]:
                raise ValueError()
            policy = json.loads(policyBytes, object_pairs_hook=checkPairs)
            if (policy["moduleId"] != Module2Id or policy["status"] != "candidate"
                    or policy["clinicalReviewStatus"] != "pendingReview"
                    or policy["runtimeEligible"] is not False or policy["productionApproved"] is not False
                    or {claim["claimId"] for claim in policy["claims"]} != {"CDCFaintingCare", "CDCPersistentDizzinessCare", "CDCEmergencyAccess"}):
                raise ValueError()
            expectedGates = {
                "CDCFaintingCare": {"pregnancy": "explicitCurrentPregnancy", "symptom": "currentFainting"},
                "CDCPersistentDizzinessCare": {"pregnancy": "explicitCurrentPregnancy", "symptom": "currentDizzinessOrLightheadedness", "duration": ["ongoing", "recurrentOverManyDays"]},
                "CDCEmergencyAccess": {"requiresQualifyingSymptomClaim": True, "providerReachable": False}}
            sources = {source["sourceId"]: source for source in policy["sources"]}
            if (policy["schemaVersion"] != 1 or policy["gates"] != expectedGates or len(policy["claims"]) != 3
                    or len(policy["sources"]) != 2 or set(sources) != {"CDC-MATERNAL-WARNINGS-2024", "CDC-MATERNAL-WARNINGS-POSTER"}):
                raise ValueError()
            for record in [*policy["sources"], *policy["claims"]]:
                if record["status"] != "candidate" or record["clinicalReviewStatus"] != "pendingReview" or record["productionApproved"] is not False or record["runtimeEligible"] is not False:
                    raise ValueError()
            for source in sources.values():
                if config.knowledgeChecksums["knowledge/sources/" + source["fileName"]] != source["sha256"]:
                    raise ValueError()
            for claim in policy["claims"]:
                if claim["sourceFileHash"] != sources[claim["sourceId"]]["sha256"]:
                    raise ValueError()
            self.claimIds = frozenset(claim["claimId"] for claim in policy["claims"])
        except Exception:
            raise CandidateError("Candidate review is unavailable.") from None

    def assessCase(self, case):
        """No numerical duration cutoff or pregnancy inference from symptoms/tests."""
        if case.moduleHint != Module2Id:
            return ()
        if PregnancySafety(None, None).checkConflict(case) is not None:
            raise CandidateError("Candidate review is unavailable.")
        if InstructionContext.search(case.additionalNotes or ""):
            return ()
        pregnancy = reportedStates(case.additionalNotes, r"patient is pregnant|pregnancy is confirmed|current pregnancy is confirmed")
        if case.pregnancyPossible is not True or pregnancy != {True}:
            return ()
        symptoms = {}
        for name, pattern in {"dizziness": r"dizziness|lightheadedness", "fainting": r"fainting|syncope|passes out|passed out"}.items():
            states = reportedStates(case.additionalNotes, pattern)
            structured = getattr(case.urgentFindings, name, None) if case.urgentFindings else None
            if len(states) > 1 or (states and structured is not None and structured not in states):
                raise CandidateError("Candidate review is unavailable.")
            symptoms[name] = structured if structured is not None else next(iter(states)) if states else None
        # Duration must modify dizziness itself; unrelated chronic symptoms do not qualify.
        ongoing = reportedStates(case.additionalNotes, r"ongoing (?:dizziness|lightheadedness)|(?:dizziness|lightheadedness) (?:is |remains )?ongoing")
        recurrent = reportedStates(case.additionalNotes, r"(?:dizziness|lightheadedness) (?:comes and goes|recurs) over many days")
        transient = reportedStates(case.additionalNotes, r"(?:brief|transient) (?:dizziness|lightheadedness)")
        if (len(ongoing) > 1 or len(recurrent) > 1
                or (True in transient and (True in ongoing or True in recurrent))):
            raise CandidateError("Candidate review is unavailable.")
        matches = []
        if symptoms["fainting"] is True:
            matches.append("CDCFaintingCare")
        if symptoms["dizziness"] is True and (ongoing == {True} or recurrent == {True}):
            matches.append("CDCPersistentDizzinessCare")
        # This selects only a candidate access claim, not an emergency disposition.
        unreachable = reportedStates(case.additionalNotes, r"healthcare provider cannot be reached|unable to reach a healthcare provider")
        if matches and unreachable == {True}:
            matches.append("CDCEmergencyAccess")
        return tuple(claimId for claimId in matches if claimId in self.claimIds)
