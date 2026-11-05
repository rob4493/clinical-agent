"""Offline draft artifacts must not change clinical packages or runtime authority."""

import json
from pathlib import Path

import pytest

Root = Path(__file__).resolve().parents[2]
Contract = json.loads((Root / "evaluation/understanding/observations.schema.json").read_bytes())
Corpus = json.loads((Root / "evaluation/understanding/corpus.json").read_bytes())
Canonical = json.loads((Root / "shared/clinicalData.schema.json").read_bytes())


def testDraftVersions():
    assert Corpus["contractVersion"] == Contract["properties"]["schemaVersion"]["const"] == "1.0.0"
    assert Corpus["annotationStatus"] == "draftForExpertReview"
    assert Corpus["syntheticOnly"] is True
    assert Contract["x-canonicalSchemaVersion"] == Canonical["properties"]["schemaVersion"]["const"]


def testCanonicalStates():
    assert Contract["properties"]["observations"]["items"]["properties"]["state"]["enum"] == Canonical["$defs"]["FindingState"]["enum"]


@pytest.mark.parametrize("binding", list(Contract["x-bindings"].values()))
def testCanonicalBindings(binding):
    definition = Canonical
    for segment in binding["path"].split("."):
        while "$ref" in definition or "anyOf" in definition:
            if "$ref" in definition:
                definition = Canonical["$defs"][definition["$ref"].split("/")[-1]]
            else:
                definition = next(option for option in definition["anyOf"] if option.get("type") != "null")
        definition = definition["properties"][segment]
    assert definition
    assert set(binding["modules"]) <= {"module_01_endo", "module_02_early_pregnancy"}


def testCorpusIdentityAndScope():
    assert len(Corpus["cases"]) == len({case["id"] for case in Corpus["cases"]}) == 51
    assert all(case["syntheticOnly"] for case in Corpus["cases"])
    assert {case["moduleId"] for case in Corpus["cases"]} == {"module_01_endo", "module_02_early_pregnancy"}
    assert all(case["caseInput"]["moduleHint"] == case["moduleId"] for case in Corpus["cases"])


def testNoClinicalApprovalOrSourceObjects():
    for case in Corpus["cases"]:
        assert not ({"claims", "sources", "reviewer", "credentials", "sourceDocuments"} & set(case))
        assert not ({"claims", "sources", "updatedCase", "reanalyze", "verification"} & set(case["expected"]))
    criteria = json.loads((Root / "evaluation/understanding/acceptance.json").read_bytes())
    assert criteria["clinicalThresholdsApproved"] is False
    assert set(criteria["clinicalPerformanceThresholds"].values()) == {None}


def testProductionDoesNotImportOfflineArtifacts():
    for directory in ("backend/app", "backend/competition", "netlify/functions", "netlify/evaluation", "frontend/src"):
        for path in (Root / directory).rglob("*"):
            if path.suffix in {".py", ".ts", ".tsx"}:
                assert "understanding/" not in path.read_text(encoding="utf-8"), str(path.relative_to(Root))
