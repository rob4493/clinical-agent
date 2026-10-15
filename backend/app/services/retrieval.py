"""Provider-neutral internal retrieval; no app integration or live providers."""

import math
from typing import Literal, Protocol
from uuid import UUID

from pydantic import Field, TypeAdapter

from backend.app.models.contracts import ModuleId
from backend.app.models.retrieval import ChunkStatus, EvidenceModel, KnowledgeChunk, RetrievalQuery, RetrievalResult
from backend.app.services.evidence import EvidenceLoader, EvidenceUnavailableError
from backend.app.services.cancellation import checkCancelled


class RetrievalError(ValueError):
    """Sanitized query, vector or provider-contract failure."""


class VectorStoreError(RetrievalError):
    """Provider-neutral typed failure; subclasses must supply fixed safe messages."""
    message = "Vector store is unavailable."

    def __init__(self):
        super().__init__(self.message)


class SearchFilter(EvidenceModel):
    """Mandatory module and approval predicates; no caller-controlled metadata map."""
    moduleId: ModuleId
    status: Literal["approved"]


class VectorHit(EvidenceModel):
    """Internal provenance-bearing hit; never returned directly to callers."""
    chunk: KnowledgeChunk = Field(repr=False)
    score: float = Field(allow_inf_nan=False)


class EmbeddingProvider(Protocol):
    """Replaceable encoder boundary; dimensions and model configuration are external."""
    def embedDocuments(self, texts: list[str]) -> list[list[float]]: ...
    def embedQuery(self, text: str) -> list[float]: ...


class VectorStore(Protocol):
    """Module-scoped evidence index; every search requires approved-only predicates."""
    def ensureCollection(self, moduleId: str, dimension: int) -> None: ...
    def upsertChunks(self, moduleId: str, chunks: list[KnowledgeChunk], vectors: list[list[float]]) -> None: ...
    def search(self, moduleId: str, queryVector: list[float], limit: int, filters: SearchFilter) -> list[VectorHit]: ...
    def deletePackage(self, moduleId: str, packageId: UUID) -> None: ...


def checkModule(moduleId: str) -> str:
    try:
        return TypeAdapter(ModuleId).validate_python(moduleId)
    except (ValueError, TypeError):
        raise RetrievalError("Invalid retrieval operation.") from None


def checkVector(vector: list[float], dimension: int | None = None) -> int:
    """Validate provider outputs and store inputs, including nonfinite/overflow hazards."""
    if not isinstance(vector, list) or not vector or len(vector) > 65536 or (dimension is not None and len(vector) != dimension):
        raise RetrievalError("Invalid retrieval vector.")
    for component in vector:
        if type(component) not in {int, float}:
            raise RetrievalError("Invalid retrieval vector.")
        try:
            if not math.isfinite(component):
                raise ValueError()
        except (ValueError, OverflowError):
            raise RetrievalError("Invalid retrieval vector.") from None
    return len(vector)


class RetrievalService:
    """Revalidate disk evidence on every query; untrusted provider hits are cross-checked."""

    def __init__(self, loader: EvidenceLoader, embeddings: EmbeddingProvider, vectors: VectorStore, dimension: int | None = None):
        if dimension is not None and (type(dimension) is not int or not 1 <= dimension <= 65536):
            raise RetrievalError("Invalid retrieval configuration.")
        self.loader = loader
        self.embeddings = embeddings
        self.vectors = vectors
        self.dimension = dimension

    def retrieve(self, moduleId: str, queryText: str, limit: int = 8) -> list[RetrievalResult]:
        try:
            checkCancelled()
            query = RetrievalQuery(moduleId=moduleId, queryText=queryText, topK=limit)
            packages = self.loader.load(query.moduleId)
            checkCancelled()
            config = self.loader.registry.resolveModule(query.moduleId)
            approved = {chunk.chunkId: chunk for package in packages for chunk in package.chunks}
            # Embed the transient query only after current administrative evidence passes.
            queryVector = self.embeddings.embedQuery(query.queryText)
            checkCancelled()
            dimension = checkVector(queryVector, self.dimension)
            vectors = self.embeddings.embedDocuments([chunk.text for chunk in approved.values()])
            checkCancelled()
            if len(vectors) != len(approved):
                raise ValueError()
            for vector in vectors:
                checkVector(vector, dimension)
            self.vectors.ensureCollection(config.moduleId, dimension)
            checkCancelled()
            self.vectors.upsertChunks(config.moduleId, list(approved.values()), vectors)
            checkCancelled()
            hits = self.vectors.search(config.moduleId, queryVector, query.topK, SearchFilter(moduleId=config.moduleId, status="approved"))
            checkCancelled()
            results = []
            found = set()
            for hit in hits:
                chunk = KnowledgeChunk.model_validate_json(hit.chunk.model_dump_json())
                if chunk.chunkId in found or chunk.chunkId not in approved or chunk != approved[chunk.chunkId] or chunk.moduleId != config.moduleId or chunk.status != ChunkStatus.approved or not math.isfinite(hit.score):
                    raise ValueError()
                found.add(chunk.chunkId)
                fields = {field: getattr(chunk, field) for field in RetrievalResult.model_fields if field != "score"}
                results.append(RetrievalResult(**fields, score=hit.score))
            return sorted(results, key=lambda result: (-result.score, result.chunkId.int))[:query.topK]
        except EvidenceUnavailableError:
            raise EvidenceUnavailableError("Approved evidence is unavailable.") from None
        except VectorStoreError:
            raise
        except Exception:
            checkCancelled()
            # Provider exceptions may contain prompts or credentials; never chain or log them.
            raise RetrievalError("Retrieval is unavailable.") from None
