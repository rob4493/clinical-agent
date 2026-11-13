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
receipts remain server-side. There is no browser session token or thread ID.

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

Required future preview-only settings (do not set during implementation):

| Setting | Disabled/preparation | Authorized test only |
| --- | --- | --- |
| ORCHESTRATE_PROBE_ENABLED | false or absent | true |
| ORCHESTRATE_PROBE_KILL_SWITCH | true or absent | false |
| ORCHESTRATE_PROBE_TEST_UNTIL | blank | UTC timestamp, future and at most 30 minutes ahead |
| ORCHESTRATE_PROBE_TOOLS_VERIFIED | false | true after effective service-principal denial review |
| ORCHESTRATE_PROBE_PRIVACY_VERIFIED | false | true after nonclinical retention/logging review |
| ORCHESTRATE_PROBE_USAGE_VERIFIED | false | true after a bounded IBM-side test allowance |
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
additional model/tool work internally. Confirm an enforceable bounded IBM-side
allowance and effective tool restrictions before enabling this test. A remote run
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
