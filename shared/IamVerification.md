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
iamRejected, iamResponseInvalid, iamTimeout, networkFailure or internal. Disabled
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
