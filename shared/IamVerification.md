# Offline failure-stage refinement and activation proposal

Current operator instruction: leave hosted configuration unchanged. Shutdown is
not a prerequisite for offline work. No IBM request, hosted setting or deployment
was changed while preparing this refinement. Existing expiry, kill switch,
operator checks, request allowlist and all fail-closed gates remain enforced.

The previously returned metadataInvalid establishes validated IAM issuance, but
cannot identify which metadata response failed. No raw response was retained, so
its exact cause cannot be recovered offline. Synthetic reproduction demonstrates
that wrapped inventories, unexpected environment shapes, missing references and
invalid OpenAPI bindings all previously collapsed to the same result. These are
alternatives, not a diagnosis of the hosted payload.

The existing endpoint now attaches only fixed stage/check fields to metadata
failures, plus authentication PASS (only after broker success) or NOT_TESTED for
pre-IAM configuration failures. No provider field name, value, URL, identifier,
response excerpt, stack or secret is echoed. Reader failures distinguish content
format, missing body, byte bound and invalid JSON. Schema checks retain their
original restrictions; no envelope is guessed or silently accepted.

Stages: configuration, environmentList, liveEnvironment, releaseStatus,
agentDefinition, toolInventory, moduleListingDefinition,
clinicalAnalysisDefinition, moduleListingConnection, clinicalAnalysisConnection.
Unknown errors retain generic handling. Original IAM-only responses are unchanged.

## Single-use activation proposal — design only, NOT implemented or authorized

Use the same protected endpoint for a future explicit operator arm action. Its
server-created approval would bind the exact preview deployment, operator,
metadata-only operation and a <=10 minute expiry. It must never derive identity
or allowed operations from request headers or caller parameters.

Reuse the existing conditional-write/strong-readback storage adapter for one
immutable authorization-consumption marker in an isolated metadata-authorization
store. Claim that marker BEFORE IAM; only the winner may exchange a token.
The authorization key must be derived from the existing approved expiry, site
and fixed metadata operation, not a new per-click random ID, browser parameters,
worker ID, operator change or deployment change. Store the authorized operator
and expected deployment in the immutable arm record. Repeated arm clicks in the
same approved window return that existing authorization; they cannot create a
new allowance, including after consumption or a rebuild.

Concurrent requests, failure, timeout and cancellation burn the authorization;
there is no reset, refund, automatic retry or automatic re-arming. This marker is
not a Blue Lantern or inference quota ticket. Existing quota stores stay untouched.
Do not use process memory or a signed browser receipt alone for single-use.

The operator could arm and execute once without editing variables again while
the existing authorized environment window remains valid. Approval expiry must
be min(now+10 minutes, existing ORCHESTRATE_IAM_DIAGNOSTIC_UNTIL, session expiry).
The present environment expiry and kill switch remain hard ceilings. After that
expiry, the current policy MUST reject every request. Removing future manual
expiry edits entirely would require separate approval of a different master-window
policy; this proposal does not silently extend or bypass the current expiry.

This design requires separately reviewed storage writes and an arm contract, and
is intentionally NOT included in the stage-reporting patch. It introduces no new
credential, agent, endpoint or inference quota algorithm. For now, no POST should
be repeated. Deployment and any new metadata attempt need separate authorization.

---

# Metadata-only extension — local preparation, Live Endo v2.0.0

The existing verifyIam endpoint now supports a separately gated fixed action
`{"action":"metadata"}`. No new endpoint, credential or quota system is added.
The original `{"action":"verify"}` still performs IAM-only verification.
The historical IAM-only instructions below describe that original action only.

## Disabled controls and future operator procedure

Default ORCHESTRATE_METADATA_DIAGNOSTIC_ENABLED=false. All existing IAM diagnostic
controls, exact unpublished Preview #4 pins, trusted allowlist and future Date
expiration, inference-disabled flags, embed kill switch and telemetry gate remain
mandatory. Metadata also rejects an active Blue Lantern exception. GET remains
readiness-only with zero credential/network/storage operations; it is not a
metadata query. Missing metadata opt-in rejects the metadata POST before IAM.

After separate commit/push/deployment AND execution approval only:
1. Deploy the reviewed candidate to protected Preview #4 with both diagnostics
   disabled, IAM kill switch engaged and expiry blank. Confirm commit and SSO.
2. Temporarily set ORCHESTRATE_IAM_DIAGNOSTIC_ENABLED=true,
   ORCHESTRATE_IAM_DIAGNOSTIC_KILL_SWITCH=false,
   ORCHESTRATE_IAM_DIAGNOSTIC_UNTIL to a fresh UTC expiry <=10 minutes ahead,
   and ORCHESTRATE_METADATA_DIAGNOSTIC_ENABLED=true, only in approved preview
   Functions scope. Rebuild if needed. Keep Blue Lantern, its exception, public
   chat, embed, editable Send and all inference disabled. No credential changes.
3. Authenticated GET verifyIam must return READY/operatorReady. Then run once:

```javascript
fetch('/.netlify/functions/verifyIam', {
 method:'POST', credentials:'same-origin', redirect:'error', cache:'no-store',
 headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'metadata'})
}).then(r=>r.json()).then(report=>console.log(report));
```

One invocation exchanges IAM once; a fresh broker is discarded afterward. It
performs at most 12 bounded metadata GETs, each <=2 seconds, within a 27-second
request budget. JSON is capped at 256 KiB per reply, strict duplicate-key and depth
validation, no redirects, no application retries. The existing rate limit remains
2 requests/60 seconds. This is NOT a distributed single-use ticket: the operator
must invoke once and shut down; a repeat POST would authenticate again. No probe
quota store is touched or modified to enforce diagnostic single-use.

4. Immediately set ORCHESTRATE_METADATA_DIAGNOSTIC_ENABLED=false,
   ORCHESTRATE_IAM_DIAGNOSTIC_ENABLED=false, IAM_DIAGNOSTIC_KILL_SWITCH=true,
   and IAM_DIAGNOSTIC_UNTIL blank (all IAM names prefixed ORCHESTRATE_).
   Rebuild when necessary; authenticated GET must return 404/DISABLED/disabled.

## Exact metadata request boundaries

Using the existing configured canonical EU-DE /instances/{instanceId} base,
correct UUID c6698d4e-a08d-4b77-bf05-139ff3b4c695 and environment=live:
- GET /v1/orchestrate/agents/{fixedAgentId}/environment
- GET /v1/orchestrate/agents/{fixedAgentId}/releases/status?environment_id={referencedLiveId}
- GET /v1/orchestrate/agents/{fixedAgentId}
- GET /v1/orchestrate/tools
- GET /v1/orchestrate/tools/{referencedToolId}, only the two expected names
- Where referenced, GET /v1/orchestrate/connections/applications?connection_id={id}
  followed by GET /v1/orchestrate/connections/applications/{appId}/configurations/live

IDs use a bounded safe alphabet and can only fill these fixed paths. No caller
URLs, provider URLs, callback destinations, credentials endpoints, runtime
credentials, artifacts, schemas, tool invocation, analysis, agent chat or model
routes are fetched. Unexpected extra tools/unsafe IDs/unsupported response shapes
fail closed. Unexpected links, plugins, callbacks, binding types or extensions
are flagged and never followed. A catalog of >200 tools or a paginated/enveloped
shape not explicitly understood is rejected, not silently truncated.

## Evidence limitations — do not claim Live proof

IBM's SDK calls the generic agent and tool detail getters get_draft_by_id.
Their returned bindings can be shared or Draft metadata. A Live environment and
successful release status do NOT establish that these exact generic definitions
are the immutable v2.0.0 deployment snapshot. The diagnostic always reports
BLOCKED/liveSnapshotNotEstablished and liveAgentAssociation NOT_VERIFIED for this
reason, even when generic methods/paths/servers match. An internal current_version
reference is not assumed to mean the displayed semantic version 2.0.0. Missing
operation IDs, authentication, version or indirect actions remain notExposed or
UNKNOWN. No alternate version endpoint is invented or tried automatically.

Only fixed comparisons/status codes leave the Function: matched/different/missing
method/path/server/operation-ID fields, declared authentication category, presence
of connection metadata, and indirect-action flags. No provider prose, names, IDs,
URLs, version identifiers, configuration values, headers, raw JSON, exceptions,
API keys or bearer tokens are returned or logged. Connection config is held only
in memory; credential-bearing fields are neither selected nor echoed.

Nonclinical downstream analysis/presentation and runtime permission enforcement
cannot be proven by catalog metadata alone. This diagnostic supplies evidence;
it does not set a verification flag or authorize Blue Lantern.

## Public implementation references inspected 2026-11-14

Official IBM ADK source, not tenant requests or software installation:
- https://github.com/IBM/ibm-watsonx-orchestrate-adk/blob/main/packages/clients/ibm_watsonx_orchestrate_clients/agents/agent_client.py
- https://github.com/IBM/ibm-watsonx-orchestrate-adk/blob/main/packages/clients/ibm_watsonx_orchestrate_clients/tools/tool_client.py
- https://github.com/IBM/ibm-watsonx-orchestrate-adk/blob/main/packages/clients/ibm_watsonx_orchestrate_clients/connections/connections_client.py
- https://github.com/IBM/ibm-watsonx-orchestrate-adk/blob/main/packages/core/ibm_watsonx_orchestrate_core/types/tools/types.py

---

# Prepared protected IAM-only diagnostic

Status: local preparation only. Separate deployment, activation and execution approval
is required. No real token exchange was executed during preparation.

Confirmed history: the operator confirmed the existing probe GET returns 404 with
reason disabled, and previously confirmed original Live Agent Endo v1.0.0 restored
at its original UUID with the original two tools. The first attempt's coarse
'authenticationFailure' cannot distinguish IAM exchange/response failure from an
Orchestrate endpoint 401. Available sanitized Function logs lack that distinction.
No authenticated IBM audit events were accessible to this preparation environment.
Do not infer successful IAM issuance merely because no failed-login event is found.
IBM documents that failed login actions do not generate account-visible audit events:
https://cloud.ibm.com/docs/iam?topic=iam-at_events_iam (Failed log in actions).

The prepared Function /.netlify/functions/verifyIam reuses createWatsonRuntime's
existing IAM broker. It has no Orchestrate, tool, model, analysis or quota-store
operation. Its transport accepts one POST only to the broker's fixed official IBM
IAM URL, rejects redirects and credentials in URL, and adds no retries. The existing
key is read only by an approved POST. A fresh broker is created per invocation;
its token is discarded, never returned, logged or kept in a module cache. IBM can
issue a token and generate authentication events; this is not an inference call.

Default-disabled controls (proposed Deploy Preview Functions scope only):
- ORCHESTRATE_IAM_DIAGNOSTIC_ENABLED=false
- ORCHESTRATE_IAM_DIAGNOSTIC_KILL_SWITCH=true
- ORCHESTRATE_IAM_DIAGNOSTIC_UNTIL=blank

Approved execution would require enabled=true, kill=false, and a future UTC expiry
no more than ten minutes ahead. Do not set these during preparation. Unpublished
trusted context.deploy must be deploy-preview, exact Preview #4 origin and pins,
and context.user must be allowlisted with an unexpired Date. Caller identity
headers, query parameters and body fields cannot establish authorization. All eight
legacy inference flags must remain false; demo kill=true, conversation mode=disabled,
telemetry disabled, embedded chat disabled with its kill engaged. The Blue Lantern
probe and its window must be closed. Editable chat and quota harness must be closed.
A successful readiness result grants no independent execution permission.

GET returns READY/operatorReady without reading credentials or making network calls.
After separate execution approval only, POST accepts exactly {"action":"verify"}
within 64 bytes. Total Function deadline: four seconds; existing broker budget:
at most two seconds, additionally bounded by its configured timeout. Client abort
propagates and returns empty 499. No application retries. Configured platform rule:
two requests per 60 seconds per IP/domain; local configuration is not hosted proof.

Fixed status/reason pairs include PASS/iamAccepted and FAIL with configuration,
iamHttp400, iamHttp401, iamHttp403, iamHttp429, iamHttp5xx, iamRejected
(other non-200 status), iamResponseInvalid, iamTimeout, networkFailure or internal. Disabled
returns 404 DISABLED/disabled; unauthorized returns 403 FAIL/operatorRequired. No
upstream HTTP status, body, exception, key identifier, hash, token or credential
metadata is returned. GET/POST retain no-store, nosniff, no-referrer and same-origin
resource headers. Broker error classification uses its real internal error type,
not message matching or a caller-forged reason field. HTTP rejection is not proof
of an invalid key: transient IAM/service restrictions can also reject a request.

Exact next approval: authorize the scoped diagnostic deployment, preview-only
activation for one IAM exchange, and immediate disable/kill/expiry-clear plus
verified preview redeployment afterward. This does not authorize Blue Lantern,
Agent Endo, clinical tools, editable Send or public/production inference.

Once deployment is separately authorized, first confirm probe GET 404/disabled,
then authenticated diagnostic GET READY/operatorReady. After execution approval,
run exactly one same-origin POST with Content-Type application/json and body
{"action":"verify"}, credentials same-origin, redirect error, cache no-store.
Capture only status/reason. Never export HAR, headers, cookies, raw response bodies,
environment exports or tokens. On any failure do not retry automatically.

After that authorized execution: set enabled=false, kill=true, clear expiry in
Deploy Preview only; redeploy Preview #4 and confirm authenticated diagnostic GET
404 DISABLED/disabled. Also confirm probe remains 404/disabled. Do not clear quota
records or change the existing secret. Original agent remains untouched.

Interpretation: iamAccepted proves current issuance and broker validation, not
Orchestrate agent permissions or the exact historical failure stage. Rejection or
response failure isolates a current IAM-stage problem; it does not by itself
justify replacing a key. Historical attribution still requires correlated existing
events or support evidence. Absence of an account-visible failure event is inconclusive.

## Prepared HTTP-status refinement (separate execution approval required)

The diagnostic previously returned FAIL/iamRejected. This establishes a non-200
response from IAM during that diagnostic, not an Orchestrate bearer rejection.
It does not identify the status or justify changing the key. The operator confirmed
shutdown using authenticated GET 404 / DISABLED / disabled. Management metadata
also showed enabled=false, kill=true and a closed window with a ready unpublished
shutdown deployment. No further token exchange is authorized by this preparation.

Only the existing diagnostic transport captures a fixed response-status category:
400 -> iamHttp400; 401 -> iamHttp401; 403 -> iamHttp403; 429 -> iamHttp429;
500..599 -> iamHttp5xx; other non-200 -> iamRejected. These are not provider error
messages. No body, header, credential identifier or arbitrary status is returned.
The unchanged IAM broker still cancels rejected bodies and validates successful
responses. Status 200 with malformed token data remains iamResponseInvalid.
All non-diagnostic broker/Watson behavior remains unchanged.

Request comparison against official IBM instructions:
- POST https://iam.cloud.ibm.com/identity/token
- Content-Type: application/x-www-form-urlencoded; Accept: application/json
- URLSearchParams fields grant_type=urn:ibm:params:oauth:grant-type:apikey and apikey
- No new Authorization header, account field, endpoint or credential transformation
Official references: https://cloud.ibm.com/docs/iam?topic=iam-iamtoken_from_apikey
and https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=api-generating-access-token-cloud

After separate approval: deploy only this six-path refinement to PR #4, verify
Preview #4 remains protected/unpublished and the diagnostic GET is 404 disabled.
For the approved one-shot only, set diagnostic enabled=true, kill=false and a fresh
UTC expiry at most ten minutes ahead in Deploy Preview / Functions scope. Change
no other settings. Redeploy only Preview #4. Allow 60 seconds since any earlier
verifyIam request so readiness GET plus the one POST fit the 2/60s rule.

Run this updated browser-console script ONCE from the authenticated Preview #4.
The older console allowlist does not recognize the new status codes and must not
be reused. This script makes one readiness GET and at most one token-exchange POST:

```javascript
(async () => {
  if (location.origin !== 'https://deploy-preview-4--clinicalagent.netlify.app')
    throw new Error('Wrong preview.');
  if (window.__endoIamHttpAttempted) throw new Error('Do not retry.');
  const path = '/.netlify/functions/verifyIam';
  const options = {credentials:'same-origin', redirect:'error', cache:'no-store'};
  try {
    const r = await fetch(path, {...options, signal:AbortSignal.timeout(7000)});
    const ready = await r.json();
    if (!r.ok || ready.version !== '1' || ready.status !== 'READY' ||
        ready.reason !== 'operatorReady') throw new Error();
    window.__endoIamHttpAttempted = true;
    const response = await fetch(path, {...options, method:'POST',
      signal:AbortSignal.timeout(7000), headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'verify'})});
    const result = await response.json();
    const allowed = ['iamAccepted','iamHttp400','iamHttp401','iamHttp403',
      'iamHttp429','iamHttp5xx','iamRejected','iamResponseInvalid','iamTimeout',
      'configuration','networkFailure','internal','inputRejected',
      'operatorRequired','disabled'];
    console.table({status:['PASS','FAIL','DISABLED'].includes(result.status)
      ? result.status : 'UNKNOWN', reason:allowed.includes(result.reason)
      ? result.reason : 'unexpectedResult'});
  } catch { console.error('Request failed. Do not retry.'); }
  finally { console.info('Disable the diagnostic now.'); }
})();
```

Immediately afterward, even on failure: set enabled=false, kill=true, clear expiry,
redeploy Preview #4 and verify authenticated GET 404 / DISABLED / disabled.
Do not repeat POST or reset quota records. Do not call Agent Endo or modify keys.
An HTTP category narrows diagnosis but does not reveal the specific OAuth error.
