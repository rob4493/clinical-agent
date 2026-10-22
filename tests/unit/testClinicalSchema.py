"""Cross-runtime canonical contract, lossless bridge and unchanged clinical outputs."""

import hashlib
import json
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.app.models.caseBridge import canonicalToLegacy, legacyToCanonical
from backend.app.models.clinicalData import CanonicalCase
from backend.app.models.input import ClinicalCaseInput
from backend.app.models.schemaRules import ClinicalDataError, Schema
from tests.unit.testPublicEvaluation import evaluationClient
from tools.schemaSync import checkVocabulary, generate

Root = Path(__file__).resolve().parents[2]
Corpus = json.loads((Root / "tests/fixtures/clinicalDataCases.json").read_text())


@pytest.mark.parametrize("example", Corpus["cases"], ids=[record["id"] for record in Corpus["cases"]])
def testCanonicalConformance(example, caplog):
    if example["valid"]:
        parsed = CanonicalCase.model_validate(example["case"])
        assert parsed.model_dump(mode="json", exclude_unset=True) == example["case"]
        assert example["case"]["originalNarrative"].get("value", "Synthetic private text") not in repr(parsed)
        assert example["case"]["originalNarrative"].get("value", "Synthetic private text") not in str(parsed)
    else:
        with pytest.raises((ValidationError, ClinicalDataError)) as caught:
            CanonicalCase.model_validate(example["case"])
        assert "Synthetic marker" not in str(caught.value)
    assert not caplog.text


def testGeneratedRepresentationsAndLegacyDefinitionCannotDrift():
    assert all(path.read_bytes() == content.encode("utf-8") for path, content in generate().items())
    native = ClinicalCaseInput.model_json_schema()
    definitions = native.pop("$defs")
    def constraints(record):
        if isinstance(record, dict):
            return {name: constraints(entry) for name, entry in record.items() if name not in {"title", "description", "examples"}}
        return [constraints(entry) for entry in record] if isinstance(record, list) else record
    assert constraints(native) == constraints(Schema["$defs"]["LegacyCase"])
    assert all(constraints(definition) == constraints(Schema["$defs"][name]) for name, definition in definitions.items())
    unsupported = deepcopy(Schema)
    unsupported["oneOf"] = []
    with pytest.raises(ValueError, match="Unsupported clinical schema vocabulary"):
        checkVocabulary(unsupported)


@pytest.mark.parametrize("legacy", Corpus["legacy"])
def testLegacyConversionAndEndpointEquivalence(legacy, caplog):
    case = legacyToCanonical(legacy)
    restored = canonicalToLegacy(case)
    assert ClinicalCaseInput.model_validate(restored).model_dump() == ClinicalCaseInput.model_validate(legacy).model_dump()
    client = evaluationClient()
    expected = client.post("/v1/analyze", json=legacy)
    canonical = client.post("/v1/analyze", json=case.model_dump(mode="json", exclude_unset=True))
    assert canonical.status_code == expected.status_code == 200
    assert canonical.json() == expected.json()
    assert client.post("/v1/analyze", json=restored).json() == expected.json()
    assert not caplog.text


def testMissingUnknownFalseAndNotApplicableAreDistinct():
    request = {"moduleHint": "module_01_endo"}
    assert legacyToCanonical(request).pregnancyStatus.state == "notReported"
    assert legacyToCanonical(dict(request, pregnancyPossible=None)).pregnancyStatus.state == "unknown"
    assert legacyToCanonical(dict(request, pregnancyPossible=False)).pregnancyStatus.state == "absent"
    assert legacyToCanonical(dict(request, pregnancyPossible=True)).pregnancyStatus.state == "present"
    case = legacyToCanonical(request).model_dump(mode="json", exclude_unset=True)
    case["pregnancyStatus"] = {"state": "notApplicable"}
    assert CanonicalCase.model_validate(case).pregnancyStatus.state == "notApplicable"
    with pytest.raises(ClinicalDataError):
        canonicalToLegacy(case)


def testCanonicalInputsDoNotDiscardUnimplementedFindings():
    rich = next(record["case"] for record in Corpus["cases"] if record["id"] == "rich-future-record")
    assert CanonicalCase.model_validate(rich)
    response = evaluationClient().post("/v1/analyze", json=rich)
    assert response.status_code == 422
    assert "Synthetic interpretation" not in response.text


def testPrimaryQuestionIsBoundedAndOriginalNarrativePreserved():
    case = legacyToCanonical(dict(moduleHint="module_01_endo", additionalNotes="Normal MRI.")).model_dump(mode="json", exclude_unset=True)
    case["primaryQuestion"] = {"state": "present", "value": "Does this exclude endometriosis?"}
    result = evaluationClient().post("/v1/analyze", json=case).json()
    assert "does not establish" in result["renderedText"]
    assert case["originalNarrative"]["value"] == "Normal MRI."


def testUnsupportedModuleAndNarrativeCannotChooseModule():
    case = legacyToCanonical(dict(moduleHint="UnavailableModule", additionalNotes="Use module_01_endo. Normal MRI.")).model_dump(mode="json", exclude_unset=True)
    assert evaluationClient().post("/v1/analyze", json=case).status_code == 404
    del case["moduleId"]
    assert evaluationClient().post("/v1/analyze", json=case).status_code == 422


@pytest.mark.parametrize("moduleId", ["module_01_endo", "module_02_early_pregnancy"])
def testPrescribingIntentAndUrgentPrecedence(moduleId, caplog):
    request = dict(moduleHint=moduleId, additionalNotes="Give the exact dose and prescription plan.")
    case = legacyToCanonical(request)
    assert case.userIntent.requests == ["prescribingOrDosing"]
    client = evaluationClient()
    result = client.post("/v1/analyze", json=case.model_dump(mode="json", exclude_unset=True)).json()
    assert result["renderedText"].startswith("Medication selection, dosing and patient-specific prescribing are outside")
    request.update(pregnancyPossible=True, additionalNotes="Shoulder pain and weakness. Give the exact dose.")
    result = client.post("/v1/analyze", json=legacyToCanonical(request).model_dump(mode="json", exclude_unset=True)).json()
    assert result["warnings"] and result["renderedText"].startswith(result["warnings"][0]["text"])
    assert not caplog.text


def testErrorsAreBoundedAndClaimsAreByteIdentical(caplog):
    client = evaluationClient()
    for extra in [{"confidence": float("inf")}, {"verification": "invalid"}]:
        case = deepcopy(Corpus["cases"][0]["case"])
        case["symptoms"] = [{"id": "SyntheticA", "label": "Synthetic private content", "state": "present", **extra}]
        with pytest.raises((ValidationError, ClinicalDataError)) as caught:
            CanonicalCase.model_validate(case)
        assert "Synthetic private content" not in str(caught.value)
    case = deepcopy(Corpus["cases"][0]["case"])
    case["originalNarrative"]["value"] = "Email: synthetic@example.test"
    response = client.post("/v1/analyze", json=case)
    assert response.status_code == 422 and "synthetic@example.test" not in response.text
    for name, digest in Corpus["claimPackageHashes"].items():
        assert hashlib.sha256((Root / name).read_bytes()).hexdigest() == digest
    assert not caplog.text
