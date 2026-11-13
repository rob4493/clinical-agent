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
