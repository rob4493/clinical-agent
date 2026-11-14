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
