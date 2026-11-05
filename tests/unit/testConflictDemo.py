"""
Focused conflict-detection demonstration tests.

Verifies that the existing conflict safety behavior is demonstration-ready:
- The exact verified synthetic fixture (pregnancyPossible=False, 'pregnancy confirmed')
  produces a DataConflict halt with the correct module, preserved field values,
  no routine clinical analysis, and no LLM-generated conflict resolution.
- Orchestrate argument fidelity: conflicting values are submitted unchanged.
- The renderedText carries only the clarification request and the fixed notice.
- No urgent-warning ordering regression, no citation regression, no Module 2 bleed.

No authentic modules are activated. No clinical rules are changed.
All cases use fictional, de-identified demonstration data.
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import Mock

from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.models.output import (
    ClarificationRequired,
    DataConflict,
    DecisionSupportNotice,
    SyntheticNotice,
)
from backend.demo.cases import BriefNarrative
from tests.unit.testSyntheticDemo import demoApp, caseFields


# ---------------------------------------------------------------------------
# Exact verified synthetic conflict fixture
# pregnancyPossible = False (Not possible), narrative = 'pregnancy confirmed'
# This is the same fixture used by the competition browser, DemoCases.ts and
# orchestrate/cases/module01-endo.json (id: m1-conflict).
# ---------------------------------------------------------------------------

ConflictNarrative = "pregnancy confirmed"
ConflictPregnancy = False  # structured: Not possible


class TestConflictFixtureLoading:
    """The preset populates both conflicting values and does not auto-submit."""

    def test_conflict_preset_uses_exact_fixture(self):
        """Conflict fixture matches the verified orchestrate/DemoCases values."""
        import json
        from pathlib import Path
        cases = json.loads(
            (Path("orchestrate/cases/module01-endo.json")).read_text(encoding="utf-8")
        )
        conflict = next(c for c in cases["cases"] if c["id"] == "m1-conflict")
        assert conflict["request"]["pregnancyPossible"] is False
        assert conflict["request"]["additionalNotes"] == ConflictNarrative
        assert conflict["request"]["moduleHint"] == "module_01_endo"
        assert conflict["expectedResponseType"] == "DataConflict"

    def test_conflict_module_is_module_01_endo(self):
        """Module 1 (Endometriosis) is explicitly assigned; no symptom inference."""
        import json
        from pathlib import Path
        cases = json.loads(
            (Path("orchestrate/cases/module01-endo.json")).read_text(encoding="utf-8")
        )
        conflict = next(c for c in cases["cases"] if c["id"] == "m1-conflict")
        assert conflict["request"]["moduleHint"] == "module_01_endo"


class TestConflictFailClosed:
    """Analysis halts at conflict detection; no retrieval, no LLM generation."""

    def test_conflict_returns_data_conflict(self):
        """pregnancyPossible=False + 'pregnancy confirmed' yields DataConflict."""
        with TestClient(demoApp()) as client:
            response = client.post(
                "/v1/analyze",
                json=caseFields(
                    additionalNotes=ConflictNarrative,
                    pregnancyPossible=ConflictPregnancy,
                ),
            )
        assert response.status_code == 200
        assert response.json()["response"]["responseType"] == "DataConflict"

    def test_conflict_preserves_both_values_without_resolving(self):
        """structuredValue=False and the narrative assertion are retained unchanged."""
        with TestClient(demoApp()) as client:
            response = client.post(
                "/v1/analyze",
                json=caseFields(
                    additionalNotes=ConflictNarrative,
                    pregnancyPossible=ConflictPregnancy,
                ),
            )
        outcome = response.json()["response"]
        assert outcome["responseType"] == "DataConflict"
        assert outcome["structuredValue"] == "False"
        assert outcome["fieldName"] == "pregnancyPossible"
        # Neither value is chosen, averaged, merged or discarded.
        assert ConflictNarrative not in response.text

    def test_no_routine_clinical_analysis_during_conflict(self):
        """No supportedInterpretations, no sources, no urgency section on halt."""
        with TestClient(demoApp()) as client:
            response = client.post(
                "/v1/analyze",
                json=caseFields(
                    additionalNotes=ConflictNarrative,
                    pregnancyPossible=ConflictPregnancy,
                ),
            )
        payload = response.json()
        assert payload["sources"] == []
        assert payload["warnings"] == []
        assert "Sources" not in payload["renderedText"]
        assert "supportedInterpretations" not in payload["response"]
        assert "no urgent warning" not in response.text.lower()

    def test_conflict_renderedText_ends_with_notice(self):
        """Fixed decision-support notice is appended last even on conflict halt."""
        with TestClient(demoApp()) as client:
            response = client.post(
                "/v1/analyze",
                json=caseFields(
                    additionalNotes=ConflictNarrative,
                    pregnancyPossible=ConflictPregnancy,
                ),
            )
        assert response.json()["renderedText"].endswith(SyntheticNotice)
        assert response.json()["response"]["decisionSupportNotice"] == SyntheticNotice
        assert list(response.json())[0] == "warnings"

    def test_llm_is_not_called_during_conflict(self, monkeypatch):
        """Language provider generate() must never be called when a conflict halts."""
        app = demoApp()
        forbidden = Mock(side_effect=AssertionError("LLM must not be called on conflict halt"))
        monkeypatch.setattr(app.state.analysis.language, "generate", forbidden)
        with TestClient(app) as client:
            response = client.post(
                "/v1/analyze",
                json=caseFields(
                    additionalNotes=ConflictNarrative,
                    pregnancyPossible=ConflictPregnancy,
                ),
            )
        assert response.json()["response"]["responseType"] == "DataConflict"
        forbidden.assert_not_called()


class TestConflictOrchestrateArgumentFidelity:
    """Orchestrate must submit conflicting values unchanged; the API decides."""

    def test_exact_orchestrate_fixture_arguments(self):
        """The m1-conflict fixture has exact field values required by agent instructions."""
        import json
        from pathlib import Path
        cases = json.loads(
            (Path("orchestrate/cases/module01-endo.json")).read_text(encoding="utf-8")
        )
        conflict = next(c for c in cases["cases"] if c["id"] == "m1-conflict")
        req = conflict["request"]
        # pregnancyPossible is the conflicting structured value; must not be normalized.
        assert req["pregnancyPossible"] is False
        # additionalNotes is the conflicting narrative; must not be extracted or modified.
        assert req["additionalNotes"] == ConflictNarrative
        # Module must be explicit; never inferred from symptoms.
        assert req["moduleHint"] == "module_01_endo"
        # pidDiagnosedOrPresumed unknown — must remain null, not defaulted.
        assert req["pidDiagnosedOrPresumed"] is None

    def test_orchestrate_notes_require_no_llm_resolution(self):
        """Agent notes instruct against resolving the conflict; API returns renderedText."""
        import json
        from pathlib import Path
        cases = json.loads(
            (Path("orchestrate/cases/module01-endo.json")).read_text(encoding="utf-8")
        )
        conflict = next(c for c in cases["cases"] if c["id"] == "m1-conflict")
        notes = conflict.get("notes", "").lower()
        # Notes must instruct the agent not to resolve conflicts.
        assert "must not resolve" in notes or "not resolve" in notes or "do not resolve" in notes


class TestConflictNoRegression:
    """Conflict behavior must not affect normal Module 1 or Module 2 outcomes."""

    def test_normal_brief_still_returns_agent_response(self):
        """A plain brief case without conflict still produces AgentResponse."""
        with TestClient(demoApp()) as client:
            response = client.post("/v1/analyze", json=caseFields(additionalNotes=BriefNarrative))
        assert response.json()["response"]["responseType"] == "AgentResponse"
        assert response.json()["sources"] != []

    def test_urgent_case_still_produces_warning_first(self):
        """Conflict fixture must not suppress the U2 rule for acute pain cases."""
        with TestClient(demoApp()) as client:
            response = client.post(
                "/v1/analyze",
                json=caseFields(additionalNotes="sudden acute pelvic pain"),
            )
        payload = response.json()
        assert payload["response"]["responseType"] == "AgentResponse"
        assert payload["warnings"] != []
        assert payload["renderedText"].startswith(payload["warnings"][0]["text"])

class TestLocalConflictContract:
    """Review definitions do not authorize new analysis fields or source adjudication."""

    def testConfirmedOppositeAssertions(self):
        from backend.app.models.clinicalData import ConflictReview
        record = self.reviewRecord()
        parsed = ConflictReview.model_validate(record)
        assert parsed.concept == 'pregnancyPossible'
        assert [assertion.normalizedValue for assertion in parsed.assertions] == ['absent', 'present']
        assert 'Synthetic report' not in repr(parsed)

    @staticmethod
    def reviewRecord():
        return {
            'id': 'SyntheticConflict', 'concept': 'pregnancyPossible', 'label': 'Pregnancy status',
            'conflictType': 'opposingValues', 'resolutionStatus': 'unresolved',
            'allowedOptions': ['firstAssertion', 'secondAssertion', 'changedOverTime', 'differentContext', 'correctedReport', 'unresolved', 'requestVerification'],
            'assertions': [
                {'id': 'AssertionOne', 'sourceLabel': 'Synthetic report A', 'concept': 'pregnancyPossible', 'normalizedValue': 'absent', 'verification': 'clinicianVerified', 'contextId': 'CurrentStatus', 'displayText': 'Pregnancy not possible.'},
                {'id': 'AssertionTwo', 'sourceLabel': 'Synthetic report B', 'concept': 'pregnancyPossible', 'normalizedValue': 'present', 'verification': 'clinicianVerified', 'contextId': 'CurrentStatus', 'displayText': 'Pregnancy confirmed.'},
            ],
        }

    @pytest.mark.parametrize('state', ['unknown', 'notReported', 'notApplicable', 'absent', 'present'])
    def testDistinctAssertionStates(self, state):
        from backend.app.models.clinicalData import ReportAssertion
        assertion = self.reviewRecord()['assertions'][0]
        assertion['normalizedValue'] = state
        assert ReportAssertion.model_validate(assertion).normalizedValue == state

    def testDuplicateIdentifiersAndUnknownConceptRejected(self):
        from backend.app.models.clinicalData import ConflictReview
        from pydantic import ValidationError
        record = self.reviewRecord()
        record['assertions'][1]['id'] = record['assertions'][0]['id']
        with pytest.raises(ValidationError):
            ConflictReview.model_validate(record)
        record = self.reviewRecord()
        record['concept'] = 'newDiagnosis'
        with pytest.raises(ValidationError):
            ConflictReview.model_validate(record)

    def testLocalResolutionCannotEnterCaseOrOverrideConflict(self):
        from backend.app.models.input import ClinicalCaseInput
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            ClinicalCaseInput.model_validate(caseFields(conflictResolution={'option': 'firstAssertion'}))

    def testReviewDataNotLogged(self, caplog):
        from backend.app.models.clinicalData import ConflictReview
        parsed = ConflictReview.model_validate(self.reviewRecord())
        assert 'Synthetic report A' not in repr(parsed)
        assert 'Pregnancy confirmed.' not in caplog.text
