"""Public draft integrity and publication boundaries; no private fixtures required."""

import csv
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

import pytest


Root = Path(__file__).resolve().parents[2]
EvaluationRoot = Root / "evaluation"
Packages = [json.loads((EvaluationRoot / "modules" / f"module{number}" / "claims.json").read_text(encoding="utf-8")) for number in (1, 2)]
ClaimCases = [(package["moduleId"], claim) for package in Packages for claim in package["claims"]]


def contentDigest(content):
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@pytest.mark.parametrize("moduleNumber,expectedCount", [(1, 57), (2, 21)])
def testPublicPackageInventory(moduleNumber, expectedCount):
    package = Packages[moduleNumber - 1]
    assert set(package) == {"schemaVersion", "packageId", "moduleId", "contentKind", "reviewStatus", "competitionStatus", "productionApproved", "notice", "sources", "claims", "contentHash"}
    assert len(package["claims"]) == expectedCount
    assert len({claim["claimId"] for claim in package["claims"]}) == expectedCount
    assert package["contentKind"] == "projectAuthoredEvaluationSummaries"
    assert package["reviewStatus"] == "reviewedForEvaluation"
    assert package["competitionStatus"] == "competitionReady"
    assert package["productionApproved"] is False
    assert "not reproductions" in package["notice"]
    assert "not approved for clinical care" in package["notice"]


@pytest.mark.parametrize("moduleId,claim", ClaimCases, ids=[claim["claimId"] for _, claim in ClaimCases])
def testClaimBoundaries(moduleId, claim):
    assert set(claim) == {"claimId", "moduleId", "sourceId", "supportedStatement", "retrievalText", "conditions", "limitations", "intendedPopulation", "jurisdiction", "productionApproved", "contentHash"}
    assert claim["moduleId"] == moduleId
    assert claim["productionApproved"] is False
    assert claim["conditions"] and claim["limitations"]
    assert claim["intendedPopulation"] and claim["jurisdiction"]
    assert claim["supportedStatement"] != claim["retrievalText"]
    assert len(claim["supportedStatement"]) <= 2000
    assert len(claim["retrievalText"]) <= 2000
    unsigned = {key: field for key, field in claim.items() if key != "contentHash"}
    assert contentDigest(unsigned) == claim["contentHash"]
    changed = {**unsigned, "supportedStatement": "Synthetic unauthorized replacement."}
    assert contentDigest(changed) != claim["contentHash"]


def testPublicIntegrityPins():
    manifest = json.loads((EvaluationRoot / "integrity.json").read_text())
    assert len(manifest["packages"]) == 2
    for pin in manifest["packages"]:
        packagePath = Root / pin["path"]
        assert packagePath.resolve().is_relative_to(EvaluationRoot.resolve())
        assert hashlib.sha256(packagePath.read_bytes()).hexdigest() == pin["sha256"]
        package = json.loads(packagePath.read_text(encoding="utf-8"))
        assert len(package["claims"]) == pin["claimCount"]
        assert package["moduleId"] == pin["moduleId"]
        unsigned = {key: field for key, field in package.items() if key != "contentHash"}
        assert contentDigest(unsigned) == package["contentHash"]


def testPublicClaimInventory():
    with (EvaluationRoot / "ClaimInventory.csv").open(encoding="utf-8", newline="") as inventoryFile:
        rows = list(csv.DictReader(inventoryFile))
    expected = {(str(number), claim["claimId"], claim["sourceId"], f"evaluation/modules/module{number}/claims.json")
                for number, package in enumerate(Packages, 1) for claim in package["claims"]}
    actual = {(row["module"], row["claimId"], row["sourceId"], row["publicPath"]) for row in rows}
    assert len(rows) == len(actual) == 78
    assert actual == expected
    assert {row["status"] for row in rows} == {"reviewedForEvaluation"}
    assert {row["claimId"] for row in rows if row["additionalReview"] == "True"} == {"N08", "N27", "M2NUrgentReferral"}


def testExactSourceBindingsAndSafeOfficialLinks():
    officialHosts = {"www.acog.org", "www.cdc.gov", "www.nice.org.uk", "www.nichd.nih.gov", "www.who.int", "www.acep.org"}
    for package in Packages:
        sources = {source["sourceId"]: source for source in package["sources"]}
        assert len(sources) == len(package["sources"])
        assert {claim["sourceId"] for claim in package["claims"]} == set(sources)
        for source in sources.values():
            assert set(source) == {"sourceId", "organization", "title", "publicationDate", "officialUrl", "urlVerificationStatus", "lifecycleStatus"}
            parsed = urlsplit(source["officialUrl"])
            assert parsed.scheme == "https" and parsed.hostname in officialHosts
            assert not parsed.username and not parsed.password and not parsed.fragment
            assert source["lifecycleStatus"] == "pendingReview"
            assert source["urlVerificationStatus"] in {"verifiedOfficialRetrieval", "unresolved"}


def testNoPrivateMetadataOrPublicationFiles():
    forbiddenKeys = {"sourceFileHash", "fileName", "byteSize", "pageCount", "mimeType", "provenance", "reviewDate", "verificationTimestamp", "reviewer", "reviewerId", "reviewerName", "sourceLocation"}

    def checkKeys(content):
        if isinstance(content, dict):
            assert not forbiddenKeys.intersection(content)
            for field in content.values():
                checkKeys(field)
        elif isinstance(content, list):
            for field in content:
                checkKeys(field)

    for package in Packages:
        checkKeys(package)
        encoded = json.dumps(package)
        assert not re.search(r"(?<![A-Za-z])[A-Za-z]:[\\/]|file://|/Users/|/home/|sourceIntake|privateEvidence|backend/competition/", encoded)
        for claim in package["claims"]:
            for text in [claim["supportedStatement"], claim["retrievalText"], *claim["conditions"], *claim["limitations"]]:
                assert not any(mark in text for mark in ['"', "“", "”", "<", ">"])
                assert "http" not in text
    for filePath in EvaluationRoot.rglob("*"):
        if filePath.is_file():
            assert filePath.suffix in {".json", ".md", ".csv"}
            assert filePath.stat().st_size < 200_000


def testSensitiveClinicalBoundariesRemainExplicit():
    claims = {claim["claimId"]: claim for _, claim in ClaimCases}
    assert "38.5" in claims["CdcTemperature"]["supportedStatement"]
    assert "38.3" in " ".join(claims["CdcTemperature"]["limitations"])
    assert "structured PID" in " ".join(claims["CdcTemperature"]["conditions"])
    assert "17" in " ".join(claims["N27"]["conditions"])
    assert "transvaginal" in claims["N18"]["supportedStatement"]
    assert "CA-125" in claims["N22"]["supportedStatement"]
    assert "July 13, 2015" in " ".join(claims["M2AIndeterminateHcg"]["limitations"])
    assert "not an instruction to attend an emergency department" in claims["CDCFaintingCare"]["supportedStatement"]
    assert "ongoing" in " ".join(claims["CDCPersistentDizzinessCare"]["conditions"])
    assert "cannot be reached" in " ".join(claims["CDCEmergencyAccess"]["conditions"])
    assert "haemodynamic" in " ".join(claims["M2NUrgentReferral"]["conditions"])
    assert "M2R" not in " ".join(claims)
