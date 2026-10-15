"""Bounded reported-finding coverage; never infer a cause or expand verified facts."""

import re

from backend.app.utils.assertions import phraseState


def hasUnsupportedFindings(case, fibroidCovered=False):
    """Fail closed for abnormal result categories without a bounded synthesis path."""
    context = " ".join(str(field) for name, field in case.model_dump().items() if field is not None and
        name not in {"moduleHint", "caseType", "ageRange", "pregnancyPossible", "pidDiagnosedOrPresumed", "urgentFindings"})
    pattern = r"cyst\w*|mass|endometrioma|tumou?r|adenomyosis" if fibroidCovered else r"cyst\w*|mass|enlarged|tender|endometrioma|abnormal|fibroid\w*|tumou?r|adenomyosis"
    return any(re.search(r"ultrasound|\bmri\b|exam\w*", sentence, re.IGNORECASE)
        and re.search(r"shows?|showed|identif\w*|reveal\w*|found|demonstrat\w*", sentence, re.IGNORECASE)
        and phraseState(sentence, pattern) is True
        for sentence in re.split(r"(?<!\d)[.!?](?!\d)", context))


def buildFocus(case, package):
    """Separate explicit fibroid findings from supported associations and limits."""
    context = " ".join(str(field) for name, field in case.model_dump().items() if field is not None and
        name not in {"moduleHint", "caseType", "ageRange", "pregnancyPossible", "pidDiagnosedOrPresumed", "urgentFindings"})
    if phraseState(context, r"(?:intramural\s+)?(?:uterine\s+)?fibroid\w*|leiomyoma\w*") is not True:
        return None
    byId = {claim.claimId: claim for claim in package.claims}
    sentences = re.split(r"(?<!\d)[.!?](?!\d)", context)
    wording = {}
    size = re.search(r"\b(\d{1,2}(?:\.\d{1,2})?)\s*cm\s+(intramural\s+)?(?:uterine\s+)?fibroid", context, re.IGNORECASE)
    description = (size.group(1) + " cm " + ("intramural " if size.group(2) else "")) if size else ""
    reported = [label for pattern, label in [
        (r"tender", "tenderness"), (r"urinary frequency|frequent urination", "urinary frequency"),
    ] if phraseState(context, pattern) is True]
    if any(re.search(r"uterus|uterine", sentence, re.IGNORECASE) and phraseState(sentence, r"enlarged") is True for sentence in sentences):
        reported.insert(0, "uterine enlargement")
    wording["C07"] = "Bleeding and pelvic pressure can be associated with fibroids; the reported " + description + "fibroid is therefore a relevant structural finding. This does not establish that it explains " + (", ".join(reported) + " or " if reported else "") + "the entire symptom pattern."
    associations = [label for pattern, label in [
        (r"cycle.related (?:pelvic )?(?:pain|worsening)|cyclic(?:al)? (?:pelvic )?pain|period.related (?:pelvic )?pain|worse.*period|worse.*menstru", "cycle-related worsening"),
        (r"deep dyspareunia|dyspareunia|pain.*intercourse", "pain during intercourse"),
    ] if phraseState(context, pattern) is True]
    if "pain during intercourse" in associations and phraseState(context, r"deep dyspareunia|deep pain.*intercourse") is True:
        associations[associations.index("pain during intercourse")] = "deep pain during intercourse"
    if associations:
        wording["C05"] = "Reported " + " and ".join(associations) + (" keeps" if len(associations) == 1 else " keep") + " endometriosis as a separate consideration."
    if phraseState(context, r"cyclic(?:al)? bowel|cycle.related bowel|bowel.*(?:period|menstr|cycle)") is True:
        wording["N04"] = "The reported cyclical bowel pattern belongs in the same symptom review."
    elif phraseState(context, r"bowel symptoms|bowel pain|painful bowel movements") is True:
        wording["C01"] = "Reported bowel symptoms may have overlapping contributors; the available evidence does not establish their cause."
    # The urgent-finding parser intentionally excludes relatives. For this family
    # history fact only, normalize the relationship marker while retaining denial
    # and uncertainty; never feed this normalization into patient safety rules.
    familyContext = re.sub(r"family history|sister|mother", "reported pedigree", context, flags=re.IGNORECASE)
    if phraseState(familyContext, r"reported pedigree.*endometriosis") is True:
        wording["N07"] = ("The reported first-degree family history adds relevant context." if re.search(r"sister|mother|first.degree", context, re.IGNORECASE)
            else "Family history was reported, but its first-degree relationship needs clarification.")
    endometriosisPoints = [claimId for claimId in ("C05", "N04", "N07") if claimId in wording]
    if endometriosisPoints:
        wording[endometriosisPoints[-1]] += " These findings do not confirm endometriosis."
    if re.search(r"ultrasound|tvus", context, re.IGNORECASE):
        ultrasoundSentences = [sentence for sentence in sentences if re.search(r"ultrasound|tvus", sentence, re.IGNORECASE)]
        ultrasoundFinding = any(phraseState(sentence, r"fibroid\w*") is True
            and not re.search(r"planned|will|requested|awaiting", sentence, re.IGNORECASE) for sentence in ultrasoundSentences)
        wording["NichdUltrasoundLimits"] = ("The ultrasound detected a fibroid; that is not a normal ultrasound. " if ultrasoundFinding else "The reported ultrasound context needs precise interpretation. ") + "Ultrasound may miss smaller endometriosis lesions or adhesions and does not establish a sole cause."
        if ultrasoundFinding and any(re.search(r"no (?:reported )?endometrioma or deep endometriosis", sentence, re.IGNORECASE)
            and phraseState(sentence, r"endometrioma|deep endometriosis") is False for sentence in ultrasoundSentences):
            wording["NichdUltrasoundLimits"] = "The ultrasound detected a fibroid but did not report an endometrioma or deep endometriosis. " + ("Normal-appearing ovaries were reported. " if any(re.search(r"normal.appearing ovaries", sentence, re.IGNORECASE) for sentence in ultrasoundSentences) else "") + "These partial negative findings do not make the ultrasound normal: ultrasound may miss smaller lesions or adhesions and does not establish a sole cause."
    if re.search(r"fertil|future pregnancy|pregnancy goal", context, re.IGNORECASE):
        wording["WhoPriorities"] = "Future fertility priorities and individual preferences should inform that review."
    contextPoints = [label for pattern, label in [
        (r"bleeding|heavy.*period", "bleeding pattern"), (r"pelvic pressure", "pelvic pressure"),
        (r"persist\w*|progress\w*|worsen\w*", "symptom progression"),
        (r"exam\w*|enlarged|tender", "examination findings"), (r"bowel", "bowel symptoms"),
        (r"urinary|urination", "urinary symptoms"), (r"work|daily activities|functional impact", "functional impact"),
    ] if phraseState(context, pattern) is True]
    wording["CppHistory"] = "Further review should integrate " + ("the reported " + ", ".join(contextPoints) if contextPoints else "the symptom history and missing clinical context") + ". The evidence supplies no patient-specific attribution or treatment rule based on fibroid size or location."
    return tuple(byId[claimId] for claimId in wording), wording
