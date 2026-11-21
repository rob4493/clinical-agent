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
The operator explicitly approved a narrowly scoped public synthetic judging policy
on 2026-11-21, accepting unresolved effective Live connections/indirect actions and
provider capacity/overage ceilings. For that approved existing-agent evaluation,
use ENDO_CHAT_TOOL_POLICY=existing-live-synthetic-evaluation together with
ENDO_CHAT_PROVIDER_ALLOWANCE=trial-synthetic-evaluation and a recorded
ENDO_CHAT_REVIEW_REFERENCE. These values record authorization and risk acceptance,
NOT verified provider permissions, remaining quota or an enforceable spending cap.
ENDO_CHAT_TRIAL_UNTIL must be no later than 2027-01-30T00:00:00.000Z, and the public
expiration must not exceed that conservative Trial cutoff.

This path enforces at most 50 site calls/20 sessions daily, 12 calls/3 sessions per
visitor cookie and 20 calls/8 sessions per network. All other safeguards are
unchanged. No additional IBM administrator approval was established as mandatory
for the stated functionality-evaluation purpose. General Trial terms still apply:
no commercial/operational use, no personal/regulated data, and no use past expiry.
Unknown Live actions/cost ceilings remain disclosed; known unapproved actions or
destinations are not authorized. Local output validation cannot undo remote work.

The original independently verified path remains available only with genuine
review evidence: approved-operations-enforced / reviewed. Do not set those values
for this synthetic-demo exception. Historical sign-off requirements below are
superseded for this specifically authorized evaluation, not asserted as IBM rules.

Production needs the existing EU-DE ORCHESTRATE_API_URL, unchanged agent UUID
c6698d4e-a08d-4b77-bf05-139ff3b4c695, ORCHESTRATE_ENVIRONMENT=live,
WATSONX_AI_AUTH_TYPE=iam and securely stored WATSONX_AI_APIKEY. Generate a separate
ENDO_CHAT_SESSION_SECRET through approved secret management; never commit it.
ENDO_CHAT_STARTED_AT / ENDO_CHAT_UNTIL support two UTC calendar months from actual
public activation, with no automatic renewal. ENDO_CHAT_DAILY_CALL_LIMIT / DAILY_SESSION_LIMIT,
ENDO_CHAT_VISITOR_CALL_LIMIT / VISITOR_SESSION_LIMIT and
ENDO_CHAT_NETWORK_CALL_LIMIT / NETWORK_SESSION_LIMIT set limits (all prefixed
ENDO_CHAT_). Evaluation limits follow the explicitly approved caps above; they are not IBM-side spending ceilings.

Keep ORCHESTRATE_ENABLED=false, ENDO_DEMO_INFERENCE_ENABLED=false,
ENDO_DEMO_KILL_SWITCH=true and OTEL_SDK_DISABLED=true. Embedded chat and unrelated
verification functions remain disabled. Preview operator configuration is separate.
Use Production-scoped overrides only; do not overwrite global/preview credentials.

## Rollout and rollback

1. Resolve main/PR conflicts and verify clinical/evidence bindings and full tests.
2. Deploy reviewed code with public inference disabled; retain the last published
   Production deploy ID/commit and the protected Preview for comparison.
3. Record either genuine independent verification or the explicitly approved synthetic judging authorization; runtime IAM is already verified.
4. Configure a bounded Production window/limits/secret using secure management;
   rebuild and confirm anonymous capability without consuming a reservation.
5. Bounded authorized live tests must demonstrate real responses, continuity,
   pre-provider emergency interruption, isolation and quota enforcement. Mocks alone
   do not establish public readiness or the clinical accuracy of generated answers.
6. On failure disable ENDO_CHAT_ENABLED, engage ENDO_CHAT_KILL_SWITCH, clear expiry
   and rebuild. Verify GET is blocked; restore the recorded prior deploy if needed.
   Never delete/reset tickets. A rebuild checkpoint is required for runtime cleanup.

Current external blockers: earlier external IAM tests submitted Secrets Controller
masked values and do not establish invalid runtime credentials. Production-runtime IAM passed on 2026-11-21 at 00:16:39 EST, according to the
operator-supplied hosted productionIamOnce log: status PASS, iamHttp 200,
errorCode null, runtimeConfigurationAccessed true. The one-shot diagnostic was
subsequently disabled and removed; no token or secret was retained.
Effective immutable Live bindings and full-period provider allowance remain
unverified. Public activation/merge is not reported complete.

## Two-calendar-month public evaluation commitment

Actual public activation date: **NOT ACTIVATED**.
Actual configured public expiration date: **NOT SET**.
Verified anonymous availability / live conversations: **NOT ESTABLISHED**.

Do not populate these records with build, preparation or diagnostic deployment
dates. At the actual public activation checkpoint, record the UTC ISO timestamp
in ENDO_CHAT_STARTED_AT and set ENDO_CHAT_UNTIL to exactly two UTC calendar months
later. Preserve time of day and clamp an unavailable month-end date to that
month's last day (December 31 -> February 28, or February 29 in a leap year).
The admission and quota services enforce the same calendar bound. Shorter
prelaunch verification windows remain possible but do not satisfy the public
commitment. No judge login or periodic authorization renewal is required.

Preparation/build time must not consume the promised period. If rebuilding delays
runtime availability, reconcile the timestamps at activation and verify a full
remaining two-month period before announcing launch. An interrupted or failed
activation is not a verified launch. Record actual activation/expiration and
hosting/provider dependencies here and in README when established.

One-hour visitor-cookie/receipt expiry remains unchanged; a judge may start a new
conversation without login. Session renewal, cookie clearing, deployment or
availability-window changes do not reset immutable site/network daily tickets.
UTC daily rollover renews only that day's fixed allowance, never unused tickets
or provider permissions. No automatic availability renewal follows expiration.

Before activation, verify the IBM service entitlement lasts THROUGH the configured
expiration and covers existing agent/tools, connections and downstream processing.
Choose sustainable site/network/visitor daily limits from that allowance and
record the evidence/reference; the proposed 50 calls/20 sessions are not yet an
approved two-month budget. Count every UTC date intersected by [start, until):
ceil(until/86400000)-floor(start/86400000). Two calendar months touch at most 63
UTC dates; at proposed defaults that is at most 3,150 application call reservations
and 1,260 sessions. This does not cap internal IBM/tool execution or downstream
charges, and does not establish entitlement or continuous availability.

The operational stop marker and environment kill switches remain available during
the full period. Provider outages, exhausted daily quotas and safety halts remain
visible limitations. Never claim uninterrupted access from offline tests alone.
The TEMPORARY Production IAM diagnostic is separate: its maximum authorization
window stays TEN MINUTES and its single-use record is never reset.

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

## Read-only administrator evidence checked 2026-11-21

The authenticated EU-DE IBM agent page for the unchanged UUID showed Live
Deployment Overview version 2.0.0, deployment 2026-11-14 13:41 EST, the two expected
clinical tool display names, Knowledge (0) and Agents (0). This is direct IBM UI
association evidence, not an agent self-description. It does not expose each
attached tool's effective HTTP operation, credential/connection override or
immutable deployed definition. Selecting a tool label exposed no binding detail.
Do not promote generic/Draft tool metadata or Agents (0) into exhaustive proof of
all indirect actions or permissions.

The existing service instance was Active in Frankfurt, named watsonx-Hackathon
Orchestrate, with Plan Trial. The Orchestrate trial popover showed 71 days left
and an end date of 2027-01-30. Trial duration could cover a two-calendar-month
activation now; actual activation must leave the full period within entitlement.
The account service page also showed Legacy two-factor authentication /
Authentication Failed and Internal Server Error. No authentication barrier was
bypassed. Detailed usage/remaining capacity and account-specific public-evaluation
terms could not be established through the available interface.

Official reference: IBM's Trial entitlement is time-limited and non-production;
this alone does not decide whether this synthetic public competition evaluation
is permitted or establish a request/token/resource-unit allowance. Applicable
account terms/IBM confirmation are required, rather than an automatic paid-plan
change. See:
https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=entitlements-licenses-watsonx-orchestrate-cloud
https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=cloud-managing-service-usage

Remaining administrator evidence, with secrets omitted:
- A deployed Live v2.0.0 release/configuration reference tying this agent to BOTH
  tool identifiers and their effective definitions/connections. Confirm only
  GET https://clinicalagent.netlify.app/api/v1/modules and
  POST https://clinicalagent.netlify.app/api/v1/analyze, their operation IDs,
  effective authentication (repository declaration: none), connection principal
  permissions, and any reachable workflows/callbacks/delegation/downstream model
  use. IBM Support confirmation is acceptable if the UI cannot expose this.
- This instance's current included/remaining request, token/resource-unit and
  tool/model allowances, reset periods, enforced limits, overage terms, and end
  timestamp. Confirm the account arrangement permits the two-month public
  synthetic competition demonstration. Use that evidence to choose sustainable
  daily limits before marking provider allowance reviewed.

A Trial end date is NOT spending-limit proof. Existing protected one-test risk
acceptance does not establish authorization or capacity for two months of public
traffic. No production verification flag was set to substitute for missing evidence.

Offline revalidation: 2,379 frontend/Function tests passed after the two-month
change, covering anonymous sessions, thread ownership/continuity, privacy,
emergency interruption, source handling and immutable quotas. Genuine public
provider/tool tests remain NOT TESTED. Historical private-package backend tests
require backend/competition/evidence/package.json and
backend/competition/module02Evidence/package.json plus their pinned sources; both
manifests are absent in the available checkouts. A representative emergency test
fails with Competition evidence is unavailable on unchanged published-main source
as well. No test or safety assertion was weakened and no private source invented.

Final local validation for this milestone: 2,379 frontend/Function tests passed;
314 documented source-only backend/security/release tests passed, 1 skipped;
TypeScript and production build passed; all 144 canonical integrity bindings and
442-file release inventory passed. The broader legacy/private-package run had
440 passed, 78 failed, 1 skipped; the representative missing-package failure was
reproduced against unchanged main. This is not an all-backend-tests-pass claim.
No clinical claims, warning policy, source bindings, UI or canonical schema were
changed. No IAM/agent/tool requests, quota writes, merges, deployments or hosted
activation occurred during this readiness review. Actual public dates remain unset.

## Existing Preview configuration carried forward

The operator confirms the successful protected Preview #4 Live agent and both
original tools are the intended unchanged Production baseline. No alternate
agent, tool removal, extra permission grant or replacement architecture is required.
A Live export is not the exclusive acceptable evidence: current IBM administrator
configuration plus trustworthy authenticated release metadata and bounded observed
operation traces may establish equivalent binding evidence. Generic/Draft catalog
records alone remain insufficient, and unknown connection permissions are not
relabeled verified by this baseline decision.

On 2026-11-21, direct checks of the existing public backend operations passed:
GET /api/v1/modules returned both modules; a fictional POST /api/v1/analyze returned
HTTP 200 / AgentResponse, no warnings and three source records; a fictional Module
2 emergency returned U1. Both POSTs returned X-Endo-Watson: skipped. Actual newline
separators were present in renderedText. These were backend checks, not IBM agent
or tool-invocation tests, and consumed no Orchestrate conversation reservations.

Repository review confirms module listing is read-only, while analyze validates
bounded clinical fields, privacy, reviewed evidence and emergency handling. It has
no EHR/patient-record writes or persistent case/transcript storage in this path.
POST means analysis processing here, not proof of an external write. Optional
presentation can contact IBM only under its independent WATSONX_ENABLED gate;
current Production management metadata reports false. Other optional follow-up
features also require this master gate. Preserve all existing tools and gates.

The remaining account-capacity decision must use this instance's existing Trial
entitlement, without an assumed subscription change. Public pricing and Trial
feature descriptions do not independently establish its remaining MAU/message,
model/tool usage allowances, enforced ceilings or overage rules. A read-only
account Plan/Usage statement or IBM account-support confirmation of those values
and the permitted public synthetic evaluation use is the smallest missing
provider evidence. Conservative application limits cannot be represented as
fitting an unknown provider limit or as capping internal/downstream processing.
Do not set ENDO_CHAT_PROVIDER_ALLOWANCE=reviewed until that comparison is possible.

## Reassessment: public judging evaluation versus operational production

Review date: 2026-11-21. A Netlify deployment context named production is a hosting
classification, not proof of real-patient, commercial or operational use. The
operator describes this release as a time-limited synthetic-only judging prototype.
This purpose must be assessed against the applicable evaluation terms, rather than
assuming that the site's public URL is prohibited.

### Explicit IBM requirements found in the reviewed general Trial documentation

IBM describes functionality/technology evaluation, a time-limited entitlement,
no commercial/production operational use and no personal/regulated data. The
observed instance-specific extended Trial ends 2027-01-30. The Trial has no SLA;
there is no verified continuous-availability guarantee. Applicable program-specific
rules were not independently supplied or established by generic hackathon pages.
No reviewed source establishes a separate IBM-administrator sign-off requirement
for every synthetic judging demonstration. No account-specific numerical capacity
or overage ceiling was established by these general sources.

Source: https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=entitlements-licenses-cloud

### Necessary technical controls retained

Server-only credentials; strict origin/deployment checks; IP-bound signed visitor
cookies and encrypted conversation receipts; one-hour sessions and replay locks;
privacy/input screening; synthetic-only request contract; emergency interception;
output/action/secret/prescribing defenses; bounded requests/timeouts; no automatic
retries; immutable visitor/network/site budgets; UTC daily limits; operational stop
marker and kill switches; expiration before the existing Trial ends. Known
unapproved actions/destinations must not be authorized by a policy exception.

### Additional project-process requirements

The literal gates ENDO_CHAT_TOOL_POLICY=approved-operations-enforced and
ENDO_CHAT_PROVIDER_ALLOWANCE=reviewed, and the requirement for independent exhaustive
Live-action/allowance sign-off before any public evaluation, were introduced in
this project's development process. They are not shown to be an IBM requirement
merely by existing in TypeScript or this document. They remain ACTIVE in code until
an explicitly approved amendment is implemented and validated. Do not falsify the
values to get past those existing gates.

### Approved synthetic judging amendment -- implementation record

For this existing synthetic judging prototype only, add a separate authorization
path recording the operator's actual authorization, without claiming verification:
- ENDO_CHAT_TOOL_POLICY=existing-live-synthetic-evaluation
- ENDO_CHAT_PROVIDER_ALLOWANCE=trial-synthetic-evaluation
- ENDO_CHAT_REVIEW_REFERENCE=a recorded operator-approved evaluation reference
- ENDO_CHAT_TRIAL_UNTIL=2027-01-30T00:00:00.000Z (conservative date cutoff)

Both authorization values must match together; mixing them with verified-policy
values must fail closed. Require the explicit enable flag/kill switch and all
existing safeguards. Limit this mode to at most 50 site calls/20 sessions per UTC
day, 12 calls/3 sessions per visitor cookie and 20 calls/8 sessions per network;
retain immutable records across renewed sessions, days and deployments. The public
window must start at actual activation, last two calendar months and end no later
than the Trial cutoff; no automatic renewal. Preserve the old independently
verified path for separately evidenced configurations. No agent/tool/permission
change or new framework is proposed.

Explicit operator decision APPROVED for this PROJECT policy amendment: authorize
the existing-agent public synthetic evaluation despite unresolved effective Live
connection/indirect-action details and provider capacity/overage ceilings. Application
budgets do not cap internal IBM model/tool executions or all downstream costs;
provider limits/outages may deny service. Output validation cannot undo remote
actions already taken. This is risk acceptance, not evidence of enforced provider
permissions, remaining allowance, contractual permission or a hard spending cap.

The first attempt to implement this amendment was rejected by automatic approval
review: it would persistently relax Production admission under unverified Live
permissions/allowance, with possible cost and downstream-action exposure, and the
current authorization was not judged sufficiently specific. No code/settings were
changed by that rejected operation. The operator subsequently explicitly approved this exact amendment. Admission
code and regression tests now implement it; deployment and bounded live checks
remain subject to validation. Public inference remains disabled until activation. No further IBM administrator approval is asserted as
a generic prerequisite by this reassessment.
