"""Synthetic privacy regressions; the probe route exists only in tests."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.main import createApp
from backend.app.models.input import ClinicalCaseInput


TextFields = [
    fieldName for fieldName, fieldInfo in ClinicalCaseInput.model_fields.items()
    if fieldName not in {"moduleHint", "caseType", "pregnancyPossible", "pidDiagnosedOrPresumed", "urgentFindings", "earlyPregnancy"}
]


@pytest.mark.parametrize("fieldName", TextFields)
@pytest.mark.parametrize("useAlias", [True, False])
def testAllTextFieldsRejectIdentifiers(fieldName, useAlias):
    fieldInfo = ClinicalCaseInput.model_fields[fieldName]
    inputName = fieldInfo.alias if useAlias else fieldName
    caseInput = {"moduleHint": "NotSure", inputName: "contact synthetic@example.invalid"}
    with pytest.raises(ValidationError) as caught:
        ClinicalCaseInput(**caseInput)
    assert "synthetic@example.invalid" not in str(caught.value)
    assert "synthetic@example.invalid" not in repr(caught.value)
    # Explicitly safe serialization is required by callers of Pydantic errors.
    assert "synthetic@example.invalid" not in str(caught.value.errors(include_input=False, include_context=False))


@pytest.fixture
def privacyClient(minimalSettings):
    testApp = createApp(settings=minimalSettings)

    @testApp.post("/privacy-probe")
    def validateCase(caseInput: ClinicalCaseInput):
        return {"accepted": True}

    return TestClient(testApp)


@pytest.mark.parametrize("caseInput", [
    {"moduleHint": "NotSure", "ageRange": "synthetic@example.invalid"},
    {"moduleHint": "NotSure", "additionalNotes": "synthetic@example.invalid"},
    {"moduleHint": "NotSure", "additionalNotes": "synthetic@example.invalid" + "x" * 2000},
    {"moduleHint": "synthetic@example.invalid"},
    {"moduleHint": "NotSure", "pregnancyPossible": "synthetic@example.invalid"},
    {"moduleHint": "NotSure", "pidDiagnosedOrPresumed": {"synthetic@example.invalid": True}},
    {"moduleHint": "NotSure", "synthetic@example.invalid": "private case text"},
])
def testHttpErrorsOmitSubmittedContent(privacyClient, caseInput, caplog):
    response = privacyClient.post("/privacy-probe", json=caseInput)
    assert response.status_code == 422
    assert "remove patient names" in response.json()["detail"]
    assert "synthetic@example.invalid" not in response.text
    assert "private case text" not in response.text
    assert "synthetic@example.invalid" not in caplog.text


def testMalformedJsonDoesNotEchoBody(privacyClient, caplog):
    response = privacyClient.post("/privacy-probe", content='{"synthetic@example.invalid":', headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert "synthetic@example.invalid" not in response.text + caplog.text


def testValidCaseStillAccepted(privacyClient):
    response = privacyClient.post("/privacy-probe", json={
        "moduleHint": "NotSure", "ageRange": "25-34", "additionalNotes": "cyclical pelvic pain",
        "pregnancyPossible": None, "pidDiagnosedOrPresumed": False,
    })
    assert response.status_code == 200
    assert response.json() == {"accepted": True}


def testProbeAbsentFromApplication(minimalSettings):
    assert "/privacy-probe" not in createApp(settings=minimalSettings).openapi()["paths"]
