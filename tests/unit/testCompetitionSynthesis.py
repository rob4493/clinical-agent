"""Synthetic structural findings must survive a complete evidence-bound review."""

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import createApp
from backend.competition.retrieval import CompetitionRetrieval
from tests.support.competitionLanguage import CompetitionLanguage
from tests.unit.testCompetitionAnalysis import caseFields
from tests.unit.testCompetitionRetrieval import makeCase

DetailedCase = (
    "Persistent pelvic pain with cycle-related worsening and deep dyspareunia. "
    "Heavy abnormal bleeding, pelvic pressure, urinary frequency and cyclical bowel symptoms affect work and daily activities. "
    "Future fertility is a priority. Her sister has endometriosis. "
    "Pelvic examination identifies an enlarged, mildly tender uterus. "
    "Transvaginal ultrasound shows a 4.5 cm intramural uterine fibroid, normal-appearing ovaries, "
    "and no reported endometrioma or deep endometriosis. "
    "Provide a concise review explaining what the fibroid may account for, whether endometriosis remains a consideration, "
    "what ultrasound does and does not establish, and factors guiding further review. Do not select treatment."
)


def testDetailedReviewCoversFindingsAndAttributionLimits(caplog):
    with TestClient(createApp(Settings(clinicalRuntimeMode="competition"), language=CompetitionLanguage())) as client:
        payload = client.post("/v1/analyze", json=caseFields(DetailedCase, caseType="detailed")).json()
    assert payload["response"]["responseType"] == "AgentResponse"
    body = " ".join(statement["text"] for statement in payload["response"]["supportedInterpretations"])
    for point in ["4.5 cm intramural", "bleeding", "pelvic pressure", "uterine enlargement", "tenderness", "urinary frequency", "cycle-related", "intercourse", "cyclical bowel", "first-degree", "functional impact", "fertility", "did not report an endometrioma or deep endometriosis", "size or location"]:
        assert point in body
    assert "do not confirm endometriosis or establish the fibroid as the sole cause" in body
    assert body.count("These findings do not") == 1
    assert body.count("neither symptom attribution nor individual treatment can be determined from fibroid size or location alone") == 1
    assert "not a normal ultrasound" in body or "do not make the ultrasound normal" in body
    assert all(phrase not in body.casefold() for phrase in ["normal pelvic examination", "a normal transvaginal ultrasound", "mri", "laparoscopy", "referral", "initial treatment"])
    assert len(payload["response"]["supportedInterpretations"]) <= 3
    assert not caplog.text


@pytest.mark.parametrize("mutation", ["omit", "normal", "attribute"])
def testStructuralReviewRejectsOmissionContradictionAndUnsupportedAttribution(mutation):
    class IncorrectLanguage(CompetitionLanguage):
        def generate(self, request):
            draft = super().generate(request)
            if mutation == "omit":
                draft["considerations"] = draft["considerations"][1:]
            else:
                draft["considerations"][0]["text"] = "The ultrasound is normal." if mutation == "normal" else "The fibroid explains all symptoms."
            return draft
    with TestClient(createApp(Settings(clinicalRuntimeMode="competition"), language=IncorrectLanguage())) as client:
        payload = client.post("/v1/analyze", json=caseFields(DetailedCase, caseType="detailed")).json()
    assert payload["response"]["responseType"] == "EvidenceInsufficient"
    assert "The ultrasound is normal" not in payload["renderedText"]
    assert "explains all symptoms" not in payload["renderedText"]


def testAbnormalUltrasoundDoesNotRetrieveNormalExamOrUnrequestedProcedures():
    claims = CompetitionRetrieval().retrieve(makeCase(DetailedCase))
    assert {claim.claimId for claim in claims}.isdisjoint({"N14", "N17", "N18", "N19", "N20", "N21", "N25", "N26", "N27"})


def testUnsupportedAbnormalFindingReturnsExplicitLimitation():
    language = CompetitionLanguage()
    with TestClient(createApp(Settings(clinicalRuntimeMode="competition"), language=language)) as client:
        payload = client.post("/v1/analyze", json=caseFields("Ultrasound shows an ovarian mass. Provide a detailed pelvic pain review.", caseType="detailed")).json()
    assert payload["response"]["responseType"] == "EvidenceInsufficient"
    assert "reported abnormal findings" in payload["renderedText"]
    assert "must not be treated as normal" in payload["renderedText"]
    assert language.calls == 0


def testNegatedSymptomsAreNotTurnedIntoReportedFindings():
    with TestClient(createApp(Settings(clinicalRuntimeMode="competition"), language=CompetitionLanguage())) as client:
        payload = client.post("/v1/analyze", json=caseFields("Ultrasound shows a fibroid. No urinary frequency. No pain during intercourse.", caseType="detailed")).json()
    assert payload["response"]["responseType"] == "AgentResponse"
    body = " ".join(statement["text"] for statement in payload["response"]["supportedInterpretations"])
    assert "urinary frequency" not in body and "Reported pain during intercourse" not in body


def testAdditionalUnsupportedStructuralFindingIsNotSilentlyOmitted():
    with TestClient(createApp(Settings(clinicalRuntimeMode="competition"), language=CompetitionLanguage())) as client:
        payload = client.post("/v1/analyze", json=caseFields("Ultrasound shows a fibroid and an ovarian mass.", caseType="detailed")).json()
    assert payload["response"]["responseType"] == "EvidenceInsufficient"


def testNoncyclicalBowelSymptomsDoNotBecomeCycleRelatedPain():
    with TestClient(createApp(Settings(clinicalRuntimeMode="competition"), language=CompetitionLanguage())) as client:
        payload = client.post("/v1/analyze", json=caseFields("Ultrasound shows a fibroid. Bowel symptoms are reported without a known temporal pattern.", caseType="detailed")).json()
    assert payload["response"]["responseType"] == "AgentResponse"
    body = " ".join(statement["text"] for statement in payload["response"]["supportedInterpretations"])
    assert "Reported bowel symptoms" in body
    assert "cyclical bowel" not in body and "cycle-related worsening" not in body
