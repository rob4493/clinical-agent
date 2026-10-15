"""NONCLINICAL deterministic adapters for explicitly enabled demonstrations/tests."""

import hashlib
import math
from uuid import UUID

from backend.app.models.retrieval import ChunkStatus, KnowledgeChunk
from backend.app.services.retrieval import RetrievalError, SearchFilter, VectorHit, checkModule, checkVector


class SyntheticEmbedding:
    """Deterministic digest buckets; scores have no clinical or semantic meaning."""

    def __init__(self, dimension: int):
        if type(dimension) is not int or not 1 <= dimension <= 65536:
            raise RetrievalError("Invalid synthetic configuration.")
        self.dimension = dimension

    def embedDocuments(self, texts: list[str]) -> list[list[float]]:
        if not isinstance(texts, list):
            raise RetrievalError("Invalid synthetic input.")
        return [self.encodeText(text) for text in texts]

    def embedQuery(self, text: str) -> list[float]:
        return self.encodeText(text)

    def encodeText(self, text: str) -> list[float]:
        if not isinstance(text, str) or not text.strip() or len(text) > 8000:
            raise RetrievalError("Invalid synthetic input.")
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        return [digest[position % len(digest)] / 255.0 for position in range(self.dimension)]


class MemoryVectors:
    """Instance-local synthetic index; stores evidence/vectors, never query text."""

    def __init__(self):
        self.dimensions = {}
        self.records = {}

    def ensureCollection(self, moduleId: str, dimension: int) -> None:
        checkModule(moduleId)
        if type(dimension) is not int or not 1 <= dimension <= 65536 or (moduleId in self.dimensions and self.dimensions[moduleId] != dimension):
            raise RetrievalError("Invalid synthetic collection.")
        self.dimensions[moduleId] = dimension
        self.records.setdefault(moduleId, {})

    def upsertChunks(self, moduleId: str, chunks: list[KnowledgeChunk], vectors: list[list[float]]) -> None:
        try:
            checkModule(moduleId)
            if moduleId not in self.dimensions or len(chunks) != len(vectors):
                raise ValueError()
            pending = {}
            for original, vector in zip(chunks, vectors):
                chunk = KnowledgeChunk.model_validate_json(original.model_dump_json())
                checkVector(vector, self.dimensions[moduleId])
                if chunk.moduleId != moduleId:
                    raise ValueError()
                record = (chunk, tuple(float(component) for component in vector))
                existing = pending.get(chunk.chunkId) or self.records[moduleId].get(chunk.chunkId)
                # A fixed UUID cannot silently change provenance or vectors.
                if existing is not None and existing != record:
                    raise ValueError()
                pending[chunk.chunkId] = record
            self.records[moduleId].update(pending)
        except Exception:
            raise RetrievalError("Invalid synthetic upsert.") from None

    def search(self, moduleId: str, queryVector: list[float], limit: int, filters: SearchFilter) -> list[VectorHit]:
        try:
            checkModule(moduleId)
            filters = SearchFilter.model_validate_json(filters.model_dump_json())
            if filters.moduleId != moduleId or moduleId not in self.dimensions or type(limit) is not int or not 1 <= limit <= 50:
                raise ValueError()
            checkVector(queryVector, self.dimensions[moduleId])
            hits = []
            for original, vector in self.records[moduleId].values():
                chunk = KnowledgeChunk.model_validate_json(original.model_dump_json())
                if chunk.moduleId != moduleId:
                    raise ValueError()
                if chunk.status != ChunkStatus.approved:
                    continue
                checkVector(list(vector), self.dimensions[moduleId])
                score = sum(component * queryComponent for component, queryComponent in zip(vector, queryVector))
                if not math.isfinite(score):
                    raise ValueError()
                hits.append(VectorHit(chunk=chunk, score=score))
            return sorted(hits, key=lambda hit: (-hit.score, hit.chunk.chunkId.int))[:limit]
        except Exception:
            raise RetrievalError("Invalid synthetic search.") from None

    def deletePackage(self, moduleId: str, packageId: UUID) -> None:
        checkModule(moduleId)
        if not isinstance(packageId, UUID) or moduleId not in self.records:
            raise RetrievalError("Invalid synthetic deletion.")
        self.records[moduleId] = {chunkId: record for chunkId, record in self.records[moduleId].items() if record[0].packageId != packageId}
