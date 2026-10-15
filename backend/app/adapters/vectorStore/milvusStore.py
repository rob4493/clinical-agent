"""Injected Milvus boundary; no client construction, credentials or fallback."""

import json
import logging
import math
import re
import struct
from datetime import datetime, timezone
from contextvars import ContextVar
from functools import wraps
from threading import RLock
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, Field

from backend.app.config import Settings
from backend.app.models.catalog import Digest
from backend.app.models.contracts import ModuleId
from backend.app.models.evidence import EvidencePackage
from backend.app.models.retrieval import ChunkStatus, EvidenceModel, KnowledgeChunk, MetadataText, canonicalHash
from backend.app.services.evidence import EvidenceLoader, EvidenceUnavailableError
from backend.app.services.retrieval import SearchFilter, VectorHit, VectorStoreError, checkModule, checkVector

IndexSchemaVersion = 1
ModuleLimit = 10000
RecordFields = ("ChunkId", "ModuleId", "PackageId", "SourceId", "PackageHash", "Status", "EvidenceVersion", "ContentHash", "Metadata")
ProviderCall = ContextVar("milvusProviderCall", default=False)


class ProviderLogFilter(logging.Filter):
    """Redact synchronous SDK diagnostics before any logger handlers receive them."""

    def filter(self, record):
        if ProviderCall.get():
            record.msg = "Vector provider diagnostic redacted."
            record.args = ()
            record.exc_info = None
            record.exc_text = None
            record.stack_info = None
        return True


# These are the installed SDK loggers used by synchronous RPC/client operations.
# Context-local activation preserves unrelated diagnostics and never hides warnings.
for loggerName in ("pymilvus.decorators", "pymilvus.milvus_client.milvus_client", "pymilvus.client.grpc_handler"):
    logging.getLogger(loggerName).addFilter(ProviderLogFilter())


class MilvusError(VectorStoreError):
    """Fixed-message errors never retain a raw provider payload in their arguments."""
    message = "Vector operation is unavailable."

class VectorStoreUnavailable(MilvusError):
    message = "Vector store is unavailable."


class VectorSchemaMismatch(MilvusError):
    message = "Vector schema does not match the configured contract."


class VectorWriteFailed(MilvusError):
    message = "Vector write could not be verified."


class VectorSearchFailed(MilvusError):
    message = "Vector search could not be verified."


class StaleIndex(MilvusError):
    message = "Vector index provenance is stale."


class IndexProvenanceMissing(MilvusError):
    message = "Vector index provenance is incomplete."


class IndexProvenance(EvidenceModel):
    """Persistent package checkpoint; no reviewer identity, text or credentials."""
    moduleId: ModuleId
    packageId: UUID
    packageHash: Digest
    evidenceVersion: MetadataText
    chunkCount: int = Field(ge=1, le=ModuleLimit)
    indexedAt: AwareDatetime
    embeddingId: MetadataText
    embeddingDimension: int = Field(ge=1, le=65536)
    indexSchemaVersion: int = Field(ge=1)


class StoredMetadata(EvidenceModel):
    """Strict provider JSON; operational checkpoint and approved chunk only."""
    chunk: KnowledgeChunk = Field(repr=False)
    index: IndexProvenance
    vectorHash: Digest


class IndexInspection(EvidenceModel):
    """Internal administrative status; never returns clinical text or provider details."""
    moduleId: ModuleId
    status: Literal["empty", "matching", "stale", "incomplete"]
    packages: list[IndexProvenance] = Field(default_factory=list)


def protectOperation(errorClass):
    """Discard raw server exceptions, including connection details and request content."""
    def decorate(operation):
        @wraps(operation)
        def guarded(*arguments, **options):
            try:
                return operation(*arguments, **options)
            except MilvusError:
                raise
            except EvidenceUnavailableError:
                raise StaleIndex() from None
            except Exception:
                raise errorClass() from None
        return guarded
    return decorate


def normalizeVector(vector, dimension, metric=None):
    checkVector(vector, dimension)
    # Milvus FLOAT_VECTOR uses float32; normalize before hashing and comparisons.
    normalized = [struct.unpack("<f", struct.pack("<f", component))[0] for component in vector]
    checkVector(normalized, dimension)
    if metric == "COSINE" and not any(normalized):
        raise ValueError()
    return normalized


def vectorDigest(vector):
    return canonicalHash({"vector": vector})


class MilvusStore:
    """Exact bounded index with current approval checks and module-scoped operations."""

    @protectOperation(VectorStoreUnavailable)
    def __init__(self, settings: Settings, client, loader: EvidenceLoader, dimension: int, embeddingId: str):
        if not isinstance(settings, Settings) or not isinstance(loader, EvidenceLoader):
            raise ValueError()
        if settings.milvusPrefix is None or not re.fullmatch(r"[A-Za-z][A-Za-z0-9]{0,31}", settings.milvusPrefix):
            raise ValueError()
        if type(dimension) is not int or not 1 <= dimension <= 65536 or not isinstance(embeddingId, str) or not embeddingId.strip() or len(embeddingId) > 500:
            raise ValueError()
        if settings.watsonxEmbeddingDimension is not None and settings.watsonxEmbeddingDimension != dimension:
            raise ValueError()
        if settings.milvusMetric not in {"IP", "COSINE", "L2"} or settings.milvusIndexType != "FLAT" or type(settings.milvusTimeout) not in {int, float} or not math.isfinite(settings.milvusTimeout) or not 0 < settings.milvusTimeout <= 120:
            raise ValueError()
        self.client = client
        self.loader = loader
        self.dimension = dimension
        self.embeddingId = embeddingId
        self.prefix = settings.milvusPrefix
        self.metric = settings.milvusMetric
        self.indexType = settings.milvusIndexType
        self.timeout = settings.milvusTimeout
        self.lock = RLock()

    def collectionName(self, moduleId):
        # Lossless hex preserves case, hyphens and underscores without collisions.
        return self.prefix + "M" + checkModule(moduleId).encode("ascii").hex()

    def callClient(self, method, **arguments):
        # SDK keyword names are external boundaries; no real client is created here.
        token = ProviderCall.set(True)
        try:
            return getattr(self.client, method)(timeout=self.timeout, **arguments)
        finally:
            ProviderCall.reset(token)

    def expectedSchema(self):
        from pymilvus import CollectionSchema, DataType, FieldSchema
        from pymilvus.milvus_client.index import IndexParams
        fields = []
        for name, length in [("ChunkId", 36), ("ModuleId", 64), ("PackageId", 36), ("SourceId", 64), ("PackageHash", 64), ("Status", 16), ("EvidenceVersion", 2000), ("ContentHash", 64)]:
            fields.append(FieldSchema(name, DataType.VARCHAR, max_length=length, is_primary=name == "ChunkId", auto_id=False))
        fields.append(FieldSchema("Metadata", DataType.JSON))
        fields.append(FieldSchema("Vector", DataType.FLOAT_VECTOR, dim=self.dimension))
        schema = CollectionSchema(fields, auto_id=False, enable_dynamic_field=False)
        indexes = IndexParams()
        indexes.add_index(field_name="Vector", index_name="VectorIndex", index_type=self.indexType, metric_type=self.metric, params={})
        return schema, indexes

    def verifySchema(self, name):
        schema, indexes = self.expectedSchema()
        description = self.callClient("describe_collection", collection_name=name)
        expected = {field.name: field.to_dict() for field in schema.fields}
        fields = description.get("fields")
        if not isinstance(fields, list) or len(fields) != len(expected) or description.get("auto_id") is not False or description.get("enable_dynamic_field") is not False:
            raise VectorSchemaMismatch()
        found = set()
        for field in fields:
            if not isinstance(field, dict) or field.get("name") not in expected or field["name"] in found:
                raise VectorSchemaMismatch()
            found.add(field["name"])
            match = expected[field["name"]]
            if field.get("type") != match["type"] or type(field.get("is_primary", False)) is not bool or field.get("is_primary", False) != (field["name"] == "ChunkId") or field.get("auto_id", False) is not False:
                raise VectorSchemaMismatch()
            if {key: str(setting) for key, setting in field.get("params", {}).items()} != {key: str(setting) for key, setting in match.get("params", {}).items()}:
                raise VectorSchemaMismatch()
        if self.callClient("list_indexes", collection_name=name) != ["VectorIndex"]:
            raise VectorSchemaMismatch()
        index = self.callClient("describe_index", collection_name=name, index_name="VectorIndex")
        if index.get("field_name") != "Vector" or index.get("index_type") != self.indexType or index.get("metric_type") != self.metric:
            raise VectorSchemaMismatch()
        if index.get("params", {}) != {}:
            raise VectorSchemaMismatch()

    @protectOperation(VectorSchemaMismatch)
    def ensureCollection(self, moduleId: str, dimension: int) -> None:
        name = self.collectionName(moduleId)
        if type(dimension) is not int or dimension != self.dimension:
            raise VectorSchemaMismatch()
        with self.lock:
            self.currentPackages(moduleId)
            exists = self.callClient("has_collection", collection_name=name)
            if type(exists) is not bool:
                raise VectorSchemaMismatch()
            if not exists:
                schema, indexes = self.expectedSchema()
                self.callClient("create_collection", collection_name=name, schema=schema, index_params=indexes, consistency_level="Strong")
            self.verifySchema(name)

    def currentPackages(self, moduleId):
        packages = [EvidencePackage.model_validate_json(package.model_dump_json()) for package in self.loader.load(moduleId)]
        if not packages or sum(len(package.chunks) for package in packages) > ModuleLimit:
            raise ValueError()
        if any(package.manifest.moduleId != moduleId or package.manifest.status != ChunkStatus.approved for package in packages):
            raise ValueError()
        return {package.manifest.packageId: package for package in packages}

    def checkpoint(self, package, indexedAt):
        manifest = package.manifest
        return IndexProvenance(moduleId=manifest.moduleId, packageId=manifest.packageId, packageHash=manifest.packageHash,
            evidenceVersion=manifest.evidenceVersion, chunkCount=manifest.chunkCount, indexedAt=indexedAt,
            embeddingId=self.embeddingId, embeddingDimension=self.dimension, indexSchemaVersion=IndexSchemaVersion)

    def moduleFilter(self, moduleId):
        return "ModuleId == " + json.dumps(checkModule(moduleId))

    def loadRows(self, moduleId):
        name = self.collectionName(moduleId)
        if self.callClient("has_collection", collection_name=name) is not True:
            raise IndexProvenanceMissing()
        self.verifySchema(name)
        rows = self.callClient("query", collection_name=name, filter=self.moduleFilter(moduleId),
            output_fields=list(RecordFields) + ["Vector"], limit=ModuleLimit + 1, consistency_level="Strong")
        if not isinstance(rows, list) or len(rows) > ModuleLimit:
            raise ValueError()
        records = {}
        for row in rows:
            metadata = self.validateRow(row, moduleId, includeVector=True)
            if metadata.chunk.chunkId in records:
                raise ValueError()
            records[metadata.chunk.chunkId] = (row, metadata)
        return records

    def validateRow(self, row, moduleId, includeVector=False):
        if not isinstance(row, dict) or set(row) != set(RecordFields) | ({"Vector"} if includeVector else set()):
            raise ValueError()
        if not isinstance(row["Metadata"], dict) or not isinstance(row["Metadata"].get("chunk"), dict) or not row["Metadata"]["chunk"].get("contentHash"):
            raise ValueError()
        if "index" not in row["Metadata"]:
            raise IndexProvenanceMissing()
        metadata = StoredMetadata.model_validate_json(json.dumps(row["Metadata"], allow_nan=False))
        chunk, checkpoint = metadata.chunk, metadata.index
        expected = {"ChunkId": str(chunk.chunkId), "ModuleId": chunk.moduleId, "PackageId": str(chunk.packageId),
            "PackageHash": checkpoint.packageHash, "SourceId": chunk.sourceId, "Status": chunk.status.value,
            "EvidenceVersion": chunk.evidenceVersion, "ContentHash": chunk.contentHash}
        if any(row[field] != content for field, content in expected.items()) or chunk.moduleId != moduleId or chunk.status != ChunkStatus.approved:
            raise ValueError()
        if checkpoint.moduleId != moduleId or checkpoint.packageId != chunk.packageId or checkpoint.evidenceVersion != chunk.evidenceVersion:
            raise ValueError()
        if includeVector:
            normalized = normalizeVector(row["Vector"], self.dimension, self.metric)
            if normalized != row["Vector"] or vectorDigest(normalized) != metadata.vectorHash:
                raise ValueError()
        return metadata

    def validateIndex(self, records, packages, requireComplete=True):
        grouped = {}
        for row, metadata in records.values():
            chunk, checkpoint = metadata.chunk, metadata.index
            package = packages.get(chunk.packageId)
            if package is None or checkpoint != self.checkpoint(package, checkpoint.indexedAt):
                raise StaleIndex()
            approved = {entry.chunkId: entry for entry in package.chunks}
            if chunk != approved.get(chunk.chunkId):
                raise StaleIndex()
            grouped.setdefault(chunk.packageId, []).append(metadata)
        for packageId, entries in grouped.items():
            if len(entries) != packages[packageId].manifest.chunkCount or len({entry.index.model_dump_json() for entry in entries}) != 1:
                raise StaleIndex()
        if requireComplete and set(grouped) != set(packages):
            raise IndexProvenanceMissing()
        return [grouped[packageId][0].index for packageId in sorted(grouped, key=lambda identifier: identifier.int)]

    def makeRow(self, chunk, vector, checkpoint):
        metadata = StoredMetadata(chunk=chunk, index=checkpoint, vectorHash=vectorDigest(vector)).model_dump(mode="json")
        if len(json.dumps(metadata, ensure_ascii=True).encode("utf-8")) > 65535:
            raise ValueError()
        return {"ChunkId": str(chunk.chunkId), "ModuleId": chunk.moduleId, "PackageId": str(chunk.packageId), "PackageHash": checkpoint.packageHash,
            "SourceId": chunk.sourceId, "Status": "approved", "EvidenceVersion": chunk.evidenceVersion,
            "ContentHash": chunk.contentHash, "Metadata": metadata, "Vector": vector}

    @protectOperation(VectorWriteFailed)
    def upsertChunks(self, moduleId: str, chunks: list[KnowledgeChunk], vectors: list[list[float]]) -> None:
        checkModule(moduleId)
        if not isinstance(chunks, list) or not chunks or not isinstance(vectors, list) or len(chunks) != len(vectors) or len(chunks) > ModuleLimit:
            raise ValueError()
        checked = [KnowledgeChunk.model_validate_json(chunk.model_dump_json()) for chunk in chunks]
        normalized = [normalizeVector(vector, self.dimension, self.metric) for vector in vectors]
        if len({chunk.chunkId for chunk in checked}) != len(checked) or any(chunk.moduleId != moduleId or chunk.status != ChunkStatus.approved for chunk in checked):
            raise ValueError()
        with self.lock:
            packages = self.currentPackages(moduleId)
            selected = {chunk.packageId for chunk in checked}
            expected = {chunk.chunkId: chunk for packageId in selected if packageId in packages for chunk in packages[packageId].chunks}
            if {chunk.chunkId: chunk for chunk in checked} != expected:
                raise ValueError()
            records = self.loadRows(moduleId)
            self.validateIndex(records, packages, requireComplete=False)
            now = datetime.now(timezone.utc)
            checkpoints = {packageId: self.checkpoint(packages[packageId], now) for packageId in selected}
            for row, metadata in records.values():
                if metadata.chunk.packageId in selected:
                    checkpoints[metadata.chunk.packageId] = metadata.index
            pending = [self.makeRow(chunk, vector, checkpoints[chunk.packageId]) for chunk, vector in zip(checked, normalized)]
            for row in pending:
                existing = records.get(UUID(row["ChunkId"]))
                if existing is not None and existing[0] != row:
                    raise StaleIndex()
            pending = sorted([row for row in pending if UUID(row["ChunkId"]) not in records], key=lambda row: UUID(row["ChunkId"]).int)
            if self.currentPackages(moduleId) != packages:
                raise StaleIndex()
            if pending:
                acknowledgement = self.callClient("upsert", collection_name=self.collectionName(moduleId), data=pending)
                if not isinstance(acknowledgement, dict) or type(acknowledgement.get("upsert_count")) is not int or acknowledgement["upsert_count"] != len(pending):
                    raise VectorWriteFailed()
            after = self.loadRows(moduleId)
            self.validateIndex(after, packages, requireComplete=False)
            expectedRows = {identifier: record[0] for identifier, record in records.items()}
            expectedRows.update({UUID(row["ChunkId"]): row for row in pending})
            if {identifier: record[0] for identifier, record in after.items()} != expectedRows or self.currentPackages(moduleId) != packages:
                raise VectorWriteFailed()

    @protectOperation(VectorSearchFailed)
    def search(self, moduleId: str, queryVector: list[float], limit: int, filters: SearchFilter) -> list[VectorHit]:
        checkModule(moduleId)
        if type(limit) is not int or not 1 <= limit <= 50:
            raise ValueError()
        filters = SearchFilter.model_validate_json(filters.model_dump_json())
        if filters.moduleId != moduleId:
            raise ValueError()
        queryVector = normalizeVector(queryVector, self.dimension, self.metric)
        with self.lock:
            packages = self.currentPackages(moduleId)
            records = self.loadRows(moduleId)
            self.validateIndex(records, packages)
            clauses = ["(PackageId == " + json.dumps(str(packageId)) + " and PackageHash == " + json.dumps(package.manifest.packageHash) + " and EvidenceVersion == " + json.dumps(package.manifest.evidenceVersion) + ")" for packageId, package in sorted(packages.items(), key=lambda pair: pair[0].int)]
            # Caller text/expressions are never accepted; every value is JSON-quoted.
            expression = self.moduleFilter(moduleId) + ' and Status == "approved" and (' + " or ".join(clauses) + ")"
            response = self.callClient("search", collection_name=self.collectionName(moduleId), data=[queryVector],
                filter=expression, limit=len(records), output_fields=list(RecordFields), anns_field="Vector",
                search_params={"metric_type": self.metric, "params": {}}, consistency_level="Strong")
            if not isinstance(response, list) or len(response) != 1 or not isinstance(response[0], list) or len(response[0]) != len(records):
                raise ValueError()
            hits, found = [], set()
            for result in response[0]:
                if not isinstance(result, dict) or set(result) != {"id", "distance", "entity"} or type(result["distance"]) not in {int, float} or not math.isfinite(result["distance"]):
                    raise ValueError()
                if self.metric == "L2" and result["distance"] < 0:
                    raise ValueError()
                metadata = self.validateRow(result["entity"], moduleId)
                chunk = metadata.chunk
                if result["id"] != str(chunk.chunkId) or chunk.chunkId in found or chunk.chunkId not in records or metadata != records[chunk.chunkId][1]:
                    raise ValueError()
                found.add(chunk.chunkId)
                score = -float(result["distance"]) if self.metric == "L2" else float(result["distance"])
                hits.append(VectorHit(chunk=chunk, score=score))
            if self.currentPackages(moduleId) != packages:
                raise StaleIndex()
            after = self.loadRows(moduleId)
            self.validateIndex(after, packages)
            # A concurrent writer can change valid vectors without changing approval.
            if {identifier: record[0] for identifier, record in after.items()} != {identifier: record[0] for identifier, record in records.items()}:
                raise StaleIndex()
            return sorted(hits, key=lambda hit: (-hit.score, hit.chunk.chunkId.int))[:limit]

    @protectOperation(VectorWriteFailed)
    def deletePackage(self, moduleId: str, packageId: UUID) -> None:
        checkModule(moduleId)
        if not isinstance(packageId, UUID):
            raise ValueError()
        with self.lock:
            name = self.collectionName(moduleId)
            exists = self.callClient("has_collection", collection_name=name)
            if type(exists) is not bool:
                raise ValueError()
            if not exists:
                return
            self.verifySchema(name)
            expression = self.moduleFilter(moduleId) + " and PackageId == " + json.dumps(str(packageId))
            fields = ["ChunkId", "ModuleId", "PackageId"]
            before = self.callClient("query", collection_name=name, filter=expression, output_fields=fields, limit=ModuleLimit + 1, consistency_level="Strong")
            if not isinstance(before, list) or len(before) > ModuleLimit or any(not isinstance(row, dict) or set(row) != set(fields) or row["ModuleId"] != moduleId or row["PackageId"] != str(packageId) or str(UUID(row["ChunkId"])) != row["ChunkId"] for row in before):
                raise ValueError()
            if len({row["ChunkId"] for row in before}) != len(before):
                raise ValueError()
            self.verifySchema(name)
            if before:
                acknowledgement = self.callClient("delete", collection_name=name, filter=expression)
                if not isinstance(acknowledgement, dict) or type(acknowledgement.get("delete_count")) is not int or acknowledgement["delete_count"] != len(before):
                    raise VectorWriteFailed()
            # An acknowledgement is not proof of deletion. Recheck the same scoped
            # package; this verification does not provide distributed transactionality.
            after = self.callClient("query", collection_name=name, filter=expression, output_fields=fields, limit=ModuleLimit + 1, consistency_level="Strong")
            if after != []:
                raise VectorWriteFailed()
            self.verifySchema(name)

    @protectOperation(VectorSearchFailed)
    def inspectIndex(self, moduleId: str) -> IndexInspection:
        checkModule(moduleId)
        with self.lock:
            try:
                packages = self.currentPackages(moduleId)
                records = self.loadRows(moduleId)
                if not records:
                    return IndexInspection(moduleId=moduleId, status="empty")
                checkpoints = self.validateIndex(records, packages)
                return IndexInspection(moduleId=moduleId, status="matching", packages=checkpoints)
            except IndexProvenanceMissing:
                return IndexInspection(moduleId=moduleId, status="incomplete")
            except (StaleIndex, EvidenceUnavailableError):
                return IndexInspection(moduleId=moduleId, status="stale")
