"""Administrative source mapping cannot confer runtime availability or clinical approval."""

import hashlib
import json
from pathlib import Path

import pytest

Manifest = Path("docs/Module02DirectActionEvidence.json")


def testCandidateMappingsPreserveApprovalAndSourceBoundaries():
    manifest = json.loads(Manifest.read_text(encoding="utf-8"))
    assert manifest["runtimeIntegrated"] is manifest["sourceApprovalGranted"] is False
    assert len(manifest["sources"]) == 3 and len(manifest["claims"]) == 5
    sources = {source["sourceId"]: source for source in manifest["sources"]}
    assert len(sources) == 3
    assert all(source["runtimeEligible"] is source["productionApproved"] is False for source in sources.values())
    for claim in manifest["claims"]:
        assert claim["status"] == "candidate" and claim["clinicalReviewStatus"] == "pendingReview"
        assert claim["runtimeEligible"] is claim["productionApproved"] is False
        assert claim["sourceFileHash"] == sources[claim["sourceId"]]["sha256"]
        assert claim["conditions"] and claim["limitations"] and claim["sourceLocation"]


def testUnavailableOriginalHasNoFabricatedDigestOrClinicalEligibility():
    sources = json.loads(Manifest.read_text(encoding="utf-8"))["sources"]
    source = next(source for source in sources if source["sourceId"].startswith("RCOG-"))
    assert source["retrievalStatus"] == "originalBytesBlockedHTTP403"
    assert source["sha256"] is source["byteSize"] is source["pageCount"] is None
    assert source["reportedPageCount"] == 5 and source["documentType"] == "professionalOrganizationPatientInformation"


@pytest.mark.parametrize("sourceId", ["CDC-MATERNAL-WARNINGS-POSTER", "CDC-MATERNAL-WARNINGS-2024"])
def testPreservedOriginalMatchesRecordedReceipt(sourceId):
    manifest = json.loads(Manifest.read_text(encoding="utf-8"))
    source = next(source for source in manifest["sources"] if source["sourceId"] == sourceId)
    original = Path(manifest["originalIntakeDirectory"]) / source["fileName"]
    if not original.exists():
        pytest.skip("Administrative originals are deliberately excluded from clean clones.")
    content = original.read_bytes()
    assert hashlib.sha256(content).hexdigest() == source["sha256"]
    assert len(content) == source["byteSize"] and source["statusCode"] == 200
    assert source["officialUrl"] == source["finalUrl"] and source["officialUrl"].startswith("https://www.cdc.gov/")


def testAuthenticApprovalIsUnchangedByCompetitionEligibility():
    from backend.competition.integrity import PackageHash, Module2PackageHash, Module2CompetitionEnabled
    from backend.app.config import Settings
    from backend.app.modules.registry import ModuleRegistry
    assert PackageHash == "24a45eff098781766f8db4ed3da7ef237eccbbb285d1907440e33b8828d10d79"
    assert Module2PackageHash == "2c48cbad01ca0d26290ed4d8f7fa86735d1fa0adc2687a37b21776c927c75f17"
    assert Module2CompetitionEnabled is True
    registry = ModuleRegistry(Settings().moduleRoot)
    config = registry.getModule("module_02_early_pregnancy")
    assert config.active is False and config.status.value == "pending_review"
    assert len(registry.listSources(config.moduleId)) == 15
    assert all(source.status == "pendingReview" for source in registry.listSources(config.moduleId))
