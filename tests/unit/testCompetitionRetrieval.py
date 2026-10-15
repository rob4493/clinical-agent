"""Named-test and module isolation use de-identified synthetic case requests."""

import pytest

from backend.app.models.input import ClinicalCaseInput
from backend.competition.package import PackageError
from backend.competition.retrieval import CompetitionRetrieval


def makeCase(narrative, **fields):
    return ClinicalCaseInput(moduleHint="EndometriosisChronicPelvicPain", caseType="brief", additionalNotes=narrative, **fields)


@pytest.mark.parametrize("narrative,required,forbidden", [
    ("Does a normal transvaginal ultrasound exclude endometriosis?", {"N18"}, {"N22", "NichdMriLimits"}),
    ("Does a normal MRI end evaluation for pelvic pain?", {"N19", "N20", "NichdMriLimits"}, {"N18", "N22", "NichdUltrasoundLimits"}),
    ("Can normal CA-125 diagnose endometriosis?", {"N22"}, {"N18", "N19", "NichdMriLimits", "NichdUltrasoundLimits"}),
])
def testNamedTestsRetrieveTheirOwnEvidence(narrative, required, forbidden):
    claims = CompetitionRetrieval().retrieve(makeCase(narrative))
    identifiers = {claim.claimId for claim in claims}
    assert required.issubset(identifiers) and identifiers.isdisjoint(forbidden)
    assert all(claim.moduleId == "module_01_endo" and claim.competitionStatus == "competitionEligible" for claim in claims)


def testDifferentOriginalCasesRetrieveDifferentRelevantClaims():
    retrieval = CompetitionRetrieval()
    family = retrieval.retrieve(makeCase("A first-degree family history is reported. How is that relevant?"))
    urinary = retrieval.retrieve(makeCase("Painful urination accompanies periods. What overlap is described?"))
    assert "N07" in {claim.claimId for claim in family}
    assert "N05" in {claim.claimId for claim in urinary}
    assert [claim.claimId for claim in family] != [claim.claimId for claim in urinary]
    assert retrieval.retrieve(makeCase("A first-degree family history is reported. How is that relevant?")) == family


@pytest.mark.parametrize("pid", [None, False])
def testPidDispositionCannotBeRetrievedWithoutExplicitGate(pid):
    claims = CompetitionRetrieval().retrieve(makeCase("PID hospitalization disposition and outpatient tolerance?", pidDiagnosedOrPresumed=pid))
    assert not any(claim.claimId.startswith("Cdc") for claim in claims)


def testPidGateAllowsDispositionContext():
    claims = CompetitionRetrieval().retrieve(makeCase("PID is presumptively diagnosed; outpatient therapy cannot be tolerated. What disposition criteria are described?", pidDiagnosedOrPresumed=True))
    assert "CdcTolerance" in {claim.claimId for claim in claims}


@pytest.mark.parametrize("limit", [0, 9, True, 1.5])
def testQueryLimitStrictlyBounded(limit):
    with pytest.raises(PackageError):
        CompetitionRetrieval().retrieve(makeCase("Recurring pelvic pain."), limit)


def testOtherModuleCannotRetrieveCompetitionClaims():
    with pytest.raises(PackageError):
        CompetitionRetrieval().retrieve(ClinicalCaseInput(moduleHint="SyntheticOther", caseType="brief", additionalNotes="Pelvic pain."))


def testNoMissingStatusesInferredOrRetained():
    case = makeCase("Recurring pelvic pain and functional impact at work.")
    retrieval = CompetitionRetrieval()
    assert retrieval.retrieve(case)
    assert case.pregnancyPossible is None and case.pidDiagnosedOrPresumed is None
    assert set(vars(retrieval)) == {"root", "expectedHash", "registry", "loader"}


def testSelectedModuleDoesNotInventPelvicSymptoms():
    assert CompetitionRetrieval().retrieve(makeCase("An isolated headache is reported.")) == ()


def testExplicitNegationDoesNotBecomePositiveSymptomCriterion():
    claims = CompetitionRetrieval().retrieve(makeCase("Pelvic discomfort is reported. No urinary symptoms. No menstrual pain."))
    assert {claim.claimId for claim in claims}.isdisjoint({"N05", "N02", "C04"})


def testHistoricalAcuteSymptomsDoNotSupplyCurrentUrgentClaim():
    claims = CompetitionRetrieval().retrieve(makeCase("Previously sudden acute pelvic pain. Currently recurrent pelvic discomfort."))
    assert {claim.claimId for claim in claims}.isdisjoint({"C08", "C14", "E01", "E02"})


def testFalseOrUnknownStructuredFindingsCannotInventAcuteSymptoms():
    case = makeCase("Recurring pelvic discomfort.", urgentFindings={"fainting":False, "suddenAcutePelvicPain":None})
    claims = CompetitionRetrieval().retrieve(case)
    assert {claim.claimId for claim in claims}.isdisjoint({"C08", "C14", "E01", "E02"})


def testPositiveStructuredFindingCanSupplyItsOwnRelevantEvidence():
    case = makeCase("Pelvic discomfort.", urgentFindings={"suddenAcutePelvicPain":True})
    assert "C14" in {claim.claimId for claim in CompetitionRetrieval().retrieve(case)}


def testUnknownExaminationAndCycleDoNotIntroduceNamedInterpretations():
    claims = CompetitionRetrieval().retrieve(makeCase("Intermittent pelvic discomfort affects daily activities. Examination findings are not provided."))
    assert {claim.claimId for claim in claims}.isdisjoint({"N17", "N02", "C04"})


def testAgeAloneCannotBecomeCaseEvidence():
    assert CompetitionRetrieval().retrieve(makeCase("", ageRange="Under 18")) == ()


def testBroadPelvicTermDoesNotRetrieveUnrequestedPathways():
    claims = CompetitionRetrieval().retrieve(makeCase("Intermittent pelvic discomfort lasting several months."))
    assert [claim.claimId for claim in claims] == ["N01", "C01", "C11"]


def testStructuredTreatmentContextPreventsNonspecificClassification():
    from backend.competition.retrieval import isNonspecific
    assert not isNonspecific(makeCase("Intermittent pelvic discomfort.", priorTreatments="Previous treatment was ineffective."))


def testCurrentRecurrenceAfterPriorSurgeryRetainsOnlyRelevantEvidence():
    claims = CompetitionRetrieval().retrieve(makeCase("Pelvic pain has returned after previous surgery."))
    assert {claim.claimId for claim in claims} == {"N01", "C01", "C11", "WhoRecurrence"}
    historical = CompetitionRetrieval().retrieve(makeCase("Previously pelvic pain returned after surgery. Currently mild pelvic discomfort."))
    assert "WhoRecurrence" not in {claim.claimId for claim in historical}
