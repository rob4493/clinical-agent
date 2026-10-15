"""Synthetic regressions for the approved predeployment contract migration."""

from datetime import datetime, timezone
from uuid import UUID

import pytest
from pydantic import TypeAdapter, ValidationError

from backend.app.models.contracts import ModuleId
from backend.app.models.input import ClinicalCaseInput
from backend.app.models.module import ClinicalModuleConfig, SourceEntry
from backend.app.models.output import (
    AgentResponse, AuditEvent, AuditSummary, ClarificationRequired, DataConflict,
    DecisionSupportNotice, EvidenceInsufficientResponse, ModuleUnavailable, SelectModuleRequired,
)
from backend.app.models.retrieval import KnowledgeChunk
from backend.app.models.safety import SafetyResult
from tests.unit.testModels import minimalAgentResponse, minimalChunk, minimalSafetyResult, TestClinicalModuleConfig as ConfigFixture


SyntheticUuid = "00000000-0000-4000-8000-000000000003"


def makeEvent(**overrides):
    eventInput = {
        "eventId": SyntheticUuid, "eventType": "analyze_request",
        "moduleId": "module_01_endo", "outcome": "success",
        "timestamp": datetime(2026, 10, 7, tzinfo=timezone.utc),
    }
    eventInput.update(overrides)
    return AuditEvent(**eventInput)


def testSafetyContractHasNoRoutineMessage():
    safetyResult = SafetyResult(**minimalSafetyResult())
    assert set(safetyResult.model_dump()) == {"moduleId", "rulesEvaluated", "warningsTriggered"}
    assert safetyResult.warningsTriggered == []
    moduleConfig = ClinicalModuleConfig(**ConfigFixture().minimalConfig())
    assert "requiredNoTriggerStatement" not in moduleConfig.model_fields
    for modelClass, modelInput, obsoleteField in [
        (SafetyResult, minimalSafetyResult(), "noTriggerStatement"),
        (ClinicalModuleConfig, ConfigFixture().minimalConfig(), "requiredNoTriggerStatement"),
    ]:
        with pytest.raises(ValidationError):
            modelClass(**{**modelInput, obsoleteField: "obsolete output"})


def testTriggeredWarningsRemainFirst():
    warningInput = {"ruleId": "U1", "text": "Synthetic warning fixture", "sourceTags": ["synthetic-source"]}
    response = AgentResponse(**minimalAgentResponse(
        urgentWarnings=[warningInput],
        urgentWarningResult=minimalSafetyResult(warningsTriggered=[warningInput]),
    ))
    assert next(iter(response.model_dump())) == "urgentWarnings"
    assert response.urgentWarnings[0].ruleId.value == "U1"
    assert response.urgentWarnings == response.urgentWarningResult.warningsTriggered
    assert next(reversed(response.model_dump())) == "decisionSupportNotice"


@pytest.mark.parametrize("moduleId", ["module_01_endo", "EndometriosisChronicPelvicPain", "NotSure", "SyntheticFutureModule", "future-module-02", "A" * 64])
def testExtensibleIdentifiers(moduleId):
    assert ClinicalCaseInput(moduleHint=moduleId).moduleHint == moduleId
    assert makeEvent(moduleId=moduleId).moduleId == moduleId
    moduleConfig = ConfigFixture().minimalConfig()
    moduleConfig.update(moduleId=moduleId, moduleHintValue=moduleId)
    assert ClinicalModuleConfig(**moduleConfig).moduleId == moduleId


@pytest.mark.parametrize("invalidId", ["", "A" * 65, "12module", "synthetic case text", " leading", "trailing ", "line\nbreak", "javascript:alert", "../module", None, 12, True])
def testInvalidIdentifierSyntax(invalidId):
    with pytest.raises(ValidationError):
        TypeAdapter(ModuleId).validate_python(invalidId)
    with pytest.raises(ValidationError):
        ClinicalCaseInput(moduleHint=invalidId)


def testExplicitSelectionRequired():
    with pytest.raises(ValidationError):
        ClinicalCaseInput(additionalNotes="cyclical pelvic pain")


@pytest.mark.parametrize("url", ["http://sources.example.invalid/reference", "https://sources.example.invalid/reference"])
def testHttpSourceUrls(url):
    sourceEntry = SourceEntry(org="Synthetic", title="Synthetic source", jurisdiction="Synthetic", url=url)
    assert str(sourceEntry.url) == url
    assert sourceEntry.model_dump(mode="json")["url"] == url


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,synthetic", "file:///synthetic", "ftp://sources.example.invalid/reference", "/relative", "not a URL", "https://", ""])
def testUnsupportedSourceUrlsRejected(url):
    with pytest.raises(ValidationError):
        SourceEntry(org="Synthetic", title="Synthetic source", jurisdiction="Synthetic", url=url)


def testSourceUrlOptional():
    for sourceInput in [{}, {"url": None}]:
        assert SourceEntry(org="Synthetic", title="Synthetic source", jurisdiction="Synthetic", **sourceInput).url is None


def testUuidIdentifiers():
    assert makeEvent().eventId == UUID(SyntheticUuid)
    assert makeEvent().model_dump(mode="json")["eventId"] == SyntheticUuid
    assert KnowledgeChunk(**minimalChunk(chunkId=SyntheticUuid)).chunkId == UUID(SyntheticUuid)
    for modelClass, modelInput, idField in [(AuditEvent, makeEvent().model_dump(), "eventId"), (KnowledgeChunk, minimalChunk(), "chunkId")]:
        with pytest.raises(ValidationError):
            modelClass(**{**modelInput, idField: "synthetic-invalid-id"})


@pytest.mark.parametrize("timestamp", [datetime(2026, 10, 7), "2026-10-07T12:00:00"])
def testNaiveAuditTimestampsRejected(timestamp):
    with pytest.raises(ValidationError):
        makeEvent(timestamp=timestamp)
    summaryInput = {"totalEvents": 0, "byEventType": {}, "byModuleId": {}, "byOutcome": {}, "periodStart": datetime(2026, 10, 7, tzinfo=timezone.utc), "periodEnd": datetime(2026, 10, 7, tzinfo=timezone.utc)}
    for timestampField in ["periodStart", "periodEnd"]:
        with pytest.raises(ValidationError):
            AuditSummary(**{**summaryInput, timestampField: timestamp})


@pytest.mark.parametrize("timestamp", ["2026-10-07T12:00:00Z", "2026-10-07T12:00:00-04:00"])
def testAwareAuditTimestampsAccepted(timestamp):
    assert makeEvent(timestamp=timestamp).timestamp.utcoffset() is not None


@pytest.mark.parametrize("fieldName", ["caseText", "patientName", "patientId", "generatedResponse", "retrievedPassages", "metadata"])
def testAuditRejectsCaseContent(fieldName):
    with pytest.raises(ValidationError):
        AuditEvent(**{**makeEvent().model_dump(), fieldName: "synthetic confidential content"})


@pytest.mark.parametrize("response", [
    SelectModuleRequired(), ModuleUnavailable(moduleHint="SyntheticModule", message="Synthetic unavailable"),
    EvidenceInsufficientResponse(),
    DataConflict(fieldName="pidDiagnosedOrPresumed", structuredValue="False", conflictDescription="Synthetic conflict", clarificationRequest="Clarify PID status?"),
    ClarificationRequired(fieldName="pidDiagnosedOrPresumed", clarificationRequest="Clarify PID status?"),
])
def testHaltResponsesKeepFixedFinalNotice(response):
    assert response.decisionSupportNotice == DecisionSupportNotice
    assert next(reversed(response.model_dump())) == "decisionSupportNotice"
    with pytest.raises(ValidationError):
        type(response)(**{**response.model_dump(), "decisionSupportNotice": "synthetic override"})


@pytest.mark.parametrize("invalidCounts", [
    {"totalEvents": -1}, {"totalEvents": True},
    {"byEventType": {"synthetic clinical content": 1}},
    {"byOutcome": {"synthetic clinical content": 1}},
    {"byModuleId": {"synthetic clinical content": 1}},
    {"byEventType": {"analyze_request": -1}},
])
def testAuditSummaryRejectsNonoperationalMetadata(invalidCounts):
    summaryInput = {"totalEvents": 0, "byEventType": {}, "byModuleId": {}, "byOutcome": {}, "periodStart": datetime(2026, 10, 7, tzinfo=timezone.utc), "periodEnd": datetime(2026, 10, 7, tzinfo=timezone.utc)}
    with pytest.raises(ValidationError):
        AuditSummary(**{**summaryInput, **invalidCounts})
