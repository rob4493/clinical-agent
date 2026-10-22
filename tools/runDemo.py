"""Explicit source-free demo startup; private evidence is an optional separate graph."""

import argparse
import os
from pathlib import Path


def configureDemo(mode: str, privateRoot: Path | None = None):
    """Choose a single graph before importing FastAPI; never discover local sources."""
    project = Path(__file__).resolve().parents[1]
    if mode not in {"synthetic", "standard", "competition"}:
        raise ValueError("Invalid demonstration configuration.")
    if mode == "competition" and privateRoot is not None:
        from tools.evidenceInstall import verifyFiles, verifyRuntime
        import json
        if not privateRoot.is_absolute():
            raise ValueError("Private evidence verification failed.")
        verifyFiles(privateRoot, json.loads((project / "EvidenceSources.example.json").read_bytes()))
        verifyRuntime(privateRoot)
        os.environ["MODULE_ROOT"] = str(privateRoot / "backend/app/modules")
        os.environ["CLINICAL_EVIDENCE_ROOT"] = str(privateRoot)
    else:
        os.environ["MODULE_ROOT"] = str(project / "backend/releaseModules")
        os.environ.pop("CLINICAL_EVIDENCE_ROOT", None)
    os.environ["CLINICAL_RUNTIME_MODE"] = mode
    os.environ["CLINICAL_DEMO_MODE"] = "true" if mode == "synthetic" else "false"
    os.environ["LANGUAGE_PROVIDER"] = "disabled"


def main():
    parser = argparse.ArgumentParser(description="Loopback-only offline demo, never public clinical deployment.")
    parser.add_argument("--mode", choices=["synthetic", "standard", "competition"], default="synthetic")
    parser.add_argument("--private-root", dest="privateRoot", type=Path)
    args = parser.parse_args()
    try:
        configureDemo(args.mode, args.privateRoot)
        from backend.app.config import Settings
        from backend.app.main import createApp
        language = None
        registry = None
        if args.mode == "competition":
            from backend.competition.deterministic import EvaluationLanguage
            language = EvaluationLanguage()
            if args.privateRoot is not None:
                from backend.app.modules.registry import ModuleRegistry
                from backend.competition.registry import CompetitionRegistry
                registry = CompetitionRegistry(ModuleRegistry(Settings().moduleRoot))
        import uvicorn
        uvicorn.run(createApp(Settings(), registry=registry, language=language), host="127.0.0.1", port=8000,
                    access_log=False, log_level="warning")
    except Exception:
        parser.exit(1, "Demonstration runtime is unavailable.\n")


if __name__ == "__main__":
    main()
