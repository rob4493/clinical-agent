"""Loopback-only browser-test composition; never imported by production startup."""

from pathlib import Path

from tests.support import demoServer as guard
from tests.support.competitionLanguage import CompetitionLanguage

guard.Report = Path(__file__).parents[2] / "frontend/screenshots/competitionBackendGuard.json"


if __name__ == "__main__":
    import uvicorn
    from backend.app.config import Settings
    from backend.app.main import createApp
    guard.saveReport()
    try:
        settings = Settings(clinicalRuntimeMode="competition", clinicalDemoMode=False, languageProvider="disabled")
        uvicorn.run(createApp(settings, language=CompetitionLanguage()), host="127.0.0.1", port=8020,
                    access_log=False, log_level="warning")
    finally:
        guard.saveReport()
