"""Additive outcome discrimination and authoritative notice selection."""

import pytest
from pydantic import ValidationError

from backend.app.api.analysis import selectNotice
from backend.app.models.analysis import AnalysisResult
from backend.app.models.input import ClinicalCaseInput
from backend.app.models.output import CompetitionNotice, DecisionSupportNotice, EvidenceInsufficientResponse, OutsideScope, ProviderUnavailable, SyntheticNotice


@pytest.mark.parametrize("outcomeType", [OutsideScope, ProviderUnavailable])
def testNewOutcomesRemainDistinct(outcomeType):
    outcome = outcomeType(moduleId="module_01_endo")
    result = AnalysisResult(response=outcome, renderedText=outcome.message + "\n\n" + DecisionSupportNotice)
    parsed = AnalysisResult.model_validate_json(result.model_dump_json())
    assert isinstance(parsed.response, outcomeType)
    assert parsed.response.responseType == outcomeType.__name__
    assert list(result.model_dump())[0] == "warnings"
    assert result.sources == [] and result.warnings == []


@pytest.mark.parametrize("runtimeMode,expected", [("standard", DecisionSupportNotice), ("production", DecisionSupportNotice), ("synthetic", SyntheticNotice), ("competition", CompetitionNotice)])
def testServerNoticeSelectedWithoutChangingOutcome(runtimeMode, expected):
    outcome = EvidenceInsufficientResponse()
    result = AnalysisResult(response=outcome, renderedText=outcome.message + "\n\n" + DecisionSupportNotice)
    selected = selectNotice(result, runtimeMode)
    assert selected.response.decisionSupportNotice == expected
    assert selected.renderedText == outcome.message + "\n\n" + expected
    assert selected.response.responseType == "EvidenceInsufficient"
    assert result.response.decisionSupportNotice == DecisionSupportNotice


def testUnknownResponseDiscriminatorRejected():
    with pytest.raises(ValidationError):
        AnalysisResult.model_validate({"response": {"responseType":"SyntheticUnknown"}, "renderedText":"Synthetic"})


def testClientCannotSubmitServerNotice():
    with pytest.raises(ValidationError):
        ClinicalCaseInput.model_validate({"moduleHint":"EndometriosisChronicPelvicPain", "caseType":"brief", "decisionSupportNotice":CompetitionNotice})


@pytest.mark.parametrize("runtimeMode", ["standard", "synthetic", "competition", "production"])
def testExplicitRuntimeConfiguration(runtimeMode):
    from backend.app.config import Settings
    settings = Settings(clinicalRuntimeMode=runtimeMode)
    assert settings.runtimeMode() == runtimeMode
    assert settings.clinicalDemoMode is (runtimeMode == "synthetic")


@pytest.mark.parametrize("runtimeMode", ["Competition", "competition ", "live", True])
def testInvalidRuntimeModeRejected(runtimeMode):
    from backend.app.config import Settings
    with pytest.raises(ValueError, match="^Invalid application configuration. Check configured types and constraints.$"):
        Settings(clinicalRuntimeMode=runtimeMode)


@pytest.mark.parametrize("runtimeMode", ["competition", "production"])
def testMixedRuntimeRejected(runtimeMode):
    from backend.app.config import Settings
    with pytest.raises(ValueError, match="^Invalid application configuration. Check configured types and constraints.$"):
        Settings(clinicalRuntimeMode=runtimeMode, clinicalDemoMode=True)


@pytest.mark.parametrize("runtimeMode", ["standard", "synthetic", "competition", "production"])
def testRuntimeLabelComesFromActiveApplication(runtimeMode):
    from fastapi.testclient import TestClient
    from backend.app.config import Settings
    from backend.app.main import createApp
    with TestClient(createApp(Settings(clinicalRuntimeMode=runtimeMode))) as client:
        runtime = client.get("/v1/runtime")
        assert runtime.headers["X-Clinical-Mode"] == runtimeMode
        assert runtime.json()["mode"] == runtimeMode
        assert runtime.json()["synthetic"] is (runtimeMode == "synthetic")
        readiness = client.get("/ready")
        assert readiness.headers["X-Clinical-Mode"] == runtimeMode
        if runtimeMode in {"standard", "production"}:
            assert readiness.status_code == 503
            assert client.get("/v1/modules").json()["modules"] == []
        if runtimeMode == "competition":
            assert readiness.status_code == 200
            assert runtime.json()["evaluation"]["reviewStatus"] == "reviewedForEvaluation"
            assert client.get("/v1/modules").json()["modules"][0]["moduleId"] == "module_01_endo"


@pytest.mark.parametrize("notice", [CompetitionNotice, SyntheticNotice, DecisionSupportNotice])
def testArbitraryNoticeRejected(notice):
    outcome = OutsideScope(decisionSupportNotice=notice)
    assert outcome.decisionSupportNotice == notice
    with pytest.raises(ValidationError):
        OutsideScope(decisionSupportNotice="Synthetic arbitrary notice")
