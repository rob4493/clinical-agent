"""Competition schema uses the existing IBM transport boundary, with no live calls."""

import json
import asyncio
from threading import Event
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.main import createApp
from backend.app.services.watsonx import WatsonxLanguage
from tests.unit.testWatsonx import configure, tokenReply, chatReply, noNetwork
from tests.unit.testCompetitionAnalysis import caseFields
from tests.support.competitionLanguage import CompetitionLanguage
from tests.unit.testCancellation import ClientRun, waitEntered


def makeLanguage(malformed=False):
    def respond(request):
        if request.url.path == "/identity/token":
            return tokenReply()
        payload = json.loads(request.content)
        assert payload["response_format"]["json_schema"]["schema"]["required"] == ["responseType", "considerations", "question"]
        from backend.app.models.analysis import ModelRequest
        draft = CompetitionLanguage().generate(ModelRequest(instructions=payload["messages"][0]["content"], content=payload["messages"][1]["content"]))
        if malformed:
            draft["unexpected"] = "synthetic private provider payload"
        return chatReply(draft)
    settings = configure(clinicalRuntimeMode="competition")
    return settings, WatsonxLanguage(settings, lambda: httpx.MockTransport(respond), wallClock=lambda:1000)


def testCompetitionUsesStructuredIbmRequestAndDownstreamValidation(caplog):
    settings, language = makeLanguage()
    with TestClient(createApp(settings, language=language)) as client:
        response = client.post("/v1/analyze", json=caseFields("Does a normal transvaginal ultrasound exclude endometriosis?"))
    assert response.status_code == 200 and response.json()["response"]["responseType"] == "AgentResponse"
    assert response.json()["response"]["supportedInterpretations"][0]["text"].startswith("A normal transvaginal ultrasound does not exclude")
    assert "normal transvaginal" not in caplog.text


def testMalformedStructuredIbmOutputBecomesEvidenceInsufficient(caplog):
    settings, language = makeLanguage(True)
    with TestClient(createApp(settings, language=language)) as client:
        response = client.post("/v1/analyze", json=caseFields("Recurring pelvic discomfort."))
    assert response.json()["response"]["responseType"] == "EvidenceInsufficient"
    assert "synthetic private provider payload" not in response.text + caplog.text


def testConcurrentCompetitionRequestsHaveNoCrossCaseLeakage(caplog):
    settings, language = makeLanguage()
    app = createApp(settings, language=language)
    with TestClient(app) as client:
        def analyze(narrative):
            return client.post("/v1/analyze", json=caseFields(narrative)).json()
        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(analyze, ["Can CA-125 diagnose endometriosis?", "Does a normal MRI end evaluation for pelvic pain?"]))
    assert all(result["response"]["responseType"] == "AgentResponse" for result in results)
    assert "CA-125" in results[0]["renderedText"] and "CA-125" not in results[1]["renderedText"]
    assert results[0]["renderedText"] != results[1]["renderedText"]
    assert not any(fragment in caplog.text for fragment in ["CA-125", "normal MRI", "synthetic private"])


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["iam", "generation"])
async def testCompetitionDisconnectCancelsTransportWithoutPublishing(stage, caplog):
    entered = Event()
    cleaned = Event()
    closed = []
    calls = []
    async def respond(request):
        calls.append(request.url.path)
        if stage == "generation" and request.url.path == "/identity/token":
            return tokenReply()
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.set()
    class TrackedTransport(httpx.MockTransport):
        async def aclose(self):
            closed.append(True)
            await super().aclose()
    settings = configure(clinicalRuntimeMode="competition", watsonxRetries=2)
    language = WatsonxLanguage(settings, lambda:TrackedTransport(respond), wallClock=lambda:1000)
    client = ClientRun(createApp(settings, language=language))
    client.body = json.dumps(caseFields("Recurring pelvic discomfort.")).encode()
    await waitEntered(entered)
    client.disconnect.set()
    assert await client.finish() == b""
    assert cleaned.is_set() and closed == [True] and not language.refreshLock.locked()
    assert len(calls) == (1 if stage == "iam" else 2)
    assert "Recurring pelvic discomfort" not in caplog.text
