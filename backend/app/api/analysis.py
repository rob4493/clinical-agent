"""Public transient analysis boundary; injected services only, no client creation."""

import asyncio
from threading import Event

from fastapi import APIRouter, Request, Response
from starlette.concurrency import run_in_threadpool

from backend.app.services.cancellation import RequestCancelled, cancellationScope, checkCancelled

from backend.app.models.analysis import AnalysisResult
from backend.app.models.input import ClinicalCaseInput
from backend.app.models.output import EvidenceInsufficientResponse, ModuleUnavailable, SelectModuleRequired, DecisionSupportNotice, CompetitionNotice, SyntheticNotice
from backend.app.modules.registry import ModuleRegistry, ModuleSelectionError, ModuleUnavailableError
from backend.app.services.analysis import AnalysisService
from backend.app.services.safety import SafetyInputError
from fastapi.exceptions import RequestValidationError

router = APIRouter(tags=["Analysis"])


def unavailableResult() -> AnalysisResult:
    """Fixed fallback excludes submitted input and every internal exception."""
    response = EvidenceInsufficientResponse(message="Analysis is unavailable. Please try again later.")
    return AnalysisResult(response=response, renderedText=response.message + "\n\n" + DecisionSupportNotice)


def selectNotice(result: AnalysisResult, runtimeMode: str) -> AnalysisResult:
    """Select the final notice from authoritative application mode, never case input."""
    notice = {"synthetic": SyntheticNotice, "competition": CompetitionNotice}.get(runtimeMode, DecisionSupportNotice)
    previous = result.response.decisionSupportNotice
    if not result.renderedText.endswith(previous):
        raise ValueError("Invalid response presentation.")
    outcome = result.response.model_copy(update={"decisionSupportNotice": notice})
    return result.model_copy(update={"response": outcome, "renderedText": result.renderedText[:-len(previous)] + notice})


def getAnalysis(request: Request) -> AnalysisService | None:
    """Reject mismatched application dependency graphs without invoking providers."""
    service = getattr(request.app.state, "analysis", None)
    if (isinstance(service, AnalysisService) and service.registry is request.app.state.registry
            and service.safety is request.app.state.safety
            and service.safety.settings is request.app.state.settings
            and service.retrieval.loader.registry is service.registry):
        return service
    return None


@router.post("/v1/analyze", response_model=AnalysisResult, responses={
    404: {"model": AnalysisResult, "description": "Selected module unavailable."},
    503: {"model": AnalysisResult, "description": "Sanitized dependency failure."},
    422: {"description": "Sanitized schema or privacy rejection.", "content": {"application/json": {
        "schema": {"type": "object", "properties": {"detail": {"type": "string"}},
                   "required": ["detail"], "additionalProperties": False}}}},
}, openapi_extra={"requestBody": {"content": {"application/json": {"examples": {
    "fictional": {"summary": "Synthetic fixture only; unavailable in default configuration", "value": {
        "moduleHint": "SyntheticAlpha", "caseType": "brief",
        "additionalNotes": "Fictional bounded observation for synthetic testing."}}
}}}}})
async def analyzeCase(caseInput: ClinicalCaseInput, request: Request, response: Response):
    """Watch the consumed ASGI request while synchronous providers run cooperatively."""
    signal = Event()
    worker = None
    try:
        with cancellationScope(signal):
            if await request.is_disconnected():
                signal.set()
                checkCancelled()
            worker = asyncio.create_task(run_in_threadpool(runAnalysis, caseInput, request, response))
            while not worker.done():
                if await request.is_disconnected():
                    signal.set()
                    break
                await asyncio.sleep(.01)
            # Cancelling an asyncio task cannot stop its worker thread. The signal
            # owns cooperative cleanup; shielding avoids abandoning that cleanup.
            result = await asyncio.shield(worker)
            if await request.is_disconnected():
                signal.set()
            checkCancelled()
            return selectNotice(result, getattr(request.app.state, "runtimeMode", "standard"))
    except RequestCancelled:
        # The peer is gone. Never serialize a clinical fallback or partial response.
        return Response()
    except asyncio.CancelledError:
        signal.set()
        if worker is not None:
            await asyncio.shield(worker)
        raise
    finally:
        signal.set()


def runAnalysis(caseInput: ClinicalCaseInput, request: Request, response: Response) -> AnalysisResult:
    """Resolve explicit selection before invoking the ordered orchestrator."""
    try:
        checkCancelled()
        registry = getattr(request.app.state, "registry", None)
        if not isinstance(registry, ModuleRegistry):
            raise ValueError()
        try:
            registry.resolveModule(caseInput.moduleHint)
        except ModuleSelectionError:
            outcome = SelectModuleRequired()
            return AnalysisResult(response=outcome, renderedText=outcome.message + "\n\n" + DecisionSupportNotice)
        except ModuleUnavailableError:
            response.status_code = 404
            outcome = ModuleUnavailable(moduleHint=caseInput.moduleHint, message="The selected module is unavailable.")
            return AnalysisResult(response=outcome, renderedText=outcome.message + "\n\n" + DecisionSupportNotice)
        service = getAnalysis(request)
        if service is None:
            response.status_code = 503
            return unavailableResult()
        result = service.analyzeCase(caseInput)
        if result.serviceUnavailable:
            response.status_code = 503
        elif isinstance(result.response, ModuleUnavailable):
            response.status_code = 404
        return result
    except RequestCancelled:
        return None
    except SafetyInputError:
        raise RequestValidationError([]) from None
    except Exception:
        response.status_code = 503
        return unavailableResult()
