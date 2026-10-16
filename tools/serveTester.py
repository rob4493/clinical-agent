"""Host-assigned-port offline tester runtime; never production clinical activation."""

import os
import re
from pathlib import Path


class HostingError(ValueError):
    """Sanitized configuration failure with no environment or private path details."""


def readPort() -> int:
    """Require the host's assigned port rather than silently listening elsewhere."""
    port = os.environ.get("PORT", "")
    if not re.fullmatch(r"[1-9][0-9]{0,4}", port) or int(port) > 65535:
        raise HostingError("Tester hosting configuration is invalid.")
    return int(port)


def configureHost():
    """Configure one explicit graph before importing the application or providers."""
    try:
        mode = os.environ.get("CLINICAL_RUNTIME_MODE", "standard")
        provider = os.environ.get("CLINICAL_TESTER_PROVIDER", "disabled")
        if mode not in {"standard", "synthetic", "competition"} or provider not in {"disabled", "deterministic"}:
            raise ValueError()
        if os.environ.get("LANGUAGE_PROVIDER", "disabled") != "disabled":
            raise ValueError()
        if os.environ.get("DEBUG", "false") != "false":
            raise ValueError()
        demoFlag = os.environ.get("CLINICAL_DEMO_MODE", "false")
        if demoFlag not in {"false", "true"} or demoFlag == "true" and mode != "synthetic":
            raise ValueError()
        if provider == "deterministic" and mode != "competition":
            raise ValueError()
        privateRoot = None
        configured = os.environ.get("CLINICAL_EVIDENCE_ROOT")
        if mode == "competition":
            if configured is not None:
                if not configured or not Path(configured).is_absolute():
                    raise ValueError()
                privateRoot = Path(configured)
                project = Path(__file__).resolve().parents[1]
                if privateRoot.resolve().is_relative_to(project) or project.is_relative_to(privateRoot.resolve()):
                    raise ValueError()
        elif configured is not None:
            raise ValueError()
        from tools.runDemo import configureDemo
        configureDemo(mode, privateRoot)
        return provider
    except Exception:
        raise HostingError("Tester hosting configuration is invalid.") from None


def buildApp():
    """Reuse all evidence, privacy and mode gates; no model/vector client is created."""
    try:
        provider = configureHost()
        from backend.app.config import Settings
        settings = Settings()
        if settings.debug:
            raise ValueError()
        from backend.app.main import createApp
        language = None
        registry = None
        if provider == "deterministic":
            from backend.competition.deterministic import EvaluationLanguage
            language = EvaluationLanguage()
        if settings.runtimeMode() == "competition" and os.environ.get("CLINICAL_EVIDENCE_ROOT"):
            from backend.app.modules.registry import ModuleRegistry
            from backend.competition.registry import CompetitionRegistry
            registry = CompetitionRegistry(ModuleRegistry(settings.moduleRoot))
        return createApp(settings, registry=registry, language=language)
    except Exception:
        raise HostingError("Tester runtime is unavailable.") from None


def main():
    try:
        port = readPort()
        app = buildApp()
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=port, workers=1, access_log=False,
                    proxy_headers=False, log_level="warning")
    except Exception:
        raise SystemExit("Tester runtime is unavailable.") from None


if __name__ == "__main__":
    main()
