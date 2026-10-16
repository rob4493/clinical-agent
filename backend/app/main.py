"""
FastAPI application factory.

Responsibilities:
- Create the FastAPI app with OpenAPI metadata.
- Register the lifespan context (startup / shutdown hooks).
- Mount API routers.

No credentials, model names, or patient data appear in this file.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from backend.app.config import Settings, getSettings
from backend.app.api.health import router as healthRouter
from backend.app.api.discovery import router as discoveryRouter, RegistryUnavailableError, rejectRegistryFailure
from backend.app.utils.validationConfig import ValidationConfig
from backend.app.utils.runtimeLabel import RuntimeLabel
from backend.app.modules.registry import ModuleRegistry
from backend.app.services.safety import SafetyService
from backend.app.services.analysis import AnalysisService
from backend.app.api.analysis import router as analysisRouter


async def rejectInvalidRequest(request: Request, validationError: RequestValidationError) -> JSONResponse:
    """Reject invalid requests without exposing case content or identifiers."""
    # Input, context, messages, and even locations can contain submitted text
    # (including unknown field names). Do not serialize or log the exception.
    return JSONResponse(status_code=422, content={"detail": (
        "Invalid request. Check the required fields and permitted values, and "
        "remove patient names, dates of birth, contact details, and medical "
        "record numbers before resubmitting."
    )})


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan handler.

    Startup:
    - Load and validate Settings (fails fast if required variables are missing).
    - Registry configuration is validated during app creation before startup.

    Shutdown:
    - Request-owned transports handle their own cleanup; no shared client is opened here.
    """
    settings: Settings = app.state.settings  # type: ignore[attr-defined]

    # Startup
    # Validate that no obviously unsafe defaults are in use.
    if settings.debug:
        import warnings
        warnings.warn(
            "Application is running with DEBUG=true. "
            "This must not be used in any environment accessible to users.",
            stacklevel=1,
        )

    # Registry construction checks local manifests; lifespan must not ingest evidence
    # or contact a provider merely because the application is starting.

    yield

    # Shutdown
    # There is no lifespan-owned model or vector connection to close.


def createApp(settings: Settings | None = None, registry: ModuleRegistry | None = None,
              analysis: AnalysisService | None = None, language=None) -> FastAPI:
    """
    Create and configure the FastAPI application.

    Parameters
    ----------
    settings:
        Optional pre-built Settings instance (used in tests to inject overrides).
        If None, settings are loaded from environment variables / .env.
    registry:
        Optional injected registry; otherwise validate the configured root before
        returning the app. Failure prevents startup, without logging config content.
    analysis:
        Optional already-constructed service graph. Otherwise the selected mode
        composes its local graph; absent language dependencies keep analysis closed.
        This factory never constructs a model, embedding or vector client.
    """
    if settings is None:
        settings = getSettings()
    settings.validateRuntime()
    from backend.competition.registry import CompetitionRegistry
    from backend.competition.analysis import CompetitionAnalysis
    if isinstance(analysis, CompetitionAnalysis) and settings.runtimeMode() != "competition":
        raise ValueError("Invalid runtime composition.")
    if (isinstance(registry, CompetitionRegistry) and settings.runtimeMode() != "competition") or (language is not None and settings.runtimeMode() != "competition"):
        raise ValueError("Invalid runtime composition.")
    if settings.moduleRoot.resolve().is_relative_to(Path(__file__).parents[1] / "demo"):
        raise ValueError("Invalid authentic module root.")
    if settings.runtimeMode() == "synthetic" and (registry is not None or analysis is not None):
        raise ValueError("Synthetic runtime requires its isolated composition.")
    if registry is None:
        root = Path(__file__).parents[1] / "releaseModules" if settings.runtimeMode() == "competition" else settings.moduleRoot
        registry = ModuleRegistry(root, settings)
    if any(root.is_relative_to(Path(__file__).parents[1] / "demo") for root in registry.moduleRoots.values()):
        raise ValueError("Synthetic artifacts require explicit isolated composition.")
    authenticRegistry = ModuleRegistry(settings.moduleRoot, settings) if isinstance(registry, CompetitionRegistry) else registry
    runtimeMode = settings.runtimeMode()
    demoNotice = None
    if runtimeMode == "synthetic":
        from backend.demo.runtime import composeDemo, DemoNotice
        registry, analysis = composeDemo(settings)
        runtimeMode = "synthetic"
        demoNotice = DemoNotice
    if runtimeMode == "production" and (analysis is not None or registry.listModules()):
        raise ValueError("Production runtime is not enabled.")
    if runtimeMode == "competition":
        demoNotice = "Competition evaluation mode â€” clinician-facing evidence support; not for direct patient care."
        from backend.competition.analysis import CompetitionAnalysis
        if analysis is not None and (not isinstance(analysis, CompetitionAnalysis) or analysis.registry is not registry):
            raise ValueError("Invalid competition composition.")
        if analysis is None:
            from backend.app.services.watsonx import createTransport, selectLanguage
            if not isinstance(registry, CompetitionRegistry):
                registry = CompetitionRegistry(authenticRegistry, publicPackages=True)
            selectedLanguage = language if language is not None else selectLanguage(settings, createTransport)
            if selectedLanguage is None and getattr(registry, "publicEvaluation", False):
                from backend.competition.deterministic import EvaluationLanguage
                selectedLanguage = EvaluationLanguage()
            analysis = CompetitionAnalysis(registry, settings, selectedLanguage)

    app = FastAPI(
        title=settings.appTitle,
        version=settings.appVersion,
        description=(
            "Clinician-facing evidence-grounded decision-support agent. "
            "IBM competition build: Module 1: Endometriosis and Chronic Pelvic Pain."
        ),
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    # Store settings on app state so lifespan and routes can access them.
    app.state.settings = settings  # type: ignore[attr-defined]
    app.state.runtimeMode = runtimeMode
    app.state.registry = registry
    app.state.authenticRegistry = authenticRegistry
    app.state.analysis = analysis
    app.state.safety = analysis.safety if analysis is not None else SafetyService(registry, settings)
    app.add_middleware(ValidationConfig)
    app.add_exception_handler(RequestValidationError, rejectInvalidRequest)
    app.add_exception_handler(RegistryUnavailableError, rejectRegistryFailure)

    # Pure ASGI labeling leaves client-disconnect detection accessible to the endpoint.
    app.add_middleware(RuntimeLabel, mode=runtimeMode)

    app.add_middleware(CORSMiddleware, allow_origins=settings.corsOrigins,
                       allow_credentials=False, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type"], expose_headers=["X-Clinical-Mode"])

    @app.get("/v1/runtime", tags=["Discovery"])
    def describeRuntime() -> dict:
        """Public mode metadata; synthetic readiness is never authentic clinical readiness."""
        publicStatus = None
        if getattr(registry, "publicEvaluation", False):
            try:
                from backend.competition.evaluation import verifyReview
                review = verifyReview()
                publicStatus = {"reviewStatus": review["reviewStatus"], "competitionStatus": review["competitionStatus"], "notice": review["notice"]}
            except Exception:
                publicStatus = {"reviewStatus": "unavailable", "competitionStatus": "unavailable"}
        return {"mode": runtimeMode, "synthetic": runtimeMode == "synthetic", "notice": demoNotice,
                **({"evaluation": publicStatus} if publicStatus is not None else {})}

    # Routers
    app.include_router(healthRouter)
    app.include_router(discoveryRouter)
    app.include_router(analysisRouter)
    from backend.demo.discovery import router as demoRouter
    app.include_router(demoRouter)
    from backend.competition.discovery import router as competitionRouter
    app.include_router(competitionRouter)
    # Administrative routes remain planned.

    return app


# Module-level app instance used by uvicorn when running directly.
app = createApp()
