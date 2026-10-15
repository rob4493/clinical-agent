"""TEST ONLY: local browser smoke with guarded networking and a delayed mock transport."""

import asyncio
import json
from pathlib import Path
from threading import Lock

import httpx

from tests.support import demoServer as guards
from tests.unit.testWatsonx import configure, tokenReply
from backend.app.config import Settings
from backend.app.main import createApp
from backend.app.services.watsonx import WatsonxLanguage
from backend.app.services.cancellation import cancellationEvent

guards.Report = Path(__file__).parents[2] / "docs/requestCancellationGuard.json"
State = dict(started=0, cancelled=0, browserCancelled=0, closed=0)
StateLock = Lock()


async def respond(request):
    if request.url.path == "/identity/token":
        return tokenReply()
    with StateLock:
        State["started"] += 1
    try:
        await asyncio.Event().wait()
    except asyncio.CancelledError:
        with StateLock:
            State["cancelled"] += 1
            if cancellationEvent().is_set():
                State["browserCancelled"] += 1
        raise


class SmokeTransport(httpx.MockTransport):
    async def aclose(self):
        with StateLock:
            State["closed"] += 1
        await super().aclose()


class SmokeLanguage:
    """Only a fictional test marker takes the delayed IBM-mock path."""
    def __init__(self, demo):
        self.demo = demo
        self.mock = WatsonxLanguage(configure(watsonxTimeout=30, watsonxDeadline=120), lambda: SmokeTransport(respond), wallClock=lambda: 1000)

    def generate(self, request):
        if json.loads(request.content)["CaseData"]["additionalNotes"] == "fictional cancellation smoke":
            return self.mock.generate(request)
        return self.demo.generate(request)


app = createApp(Settings(clinicalDemoMode=True))
app.state.analysis.language = SmokeLanguage(app.state.analysis.language)


@app.get("/test/cancellation-state", include_in_schema=False)
def describeState():
    with StateLock:
        return {**State, "externalAttempts": dict(guards.Attempts)}


if __name__ == "__main__":
    import uvicorn
    guards.saveReport()
    try:
        uvicorn.run(app, host="127.0.0.1", port=8012, access_log=False, log_level="warning")
    finally:
        guards.saveReport()
