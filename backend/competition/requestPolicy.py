"""Request-local scope boundaries; never authorize clinical claims or infer facts."""

import re

PrescribingNotice = "Medication selection, dosing and patient-specific prescribing are outside this system’s scope."
PrescribingPattern = re.compile(
    r"\b(?:prescrib\w*|prescription|dos(?:e|es|ing|age)|how (?:much|many)[^.!?]{0,45}(?:take|give|tablet|pill)|"
    r"(?:select|choose|best|which|recommend)[^.!?]{0,45}(?:medication|drug|treatment)|"
    r"(?:start|stop|replace|switch|change|increase|decrease)[^.!?]{0,35}(?:medication|drug|treatment|therapy)|"
    r"(?:treatment|medication|therapy)[^.!?]{0,25}duration|how long[^.!?]{0,40}(?:take|treat|therapy))\b", re.IGNORECASE)
GeneralQuestion = re.compile(r"\b(?:guideline|policy|publication|source)\b.*\b(?:discuss|cover|say|address)|\b(?:discuss|cover|say|address)\b.*\b(?:guideline|policy|publication|source)\b", re.IGNORECASE)
PersonalRequest = re.compile(r"\b(?:patient|this case|for me|for her|for him|select|choose|write|give|start|stop|replace|switch|increase|decrease|exact|best)\b", re.IGNORECASE)


def prescribingIntent(notes):
    text = re.sub(r"\b(?:do not|don't)\s+(?:(?:provide|give)\s+)?(?:select\s+treatment|prescribe|recommend\s+medication|provide\s+dosing|dosing)\b", "", notes or "", flags=re.IGNORECASE)
    return any(PrescribingPattern.search(sentence) and not (GeneralQuestion.search(sentence) and not PersonalRequest.search(sentence))
        for sentence in re.split(r"(?<=[.!?;])\s+", text))


def evidenceNotes(notes):
    """Remove requested prescribing tasks, not clinical findings, from topic matching."""
    return " ".join(sentence.strip() for sentence in re.split(r"(?<=[.!?;])\s+", notes or "") if not prescribingIntent(sentence))


def scopeResult(result, notes):
    """Reuse renderedText/message; the fixed preface is not a cited clinical claim."""
    if not prescribingIntent(notes) or result.response.responseType in {"DataConflict", "ClarificationRequired"}:
        return result
    paragraphs = result.renderedText.split("\n\n")
    position = len(result.warnings)
    if result.response.responseType == "OutsideScope":
        outcome = result.response.model_copy(update={"message": PrescribingNotice})
        paragraphs[position] = PrescribingNotice
        return result.model_copy(update={"response": outcome, "renderedText": "\n\n".join(paragraphs)})
    paragraphs.insert(position, PrescribingNotice)
    return result.model_copy(update={"renderedText": "\n\n".join(paragraphs)})


def indeterminateContext(context):
    """A nonlocalizing TVUS may enter this pathway only with all ACEP qualifiers."""
    return (context.pregnancyTestType == "serum" and context.pregnancyTestResult == "positive"
        and context.careSetting == "emergencyDepartment" and context.clinicallyStable is True
        and context.previousIntrauterinePregnancyConfirmed is False and context.assistedReproduction is False
        and context.abdominalTrauma is False and context.ultrasoundRoute == "transvaginal"
        and context.ultrasoundFinding in {"indeterminate", "noPregnancyVisualized"})


def hcgClarification(case):
    """Ask about missing qualifiers; explicit ineligible findings remain fail-closed."""
    context = case.earlyPregnancy
    if context is None or not re.search(r"\bhcg\b|serum", case.additionalNotes or "", re.IGNORECASE):
        return None
    if context.ultrasoundFinding not in {"indeterminate", "noPregnancyVisualized"}:
        return None
    # Keep the NICE location-only pathway separate from a requested ACEP exclusion answer.
    if not re.search(r"exclude|rule out|single|one result", case.additionalNotes or "", re.IGNORECASE) and not (context.careSetting == "emergencyDepartment" and re.search(r"serial|schedule", case.additionalNotes or "", re.IGNORECASE)):
        return None
    groups = [
        (("careSetting", "clinicallyStable"), "Please confirm the care setting and whether the presentation is clinically stable."),
        (("pregnancyTestType", "pregnancyTestResult", "ultrasoundRoute"), "Please confirm the pregnancy test type and result, and the ultrasound route."),
        (("previousIntrauterinePregnancyConfirmed", "assistedReproduction", "abdominalTrauma"), "Please clarify whether there was a previously confirmed intrauterine pregnancy, fertility treatment, or abdominal trauma."),
    ]
    for names, question in groups:
        if any(getattr(context, name) is None for name in names):
            return question
    return None
