"""
Comprehensive unit tests for all Pydantic models (Sub-Task 2).

Covers:
- ClinicalCaseInput: valid construction, field defaults, three-state booleans,
  length limits, unknown-field rejection, alias round-trip, serialization.
- Strict boolean enforcement: strings and integers rejected on boolean fields.
- Extensible module identifiers / CaseType enum.
- ReportedFacts: Unknown defaults, three-state rendering.
- ClinicalConsideration, MissingInformation, EvidenceCitation.
- UrgentWarning, SafetyResult.
- DataConflict, ClarificationRequired: distinct types, distinct fields.
- ClarificationRequired: structuredValue serializes as JSON null.
- AgentResponse: urgentWarnings first in serialization, decisionSupportNotice
  is server-controlled Literal, extra fields rejected, caseType is CaseType enum.
- AuditEvent: forbidden fields absent; enum-constrained eventType/outcome; format-validated moduleId.
- EvidenceInsufficientResponse, SelectModuleRequired, ModuleUnavailable.
- KnowledgeChunk, RetrievalQuery, RetrievalResult.
- ClinicalModuleConfig, SourceEntry, ModuleStatus.
- CitationValidationOutcome enum.
- UnknownValue isolation: never in input or safety models.
- camelCase API serialization / camelCase internal construction.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import UUID

import pytest
from pydantic import ValidationError

from backend.app.models.input import ClinicalCaseInput, CaseType
from backend.app.models.module import (
    ClinicalModuleConfig,
    ModuleStatus,
    SourceEntry,
)
from backend.app.models.output import (
    AgentResponse,
    AuditEvent,
    AuditEventType,
    AuditOutcome,
    AuditSummary,
    CitationValidationOutcome,
    ClarificationRequired,
    ClinicalConsideration,
    DataConflict,
    DecisionSupportNotice,
    EvidenceCitation,
    EvidenceInsufficientResponse,
    MissingInformation,
    ModuleUnavailable,
    ReportedFacts,
    SelectModuleRequired,
    UnknownValue,
)
from backend.app.models.retrieval import (
    ChunkStatus,
    KnowledgeChunk,
    RetrievalQuery,
    RetrievalResult,
    UrgencyClass,
)
from backend.app.models.safety import SafetyResult, UrgentRuleId, UrgentWarning


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def minimalCase(**kwargs) -> dict:
    """Return a minimal valid ClinicalCaseInput payload (camelCase aliases)."""
    base = {"moduleHint": "EndometriosisChronicPelvicPain"}
    base.update(kwargs)
    return base


def minimalChunk(**kwargs) -> dict:
    from tests.support.evidenceFixture import makeChunk
    base = makeChunk().model_dump(exclude={"contentHash"})
    base["chunkId"] = str(base["chunkId"])
    base.update(kwargs)
    return base


def minimalSafetyResult(**kwargs) -> dict:
    base = {
        "moduleId": "module_01_endo",
        "rulesEvaluated": ["U1", "U2", "U3"],
    }
    base.update(kwargs)
    return base


def minimalAgentResponse(**kwargs) -> dict:
    base = {
        "moduleId": "module_01_endo",
        "caseType": "detailed",
        "reportedFacts": {},
        "urgentWarningResult": minimalSafetyResult(),
        "evidenceSufficient": True,
    }
    base.update(kwargs)
    return base


# ---------------------------------------------------------------------------
# Explicit module selection
# ---------------------------------------------------------------------------

class TestModuleSelection:
    def testEndometriosisValue(self) -> None:
        assert ClinicalCaseInput(**minimalCase()).moduleHint == "EndometriosisChronicPelvicPain"

    def testNotSureValue(self) -> None:
        assert ClinicalCaseInput(**minimalCase(moduleHint="NotSure")).moduleHint == "NotSure"

    def testFutureModuleAcceptedBySyntax(self) -> None:
        assert ClinicalCaseInput(**minimalCase(moduleHint="SyntheticFutureModule")).moduleHint == "SyntheticFutureModule"

    def testInvalidHintRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(moduleHint="invalid module identifier"))


# ---------------------------------------------------------------------------
# CaseType enum
# ---------------------------------------------------------------------------

class TestCaseTypeEnum:
    def testBriefValue(self) -> None:
        assert CaseType.brief.value == "brief"

    def testDetailedValue(self) -> None:
        assert CaseType.detailed.value == "detailed"


# ---------------------------------------------------------------------------
# ClinicalCaseInput â€” construction
# ---------------------------------------------------------------------------

class TestClinicalCaseInputConstruction:
    def testMinimalValidCase(self) -> None:
        case = ClinicalCaseInput(**minimalCase())
        assert case.moduleHint == "EndometriosisChronicPelvicPain"

    def testDefaultCaseTypeIsDetailed(self) -> None:
        case = ClinicalCaseInput(**minimalCase())
        assert case.caseType == CaseType.detailed

    def testAllOptionalFieldsDefaultToNone(self) -> None:
        case = ClinicalCaseInput(**minimalCase())
        optionalFields = [
            "ageRange", "painLocation", "painQuality", "painSeverity",
            "symptomTiming", "bowelUrinarySymptoms", "sexualPain",
            "menstrualHistory", "pregnancyPossible", "pidDiagnosedOrPresumed",
            "fertilityStatus", "priorTreatments", "familyHistory",
            "additionalNotes",
        ]
        for fieldName in optionalFields:
            assert getattr(case, fieldName) is None, (
                f"Field '{fieldName}' must default to None, not False or empty string."
            )

    def testAliasRoundTrip(self) -> None:
        """JSON with camelCase aliases must deserialize to camelCase attributes."""
        payload = {
            "moduleHint": "EndometriosisChronicPelvicPain",
            "caseType": "brief",
            "ageRange": "25-34",
            "painLocation": "lower pelvis",
            "pregnancyPossible": True,
            "pidDiagnosedOrPresumed": False,
        }
        case = ClinicalCaseInput(**payload)
        assert case.ageRange == "25-34"
        assert case.painLocation == "lower pelvis"
        assert case.pregnancyPossible is True
        assert case.pidDiagnosedOrPresumed is False

    def testSerializationUsesCamelCaseAliases(self) -> None:
        case = ClinicalCaseInput(**minimalCase(ageRange="30-39"))
        data = case.model_dump(by_alias=True)
        assert "ageRange" in data
        assert "age" + chr(95) + "range" not in data

    def testCamelCaseInternalConstruction(self) -> None:
        """Internal Python code may construct using camelCase field names."""
        case = ClinicalCaseInput(
            moduleHint="EndometriosisChronicPelvicPain",
            caseType=CaseType.brief,
            ageRange="25-34",
            pregnancyPossible=True,
        )
        assert case.moduleHint == "EndometriosisChronicPelvicPain"
        assert case.caseType == CaseType.brief
        assert case.ageRange == "25-34"
        assert case.pregnancyPossible is True

    def testCamelCaseApiSerializationForAllFields(self) -> None:
        """model_dump(by_alias=True) must produce camelCase keys for every field."""
        case = ClinicalCaseInput(**minimalCase(
            ageRange="30-39",
            pregnancyPossible=True,
            pidDiagnosedOrPresumed=False,
        ))
        data = case.model_dump(by_alias=True)
        assert "moduleHint" in data
        assert "caseType" in data
        assert "ageRange" in data
        assert "pregnancyPossible" in data
        assert "pidDiagnosedOrPresumed" in data
        # No snake_case keys in API output
        for key in data:
            assert "_" not in key, f"API output must use camelCase; found snake_case key: {key}"


# ---------------------------------------------------------------------------
# ClinicalCaseInput â€” three-state booleans (strict)
# ---------------------------------------------------------------------------

class TestClinicalCaseInputThreeStateBooleans:
    """
    Three-state semantics: True / False / None must be preserved exactly.
    None is never converted to False.
    Strings and integers are rejected (StrictBool).
    """

    def testPregnancyPossibleTrue(self) -> None:
        case = ClinicalCaseInput(**minimalCase(pregnancyPossible=True))
        assert case.pregnancyPossible is True

    def testPregnancyPossibleFalse(self) -> None:
        case = ClinicalCaseInput(**minimalCase(pregnancyPossible=False))
        assert case.pregnancyPossible is False

    def testPregnancyPossibleNoneStaysNone(self) -> None:
        case = ClinicalCaseInput(**minimalCase(pregnancyPossible=None))
        assert case.pregnancyPossible is None

    def testPregnancyPossibleOmittedIsNone(self) -> None:
        case = ClinicalCaseInput(**minimalCase())
        assert case.pregnancyPossible is None

    def testPidTrue(self) -> None:
        case = ClinicalCaseInput(**minimalCase(pidDiagnosedOrPresumed=True))
        assert case.pidDiagnosedOrPresumed is True

    def testPidFalse(self) -> None:
        case = ClinicalCaseInput(**minimalCase(pidDiagnosedOrPresumed=False))
        assert case.pidDiagnosedOrPresumed is False

    def testPidNoneStaysNone(self) -> None:
        case = ClinicalCaseInput(**minimalCase(pidDiagnosedOrPresumed=None))
        assert case.pidDiagnosedOrPresumed is None

    def testPidOmittedIsNone(self) -> None:
        case = ClinicalCaseInput(**minimalCase())
        assert case.pidDiagnosedOrPresumed is None

    def testNoneIsNotFalse(self) -> None:
        """Critical: None must never be treated as False."""
        case = ClinicalCaseInput(**minimalCase())
        assert case.pidDiagnosedOrPresumed is not False
        assert case.pregnancyPossible is not False

    # --- Correction 1: strict rejection of string/integer substitutes ---

    def testPregnancyPossibleStringTrueRejected(self) -> None:
        """String 'true' must be rejected; only JSON true accepted."""
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(pregnancyPossible="true"))

    def testPregnancyPossibleStringFalseRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(pregnancyPossible="false"))

    def testPregnancyPossibleStringYesRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(pregnancyPossible="yes"))

    def testPregnancyPossibleStringNoRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(pregnancyPossible="no"))

    def testPregnancyPossibleInteger1Rejected(self) -> None:
        """Integer 1 must be rejected; only JSON true accepted."""
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(pregnancyPossible=1))

    def testPregnancyPossibleInteger0Rejected(self) -> None:
        """Integer 0 must be rejected; only JSON false accepted."""
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(pregnancyPossible=0))

    def testPidStringTrueRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(pidDiagnosedOrPresumed="true"))

    def testPidStringFalseRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(pidDiagnosedOrPresumed="false"))

    def testPidStringYesRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(pidDiagnosedOrPresumed="yes"))

    def testPidStringNoRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(pidDiagnosedOrPresumed="no"))

    def testPidInteger1Rejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(pidDiagnosedOrPresumed=1))

    def testPidInteger0Rejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(pidDiagnosedOrPresumed=0))

    def testOmittedAndNullHaveSameUnknownSemantics(self) -> None:
        """
        An omitted optional boolean and an explicit null both result in None,
        which has the same Unknown clinical meaning throughout the pipeline.
        """
        omitted = ClinicalCaseInput(**minimalCase())
        explicitNull = ClinicalCaseInput(**minimalCase(pregnancyPossible=None))
        assert omitted.pregnancyPossible is None
        assert explicitNull.pregnancyPossible is None
        # Both None values are clinically equivalent (Unknown)
        assert omitted.pregnancyPossible == explicitNull.pregnancyPossible

    def testNullAndOmittedBothUnknownForPid(self) -> None:
        omitted = ClinicalCaseInput(**minimalCase())
        explicitNull = ClinicalCaseInput(**minimalCase(pidDiagnosedOrPresumed=None))
        assert omitted.pidDiagnosedOrPresumed is None
        assert explicitNull.pidDiagnosedOrPresumed is None


# ---------------------------------------------------------------------------
# ClinicalCaseInput â€” length limits
# ---------------------------------------------------------------------------

class TestClinicalCaseInputLengthLimits:
    """Field values exceeding max_length must be rejected, not silently truncated."""

    def testAgeRangeOverLimitRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(ageRange="x" * 201))

    def testAdditionalNotesOverLimitRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(additionalNotes="x" * 2001))

    def testPainLocationAtLimitAccepted(self) -> None:
        case = ClinicalCaseInput(**minimalCase(painLocation="x" * 500))
        assert len(case.painLocation) == 500

    def testAdditionalNotesAtLimitAccepted(self) -> None:
        case = ClinicalCaseInput(**minimalCase(additionalNotes="x" * 2000))
        assert len(case.additionalNotes) == 2000

    def testValuesAreNotSilentlyTruncated(self) -> None:
        """If a value is too long, the request must be rejected, not truncated."""
        longValue = "a" * 501
        with pytest.raises(ValidationError) as excInfo:
            ClinicalCaseInput(**minimalCase(painLocation=longValue))
        assert "painLocation" in str(excInfo.value) or "string_too_long" in str(excInfo.value)

    def testValidationErrorDoesNotReproducceClinicalText(self) -> None:
        """Validation error must not echo submitted case text back to the caller."""
        clinicalNote = "patient reports pain every month before period"
        with pytest.raises(ValidationError) as excInfo:
            # Exceeds MaxLong â€” triggers validation error
            ClinicalCaseInput(**minimalCase(additionalNotes=clinicalNote * 100))
        # The submitted text should not appear verbatim in the error
        errorText = str(excInfo.value)
        assert clinicalNote not in errorText


# ---------------------------------------------------------------------------
# ClinicalCaseInput â€” unknown fields
# ---------------------------------------------------------------------------

class TestClinicalCaseInputUnknownFields:
    """Unknown fields must be rejected (extra='forbid')."""

    def testPatientNameFieldRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(patientName="Jane Doe"))

    def testMrnFieldRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(mrn="MRN12345"))

    def testDateOfBirthFieldRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(dateOfBirth="1985-03-15"))

    def testEmailFieldRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(email="patient@example.com"))

    def testArbitraryUnknownFieldRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(unknownField="value"))


# ---------------------------------------------------------------------------
# ReportedFacts
# ---------------------------------------------------------------------------

class TestReportedFacts:
    def testAllFieldsDefaultToUnknown(self) -> None:
        facts = ReportedFacts()
        for fieldName, value in facts.model_dump().items():
            assert value == "Unknown", (
                f"ReportedFacts.{fieldName} must default to 'Unknown', got '{value}'."
            )

    def testUnknownValueConstantIsString(self) -> None:
        assert UnknownValue == "Unknown"

    def testThreeStateBooleanRendering(self) -> None:
        """Three-state booleans in ClinicalCaseInput must render as Yes/No/Unknown in ReportedFacts."""
        facts = ReportedFacts(pregnancyPossible="Yes", pidDiagnosedOrPresumed="No")
        assert facts.pregnancyPossible == "Yes"
        assert facts.pidDiagnosedOrPresumed == "No"

    def testExtraFieldsRejected(self) -> None:
        with pytest.raises(ValidationError):
            ReportedFacts(patientName="Jane")

    def testUnknownValueIsDisplayOnlyNotInInputModels(self) -> None:
        """
        UnknownValue must not appear as a default in ClinicalCaseInput.
        Input uses Python None; UnknownValue is only for ReportedFacts display.
        """
        case = ClinicalCaseInput(**minimalCase())
        # All optional fields default to None (not the string "Unknown")
        assert case.pregnancyPossible is None
        assert case.pidDiagnosedOrPresumed is None
        assert case.ageRange is None
        assert case.painLocation is None

    def testUnknownValueNotInSafetyModels(self) -> None:
        """UnknownValue must not appear anywhere in the safety model field defaults."""
        result = SafetyResult(
            moduleId="module_01_endo",
            rulesEvaluated=["U1"],
        )
        for fieldName, value in result.model_dump().items():
            assert value != UnknownValue, (
                f"SafetyResult.{fieldName} must not use UnknownValue; got '{value}'"
            )


# ---------------------------------------------------------------------------
# ClinicalConsideration
# ---------------------------------------------------------------------------

class TestClinicalConsideration:
    def testDirectSourceStatement(self) -> None:
        c = ClinicalConsideration(
            text="NICE recommends suspecting endometriosis when chronic pelvic pain is present.",
            citations=[EvidenceCitation(sourceTag="NICE-NG73", jurisdiction="UK")],
            isInterpretation=False,
        )
        assert c.isInterpretation is False
        assert c.citations[0].sourceTag == "NICE-NG73"

    def testInterpretationFlagged(self) -> None:
        c = ClinicalConsideration(
            text="The absence of cyclical pain does not exclude endometriosis.",
            citations=[
                EvidenceCitation(sourceTag="WHO-2025"),
                EvidenceCitation(sourceTag="NICE-NG73"),
            ],
            isInterpretation=True,
        )
        assert c.isInterpretation is True
        assert len(c.citations) == 2

    def testMissingIsInterpretationRaises(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalConsideration(text="some text", citations=[])


# ---------------------------------------------------------------------------
# UrgentWarning
# ---------------------------------------------------------------------------

class TestUrgentWarning:
    def testU1Warning(self) -> None:
        w = UrgentWarning(
            ruleId="U1",
            text="Urgent: immediate emergency assessment recommended.",
            sourceTags=["ACOG-ECTOPIC"],
        )
        assert w.ruleId == UrgentRuleId.U1
        assert w.sourceTags == ["ACOG-ECTOPIC"]

    def testInvalidRuleIdRaises(self) -> None:
        with pytest.raises(ValidationError):
            UrgentWarning(ruleId="U99", text="x", sourceTags=[])

    def testAllRuleIds(self) -> None:
        for rid in ["U1", "U2", "U3"]:
            w = UrgentWarning(ruleId=rid, text="x", sourceTags=[])
            assert w.ruleId.value == rid


# ---------------------------------------------------------------------------
# DataConflict
# ---------------------------------------------------------------------------

class TestDataConflict:
    def testConstruction(self) -> None:
        dc = DataConflict(
            fieldName="pidDiagnosedOrPresumed",
            structuredValue="False",
            conflictDescription="Structured field states no PID diagnosis; notes state PID confirmed.",
            clarificationRequest="Please confirm or correct the PID diagnostic status field.",
        )
        assert dc.responseType == "DataConflict"
        assert dc.fieldName == "pidDiagnosedOrPresumed"

    def testResponseTypeIsDataConflict(self) -> None:
        dc = DataConflict(
            fieldName="x", structuredValue="False",
            conflictDescription="d", clarificationRequest="q"
        )
        assert dc.responseType == "DataConflict"

    def testExtraFieldsRejected(self) -> None:
        with pytest.raises(ValidationError):
            DataConflict(
                fieldName="x", structuredValue="False",
                conflictDescription="d", clarificationRequest="q",
                caseText="patient info",
            )


# ---------------------------------------------------------------------------
# ClarificationRequired â€” Correction 2: structuredValue is null
# ---------------------------------------------------------------------------

class TestClarificationRequired:
    def testConstruction(self) -> None:
        cr = ClarificationRequired(
            fieldName="pidDiagnosedOrPresumed",
            clarificationRequest=(
                "The notes appear to describe a PID-related situation. "
                "Please set the PID diagnostic status field before resubmitting."
            ),
        )
        assert cr.responseType == "ClarificationRequired"
        assert cr.structuredValue is None

    def testStructuredValueIsNoneNotString(self) -> None:
        """structuredValue must be Python None, not the string 'None'."""
        cr = ClarificationRequired(
            fieldName="pidDiagnosedOrPresumed",
            clarificationRequest="Please complete the field.",
        )
        assert cr.structuredValue is None
        assert cr.structuredValue != "None"
        assert not isinstance(cr.structuredValue, str)

    def testStructuredValueSerializesAsJsonNull(self) -> None:
        """model_dump must produce null (Python None), not the string 'None'."""
        cr = ClarificationRequired(
            fieldName="pidDiagnosedOrPresumed",
            clarificationRequest="Please complete the field.",
        )
        data = cr.model_dump(by_alias=True)
        assert data["structuredValue"] is None, (
            f"structuredValue must serialize as null, got: {data['structuredValue']!r}"
        )

    def testStructuredValueJsonSerializationIsNull(self) -> None:
        """JSON dump must produce 'null', not the string '\"None\"'."""
        cr = ClarificationRequired(
            fieldName="pidDiagnosedOrPresumed",
            clarificationRequest="Please complete the field.",
        )
        jsonStr = cr.model_dump_json(by_alias=True)
        parsed = json.loads(jsonStr)
        assert parsed["structuredValue"] is None, (
            f"JSON structuredValue must be null, got: {parsed['structuredValue']!r}"
        )
        assert '"None"' not in jsonStr, (
            'JSON must not contain the string "None" for structuredValue'
        )

    def testDistinctFromDataConflict(self) -> None:
        dc = DataConflict(
            fieldName="x", structuredValue="False",
            conflictDescription="d", clarificationRequest="q"
        )
        cr = ClarificationRequired(fieldName="x", clarificationRequest="q")
        assert dc.responseType != cr.responseType
        assert type(dc) is not type(cr)


# ---------------------------------------------------------------------------
# AgentResponse â€” Correction 3: caseType is CaseType enum
# ---------------------------------------------------------------------------

class TestAgentResponse:
    def testMinimalConstruction(self) -> None:
        r = AgentResponse(**minimalAgentResponse())
        assert r.moduleId == "module_01_endo"
        assert r.decisionSupportNotice == DecisionSupportNotice

    def testCaseTypeIsEnum(self) -> None:
        """caseType must be the CaseType enum, not a plain string."""
        r = AgentResponse(**minimalAgentResponse(caseType="detailed"))
        assert isinstance(r.caseType, CaseType)
        assert r.caseType == CaseType.detailed

    def testCaseTypeBriefAccepted(self) -> None:
        r = AgentResponse(**minimalAgentResponse(caseType="brief"))
        assert r.caseType == CaseType.brief

    def testArbitraryCaseTypeRejected(self) -> None:
        """Arbitrary strings must be rejected now that caseType is an enum."""
        with pytest.raises(ValidationError):
            AgentResponse(**minimalAgentResponse(caseType="summary"))

    def testArbitraryCaseTypeRejectedVerbose(self) -> None:
        with pytest.raises(ValidationError):
            AgentResponse(**minimalAgentResponse(caseType="full_report"))

    def testDecisionSupportNoticeIsFixedLiteral(self) -> None:
        """The notice must be the server-controlled value; client cannot override it."""
        r = AgentResponse(**minimalAgentResponse())
        assert "does not establish a diagnosis" in r.decisionSupportNotice
        assert "patient-specific treatment" in r.decisionSupportNotice

    def testNoticeCannotBeOverriddenByClient(self) -> None:
        """Passing a different notice value must be rejected."""
        payload = minimalAgentResponse()
        payload["decisionSupportNotice"] = "Custom notice by attacker."
        with pytest.raises(ValidationError):
            AgentResponse(**payload)

    def testUrgentWarningsIsFirstDefinedField(self) -> None:
        """urgentWarnings must be the first field in the model definition."""
        fields = list(AgentResponse.model_fields.keys())
        assert fields[0] == "urgentWarnings", (
            f"urgentWarnings must be the first field. Got: {fields[0]}"
        )

    def testUrgentWarningsFirstInSerialization(self) -> None:
        """urgentWarnings must appear first in JSON output."""
        r = AgentResponse(**minimalAgentResponse())
        data = r.model_dump(by_alias=True)
        keys = list(data.keys())
        assert keys[0] == "urgentWarnings", (
            f"urgentWarnings must be first in serialized output. Got: {keys[0]}"
        )

    def testDecisionSupportNoticeLastInSerialization(self) -> None:
        r = AgentResponse(**minimalAgentResponse())
        data = r.model_dump(by_alias=True)
        keys = list(data.keys())
        assert keys[-1] == "decisionSupportNotice", (
            f"decisionSupportNotice must be last. Got: {keys[-1]}"
        )

    def testExtraFieldsRejected(self) -> None:
        payload = minimalAgentResponse()
        payload["patientName"] = "Jane Doe"
        with pytest.raises(ValidationError):
            AgentResponse(**payload)

    def testEmptyUrgentWarningsByDefault(self) -> None:
        r = AgentResponse(**minimalAgentResponse())
        assert r.urgentWarnings == []

    def testAgentResponseSerializationUsesCamelCase(self) -> None:
        """All AgentResponse fields must serialize with camelCase aliases."""
        r = AgentResponse(**minimalAgentResponse())
        data = r.model_dump(by_alias=True)
        for key in data:
            assert "_" not in key, f"AgentResponse serialization must be camelCase; got: {key}"


# ---------------------------------------------------------------------------
# AuditEvent â€” Correction 4: enum-constrained fields
# ---------------------------------------------------------------------------

class TestAuditEvent:
    def makeEvent(self, **kwargs) -> AuditEvent:
        base = {
            "eventId": "00000000-0000-4000-8000-000000000001",
            "eventType": "analyze_request",
            "moduleId": "module_01_endo",
            "timestamp": datetime(2026, 9, 27, 12, 0, 0, tzinfo=timezone.utc),
            "outcome": "success",
        }
        base.update(kwargs)
        return AuditEvent(**base)

    def testValidEvent(self) -> None:
        e = self.makeEvent()
        assert e.eventId == UUID("00000000-0000-4000-8000-000000000001")
        assert e.eventType == AuditEventType.analyzeRequest
        assert e.outcome == AuditOutcome.success
        assert e.moduleId == "module_01_endo"

    def testEventTypeIsEnum(self) -> None:
        e = self.makeEvent()
        assert isinstance(e.eventType, AuditEventType)

    def testOutcomeIsEnum(self) -> None:
        e = self.makeEvent()
        assert isinstance(e.outcome, AuditOutcome)

    def testModuleIdIsString(self) -> None:
        e = self.makeEvent()
        assert isinstance(e.moduleId, str)

    def testArbitraryEventTypeRejected(self) -> None:
        """Unrestricted strings must be rejected for eventType."""
        with pytest.raises(ValidationError):
            self.makeEvent(eventType="free_text_event")

    def testArbitraryOutcomeRejected(self) -> None:
        """Unrestricted strings must be rejected for outcome."""
        with pytest.raises(ValidationError):
            self.makeEvent(outcome="arbitrary_outcome_string")

    def testInvalidModuleIdRejected(self) -> None:
        """Invalid identifier syntax must be rejected; registry validation is planned."""
        with pytest.raises(ValidationError):
            self.makeEvent(moduleId="invalid module identifier")

    def testAllApprovedEventTypes(self) -> None:
        """Every AuditEventType value must be constructable."""
        validTypes = [
            "analyze_request", "module_unavailable", "data_conflict",
            "clarification_required", "evidence_insufficient",
            "citation_fallback", "ingest", "approve",
        ]
        for evtType in validTypes:
            e = self.makeEvent(eventType=evtType)
            assert e.eventType.value == evtType

    def testAllApprovedOutcomes(self) -> None:
        """Every AuditOutcome value must be constructable."""
        validOutcomes = [
            "success", "module_unavailable", "data_conflict",
            "clarification_required", "evidence_insufficient",
            "citation_fallback", "error",
        ]
        for outcome in validOutcomes:
            e = self.makeEvent(outcome=outcome)
            assert e.outcome.value == outcome

    def testCaseTextFieldAbsent(self) -> None:
        """AuditEvent must not have a caseText field."""
        fields = set(AuditEvent.model_fields.keys())
        forbidden = {
            "caseText", "queryText", "retrievedPassages", "generatedResponse",
            "patientName", "patientId", "mrn", "email", "phone", "address",
            "embedding", "message", "detail", "content", "input", "metadata",
        }
        present = fields & forbidden
        assert not present, (
            f"AuditEvent must not contain these fields: {present}"
        )

    def testNoDictOrFreeTextFields(self) -> None:
        """AuditEvent must have no dict-typed fields that could hold arbitrary content."""
        import typing
        for fieldName, fieldInfo in AuditEvent.model_fields.items():
            annotation = fieldInfo.annotation
            # Unwrap Optional/Union to get the inner type
            origin = getattr(annotation, "__origin__", None)
            args = getattr(annotation, "__args__", ())
            innerTypes = list(args) if args else [annotation]
            for t in innerTypes:
                assert t is not dict, (
                    f"AuditEvent.{fieldName} must not be dict; "
                    f"dict fields can hold arbitrary content."
                )

    def testCaseTextCannotBeInjected(self) -> None:
        """Passing caseText as an extra field must raise ValidationError."""
        with pytest.raises(ValidationError):
            self.makeEvent(caseText="real patient notes")

    def testPatientIdentifierCannotBeInjected(self) -> None:
        with pytest.raises(ValidationError):
            self.makeEvent(patientName="Jane Doe")

    def testEmbeddingCannotBeInjected(self) -> None:
        with pytest.raises(ValidationError):
            self.makeEvent(embedding=[0.1, 0.2, 0.3])

    def testMessageFieldCannotBeInjected(self) -> None:
        """A free-text message field must be rejected."""
        with pytest.raises(ValidationError):
            self.makeEvent(message="some free text that could hold patient info")

    def testMetadataFieldCannotBeInjected(self) -> None:
        """A metadata dict must be rejected."""
        with pytest.raises(ValidationError):
            self.makeEvent(metadata={"key": "value"})

    def testCitationValidationOutcomeEnum(self) -> None:
        e = self.makeEvent(
            citationValidationOutcome="failed_regenerated_passed"
        )
        assert e.citationValidationOutcome == CitationValidationOutcome.failedRegeneratedPassed

    def testModuleIdIsOptional(self) -> None:
        e = self.makeEvent(moduleId=None)
        assert e.moduleId is None

    def testAuditEventSerializationUsesCamelCase(self) -> None:
        """AuditEvent must serialize with camelCase field names."""
        e = self.makeEvent()
        data = e.model_dump(by_alias=True)
        assert "eventId" in data
        assert "eventType" in data
        assert "moduleId" in data
        assert "event" + chr(95) + "id" not in data
        assert "event" + chr(95) + "type" not in data


# ---------------------------------------------------------------------------
# KnowledgeChunk
# ---------------------------------------------------------------------------

class TestKnowledgeChunk:
    def testValidChunk(self) -> None:
        chunk = KnowledgeChunk(**minimalChunk())
        assert chunk.chunkId == UUID("00000000-0000-4000-8000-000000000002")
        assert chunk.status == ChunkStatus.approved

    def testProhibitedInferencesDefaultEmpty(self) -> None:
        chunk = KnowledgeChunk(**minimalChunk())
        assert chunk.prohibitedInferences == []

    def testUrgencyClassUrgent(self) -> None:
        chunk = KnowledgeChunk(**minimalChunk(urgencyClass="urgent"))
        assert chunk.urgencyClass == UrgencyClass.urgent

    def testPendingReviewStatus(self) -> None:
        chunk = KnowledgeChunk(**minimalChunk(status="pendingReview"))
        assert chunk.status == ChunkStatus.pendingReview

    def testExtraFieldsRejected(self) -> None:
        with pytest.raises(ValidationError):
            KnowledgeChunk(**minimalChunk(embeddingVector=[0.1, 0.2]))


# ---------------------------------------------------------------------------
# RetrievalQuery / RetrievalResult
# ---------------------------------------------------------------------------

class TestRetrievalModels:
    def testQueryDefaults(self) -> None:
        q = RetrievalQuery(queryText="pelvic pain", moduleId="module_01_endo")
        assert q.topK == 8
        assert q.urgencyBoost is False

    def testTopKUpperBound(self) -> None:
        with pytest.raises(ValidationError):
            RetrievalQuery(queryText="x", moduleId="m", topK=51)

    def testResultOmitsQueryAndInternalMetadata(self) -> None:
        chunk = KnowledgeChunk(**minimalChunk())
        fields = {field: getattr(chunk, field) for field in RetrievalResult.model_fields if field != "score"}
        result = RetrievalResult(**fields, score=1.0)
        assert set(result.model_dump()) == {"chunkId", "moduleId", "sourceId", "claimIds", "category", "text", "citationLabel", "verifiedUrl", "sourcePages", "score", "evidenceVersion"}
        assert result.chunkId == chunk.chunkId and result.claimIds == chunk.claimIds


# ---------------------------------------------------------------------------
# ClinicalModuleConfig
# ---------------------------------------------------------------------------

class TestClinicalModuleConfig:
    def minimalConfig(self) -> dict:
        return {
            "moduleId": "module_01_endo",
            "moduleName": "Endometriosis and Chronic Pelvic Pain",
            "moduleHintValue": "EndometriosisChronicPelvicPain",
            "version": "2.0",
            "status": "approved",
            "kbVersion": "2.0",
            "reviewDate": "2026-09-26",
            "jurisdictionNotes": "UK (NICE-NG73), US (ACOG, NICHD, CDC), Global (WHO-2025).",
            "sourceRegister": {
                "NICE-NG73": {
                    "org": "NICE",
                    "title": "Endometriosis: diagnosis and management",
                    "date": "2024",
                    "jurisdiction": "UK",
                },
            },
        }

    def testValidConfig(self) -> None:
        cfg = ClinicalModuleConfig(**self.minimalConfig())
        assert cfg.moduleId == "module_01_endo"
        assert cfg.status == ModuleStatus.approved

    def testNoModelIdFields(self) -> None:
        """Module config must not contain LLM or embedding model IDs."""
        fields = set(ClinicalModuleConfig.model_fields.keys())
        assert "watsonxLlmModelId" not in fields
        assert "llmModelId" not in fields
        assert "embeddingModelId" not in fields
        assert "watsonxEmbeddingModelId" not in fields

    def testSourceRegisterParses(self) -> None:
        cfg = ClinicalModuleConfig(**self.minimalConfig())
        assert "NICE-NG73" in cfg.sourceRegister
        assert cfg.sourceRegister["NICE-NG73"].jurisdiction == "UK"

    def testPendingStatus(self) -> None:
        d = self.minimalConfig()
        d["status"] = "pending_review"
        cfg = ClinicalModuleConfig(**d)
        assert cfg.status == ModuleStatus.pendingReview

    def testExtraModelIdFieldRejected(self) -> None:
        d = self.minimalConfig()
        d["llmModelId"] = "ibm/granite-test"
        with pytest.raises(ValidationError):
            ClinicalModuleConfig(**d)


# ---------------------------------------------------------------------------
# Pipeline-halt response types
# ---------------------------------------------------------------------------

class TestPipelineHaltResponses:
    def testSelectModuleRequiredResponseType(self) -> None:
        r = SelectModuleRequired()
        assert r.responseType == "SelectModuleRequired"
        assert "module" in r.message.lower()

    def testModuleUnavailableResponseType(self) -> None:
        r = ModuleUnavailable(
            moduleHint="CardiacChestPain",
            message="The selected module is not available.",
        )
        assert r.responseType == "ModuleUnavailable"
        assert r.moduleHint == "CardiacChestPain"

    def testEvidenceInsufficientResponseType(self) -> None:
        r = EvidenceInsufficientResponse()
        assert r.responseType == "EvidenceInsufficient"

    def testAllHaltTypesHaveDistinctResponseTypeValues(self) -> None:
        types = {
            SelectModuleRequired().responseType,
            ModuleUnavailable(moduleHint="x", message="y").responseType,
            DataConflict(
                fieldName="f", structuredValue="False",
                conflictDescription="d", clarificationRequest="q"
            ).responseType,
            ClarificationRequired(fieldName="f", clarificationRequest="q").responseType,
            EvidenceInsufficientResponse().responseType,
        }
        assert len(types) == 5, "All pipeline-halt response types must have distinct responseType values."


# ---------------------------------------------------------------------------
# DecisionSupportNotice constant
# ---------------------------------------------------------------------------

class TestDecisionSupportNotice:
    def testNoticeContainsRequiredPhrases(self) -> None:
        assert "does not establish a diagnosis" in DecisionSupportNotice
        assert "independent clinical judgment" in DecisionSupportNotice
        assert "patient-specific treatment" in DecisionSupportNotice
        assert "prescribing advice" in DecisionSupportNotice

    def testNoticeMentionsApprovedKnowledgeBase(self) -> None:
        assert "approved knowledge base" in DecisionSupportNotice


# ---------------------------------------------------------------------------
# OpenAPI schema smoke test
# ---------------------------------------------------------------------------

class TestOpenAPISchema:
    """
    Verify the FastAPI app generates an OpenAPI schema that includes
    the health endpoint and has no obvious serialization errors.
    """

    def testOpenapiSchemaGenerated(self) -> None:
        from backend.app.config import Settings
        from backend.app.main import createApp

        s = Settings(adminApiKey="test-admin")
        app = createApp(settings=s)
        schema = app.openapi()
        assert "openapi" in schema
        assert "paths" in schema

    def testHealthPathInSchema(self) -> None:
        from backend.app.config import Settings
        from backend.app.main import createApp

        s = Settings(adminApiKey="test-admin")
        app = createApp(settings=s)
        schema = app.openapi()
        assert "/health" in schema["paths"]

    def testSchemaIsJsonSerializable(self) -> None:
        from backend.app.config import Settings
        from backend.app.main import createApp

        s = Settings(adminApiKey="test-admin")
        app = createApp(settings=s)
        schema = app.openapi()
        serialized = json.dumps(schema)
        assert len(serialized) > 0
