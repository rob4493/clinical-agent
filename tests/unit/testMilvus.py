"""Synthetic-only production-shaped adapter regressions; no real SDK clients."""

import copy
import json
import subprocess
import sys
import traceback
from pathlib import Path
from uuid import UUID

import pytest

from backend.app.adapters.vectorStore.milvusStore import IndexProvenanceMissing, MilvusStore, StaleIndex, VectorSchemaMismatch, VectorSearchFailed, VectorStoreUnavailable, VectorWriteFailed
from backend.app.config import Settings
from backend.app.models.evidence import EvidenceManifest
from backend.app.modules.registry import ModuleRegistry
from backend.app.services.evidence import EvidenceLoader, readArtifact
from backend.app.services.retrieval import RetrievalService, SearchFilter
from tests.support.evidenceFixture import SyntheticPackage, buildModule, fileHash, makeChunk, refreshManifest, saveJson
from tests.support.fakeMilvus import FakeMilvus
from backend.demo.synthetic import SyntheticEmbedding


def createStore(root, count=3, moduleId="SyntheticAlpha", metric="IP", client=None):
    directory = buildModule(root, moduleId)
    chunks = [makeChunk(moduleId=moduleId, chunkId=UUID(int=position + 100)) for position in range(count)]
    saveJson(directory / "chunks.json", {"chunks": [chunk.model_dump(mode="json") for chunk in chunks]})
    registry = refreshManifest(directory, chunkCount=count, chunksHash=fileHash(directory / "chunks.json"))
    loader = EvidenceLoader(registry)
    provider = client if client is not None else FakeMilvus()
    store = MilvusStore(Settings(_env_file=None, milvusPrefix="synthetic", milvusMetric=metric), provider, loader, 3, "synthetic-model")
    return store, provider, chunks, directory


def indexStore(store, chunks):
    store.ensureCollection(chunks[0].moduleId, 3)
    store.upsertChunks(chunks[0].moduleId, chunks, [[1.0, 0.0, 0.0] for chunk in chunks])


def searchStore(store, moduleId="SyntheticAlpha", limit=8):
    return store.search(moduleId, [1.0, 0.0, 0.0], limit, SearchFilter(moduleId=moduleId, status="approved"))


def firstRow(store, client, moduleId="SyntheticAlpha"):
    return next(iter(client.collections[store.collectionName(moduleId)]["rows"].values()))


def addPackage(directory, packageId=UUID(int=777)):
    chunks = [makeChunk(chunkId=UUID(int=position + 200), packageId=packageId) for position in range(2)]
    saveJson(directory / "chunksBeta.json", {"chunks": [chunk.model_dump(mode="json") for chunk in chunks]})
    fields = json.loads(next((directory / "evidence").glob("*.json")).read_bytes())
    fields.update(packageId=str(packageId), chunksFile="chunksBeta.json", chunksHash=fileHash(directory / "chunksBeta.json"), chunkCount=2, packageHash=None)
    manifest = EvidenceManifest.model_validate_json(json.dumps(fields))
    filename = str(packageId) + ".json"
    saveJson(directory / "evidence" / filename, manifest.model_dump(mode="json"))
    config = json.loads((directory / "config.json").read_bytes())
    config["evidencePackages"][str(packageId)] = fileHash(directory / "evidence" / filename)
    saveJson(directory / "config.json", config)
    return chunks, ModuleRegistry(directory.parent)


def testInjectedLifecycleAndStableRanking(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    assert client.calls == []
    indexStore(store, list(reversed(chunks)))
    hits = searchStore(store, limit=2)
    assert [hit.chunk.chunkId for hit in hits] == [chunk.chunkId for chunk in chunks[:2]]
    assert all(set(hit.model_dump()) == {"chunk", "score"} for hit in hits)
    assert store.inspectIndex("SyntheticAlpha").status == "matching"
    checkpoint = store.inspectIndex("SyntheticAlpha").packages[0]
    assert checkpoint.chunkCount == 3 and checkpoint.indexSchemaVersion == 1
    assert checkpoint.indexedAt.utcoffset().total_seconds() == 0
    assert checkpoint.packageHash == store.loader.load("SyntheticAlpha")[0].manifest.packageHash
    assert checkpoint.embeddingId == "synthetic-model" and checkpoint.embeddingDimension == 3
    stored = json.dumps(list(client.collections.values()), default=str)
    assert "reviewerId" not in stored and "reviewerNotes" not in stored and "chunks.json" not in stored
    assert not hasattr(store, "queryText")
    calls = [arguments for method, arguments in client.calls if method == "search"]
    assert 'ModuleId == "SyntheticAlpha"' in calls[0]["filter"]
    assert 'Status == "approved"' in calls[0]["filter"]
    assert "PackageHash == " in calls[0]["filter"] and "EvidenceVersion == " in calls[0]["filter"]
    assert "Vector" not in calls[0]["output_fields"]


def testSchemaCreationAndIdempotency(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    store.ensureCollection("SyntheticAlpha", 3)
    schema = client.collections[store.collectionName("SyntheticAlpha")]["schema"]
    assert schema["auto_id"] is False and schema["enable_dynamic_field"] is False
    assert {field["name"] for field in schema["fields"]} == {"ChunkId", "ModuleId", "PackageId", "PackageHash", "SourceId", "Status", "EvidenceVersion", "ContentHash", "Metadata", "Vector"}
    store.ensureCollection("SyntheticAlpha", 3)
    assert sum(method == "create_collection" for method, arguments in client.calls) == 1
    indexStore(store, chunks)
    before = copy.deepcopy(client.collections)
    store.upsertChunks("SyntheticAlpha", chunks, [[1.0, 0.0, 0.0] for chunk in chunks])
    assert client.collections == before
    assert sum(method == "upsert" for method, arguments in client.calls) == 1


@pytest.mark.parametrize("change", ["dimension", "type", "primary", "primaryString", "length", "auto", "dynamic", "missing", "extra", "duplicate", "metric", "indexType", "indexName", "indexParams"])
def testConflictingSchemaFailsWithoutRecreation(tmp_path, change):
    store, client, chunks, directory = createStore(tmp_path)
    store.ensureCollection("SyntheticAlpha", 3)
    collection = client.collections[store.collectionName("SyntheticAlpha")]
    fields = collection["schema"]["fields"]
    if change == "dimension": fields[-1]["params"]["dim"] = 4
    elif change == "type": fields[0]["type"] = 5
    elif change == "primary": fields[0]["is_primary"] = False
    elif change == "primaryString": fields[0]["is_primary"] = "true"
    elif change == "length": fields[0]["params"]["max_length"] = 64
    elif change == "auto": collection["schema"]["auto_id"] = True
    elif change == "dynamic": collection["schema"]["enable_dynamic_field"] = True
    elif change == "missing": fields.pop()
    elif change == "extra": fields.append({"name": "Unexpected", "type": 21})
    elif change == "duplicate": fields[-1] = copy.deepcopy(fields[0])
    elif change == "metric": collection["indexes"][0]["metric_type"] = "L2"
    elif change == "indexType": collection["indexes"][0]["index_type"] = "HNSW"
    elif change == "indexName": collection["indexes"][0]["index_name"] = "Unexpected"
    elif change == "indexParams": collection["indexes"][0]["params"] = {"nprobe": 16}
    before = copy.deepcopy(client.collections)
    with pytest.raises(VectorSchemaMismatch): store.ensureCollection("SyntheticAlpha", 3)
    assert client.collections == before
    assert sum(method == "create_collection" for method, arguments in client.calls) == 1


@pytest.mark.parametrize("dimension", [0, -1, True, 3.0, 4, 65537])
def testDimensionFailsBeforeClientCalls(tmp_path, dimension):
    store, client, chunks, directory = createStore(tmp_path)
    with pytest.raises(VectorSchemaMismatch): store.ensureCollection("SyntheticAlpha", dimension)
    assert client.calls == []


def testLosslessCollectionNames(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    identifiers = ["ModuleA", "moduleA", "module-a", "module_a", "A" + "x" * 63]
    names = [store.collectionName(identifier) for identifier in identifiers]
    assert len(set(names)) == len(identifiers)
    assert all(name.isalnum() and name[0].isalpha() and len(name) <= 255 for name in names)
    assert store.collectionName("ModuleA") == names[0]


@pytest.mark.parametrize("moduleId", ["", "../Other", 'A" or true', "A B", 1, None])
def testInvalidModuleNeverTouchesProvider(tmp_path, moduleId):
    store, client, chunks, directory = createStore(tmp_path)
    with pytest.raises(VectorSchemaMismatch): store.ensureCollection(moduleId, 3)
    assert client.calls == []


@pytest.mark.parametrize("changes", [{"milvusPrefix": "bad_prefix"}, {"milvusPrefix": "../bad"}, {"milvusPrefix": "1bad"}, {"milvusPrefix": "A" * 33}, {"milvusMetric": "unknown"}, {"milvusIndexType": "HNSW"}, {"milvusTimeout": 0}, {"milvusTimeout": 121}, {"milvusTimeout": True}, {"milvusTimeout": float("nan")}, {"milvusTimeout": float("inf")}])
def testBoundedConfiguration(changes):
    with pytest.raises(ValueError): Settings(_env_file=None, **changes)


def testMissingPrefixDoesNotConnect(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    with pytest.raises(VectorStoreUnavailable): MilvusStore(Settings(_env_file=None), client, store.loader, 3, "synthetic-model")
    assert client.calls == []


@pytest.mark.parametrize("change", ["pending", "retired", "module", "duplicate", "empty", "count", "dimension", "nan", "infinity", "boolean", "overflow", "incompletePackage", "notApprovedPackage"])
def testUpsertPrevalidationIsAtomic(tmp_path, change):
    store, client, chunks, directory = createStore(tmp_path)
    store.ensureCollection("SyntheticAlpha", 3)
    vectors = [[1.0, 0.0, 0.0] for chunk in chunks]
    if change == "pending": chunks[0] = makeChunk(chunkId=chunks[0].chunkId, status="pendingReview")
    elif change == "retired": chunks[0] = makeChunk(chunkId=chunks[0].chunkId, status="retired")
    elif change == "module": chunks[0] = makeChunk(chunkId=chunks[0].chunkId, moduleId="SyntheticOther")
    elif change == "duplicate": chunks[1] = chunks[0]
    elif change == "empty": chunks, vectors = [], []
    elif change == "count": vectors.pop()
    elif change == "dimension": vectors[-1].pop()
    elif change == "nan": vectors[-1][0] = float("nan")
    elif change == "infinity": vectors[-1][0] = float("inf")
    elif change == "boolean": vectors[-1][0] = True
    elif change == "overflow": vectors[-1][0] = 1e300
    elif change == "incompletePackage": chunks.pop(); vectors.pop()
    elif change == "notApprovedPackage": chunks[0] = makeChunk(chunkId=chunks[0].chunkId, packageId=UUID(int=1234))
    before = copy.deepcopy(client.collections)
    with pytest.raises(VectorWriteFailed): store.upsertChunks("SyntheticAlpha", chunks, vectors)
    assert client.collections == before
    assert not any(method == "upsert" for method, arguments in client.calls)


@pytest.mark.parametrize("field", ["packageHash", "evidenceVersion", "chunkCount", "embeddingId", "embeddingDimension", "indexSchemaVersion"])
def testStaleCheckpointBlocksSearchAndUpsertWithoutDeleting(tmp_path, field):
    store, client, chunks, directory = createStore(tmp_path)
    indexStore(store, chunks)
    for row in client.collections[store.collectionName("SyntheticAlpha")]["rows"].values():
        checkpoint = row["Metadata"]["index"]
        checkpoint[field] = "0" * 64 if field == "packageHash" else "synthetic-other" if isinstance(checkpoint[field], str) else checkpoint[field] + 1
        if field == "packageHash": row["PackageHash"] = checkpoint[field]
        if field == "evidenceVersion":
            row["EvidenceVersion"] = checkpoint[field]
            row["Metadata"]["chunk"]["evidenceVersion"] = checkpoint[field]
            row["Metadata"]["chunk"]["contentHash"] = None
            updated = makeChunk(chunkId=UUID(row["ChunkId"]), evidenceVersion=checkpoint[field])
            row["Metadata"]["chunk"] = updated.model_dump(mode="json")
            row["ContentHash"] = updated.contentHash
    before = copy.deepcopy(client.collections)
    with pytest.raises(StaleIndex): searchStore(store)
    with pytest.raises(StaleIndex): store.upsertChunks("SyntheticAlpha", chunks, [[1.0, 0.0, 0.0] for chunk in chunks])
    assert store.inspectIndex("SyntheticAlpha").status == "stale"
    assert client.collections == before
    assert not any(method == "delete" for method, arguments in client.calls)


def testMissingProvenanceAndPartialIndexFailClosed(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    store.ensureCollection("SyntheticAlpha", 3)
    assert store.inspectIndex("SyntheticAlpha").status == "empty"
    with pytest.raises(IndexProvenanceMissing): searchStore(store)
    indexStore(store, chunks)
    row = firstRow(store, client)
    del row["Metadata"]["index"]
    with pytest.raises(IndexProvenanceMissing): searchStore(store)
    assert store.inspectIndex("SyntheticAlpha").status == "incomplete"


def testDeletedChunkMakesIndexStale(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    indexStore(store, chunks)
    client.collections[store.collectionName("SyntheticAlpha")]["rows"].pop(str(chunks[0].chunkId))
    with pytest.raises(StaleIndex): searchStore(store)


def testConflictingVectorCannotOverwriteSameChunk(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    indexStore(store, chunks)
    before = copy.deepcopy(client.collections)
    with pytest.raises(StaleIndex): store.upsertChunks("SyntheticAlpha", chunks, [[0.0, 1.0, 0.0] for chunk in chunks])
    assert client.collections == before


@pytest.mark.parametrize("change", ["module", "status", "missing", "extra", "hash", "vector", "reviewNotes", "duplicate", "container"])
def testMalformedStoredRecordsFailClosed(tmp_path, change):
    store, client, chunks, directory = createStore(tmp_path)
    indexStore(store, chunks)
    def corrupt(rows):
        if change == "container": return {}
        if change == "duplicate": return rows + [rows[0]]
        row = rows[0]
        if change == "module": row["ModuleId"] = "SyntheticOther"
        elif change == "status": row["Status"] = "retired"
        elif change == "missing": del row["ContentHash"]
        elif change == "extra": row["CaseText"] = "synthetic submitted content"
        elif change == "hash": row["ContentHash"] = "0" * 64
        elif change == "vector": row["Vector"] = [float("nan"), 0.0, 0.0]
        elif change == "reviewNotes": row["Metadata"]["reviewerNotes"] = "synthetic note"
        return rows
    client.queryTransform = corrupt
    with pytest.raises(VectorSearchFailed): searchStore(store)


@pytest.mark.parametrize("change", ["module", "pending", "retired", "missing", "extra", "vector", "nan", "infinity", "boolean", "duplicate", "fewer", "container", "id"])
def testMalformedSearchResponsesFailClosed(tmp_path, change):
    store, client, chunks, directory = createStore(tmp_path)
    indexStore(store, chunks)
    def corrupt(response):
        if change == "container": return {}
        if change == "duplicate": response[0][1] = copy.deepcopy(response[0][0])
        elif change == "fewer": response[0].pop()
        else:
            result = response[0][0]
            if change == "module": result["entity"]["ModuleId"] = "SyntheticOther"
            elif change in {"pending", "retired"}: result["entity"]["Status"] = change
            elif change == "missing": del result["entity"]["Metadata"]
            elif change == "extra": result["entity"]["Credentials"] = "synthetic-token"
            elif change == "vector": result["entity"]["Vector"] = [1.0, 0.0, 0.0]
            elif change == "nan": result["distance"] = float("nan")
            elif change == "infinity": result["distance"] = float("inf")
            elif change == "boolean": result["distance"] = True
            elif change == "id": result["id"] = str(UUID(int=333))
        return response
    client.searchTransform = corrupt
    with pytest.raises(VectorSearchFailed): searchStore(store)


@pytest.mark.parametrize("limit", [0, 51, True, 2.0, "2", None])
def testSearchLimitsFailBeforeClientCalls(tmp_path, limit):
    store, client, chunks, directory = createStore(tmp_path)
    with pytest.raises(VectorSearchFailed): searchStore(store, limit=limit)
    assert client.calls == []


def testStructuredFilterCannotBeReplacedByExpression(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    with pytest.raises(VectorSearchFailed): store.search("SyntheticAlpha", [1.0, 0.0, 0.0], 8, 'Status == "pendingReview" or true')
    with pytest.raises(VectorSearchFailed): store.search("SyntheticAlpha", [1.0, 0.0, 0.0], 8, SearchFilter(moduleId="SyntheticOther", status="approved"))
    assert client.calls == []


@pytest.mark.parametrize("method,errorClass", [("create_collection", VectorSchemaMismatch), ("upsert", VectorWriteFailed), ("search", VectorSearchFailed), ("delete", VectorWriteFailed)])
def testProviderFailuresArePrivate(tmp_path, caplog, method, errorClass):
    store, client, chunks, directory = createStore(tmp_path)
    secret = "synthetic-token-secret-and-submitted-clinical-text"
    if method != "create_collection": indexStore(store, chunks)
    client.failureText = secret + " https://synthetic-private-host/database"
    client.failMethod = method
    with pytest.raises(errorClass) as failure:
        if method == "create_collection": store.ensureCollection("SyntheticAlpha", 3)
        elif method == "upsert":
            client.collections[store.collectionName("SyntheticAlpha")]["rows"].clear()
            store.upsertChunks("SyntheticAlpha", chunks, [[1.0, 0.0, 0.0] for chunk in chunks])
        elif method == "search": searchStore(store)
        elif method == "delete": store.deletePackage("SyntheticAlpha", SyntheticPackage)
    formatted = "".join(traceback.format_exception(failure.value))
    assert secret not in str(failure.value) + repr(failure.value) + formatted + caplog.text
    assert "synthetic-private-host" not in formatted
    assert failure.value.__suppress_context__


def testDeleteIsPackageAndModuleScoped(tmp_path):
    client = FakeMilvus()
    store, client, chunks, directory = createStore(tmp_path, client=client)
    other, client, otherChunks, otherDirectory = createStore(tmp_path, moduleId="SyntheticOther", client=client)
    indexStore(store, chunks)
    indexStore(other, otherChunks)
    otherSnapshot = copy.deepcopy(client.collections[other.collectionName("SyntheticOther")])
    assert store.deletePackage("SyntheticAlpha", UUID(int=999)) is None
    assert len(searchStore(store)) == 3
    assert store.deletePackage("SyntheticAlpha", SyntheticPackage) is None
    assert client.collections[store.collectionName("SyntheticAlpha")]["rows"] == {}
    assert client.collections[other.collectionName("SyntheticOther")] == otherSnapshot
    assert len(searchStore(other, "SyntheticOther")) == 3
    expression = next(arguments["filter"] for method, arguments in client.calls if method == "delete")
    assert 'ModuleId == "SyntheticAlpha"' in expression and str(SyntheticPackage) in expression
    assert store.inspectIndex("SyntheticAlpha").status == "empty"


def testFailedDeletionPreservesCheckpoint(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    indexStore(store, chunks)
    before = copy.deepcopy(client.collections)
    client.failMethod = "delete"
    with pytest.raises(VectorWriteFailed): store.deletePackage("SyntheticAlpha", SyntheticPackage)
    assert client.collections == before
    assert store.inspectIndex("SyntheticAlpha").status == "matching"


@pytest.mark.parametrize("packageId", [None, str(SyntheticPackage), 'bad" or true', 1])
def testDeleteRequiresExplicitUuid(tmp_path, packageId):
    store, client, chunks, directory = createStore(tmp_path)
    with pytest.raises(VectorWriteFailed): store.deletePackage("SyntheticAlpha", packageId)
    assert client.calls == []


@pytest.mark.parametrize("metric", ["IP", "COSINE", "L2"])
def testMetricAwareStableOrdering(tmp_path, metric):
    store, client, chunks, directory = createStore(tmp_path, metric=metric)
    store.ensureCollection("SyntheticAlpha", 3)
    store.upsertChunks("SyntheticAlpha", chunks, [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]])
    hits = searchStore(store)
    assert [hit.chunk.chunkId for hit in hits] == [chunks[0].chunkId, chunks[2].chunkId, chunks[1].chunkId]
    assert hits[0].score == hits[1].score and hits[1].score > hits[2].score


def testRetrievalServiceUsesAdapterWithoutPublicContractChanges(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    service = RetrievalService(store.loader, SyntheticEmbedding(3), store, 3)
    queryText = "synthetic query alpha"
    results = service.retrieve("SyntheticAlpha", queryText, 2)
    assert [result.chunkId for result in results] == [chunk.chunkId for chunk in chunks[:2]]
    assert all(set(result.model_dump()) == {"chunkId", "moduleId", "sourceId", "claimIds", "category", "text", "citationLabel", "verifiedUrl", "sourcePages", "score", "evidenceVersion"} for result in results)
    assert queryText not in json.dumps(client.calls, default=str)
    store.embeddingId = "synthetic-changed-model"
    with pytest.raises(StaleIndex): service.retrieve("SyntheticAlpha", queryText)


def testInstancesDoNotShareClientsOrState(tmp_path):
    first, firstClient, firstChunks, directory = createStore(tmp_path / "first")
    second, secondClient, secondChunks, directory = createStore(tmp_path / "second")
    indexStore(first, firstChunks)
    assert secondClient.collections == {} and secondClient.calls == []
    assert first.client is not second.client


def testSyntheticStaleModuleDoesNotAffectAnother(tmp_path):
    client = FakeMilvus()
    first, client, chunks, directory = createStore(tmp_path, client=client)
    second, client, otherChunks, directory = createStore(tmp_path, moduleId="SyntheticOther", client=client)
    indexStore(first, chunks)
    indexStore(second, otherChunks)
    first.embeddingId = "synthetic-changed-model"
    with pytest.raises(StaleIndex): searchStore(first)
    assert len(searchStore(second, "SyntheticOther")) == 3


def testChangedArtifactsBlockAlreadyIndexedEvidence(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    indexStore(store, chunks)
    (directory / "chunks.json").write_bytes(b"synthetic changed artifact")
    before = copy.deepcopy(client.collections)
    with pytest.raises(StaleIndex): searchStore(store)
    assert client.collections == before


def testRaceBetweenValidationAndFirstWriteIsRejected(tmp_path, monkeypatch):
    store, client, chunks, directory = createStore(tmp_path)
    store.ensureCollection("SyntheticAlpha", 3)
    original = store.loader.load
    count = 0
    def changeAfterLoad(moduleId):
        nonlocal count
        packages = original(moduleId)
        count += 1
        if count == 1: (directory / "chunks.json").write_bytes(b"synthetic race")
        return packages
    monkeypatch.setattr(store.loader, "load", changeAfterLoad)
    with pytest.raises(StaleIndex): store.upsertChunks("SyntheticAlpha", chunks, [[1.0, 0.0, 0.0] for chunk in chunks])
    assert not any(method == "upsert" for method, arguments in client.calls)


def testSafeReadRejectsIdentityChangeBeforeOpening(tmp_path, monkeypatch):
    import backend.app.services.evidence as evidence
    path = tmp_path / "synthetic.bin"
    path.write_bytes(b"synthetic first")
    original = evidence.os.open
    def replaceBeforeOpen(filename, flags):
        path.unlink()
        path.write_bytes(b"synthetic changed length")
        return original(filename, flags)
    monkeypatch.setattr(evidence.os, "open", replaceBeforeOpen)
    with pytest.raises(ValueError): readArtifact(tmp_path, "synthetic.bin")


def testAuthenticModulesCannotCauseIndexOperations():
    settings = Settings(_env_file=None, milvusPrefix="synthetic")
    loader = EvidenceLoader(ModuleRegistry(settings.moduleRoot, settings))
    client = FakeMilvus()
    store = MilvusStore(settings, client, loader, 3, "synthetic-model")
    for moduleId in loader.registry.moduleConfigs:
        assert not loader.registry.getModule(moduleId).active
        assert loader.registry.getModule(moduleId).status != "approved"
        with pytest.raises(StaleIndex): searchStore(store, moduleId)
    assert client.calls == []
    assert loader.registry.listModules() == []


def testImportAndAppConstructionNeverConnect():
    script = '''
from contextlib import ExitStack
from unittest.mock import patch
attempts = []
def rejectCall(*arguments, **options):
    attempts.append(True)
    raise RuntimeError("Connection prohibited")
with ExitStack() as guards:
    for target in ["socket.socket.connect", "socket.socket.connect_ex", "socket.create_connection", "socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyname_ex"]:
        guards.enter_context(patch(target, side_effect=rejectCall))
    import grpc
    for target in ["grpc.insecure_channel", "grpc.secure_channel", "grpc.aio.insecure_channel", "grpc.aio.secure_channel"]:
        guards.enter_context(patch(target, side_effect=rejectCall))
    from pymilvus import MilvusClient, connections
    guards.enter_context(patch.object(MilvusClient, "__init__", side_effect=rejectCall))
    guards.enter_context(patch.object(connections, "connect", side_effect=rejectCall))
    from backend.app.adapters.vectorStore.milvusStore import MilvusStore
    from backend.app.main import createApp
    from backend.app.config import Settings
    from backend.app.services.evidence import EvidenceLoader
    from backend.app.modules.registry import ModuleRegistry
    from backend.app.api.discovery import checkReady
    from fastapi import Response
    settings = Settings(_env_file=None, milvusPrefix="synthetic")
    application = createApp(settings)
    loader = EvidenceLoader(application.state.registry)
    store = MilvusStore(settings, object(), loader, 3, "synthetic-model")
    response = Response()
    assert checkReady(response, application.state.registry).availableModuleCount == 0
    assert response.status_code == 503 and not attempts
'''
    completed = subprocess.run([sys.executable, "-B", "-c", script], cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, timeout=60)
    assert completed.returncode == 0, completed.stderr


def testMultiplePackagesNeverFallBackWhenOneIsMissing(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    beta, registry = addPackage(directory)
    store.loader = EvidenceLoader(registry)
    indexStore(store, chunks)
    with pytest.raises(IndexProvenanceMissing): searchStore(store)
    store.upsertChunks("SyntheticAlpha", beta, [[1.0, 0.0, 0.0] for chunk in beta])
    assert len(searchStore(store)) == 5
    rows = client.collections[store.collectionName("SyntheticAlpha")]["rows"]
    expected = {identifier: copy.deepcopy(row) for identifier, row in rows.items() if row["PackageId"] == str(beta[0].packageId)}
    store.deletePackage("SyntheticAlpha", SyntheticPackage)
    assert rows == expected
    assert store.inspectIndex("SyntheticAlpha").status == "incomplete"
    with pytest.raises(IndexProvenanceMissing): searchStore(store)


def testRetiredPackageCannotRemainSearchable(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    indexStore(store, chunks)
    beta, registry = addPackage(directory)
    original = directory / "evidence" / (str(SyntheticPackage) + ".json")
    original.unlink()
    config = json.loads((directory / "config.json").read_bytes())
    config["evidencePackages"].pop(str(SyntheticPackage))
    saveJson(directory / "config.json", config)
    store.loader = EvidenceLoader(ModuleRegistry(directory.parent))
    before = copy.deepcopy(client.collections)
    with pytest.raises(StaleIndex): searchStore(store)
    with pytest.raises(StaleIndex): store.upsertChunks("SyntheticAlpha", beta, [[1.0, 0.0, 0.0] for chunk in beta])
    assert client.collections == before


def testChangedApprovedPackageHashCannotBeSilentlyReindexed(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    indexStore(store, chunks)
    changed = [makeChunk(chunkId=chunk.chunkId, text="synthetic revised condition beta") for chunk in chunks]
    saveJson(directory / "chunks.json", {"chunks": [chunk.model_dump(mode="json") for chunk in changed]})
    store.loader = EvidenceLoader(refreshManifest(directory, chunksHash=fileHash(directory / "chunks.json")))
    before = copy.deepcopy(client.collections)
    with pytest.raises(StaleIndex): searchStore(store)
    with pytest.raises(StaleIndex): store.upsertChunks("SyntheticAlpha", changed, [[1.0, 0.0, 0.0] for chunk in changed])
    assert client.collections == before


def testNewAdapterValidatesPersistentProvenance(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    indexStore(store, chunks)
    restored = MilvusStore(Settings(_env_file=None, milvusPrefix="synthetic", milvusMetric="IP"), client,
        EvidenceLoader(ModuleRegistry(directory.parent)), 3, "synthetic-model")
    assert len(searchStore(restored)) == 3
    restored.embeddingId = "synthetic-replacement"
    with pytest.raises(StaleIndex): searchStore(restored)


def testPartialProviderWriteNeverBecomesSearchable(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    store.ensureCollection("SyntheticAlpha", 3)
    def partialWrite(arguments):
        row = arguments["data"][0]
        client.collections[arguments["collection_name"]]["rows"][row["ChunkId"]] = copy.deepcopy(row)
        return {"upsert_count": len(arguments["data"])}
    client.upsertTransform = partialWrite
    with pytest.raises(StaleIndex): store.upsertChunks("SyntheticAlpha", chunks, [[1.0, 0.0, 0.0] for chunk in chunks])
    with pytest.raises(StaleIndex): searchStore(store)
    assert len(client.collections[store.collectionName("SyntheticAlpha")]["rows"]) == 1
    assert not any(method == "delete" for method, arguments in client.calls)


@pytest.mark.parametrize("acknowledgement", [{}, {"upsert_count": True}, {"upsert_count": 0}, None])
def testWriteAcknowledgementIsVerified(tmp_path, acknowledgement):
    store, client, chunks, directory = createStore(tmp_path)
    store.ensureCollection("SyntheticAlpha", 3)
    client.upsertTransform = lambda arguments: acknowledgement
    with pytest.raises(VectorWriteFailed): store.upsertChunks("SyntheticAlpha", chunks, [[1.0, 0.0, 0.0] for chunk in chunks])
    assert client.collections[store.collectionName("SyntheticAlpha")]["rows"] == {}


def testDeleteAcknowledgementCannotHideRemainingRecords(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    indexStore(store, chunks)
    before = copy.deepcopy(client.collections)
    client.deleteTransform = lambda arguments: {"delete_count": 3}
    with pytest.raises(VectorWriteFailed): store.deletePackage("SyntheticAlpha", SyntheticPackage)
    assert client.collections == before


def testChangeDuringProviderWriteIsNotSuccessful(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    store.ensureCollection("SyntheticAlpha", 3)
    original = client.upsert
    def changingWrite(**arguments):
        result = original(**arguments)
        (directory / "chunks.json").write_bytes(b"synthetic replaced during write")
        return result
    client.upsert = changingWrite
    with pytest.raises(StaleIndex): store.upsertChunks("SyntheticAlpha", chunks, [[1.0, 0.0, 0.0] for chunk in chunks])
    with pytest.raises(StaleIndex): searchStore(store)
    assert not any(method == "delete" for method, arguments in client.calls)


def testSafeReadRejectsChangesDuringRead(tmp_path, monkeypatch):
    import backend.app.services.evidence as evidence
    path = tmp_path / "synthetic.bin"
    path.write_bytes(b"synthetic first")
    original = evidence.os.fstat
    count = 0
    def changeOnSecondStat(descriptor):
        nonlocal count
        count += 1
        if count == 2: path.write_bytes(b"synthetic changed during read")
        return original(descriptor)
    monkeypatch.setattr(evidence.os, "fstat", changeOnSecondStat)
    with pytest.raises(ValueError): readArtifact(tmp_path, "synthetic.bin")


@pytest.mark.parametrize("vector", [[1.0, 0.0], [float("nan"), 0.0, 0.0], [float("inf"), 0.0, 0.0], [True, 0.0, 0.0], [1e300, 0.0, 0.0]])
def testInvalidQueryVectorsDoNotReachClient(tmp_path, vector):
    store, client, chunks, directory = createStore(tmp_path)
    with pytest.raises(VectorSearchFailed): store.search("SyntheticAlpha", vector, 8, SearchFilter(moduleId="SyntheticAlpha", status="approved"))
    assert client.calls == []


def testCosineZeroVectorIsRejected(tmp_path):
    store, client, chunks, directory = createStore(tmp_path, metric="COSINE")
    store.ensureCollection("SyntheticAlpha", 3)
    with pytest.raises(VectorWriteFailed): store.upsertChunks("SyntheticAlpha", chunks, [[0.0, 0.0, 0.0] for chunk in chunks])
    before = len(client.calls)
    with pytest.raises(VectorSearchFailed): store.search("SyntheticAlpha", [0.0, 0.0, 0.0], 8, SearchFilter(moduleId="SyntheticAlpha", status="approved"))
    assert len(client.calls) == before


def testConfiguredDimensionMustAgreeWithAdapter(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    settings = Settings(_env_file=None, milvusPrefix="synthetic", watsonxEmbeddingDimension=4)
    with pytest.raises(VectorStoreUnavailable): MilvusStore(settings, client, store.loader, 3, "synthetic-model")
    assert client.calls == []


@pytest.mark.parametrize("change", ["naiveTime", "extra", "missingHash", "fieldType"])
def testMalformedProvenanceCannotBecomeStatusOrHits(tmp_path, change):
    store, client, chunks, directory = createStore(tmp_path)
    indexStore(store, chunks)
    row = firstRow(store, client)
    if change == "naiveTime": row["Metadata"]["index"]["indexedAt"] = "2026-10-08T12:00:00"
    elif change == "extra": row["Metadata"]["index"]["CaseText"] = "synthetic submitted text"
    elif change == "missingHash": del row["Metadata"]["chunk"]["contentHash"]
    elif change == "fieldType": row["Metadata"]["index"]["chunkCount"] = "3"
    with pytest.raises(VectorSearchFailed): searchStore(store)
    with pytest.raises(VectorSearchFailed): store.inspectIndex("SyntheticAlpha")


def testInactiveModulesCannotCreateCollections():
    settings = Settings(_env_file=None, milvusPrefix="synthetic")
    loader = EvidenceLoader(ModuleRegistry(settings.moduleRoot, settings))
    client = FakeMilvus()
    store = MilvusStore(settings, client, loader, 3, "synthetic-model")
    for moduleId in loader.registry.moduleConfigs:
        with pytest.raises(StaleIndex): store.ensureCollection(moduleId, 3)
    assert client.calls == []


def testSettingsAndAdapterRepresentationsDoNotExposeSecrets(tmp_path):
    store, client, chunks, directory = createStore(tmp_path)
    secret = "synthetic-private-credential"
    settings = Settings(_env_file=None, milvusPrefix="synthetic", adminApiKey=secret, watsonxApiKey=secret, milvusHost=secret)
    adapter = MilvusStore(settings, client, store.loader, 3, "synthetic-model")
    assert secret not in repr(adapter) + repr(settings) + str(settings) + settings.model_dump_json()
    assert "settings" not in vars(adapter)


def testVectorEnvironmentAliases(monkeypatch):
    monkeypatch.setenv("MILVUS_PREFIX", "syntheticPrefix")
    monkeypatch.setenv("MILVUS_METRIC", "L2")
    monkeypatch.setenv("MILVUS_INDEX_TYPE", "FLAT")
    monkeypatch.setenv("MILVUS_TIMEOUT", "12.5")
    settings = Settings(_env_file=None)
    assert settings.milvusPrefix == "syntheticPrefix"
    assert settings.milvusMetric == "L2" and settings.milvusIndexType == "FLAT"
    assert settings.milvusTimeout == 12.5


def testNegativeL2DistanceIsMalformed(tmp_path):
    store, client, chunks, directory = createStore(tmp_path, metric="L2")
    indexStore(store, chunks)
    def corrupt(response):
        response[0][0]["distance"] = -1.0
        return response
    client.searchTransform = corrupt
    with pytest.raises(VectorSearchFailed): searchStore(store)
