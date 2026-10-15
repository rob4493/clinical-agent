"""Offline ASGI disconnects, cooperative retrieval and synthetic HTTP cancellation."""

import asyncio
import json
from threading import Event, Lock
from unittest.mock import Mock

import httpx
import pytest

from backend.app.services.cancellation import RequestCancelled, cancellationEvent, cancellationScope, checkCancelled
from backend.app.services.watsonx import LanguageCancelled, WatsonxLanguage
from tests.unit.testAnalysis import analysisKit, BriefText
from tests.unit.testAnalysisEndpoint import makeApp, caseFields, StatelessLanguage
from tests.unit.testWatsonx import configure, tokenReply, chatReply, noNetwork, requestCase


class ClientRun:
    """Supply actual ASGI disconnect messages after the fictional body is consumed."""
    def __init__(self, app, marker="fictional cancellation context", disconnected=False):
        self.disconnect = asyncio.Event()
        if disconnected:
            self.disconnect.set()
        self.messages = []
        self.bodySent = False
        self.body = json.dumps(caseFields(additionalNotes=marker)).encode()
        scope = dict(type="http", asgi={"version": "3.0"}, http_version="1.1", method="POST",
            scheme="http", path="/v1/analyze", raw_path=b"/v1/analyze", query_string=b"",
            root_path="", headers=[(b"content-type", b"application/json")],
            client=("127.0.0.1", 1), server=("127.0.0.1", 8000))
        self.task = asyncio.create_task(app(scope, self.receive, self.send))

    async def receive(self):
        if not self.bodySent:
            self.bodySent = True
            return {"type": "http.request", "body": self.body, "more_body": False}
        await self.disconnect.wait()
        return {"type": "http.disconnect"}

    async def send(self, message):
        self.messages.append(message)

    async def finish(self):
        await asyncio.wait_for(self.task, 15)
        return b"".join(message.get("body", b"") for message in self.messages)


async def waitEntered(barrier):
    assert await asyncio.to_thread(barrier.wait, 15), "Synthetic stage did not start."


def validDraft(kit):
    return {"considerations": [{"text": BriefText, "references": [reference.model_dump(mode="json") for reference in kit.statement.references]}], "questionId": None}


def attachLanguage(kit, handler, closed=None):
    class TrackedTransport(httpx.MockTransport):
        async def aclose(self):
            if closed is not None:
                closed.append(True)
            await super().aclose()
    kit.service.language = WatsonxLanguage(configure(watsonxRetries=2), lambda: TrackedTransport(handler), wallClock=lambda: 1000)
    return kit.service.language


def testCancellationScopeDoesNotLeakOrBecomeAClinicalFailure():
    signal = Event()
    assert cancellationEvent() is None
    with pytest.raises(RequestCancelled):
        with cancellationScope(signal):
            signal.set(); checkCancelled()
    assert cancellationEvent() is None


@pytest.mark.asyncio
async def testDisconnectBeforeRetrievalNeverInvokesProviders(analysisKit):
    analysisKit.service.retrieval.retrieve = Mock(side_effect=AssertionError("No retrieval permitted."))
    analysisKit.service.language.generate = Mock(side_effect=AssertionError("No generation permitted."))
    client = ClientRun(makeApp(analysisKit), disconnected=True)
    assert await client.finish() == b""
    analysisKit.service.retrieval.retrieve.assert_not_called()
    analysisKit.service.language.generate.assert_not_called()


@pytest.mark.asyncio
async def testDisconnectDuringRetrievalStopsBeforeIndexAndGeneration(analysisKit):
    entered = Event(); cleaned = Event()
    def embed(query):
        entered.set()
        try:
            assert cancellationEvent().wait(2)
            checkCancelled()
        finally:
            cleaned.set()
    analysisKit.service.retrieval.embeddings.embedQuery = embed
    analysisKit.service.retrieval.vectors.ensureCollection = Mock(side_effect=AssertionError("No indexing permitted."))
    analysisKit.service.language.generate = Mock(side_effect=AssertionError("No generation permitted."))
    client = ClientRun(makeApp(analysisKit)); await waitEntered(entered); client.disconnect.set()
    assert await client.finish() == b"" and cleaned.is_set()
    analysisKit.service.retrieval.vectors.ensureCollection.assert_not_called()
    analysisKit.service.language.generate.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["iam", "generation", "retryDelay"])
async def testDisconnectAbortsTransportOrRetryDelayWithoutPartialOutput(analysisKit, stage, caplog):
    entered = Event(); cleaned = Event(); closed = []; paths = []
    async def respond(request):
        paths.append(request.url.path)
        if request.url.path == "/identity/token" and stage != "iam":
            return tokenReply()
        entered.set()
        if stage == "retryDelay":
            return httpx.Response(429, headers={"Retry-After": "1"})
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.set()
    language = attachLanguage(analysisKit, respond, closed)
    client = ClientRun(makeApp(analysisKit)); await waitEntered(entered); client.disconnect.set()
    assert await client.finish() == b""
    assert len(paths) == (1 if stage == "iam" else 2) and closed == [True]
    assert not language.refreshLock.locked()
    assert stage == "retryDelay" or cleaned.is_set()
    assert "fictional cancellation context" not in caplog.text and BriefText not in caplog.text


@pytest.mark.asyncio
async def testDisconnectDuringIamWaitNeverReleasesAnotherOwnersLock(analysisKit):
    entered = Event(); closed = []; calls = []
    def respond(request):
        calls.append(request.url.path)
        return tokenReply()
    language = attachLanguage(analysisKit, respond, closed)
    originalFactory = language.transportFactory
    def factory():
        entered.set()
        return originalFactory()
    language.transportFactory = factory
    language.refreshLock.acquire()
    try:
        client = ClientRun(makeApp(analysisKit)); await waitEntered(entered); client.disconnect.set()
        assert await client.finish() == b""
        assert language.refreshLock.locked() and calls == [] and closed == [True]
    finally:
        language.refreshLock.release()


@pytest.mark.asyncio
async def testCancelledRefreshOwnerReleasesLockAndOtherRequestRefreshes(analysisKit):
    firstEntered = Event(); secondEntered = Event(); guard = Lock(); authCalls = [0]; factories = [0]; closed = []
    async def respond(request):
        if request.url.path == "/identity/token":
            with guard:
                authCalls[0] += 1
                ordinal = authCalls[0]
            if ordinal == 1:
                firstEntered.set()
                await asyncio.Event().wait()
            return tokenReply()
        return chatReply(validDraft(analysisKit))
    language = attachLanguage(analysisKit, respond, closed)
    originalFactory = language.transportFactory
    def factory():
        with guard:
            factories[0] += 1
            if factories[0] == 2:
                secondEntered.set()
        return originalFactory()
    language.transportFactory = factory
    app = makeApp(analysisKit)
    owner = ClientRun(app, "fictional refresh owner"); await waitEntered(firstEntered)
    waiter = ClientRun(app, "fictional refresh waiter"); await waitEntered(secondEntered)
    owner.disconnect.set()
    assert await owner.finish() == b""
    assert json.loads(await waiter.finish())["response"]["responseType"] == "AgentResponse"
    assert authCalls == [2] and len(closed) == 2 and not language.refreshLock.locked()


@pytest.mark.asyncio
async def testOnlyDisconnectedGenerationIsCancelled(analysisKit):
    entered = Event(); released = Event(); closed = []
    async def respond(request):
        if request.url.path == "/identity/token":
            return tokenReply()
        case = json.loads(json.loads(request.content)["messages"][1]["content"])["CaseData"]
        if case["additionalNotes"] == "fictional cancelled request":
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                released.set()
        return chatReply(validDraft(analysisKit))
    language = attachLanguage(analysisKit, respond, closed)
    app = makeApp(analysisKit)
    cancelled = ClientRun(app, "fictional cancelled request"); await waitEntered(entered)
    normal = ClientRun(app, "fictional independent request")
    cancelled.disconnect.set()
    assert await cancelled.finish() == b""
    payload = json.loads(await normal.finish())
    assert payload["response"]["responseType"] == "AgentResponse" and released.is_set()
    assert "fictional cancelled request" not in json.dumps(payload)
    assert len(closed) == 2 and not language.refreshLock.locked()


@pytest.mark.asyncio
async def testNormalRequestAndFollowingRequestRetainPublicContract(analysisKit):
    analysisKit.service.language = StatelessLanguage()
    app = makeApp(analysisKit)
    for marker in ["fictional first context", "fictional second context"]:
        payload = json.loads(await ClientRun(app, marker).finish())
        assert list(payload)[0] == "warnings"
        assert payload["response"]["responseType"] == "AgentResponse"
        assert marker not in json.dumps(payload)
    assert cancellationEvent() is None


@pytest.mark.asyncio
async def testOwnerTaskCancellationJoinsTransportCleanup(analysisKit):
    entered = Event(); closed = []; cleaned = Event()
    async def respond(request):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.set()
    language = attachLanguage(analysisKit, respond, closed)
    client = ClientRun(makeApp(analysisKit)); await waitEntered(entered); client.task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await client.finish()
    assert cleaned.is_set() and closed == [True] and not language.refreshLock.locked()


def testAdapterCancellationRemainsDistinctAndNonretryable():
    signal = Event(); signal.set()
    factory = Mock(side_effect=AssertionError("No transport permitted."))
    language = WatsonxLanguage(configure(), factory)
    with pytest.raises(LanguageCancelled):
        asyncio.run(language.generateAsync(requestCase(), signal))
    factory.assert_not_called()


def testCancellationBeforeZeroDelayRetryPreventsAnotherAttempt():
    signal = Event(); calls = []
    def respond(request):
        calls.append(request.url.path)
        signal.set()
        return httpx.Response(429, headers={"Retry-After": "0"})
    language = WatsonxLanguage(configure(watsonxRetries=2), lambda: httpx.MockTransport(respond))
    with pytest.raises(LanguageCancelled):
        asyncio.run(language.generateAsync(requestCase(), signal))
    assert calls == ["/identity/token"] and not language.refreshLock.locked()


@pytest.mark.asyncio
async def testCancelledIamWaiterLeavesActiveOwnerAndCachedTokenUsable(analysisKit):
    entered = Event(); waiterEntered = Event(); release = Event(); closed = []; guard = Lock(); factories = [0]; calls = [0]
    async def respond(request):
        if request.url.path == "/identity/token":
            calls[0] += 1
            entered.set()
            while not release.is_set():
                await asyncio.sleep(.001)
            return tokenReply()
        return chatReply(validDraft(analysisKit))
    language = attachLanguage(analysisKit, respond, closed)
    originalFactory = language.transportFactory
    def factory():
        with guard:
            factories[0] += 1
            if factories[0] == 2:
                waiterEntered.set()
        return originalFactory()
    language.transportFactory = factory
    app = makeApp(analysisKit)
    owner = ClientRun(app); await waitEntered(entered)
    waiter = ClientRun(app); await waitEntered(waiterEntered); waiter.disconnect.set()
    assert await waiter.finish() == b""
    assert language.refreshLock.locked() and calls == [1] and not owner.task.done()
    release.set()
    assert json.loads(await owner.finish())["response"]["responseType"] == "AgentResponse"
    assert json.loads(await ClientRun(app).finish())["response"]["responseType"] == "AgentResponse"
    assert calls == [1] and len(closed) == 3 and not language.refreshLock.locked()
