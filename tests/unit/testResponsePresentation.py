"""Presentation provenance and byte-preservation checks; no clinical text in reports."""
import hashlib
import json
from pathlib import Path
import pytest

Root = Path(__file__).resolve().parents[2]
Wording = json.loads((Root / "shared/responsePresentation.json").read_bytes())
Pins = {'evaluation/modules/module1/claims.json': 'b1b28cb6522e9a18654e978ea5b669f2f107b2b858f920d907634a99577ff187', 'evaluation/modules/module2/claims.json': 'a42079d0122c9cdb98a125e6783456c40be632eda93f5ae4e911359d1f6579c7'}

@pytest.mark.parametrize("name,digest", list(Pins.items()))
def testClaimBytes(name, digest):
    assert hashlib.sha256((Root / name).read_bytes()).hexdigest() == digest

@pytest.mark.parametrize("entry", Wording["entries"], ids=["presentation" + str(index) for index in range(len(Wording["entries"]))])
def testPresentationBindings(entry):
    packages = [json.loads((Root / name).read_bytes()) for name in Pins]
    package = next(package for package in packages if package["moduleId"] == entry["moduleId"])
    claims = {claim["claimId"]: claim for claim in package["claims"]}
    assert entry["claimIds"] and len(set(entry["claimIds"])) == len(entry["claimIds"])
    assert set(entry["sourceIds"]) == {claims[claimId]["sourceId"] for claimId in entry["claimIds"]}
    assert all(claims[claimId]["productionApproved"] is False for claimId in entry["claimIds"])
    assert len(entry["summary"].split()) <= 40
    assert not any(marker in entry["summary"].lower() for marker in ["https://", "<", "definitely", "you have", "take medication"])
    assert all(len(point.split()) <= 20 for point in entry["keyPoints"])
    assert len(entry["keyPoints"]) <= 3
    # Every input wording must already be an evaluated response variant, not an invented clinical rule.
    runtime = "\n".join((Root / name).read_text() for name in ["netlify/evaluation/synthesis.ts", "netlify/evaluation/policy.json", "backend/competition/grounding.py"])
    assert entry["original"] in runtime

def testClaimCount():
    assert [len(json.loads((Root / name).read_bytes())["claims"]) for name in Pins] == [57, 21]
