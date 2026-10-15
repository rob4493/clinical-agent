"""Synthetic regressions for secret boundaries and request-local configuration."""

import logging
import traceback
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError

from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.models.input import ClinicalCaseInput
from backend.app.utils.validationConfig import ValidationSettings


SyntheticSecrets = {
    "watsonxApiKey": "synthetic-api-token-secret",
    "adminApiKey": "synthetic-admin-password-secret",
    "watsonxProjectId": "synthetic-private-project",
    "watsonxUrl": "https://synthetic-user:synthetic-password@example.invalid/?token=synthetic-token",
    "milvusHost": "synthetic-private-host",
}


class ConfigEnvelope(BaseModel):
    """Exercise nested model representations and serialization."""

    settings: Settings


@pytest.mark.parametrize("useAliases", [False, True])
def testSecretsExcludedFromSupportedOutput(useAliases, caplog):
    settings = Settings(**SyntheticSecrets)
    envelope = ConfigEnvelope(settings=settings)
    renderedOutputs = [
        repr(settings), str(settings), repr(envelope), str(envelope),
        str(settings.model_dump(by_alias=useAliases)),
        str(settings.model_dump(mode="json", by_alias=useAliases)),
        settings.model_dump_json(by_alias=useAliases),
        str(envelope.model_dump(by_alias=useAliases)),
        envelope.model_dump_json(by_alias=useAliases),
        str(settings.model_dump(include=set(SyntheticSecrets))),
    ]
    with caplog.at_level(logging.INFO):
        logging.getLogger("configSecurityTest").info("Configuration: %r %s", settings, envelope)
    for secretText in SyntheticSecrets.values():
        assert all(secretText not in renderedOutput for renderedOutput in renderedOutputs)
        assert secretText not in caplog.text
    assert set(SyntheticSecrets).isdisjoint(settings.model_dump())
    assert settings.watsonxApiKey.get_secret_value() == SyntheticSecrets["watsonxApiKey"]
    assert settings.adminApiKey.get_secret_value() == SyntheticSecrets["adminApiKey"]


@pytest.mark.parametrize("invalidConfig", [
    {"milvusPort": "synthetic-invalid-secret"},
    {"watsonxApiKey": {"password": "synthetic-invalid-secret"}},
    {"piiFilterPatterns": ["[synthetic-invalid-secret"]},
])
def testConfigurationErrorsAreSafe(invalidConfig, caplog):
    with pytest.raises(ValueError) as caught:
        Settings(**{**SyntheticSecrets, **invalidConfig})
    errorOutput = str(caught.value) + repr(caught.value) + "".join(traceback.format_exception(caught.value))
    with caplog.at_level(logging.ERROR):
        logging.getLogger("configSecurityTest").error("Configuration rejected: %s", caught.value)
    for secretText in [*SyntheticSecrets.values(), "synthetic-invalid-secret"]:
        assert secretText not in errorOutput + caplog.text


def testInvalidEnvironmentPatternIsSafe(monkeypatch, caplog):
    monkeypatch.setenv("PII_FILTER_PATTERNS", "synthetic-malformed-json-secret")
    with pytest.raises(ValueError) as caught:
        Settings()
    assert "synthetic-malformed-json-secret" not in "".join(traceback.format_exception(caught.value)) + caplog.text


def makePrivacyClient(settings):
    testApp = createApp(settings=settings)

    @testApp.post("/config-probe")
    def validateCase(caseInput: ClinicalCaseInput):
        return {"accepted": True}

    return TestClient(testApp)


@pytest.mark.parametrize("enabled", [True, False])
def testConfiguredFilterAcrossAllTextFields(enabled, caplog):
    settings = Settings(**SyntheticSecrets, piiFilterEnabled=enabled)
    client = makePrivacyClient(settings)
    for fieldName in ClinicalCaseInput.model_fields:
        if fieldName in {"moduleHint", "caseType", "pregnancyPossible", "pidDiagnosedOrPresumed", "urgentFindings", "earlyPregnancy"}:
            continue
        response = client.post("/config-probe", json={"moduleHint": "NotSure", fieldName: "synthetic@example.invalid"})
        assert response.status_code == (422 if enabled else 200)
        assert "synthetic@example.invalid" not in response.text + caplog.text
    assert ValidationSettings.get() is None


def testCustomPatternsExtendDefaultsAndStayAppLocal(caplog):
    filteredClient = makePrivacyClient(Settings(piiFilterPatterns=[r"PRIVATE:[a-z]+"], **SyntheticSecrets))
    defaultClient = makePrivacyClient(Settings(**SyntheticSecrets))
    disabledClient = makePrivacyClient(Settings(piiFilterEnabled=False, piiFilterPatterns=[r"PRIVATE:[a-z]+"], **SyntheticSecrets))
    caseInput = {"moduleHint": "NotSure", "additionalNotes": "PRIVATE:synthetic clinical narrative"}
    clients = [filteredClient, defaultClient, disabledClient] * 4
    with ThreadPoolExecutor(max_workers=3) as executor:
        responses = list(executor.map(lambda client: client.post("/config-probe", json=caseInput), clients))
    assert [response.status_code for response in responses] == [422, 200, 200] * 4
    assert all("PRIVATE:synthetic" not in response.text for response in responses)
    assert "PRIVATE:synthetic" not in caplog.text
    assert filteredClient.post("/config-probe", json={"moduleHint": "NotSure", "additionalNotes": "synthetic@example.invalid"}).status_code == 422
    assert filteredClient.post("/config-probe", json={"moduleHint": "NotSure", "additionalNotes": "cyclical pelvic pain"}).status_code == 200
    assert ValidationSettings.get() is None


def testDirectValidationDefaultsAndExplicitContext():
    caseInput = {"moduleHint": "NotSure", "additionalNotes": "synthetic@example.invalid"}
    with pytest.raises(ValidationError):
        ClinicalCaseInput(**caseInput)
    acceptedCase = ClinicalCaseInput.model_validate(caseInput, context=Settings(piiFilterEnabled=False))
    assert acceptedCase.additionalNotes == caseInput["additionalNotes"]
    with pytest.raises(ValidationError):
        ClinicalCaseInput.model_validate({"moduleHint": "NotSure", "additionalNotes": "PRIVATE:synthetic"}, context=Settings(piiFilterPatterns=[r"PRIVATE:[a-z]+"]))


def testDisabledFilterKeepsSchemaValidationAndSafeErrors(caplog):
    client = makePrivacyClient(Settings(piiFilterEnabled=False, **SyntheticSecrets))
    clinicalText = "synthetic confidential clinical narrative " + "x" * 2000
    response = client.post("/config-probe", json={"moduleHint": "NotSure", "additionalNotes": clinicalText, "pregnancyPossible": SyntheticSecrets["watsonxApiKey"]})
    assert response.status_code == 422
    assert clinicalText not in response.text + caplog.text
    assert "synthetic confidential clinical narrative" not in response.text + caplog.text
    for secretText in SyntheticSecrets.values():
        assert secretText not in response.text + caplog.text


def testHealthUsesActiveVersionAndState(caplog):
    firstApp = createApp(Settings(appVersion="synthetic-version-one", **SyntheticSecrets))
    secondApp = createApp(Settings(appVersion="synthetic-version-two", **SyntheticSecrets))
    for testApp, version in [(firstApp, "synthetic-version-one"), (secondApp, "synthetic-version-two")]:
        with TestClient(testApp) as client:
            assert client.get("/health").json() == {"status": "ok", "version": version}
            assert testApp.state.settings.appVersion == version
    firstApp.version = "synthetic-active-version"
    assert TestClient(firstApp).get("/health").json()["version"] == "synthetic-active-version"
    for secretText in SyntheticSecrets.values():
        assert secretText not in caplog.text


def testPatternsLoadFromEnvironment(monkeypatch):
    monkeypatch.setenv("PII_FILTER_PATTERNS", '["PRIVATE:[a-z]+"]')
    assert Settings().piiFilterPatterns == [r"PRIVATE:[a-z]+"]
