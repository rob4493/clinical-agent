"""Read-only synthetic source details; disabled runtimes cannot access demo content."""

from fastapi import APIRouter, HTTPException, Request

from backend.demo.runtime import DemoModule, DemoWarnings
from backend.app.services.cancellation import checkCancelled

router = APIRouter(tags=["Synthetic demonstration"])


@router.get("/v1/demo/sources/{sourceId}")
def describeSource(sourceId: str, request: Request):
    """Expose cited fixture explanations only, never paths, digests or case information."""
    checkCancelled()
    if not request.app.state.settings.clinicalDemoMode or sourceId != "SyntheticSource":
        raise HTTPException(status_code=404, detail="Source unavailable.")
    try:
        service = request.app.state.analysis
        packages = service.retrieval.loader.load(DemoModule)
        if not packages or not service.isReady():
            raise ValueError()
        source = request.app.state.registry.getSource(DemoModule, sourceId)
        return {"title": source.title, "status": "Demonstration only; no clinical authority",
                "statements": list(dict.fromkeys([statement.text for statement in service.findStatements(DemoModule, {chunk.chunkId: chunk for package in packages for chunk in package.chunks})] + list(DemoWarnings.values()))),
                "limitations": "Bounded illustrative statements, not clinically validated evidence. Original wording outside the supported forms receives an insufficiency response. No authentic source approval or real clinical readiness is implied."}
    except Exception:
        raise HTTPException(status_code=503, detail="Source unavailable.") from None
