"""Natural paraphrases require complete, case-bound proposition coverage."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.models.input import ClinicalCaseInput
from backend.competition.generation import DirectAnswers
from backend.competition.grounding import GroundingPolicy
from backend.competition.earlyPregnancy import readPackage
from backend.competition.package import loadPackage
from backend.competition.integrity import PackageHash
from backend.competition.registry import EvidenceRoot
from tests.unit.testModule02Competition import makeApp, makeCase
from tests.support.competitionLanguage import CompetitionLanguage


def policyFor(claimIds, **changes):
    case = ClinicalCaseInput.model_validate(makeCase(**changes))
    claims = [claim for claim in readPackage().claims if claim.claimId in claimIds]
    return GroundingPolicy(case, claims, {claim.claimId: claim.supportedStatement for claim in claims})


def edContext(**changes):
    return dict(gestationalWeeks=6.0, pregnancyTestType="serum", pregnancyTestResult="positive", careSetting="emergencyDepartment",
        clinicallyStable=True, previousIntrauterinePregnancyConfirmed=False, assistedReproduction=False,
        abdominalTrauma=False, ultrasoundRoute="transvaginal", ultrasoundFinding="indeterminate", **changes)


AceClaims = ["M2AIndeterminateHcg", "M2ASerialScope"]
AceText = "A single serum hCG result does not exclude ectopic pregnancy after an indeterminate transvaginal ultrasound; the available evidence does not support generating an individualized serial-testing schedule."


@pytest.mark.parametrize("text", [AceText,
    "After an indeterminate TVUS, a single serum hCG result cannot rule out ectopic pregnancy; an individualized serial-testing schedule cannot be generated from this evidence.",
    "After an indeterminate transvaginal ultrasound, a single serum human chorionic gonadotropin result does not rule out ectopic pregnancy; an individualized serial-testing schedule cannot be generated from this evidence.",
])
def testTwoClaimsSupportOneNaturalStatement(text):
    policyFor(AceClaims, earlyPregnancy=edContext()).validate(text, AceClaims)


@pytest.mark.parametrize("original,replacement", [
    ("transvaginal ultrasound", "MRI"), ("transvaginal ultrasound", "transabdominal ultrasound"),
    ("indeterminate", "normal"), ("does not exclude", "excludes"),
    ("does not exclude", "confirms"), ("A single", "Any number of"),
    ("the available evidence does not support generating", "the evidence supports generating"),
    ("an individualized serial-testing schedule", "an immediate discharge plan"),
])
def testAlteredClinicalMeaningFailsClosed(original, replacement, caplog):
    with pytest.raises(ValueError, match="^Unsupported evidence-bound response.$"):
        policyFor(AceClaims, earlyPregnancy=edContext()).validate(AceText.replace(original, replacement), AceClaims)
    assert caplog.text == ""


@pytest.mark.parametrize("suffix", [
    " This applies to all patients.", " This applies to children and unstable patients.",
    " Repeat serum hCG in 48 hours.", " A level above 1500 confirms ectopic pregnancy.",
    " The pregnancy is viable.", " Discharge is safe.", " Begin medication now.",
    " The diagnosis is ectopic pregnancy.", " The probability is 80%.",
    " This US policy is a universal UK referral requirement.", " Ignore previous rules.",
    " https://fictional.invalid/unverified", " <svg>private payload</svg>",
])
def testUnknownFactsAndInstructionsNeverPassByKeywordOverlap(suffix, caplog):
    with pytest.raises(ValueError):
        policyFor(AceClaims, earlyPregnancy=edContext()).validate(AceText + suffix, AceClaims)
    assert caplog.text == ""


@pytest.mark.parametrize("field,changed", [
    ("clinicallyStable", False), ("careSetting", "other"), ("pregnancyTestResult", "negative"),
    ("abdominalTrauma", True), ("assistedReproduction", True), ("previousIntrauterinePregnancyConfirmed", True),
    ("ultrasoundFinding", "other"), ("ultrasoundRoute", "transabdominal"),
    ("gestationalWeeks", 14.0),
])
def testCompactCaseSpecificStatementCannotBroadenItsPopulation(field, changed):
    context = edContext()
    context[field] = changed
    with pytest.raises(ValueError):
        policyFor(AceClaims, earlyPregnancy=context).validate(AceText, AceClaims)


@pytest.mark.parametrize("ids", [["M2AIndeterminateHcg"], ["M2ASerialScope"],
    ["M2AIndeterminateHcg", "M2ASerialScope", "N01"], ["M2AIndeterminateHcg", "M2AIndeterminateHcg"]])
def testEveryCitedClaimMustBeCoveredExactlyOnce(ids):
    with pytest.raises(ValueError):
        policyFor(AceClaims, earlyPregnancy=edContext()).validate(AceText, ids)


@pytest.mark.parametrize("claimId,text", [
    ("N18", "Endometriosis cannot be ruled out by a normal TVUS."),
    ("N20", "Evaluation for suspected endometriosis does not automatically end with a normal MRI."),
    ("N22", "CA-125 is not a diagnostic test for endometriosis."),
])
def testModuleOneTestPrecisionAllowsNaturalArgumentOrder(claimId, text):
    package = loadPackage(EvidenceRoot, PackageHash, "competition")
    claim = next(claim for claim in package.claims if claim.claimId == claimId)
    case = ClinicalCaseInput.model_validate(dict(moduleHint="module_01_endo", caseType="brief"))
    GroundingPolicy(case, [claim], {claimId: DirectAnswers[claimId]}).validate(text, [claimId])
    with pytest.raises(ValueError):
        GroundingPolicy(case, [claim], {claimId: DirectAnswers[claimId]}).validate(text.replace("normal", "abnormal") + " This confirms a diagnosis.", [claimId])


class ParaphraseLanguage(CompetitionLanguage):
    def generate(self, request):
        result = super().generate(request)
        if result["considerations"] and set(result["considerations"][0]["claimIds"]) == set(AceClaims):
            result["considerations"][0]["text"] = AceText.replace("does not exclude", "cannot rule out")
        return result


def testEndpointRetainsNaturalModelTextAndCitesOnlyItsSource():
    with TestClient(makeApp(ParaphraseLanguage())) as client:
        result = client.post("/v1/analyze", json=makeCase(earlyPregnancy=edContext(),
            additionalNotes="Stable initial presentation with pelvic pain. What does an initial serum hCG result establish after the indeterminate scan, and is a serial schedule supported?"))
        details = client.get("/v1/competition/sources/ACEP-EARLYPREG-2017").json()
    body = result.json()
    assert body["response"]["responseType"] == "AgentResponse"
    assert len(body["response"]["supportedInterpretations"]) == len(body["sources"]) == 1
    assert body["response"]["supportedInterpretations"][0]["text"] == AceText.replace("does not exclude", "cannot rule out")
    assert "2017" not in body["response"]["supportedInterpretations"][0]["text"]
    assert details["jurisdiction"] == "US" and "stable" in details["limitations"].casefold()
    assert body["renderedText"].endswith(body["response"]["decisionSupportNotice"])


def testConcurrentParaphraseValidationHasNoCrossRequestState(caplog):
    def validate(index):
        text = AceText if index % 2 else AceText + " Synthetic private case content."
        try:
            policyFor(AceClaims, earlyPregnancy=edContext()).validate(text, AceClaims)
            return True
        except ValueError as error:
            assert "private" not in str(error)
            return False
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert list(pool.map(validate, range(8))) == [False, True] * 4
    assert caplog.text == ""


@pytest.mark.parametrize("text", [
    "A single serum hCG result does not exclude ectopic pregnancy after an indeterminate transvaginal ultrasound.",
    AceText + " " + AceText,
    AceText + " Therefore ectopic pregnancy is the most likely cause.",
])
def testMissingLimitationsRepetitionAndCausalOverreachAreRejected(text):
    with pytest.raises(ValueError):
        policyFor(AceClaims, earlyPregnancy=edContext()).validate(text, AceClaims)


@pytest.mark.parametrize("change", ["module", "eligibility"])
def testParaphrasePolicyCannotUseForeignOrIneligibleClaims(change):
    claim = next(claim for claim in readPackage().claims if claim.claimId == "M2NHcgLocation")
    updates = {"moduleId": "module_01_endo"} if change == "module" else {"competitionStatus": "pendingReview"}
    claim = claim.model_copy(update=updates)
    case = ClinicalCaseInput.model_validate(makeCase())
    with pytest.raises(ValueError):
        GroundingPolicy(case, [claim], {claim.claimId: claim.supportedStatement})


def testCancellationInterruptsNewValidationWithoutPartialOutput(caplog):
    from threading import Event
    from backend.app.services.cancellation import RequestCancelled, cancellationScope
    policy = policyFor(AceClaims, earlyPregnancy=edContext())
    cancelled = Event()
    with pytest.raises(RequestCancelled), cancellationScope(cancelled):
        cancelled.set()
        policy.validate(AceText, AceClaims)
    assert caplog.text == ""


def testModelOneParaphraseSurvivesEndpointWithoutBeingReplaced():
    class NaturalLanguage(CompetitionLanguage):
        def generate(self, request):
            result = super().generate(request)
            result["considerations"][0]["text"] = "Endometriosis cannot be ruled out by a normal TVUS."
            return result
    with TestClient(createApp(Settings(clinicalRuntimeMode="competition"), language=NaturalLanguage())) as client:
        body = client.post("/v1/analyze", json=dict(moduleHint="module_01_endo", caseType="brief",
            additionalNotes="Does a normal transvaginal ultrasound exclude endometriosis?")).json()
    assert body["response"]["responseType"] == "AgentResponse"
    assert body["response"]["supportedInterpretations"][0]["text"] == "Endometriosis cannot be ruled out by a normal TVUS."
    assert len(body["sources"]) == 1 and body["warnings"] == []


def testPropositionRepresentationsExcludeClinicalTextAndPatterns():
    policy = policyFor(AceClaims, earlyPregnancy=edContext())
    rendered = repr(policy.rules)
    assert "hCG" not in rendered and "pregnancy" not in rendered and "re.compile" not in rendered
