"""Read-only discovery and current clinical-readiness gates."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from backend.app.models.contracts import ModuleId
from backend.app.models.discovery import ModuleSummary, ModuleList, ReadinessResponse, ServiceUnavailable
from backend.app.models.module import ClinicalModuleConfig
from backend.app.models.output import ModuleUnavailable
from backend.app.modules.registry import ModuleRegistry, ModuleUnavailableError, ModuleSelectionError

router = APIRouter(tags=["Discovery"])


class RegistryUnavailableError(Exception):
    """Internal dependency failure; never serialize its cause."""


def getRegistry(request: Request) -> ModuleRegistry:
    """Obtain only the active application's injected registry."""
    registry = getattr(request.app.state, "registry", None)
    if not isinstance(registry, ModuleRegistry):
        raise RegistryUnavailableError()
    return registry


async def rejectRegistryFailure(request: Request, failure: RegistryUnavailableError) -> JSONResponse:
    """Keep readiness and discovery failures sanitized without logging causes."""
    if request.url.path == "/ready":
        content = ReadinessResponse(status="notReady", availableModuleCount=0, reasonCode="registryUnavailable")
    else:
        content = ServiceUnavailable()
    return JSONResponse(status_code=503, content=content.model_dump(mode="json"))


def summarizeModule(config: ClinicalModuleConfig) -> ModuleSummary:
    """Explicit allowlist prevents internal config fields crossing the API boundary."""
    return ModuleSummary(moduleId=config.moduleId, displayName=config.moduleName,
                         version=config.version, description=config.description,
                         supportedCaseTypes=config.supportedCaseTypes)


RegistryDependency = Annotated[ModuleRegistry, Depends(getRegistry)]


@router.get("/v1/modules", response_model=ModuleList, responses={503: {"model": ServiceUnavailable}})
def listModules(registry: RegistryDependency) -> ModuleList:
    """Expose only available module summaries, never raw configurations."""
    try:
        return ModuleList(modules=[summarizeModule(config) for config in registry.listModules()])
    except Exception:
        raise RegistryUnavailableError() from None


@router.get("/v1/modules/{moduleId}", response_model=ModuleSummary,
            responses={404: {"model": ModuleUnavailable}, 503: {"model": ServiceUnavailable}})
def getModule(moduleId: ModuleId, registry: RegistryDependency) -> ModuleSummary | JSONResponse:
    """Use one external outcome regardless of administrative unavailability reason."""
    try:
        return summarizeModule(registry.resolveModule(moduleId))
    except (ModuleUnavailableError, ModuleSelectionError):
        # Retain the existing submitted-identifier field, never disclose registry state.
        unavailable = ModuleUnavailable(moduleHint=moduleId, message="The selected module is unavailable.")
        return JSONResponse(status_code=404, content=unavailable.model_dump(mode="json"))
    except Exception:
        raise RegistryUnavailableError() from None


@router.get("/ready", response_model=ReadinessResponse, responses={503: {"model": ReadinessResponse}})
def checkReady(response: Response, registry: RegistryDependency, request: Request = None) -> ReadinessResponse:
    """Check local analysis dependencies and provenance without contacting providers."""
    try:
        count = len(registry.listModules())
    except Exception:
        raise RegistryUnavailableError() from None
    if count == 0:
        response.status_code = 503
        return ReadinessResponse(status="notReady", availableModuleCount=0, reasonCode="noAvailableModules")
    from backend.app.api.analysis import getAnalysis
    service = getAnalysis(request) if request is not None else None
    if service is None or not service.isReady():
        response.status_code = 503
        return ReadinessResponse(status="notReady", availableModuleCount=count, reasonCode="analysisUnavailable")
    return ReadinessResponse(status="ready", availableModuleCount=count, reasonCode="ready")
