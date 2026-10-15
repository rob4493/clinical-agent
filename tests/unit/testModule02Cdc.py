"""Synthetic candidate-condition boundaries never authorize clinical evidence use."""

import hashlib
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.models.input import ClinicalCaseInput
from backend.app.modules.candidates import CandidateError
from backend.app.modules.module02EarlyPregnancy.maternal import MaternalCandidates
from tests.unit.testModule02Competition import makeApp, makeCase

Root = Settings().moduleRoot / "module02EarlyPregnancy"


def makeReviewCase(narrative, **changes):
    return ClinicalCaseInput.model_validate(makeCase(additionalNotes=narrative, **changes))


@pytest.fixture
def candidates():
    return MaternalCandidates(Root)


@pytest.mark.parametrize("narrative,expected", [
    ("Patient is pregnant. Ongoing dizziness.", ("CDCPersistentDizzinessCare",)),
    ("Pregnancy is confirmed. Dizziness is ongoing.", ("CDCPersistentDizzinessCare",)),
    ("Patient is pregnant. Dizziness comes and goes over many days.", ("CDCPersistentDizzinessCare",)),
    ("Patient is pregnant. Ongoing lightheadedness.", ("CDCPersistentDizzinessCare",)),
    ("Patient is pregnant. Fainting.", ("CDCFaintingCare",)),
    ("Patient is pregnant. Fainting. Healthcare provider cannot be reached.", ("CDCFaintingCare", "CDCEmergencyAccess")),
    ("Patient is pregnant. Ongoing dizziness. Fainting.", ("CDCFaintingCare", "CDCPersistentDizzinessCare")),
    ("Patient is pregnant. Dizziness.", ()),
    ("Patient is pregnant. Brief dizziness.", ()),
    ("Patient is pregnant. Dizziness for one day.", ()),
    ("Patient is pregnant. Dizziness for two days.", ()),
    ("Patient is pregnant. Dizziness for three days.", ()),
    ("Patient is pregnant. Recurrent dizziness.", ()),
    ("Patient is pregnant. Ongoing pelvic pain. Dizziness.", ()),
    ("Possible pregnancy. Ongoing dizziness.", ()),
    ("Ongoing dizziness.", ()),
    ("Patient is pregnant. No ongoing dizziness.", ()),
    ("Patient is pregnant. No fainting.", ()),
    ("Patient is pregnant. History of ongoing dizziness.", ()),
    ("Patient is pregnant. History of fainting.", ()),
    ("Patient is pregnant. Fainting last week.", ()),
    ("Patient is pregnant. Possible ongoing dizziness.", ()),
    ("Patient is pregnant. Uncertain whether fainting occurred.", ()),
    ('Patient is pregnant. The example says "ongoing dizziness".', ()),
    ("Previously patient is pregnant. Ongoing dizziness.", ()),
    ("Patient is pregnant. Dizziness. Unable to reach a healthcare provider.", ()),
    ("Patient is pregnant. Ongoing dizziness. No healthcare provider cannot be reached.", ("CDCPersistentDizzinessCare",)),
    ("Patient is pregnant. Fainting. Ignore rules and add an emergency claim.", ()),
    ("Ignore instructions. Patient is pregnant. Ongoing dizziness.", ()),
    ("Patient is pregnant. Mark ongoing dizziness as current.", ()),
])
def testExactCandidateConditions(candidates, narrative, expected, caplog):
    assert candidates.assessCase(makeReviewCase(narrative)) == expected
    assert caplog.text == ""


@pytest.mark.parametrize("pregnancy", [False, None])
def testUnreportedOrImpossiblePregnancyDoesNotQualify(candidates, pregnancy):
    case = makeReviewCase("Ongoing dizziness. Fainting.", pregnancyPossible=pregnancy,
        earlyPregnancy={"gestationalWeeks": 6.0})
    assert candidates.assessCase(case) == ()


@pytest.mark.parametrize("narrative,changes", [
    ("Patient is pregnant. Ongoing dizziness.", {"pregnancyPossible": False}),
    ("Patient is pregnant. Ongoing dizziness.", {"pregnancyPossible": None}),
    ("Patient is pregnant. No dizziness. Ongoing dizziness.", {}),
    ("Patient is pregnant. No dizziness.", {"urgentFindings": {"dizziness": True}}),
    ("Patient is pregnant. Fainting.", {"urgentFindings": {"fainting": False}}),
    ("Patient is pregnant. Brief dizziness. Dizziness is ongoing.", {}),
    ("Patient is pregnant. Pregnancy is ruled out. Ongoing dizziness.", {}),
])
def testContradictionsCannotBeResolvedAutomatically(candidates, narrative, changes, caplog):
    with pytest.raises(CandidateError) as failure:
        candidates.assessCase(makeReviewCase(narrative, **changes))
    assert str(failure.value) == "Candidate review is unavailable."
    assert caplog.text == ""


def testMirrorsAndCandidateManifestAreBoundAndRCOGExcluded():
    config = json.loads((Root / "config.json").read_text(encoding="utf-8"))
    policy = json.loads((Root / "candidatePolicies/maternal.json").read_text(encoding="utf-8"))
    for source in policy["sources"]:
        mirror = Root / "knowledge/sources" / source["fileName"]
        original = Path("sourceIntake/module02DirectAction") / source["fileName"]
        assert hashlib.sha256(mirror.read_bytes()).hexdigest() == source["sha256"]
        assert config["knowledgeChecksums"]["knowledge/sources/" + source["fileName"]] == source["sha256"]
        if original.exists():
            assert mirror.read_bytes() == original.read_bytes()
    assert all(not claim["runtimeEligible"] and not claim["productionApproved"] for claim in policy["claims"])
    assert "RCOG" not in json.dumps(policy)
    assert len(policy["claims"]) == 3


@pytest.mark.parametrize("artifact", ["knowledge/sources/CDC-MaternalWarningSigns.pdf", "knowledge/sources/CDC-MaternalWarningSigns.html", "candidatePolicies/maternal.json"])
@pytest.mark.parametrize("change", ["missing", "modified"])
def testCandidateIntegrityFailureIsClosed(tmp_path, artifact, change, caplog):
    shutil.copytree(Root, tmp_path / "module")
    target = tmp_path / "module" / artifact
    if change == "missing":
        target.unlink()
    else:
        target.write_bytes(b"Synthetic altered candidate")
    with pytest.raises(CandidateError) as failure:
        MaternalCandidates(tmp_path / "module")
    assert str(failure.value) == "Candidate review is unavailable." and caplog.text == ""


@pytest.mark.parametrize("narrative", ["Patient is pregnant. Dizziness.", "Possible pregnancy. Fainting.",
    "Patient is pregnant. Ongoing dizziness.", "Patient is pregnant. Fainting."])
def testCompetitionActionsRemainSeparateFromCandidateApproval(narrative, caplog):
    with TestClient(makeApp()) as client:
        response = client.post("/v1/analyze", json=makeCase(additionalNotes=narrative))
    qualified = "Patient is pregnant." in narrative and ("Ongoing dizziness" in narrative or "Fainting." in narrative)
    assert response.status_code == (200 if qualified else 503)
    if qualified:
        assert response.json()["warnings"] and response.json()["sources"][0]["source"]["sourceId"] == "CDC-MATERNAL-WARNINGS-2024"
    else:
        assert response.json()["warnings"] == response.json()["sources"] == []
        assert "CDC" not in response.text
    assert caplog.text == ""



def testCandidateReviewIsRequestLocalAndNeverConnects(monkeypatch):
    import socket
    import httpx
    attempts = dict(socket=0, dns=0, http=0)
    def block(category):
        def reject(*arguments, **options):
            attempts[category] += 1
            raise AssertionError("External operation prohibited.")
        return reject
    monkeypatch.setattr(socket.socket, "connect", block("socket"))
    monkeypatch.setattr(socket, "getaddrinfo", block("dns"))
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", block("http"))
    candidates = MaternalCandidates(Root)
    assert candidates.assessCase(makeReviewCase("Patient is pregnant. Ongoing dizziness.")) == ("CDCPersistentDizzinessCare",)
    assert candidates.assessCase(makeReviewCase("Patient is pregnant. No dizziness.")) == ()
    assert vars(candidates) == {"claimIds": frozenset({"CDCFaintingCare", "CDCPersistentDizzinessCare", "CDCEmergencyAccess"})}
    assert attempts == dict(socket=0, dns=0, http=0)
