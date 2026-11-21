# Production migration and anonymous evaluation admission

Status: implemented offline, default-disabled. No public activation is established
by successful mocks, a review flag or a deployment. Preview #4 remains independent.

## Visitor workflow

When a separately verified production release is enabled, open
https://clinicalagent.netlify.app, type a fictional/de-identified educational
question, and select Send to Endo. No account, access code or operator allowlist is
required. Continue with follow-up questions; New conversation explicitly clears
browser-memory history. Structured Evidence Review remains a separate form and
never automatically shares case fields or uploads. Sources & further reading
contains registry-verified official URLs, related reading rather than validation
of each AI statement. Emergency inputs are screened before IAM/agent access and
halt discussion with the same existing warning explanation as Preview #4.

The current UI, transport/parser, safety projection, output screen, verified reading
and immutable receipt/thread behavior are reused. Public clinical-language cautions
use the admitted evaluation-only warning policy, while prescribing/dosing, secrets,
executable content and provider actions remain hard blocks. IBM Bob is a development
assistant; IBM watsonx Orchestrate hosts the existing runtime Agent Endo. No other
agent or altered toolset is introduced. This is not approved for patient care.

## Trusted admission and bounds

The exact Production origin/path and Netlify runtime deploy identity are mandatory.
The SDK context.ip supplies the network identity; browser identity/forwarded-IP
headers are never authority. An anonymous start generates an unguessable UUID and
signed __Host-endo-demo cookie, Secure/HttpOnly/SameSite=Strict, lasting at most one
hour and bound to an HMAC of runtime IP. Conversation receipts use AES-GCM, bind the
visitor/window/thread/history digest, and expire no later than the cookie. Raw IPs,
transcripts and provider credentials are never written to quota storage or logs.

Production uses EndoPublicConversationV2, preserving V1 and historical preview
records. Defaults proposed for review, NOT a statement of IBM allowance:
50 site calls / 20 sessions per UTC day, 12 calls / 3 sessions per visitor cookie,
20 calls / 8 sessions per network per UTC day. All are configurable within bounded
code maxima and frozen independently on first use that day. Site, visitor and
network reservations use atomic onlyIfNew writes with strong readback. Failed
partial admission burns capacity, never refunds or retries. A reset/new cookie
cannot bypass network or site limits. Rotating IPs can evade network limits but
not the site cap; shared-IP judges share network capacity. IP changes invalidate
cookies, requiring a new explicit conversation. Cookies are not person identity.

The function exports a 12 requests/60 seconds IP/domain platform rule with the
explicit path. Its configuration is not evidence of observed hosted enforcement.
Netlify documents this aggregation for all customers, while domain-only rate
aggregation requires Enterprise/high-performance edge. Immutable site caps therefore
remain required. See https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
and https://docs.netlify.com/build/functions/api/ .

## Activation prerequisites and configuration

Default-disabled flags: ENDO_CHAT_ENABLED=false, ENDO_CHAT_KILL_SWITCH=true.
An administrator must independently verify effective operations, connections,
destinations, indirect actions and IBM service allowance for the EXISTING two-tool
Live agent before setting ENDO_CHAT_TOOL_POLICY=approved-operations-enforced,
ENDO_CHAT_PROVIDER_ALLOWANCE=reviewed and ENDO_CHAT_REVIEW_REFERENCE to the reviewed
release reference. These server settings record a review, not technical evidence
of IBM-side enforcement. Local parser rejection cannot prevent remote actions.
No flag or browser input grants approval of unknown operations.

Production needs the existing EU-DE ORCHESTRATE_API_URL, unchanged agent UUID
c6698d4e-a08d-4b77-bf05-139ff3b4c695, ORCHESTRATE_ENVIRONMENT=live,
WATSONX_AI_AUTH_TYPE=iam and securely stored WATSONX_AI_APIKEY. Generate a separate
ENDO_CHAT_SESSION_SECRET through approved secret management; never commit it.
ENDO_CHAT_STARTED_AT / ENDO_CHAT_UNTIL bound a window of at most seven days, with
no automatic renewal. ENDO_CHAT_DAILY_CALL_LIMIT / DAILY_SESSION_LIMIT,
ENDO_CHAT_VISITOR_CALL_LIMIT / VISITOR_SESSION_LIMIT and
ENDO_CHAT_NETWORK_CALL_LIMIT / NETWORK_SESSION_LIMIT set limits (all prefixed
ENDO_CHAT_). Actual final limits require provider allowance evidence first.

Keep ORCHESTRATE_ENABLED=false, ENDO_DEMO_INFERENCE_ENABLED=false,
ENDO_DEMO_KILL_SWITCH=true and OTEL_SDK_DISABLED=true. Embedded chat and unrelated
verification functions remain disabled. Preview operator configuration is separate.
Use Production-scoped overrides only; do not overwrite global/preview credentials.

## Rollout and rollback

1. Resolve main/PR conflicts and verify clinical/evidence bindings and full tests.
2. Deploy reviewed code with public inference disabled; retain the last published
   Production deploy ID/commit and the protected Preview for comparison.
3. Complete IBM action-boundary/allowance review and valid credential verification.
4. Configure a bounded Production window/limits/secret using secure management;
   rebuild and confirm anonymous capability without consuming a reservation.
5. Bounded authorized live tests must demonstrate real responses, continuity,
   pre-provider emergency interruption, isolation and quota enforcement. Mocks alone
   do not establish public readiness or the clinical accuracy of generated answers.
6. On failure disable ENDO_CHAT_ENABLED, engage ENDO_CHAT_KILL_SWITCH, clear expiry
   and rebuild. Verify GET is blocked; restore the recorded prior deploy if needed.
   Never delete/reset tickets. A rebuild checkpoint is required for runtime cleanup.

Current external blockers: the authorized direct IAM exchange for read-only metadata
inspection returned non-success on 2026-11-20. No metadata/agent/tool calls followed
and no automatic retry occurred. Effective immutable Live bindings and provider
allowance remain unverified. Production activation/merge is not reported complete.

## Immediate operational stop without a rebuild

An immutable stop marker in EndoPublicConversationV2 is checked with strong reads
at admission and immediately before every IAM/agent HTTP request. Capability GET
reads this control but creates no cookie/reservation. Failure to read fails closed.
The key is stop/SHA256(JSON.stringify([Date.parse(ENDO_CHAT_STARTED_AT),
Date.parse(ENDO_CHAT_UNTIL)])); content is exactly {"stopped":true}. Use the already
linked site's authenticated Netlify CLI blobs:set with --input pointing to a local
file containing ONLY that fixed control JSON, then read it back with blobs:get.
Do not include keys/tokens on the command line or operate on quota ticket keys.
After marking the window stopped, also save ENABLED=false / KILL_SWITCH=true,
clear expiry and rebuild for persistent configuration cleanup. Never delete the
marker or tickets. Future explicitly reviewed windows get a new stop key; site
and per-network daily limits still cannot be reset. Remote work already accepted
by IBM can continue after cancellation/stop; this cannot revoke that remote work.

## Tool effects: repository evidence versus IBM deployment

The existing OpenAPI operations remain GET /api/v1/modules and POST
/api/v1/analyze at clinicalagent.netlify.app, declaring no caller authentication.
The repository analysis route validates bounded case input, runs deterministic
safety/evidence processing, and can use separately gated IBM presentation. It does
not implement EHR/patient-record writes. A POST method alone is not evidence of
an unsafe external state change. These facts do not verify the agent's immutable
Live bindings, connection credentials, permissions, delegated workflows or actual
IBM service allowance. Both attached tools and the existing agent remain intact.
An administrator's effective deployment/configuration evidence is still needed;
no agent self-description or local output screen is substituted for that evidence.
