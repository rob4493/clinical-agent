"""Local case-aware ranking over separately eligible, freshly hash-bound claims."""

import re
from pathlib import Path

from backend.app.models.input import ClinicalCaseInput
from backend.app.services.cancellation import checkCancelled
from backend.app.utils.assertions import currentClauses, phraseState
from backend.competition.integrity import PackageHash
from backend.competition.package import CompetitionClaim, PackageError, loadPackage

from backend.competition.storage import evidenceRoot

EvidenceRoot = evidenceRoot("evidence")
TopicPatterns = {
    "ultrasound": r"\bultrasound\b|\bsonogra\w*|\btvus\b|transvaginal",
    "mri": r"\bmri\b|magnetic resonance",
    "ca125": r"\bca[ -]?125\b",
    "examination": r"\bexam\w*|pelvic examination",
    "cycle": r"\bmenstr\w*|\bperiod\w*|\bcyclic\w*",
    "bowel": r"\bbowel\b|\bgastrointestinal\b|\bdigestive\b|\bibs\b",
    "urinary": r"\burin\w*|\bbladder\b",
    "intercourse": r"\bintercourse\b|\bsex\b|\bdyspareunia\b",
    "impact": r"\bwork\b|\bschool\b|\bsleep\b|daily activities|quality of life",
    "family": r"family history|first.degree|\bmother\b|\bsister\b",
    "recurrence": r"\brecurr\w*|\bpersist\w*|returned|returning|prior surgery|previous surgery",
    "fertility": r"\bfertil\w*|\binfertil\w*|trying to conceive|pregnancy goal",
    "overlap": r"\boverlap\w*|other causes|other contributors|multiple causes|muscle|musculoskeletal|back pain",
    "diary": r"\bdiary\b|\bjournal\b|symptom timing",
    "acute": r"\bsudden\b|\bacute\b|\bfaint\w*|shoulder pain|dizziness",
    "pid": r"\bpid\b|pelvic inflammatory|outpatient|hospitali\w*|disposition",
    "pregnancyTest": r"pregnancy test|\bhcg\b",
    "pelvic": r"pelvic|endometriosis",
    "deep": r"deep endometriosis|endometrioma|\bureter\b",
    "adolescent": r"adolescent|under.?18|aged 17|seventeen",
    "pattern": r"intermittent|constant|comes? and goes?|pattern|chronic pelvic|several months",
    "history": r"review|context|history|daily activities|aggravating|relieving",
    "fibroid": r"\bfibroid\w*|\bleiomyoma\w*",
}
TopicClaims = {
    "ultrasound": {"N14", "N15", "N16", "N18", "N20", "NichdUltrasoundLimits"},
    "mri": {"N19", "N20", "N21", "NichdMriLimits"},
    "ca125": {"N22"}, "examination": {"N12", "N13", "N17"},
    "cycle": {"N02", "C04", "C05", "WhoSymptoms"}, "bowel": {"N04", "C10"},
    "urinary": {"N05", "C09"}, "intercourse": {"N03", "C05"},
    "impact": {"N02", "N25", "WhoImpact"}, "family": {"N07"},
    "recurrence": {"N01", "N25", "WhoRecurrence"}, "fertility": {"N06", "WhoPriorities"},
    "overlap": {"C01", "C09", "C10", "C11"}, "diary": {"N08"},
    "acute": {"C08", "C14", "E01", "E02"},
    "pid": {"CdcSurgicalEmergency", "CdcAbscess", "CdcPregnancy", "CdcSevereIllness", "CdcTemperature", "CdcTolerance", "CdcResponse"},
    "pregnancyTest": {"E03"}, "pelvic": {"N01", "C01", "WhoVariation"},
    "deep": {"N19", "N21", "N26"}, "adolescent": {"N27"},
    "pattern": {"CppDefinition", "CppPattern"}, "history": {"CppHistory"},
    "fibroid": {"C07"},
}
SymptomConditions = {"N02": r"menstrual pain|period pain|period-related pain", "C04": r"menstrual pain|period pain|period-related pain",
    "N03": r"pain during intercourse|pain with intercourse|intercourse pain", "N04": r"bowel pain|painful bowel movements", "N05": r"urinary symptoms|urinary pain|painful urination"}


def isNonspecific(case):
    """Use the entire submitted clinical context, without inferring missing facts."""
    context = " ".join(str(field) for name, field in case.model_dump().items() if field is not None and
        name not in {"moduleHint", "caseType", "ageRange", "pregnancyPossible", "pidDiagnosedOrPresumed", "urgentFindings"}).casefold()
    topics = {topic for topic, pattern in TopicPatterns.items() if re.search(pattern, context)}
    return ("pelvic" in topics and topics.issubset({"pelvic", "pattern", "history", "recurrence", "impact"})
        and case.pidDiagnosedOrPresumed is not True
        and not any(field is True for field in (case.urgentFindings.model_dump().values() if case.urgentFindings else []))
        and not re.search(r"referr|treatment|procedure|laparosc|examin|test|diagnos|definition|define|how long|six months|6 months|diary|journal|comprehensive|complete review|full review|differential", context))


class CompetitionRetrieval:
    """Bounded lexical/concept ranking, not production embeddings or diagnosis inference.

    Topic normalization identifies the question's meaning and named tests. It does
    not infer missing clinical facts or change structured pregnancy/PID status.
    """

    def __init__(self, root: Path = EvidenceRoot, expectedHash: str = PackageHash, registry=None):
        self.root = root
        self.expectedHash = expectedHash
        self.registry = registry
        self.loader = self

    def retrieve(self, case: ClinicalCaseInput, limit: int = 8) -> tuple[CompetitionClaim, ...]:
        checkCancelled()
        if type(limit) is not int or not 1 <= limit <= 8:
            raise PackageError("Competition evidence is unavailable.")
        if case.moduleHint not in {"module_01_endo", "EndometriosisChronicPelvicPain"}:
            raise PackageError("Competition evidence is unavailable.")
        package = loadPackage(self.root, self.expectedHash, "competition")
        # A broad pelvic-pain term is insufficient justification for a complete
        # evaluation pathway. Preserve only bounded uncertainty/overlap evidence.
        if isNonspecific(case):
            byId = {claim.claimId: claim for claim in package.claims}
            selectedIds = ["N01", "C01", "C11"]
            # A prior surgery is historical, but does not itself make a current
            # statement of returned pain historical. Other past/negation markers
            # remain intact for the assertion parser.
            recurrenceText = re.sub(r"\b(?:previous|prior)\s+surgery\b", "surgery", case.additionalNotes or "", flags=re.IGNORECASE)
            if phraseState(recurrenceText, r"recurr\w*|returned|returning") is True and re.search(r"surgery|treatment", recurrenceText, re.IGNORECASE):
                selectedIds.append("WhoRecurrence")
            return tuple(byId[claimId] for claimId in selectedIds)[:limit]
        # All submitted fields contribute to relevance, without retaining the case
        # on the service or treating input as executable/provider instructions.
        context = " ".join(str(field) for fieldName, field in case.model_dump().items()
            if field is not None and fieldName not in {"moduleHint", "caseType", "ageRange", "pregnancyPossible", "pidDiagnosedOrPresumed", "urgentFindings"}).casefold()
        findingPhrases = {"suddenSevereAbdominalOrPelvicPain":"sudden severe pelvic pain", "suddenAcutePelvicPain":"sudden acute pelvic pain", "severeAcutePelvicPain":"severe acute pelvic pain",
            "shoulderPain":"shoulder pain", "weakness":"weakness", "dizziness":"dizziness", "fainting":"fainting"}
        positiveFindings = [phrase for fieldName, phrase in findingPhrases.items() if case.urgentFindings is not None and getattr(case.urgentFindings, fieldName) is True]
        context += " " + " ".join(positiveFindings)
        if not context.strip() and case.pidDiagnosedOrPresumed is not True:
            return ()
        question = (case.additionalNotes or "").casefold().split("?")[0] if "?" in (case.additionalNotes or "") else ""
        topics = {topic for topic, pattern in TopicPatterns.items() if re.search(pattern, context)}
        if case.ageRange in {"Under 18", "Under18"}:
            topics.add("adolescent")
        if case.pidDiagnosedOrPresumed is True:
            topics.add("pid")
        if "acute" in topics and not positiveFindings and not re.search(TopicPatterns["acute"], " ".join(currentClauses(case.additionalNotes))):
            topics.remove("acute")
        if topics.issubset({"recurrence", "impact", "diary"}):
            return ()
        if re.search(r"\b(?:headache|migraine|chest pain|cough|seizure)\b", context) and "pelvic" not in topics and not topics.intersection({"ultrasound", "mri", "ca125"}):
            return ()
        questionTopics = {topic for topic, pattern in TopicPatterns.items() if question and re.search(pattern, question)}
        namedTests = topics.intersection({"ultrasound", "mri", "ca125"})
        queryTokens = set(re.findall(r"[a-z]{3,}", context))
        ranked = []
        for claim in package.claims:
            checkCancelled()
            # Sharing a test name does not make a different test, procedure or
            # referral pathway relevant to the clinician's requested task.
            if claim.claimId in {"N19", "N20", "N21"} and not re.search(r"\bmri\b|deep endometriosis.*(?:assess|extent)|laparosc|procedure", context):
                continue
            if claim.claimId == "N21" and not re.search(r"laparosc|operative|procedure", context):
                continue
            if claim.claimId == "N20" and not re.search(r"\bnormal (?:pelvic )?mri|\bnormal (?:transvaginal )?ultrasound|laparosc", context):
                continue
            if claim.claimId in {"N25", "N26", "N27"} and not re.search(r"referr|specialist|ineffective|intolerable|contraindicated", context):
                continue
            if claim.claimId == "N14" and not re.search(r"\bnormal (?:abdominal |pelvic )?(?:exam|examination)", context):
                continue
            if claim.claimId == "N18" and not re.search(r"\bnormal (?:transvaginal )?ultrasound|ultrasound.*(?:exclude|rule out)", context):
                continue
            if claim.claimId in {"N02", "C04"} and "cycle" not in topics:
                continue
            if claim.claimId == "N17" and not re.search(r"\bnormal (?:pelvic |abdominal |internal pelvic )?(?:exam|examination)", context):
                continue
            if claim.claimId == "N07" and phraseState(case.additionalNotes, r"family history|first.degree family history") is False:
                continue
            if claim.claimId in SymptomConditions and phraseState(case.additionalNotes, SymptomConditions[claim.claimId]) is False:
                continue
            if claim.claimId in {"C08", "C14"} and not any("pain" in phrase for phrase in positiveFindings) and phraseState(case.additionalNotes, r"(?:sudden |severe )?acute pelvic pain|sudden severe pelvic pain") is not True:
                continue
            if claim.claimId.startswith("Cdc") and case.pidDiagnosedOrPresumed is not True:
                continue
            if claim.claimId in {"E01", "E02"} and case.pregnancyPossible is not True:
                continue
            if claim.claimId == "N06" and ("fertility" not in topics or not topics.intersection({"pelvic", "cycle", "bowel", "urinary", "intercourse"})):
                continue
            if claim.claimId == "N16" and not re.search(r"declined|unsuitable|not suitable", context):
                continue
            if claim.claimId in {"N20", "N21", "N19"} and not topics.intersection({"ultrasound", "mri"}):
                continue
            if namedTests:
                otherTests = {topic for topic in {"ultrasound", "mri", "ca125"} - namedTests if claim.claimId in TopicClaims[topic]}
                ownTests = {topic for topic in namedTests if claim.claimId in TopicClaims[topic]}
                # Shared evaluation claims may name both tests; claims solely for a
                # different test never enter the evidence supplied to generation.
                if otherTests and not ownTests:
                    continue
            matchedTopics = {topic for topic in topics if claim.claimId in TopicClaims[topic]}
            if not matchedTopics:
                continue
            score = sum(20 if topic in {"ultrasound", "mri", "ca125"} else 5 for topic in matchedTopics)
            score += 10 * len(matchedTopics.intersection(questionTopics))
            score += min(4, len(queryTokens.intersection(re.findall(r"[a-z]{3,}", claim.retrievalText.casefold()))))
            if question and ((claim.claimId == "N18" and "ultrasound" in question and "normal" in question)
                or (claim.claimId == "N20" and "mri" in question and "normal" in question)
                or (claim.claimId == "N22" and "ca125" in namedTests)):
                score += 100
            ranked.append((-score, claim.claimId, claim))
        checkCancelled()
        return tuple(entry[2] for entry in sorted(ranked, key=lambda entry: entry[:2])[:limit])
