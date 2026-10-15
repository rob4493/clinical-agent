"""Finite demo applicability and safe summaries; no unrestricted clinical inference."""

import re

from backend.demo.cases import BriefNarrative, MildNarrative, DetailedNarrative, CaseParts

TestParts = {
    "ultrasound": (
        "A normal transvaginal ultrasound does not rule out endometriosis and does not establish it. This result concerns that specific test; it cannot be generalized to every imaging method. The reported finding should remain separate from the symptom history and any other examination or test findings.",
        "A negative imaging finding does not automatically end evaluation or establish a need for surgery. The available result alone does not explain the symptoms. Other unreported findings remain unknown, and the review should preserve uncertainty rather than convert a normal result into a conclusion about the cause.",
    ),
    "mri": (
        "A normal MRI does not establish absence of endometriosis. It also does not establish endometriosis or explain the symptoms. This statement applies to the named test only; ultrasound findings must be reviewed separately. Missing examination findings and other test results remain unknown.",
        "Negative imaging does not automatically end evaluation or require surgery. Keep the reported MRI result separate from conclusions about the cause of symptoms. The available information does not resolve that cause, and further interpretation requires evidence that applies to the specific clinical question.",
    ),
    "ca125": (
        "CA-125 cannot establish or rule out endometriosis. A reported CA-125 result must not be used alone to settle that question. The named test does not replace a review of the reported symptoms and relevant findings; unreported findings remain unknown rather than normal.",
        "Keep this test limitation separate from findings about ultrasound or MRI. Evidence about one test must not be extended automatically to another. The result does not determine the cause of symptoms or establish a need for surgery, and the available information cannot support those conclusions.",
    ),
}


def selectParts(case):
    """Only explicit, bounded forms select trusted statements; ambiguity fails closed."""
    narrative = (case.additionalNotes or "").strip().casefold().removeprefix("fictional demonstration:").strip()
    if narrative in CaseParts:
        return CaseParts[narrative], narrative
    # Full-string applicability avoids interpreting negations, quotes, history or instructions.
    if re.fullmatch(r"(?:recurrent|recurring) pelvic (?:pain|discomfort)\.?", narrative):
        return CaseParts[BriefNarrative.casefold()], None
    if re.fullmatch(r"mild intermittent pelvic (?:pain|discomfort) (?:over|for) several months\.?", narrative):
        return CaseParts[MildNarrative.casefold()], None
    questions = {
        "ultrasound": r"does (?:a )?normal transvaginal ultrasound (?:rule out|exclude) endometriosis\?",
        "mri": r"does (?:a )?normal mri (?:rule out|exclude) endometriosis\?",
        "ca125": r"can ca-?125 (?:establish|rule out|exclude) endometriosis\?",
    }
    for testName, pattern in questions.items():
        if re.fullmatch(pattern, narrative):
            return TestParts[testName], None
    return (), None


def explainLimit(case):
    """Mention bounded request topics, never copy free text or infer clinical findings."""
    narrative = (case.additionalNotes or "").casefold()
    topics = [("headache", "headache"), ("chest", "chest symptoms"), ("cough", "cough"),
              ("knee", "knee symptoms"), ("pelvic", "pelvic symptoms"), ("mri", "MRI interpretation"),
              ("ultrasound", "ultrasound interpretation"), ("ca-125", "CA-125 interpretation")]
    topic = next((label for term, label in topics if re.search(r"\b" + re.escape(term) + r"\b", narrative)), None)
    outside = topic in {"headache", "chest symptoms", "cough", "knee symptoms"}
    reason = ("Outside scope: the selected pelvic-pain module cannot support " + topic + ".") if outside else (
        "Evidence insufficient: the available evidence does not support further interpretation of " +
        ("the request concerning " + topic if topic else "the submitted clinical details") + ".")
    allowedAges = {"Under 18", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"}
    age = case.ageRange if case.ageRange in allowedAges else "Unknown"
    pregnancy = "Unknown" if case.pregnancyPossible is None else "Yes" if case.pregnancyPossible else "No"
    pid = "Unknown" if case.pidDiagnosedOrPresumed is None else "Yes" if case.pidDiagnosedOrPresumed else "No"
    features = [(r"\b(?:recurrent|recurring)\b", "recurring symptoms"), (r"\bintermittent\b", "intermittent symptoms"),
                (r"\b(?:cyclic|cyclical)\b", "cyclical timing"), (r"\bafter activity\b", "activity-related context"),
                (r"\bbleeding\b", "bleeding"), (r"\bfever\b", "fever"), (r"\bnausea\b", "nausea"),
                (r"\bseveral months\b", "a several-month duration"), (r"\bdaily activities\b", "daily activities")]
    mentioned = [label for pattern, label in features if re.search(pattern, narrative)][:3]
    summary = " Narrative topics mentioned: " + ", ".join(mentioned) + ". Mentions alone do not establish findings." if mentioned else ""
    return reason + summary + f" Reported context: age range {age}; {case.caseType.value} case; pregnancy {pregnancy}; PID {pid}. No other findings are assumed."
