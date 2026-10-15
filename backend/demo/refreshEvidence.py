"""Deliberate demo-only artifact refresh; never reads or changes authentic modules."""

import hashlib
import json
from pathlib import Path

from backend.app.models.catalog import SourceRecord
from backend.app.models.evidence import EvidenceManifest
from backend.app.models.retrieval import KnowledgeChunk
from backend.app.modules.reviews import metadataDigest
from backend.app.modules.catalog import resolveFile
from backend.demo.cases import CaseParts
from backend.demo.policy import TestParts
from backend.demo.runtime import DemoWarnings


def refreshDemo():
    root = Path(__file__).parent / "artifacts" / "SyntheticDemo"
    if not root.resolve(strict=True).is_relative_to(Path(__file__).parent.resolve(strict=True)):
        raise ValueError("Invalid synthetic artifact root.")
    def readJson(name):
        return json.loads(resolveFile(root, name).read_bytes())
    def saveJson(name, content):
        resolveFile(root, name).write_text(json.dumps(content, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    def fileHash(name):
        return hashlib.sha256(resolveFile(root, name).read_bytes()).hexdigest()
    vocabulary = {"status": "Demonstration only; no clinical authority", "statements": [text for parts in (*CaseParts.values(), *TestParts.values()) for text in parts] + list(DemoWarnings.values())}
    saveJson("source.bin", vocabulary)
    saveJson("knowledge.bin", {"scope": "Bounded synthetic pelvic-pain review", **vocabulary})
    sources = readJson("sources.json")
    sources["sources"][0]["verifiedUrl"] = None
    source = SourceRecord.model_validate(sources["sources"][0])
    saveJson("sources.json", sources)
    review = readJson("reviews/first.json")
    review.update(knowledgeHash=fileHash("knowledge.bin"), metadataHash=metadataDigest(source), urlVerified=None)
    saveJson("reviews/first.json", review)
    saveJson("reviewSet.json", {"reviews": [review]})
    claims = readJson("approvedClaims.json")
    claims["claims"][0]["knowledgeHash"] = fileHash("knowledge.bin")
    saveJson("approvedClaims.json", claims)
    chunks = readJson("chunks.json")
    chunk = chunks["chunks"][0]
    chunk.update(verifiedUrl=None, knowledgeHash=fileHash("knowledge.bin"), sourceHash=fileHash("source.bin"))
    chunk["text"] = "Available review statements: " + " ".join(vocabulary["statements"])
    chunk.pop("contentHash")
    validated = KnowledgeChunk.model_validate_json(json.dumps(chunk))
    saveJson("chunks.json", {"chunks": [validated.model_dump(mode="json")]})
    manifestName = "evidence/00000000-0000-4000-8000-000000000010.json"
    manifest = readJson(manifestName)
    manifest.pop("packageHash")
    for field, name in [("knowledgeHash", "knowledge.bin"), ("sourceCatalogHash", "sources.json"), ("claimsHash", "approvedClaims.json"), ("reviewSetHash", "reviewSet.json"), ("chunksHash", "chunks.json")]:
        manifest[field] = fileHash(name)
    manifest["sourceArtifacts"]["SyntheticSource"]["sourceHash"] = fileHash("source.bin")
    manifest = EvidenceManifest.model_validate_json(json.dumps(manifest))
    saveJson(manifestName, manifest.model_dump(mode="json"))
    config = readJson("config.json")
    config["knowledgeChecksums"]["knowledge.bin"] = fileHash("knowledge.bin")
    config["evidencePackages"][str(manifest.packageId)] = fileHash(manifestName)
    saveJson("config.json", config)


if __name__ == "__main__":
    refreshDemo()
