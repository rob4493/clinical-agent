"""Offline installed-SDK conformance with synthetic evidence and deterministic races."""

import copy
import inspect
import logging
import json
import subprocess
import sys
import traceback
from contextlib import ExitStack
from importlib.metadata import version
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

import grpc
import pytest
from pymilvus import MilvusClient, connections
from pymilvus.decorators import retry_on_rpc_failure
from pymilvus.exceptions import MilvusException

from backend.app.adapters.vectorStore.milvusStore import MilvusError, MilvusStore, StaleIndex, VectorSearchFailed, VectorWriteFailed, vectorDigest
from backend.app.config import Settings
from tests.support.evidenceFixture import SyntheticPackage
from tests.support.sdkMilvus import SdkMilvus
from tests.unit.testMilvus import createStore, indexStore, searchStore

PrivateMarkers = ("synthetic-credential", "https://synthetic-host.invalid", "synthetic-query-text", "synthetic-evidence-passage", "synthetic-clinical-content", "[0.125, 0.25, 0.5]", "synthetic-provider-payload")
PrivateMessage = " ".join(PrivateMarkers)


@pytest.fixture(autouse=True)
def guardConnections(caplog):
    """Capture every failure diagnostic and reject any transport construction or use."""
    attempts = []
    def reject(*arguments, **options):
        attempts.append(True)
        raise AssertionError("Connection prohibited")
    caplog.set_level(logging.DEBUG)
    with ExitStack() as guards:
        for target in ("socket.socket.connect", "socket.socket.connect_ex", "socket.socket.sendto", "socket.create_connection", "socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyname_ex", "socket.gethostbyaddr", "grpc.insecure_channel", "grpc.secure_channel", "grpc.aio.insecure_channel", "grpc.aio.secure_channel"):
            guards.enter_context(patch(target, side_effect=reject))
        guards.enter_context(patch.object(MilvusClient, "__init__", side_effect=reject))
        guards.enter_context(patch.object(connections, "connect", side_effect=reject))
        yield
    assert attempts == []
    for marker in PrivateMarkers:
        assert marker not in caplog.text
        assert all(marker not in repr(record.__dict__) for record in caplog.records)


def sdkStore(root, metric="IP"):
    provider = SdkMilvus()
    store, provider, chunks, directory = createStore(root, metric=metric, client=provider)
    return store, provider, chunks


def testInstalledSdkLifecycleAndExactForwarding(tmp_path):
    assert version("pymilvus") == "2.4.9"
    store, provider, chunks = sdkStore(tmp_path)
    assert provider.calls == [] and provider.transport.mock_calls == []
    assert not isinstance(provider, MilvusClient)
    indexStore(store, chunks)
    assert [hit.chunk.chunkId for hit in searchStore(store)] == [chunk.chunkId for chunk in chunks]
    name = store.collectionName("SyntheticAlpha")
    creation = provider.transport.create_collection.call_args
    assert creation.args[0] == name
    assert creation.kwargs == {"timeout": 30.0, "consistency_level": "Strong"}
    assert creation.args[1].to_dict()["enable_dynamic_field"] is False
    index = provider.transport.create_index.call_args
    assert index.args == (name, "Vector", {"index_type": "FLAT", "metric_type": "IP"})
    assert index.kwargs == {"timeout": 30.0, "index_name": "VectorIndex"}
    provider.transport.load_collection.assert_called_once_with(name, timeout=30.0)
    upsert = provider.transport.upsert_rows.call_args
    assert upsert.args[0] == name and len(upsert.args[1]) == 3
    assert upsert.kwargs == {"partition_name": "", "timeout": 30.0}
    search = provider.transport.search.call_args
    assert search.args == (name, [[1.0, 0.0, 0.0]], "Vector", {"metric_type": "IP", "params": {}})
    assert search.kwargs["limit"] == 3 and search.kwargs["consistency_level"] == "Strong"
    assert search.kwargs["partition_names"] is None and search.kwargs["timeout"] == 30.0
    expression = search.kwargs["expression"]
    for required in ("ModuleId", "Status", "PackageId", "PackageHash", "EvidenceVersion"):
        assert required in expression
    query = provider.transport.query.call_args
    assert query.args == (name,) and query.kwargs["limit"] == 10001
    assert query.kwargs["expr"] == 'ModuleId == "SyntheticAlpha"'
    assert "Vector" in query.kwargs["output_fields"]
    assert store.deletePackage("SyntheticAlpha", SyntheticPackage) is None
    deletion = provider.transport.delete.call_args
    assert deletion.args == (name, 'ModuleId == "SyntheticAlpha" and PackageId == "' + str(SyntheticPackage) + '"', "")
    assert deletion.kwargs == {"timeout": 30.0, "param_name": "filter or ids"}
    assert provider.storage.collections[name]["rows"] == {}
    assert "insert" not in [method for method, options in provider.calls]


@pytest.mark.parametrize("metric", ["IP", "COSINE", "L2"])
def testSdkNormalizesHitsWithoutCalibratingScores(tmp_path, metric):
    store, provider, chunks = sdkStore(tmp_path, metric)
    indexStore(store, chunks)
    def distances(response):
        for position, hit in enumerate(response[0]):
            hit["distance"] = [0.25, 0.25, 0.75][position]
        return response
    provider.storage.searchTransform = distances
    hits = searchStore(store)
    assert [hit.score for hit in hits] == ([-0.25, -0.25, -0.75] if metric == "L2" else [0.75, 0.25, 0.25])
    tied = [hit.chunk.chunkId.int for hit in hits if abs(hit.score) == 0.25]
    assert tied == sorted(tied)


@pytest.mark.parametrize("response", [None, {}, [], [None], [[{}]], [[], []], [[{"id": "bad", "distance": True, "entity": {}}]]])
def testSdkMalformedSearchOutputFailsClosed(tmp_path, response):
    store, provider, chunks = sdkStore(tmp_path)
    indexStore(store, chunks)
    provider.storage.searchTransform = lambda ignored: response
    with pytest.raises(VectorSearchFailed):
        searchStore(store)


@pytest.mark.parametrize("response", [None, {}, [None], [{}], ["synthetic-provider-payload"]])
def testSdkMalformedQueryOutputFailsClosed(tmp_path, response):
    store, provider, chunks = sdkStore(tmp_path)
    indexStore(store, chunks)
    provider.transport.query.return_value = response
    provider.transport.query.side_effect = None
    with pytest.raises(VectorSearchFailed):
        searchStore(store)


@pytest.mark.parametrize("method", ["create_collection", "create_index", "load_collection", "describe_collection", "list_indexes", "describe_index", "upsert_rows", "search", "query", "delete"])
@pytest.mark.parametrize("failure", ["sdk", "timeout", "unexpected"])
def testSdkFailuresAndLogsArePrivateWithoutApplicationRetries(tmp_path, caplog, method, failure):
    store, provider, chunks = sdkStore(tmp_path)
    if method not in {"create_collection", "create_index", "load_collection"}:
        indexStore(store, chunks)
    operation = getattr(provider.transport, method)
    operation.reset_mock()
    exception = MilvusException(message=PrivateMessage) if failure == "sdk" else TimeoutError(PrivateMessage) if failure == "timeout" else RuntimeError(PrivateMessage)
    def fail(*arguments, **options):
        # Exercise the installed SDK's real exception logger, not a fake clean message.
        from pymilvus.decorators import error_handler
        @error_handler(func_name="syntheticOperation")
        def raiseError():
            raise exception
        return raiseError()
    operation.side_effect = fail
    with pytest.raises(MilvusError) as caught:
        if method in {"create_collection", "create_index", "load_collection"}:
            store.ensureCollection("SyntheticAlpha", 3)
        elif method == "upsert_rows":
            provider.storage.collections[store.collectionName("SyntheticAlpha")]["rows"].clear()
            store.upsertChunks("SyntheticAlpha", chunks, [[1.0, 0.0, 0.0] for chunk in chunks])
        elif method == "delete":
            store.deletePackage("SyntheticAlpha", SyntheticPackage)
        else:
            searchStore(store)
    assert operation.call_count == 1
    assert caught.value.__suppress_context__
    assert all(marker not in "".join(traceback.format_exception(caught.value)) for marker in PrivateMarkers)
    assert any(record.message == "Vector provider diagnostic redacted." for record in caplog.records)


@pytest.mark.parametrize("shape", ["legacyKeys", "zeroOmitted", "booleanCount", "wrongCount"])
def testSdkDeleteAcknowledgementShapesRemainFailClosed(tmp_path, shape):
    store, provider, chunks = sdkStore(tmp_path)
    indexStore(store, chunks)
    provider.transport.delete.side_effect = None
    provider.transport.delete.return_value = SimpleNamespace(primary_keys=[str(chunk.chunkId) for chunk in chunks] if shape == "legacyKeys" else [], delete_count=0 if shape == "zeroOmitted" else True if shape == "booleanCount" else 2, cost=0)
    with pytest.raises(VectorWriteFailed):
        store.deletePackage("SyntheticAlpha", SyntheticPackage)
    assert len(provider.storage.collections[store.collectionName("SyntheticAlpha")]["rows"]) == 3


@pytest.mark.parametrize("mutation", ["vector", "missing", "schema", "package"])
def testConcurrentWriterDuringSdkSearchFailsClosed(tmp_path, mutation):
    store, provider, chunks = sdkStore(tmp_path)
    indexStore(store, chunks)
    def interleave(response):
        collection = provider.storage.collections[store.collectionName("SyntheticAlpha")]
        row = next(iter(collection["rows"].values()))
        if mutation == "vector":
            row["Vector"] = [0.0, 1.0, 0.0]
            row["Metadata"]["vectorHash"] = vectorDigest(row["Vector"])
        elif mutation == "missing":
            collection["rows"].pop(row["ChunkId"])
        elif mutation == "schema":
            collection["schema"]["fields"][-1]["params"]["dim"] = 4
        else:
            (store.loader.registry.moduleRoots["SyntheticAlpha"] / "chunks.json").write_bytes(b"synthetic changed artifact")
        return response
    provider.storage.searchTransform = interleave
    with pytest.raises(MilvusError):
        searchStore(store)
    assert provider.transport.search.call_count == 1


class RetryFailure(grpc.RpcError):
    """Synthetic retryable failure, without a channel or server."""
    def code(self):
        return grpc.StatusCode.UNAVAILABLE

    def details(self):
        return PrivateMessage


@pytest.mark.parametrize("timeout,attemptCount", [(30.0, 76), (30, 1)])
def testInstalledSdkDefaultRetriesAreNotAdapterRetries(tmp_path, monkeypatch, timeout, attemptCount):
    import pymilvus.decorators as decorators
    assert inspect.signature(retry_on_rpc_failure).parameters["retry_times"].default == 75
    sleeps = []
    clock = [0.0]
    def tick():
        clock[0] += 31.0
        return clock[0]
    monkeypatch.setattr(decorators.time, "sleep", sleeps.append)
    monkeypatch.setattr(decorators.time, "time", tick)
    store, provider, chunks = sdkStore(tmp_path)
    indexStore(store, chunks)
    attempts = []
    def retry(*arguments, **options):
        class Receiver:
            pass
        @retry_on_rpc_failure()
        def counted(receiver, *arguments, **options):
            attempts.append(True)
            raise RetryFailure()
        return counted(Receiver(), *arguments, **options)
    store.timeout = timeout
    provider.transport.search.side_effect = retry
    with pytest.raises(VectorSearchFailed):
        searchStore(store)
    assert len(attempts) == attemptCount
    assert provider.transport.search.call_count == 1
    assert sleeps[0] == 0.01 if sleeps else timeout == 30


@pytest.mark.parametrize("mutation", ["partial", "vector", "schema"])
def testConcurrentWriterDuringSdkUpsertCannotReportSuccess(tmp_path, mutation):
    store, provider, chunks = sdkStore(tmp_path)
    store.ensureCollection("SyntheticAlpha", 3)
    def interleave(arguments):
        collection = provider.storage.collections[arguments["collection_name"]]
        selected = arguments["data"][:1] if mutation == "partial" else arguments["data"]
        collection["rows"].update({row["ChunkId"]: copy.deepcopy(row) for row in selected})
        if mutation == "vector":
            row = next(iter(collection["rows"].values()))
            row["Vector"] = [0.0, 1.0, 0.0]
            row["Metadata"]["vectorHash"] = vectorDigest(row["Vector"])
        elif mutation == "schema":
            collection["schema"]["auto_id"] = True
        return {"upsert_count": len(arguments["data"])}
    provider.storage.upsertTransform = interleave
    with pytest.raises(MilvusError):
        store.upsertChunks("SyntheticAlpha", chunks, [[1.0, 0.0, 0.0] for chunk in chunks])
    assert provider.transport.upsert_rows.call_count == 1
    assert provider.transport.delete.call_count == 0


def testConcurrentDeletePartialFailureIsNotRolledBack(tmp_path):
    store, provider, chunks = sdkStore(tmp_path)
    indexStore(store, chunks)
    def partial(arguments):
        rows = provider.storage.collections[arguments["collection_name"]]["rows"]
        rows.pop(str(chunks[0].chunkId))
        return {"delete_count": 3}
    provider.storage.deleteTransform = partial
    with pytest.raises(VectorWriteFailed):
        store.deletePackage("SyntheticAlpha", SyntheticPackage)
    assert provider.transport.delete.call_count == 1
    assert provider.transport.upsert_rows.call_count == 1
    assert len(provider.storage.collections[store.collectionName("SyntheticAlpha")]["rows"]) == 2
    with pytest.raises(StaleIndex):
        searchStore(store)


def testSdkDiagnosticScopeRestoresAfterFailure(tmp_path, caplog):
    store, provider, chunks = sdkStore(tmp_path)
    indexStore(store, chunks)
    provider.transport.search.side_effect = RuntimeError(PrivateMessage)
    with pytest.raises(VectorSearchFailed):
        searchStore(store)
    logger = logging.getLogger("pymilvus.decorators")
    logger.warning("synthetic operational diagnostic outside adapter call")
    assert "synthetic operational diagnostic outside adapter call" in caplog.text


def testCollectionChangedDuringDeleteFailsEvenWhenSelectedRowsDisappear(tmp_path):
    store, provider, chunks = sdkStore(tmp_path)
    indexStore(store, chunks)
    def replacement(arguments):
        collection = provider.storage.collections[arguments["collection_name"]]
        collection["rows"].clear()
        collection["schema"]["enable_dynamic_field"] = True
        return {"delete_count": 3}
    provider.storage.deleteTransform = replacement
    with pytest.raises(MilvusError):
        store.deletePackage("SyntheticAlpha", SyntheticPackage)
    assert provider.transport.delete.call_count == 1


@pytest.mark.parametrize("mutation", ["duplicate", "module", "approval", "dimension", "provenance", "partial"])
def testInstalledSdkCannotNormalizeInvalidEvidenceIntoHits(tmp_path, mutation):
    store, provider, chunks = sdkStore(tmp_path)
    indexStore(store, chunks)
    def corrupt(response):
        result = response[0][0]
        if mutation == "duplicate":
            response[0][1] = copy.deepcopy(result)
        elif mutation == "partial":
            response[0].pop()
        elif mutation == "module":
            result["entity"]["ModuleId"] = "SyntheticOther"
        elif mutation == "approval":
            result["entity"]["Status"] = "pendingReview"
        elif mutation == "dimension":
            result["entity"]["Metadata"]["index"]["embeddingDimension"] = 4
        else:
            result["entity"]["Metadata"]["index"]["packageHash"] = "0" * 64
        return response
    provider.storage.searchTransform = corrupt
    with pytest.raises(MilvusError):
        searchStore(store)


def testGuardedApplicationConstructionHasZeroConnectionAttempts():
    script = '''
import json
from contextlib import ExitStack
from unittest.mock import patch
counts = dict(socket=0, dns=0, grpc=0, milvus=0)
def blocker(category):
    def reject(*arguments, **options):
        counts[category] += 1
        raise RuntimeError("Connection prohibited")
    return reject
with ExitStack() as guards:
    for target in ("socket.socket.connect", "socket.socket.connect_ex", "socket.socket.sendto", "socket.create_connection"):
        guards.enter_context(patch(target, side_effect=blocker("socket")))
    for target in ("socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyname_ex", "socket.gethostbyaddr"):
        guards.enter_context(patch(target, side_effect=blocker("dns")))
    import grpc
    for target in ("grpc.insecure_channel", "grpc.secure_channel", "grpc.aio.insecure_channel", "grpc.aio.secure_channel"):
        guards.enter_context(patch(target, side_effect=blocker("grpc")))
    import pkg_resources
    import environs
    from pymilvus import MilvusClient, connections
    from pymilvus.client.grpc_handler import GrpcHandler
    guards.enter_context(patch.object(MilvusClient, "__init__", side_effect=blocker("milvus")))
    guards.enter_context(patch.object(GrpcHandler, "__init__", side_effect=blocker("milvus")))
    guards.enter_context(patch.object(connections, "connect", side_effect=blocker("milvus")))
    from backend.app.main import createApp
    from backend.app.config import Settings
    application = createApp(Settings(_env_file=None))
    assert application.state.registry.listModules() == []
print(json.dumps(counts))
'''
    result = subprocess.run([sys.executable, "-B", "-c", script], cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"socket": 0, "dns": 0, "grpc": 0, "milvus": 0}


def testConcurrentOverwriteCannotBeExcludedBySnapshotChecks(tmp_path):
    store, provider, chunks = sdkStore(tmp_path)
    store.ensureCollection("SyntheticAlpha", 3)
    writer = MilvusStore(Settings(_env_file=None, milvusPrefix="synthetic", milvusMetric="IP"), provider, store.loader, 3, "synthetic-model")
    outcomes = []
    def interleave(name, rows, **options):
        provider.transport.upsert_rows.side_effect = provider.upsertRows
        writer.upsertChunks("SyntheticAlpha", chunks, [[0.0, 1.0, 0.0] for chunk in chunks])
        outcomes.append("secondWriterVerified")
        return provider.upsertRows(name, rows, **options)
    provider.transport.upsert_rows.side_effect = interleave
    store.upsertChunks("SyntheticAlpha", chunks, [[1.0, 0.0, 0.0] for chunk in chunks])
    outcomes.append("firstWriterVerified")
    assert outcomes == ["secondWriterVerified", "firstWriterVerified"]
    assert provider.transport.upsert_rows.call_count == 2
    assert all(row["Vector"] == [1.0, 0.0, 0.0] for row in provider.storage.collections[store.collectionName("SyntheticAlpha")]["rows"].values())
    # Both checked snapshots were valid; the later write cannot detect overwritten history.
    assert store.inspectIndex("SyntheticAlpha").status == "matching"
