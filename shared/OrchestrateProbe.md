# Current competition development workflow

See [CompetitionTesting.md](CompetitionTesting.md) for the prepared default-disabled
Preview #4 development mode. It supersedes the one-attempt/two-call/per-attempt
approval policy ONLY when explicitly activated. The historical mode below remains
closed and its quota records are never read or modified by competition mode.
No hosted activation or inference is authorized by this local preparation.

# One-test residual-uncertainty amendment — prepared, NOT approved or activated

This section supersedes the prior independently-reviewed-Live-binding requirement
ONLY for the explicitly approved version-2 one-test exception below. The normal
restricted path still requires its original independent runtime-permission review.
There is no new metadata cycle, endpoint, agent, credential or quota system.

## Facts and uncertainties

Operator-confirmed: Live Agent Endo v2.0.0, existing UUID
c6698d4e-a08d-4b77-bf05-139ff3b4c695, EU-DE target, two visible original tools,
no displayed collaborators. IAM issuance previously passed. Repository definitions
are GET https://clinicalagent.netlify.app/api/v1/modules and POST
https://clinicalagent.netlify.app/api/v1/analyze, with no declared authentication.
These are declared/visible facts, not an immutable Live snapshot or effective
permission proof. Live bindings, authentication/connection overrides, indirect
workflows/actions, actual destinations and tool restrictions remain unverified.

A single protected synthetic probe can proceed as explicit risk acceptance under
an amended policy, NOT as a claim that those uncertainties were technically
eliminated. Any actually discovered unapproved tool/destination/action remains a
blocker pending separate review. Unknown possibilities are disclosed; known
contradictory evidence cannot be dismissed as merely unknown.

## Minimum record/code amendment

No new activation flag is introduced. ORCHESTRATE_PROBE_EXCEPTION_ENABLED remains
false by default; no hosted settings are changed. Both exception ACCESS_REVIEW and
EXCEPTION_APPROVAL require version 2, rejecting older approval records. Ordinary
restricted-mode review records remain version 1.

ACCESS_REVIEW keeps the exact UUID, v2.0.0 target, configured EU-DE URL and the two
expected repository operation descriptors. collaborators=[] means no collaborators
displayed to the operator, not a proved permission boundary. delegatedAgents,
workflows and otherActionPaths must each be the literal string unverified (not
empty arrays presented as an exhaustive review). Add exactly:

```json
"verification": {
  "liveBindings": "unverified",
  "indirectActions": "unverified",
  "toolRestrictions": "notEstablished",
  "knownUnapprovedActions": "noneReported",
  "privacyScope": "fixedSyntheticProbeAndUnverifiedDownstreamRisk"
}
```

Evidence scope must be operatorVisibleInventoryAndRepositoryDefinitions;
caseSubmission and downstreamInference remain possibleUnderException. Review
reference/freshness and exact approval SHA-256 binding remain enforced. The privacy
scope requires a fresh approval covering the fixed synthetic content AND the
unverified downstream risk; prior general flags are not evidence of that approval.
PRIVACY_VERIFIED and QUOTA_VERIFIED remain mandatory, with actual supporting
review/evidence. TOOLS_VERIFIED and USAGE_VERIFIED must remain false in this path.
No clinical privacy screening, safety warning, structured evidence, credential
boundary, operator check, prompt, quota algorithm or transport behavior changes.

## Exact additional operator acceptance — not yet obtained

I authorize ONE fixed two-turn Blue Lantern attempt through protected Preview #4
against the existing Live Agent Endo v2.0.0 and unchanged UUID. I understand that
the visible tool inventory and repository OpenAPI do not establish the effective
Live bindings or an exhaustive action graph. I explicitly accept:

1. Unexpected tool execution, including the existing clinical-analysis tool.
2. Model-invented synthetic case fields submitted without an explicit case request.
3. Unverified actual destinations, indirect/delegated workflows and external actions.
4. Use of existing IBM-side connection identities/credentials under unverified
   bindings; this does not authorize Endo to export keys or tokens.
5. Downstream clinical processing and optional presentation/model inference that
   is not bounded by Endo's two agent-call reservations.
6. IBM retention (previously reported as 30 days), operational logging, and unknown
   downstream retention/access policies; no real patient information is supplied.
7. Internal model/tool usage and potential costs without a hard spending ceiling;
   the Trial/non-billable account assertion is not proof of a usage cap.
8. Remote processing continuing after cancellation or expiry.

I accept these risks for this attempt only: two application agent-call reservations
maximum, one invocation, zero retries, no patient information, no caller text/cases/
uploads, <=30 minutes within one UTC day, authenticated allowlisted operator only,
immediate probe shutdown, no public conversation or Production activation. Known
unapproved operations/destinations remain excluded pending separate review.

The exact acceptedRisks set is the original six codes plus:
- unverifiedLiveBindingsAndIndirectActions
- unreviewedDownstreamDestinationsAndRetention
- unverifiedConnectionCredentialUseAndExternalActions

## Shortest future sequence — separate deployment AND execution approvals required

1. Review/approve this local policy amendment, commit/push to existing draft PR #4,
   and verify its automatic unpublished SSO-protected preview build. No merge.
2. Confirm current trusted operator/session and correct serving commit/target.
   Disabled GET proves closure only; after separately approved activation, GET
   returns 400/inputRejected only after trusted preview/operator validation and
   makes no IAM, quota or inference request.
3. Inspect existing EndoOrchestrateProbeQuota records read-only for current UTC day:
   no consumed daily slots or deterministic visit ordinal-zero/one tickets, and
   existing frozen policy (if present) dailyLimit=2. No reset or substitute keys.
   Read-only absence cannot guarantee future capacity; atomic reservation/readback
   at the one POST remains authoritative. Stop if quota evidence is unavailable.
4. Obtain the exact written acceptance above and scoped privacy approval. Prepare
   fresh version-2 review/approval records bound to the actual trusted operator,
   exact record hash, unchanged target and matching expiry <=30 minutes, not crossing
   UTC midnight. Do not reuse prior attempt approvals or infer consent from flags.
5. Only after separate activation authorization set Preview/Functions probe enabled,
   exception enabled, kill switch false, TEST_UNTIL=approval expiry and the two
   records. TOOLS_VERIFIED=false and USAGE_VERIFIED=false; privacy/quota flags true
   only with their supporting evidence. Keep public/legacy/embedded inference
   disabled, telemetry disabled, and Production unchanged. Rebuild if required.
6. Run ONE existing same-origin POST {"action":"probe"}. The existing Function
   performs both fixed messages, uses returned X-IBM-THREAD-ID for turn two without
   replaying turn one, and returns only sanitized outcomes. No separate IAM retry,
   arbitrary message, automatic retry or clinical-tool test is authorized.
7. Immediately set probe enabled=false, exception enabled=false, kill switch=true,
   TEST_UNTIL and exception approval blank; rebuild if necessary; verify authenticated
   GET 404/disabled. Do not clear tickets or modify the agent/tools.

Status now: PREPARED, NOT AUTHORIZED TO EXECUTE. Operator/session freshness,
current-day unused quota, scoped privacy acceptance and the new explicit residual-
uncertainty approval have not been checked or granted during this local task.

---

## Historical policy text (superseded only where explicitly amended above)

# Phase 1: protected server-to-server Orchestrate probe

Implemented and mocked offline; no live access, deployment or configuration change
is implied. Phase 2 panel integration is intentionally not implemented until this
hosted probe succeeds. The existing embed implementation and unified panel remain
intact. No clinical case, upload or free-text input is accepted by this endpoint.

## API and credential choice

The existing IBM Cloud service instance API URL from IBM API details belongs in
`ORCHESTRATE_API_URL`. Use the previously supplied instance-specific API address,
not `https://dl.watson-orchestrate.ibm.com` (the browser/embed address), a model
endpoint or an invented tenant ID. Existing Live Endo Clinical Assistant ID goes
in `ORCHESTRATE_AGENT_ID`; `ORCHESTRATE_ENVIRONMENT` must be `live` and
`WATSONX_AI_AUTH_TYPE` must be `iam`.

The request is POST `{ORCHESTRATE_API_URL}/v1/orchestrate/{ORCHESTRATE_AGENT_ID}/chat/completions`.
The existing server-side `WATSONX_AI_APIKEY` is exchanged at the official IBM Cloud
IAM endpoint. It may be reused only if it has permission for this Orchestrate
resource. A prior successful watsonx.ai call or IAM token exchange does not prove
that permission. No embed RSA key or client JWT is involved. Tokens and HMAC
receipts used by this probe remain in Function memory and are not returned. The separate
fixed-prompt website route returns signed, readable receipts containing operational
visit/thread IDs: they are not encrypted or entirely server-only. IAM credentials
and bearer tokens are never included in those receipts.

EU-DE compatibility: the exact approved API hosts are
`api.dl.watson-orchestrate.ibm.com`,
`api.us-south.watson-orchestrate.cloud.ibm.com` and
`api.eu-de.watson-orchestrate.cloud.ibm.com`. Target admission and probe error
classification use the same strict URL validator: canonical HTTPS only, no user
credentials, explicit ports, queries, fragments or encoded paths, and exactly
`/instances/{instanceId}`. No wildcard region or browser/embed host is accepted.
Use the actual service URL from IBM API details; synthetic tenant strings in tests
are never deployed defaults. The operator has identified EU-DE and Live Agent
Endo ID `c6698d4e-a08d-4b77-bf05-139ff3b4c695` as the intended current target.
These are configuration inputs, not proof of runtime injection or IAM permission.
Regional compatibility does not enable any route, authorize inference, change IAM
authentication, or require embedded-chat RSA/JWT settings.

Official references reviewed 7 November 2026; endpoint contract rechecked 8 November 2026:

- https://developer.watson-orchestrate.ibm.com/apis/orchestrate-agent/chat-with-agents
- https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=api-getting-started
- https://developer.ibm.com/tutorials/develop-voice-assistant-watsonx-orchestrate/
- https://github.com/IBM/ibm-watsonx-orchestrate-adk/blob/main/skills/wxo-builder/SKILL.md

The endpoint reference documents `/v1/orchestrate/{agent_id}/chat/completions`,
optional `X-IBM-THREAD-ID`, and response `thread_id`. The v1 path is the version;
no model API date or invented version query is added. Continuation is not sent as
an undocumented JSON `thread_id` property. The exact original fixed prompts and
strict completion parser remain unchanged. The IBM getting-started page returned
HTTP 403 during this recheck; no access restriction was bypassed.

These references establish documented API/IAM support, not tenant permissions or live
request/response conformance. AWS/on-prem authentication and direct-client JWT
authentication are distinct paths and are not substituted here. An ambiguous
provider response is rejected, never repaired or retried on another endpoint.

## Disabled-by-default gates

The Function is `/.netlify/functions/orchestrateProbe`; no public `/api` redirect
or frontend entry is added. It requires the platform's unpublished deploy-preview
context and exact Preview #4 origin. Existing ORCHESTRATE_EMBED_PREVIEW_ID=4,
ORCHESTRATE_EMBED_PREVIEW_ORIGIN and ORCHESTRATE_EMBED_OPERATOR_IDS are reused only
as preview/operator pins. A browser header/body cannot supply operator identity.
The trusted `context.user` must be allowlisted and unexpired. The public site and
other previews are rejected even when the probe opt-in is present.

Restricted-mode future preview-only settings (do not set during implementation).
The separate risk-exception mode below overrides TOOLS and USAGE to false:

| Setting | Disabled/preparation | Authorized test only |
| --- | --- | --- |
| ORCHESTRATE_PROBE_ENABLED | false or absent | true |
| ORCHESTRATE_PROBE_KILL_SWITCH | true or absent | false |
| ORCHESTRATE_PROBE_TEST_UNTIL | blank | UTC timestamp, future and at most 30 minutes ahead |
| ORCHESTRATE_PROBE_TOOLS_VERIFIED | false | true after evidence-backed approved-operation and alternate-path review |
| ORCHESTRATE_PROBE_PRIVACY_VERIFIED | false | true after nonclinical retention/logging review |
| ORCHESTRATE_PROBE_USAGE_VERIFIED | false | true only for independently verified bounded usage; false under the exception below |
| ORCHESTRATE_PROBE_QUOTA_VERIFIED | false | true after hosted atomic-store enforcement verification |
| ORCHESTRATE_EMBED_PREVIEW_ENABLED | false | false |
| ORCHESTRATE_EMBED_KILL_SWITCH | true | true |
| OTEL_SDK_DISABLED | true | true |

All are Functions-scoped Deploy Preview settings, never Production. Acknowledgement
flags do not perform the corresponding verification. Service-principal tools and
collaborators can differ from embedded-user permissions: review the actual IAM
principal, reachable tools/agents and possible side effects. A model instruction
to avoid tools is not a permission boundary. Existing legacy flags are not changed.
Private projections configure reused target/admission helpers only inside this
authorized probe; they cannot authorize the legacy anonymous route.

## Quota, context and deadline behavior

Reuses orchestrateTransport, the watsonShadow IAM broker, demoAdmission/demoQuota,
threadOwner and visitReceipt. Operational tickets live only in the separate fixed
`EndoOrchestrateProbeQuota` store. A server-derived daily visit competes for one
immutable ordinal-zero reservation before any IAM call. Concurrent operators and
deployments cannot create extra first-turn permission. The daily policy is fixed
at two agent-call reservations; ordinal one permits only the second turn. Failures
and cancellation burn capacity. There is no reset, refund, delete or automatic
retry; a failed first turn can block another attempt that UTC day. Storage failure
fails closed. Never remove records to obtain another live attempt.

Thread ownership uses a separate random server-only visit and existing HMAC
receipts. Nothing but operational UUIDs/tickets is stored by Endo. The first reply
must be the exact requested acknowledgement. Turn two sends only the approved
second question and the same returned thread ID in `X-IBM-THREAD-ID`; it does not replay the name,
first prompt or first response. The same IAM broker is reused. A correct answer
plus unchanged thread is evidence of continuity; a mocked answer is not live proof.

Each provider operation reuses the configured WATSONX_AI_TIMEOUT_MS, 100–12000 ms,
including its quota admission and IAM/model work. The whole Function reserves one
second from a 28-second request budget; client disconnect propagates cancellation.
The provider parser keeps the existing 32 KiB response limit and exact one-choice,
complete assistant response validation. There are zero application retries and no
fallback host, agent, model, Draft environment or watsonx.ai generation path.

Two admitted requests are not a monetary spending ceiling. An agent may perform
additional model/tool work internally. Restricted mode requires an enforceable bounded IBM-side
allowance and effective tool restrictions. Exception mode instead requires the
explicit approval and independent binding review documented below. A remote run
may continue after client transport cancellation; do not claim remote cancellation
or refund. IBM-side history/retention is separate from Endo's lack of transcript
storage.

## Invocation after separate deployment and live-test approval

No live inference is authorized by this document. Once hosted prerequisites and
the explicit test window are approved, the authenticated operator on protected
Preview #4 may execute:

```javascript
fetch('/.netlify/functions/orchestrateProbe', {
  method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({action: 'probe'})
}).then(response => response.json()).then(report => console.log(report));
```

Only this literal request grammar is accepted (64-byte bound). No caller message,
case object, thread, receipt, filename or token can be supplied. It sends only the
existing two approved `connectionProbe` messages from shared/orchestratePrompts.json.
The response contains version, status, authentication/turn/continuity outcomes and
a fixed reason code. It never includes provider prose, secrets, IDs, HTTP statuses,
service URLs or exception text. It performs no application logging. Do not export
HARs or browser cookies. After testing, close the probe kill switch through the
approved operator process; Production and the embed remain disabled.

Reasons distinguish incorrectEndpoint (locally invalid endpoint), configuration,
authenticationFailure (IAM or bearer rejection), authorizationFailure (agent access
denied), endpointOrAgentUnavailable (ambiguous provider 404), quotaRejected,
quotaUnavailable, networkFailure, timeout, providerUnavailable, providerResponse,
continuityFailure and internal. A 404 cannot safely distinguish a missing tenant
route from a missing agent without additional authoritative tenant evidence. Do
not guess from provider error-message text. A failure is not proof a new key is
needed. Diagnostic success proves neither clinical safety nor tool/retention policy.

## Phase 2 gate

Only after a successful real hosted probe, integrate the existing OrchestrateChat
component in the existing panel. Natural clinician text requires separate approved
privacy/retention boundaries and deterministic conflict/emergency interception;
the existing fixed-prompt route does not authorize arbitrary free text. Conversation
must never silently update canonical data, initiate reanalysis, or represent model
knowledge as one of the 78 reviewed Endo claims. No Phase 2 change is included here.

## Controlled Live-agent access policy (current local candidate)

The target is the existing EU-DE Live Agent Endo v2.0.0, UUID
`c6698d4e-a08d-4b77-bf05-139ff3b4c695`. No clone, agent instruction, tool schema,
or production endpoint change is part of this candidate. The obsolete embedded
agent identifiers are not API defaults. Only the exact existing instance URL
from IBM API details may be supplied; no instance ID is generated here.

The previous blanket denial policy is replaced by an approved-operations inventory:

| Live tool name | Operation | Destination | Published authentication |
| --- | --- | --- | --- |
| list_available_clinical_modules | listModules / GET | https://clinicalagent.netlify.app/api/v1/modules | none declared |
| submit_a_de_identified_clinical_case_for_evidence_grounded_review | analyzeCase / POST | https://clinicalagent.netlify.app/api/v1/analyze | none declared |

The repository OpenAPI declares `security: []` for both operations. This does not
prove the effective IBM connection credential mode, imported Live schema, runtime
permissions or full reachable action graph. GET lists public module metadata.
POST performs clinical processing; its optional server-side presentation path can
make additional IBM calls when separately enabled. The reviewed Endo analysis
handler does not persist the case or update canonical case data, but that does not
prove provider-side retention or platform logging settings. Actual IBM connection
credentials, effective destinations (including redirects), and logging require
administrator verification. No API POST was performed in
this task. The probe request accepts no clinical case data. Under the exception below, IBM could nevertheless construct and submit invented synthetic case data through the preserved analysis tool; that risk is not technically prevented.

### Code-enforced admission versus IBM enforcement

`ORCHESTRATE_PROBE_ACCESS_REVIEW` is a server-only JSON review record, blank by
default. It is checked after target/operator/request validation and before any
credential access, quota reservation or IAM request, and rechecked at provider
boundaries. The ordinary restricted mode requires TOOLS/PRIVACY/USAGE/QUOTA acknowledgements. The separate exception mode requires TOOLS and USAGE to remain false; PRIVACY and QUOTA still require supporting evidence.
Missing, malformed, expired or incompatible records return only
`livePolicyRequired`; flags alone cannot admit a request. The record is never
accepted from the browser or returned in the report.

The exact record fields are:

- version: `1`; agentId: the UUID above; agentVersion: `2.0.0`; environment: `live`.
- apiUrl: exact configured, authorized EU-DE instance URL, including /instances/.
- operations: exactly the two records above, with keys tool, operationId, method,
  url and authentication (`none`). No credential headers or extra properties.
- collaborators, delegatedAgents, workflows, otherActionPaths: empty arrays only.
  Any discovered alternate path requires separate review, not silent omission.
- evidence: keys reference (a nonsecret review ID, not a URL or credential),
  reviewedAt and validUntil (UTC dates, reviewed in the past, valid now and no
  more than 24 hours apart), scope (`effectiveRuntimePermissions` in restricted mode), caseSubmission
  (`blockedForConnectionProbe`), downstreamInference (`blockedForConnectionProbe`).

This record is an operator attestation tied to an inventory; it is NOT an IBM
authorization policy, cryptographic proof of an IBM export, or a runtime tool-call
interceptor. Do not populate it or set TOOLS_VERIFIED based on an assertion alone.
The offline tests prove rejection of incompatible inventory at Endo admission,
not enforcement inside IBM. The current Chat Completions transport does not send
a documented per-request tool restriction. A final text-only response cannot
prove that no tool was invoked earlier.

Before approval, an IBM administrator must inspect the exact Live version and
service identity; all tools, toolkits, collaborators, delegated agents, workflows,
connection credentials/scopes, and indirect/external action paths; and the actual
OpenAPI servers/methods/security and nested actions. Retain dated, nonsecret
configuration/permission evidence outside the clinical application. Establish
effective restrictions preventing unapproved actions, case submission during
this nonclinical probe, and additional downstream inference. Instructions to the
model are not that restriction. If the tenant cannot enforce these boundaries
without changing the preserved agent/tools or production API, stop: the probe
remains disabled unless the narrowly scoped exception below is independently reviewed and explicitly approved.

### Restricted-mode approval boundary (exception documented below)

No effective IBM runtime-access export was available during local preparation.
The access-review setting remains blank, every example verification flag remains
false, and hosted settings were not changed. There is no current activation GO.
Recorded 30-day retention and a prior one-attempt Trial risk acceptance do not
authorize another attempt or prove a spending cap.

After independent review and separate execution/deployment authorization only:
verify protected Preview #4 and trusted unexpired operator access; verify the
exact deployed target/record; inspect unused tickets without resetting them;
obtain one-attempt usage approval; set only the preview-scoped controls for a
fresh window of at most 30 minutes; run the existing single fixed POST once
(the Function performs both turns); close the window and engage the kill switch
immediately afterward and verify shutdown. Keep public conversation, embedded
chat and production inference disabled. Reuse the existing documented console
procedure; no new endpoint or message contract is introduced.


## Live v2.0.0 update and one-test exception (not activated)

The operator confirms Live v2.0.0 at the same UUID displays both expected
clinical tools and no collaborators. No repeat screenshots are requested. All
v1.0.0 inventory/permission evidence remains historical. Actual v2.0.0 methods,
destinations, authentication, connection bindings and indirect executable paths
remain independently unverified; the visible inventory does not establish them. Unknown destinations or additional operations
remain blockers. The API targets UUID + live; the review's agentVersion is
expected deployment metadata, not an IBM request-level version pin. Reconfirm
that Live still matches the reviewed version immediately before activation.

The default-disabled `ORCHESTRATE_PROBE_EXCEPTION_ENABLED=false` path requires a
separate server-held `ORCHESTRATE_PROBE_EXCEPTION_APPROVAL` record. It is not a
technical tool denial or a spending cap. In exception mode, the access review
above must instead use evidence.scope `independentlyReviewedLiveBindings`, with
caseSubmission and downstreamInference both `possibleUnderException`. All other
inventory, freshness and target requirements remain unchanged. The operator must
have independently reviewed those bindings; agent self-description is insufficient.

Exact exception approval fields (no extra fields): version `1`, reference (safe
nonsecret approval reference), test `blueLanternTwoTurn`, agentId (unchanged UUID),
agentVersion `2.0.0`, apiUrl (existing configured instance), previewId `4`,
previewOrigin `https://deploy-preview-4--clinicalagent.netlify.app`, operatorId
(the existing trusted allowlisted identity; never publish it), reviewHash (SHA-256
of the exact UTF-8 ACCESS_REVIEW string), approvedAt and expiresAt (UTC),
maxAgentCalls `2`, maxAttempts `1`, automaticRetries `0`, noRealPatientData `true`,
and acceptedRisks containing exactly these six codes:

- unexpectedApprovedToolInvocation
- inventedSyntheticCaseSubmission
- downstreamProcessingAndPresentation
- providerRetention
- internalUsageAndBillingNotHardCapped
- remoteWorkMayContinueAfterCancellation

Approval must already be issued, remain unexpired, last at most 30 minutes, and
expire exactly at TEST_UNTIL. It must not cross UTC midnight: the unchanged
ordinal-zero daily ticket prevents a second attempt during that day. This adds
no substitute tickets, quota reset, retry or refund. The record is an approval
reference checked by Endo, not proof obtained from IBM.

### Exact acceptance text for separate operator approval

I authorize one fixed, synthetic-only, two-turn Blue Lantern attempt against
Live Agent Endo v2.0.0, UUID c6698d4e-a08d-4b77-bf05-139ff3b4c695, on protected
Preview #4 by the reviewed authenticated operator. I accept unexpected invocation
of either independently reviewed approved clinical tool, invented synthetic case
submission, downstream processing including optional IBM presentation inference,
provider retention, internal model/tool usage and costs without a hard cap, and
remote work continuing after cancellation. This is risk acceptance, not proof of
technical prevention or a spending limit. Unknown destinations and extra actions
are not accepted. Maximum two application-reserved agent calls, one invocation,
zero retries, no patient information, at most 30 minutes, immediate shutdown.

### Activation and shutdown after separate approval only

1. Deploy this reviewed local candidate only after separate commit/push approval.
   Confirm protected unpublished Preview #4, intended commit, trusted unexpired
   operator, and unchanged EU-DE instance/UUID. Verify unused existing daily
   tickets through approved read-only evidence; do not reserve or reset them.
2. Obtain the fresh independent v2.0.0 binding review and written exception
   approval. Store the exact records only in Deploy Preview / Functions scope.
   Set ACCESS_REVIEW and EXCEPTION_APPROVAL to those validated records.
3. Set ORCHESTRATE_PROBE_EXCEPTION_ENABLED=true, ORCHESTRATE_PROBE_ENABLED=true,
   ORCHESTRATE_PROBE_KILL_SWITCH=false, and ORCHESTRATE_PROBE_TEST_UNTIL to approval.expiresAt. Keep ORCHESTRATE_PROBE_TOOLS_VERIFIED=false
   and ORCHESTRATE_PROBE_USAGE_VERIFIED=false. Set ORCHESTRATE_PROBE_PRIVACY_VERIFIED and
   ORCHESTRATE_PROBE_QUOTA_VERIFIED only with their actual supporting evidence. Keep embed false /
   kill true, telemetry disabled, all public/legacy conversation inference disabled.
   No credentials or production settings change. Rebuild protected Preview #4
   if required for Functions configuration to take effect.
4. Authorized GET returns 400 / inputRejected after preview/operator checks
   (GET is not the probe grammar); disabled GET returns 404 / disabled. GET does
   not reserve quota or exchange IAM credentials. Stop on failed controls.
5. Execute the existing console POST above exactly once. It performs both fixed
   turns, continuing only with the returned thread via X-IBM-THREAD-ID; the first
   message is not replayed. Record only the sanitized outcomes. Do not retry.
6. Immediately set ORCHESTRATE_PROBE_ENABLED=false,
   ORCHESTRATE_PROBE_KILL_SWITCH=true, ORCHESTRATE_PROBE_TEST_UNTIL blank,
   ORCHESTRATE_PROBE_EXCEPTION_ENABLED=false and ORCHESTRATE_PROBE_EXCEPTION_APPROVAL blank.
   Rebuild when required and verify authenticated GET returns 404 / disabled.
   Leave tools, quotas, credentials, production and the website unchanged.

Current result: BLOCKED. No independent v2.0.0 Live binding review or new explicit
exception acceptance has been obtained. No hosted setting, quota or IBM request
was changed by this local preparation. Prior IAM success is not an end-to-end
conversation result; this fixed probe cannot prove clinical-tool correctness.


### Response rejection diagnostics (offline preparation)
The protected probe retains `providerResponse` and may add `providerHttp`
(`success` or `failure`) and a fixed `responseRejection` code. Codes distinguish
HTTP rejection, content type, unavailable/read-failed/oversized body, invalid
UTF-8/JSON, invalid shape, unexpected or missing fields, thread ID, metadata,
choice cardinality/index, incompatible message content, finish reason, usage,
and changed continuation thread. No field names, values, identifiers, exception
causes, transcripts, or provider bodies are retained or logged. These additions
occur only after the existing operator, activation, privacy and quota gates.
Timeout classification remains authoritative when cancellation occurs.

IBM's public [Chat With Agents schema](https://developer.watson-orchestrate.ibm.com/apis/orchestrate-agent/chat-with-agents)
documents required id, object, created, model, choices and thread_id fields;
choices are objects without documented inner properties on that page. Endo
currently requires only choices and thread_id at the envelope level, but adds
closed field sets, a literal chat.completion object, one choice at index zero,
assistant/string-only content, stop-only finish reason, UUID-version checks,
bounded text/body sizes and exact usage fields/arithmetic. Those are local
restrictions, not all requirements established by that schema. Optional envelope
metadata remains optional for backward compatibility. No acceptance rule is
changed here; generic schema examples with empty choice objects remain rejected.
Offline fixtures are synthetic, not evidence of actual hosted response structure.
The failed attempt's exact rejection cannot be recovered from its generic code.
Any future live verification requires separate authorization and unused tickets;
never retry or reset the consumed attempt to obtain these new diagnostics.


### Narrow documented compatibility correction
IBM documents response `object` as a string, not an enum. Accept bounded,
nonempty control-free object metadata (maximum 200 characters), without using it
for authorization, response text, thread ownership or tool dispatch. The old
literal chat.completion requirement rejected other schema-permitted strings.
Synthetic alternative strings in tests are compatibility examples, not observed
IBM values. This does not establish the cause of the first failed attempt.
All other parser checks, including message, finish reason, extra fields, usage,
size bounds and continuation ownership, remain unchanged. The public choices
schema is too underspecified to justify relaxing these checks speculatively.
The preceding diagnostic-only section describes the earlier deployed behavior.

### Next separately authorized attempt: managed settings, manual rebuilds
No attempt or activation is authorized by this preparation. Before activation,
read today's existing daily AND deterministic visit tickets without writes. A
burned visit cannot be reused even if a daily slot remains. Require fresh explicit
one-attempt authorization and current trusted operator/allowlist verification.
Generate version-2 review and approval from the existing validated templates,
using the same exact UTF-8 review string for SHA-256 and hosted configuration;
use a fresh same-UTC-day expiry at most 30 minutes away. Preserve the disclosed
unverified Live bindings and indirect actions; TOOLS_VERIFIED and USAGE_VERIFIED
stay false. Do not manufacture technical verification from risk acceptance.

The assistant manages the allowlisted Deploy Preview settings through the existing
Netlify login, preserving scopes and all Production/all-context values. Use
setEnvVarValue with a structured body for blank values; bare env:set with no
value does not reliably clear an existing value. Never dump returned records.
Arm cleanup before activation. Operator manually rebuilds Preview #4, confirms
trusted authenticated GET 400/inputRejected and unexpired approval. If build
finishes too late, abort and clean up; do not execute or silently extend approval.
Execute the existing fixed POST once only after all gates and fresh quota pass.
On result, failure, timeout or operator cancellation, immediately set preview
probe/exception false, kill switch true, expiry/approval blank, and read back.
Never restore earlier enabled values. Operator must manually rebuild again and
confirm authenticated GET 404/disabled on the serving deployment. Configuration
cleanup alone is not runtime shutdown verification. Runtime expiry remains the
backstop if local cleanup is interrupted; report incomplete cleanup explicitly.
No automatic retry, quota reset, public activation or IBM metadata call is allowed.


### Test #2 extra-field compatibility preparation (not live verified)
Test #2 reported IAM PASS, provider HTTP success and unexpectedFields; the exact
property and failing envelope/choice/message level were not retained. This does
not prove the payload was harmless, nor does it prove a clinical tool ran.
IBM's public Chat With Agents page lists envelope fields and leaves choices as
objects without documenting choice/message children or a closed property list.
That page does not establish the actual extra fields returned by our tenant.
Do not import another IBM product's schema as proof of Orchestrate behavior.

The narrow local compatibility policy now permits only these ignored extras:
- envelope: system_fingerprint, service_tier, model_version as null or nonempty,
  control-free strings of at most 256 characters;
- choice: logprobs only when null (no probability/token payload accepted);
- message: refusal only when null (no refusal text treated as an answer).
These are defensive compatibility allowances for inert completion metadata, not
claims that IBM documents or emits these fields. All other extra properties and
nested payloads remain rejected, including tool_calls and function_call even
when empty or null. No arbitrary metadata map, action dispatcher or browser
output is introduced. Extras are discarded: return only validated text/thread.
Required fields, role, content type/size, stop completion, UUID/continuation,
usage validation, duplicate-key rejection and 32 KiB body bound stay unchanged.

A third live attempt can only test this compatibility hypothesis, not establish
that Test #2's unknown property was one of these fields. Require separate approval,
an authorized deployed patch, fresh read-only daily/visit capacity and current
operator gate; never retry or reuse Test #2's consumed visit. Preserve the full
version-2 residual-risk/privacy exception and mandatory shutdown/rebuild process.


### Provider parsing versus clinical authorization (current local refactor)
This section supersedes the prior closed-field and fixed metadata allowlists.
parseOrchestrateResponse is a pure protocol normalizer. The bounded reader still
requires JSON, strict duplicate-free parsing, valid UTF-8, a 32 KiB body and the
existing abort/timeout behavior. The normalizer keeps required choice/message
structure, one assistant choice, stop completion, validated UUID, text bounds and
required nonnegative usage counts/arithmetic when usage is present. Returned
values remain only text and threadId. The transport still enforces exact thread
continuation, gate authorization, admission-before-IAM and zero retries.

Unfamiliar JSON metadata at any level is ignored rather than copied to output,
history, logs, browser receipts or instructions. Nested metadata is scanned with
bounded depth/node counts for explicit tool/function/action/workflow/delegation
signals. These responses are rejected even for null or empty action fields.
There is no response-driven executor, fallback URL, dynamic tool lookup or eval.
This cannot prevent or prove absence of tool execution already inside IBM.
Known metadata does not acquire clinical authority from names such as validated,
claim, citations or evidence. Unknown metadata is not a source of answer text.

Documented extraction is choices[0].message.content as string: IBM's public Chat
With Agents response page leaves choice internals unspecified, while IBM's ADK
builder reference identifies that path. The normalizer additionally supports an
explicit local text-only adapter: content arrays of up to 32 objects with
{type: 'text', text: string}, concatenated exactly in order without invented
separators. This is not proof that the EU-DE cloud endpoint emits those blocks.
No runs/result/delta/SSE, image, audio, form, generic object/stringification or
arbitrary JSON response dialect is guessed. JSON-encoded text remains text; it
is never applied as a case, renderedText, tool command or clinical result.

Non-null refusal text, refusal blocks and content_filter finish reason produce
fixed providerRefusal failure with no provider prose. They do not trigger retries,
fallback calls or a fabricated response. Clarification questions are ordinary
unverified assistant text, not detected by punctuation or granted evidence status.

Clinical checks stay outside protocol normalization. The current protected probe
compares exact fixed acknowledgements and never displays provider transcripts.
The disabled public controller still screens approved synthetic context using
existing deterministic analysis and validates text with validateDiscussion before
display, labelled AI discussion, not verified evidence. That screen is NOT a
semantic grounding guarantee. The separate evidence-agent service's existing
GroundingVerifier defaults to deny; this refactor neither connects nor bypasses
it. A parsed response alone never authorizes clinical display or case mutation.
All production/activation behavior and protected clinical files remain unchanged.
No hosted test or automatic relaxation based on a failed response is authorized.


### Final offline validation environment
Use a fresh writable pytest --basetemp directory: the default Windows
AppData/Local/Temp/pytest-of-rob44 directory returned WinError 5. No test or
security assertion was disabled to resolve that fixture-setup problem.
The documented source-only checks use MODULE_ROOT=backend/releaseModules.
That inactive registry is not a substitute for the full historical suite's
private evidence prerequisites. With MODULE_ROOT cleared, the full suite stops
at conftest import with RegistryConfigError on both this candidate and unchanged
pre-patch commit c0c15650e9ce02315936ef11ef501e4787fcd82d.
Both snapshots lack the same six required knowledge assets: the Module 1 and
Module 2 knowledge DOCX files, Module 2 maternal candidate policy, ACOG ectopic
PDF and CDC warning HTML/PDF files. No replacements were generated, no package
validation was bypassed and no clinical schema or review requirement was changed.
The full historical suite therefore remains blocked by installation prerequisites;
source-only checks and the separately reported frontend/Function checks are the
applicable validation for this nonclinical response-adapter patch.
