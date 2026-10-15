"""Injected REST chat adapter; transient drafts never grant clinical approval."""

import asyncio
import errno
import json
import logging
import time
from threading import Lock
from contextlib import nullcontext

import httpx
from pydantic import SecretStr

from backend.app.config import Settings
from backend.app.models.analysis import AnalysisDraft, ModelRequest
from backend.app.services.cancellation import RequestCancelled, cancellationEvent, cancellationScope, checkCancelled

FailureMessage = "Language service unavailable."


class LanguageError(RuntimeError):
    """Fixed provider failure; no payload, transport object or sensitive detail."""


class LanguageCancelled(LanguageError):
    """Distinct nonretryable cancellation; compatible with existing safe error handling."""


class LanguageOutputError(LanguageError):
    """Provider output failed parsing; distinct from transport/authentication unavailability."""


def readJson(encoded):
    """Reject duplicate keys and nonfinite values instead of silently normalizing them."""
    def pairs(entries):
        parsed = {}
        for key, entry in entries:
            if key in parsed:
                raise ValueError()
            parsed[key] = entry
        return parsed
    def rejectConstant(constant):
        raise ValueError()
    return json.loads(encoded, object_pairs_hook=pairs, parse_constant=rejectConstant)


def disableTransportLogs():
    # HTTPX logs URLs at INFO; HTTP Core DEBUG diagnostics can include sensitive headers.
    for loggerName in tuple(logging.Logger.manager.loggerDict) + ("httpx", "httpcore"):
        if loggerName == "httpx" or loggerName == "httpcore" or loggerName.startswith(("httpx.", "httpcore.")):
            logging.getLogger(loggerName).disabled = True


def createTransport():
    """Explicit factory only; zero library retries, no environment proxy or telemetry."""
    return httpx.AsyncHTTPTransport(retries=0)


class WatsonxLanguage:
    """Single-turn chat, bounded IAM refresh, strict draft parsing and no case cache.

    An injected transport factory must create a single-attempt cooperative async
    transport per operation. Only IAM token and expiry metadata are shared.
    """

    def __init__(self, settings: Settings, transportFactory, clock=time.monotonic, wallClock=time.time):
        if settings.languageProvider != "watsonx" or settings.clinicalDemoMode or not callable(transportFactory):
            raise LanguageError(FailureMessage)
        try:
            settings.validateLanguage()
        except Exception:
            raise LanguageError(FailureMessage) from None
        self.settings = settings.model_copy(deep=True)
        self.transportFactory = transportFactory
        self.clock = clock
        self.wallClock = wallClock
        self.refreshLock = Lock()
        self.token = SecretStr("")
        self.tokenExpiry = 0.0

    def generate(self, request: ModelRequest) -> dict:
        """Preserve the synchronous neutral interface; async owners use generateAsync."""
        try:
            checkCancelled()
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(self.generateAsync(request, cancellationEvent()))
        raise LanguageError(FailureMessage)

    async def generateAsync(self, request: ModelRequest, cancelEvent=None) -> dict:
        """Owner cancellation or per-request event aborts transport and lock waiting."""
        try:
            if cancelEvent is not None and cancelEvent.is_set():
                raise LanguageCancelled(FailureMessage)
            with cancellationScope(cancelEvent) if cancelEvent is not None else nullcontext():
                async with asyncio.timeout(self.settings.watsonxDeadline):
                    operation = asyncio.create_task(self.runOperation(request))
                    watcher = asyncio.create_task(self.watchCancel(cancelEvent, operation)) if cancelEvent is not None else None
                    try:
                        return await operation
                    finally:
                        if not operation.done():
                            operation.cancel()
                        await asyncio.gather(operation, return_exceptions=True)
                        if watcher is not None:
                            watcher.cancel()
                            await asyncio.gather(watcher, return_exceptions=True)
        except (asyncio.CancelledError, RequestCancelled):
            raise LanguageCancelled(FailureMessage) from None
        except LanguageCancelled:
            raise
        except LanguageOutputError:
            raise
        except Exception:
            raise LanguageError(FailureMessage) from None

    async def watchCancel(self, cancelEvent, operation):
        while not operation.done():
            if cancelEvent.is_set():
                operation.cancel()
                return
            await asyncio.sleep(.01)

    def remaining(self, deadline):
        checkCancelled()
        remaining = deadline - self.clock()
        if remaining <= 0:
            raise LanguageError(FailureMessage)
        return min(self.settings.watsonxTimeout, remaining)

    async def runOperation(self, request):
        deadline = self.clock() + self.settings.watsonxDeadline
        request = ModelRequest.model_validate(request.model_dump())
        sections = readJson(request.content)
        if type(sections) is not dict or set(sections) != {"CaseData", "EvidenceData", "AllowedStatements", "EligibleQuestions"}:
            raise LanguageError(FailureMessage)
        if request.instructions != self.instructions():
            raise LanguageError(FailureMessage)
        disableTransportLogs()
        async with httpx.AsyncClient(transport=self.transportFactory(), trust_env=False, follow_redirects=False) as client:
            token = await self.getToken(client, deadline)
            if self.settings.runtimeMode() == "competition":
                from backend.competition.generation import CompetitionDraft
                schema = CompetitionDraft.model_json_schema()
                schema["required"] = ["responseType", "considerations", "question"]
            else:
                schema = AnalysisDraft.model_json_schema()
            # Strict IBM JSON output requires all properties, including nullable questionId.
                schema["required"] = ["considerations", "questionId"]
                schema["properties"]["questionId"].pop("default", None)
            payload = {
                "model_id": self.settings.watsonxLlmModelId,
                "project_id" if self.settings.watsonxProjectId else "space_id": self.settings.watsonxProjectId or self.settings.watsonxSpaceId,
                "messages": [{"role": "system", "content": request.instructions + " Return only valid JSON matching the supplied schema."},
                    {"role": "user", "content": json.dumps(sections, ensure_ascii=False, separators=(",", ":"))}],
                "response_format": {"type": "json_schema", "json_schema": {"name": "AnalysisDraft", "strict": True, "schema": schema}},
                "max_tokens": self.settings.watsonxMaxTokens, "temperature": self.settings.watsonxTemperature, "n": 1,
            }
            payload["time_limit"] = max(1, int(self.remaining(deadline) * 1000))
            response = await self.post(client, self.settings.watsonxUrl.rstrip("/") + "/ml/v1/text/chat", deadline,
                headers={"Authorization": "Bearer " + token, "Accept": "application/json"},
                params={"version": self.settings.watsonxApiVersion}, json=payload)
            if response.status_code in (401, 403):
                while not self.refreshLock.acquire(blocking=False):
                    self.remaining(deadline)
                    await asyncio.sleep(.01)
                try:
                    if self.token.get_secret_value() == token:
                        self.token = SecretStr(""); self.tokenExpiry = 0
                finally:
                    self.refreshLock.release()
            if response.status_code != 200:
                raise LanguageError(FailureMessage)
            try:
                draft = self.readDraft(readJson(response.content))
            except Exception:
                raise LanguageOutputError(FailureMessage) from None
            self.remaining(deadline)
            return draft

    def instructions(self):
        if self.settings.runtimeMode() == "competition":
            from backend.competition.generation import Instructions
            return Instructions
        from backend.app.services.analysis import Instructions
        return Instructions

    async def getToken(self, client, deadline):
        # A threading lock coordinates independent synchronous callers/event loops.
        # A waiter uses its own cancellation/deadline without cancelling the refresh
        # already owned by another request.
        while not self.refreshLock.acquire(blocking=False):
            self.remaining(deadline)
            await asyncio.sleep(.01)
        try:
            if self.clock() < self.tokenExpiry:
                return self.token.get_secret_value()
            response = await self.post(client, self.settings.watsonxIamUrl, deadline,
                headers={"Accept": "application/json"},
                data={"grant_type": "urn:ibm:params:oauth:grant-type:apikey", "apikey": self.settings.watsonxApiKey.get_secret_value()})
            if response.status_code != 200:
                raise LanguageError(FailureMessage)
            tokenFields = readJson(response.content)
            allowed = {"access_token", "refresh_token", "ims_user_id", "token_type", "expires_in", "expiration", "scope"}
            if (type(tokenFields) is not dict or set(tokenFields) - allowed
                    or tokenFields.get("token_type") != "Bearer"
                    or type(tokenFields.get("access_token")) is not str
                    or not 1 <= len(tokenFields["access_token"]) <= 16000
                    or any(not (character.isascii() and (character.isalnum() or character in "-._~+/=")) for character in tokenFields["access_token"])
                    or type(tokenFields.get("expires_in")) is not int or type(tokenFields.get("expiration")) is not int):
                raise LanguageError(FailureMessage)
            if any(field in tokenFields and type(tokenFields[field]) is not str for field in ("refresh_token", "scope")):
                raise LanguageError(FailureMessage)
            if "ims_user_id" in tokenFields and type(tokenFields["ims_user_id"]) not in (str, int):
                raise LanguageError(FailureMessage)
            lifetime = min(tokenFields["expires_in"], tokenFields["expiration"] - self.wallClock()) - self.settings.watsonxRefreshMargin
            if lifetime <= 0:
                raise LanguageError(FailureMessage)
            self.token = SecretStr(tokenFields["access_token"])
            self.tokenExpiry = self.clock() + lifetime
            return self.token.get_secret_value()
        finally:
            self.refreshLock.release()

    async def post(self, client, endpoint, deadline, **options):
        for attempt in range(self.settings.watsonxRetries + 1):
            timeout = self.remaining(deadline)
            if "json" in options:
                options["json"]["time_limit"] = max(1, int(timeout * 1000))
            try:
                async with asyncio.timeout(timeout):
                    async with client.stream("POST", endpoint, timeout=timeout, **options) as response:
                        if response.status_code not in (429, 502, 503, 504):
                            if response.status_code != 200:
                                return response
                            if response.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
                                raise LanguageError(FailureMessage)
                            encoded = bytearray()
                            async for block in response.aiter_bytes():
                                encoded.extend(block)
                                if len(encoded) > 65536:
                                    raise LanguageError(FailureMessage)
                            return httpx.Response(200, content=bytes(encoded))
                        retryAfter = response.headers.get("Retry-After")
                        # Never guess a shorter wait when an unsupported Retry-After is supplied.
                        if retryAfter is not None and not (retryAfter.isascii() and retryAfter.isdigit() and len(retryAfter) <= 6):
                            raise LanguageError(FailureMessage)
                        delay = float(retryAfter) if retryAfter is not None else min(.25 * (2 ** attempt), 1)
            except (httpx.ConnectError, httpx.ConnectTimeout) as failure:
                if not self.isTransient(failure):
                    raise LanguageError(FailureMessage) from None
                delay = min(.25 * (2 ** attempt), 1)
            # Read/write timeouts are ambiguous completed generations: never replay them.
            if attempt == self.settings.watsonxRetries or delay >= deadline - self.clock():
                raise LanguageError(FailureMessage)
            await asyncio.sleep(delay)
        raise LanguageError(FailureMessage)

    def isTransient(self, failure):
        if isinstance(failure, httpx.ConnectTimeout):
            return True
        cause = failure.__cause__
        for depth in range(8):
            if isinstance(cause, OSError) and cause.errno in {errno.ECONNREFUSED, errno.ECONNRESET, errno.ETIMEDOUT, errno.EHOSTUNREACH, errno.ENETUNREACH}:
                return True
            if cause is None:
                break
            cause = cause.__cause__
        return False

    def readDraft(self, payload):
        allowed = {"id", "model_id", "model", "choices", "created", "model_version", "created_at", "usage", "system"}
        if type(payload) is not dict or set(payload) - allowed or type(payload.get("choices")) is not list or len(payload["choices"]) != 1:
            raise LanguageError(FailureMessage)
        for field in ("id", "model_id", "model", "model_version", "created_at"):
            if field in payload and type(payload[field]) is not str:
                raise LanguageError(FailureMessage)
        for field in ("model_id", "model"):
            if field in payload and payload[field] != self.settings.watsonxLlmModelId:
                raise LanguageError(FailureMessage)
        if "created" in payload and type(payload["created"]) is not int:
            raise LanguageError(FailureMessage)
        if "usage" in payload:
            usage = payload["usage"]
            if type(usage) is not dict or set(usage) != {"prompt_tokens", "completion_tokens", "total_tokens"} or any(type(count) is not int or count < 0 for count in usage.values()):
                raise LanguageError(FailureMessage)
            if usage["total_tokens"] != usage["prompt_tokens"] + usage["completion_tokens"] or usage["completion_tokens"] > self.settings.watsonxMaxTokens:
                raise LanguageError(FailureMessage)
        if "system" in payload:
            system = payload["system"]
            if type(system) is not dict or set(system) - {"warnings"} or type(system.get("warnings", [])) is not list:
                raise LanguageError(FailureMessage)
            for warning in system.get("warnings", []):
                if type(warning) is not dict or set(warning) - {"message", "id", "more_info"} or any(type(entry) is not str for entry in warning.values()):
                    raise LanguageError(FailureMessage)
        choice = payload["choices"][0]
        if (type(choice) is not dict or set(choice) - {"index", "message", "finish_reason", "logprobs"}
                or type(choice.get("index")) is not int or choice["index"] != 0 or choice.get("finish_reason") != "stop"
                or choice.get("logprobs") is not None):
            raise LanguageError(FailureMessage)
        message = choice.get("message")
        if (type(message) is not dict or set(message) - {"role", "content", "refusal"}
                or message.get("role") != "assistant" or message.get("refusal") is not None
                or type(message.get("content")) is not str or not 1 <= len(message["content"]) <= 24000):
            raise LanguageError(FailureMessage)
        draft = readJson(message["content"])
        if self.settings.runtimeMode() == "competition":
            from backend.competition.generation import CompetitionDraft
            CompetitionDraft.model_validate_json(json.dumps(draft, allow_nan=False))
            return draft
        if type(draft) is not dict or set(draft) != {"considerations", "questionId"}:
            raise LanguageError(FailureMessage)
        AnalysisDraft.model_validate_json(json.dumps(draft, allow_nan=False))
        return draft


def selectLanguage(settings: Settings, transportFactory=None):
    """Explicit composition only; demo never resolves IBM, defaults remain unavailable."""
    if settings.clinicalDemoMode:
        from backend.demo.runtime import DemoLanguage
        return DemoLanguage()
    if settings.languageProvider == "disabled":
        return None
    if transportFactory is None:
        raise LanguageError(FailureMessage)
    return WatsonxLanguage(settings, transportFactory)
