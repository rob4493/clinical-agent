"""Conservative proposition recognition; never a general medical entailment model."""

import re
from dataclasses import dataclass, field

from backend.app.services.cancellation import checkCancelled
from backend.competition.requestPolicy import indeterminateContext


@dataclass(frozen=True)
class Proposition:
    """A complete supported proposition and the exact claims needed to express it."""

    claimIds: tuple[str, ...]
    text: str = field(repr=False)
    pattern: re.Pattern = field(repr=False)


def phrasePattern(text):
    """Allow only local equivalences that retain predicate arguments and negation."""
    alternatives = {
        "does not exclude": r"(?:does not exclude|does not rule out|cannot rule out)",
        "cannot exclude": r"(?:cannot exclude|cannot rule out)",
        "cannot rule out": r"(?:cannot rule out|does not rule out|does not exclude)",
        "does not identify": r"(?:does not identify|cannot identify)",
        "does not establish": r"(?:does not establish|does not demonstrate)",
        "can be associated with": r"(?:can be associated with|may be associated with)",
        "may also be relevant": r"(?:may also be relevant|can also be relevant)",
        "transvaginal ultrasound": r"(?:transvaginal ultrasound|TVUS)",
        "serum hcg": r"(?:serum hCG|serum human chorionic gonadotropin)",
    }
    tokens = re.split("(" + "|".join(re.escape(phrase) for phrase in alternatives) + ")", text.rstrip("."), flags=re.IGNORECASE)
    return re.compile("".join(alternatives.get(token.casefold(), re.escape(token)) for token in tokens), re.IGNORECASE)


class GroundingPolicy:
    """Bind natural constructions to retrieved claims and the validated case scope.

    Every word must belong to a recognized proposition or a neutral conjunction.
    This avoids token overlap, similarity scores and provider self-attestation.
    """

    def __init__(self, case, claims, wording):
        self.case = case
        self.claims = {claim.claimId: claim for claim in claims}
        self.wording = wording
        moduleIds = {claim.moduleId for claim in claims}
        expected = "module_01_endo" if case.moduleHint == "EndometriosisChronicPelvicPain" else case.moduleHint
        if moduleIds != {expected} or any(claim.competitionStatus != "competitionEligible" for claim in claims):
            raise ValueError("Unsupported evidence-bound response.")
        self.rules = []
        self.preferred = []
        for claim in claims:
            self.add((claim.claimId,), wording[claim.claimId])
        self.addNatural()

    def add(self, claimIds, text, preferred=False):
        if not set(claimIds).issubset(self.claims):
            return
        modules = {self.claims[claimId].moduleId for claimId in claimIds}
        if len(modules) != 1 or modules != {next(iter(self.claims.values())).moduleId}:
            raise ValueError("Unsupported evidence-bound response.")
        proposition = Proposition(tuple(claimIds), text, phrasePattern(text))
        self.rules.append(proposition)
        if preferred:
            self.preferred.append(proposition)

    def addNatural(self):
        ids = set(self.claims)
        if "structural finding" in self.wording.get("C07", ""):
            # The case-derived wording has already preserved abnormal findings.
            # Move only its explicitly enumerated uncertainty clauses to one
            # conclusion; numbers, test results and positive findings stay fixed.
            paragraphs = []
            for claimId, text in self.wording.items():
                if claimId == "C07":
                    prefix, boundary = text.split(" This does not establish that it explains ", 1)
                    findings = boundary.removesuffix("the entire symptom pattern.").removesuffix(" or ")
                    paragraphs.append(prefix)
                    if findings:
                        paragraphs.append("Reported " + findings + " also need integrated review.")
                elif claimId == "CppHistory":
                    paragraphs.append(text.split(" The evidence supplies no patient-specific attribution", 1)[0])
                else:
                    paragraphs.append(text.replace(" These findings do not confirm endometriosis.", "")
                        .replace("; the available evidence does not establish their cause", "")
                        .replace(" and does not establish a sole cause", ""))
            uncertainty = ("These findings do not confirm endometriosis or establish the fibroid as the sole cause; "
                if any(claimId in ids for claimId in ("C05", "N04", "N07")) else
                "These findings do not establish the fibroid as the sole cause; ")
            paragraphs.append(uncertainty + "neither symptom attribution nor individual treatment can be determined from fibroid size or location alone.")
            if len(ids) <= 8:
                self.add(tuple(self.claims), " ".join(paragraphs), True)
        if {"N01", "C01", "C11"}.issubset(ids) and self.wording["N01"].startswith("The submitted pelvic discomfort is nonspecific"):
            self.add(("N01", "C01", "C11"),
                "The reported pelvic discomfort is nonspecific. Endometriosis and overlapping urinary, bowel or musculoskeletal contributors remain considerations; the available information does not identify the cause.", True)
        elif {"N01", "C05"}.issubset(ids):
            self.add(("N01", "C05"), "Cycle-related pelvic pain and pain during sex keep endometriosis among the considerations, but do not confirm a diagnosis.", True)
        self.add(("C09", "C10", "C11"), "Urinary, bowel and musculoskeletal conditions are among the possible contributors to pelvic pain.", True)
        if self.wording.get("N18") == "A normal transvaginal ultrasound does not exclude endometriosis.":
            self.add(("N18",), "Endometriosis cannot be ruled out by a normal transvaginal ultrasound.")
        if self.wording.get("N20") == "A normal MRI does not automatically end evaluation for suspected endometriosis.":
            self.add(("N20",), "Evaluation for suspected endometriosis does not automatically end with a normal MRI.")
        if self.wording.get("N20") == "A normal MRI does not establish that endometriosis is absent.":
            self.add(("N20",), "Endometriosis cannot be considered absent solely because MRI is normal.")
        if self.wording.get("N22") == "Serum CA-125 should not be used to diagnose endometriosis.":
            self.add(("N22",), "CA-125 is not a diagnostic test for endometriosis.")
        context = self.case.earlyPregnancy
        if context is None or self.case.pregnancyPossible is not True or context.gestationalWeeks is None or context.gestationalWeeks > 13:
            return
        self.add(("M2NSymptoms", "M2NPainAssessment"),
            "Pain or bleeding in early pregnancy may warrant early-pregnancy assessment, but these symptoms alone do not identify the cause or confirm ectopic pregnancy. The urgency of referral depends on the overall clinical presentation.", True)
        # Removing population metadata from case-specific prose is permitted only
        # after independently checking the population that supports this policy.
        stableEd = indeterminateContext(context)
        if stableEd:
            self.add(("M2AIndeterminateHcg", "M2ASerialScope"),
                "A single serum hCG result does not exclude ectopic pregnancy after an indeterminate transvaginal ultrasound; the available evidence does not support generating an individualized serial-testing schedule.", True)
            self.add(("M2AIndeterminateHcg", "M2ASerialScope"),
                "After an indeterminate transvaginal ultrasound, a single serum hCG result cannot rule out ectopic pregnancy; an individualized serial-testing schedule cannot be generated from this evidence.")
            self.add(("M2AIndeterminateHcg",), "A single serum hCG result does not exclude ectopic pregnancy after an indeterminate transvaginal ultrasound.", True)
        locationUnknown = (context.pregnancyTestResult == "positive" and context.ultrasoundRoute == "transvaginal"
            and context.ultrasoundFinding == "noPregnancyVisualized" and context.previousIntrauterinePregnancyConfirmed is False)
        if locationUnknown:
            self.add(("M2NPulDefinition", "M2NPulPossibility"), "With a positive pregnancy test and no intrauterine or extrauterine pregnancy seen on transvaginal ultrasound, location remains unresolved and ectopic pregnancy remains a consideration, not a confirmed diagnosis.", True)
            self.add(("M2NHcgLocation",), "A serum hCG result alone does not determine pregnancy location when it remains unresolved on the reported scan.", True)
            self.add(("M2NHcgLocation",), "Serum hCG alone cannot locate the pregnancy.")
            self.add(("M2NEmptyUterus",), "An empty uterus on transvaginal ultrasound alone does not confirm ectopic pregnancy.")
            self.add(("M2NSerialLimits", "M2NSymptomsOverHcg", "M2NEmptyUterus"),
                "An empty uterus on transvaginal ultrasound does not establish ectopic pregnancy by itself. Serial serum hCG results do not locate the pregnancy; symptoms take priority over a reassuring trend, and a changed clinical picture needs review regardless of previous results. Viability must not be inferred from these results alone.", True)

    def validate(self, text, claimIds):
        """Fully parse output into disjoint, exactly cited proposition sets."""
        checkCancelled()
        required = frozenset(claimIds)
        if not required or len(required) != len(claimIds) or not required.issubset(self.claims) or len(text) > 6000:
            raise ValueError("Unsupported evidence-bound response.")
        separator = re.compile(r"(?:\.\s+|;\s+|,\s+(?:and)\s+|\s+and\s+)", re.IGNORECASE)
        # Memoization is local to this validation. Never reuse a verdict or cache
        # case-derived wording across requests, even for matching claim IDs.
        visited = set()

        def recognize(position, covered):
            checkCancelled()
            state = (position, covered)
            if state in visited:
                return False
            visited.add(state)
            for rule in self.rules:
                meaning = frozenset(rule.claimIds)
                if not meaning.issubset(required) or meaning.intersection(covered):
                    continue
                match = rule.pattern.match(text, position)
                if match is None:
                    continue
                nextCovered = covered | meaning
                if text[match.end():] in {"", "."} and nextCovered == required:
                    return True
                joining = separator.match(text, match.end())
                if joining and recognize(joining.end(), nextCovered):
                    return True
            return False

        if not recognize(0, frozenset()):
            raise ValueError("Unsupported evidence-bound response.")

    def statements(self, numbers, claimIds=None):
        """Offer natural, many-claim units without changing provider-neutral schemas."""
        offered = set(self.claims) if claimIds is None else set(claimIds)
        used = set()
        statements = []
        for rule in sorted(self.preferred, key=lambda rule: -len(rule.claimIds)):
            if not set(rule.claimIds).issubset(offered) or used.intersection(rule.claimIds):
                continue
            statements.append(dict(claimId=rule.claimIds[0], claimIds=list(rule.claimIds), text=rule.text,
                citationNumber=numbers[self.claims[rule.claimIds[0]].sourceId],
                citationNumbers=list(dict.fromkeys(numbers[self.claims[claimId].sourceId] for claimId in rule.claimIds))))
            used.update(rule.claimIds)
        for claimId in self.claims:
            if claimId in offered and claimId not in used:
                statements.append(dict(claimId=claimId, text=self.wording[claimId], citationNumber=numbers[self.claims[claimId].sourceId]))
        order = {claimId: index for index, claimId in enumerate(self.claims)}
        return sorted(statements, key=lambda statement: min(order[claimId] for claimId in statement.get("claimIds", [statement["claimId"]])))
