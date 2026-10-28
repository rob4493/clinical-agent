"""Reviewed display vocabulary remains source-bound and cannot approve clinical evidence."""
import hashlib
import json
from pathlib import Path

from backend.competition.evaluation import verifyReview

Root = Path(__file__).resolve().parents[2]


def testReviewedVocabularyAndInventory():
    catalog = json.loads((Root / "shared/reviewedVariants.json").read_bytes())
    package = json.loads((Root / "evaluation/modules/module2/claims.json").read_bytes())
    claims = {claim["claimId"]: claim for claim in package["claims"]}
    expected = {"M2NSymptoms", "M2NPainAssessment", "M2NEmptyUterus", "M2NHcgLocation", "M2NSerialLimits",
                "M2NSymptomsOverHcg", "M2NPulDefinition", "M2NPulPossibility", "M2NSingleScan",
                "M2AIndeterminateHcg", "M2ASerialScope"}
    assert catalog["presentationVersion"] == "1" and len(catalog["entries"]) == 17
    assert {claimId for entry in catalog["entries"] for claimId in entry["claimIds"]} == expected
    for entry in catalog["entries"]:
        assert entry["moduleId"] == package["moduleId"]
        assert entry["sourceIds"] == sorted({claims[claimId]["sourceId"] for claimId in entry["claimIds"]})
        assert len(entry["claimIds"]) == len(set(entry["claimIds"]))
        assert entry["wording"] and len(entry["wording"]) <= 2000
        assert not any(marker in entry["wording"] for marker in ("https://", "<", "sourceIntake", "file://"))
        assert all(claims[claimId]["productionApproved"] is False for claimId in entry["claimIds"])
    assert all(source["lifecycleStatus"] == "pendingReview" for source in package["sources"])


def testReviewedBoundaryIsIntegrityPinned():
    review = verifyReview()
    for name in ["shared/reviewedVariants.json", "netlify/evaluation/reviewedPresentation.ts", "netlify/evaluation/watsonShadow.ts",
                 "netlify/functions/evaluate.ts", "frontend/src/api.ts", "frontend/src/ResponsePanel.tsx", "frontend/src/VisualFindings.tsx"]:
        assert review["files"][name] == hashlib.sha256((Root / name).read_bytes()).hexdigest()
    assert review["productionApproved"] is False
