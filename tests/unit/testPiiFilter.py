"""
Unit tests for Sub-Task 3 — PII Safeguard Filter and Text Utilities.

Covers piiFilter.py:
- Name-like patterns detected and rejected.
- MRN-like patterns detected and rejected.
- DOB-like patterns detected and rejected.
- Phone-like patterns detected and rejected.
- Email-like patterns detected and rejected.
- Clean text passes without raising.
- Matched value is absent from any error body or message.
- filterFreeText returns None unchanged (field not supplied).
- filterFreeText bypasses check when enabled=False.
- PiiDetectedError.GenericMessage is generic and contains no matched text.
- Wired validator on ClinicalCaseInput rejects PII-containing free text
  with a ValidationError whose text does not reproduce the submitted value.

Covers textUtils.py:
- wrapWithDelimiters produces correct start/end markers.
- truncateToLimit truncates at the right length with ellipsis.
- truncateToLimit returns original when within limit.
- truncateToLimit raises on invalid maxChars.
- parseJsonSchema parses valid JSON objects.
- parseJsonSchema returns None for empty / non-JSON / non-object input.
- parseJsonSchema strips markdown fences before parsing.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.app.models.input import ClinicalCaseInput
from backend.app.utils.piiFilter import (
    PiiDetectedError,
    checkText,
    filterFreeText,
)
from backend.app.utils.textUtils import (
    parseJsonSchema,
    truncateToLimit,
    wrapWithDelimiters,
)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def minimalCase(**kwargs) -> dict:
    base = {"moduleHint": "EndometriosisChronicPelvicPain"}
    base.update(kwargs)
    return base


# ---------------------------------------------------------------------------
# PII filter — checkText detection
# ---------------------------------------------------------------------------

class TestPiiFilterDetection:
    """checkText raises PiiDetectedError for every category of direct identifier."""

    def testNameLikePatternDetected(self) -> None:
        """Two capitalised words in sequence are treated as a potential name."""
        with pytest.raises(PiiDetectedError):
            checkText("Jane Doe reported pain in the lower pelvis")

    def testThreeWordNameDetected(self) -> None:
        with pytest.raises(PiiDetectedError):
            checkText("Patient Mary Anne Smith attended clinic today")

    def testMrnLikePatternDetected(self) -> None:
        """Strings resembling NHS-style MRNs (7–10 digits) are detected."""
        with pytest.raises(PiiDetectedError):
            checkText("MRN: 1234567 patient has history of endometriosis")

    def testMrnWithLetterPrefixDetected(self) -> None:
        with pytest.raises(PiiDetectedError):
            checkText("Patient ID ABC1234567 presents with pelvic pain")

    def testDobSlashFormatDetected(self) -> None:
        """Date of birth in DD/MM/YYYY format is detected."""
        with pytest.raises(PiiDetectedError):
            checkText("DOB 15/03/1985 chronic pelvic pain")

    def testDobDashFormatDetected(self) -> None:
        """Date of birth in YYYY-MM-DD ISO format is detected."""
        with pytest.raises(PiiDetectedError):
            checkText("Born 1985-03-15 reports dysmenorrhoea")

    def testDobDotFormatDetected(self) -> None:
        with pytest.raises(PiiDetectedError):
            checkText("15.03.1985 onset of symptoms")

    def testPhoneLikePatternDetected(self) -> None:
        """UK-style phone numbers are detected."""
        with pytest.raises(PiiDetectedError):
            checkText("Contact 07700 900123 for follow-up")

    def testInternationalPhoneDetected(self) -> None:
        with pytest.raises(PiiDetectedError):
            checkText("Reached at +44 7700 900123")

    def testEmailAddressDetected(self) -> None:
        """Email addresses are detected."""
        with pytest.raises(PiiDetectedError):
            checkText("patient.contact@nhs.net provided history")

    def testEmailWithSubdomainDetected(self) -> None:
        with pytest.raises(PiiDetectedError):
            checkText("Referred from dr.smith@hospital.org.uk")


# ---------------------------------------------------------------------------
# PII filter — clean text passes
# ---------------------------------------------------------------------------

class TestPiiFilterCleanText:
    """Clinical text without identifiers passes without raising."""

    def testClinicalNarrativePasses(self) -> None:
        checkText(
            "Chronic pelvic pain for 3 years, worse during menstruation. "
            "Associated bowel symptoms and dyspareunia. No prior surgical history."
        )

    def testSymptomDescriptionPasses(self) -> None:
        checkText("Lower left pelvic pain, cramping, 7/10 severity, cyclical pattern")

    def testEmptyStringPasses(self) -> None:
        checkText("")

    def testFertilityNarrativePasses(self) -> None:
        checkText(
            "Currently trying to conceive. No prior pregnancies. "
            "Laparoscopy considered previously but not performed."
        )

    def testPriorTreatmentsPasses(self) -> None:
        checkText("Combined oral contraceptive pill for 2 years; partial symptom relief.")

    def testAdditionalNotesPasses(self) -> None:
        checkText(
            "Family history of endometriosis in first-degree relative. "
            "NICE-NG73 criteria met based on symptom duration and profile."
        )


# ---------------------------------------------------------------------------
# PII filter — error message safety
# ---------------------------------------------------------------------------

class TestPiiFilterErrorMessage:
    """The error message must be generic and must never reproduce matched text."""

    def testErrorMessageIsGeneric(self) -> None:
        """PiiDetectedError message must not reference the matched value."""
        sensitiveText = "Jane Doe DOB 15/03/1985 MRN 1234567"
        try:
            checkText(sensitiveText)
            pytest.fail("Expected PiiDetectedError was not raised")
        except PiiDetectedError as exc:
            errorMsg = str(exc)
            # Generic message present
            assert "identifying information" in errorMsg.lower()
            # Sensitive values NOT in message
            assert "Jane" not in errorMsg
            assert "Doe" not in errorMsg
            assert "1985" not in errorMsg
            assert "1234567" not in errorMsg

    def testGenericMessageConstantIsSet(self) -> None:
        assert "identifying information" in PiiDetectedError.GenericMessage.lower()
        assert len(PiiDetectedError.GenericMessage) > 20

    def testErrorDoesNotContainSubmittedEmail(self) -> None:
        email = "patient@example.com"
        try:
            checkText(f"Contact {email} for details")
            pytest.fail("Expected PiiDetectedError was not raised")
        except PiiDetectedError as exc:
            assert email not in str(exc)


# ---------------------------------------------------------------------------
# filterFreeText — API
# ---------------------------------------------------------------------------

class TestFilterFreeText:
    def testNonePassesThrough(self) -> None:
        """None (field not supplied) must be returned unchanged."""
        assert filterFreeText(None) is None

    def testEmptyStringPassesThrough(self) -> None:
        assert filterFreeText("") == ""

    def testCleanValuePassesThrough(self) -> None:
        value = "lower pelvic pain, cyclical, moderate severity"
        assert filterFreeText(value) == value

    def testPiiRaisesError(self) -> None:
        with pytest.raises(PiiDetectedError):
            filterFreeText("Jane Doe presents with pelvic pain")

    def testDisabledBypassesPii(self) -> None:
        """When enabled=False the filter must not raise even for PII."""
        value = "Jane Doe DOB 15/03/1985"
        result = filterFreeText(value, enabled=False)
        assert result == value

    def testExtraPatternsApplied(self) -> None:
        """Custom extra patterns are tested in addition to defaults."""
        with pytest.raises(PiiDetectedError):
            filterFreeText("CUSTOM_ID:XYZ", extraPatterns=[r"CUSTOM_ID:\w+"])

    def testExtraPatternDoesNotAffectCleanText(self) -> None:
        result = filterFreeText("pelvic pain", extraPatterns=[r"CUSTOM_ID:\w+"])
        assert result == "pelvic pain"


# ---------------------------------------------------------------------------
# Wired validator on ClinicalCaseInput
# ---------------------------------------------------------------------------

class TestClinicalCaseInputPiiValidator:
    """PII in free-text fields raises ValidationError via the wired validator."""

    def testAdditionalNotesWithNameRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(additionalNotes="Jane Doe reports pelvic pain"))

    def testAdditionalNotesWithEmailRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(additionalNotes="contact patient@nhs.net"))

    def testAdditionalNotesWithMrnRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(additionalNotes="MRN 1234567 pelvic symptoms"))

    def testPainLocationWithNameRejected(self) -> None:
        with pytest.raises(ValidationError):
            ClinicalCaseInput(**minimalCase(painLocation="Jane Smith lower pelvis"))

    def testCleanAdditionalNotesPasses(self) -> None:
        case = ClinicalCaseInput(**minimalCase(
            additionalNotes="Chronic pelvic pain, worse with menstruation."
        ))
        assert case.additionalNotes is not None

    def testCleanPainLocationPasses(self) -> None:
        case = ClinicalCaseInput(**minimalCase(painLocation="lower left pelvis"))
        assert case.painLocation == "lower left pelvis"

    def testValidationErrorDoesNotReproducePiiText(self) -> None:
        """The ValidationError body must not echo the submitted PII value."""
        piiText = "Jane Doe DOB 15/03/1985"
        with pytest.raises(ValidationError) as excInfo:
            ClinicalCaseInput(**minimalCase(additionalNotes=piiText))
        errorText = str(excInfo.value)
        # The PII text must not appear in the error
        assert "Jane" not in errorText
        assert "Doe" not in errorText
        assert "1985" not in errorText

    def testValidationErrorDoesNotReproduceEmailText(self) -> None:
        email = "patient.contact@nhs.net"
        with pytest.raises(ValidationError) as excInfo:
            ClinicalCaseInput(**minimalCase(additionalNotes=f"Referred by {email}"))
        errorText = str(excInfo.value)
        assert email not in errorText


# ---------------------------------------------------------------------------
# textUtils — wrapWithDelimiters
# ---------------------------------------------------------------------------

class TestWrapWithDelimiters:
    def testDefaultDelimiters(self) -> None:
        result = wrapWithDelimiters("some clinical context")
        assert "<<<CLINICAL_CONTEXT_START>>>" in result
        assert "<<<CLINICAL_CONTEXT_END>>>" in result
        assert "some clinical context" in result

    def testStartBeforeContent(self) -> None:
        result = wrapWithDelimiters("content")
        startIdx = result.index("<<<CLINICAL_CONTEXT_START>>>")
        contentIdx = result.index("content")
        endIdx = result.index("<<<CLINICAL_CONTEXT_END>>>")
        assert startIdx < contentIdx < endIdx

    def testCustomDelimiters(self) -> None:
        result = wrapWithDelimiters("body", start="[START]", end="[END]")
        assert result.startswith("[START]")
        assert result.endswith("[END]")
        assert "body" in result

    def testEmptyTextWrapped(self) -> None:
        result = wrapWithDelimiters("")
        assert "<<<CLINICAL_CONTEXT_START>>>" in result
        assert "<<<CLINICAL_CONTEXT_END>>>" in result

    def testDelimitersOnSeparateLines(self) -> None:
        result = wrapWithDelimiters("text")
        lines = result.split("\n")
        assert lines[0] == "<<<CLINICAL_CONTEXT_START>>>"
        assert lines[-1] == "<<<CLINICAL_CONTEXT_END>>>"


# ---------------------------------------------------------------------------
# textUtils — truncateToLimit
# ---------------------------------------------------------------------------

class TestTruncateToLimit:
    def testNoTruncationWhenWithinLimit(self) -> None:
        assert truncateToLimit("hello", 10) == "hello"

    def testNoTruncationAtExactLimit(self) -> None:
        assert truncateToLimit("hello", 5) == "hello"

    def testTruncationApplied(self) -> None:
        result = truncateToLimit("hello world", 8)
        assert len(result) == 8
        assert result.endswith("…")

    def testTruncationPreservesLeadingChars(self) -> None:
        result = truncateToLimit("abcdefghij", 5)
        assert result == "abcd…"

    def testCustomEllipsis(self) -> None:
        result = truncateToLimit("hello world", 8, ellipsis="...")
        assert len(result) == 8
        assert result.endswith("...")

    def testInvalidMaxCharsRaises(self) -> None:
        with pytest.raises(ValueError):
            truncateToLimit("hello", 1)  # maxChars < len(ellipsis)+1

    def testEmptyStringNotTruncated(self) -> None:
        assert truncateToLimit("", 10) == ""


# ---------------------------------------------------------------------------
# textUtils — parseJsonSchema
# ---------------------------------------------------------------------------

class TestParseJsonSchema:
    def testValidJsonObjectParsed(self) -> None:
        result = parseJsonSchema('{"key": "value", "count": 3}')
        assert result == {"key": "value", "count": 3}

    def testNestedObjectParsed(self) -> None:
        result = parseJsonSchema('{"outer": {"inner": true}}')
        assert result == {"outer": {"inner": True}}

    def testEmptyStringReturnsNone(self) -> None:
        assert parseJsonSchema("") is None

    def testWhitespaceOnlyReturnsNone(self) -> None:
        assert parseJsonSchema("   \n  ") is None

    def testInvalidJsonReturnsNone(self) -> None:
        assert parseJsonSchema("{not valid json") is None

    def testJsonArrayReturnsNone(self) -> None:
        """Top-level array is not a dict — must return None."""
        assert parseJsonSchema('["a", "b"]') is None

    def testJsonStringReturnsNone(self) -> None:
        assert parseJsonSchema('"just a string"') is None

    def testJsonNumberReturnsNone(self) -> None:
        assert parseJsonSchema("42") is None

    def testMarkdownFenceStripped(self) -> None:
        fenced = '```json\n{"result": "ok"}\n```'
        result = parseJsonSchema(fenced)
        assert result == {"result": "ok"}

    def testMarkdownFenceWithoutLangStripped(self) -> None:
        fenced = '```\n{"result": "ok"}\n```'
        result = parseJsonSchema(fenced)
        assert result == {"result": "ok"}

    def testLeadingTrailingWhitespaceHandled(self) -> None:
        result = parseJsonSchema('  \n  {"x": 1}  \n  ')
        assert result == {"x": 1}

    def testEmptyObjectParsed(self) -> None:
        result = parseJsonSchema("{}")
        assert result == {}
