"""Competition eligibility is scoped, provenance-bound and independent of authentic approval."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

import pytest
from fastapi.testclient import TestClient

from backend.app.models.input import ClinicalCaseInput
from backend.app.services.cancellation import RequestCancelled, cancellationScope
from backend.competition.earlyPregnancy import EvidenceRoot, readPackage
from tests.unit.testModule02Competition import makeApp, makeCase
from tests.support.competitionLanguage import CompetitionLanguage

Presets = json.loads(Path("frontend/src/PregnancyCases.json").read_text(encoding="utf-8"))
Expected = {"pregBrief": (200, "AgentResponse"), "pregDetailed": (200, "AgentResponse"),
    "pregEmergency": (200, "AgentResponse"), "pregDizziness": (200, "AgentResponse"),
    "pregUnsupported": (503, "EvidenceInsufficient"), "pregConflict": (200, "DataConflict"),
    "pregTesting": (200, "EvidenceInsufficient"), "pregSerial": (200, "AgentResponse"),
    "pregOutside": (200, "OutsideScope"), "pregInjection": (200, "EvidenceInsufficient")}


def presetInput(preset):
    return dict(moduleHint=preset["moduleId"], ageRange=preset["ageRange"], caseType=preset["caseType"],
        pregnancyPossible={"yes": True, "no": False, "unknown": None}[preset["pregnancy"]],
        pidDiagnosedOrPresumed=None, additionalNotes=preset["narrative"], earlyPregnancy=preset["earlyPregnancy"])


@pytest.mark.parametrize("preset", Presets, ids=lambda preset: preset["id"])
def testEveryPresetHasItsIntendedDomainOutcome(preset, caplog):
    with TestClient(makeApp()) as client:
        result = client.post("/v1/analyze", json=presetInput(preset))
    status, outcome = Expected[preset["id"]]
    assert result.status_code == status and result.json()["response"]["responseType"] == outcome
    payload = result.json()
    assert payload["renderedText"].endswith(payload["response"]["decisionSupportNotice"])
    if preset["id"] in {"pregEmergency", "pregDizziness"}:
        assert payload["warnings"] and payload["response"]["supportedInterpretations"] == []
        assert payload["renderedText"].startswith(payload["warnings"][0]["text"])
    if preset["id"] == "pregUnsupported":
        assert "Evidence coverage is insufficient" in payload["renderedText"]
        assert payload["warnings"] == payload["sources"] == []
    if preset["id"] == "pregDizziness":
        assert {source["source"]["sourceId"] for source in payload["sources"]} == {"CDC-MATERNAL-WARNINGS-2024", "CDC-MATERNAL-WARNINGS-POSTER"}
        assert "go to the emergency department" in payload["renderedText"]
    assert "sha256" not in result.text and "sourceFileHash" not in result.text and caplog.text == ""


@pytest.mark.parametrize("narrative,expected", [
    ("Patient is pregnant. Dizziness.", 503),
    ("Possible pregnancy. Ongoing dizziness.", 503),
    ("Patient is pregnant. Ongoing dizziness.", 200),
    ("Patient is pregnant. Dizziness comes and goes over many days.", 200),
    ("Patient is pregnant. Fainting.", 200),
    ("Patient is pregnant. Ongoing dizziness. Healthcare provider cannot be reached.", 200),
])
def testCdcConditionsAndAccessAreNotBroadened(narrative, expected):
    with TestClient(makeApp()) as client:
        result = client.post("/v1/analyze", json=makeCase(additionalNotes=narrative))
    assert result.status_code == expected
    if expected == 200:
        assert bool("go to the emergency department" in result.json()["renderedText"]) == ("cannot be reached" in narrative)
    else:
        assert result.json()["warnings"] == []


def testCompetitionIncludesNoInaccessibleOrAuthenticallyApprovedClaims():
    package = readPackage()
    assert len(package.sources) == 5 and len(package.claims) == 21
    assert all(not source.productionApproved for source in package.sources)
    assert all(not claim.productionApproved for claim in package.claims)
    assert not {"RCOG-EARLYPREG-PAIN-BLEEDING-2025", "ACOG-ECTOPIC-193"}.intersection(source.sourceId for source in package.sources)
    assert all(claim.conditions and claim.limitations and claim.sourceLocation and claim.sourceFileHash for claim in package.claims)


def testNoCrossCaseLeakageDuringConcurrentRequests():
    app = makeApp()
    with TestClient(app) as client:
        def submit(age):
            return client.post("/v1/analyze", json=makeCase(ageRange=age)).json()
        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(submit, ["18-24", "35-44"]))
    assert [result["response"]["reportedFacts"]["ageRange"] for result in results] == ["18-24", "35-44"]


def testCancellationDuringGenerationPublishesNoPartialResponse():
    signal = Event()
    class CancelLanguage(CompetitionLanguage):
        def generate(self, request):
            signal.set()
            return super().generate(request)
    service = makeApp(CancelLanguage()).state.analysis
    with pytest.raises(RequestCancelled):
        with cancellationScope(signal):
            service.analyzeCase(ClinicalCaseInput.model_validate(makeCase()))
    signal.clear()
    service.language = CompetitionLanguage()
    service.early.language = service.language
    with cancellationScope(signal):
        assert service.analyzeCase(ClinicalCaseInput.model_validate(makeCase())).response.responseType == "AgentResponse"


def testFreshProvenanceRejectsMutationAfterGeneration(monkeypatch, caplog):
    import backend.competition.analysis as analysis
    original = analysis.loadPackage
    class StaleLanguage(CompetitionLanguage):
        def generate(self, request):
            result = super().generate(request)
            def unavailable(*arguments, **options):
                raise ValueError("Synthetic private provider payload")
            monkeypatch.setattr(analysis, "loadPackage", unavailable)
            return result
    with TestClient(makeApp(StaleLanguage())) as client:
        result = client.post("/v1/analyze", json=makeCase())
    assert result.json()["response"]["responseType"] == "EvidenceInsufficient"
    assert result.json()["sources"] == [] and "Synthetic private" not in result.text + caplog.text
    monkeypatch.setattr(analysis, "loadPackage", original)



def testDefaultDiscoveryIsCompetitionOnly():
    from backend.app.main import createApp
    from backend.app.config import Settings
    for mode in ["standard", "production", "competition"]:
        with TestClient(createApp(Settings(clinicalRuntimeMode=mode), language=CompetitionLanguage() if mode == "competition" else None)) as client:
            modules = client.get("/v1/modules").json()["modules"]
            if mode == "competition":
                assert {module["moduleId"] for module in modules} == {"module_01_endo", "module_02_early_pregnancy"}
                assert next(module for module in modules if module["moduleId"] == "module_02_early_pregnancy")["displayName"] == "Early Pregnancy Pain and Bleeding"
                assert client.get("/ready").status_code == 200
            else:
                assert modules == [] and client.get("/ready").status_code == 503



def testCombinedScanAndSerialQuestionCoversBothFindings():
    preset = next(preset for preset in Presets if preset["id"] == "pregSerial")
    with TestClient(makeApp()) as client:
        result = client.post("/v1/analyze", json=presetInput(preset))
    body = result.json()["renderedText"]
    assert result.status_code == 200
    assert "Serial serum hCG results do not locate the pregnancy" in body
    assert "An empty uterus on transvaginal ultrasound does not establish ectopic pregnancy by itself" in body
    assert "normal ultrasound" not in body.casefold()
    assert "Viability must not be inferred from these results alone" in body


@pytest.mark.parametrize("testing", ["negative", "indeterminate", None])
def testUnresolvedTestingDoesNotAcquirePositiveTestEvidence(testing):
    payload = makeCase(earlyPregnancy={"gestationalWeeks": 6.0, "pregnancyTestResult": testing,
        "ultrasoundRoute": "transvaginal", "ultrasoundFinding": "noPregnancyVisualized"})
    with TestClient(makeApp()) as client:
        result = client.post("/v1/analyze", json=payload)
    assert result.json()["response"]["responseType"] == "EvidenceInsufficient"
    assert result.json()["sources"] == []


@pytest.mark.parametrize("caseType", ["brief", "detailed"])
def testOrdinarySymptomsBecomeOneGroundedInsight(caseType):
    payload = makeCase(caseType=caseType, additionalNotes="Mild pelvic pain and spotting.",
        earlyPregnancy={"gestationalWeeks": 6.0, "pregnancyTestResult": "positive"})
    with TestClient(makeApp()) as client:
        result = client.post("/v1/analyze", json=payload)
        details = client.get("/v1/competition/sources/NICE-NG126-2026").json()
    body = result.json()
    assert result.status_code == 200
    points = body["response"]["supportedInterpretations"]
    assert len(points) == 1
    assert points[0]["text"] == "Pain or bleeding in early pregnancy may warrant early-pregnancy assessment, but these symptoms alone do not identify the cause or confirm ectopic pregnancy. The urgency of referral depends on the overall clinical presentation."
    assert "UK" not in points[0]["text"] and details["jurisdiction"] == "UK"
    assert len(body["sources"]) == 1 and body["warnings"] == []
    assert body["renderedText"].count("Are there signs of") == 1
    assert body["renderedText"].endswith(body["response"]["decisionSupportNotice"])


@pytest.mark.parametrize("context,narrative", [
    ({"clinicallyStable": True}, "Mild pelvic pain and spotting."),
    ({"heavyBleeding": False}, "Mild pelvic pain and spotting."),
    ({}, "Mild pelvic pain and spotting. No shoulder pain, weakness, dizziness or fainting."),
])
def testReportedUrgentContextDoesNotReceiveTemplateQuestion(context, narrative):
    payload = makeCase(additionalNotes=narrative,
        earlyPregnancy={"gestationalWeeks": 6.0, "pregnancyTestResult": "positive", **context})
    with TestClient(makeApp()) as client:
        body = client.post("/v1/analyze", json=payload).json()
    assert body["response"]["responseType"] == "AgentResponse"
    assert len(body["response"]["supportedInterpretations"]) == 1
    assert "Are there signs of" not in body["renderedText"]


def testConcisePresentationCannotRepairOmittedEvidence():
    class IncompleteLanguage(CompetitionLanguage):
        def generate(self, request):
            result = super().generate(request)
            result["considerations"] = [{"claimIds": ["M2NSymptoms"], "citationNumbers": [1],
                "text": next(claim.supportedStatement for claim in readPackage().claims if claim.claimId == "M2NSymptoms")}]
            return result
    with TestClient(makeApp(IncompleteLanguage())) as client:
        body = client.post("/v1/analyze", json=makeCase(additionalNotes="Mild pelvic pain and spotting.",
            earlyPregnancy={"gestationalWeeks": 6.0})).json()
    assert body["response"]["responseType"] == "EvidenceInsufficient"
    assert body["sources"] == []
    assert "may warrant early-pregnancy assessment" not in body["renderedText"]


@pytest.mark.parametrize("narrative,warning", [
    ("Mild pelvic pain. No shoulder pain, weakness, dizziness or fainting.", False),
    ("Mild pelvic pain. Denies shoulder pain, weakness, dizziness and fainting.", False),
    ("Mild pelvic pain. No shoulder pain, weakness is present.", True),
    ("Mild pelvic pain. No shoulder pain, dizziness or fainting. Weakness is present.", True),
])
def testDeniedSymptomListsPreserveExplicitNegationAndPositiveResets(narrative, warning):
    with TestClient(makeApp()) as client:
        body = client.post("/v1/analyze", json=makeCase(additionalNotes=narrative,
            earlyPregnancy={"gestationalWeeks": 6.0, "pregnancyTestResult": "positive"})).json()
    assert bool(body["warnings"]) is warning
    if warning:
        assert body["response"]["supportedInterpretations"] == []
    else:
        assert body["response"]["responseType"] == "AgentResponse"
        assert len(body["response"]["supportedInterpretations"]) == 1
