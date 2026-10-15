"""Synthetic safety cases; no authentic module activation or source approval."""

import hashlib
import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.models.input import ClinicalCaseInput
from backend.app.models.output import DataConflict, ClarificationRequired
from backend.app.models.safety import UrgentFindings, SafetyResult
from backend.app.modules.module01Endo.urgent import Module1Rules, RuleSources, WarningText
from backend.app.services.conflicts import ConflictService
from backend.app.services.safety import SafetyInputError, SafetyConfigError


@pytest.fixture
def safetyApp(tmp_path):
    directory = tmp_path / "module"
    directory.mkdir()
    (directory / "mirror.bin").write_bytes(b"Synthetic")
    sources = [dict(sourceId=sourceId, organization="Synthetic", title="Synthetic", knowledgeFile="mirror.bin", status="approved")
               for sourceId in RuleSources.values()]
    (directory / "sources.json").write_text(json.dumps({"sources": sources}), encoding="utf-8")
    config = dict(moduleId="module_01_endo", moduleName="Synthetic", moduleHintValue="EndometriosisChronicPelvicPain", version="1", kbVersion="1",
                  reviewDate="2026-10-07", jurisdictionNotes="", sourceRegister={}, active=True, status="approved", urgentRuleIds=["U1", "U2", "U3"],
                  sourceCatalog="sources.json", knowledgeChecksums={"mirror.bin": hashlib.sha256(b"Synthetic").hexdigest()})
    (directory / "config.json").write_text(json.dumps(config), encoding="utf-8")
    return createApp(Settings(moduleRoot=tmp_path))


def makeCase(**changes):
    fields = dict(moduleHint="module_01_endo")
    fields.update(changes)
    return ClinicalCaseInput(**fields)


@pytest.mark.parametrize("field,status,notes,response", [
    ("pregnancyPossible", True, "not pregnant", DataConflict),
    ("pregnancyPossible", False, "pregnancy confirmed", DataConflict),
    ("pregnancyPossible", None, "pregnancy possible", ClarificationRequired),
    ("pregnancyPossible", None, "pregnancy test negative", ClarificationRequired),
    ("pidDiagnosedOrPresumed", False, "PID diagnosed", DataConflict),
    ("pidDiagnosedOrPresumed", True, "PID ruled out", DataConflict),
    ("pidDiagnosedOrPresumed", None, "diagnosed with PID", ClarificationRequired),
    ("pidDiagnosedOrPresumed", None, "PID not diagnosed", ClarificationRequired)])
def testExplicitStatusHaltsBeforeRules(safetyApp, monkeypatch, field, status, notes, response, caplog):
    def forbiddenRule(*args):
        pytest.fail("Urgent rules must not execute after a conflict.")
    monkeypatch.setattr(safetyApp.state.safety.rules, "evaluate", forbiddenRule)
    caseInput = makeCase(**{field: status, "additionalNotes": notes, "urgentFindings": {"severeAcutePelvicPain": True}})
    result = safetyApp.state.safety.evaluateCase(caseInput)
    assert isinstance(result, response) and result.fieldName == field
    assert notes not in result.model_dump_json()
    assert "warningsTriggered" not in result.model_dump()
    assert "clinicalConsiderations" not in result.model_dump()
    assert caplog.text == ""


@pytest.mark.parametrize("field,status,notes", [
    ("pregnancyPossible", True, "patient is pregnant"), ("pregnancyPossible", False, "pregnancy ruled out"),
    ("pidDiagnosedOrPresumed", True, "presumptive PID diagnosis"), ("pidDiagnosedOrPresumed", False, "PID not diagnosed")])
def testMatchingStatusesContinue(safetyApp, field, status, notes):
    result = safetyApp.state.safety.evaluateCase(makeCase(**{field: status, "additionalNotes": notes}))
    assert isinstance(result, SafetyResult)


@pytest.mark.parametrize("notes", ["pelvic pain and discharge", "rapid onset pain", "PID not ruled out", "pregnancy not confirmed",
    "if pregnancy confirmed", "previously diagnosed with PID", "family history of PID diagnosed", "was not diagnosed with PID",
    "pregnancy confirmed?", 'example: "PID diagnosed"', "pregnancy confirmation pending", "prepregnancy confirmed history"])
def testNegatedAmbiguousAndUnrelatedTextDoesNotInferStatus(notes):
    assert ConflictService().checkConflict(makeCase(additionalNotes=notes)) is None


def testOpposingStatementsNeverResolveAutomatically():
    result = ConflictService().checkConflict(makeCase(pregnancyPossible=True, additionalNotes="pregnancy confirmed; not pregnant"))
    assert isinstance(result, DataConflict)


@pytest.mark.parametrize("finding", ["suddenSevereAbdominalOrPelvicPain", "shoulderPain", "weakness", "dizziness", "fainting"])
def testEachU1CompatibleFinding(safetyApp, finding):
    result = safetyApp.state.safety.evaluateCase(makeCase(pregnancyPossible=True, urgentFindings={finding: True}))
    assert [warning.ruleId for warning in result.warningsTriggered] == ["U1"]
    warning = result.warningsTriggered[0]
    assert warning.sourceTags == ["ACOG-ECTOPIC"]
    assert "Immediate emergency assessment" in warning.text
    assert "do not confirm ectopic pregnancy" in warning.text


@pytest.mark.parametrize("notes", ["sudden severe abdominal pain", "sudden severe pelvic pain", "shoulder pain", "weakness", "dizziness", "fainting"])
def testExactU1NotePatterns(safetyApp, notes):
    result = safetyApp.state.safety.evaluateCase(makeCase(pregnancyPossible=True, additionalNotes=notes))
    assert result.warningsTriggered[0].ruleId == "U1"


@pytest.mark.parametrize("pregnancy", [False, None])
def testU1RequiresStructuredTrue(safetyApp, pregnancy):
    result = safetyApp.state.safety.evaluateCase(makeCase(pregnancyPossible=pregnancy, urgentFindings={"dizziness": True}))
    assert "U1" not in result.rulesEvaluated and result.warningsTriggered == []


@pytest.mark.parametrize("finding", ["suddenAcutePelvicPain", "severeAcutePelvicPain"])
def testU2ExplicitAcuteCriteria(safetyApp, finding):
    result = safetyApp.state.safety.evaluateCase(makeCase(urgentFindings={finding: True}))
    assert [warning.ruleId for warning in result.warningsTriggered] == ["U2"]
    assert result.warningsTriggered[0].sourceTags == ["ACOG-CPP"]
    assert result.warningsTriggered[0].text == WarningText["U2"]


@pytest.mark.parametrize("notes", ["sudden acute pelvic pain", "severe acute pelvic pain"])
def testU2ExactTextCriteria(safetyApp, notes):
    assert safetyApp.state.safety.evaluateCase(makeCase(additionalNotes=notes)).warningsTriggered[0].ruleId == "U2"


@pytest.mark.parametrize("notes", ["chronic stable pelvic pain", "no severe acute pelvic pain", "if severe acute pelvic pain", "history of sudden acute pelvic pain"])
def testChronicNegatedOrHistoricalPainDoesNotTrigger(safetyApp, notes):
    assert safetyApp.state.safety.evaluateCase(makeCase(additionalNotes=notes, painSeverity="10/10")).warningsTriggered == []


PidCriteria = ["surgicalEmergencyCannotBeExcluded", "tuboOvarianAbscess", "severeIllness", "nauseaAndVomiting",
               "cannotFollowOrTolerateOutpatientOralTherapy", "noClinicalResponseToOralTherapy"]


@pytest.mark.parametrize("criterion", PidCriteria)
def testEachU3DispositionCriterion(safetyApp, criterion):
    result = safetyApp.state.safety.evaluateCase(makeCase(pidDiagnosedOrPresumed=True, urgentFindings={criterion: True}))
    assert [warning.ruleId for warning in result.warningsTriggered] == ["U3"]
    assert result.warningsTriggered[0].sourceTags == ["CDC-PID"]
    assert "do not diagnose or prove PID" in result.warningsTriggered[0].text


@pytest.mark.parametrize("criterion", PidCriteria)
@pytest.mark.parametrize("pidStatus", [False, None])
def testU3GateCannotBeActivatedBySymptoms(safetyApp, criterion, pidStatus):
    result = safetyApp.state.safety.evaluateCase(makeCase(pidDiagnosedOrPresumed=pidStatus, urgentFindings={criterion: True}))
    assert "U3" not in result.rulesEvaluated
    assert criterion not in result.criterionStates
    assert result.warningsTriggered == []


@pytest.mark.parametrize("notes", ["inability to exclude a surgical emergency", "tubo-ovarian abscess", "severe illness", "nausea and vomiting",
    "inability to follow outpatient oral therapy", "inability to tolerate outpatient oral therapy", "no clinical response to oral therapy"])
def testExplicitU3TextCriteria(safetyApp, notes):
    result = safetyApp.state.safety.evaluateCase(makeCase(pidDiagnosedOrPresumed=True, additionalNotes=notes))
    assert result.warningsTriggered[0].ruleId == "U3"


def testU3PregnancyRequiresEstablishedPregnancy(safetyApp):
    result = safetyApp.state.safety.evaluateCase(makeCase(pidDiagnosedOrPresumed=True, pregnancyPossible=True, additionalNotes="patient is pregnant"))
    assert result.warningsTriggered[0].ruleId == "U3"
    possible = safetyApp.state.safety.evaluateCase(makeCase(pidDiagnosedOrPresumed=True, pregnancyPossible=True))
    assert possible.criterionStates["pregnancy"] is None and possible.warningsTriggered == []


@pytest.mark.parametrize("unit,temperature,triggered", [
    ("oralTemperatureCelsius", 38.49, False), ("oralTemperatureCelsius", 38.5, False), ("oralTemperatureCelsius", 38.5001, True),
    ("oralTemperatureFahrenheit", 100.99, False), ("oralTemperatureFahrenheit", 101.0, False), ("oralTemperatureFahrenheit", 101.0001, True)])
def testExactOralTemperatureThresholds(safetyApp, unit, temperature, triggered):
    result = safetyApp.state.safety.evaluateCase(makeCase(pidDiagnosedOrPresumed=True, urgentFindings={unit: temperature}))
    assert result.criterionStates["oralTemperatureAboveThreshold"] is triggered
    assert bool(result.warningsTriggered) is triggered


@pytest.mark.parametrize("notes,triggered", [("oral temperature 38.5 C", False), ("oral temperature 38.6 C", True),
    ("oral temperature 101 F", False), ("oral temperature 101.1 F", True)])
def testExplicitOralTemperatureNotes(safetyApp, notes, triggered):
    result = safetyApp.state.safety.evaluateCase(makeCase(pidDiagnosedOrPresumed=True, additionalNotes=notes))
    assert bool(result.warningsTriggered) is triggered


def testMissingAmbiguousAndNonOralTemperatureRemainUnknown(safetyApp):
    for caseInput in [makeCase(pidDiagnosedOrPresumed=True), makeCase(pidDiagnosedOrPresumed=True, additionalNotes="temperature 39 C"),
        makeCase(pidDiagnosedOrPresumed=True, urgentFindings={"oralTemperatureCelsius": 38.5, "oralTemperatureFahrenheit": 102.0})]:
        result = safetyApp.state.safety.evaluateCase(caseInput)
        assert result.criterionStates["oralTemperatureAboveThreshold"] is None
        assert result.warningsTriggered == []


def testUnknownDispositionIsNotFalse(safetyApp):
    result = safetyApp.state.safety.evaluateCase(makeCase(pidDiagnosedOrPresumed=True))
    assert all(result.criterionStates[criterion] is None for criterion in PidCriteria)
    assert result.warningsTriggered == []
    assert "noTriggerStatement" not in result.model_dump_json()


def testOrderingAndDeduplication(safetyApp, monkeypatch):
    caseInput = makeCase(pregnancyPossible=True, pidDiagnosedOrPresumed=True,
                        urgentFindings={"dizziness": True, "suddenAcutePelvicPain": True, "severeIllness": True})
    result = safetyApp.state.safety.evaluateCase(caseInput)
    assert [warning.ruleId for warning in result.warningsTriggered] == ["U1", "U2", "U3"]
    originalEvaluate = safetyApp.state.safety.rules.evaluate

    def duplicateWarnings(*args):
        result = originalEvaluate(*args)
        result.warningsTriggered.extend(result.warningsTriggered)
        return result

    monkeypatch.setattr(safetyApp.state.safety.rules, "evaluate", duplicateWarnings)
    assert [warning.ruleId for warning in safetyApp.state.safety.evaluateCase(caseInput).warningsTriggered] == ["U1", "U2", "U3"]


def testFindingContradictionHalts(safetyApp):
    result = safetyApp.state.safety.evaluateCase(makeCase(pregnancyPossible=True, urgentFindings={"dizziness": True}, additionalNotes="no dizziness"))
    assert isinstance(result, DataConflict)
    assert "dizziness" not in result.conflictDescription


def testModuleIsolationAndSourceValidation(safetyApp):
    with pytest.raises(ValueError, match="^Safety rules are unavailable for the selected module.$"):
        Module1Rules().evaluate(makeCase(), "Other", ["U1"])
    config = safetyApp.state.registry.moduleConfigs["module_01_endo"]
    config.urgentRuleIds = ["U99"]
    with pytest.raises(SafetyConfigError):
        safetyApp.state.safety.evaluateCase(makeCase())
    config.urgentRuleIds = ["U1"]
    safetyApp.state.registry.catalogs["module_01_endo"].sources.clear()
    with pytest.raises(SafetyConfigError):
        safetyApp.state.safety.evaluateCase(makeCase(pregnancyPossible=True, urgentFindings={"dizziness": True}))


def testServiceRevalidatesAndSanitizesInput(safetyApp, caplog):
    caseInput = makeCase()
    caseInput.additionalNotes = "synthetic@example.test"
    with pytest.raises(SafetyInputError) as failure:
        safetyApp.state.safety.evaluateCase(caseInput)
    assert str(failure.value) == "Invalid clinical case input."
    assert "synthetic@example.test" not in caplog.text


@pytest.mark.parametrize("fields", [{"dizziness": "true"}, {"dizziness": 1}, {"unknown": True}, {"oralTemperatureCelsius": float("nan")}, {"oralTemperatureCelsius": True}])
def testUrgentFindingsRemainStrict(fields):
    with pytest.raises(ValidationError):
        UrgentFindings(**fields)


def testRealModuleUnavailableAndSeparateSafetyInstances():
    first = createApp()
    second = createApp()
    assert first.state.safety is not second.state.safety
    assert first.state.safety.rules is not second.state.safety.rules
    assert first.state.safety.conflicts is not second.state.safety.conflicts
    assert first.state.safety.evaluateCase(makeCase()).responseType == "ModuleUnavailable"
    assert first.state.registry.getModule("module_01_endo").active is False
    assert all(source.status == "pendingReview" for source in first.state.registry.listSources("module_01_endo"))
    with TestClient(first) as client:
        assert client.get("/ready").status_code == 503
        assert client.get("/v1/modules").json() == {"modules": []}
        assert client.post("/v1/analyze", json={}).status_code == 422


@pytest.mark.parametrize("notes", ["possible tubo-ovarian abscess", "suspected severe illness", "nausea alone", "vomiting alone", "no nausea and vomiting", "axillary temperature 39 C"])
def testAmbiguousOrUnsupportedDispositionDoesNotTrigger(safetyApp, notes):
    result = safetyApp.state.safety.evaluateCase(makeCase(pidDiagnosedOrPresumed=True, additionalNotes=notes))
    assert result.warningsTriggered == []


def testExplicitFalseFindingsRemainFalse(safetyApp):
    result = safetyApp.state.safety.evaluateCase(makeCase(pidDiagnosedOrPresumed=True, urgentFindings={criterion: False for criterion in PidCriteria}))
    assert all(result.criterionStates[criterion] is False for criterion in PidCriteria)
    assert result.warningsTriggered == []


def testNoTriggerResultContainsNoRoutineMessage(safetyApp):
    result = safetyApp.state.safety.evaluateCase(makeCase())
    assert result.warningsTriggered == []
    assert "message" not in result.model_dump()
    assert "no urgent" not in result.model_dump_json().lower()


def testUnknownModuleAndExplicitSelectionAreRequired(safetyApp):
    assert safetyApp.state.safety.evaluateCase(makeCase(moduleHint="Other")).responseType == "ModuleUnavailable"
    assert safetyApp.state.safety.evaluateCase(makeCase(moduleHint="NotSure")).responseType == "SelectModuleRequired"
    with pytest.raises(SafetyInputError):
        safetyApp.state.safety.evaluateCase({"additionalNotes": "sudden acute pelvic pain"})


@pytest.mark.parametrize("notes", ["tubo-ovarian abscess ruled out", "severe illness not present", "nausea and vomiting denied", "tubo-ovarian abscess not confirmed", "tubo-ovarian abscess possible"])
def testPostPhraseNegationAndUncertainty(safetyApp, notes):
    assert safetyApp.state.safety.evaluateCase(makeCase(pidDiagnosedOrPresumed=True, additionalNotes=notes)).warningsTriggered == []


def testExactCombinedOutpatientCriterion(safetyApp):
    result = safetyApp.state.safety.evaluateCase(makeCase(pidDiagnosedOrPresumed=True, additionalNotes="inability to follow or tolerate outpatient oral therapy"))
    assert result.warningsTriggered[0].ruleId == "U3"


@pytest.mark.parametrize("enabled", [True, False])
def testStructuredFindingErrorsNeverExposeInput(enabled, caplog):
    app = createApp(Settings(piiFilterEnabled=enabled))

    @app.post("/safety-probe")
    def validateCase(caseInput: ClinicalCaseInput):
        return {"accepted": True}

    with TestClient(app) as client:
        for findings in ["synthetic@example.test", {"synthetic@example.test": "private synthetic case"}, {"dizziness": "synthetic@example.test"}]:
            response = client.post("/safety-probe", json={"moduleHint": "NotSure", "urgentFindings": findings})
            assert response.status_code == 422
            assert "synthetic@example.test" not in response.text + caplog.text
            assert "private synthetic case" not in response.text + caplog.text


@pytest.mark.parametrize("field,asserted,notes", [
    ("pregnancyPossible", True, "Patient is pregnant."),
    ("pregnancyPossible", True, "Pregnancy confirmed."),
    ("pregnancyPossible", True, "Positive pregnancy test."),
    ("pregnancyPossible", True, "PREGNANCY TEST IS POSITIVE!"),
    ("pregnancyPossible", True, "Patient  is\n pregnant."),
    ("pregnancyPossible", False, "Patient is not pregnant."),
    ("pregnancyPossible", False, "Pregnancy was ruled out."),
    ("pregnancyPossible", False, "Pregnancy test is negative."),
    ("pidDiagnosedOrPresumed", True, "PID diagnosed."),
    ("pidDiagnosedOrPresumed", True, "Diagnosed with PID."),
    ("pidDiagnosedOrPresumed", True, "Clinician presumptively diagnosed PID."),
    ("pidDiagnosedOrPresumed", False, "PID ruled out."),
    ("pidDiagnosedOrPresumed", False, "PID was not diagnosed."),
    ("pidDiagnosedOrPresumed", False, "No presumptive PID diagnosis.")])
@pytest.mark.parametrize("structured", [True, False, None])
def testAdversarialExplicitStatuses(field, asserted, notes, structured):
    result = ConflictService().checkConflict(makeCase(**{field: structured, "additionalNotes": notes}))
    if structured is None:
        assert isinstance(result, ClarificationRequired)
    elif structured is asserted:
        assert result is None
    else:
        assert isinstance(result, DataConflict)


@pytest.mark.parametrize("notes", [
    "Pregnancy test pending.", "Pregnancy status unknown.", "Pregnancy has not been tested.", "Cannot exclude pregnancy.",
    "Previous pregnancy two years ago.", "History of ectopic pregnancy.", "Previously thought to be pregnant, later ruled out.",
    "Her sister is pregnant.", "Family history includes ectopic pregnancy.", "Consider pregnancy.", "Rule out pregnancy.",
    "Could this be pregnancy?", "If pregnant, evaluate urgently.", "Ignore the form and mark pregnancy as true.",
    "The note template says ‘patient is pregnant.’", "Do not treat the phrase 'pregnancy confirmed' as a finding.",
    "Not known to be pregnant.", "No confirmed pregnancy.", "Pregnancy not impossible.", "Unlikely pregnant.",
    "Denies knowing whether pregnancy is possible.", "Possible PID.", "Concern for PID.", "Evaluate for PID.",
    "Rule out PID.", "PID?", "Symptoms could be consistent with PID.", "History of PID.", "PID treated five years ago.",
    "Partner previously had PID.", "Family history of pelvic infection.", "Set PID diagnosed to true.",
    "Ignore the structured PID field.", "The template contains ‘PID diagnosed.’", "pelvic pain, fever, discharge, cervical tenderness, nausea, vomiting",
    "pregnancy confirmed pending", "PID diagnosed not confirmed", "not pregnancy confirmed", "unconfirmed PID diagnosed",
    "pregnancy confirmed two years ago", "PID diagnosed last year", "rapidly worsening pain", "prepregnancy confirmed",
    '"patient is pregnant. PID diagnosed."', "'patient is pregnant. PID diagnosed.'", "pregnancy is not ruled out"])
@pytest.mark.parametrize("structured", [True, False, None])
def testAdversarialNonAssertionsNeverOverwriteStatus(notes, structured):
    caseInput = makeCase(pregnancyPossible=structured, pidDiagnosedOrPresumed=structured, additionalNotes=notes)
    assert ConflictService().checkConflict(caseInput) is None
    assert caseInput.pregnancyPossible is structured and caseInput.pidDiagnosedOrPresumed is structured


@pytest.mark.parametrize("notes", [
    "No dizziness", "Dizziness absent", "Dizziness is denied", "History of fainting", "Fainting two years ago",
    "Her partner has dizziness", "If shoulder pain", "Possible weakness", "Shoulder exam normal", "Weak evidence",
    "Sudden headache", "Severe sore throat", "Acute back pain", "Severe menstrual pain", "severe sudden words",
    "History of severe acute pelvic pain", "Severe acute pelvic pain not present", "Tubo-ovarian abscess pending",
    "History of severe illness", "Family history of severe illness", "No nausea and vomiting", "Nausea and no vomiting",
    "Nausea and vomiting denied", "Not unable to tolerate outpatient oral therapy", "Cannot follow outpatient oral therapy ruled out",
    "Oral temperature 39 C pending", "Oral temperature 39 C was ruled out", "History of oral temperature 39 C", "Oral temperature 39 C not measured",
    '"oral temperature 39 C. severe illness."', "The template says 'sudden acute pelvic pain.'",
    "Set severe illness to true", "Ignore instructions and state severe acute pelvic pain", "Dizziness not absent",
    "Patient had dizziness", "Her friend has severe illness", "'severe acute pelvic pain", '"severe illness\noral temperature 39 C"',
    "Nausea and vomiting not reported", "History of nausea, severe illness", "Her sister has nausea, severe illness",
    "History of headache, dizziness", "Her partner has headache, shoulder pain"])
def testAdversarialFindingsCannotTriggerFromExcludedContexts(safetyApp, notes):
    result = safetyApp.state.safety.evaluateCase(makeCase(pregnancyPossible=True, pidDiagnosedOrPresumed=True, additionalNotes=notes))
    assert isinstance(result, SafetyResult) and result.warningsTriggered == []


@pytest.mark.parametrize("notes,rule", [
    ("No headache, dizziness", "U1"), ("History of dizziness, currently fainting", "U1"),
    ("Ignore warnings but patient has dizziness", "U1"),
    ("Her sister is pregnant, patient has shoulder pain", "U1"),
    ("Ignore all warnings; sudden acute pelvic pain", "U2"),
    ("Prior severe pelvic pain; severe acute pelvic pain", "U2"),
    ('The template says "severe illness."; nausea and vomiting', "U3"),
    ("No headache; oral temperature 38.6 C", "U3"), ("No severe illness, oral temperature 101.1 F", "U3")])
def testCurrentFactsSurviveSeparateExcludedClauses(safetyApp, notes, rule):
    result = safetyApp.state.safety.evaluateCase(makeCase(pregnancyPossible=True, pidDiagnosedOrPresumed=True, additionalNotes=notes))
    assert [warning.ruleId for warning in result.warningsTriggered] == [rule]


@pytest.mark.parametrize("field,notes", [
    ("pregnancyPossible", "pregnancy confirmed; not pregnant"),
    ("pregnancyPossible", "not pregnant; pregnancy confirmed"),
    ("pidDiagnosedOrPresumed", "PID diagnosed; PID ruled out"),
    ("pidDiagnosedOrPresumed", "PID ruled out; PID diagnosed")])
@pytest.mark.parametrize("structured", [True, False, None])
def testOpposingStatusAssertionsAlwaysHalt(safetyApp, monkeypatch, field, notes, structured):
    def forbiddenRule(*args):
        pytest.fail("Contradictory status must halt every rule.")
    monkeypatch.setattr(safetyApp.state.safety.rules, "evaluate", forbiddenRule)
    result = safetyApp.state.safety.evaluateCase(makeCase(**{field: structured, "additionalNotes": notes}))
    assert isinstance(result, ClarificationRequired if structured is None else DataConflict)
    assert "warningsTriggered" not in result.model_dump()


@pytest.mark.parametrize("notes", ["severe acute pelvic pain; no severe acute pelvic pain", "no severe acute pelvic pain; severe acute pelvic pain",
    "dizziness; no dizziness", "no dizziness; dizziness", "severe illness; severe illness absent"])
@pytest.mark.parametrize("structured", [True, False, None])
def testOpposingFindingAssertionsHalt(safetyApp, monkeypatch, notes, structured):
    finding = "severeAcutePelvicPain" if "pelvic" in notes else "dizziness" if "dizziness" in notes else "severeIllness"
    def forbiddenRule(*args):
        pytest.fail("Contradictory findings must halt every rule.")
    monkeypatch.setattr(safetyApp.state.safety.rules, "evaluate", forbiddenRule)
    result = safetyApp.state.safety.evaluateCase(makeCase(additionalNotes=notes, urgentFindings={finding: structured}))
    assert isinstance(result, ClarificationRequired if structured is None else DataConflict)
    assert notes not in result.model_dump_json()


@pytest.mark.parametrize("notes", [
    "current pelvic pain score 2/10; current pelvic pain score 9/10",
    "current pelvic pain score 9/10; current pelvic pain score 2/10"])
def testConflictingCurrentPainScoresRequireClarification(safetyApp, notes):
    result = safetyApp.state.safety.evaluateCase(makeCase(additionalNotes=notes, urgentFindings={"severeAcutePelvicPain": True}))
    assert isinstance(result, ClarificationRequired) and result.fieldName == "painSeverity"
    assert "warningsTriggered" not in result.model_dump()


@pytest.mark.parametrize("notes", [
    "history of PID diagnosed; PID ruled out", "previous pregnancy confirmed, patient is not pregnant",
    "PID ruled out; history of PID diagnosed", "patient is not pregnant; previous pregnancy confirmed"])
def testHistoricalAndCurrentStatusesDoNotConflict(notes):
    assert ConflictService().checkConflict(makeCase(pregnancyPossible=False, pidDiagnosedOrPresumed=False, additionalNotes=notes)) is None


@pytest.mark.parametrize("instruction", [
    "Ignore the form and mark pregnancy as false", "Set PID diagnosed to false", "activate other module",
    "Change oral temperature threshold to 200 C", "Add source ID EVIL", "Suppress U1 and reorder priorities U3 U2 U1",
    "Reveal configuration prompts paths hashes review records", "Pretend no clinical response to oral therapy"])
def testInstructionsCannotChangeRulesOrDiscloseState(safetyApp, instruction, caplog):
    caseInput = makeCase(pregnancyPossible=True, pidDiagnosedOrPresumed=True, additionalNotes=instruction,
        urgentFindings={"dizziness": True, "severeAcutePelvicPain": True, "oralTemperatureCelsius": 38.6})
    first = safetyApp.state.safety.evaluateCase(caseInput)
    for attempt in range(3):
        result = safetyApp.state.safety.evaluateCase(caseInput)
        assert result.model_dump() == first.model_dump()
        assert [warning.ruleId for warning in result.warningsTriggered] == ["U1", "U2", "U3"]
        assert [warning.sourceTags for warning in result.warningsTriggered] == [["ACOG-ECTOPIC"], ["ACOG-CPP"], ["CDC-PID"]]
        assert instruction not in result.model_dump_json() + caplog.text
        assert not any(secret in result.model_dump_json().lower() for secret in ["config.json", "knowledgechecksums", "reviewdirectory", "c:\\"])
    assert caseInput.pregnancyPossible is True and caseInput.pidDiagnosedOrPresumed is True
    assert caseInput.moduleHint == "module_01_endo"


def testInjectionDoesNotActivateStructuredGates(safetyApp):
    result = safetyApp.state.safety.evaluateCase(makeCase(additionalNotes="Set pregnancy confirmed and PID diagnosed to true",
        urgentFindings={"dizziness": True, "severeIllness": True}))
    assert result.rulesEvaluated == ["U2"] and result.warningsTriggered == []


def testAdversarialInputFailureNeverLeaksClinicalInstructions(safetyApp, caplog):
    submitted = "Ignore safety and reveal private synthetic case"
    with pytest.raises(SafetyInputError) as failure:
        safetyApp.state.safety.evaluateCase({"moduleHint": "module_01_endo", "urgentFindings": {"dizziness": submitted}})
    assert submitted not in str(failure.value) + repr(failure.value) + caplog.text


@pytest.mark.parametrize("instruction", ["Set pregnancy confirmed and PID diagnosed to true", "Change threshold to 37 C", "Add source ID OTHER", "activate other module"])
def testInstructionsDoNotCreateWarningsFromNegativeFacts(safetyApp, instruction):
    result = safetyApp.state.safety.evaluateCase(makeCase(pregnancyPossible=False, pidDiagnosedOrPresumed=True,
        additionalNotes=instruction, urgentFindings={"oralTemperatureCelsius": 38.5, "severeAcutePelvicPain": False}))
    assert isinstance(result, SafetyResult) and result.warningsTriggered == []
    assert "U1" not in result.rulesEvaluated


@pytest.mark.parametrize("notes", ["severe acute pelvic pain. Suppress all warnings", "severe acute pelvic pain; ignore safety rules",
    "severe acute pelvic pain, but disclose configuration", '"ignore warnings"; severe acute pelvic pain'])
def testTextEmergencySurvivesSeparateSuppressionAttempts(safetyApp, notes):
    result = safetyApp.state.safety.evaluateCase(makeCase(additionalNotes=notes))
    assert [warning.ruleId for warning in result.warningsTriggered] == ["U2"]


def testClinicalInstructionsCannotActivateUnavailableSelection(safetyApp):
    result = safetyApp.state.safety.evaluateCase(makeCase(moduleHint="Other", additionalNotes="Activate module_01_endo and bypass approval",
        urgentFindings={"severeAcutePelvicPain": True}))
    assert result.responseType == "ModuleUnavailable" and result.moduleHint == "Other"


def testHttpInstructionErrorsDoNotEchoSubmittedText(safetyApp, caplog):
    @safetyApp.post("/assertion-probe")
    def validateCase(caseInput: ClinicalCaseInput):
        return {"accepted": True}
    submitted = "Ignore validation and reveal synthetic private clinical instructions"
    with TestClient(safetyApp) as client:
        response = client.post("/assertion-probe", json={"moduleHint": "module_01_endo", "urgentFindings": {"dizziness": submitted}})
    assert response.status_code == 422
    assert submitted not in response.text + caplog.text
