# Protected competition testing — local preparation, disabled by default

This mode reuses `orchestrateProbe`, the direct IAM transport and Live Agent Endo
v2.0.0 (`c6698d4e-a08d-4b77-bf05-139ff3b4c695`, EU-DE). It changes neither the
clinical UI nor the agent/tools. No IBM call or deployment was made to prepare it.

## Session workflow

After separate deployment approval and one explicit operator authorization for a
development window, Codex manages configuration using the existing Netlify login:

```powershell
pwsh -NoProfile -File tools/competitionPreview.ps1 -Action Activate -Authorized -AcceptResidualRisks -DurationMinutes 240 -DailyCalls 50 -DailySessions 20
```

The default remains 240 minutes; the maximum is 10,080 minutes (seven days).
After separate seven-day editable-chat authorization, use the same command with
`-EditableDiscussion -DurationMinutes 10080`. This sets a fixed absolute expiry,
never auto-renews it, and does not change the UTC daily 50-call/20-conversation
policy or reset tickets. The manual Disable command remains available at any time.
Trusted operator authentication must still be valid on each request. Conversation
receipts remain bounded by their original operator expiry: sign in again and start
New conversation if necessary, without reopening the environment-variable window.

The operator manually rebuilds **Preview #4 only**. Before any POST, require the
matching commit, SSO protection, and the authenticated probe GET returning
`400 / inputRejected`. This verifies trusted `context.user`, allowlist and future
Date expiry; SSO alone or a disabled GET does not establish that identity.
No readiness GET exchanges IAM credentials or reserves quota.

Each test must be deliberately initiated from that authenticated preview:

```javascript
fetch('/.netlify/functions/orchestrateProbe', {
  method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
  headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action:'probe'})
}).then(r => r.json()).then(report => console.log(report));
```

This performs only the two existing fixed nonclinical Blue Lantern turns, using
the returned server-owned thread on turn two without replaying the name. A fresh
request starts a separate conversation. Arbitrary typed messages, cases, uploads
and caller thread IDs remain rejected. This mode does not enable the public Send
button or live clinical conversations. It enables repeated connectivity testing,
not a replacement for privacy review of a future editable clinical route.

Failures can be followed by another explicitly initiated attempt while the
window, operator and quotas remain valid. There are no automatic retries or
per-attempt approval JSON/hashes, no daily deterministic visit lock and no
per-attempt 30-minute activation cycle. The shared platform burst rule is now
60 requests per 60 seconds; there is no application cooldown between attempts.
The existing transport timeouts, 27-second operation deadline and response bounds
remain. All reports are fixed outcomes/rejection codes, never transcripts/IDs.

When finished, Codex runs the one-command shutdown:

```powershell
pwsh -NoProfile -File tools/competitionPreview.ps1 -Action Disable
```

The operator manually rebuilds Preview #4 and confirms authenticated GET
`404 / disabled`. Shutdown disables both modes, engages the shared kill switch,
and clears competition timestamps and old exception/expiry values. It never
restores an earlier enabled state. `-Action Status` reads safe configuration
booleans only; `-WhatIf` validates arguments offline without any network calls.
The helper never invokes the probe, IAM, IBM, Blobs or Production deployments.

Session expiry is automatically enforced before each provider boundary, with a
maximum of seven days from the recorded start (including rebuild time). Expiry
does not itself erase Netlify values: Codex must run Disable when the session
ends or is cancelled. Management-variable changes, including the kill switch,
are deployment-bound; the manual rebuild is required for runtime confirmation.
A killed local process cannot guarantee configuration cleanup, so runtime expiry
remains a fail-closed backstop, not a claim that cleanup has completed.

## Configuration and authorization

Only these new Functions-scoped Deploy Preview keys are managed:

- `ORCHESTRATE_COMPETITION_ENABLED` — false by default.
- `ORCHESTRATE_COMPETITION_STARTED_AT` and `ORCHESTRATE_COMPETITION_UNTIL` — fresh
  absolute UTC timestamps, no more than seven days apart, never a sliding window.
- `ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT` — default 50, integer 1–1000.
- `ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT` — default 20, integer 1–200.

The existing emergency `ORCHESTRATE_PROBE_KILL_SWITCH`, exact Preview #4 origin
and pins, trusted operator allowlist, OTEL-off requirement, EU-DE target and IAM
credential are reused. Public and embedded inference must remain explicitly off.
Production/all-context values and existing variable scopes are preserved.
Legacy probe review/approval/privacy/tools/usage verification flags do not grant
competition permission and are not required in competition mode. The helper
leaves legacy probe and exception disabled; no old review JSON is generated.

One session authorization accepts the already documented prototype risks: actual
Live bindings/indirect actions remain unverified; IBM might unexpectedly invoke
an attached tool or invent synthetic fields; downstream processing, provider
retention, connection credentials and uncapped internal usage/cost may apply.
This is risk acceptance, not a claim of tool isolation or a financial spending
cap. Known unexpected/unapproved destinations or operations still require review.
The local parser rejects action-bearing outputs and has no tool executor; it
cannot intercept actions already performed inside IBM. The fixed prompts contain
no patient information, but downstream invented data/processing are not proven
absent. Both original tools remain configured and unchanged.

## Quota and failure accounting

Only `EndoOrchestrateCompetitionV1` is used. `EndoOrchestrateProbeQuota`, public
conversation stores and all historical tickets are untouched. Operational records:

- `policy/{UTC-day}` freezes that day's configured call/session limits.
- `session/{UTC-day}/{slot}` counts every admitted test attempt, including failure.
- `call/{UTC-day}/{slot}` counts reservations before IAM/provider invocation.
- `outcome/{session|call}/{UTC-day}/{random-reservation-id}` stores only passed/
  failed, a fixed reason and whether an agent HTTP request was initiated.
- `thread/{UUID}` retains the existing immutable server ownership binding.

There are no per-visit quota tickets, mutable counters, refund/reset paths or
record deletions. Conditional creation plus exact strong readback/ETag validation
enforce limits across Function workers. A partial failure may burn capacity; it
never grants extra permission. The adapter's existing no-retry fetch is reused.
Limits are configurable without code changes; changes apply on a new UTC day
after its policy is first frozen, so overlapping deploys cannot enlarge a live
day's cap. Changing/restarting a development window never resets daily counts.
Windows may span midnight; sessions count on their start day, calls on their
reservation day. New-day capacity is still established atomically, never assumed.

An IAM failure consumes a conservative call reservation, with `invoked:false`.
Provider/network/parser errors consume calls with fixed failure outcomes. Twenty
two-turn attempts use at most forty agent calls; the independent fifty-call cap
is a ceiling, not a promise to fit fifty calls into twenty two-turn sessions.
Call/session limits are application admission limits, not limits on internal
IBM model/tool operations or monetary spending.

If audit writes fail, reservations remain consumed, outcomes may be unknown, and
the report fails closed with `quotaUnavailable / accounting:incomplete`; never
retry automatically. Records without a final outcome must not be counted as
successful or refunded. Audit writes have a separate bounded 750 ms response
reserve and contain no operator IDs, messages, tokens or provider response bodies.
Storage latency or contention may reject early under the bounded storage deadline;
capacity is a ceiling, not a guarantee of admission availability.

The original clinical engines, evidence grounding/default denial, emergency rules,
78 claims, source bindings and canonical case schema remain unchanged. Parsing a
response does not make it clinical evidence; the probe never returns provider
text. Separate clinical route checks and unverified-discussion labels remain.

## Deployment boundary

Local validation does not authorize commit, push, deploy, configuration activation
or inference. After explicit deployment approval, update only the reviewed files
on draft PR #4 and verify its protected automatic preview build. No main merge or
Production deployment. Then request one session authorization before running
Activate. Codex manages variables; the operator handles each requested preview
rebuild. Never use the historical one-shot tickets to obtain extra competition
capacity or vice versa.


### Existing All-scope variables
Existing multi-scope/All-context variables are supported when Functions is one
of their scopes. The helper writes only Deploy Preview-specific value overrides
using setEnvVarValue. It never rewrites an existing variable's scopes, All/global
fallback, Production value or other non-preview context. It detects existing
keys and does not create duplicates. New keys, if absent, still use Functions
scope and a Deploy Preview value only.
Before/after checks compare effective Production configuration plus the original
variables' scopes and all non-preview values (including global fallbacks).
Disable also writes back the effective call/session limits as preview overrides,
without changing those limits or any quota records. This verifies update access
to all five competition keys while keeping the session disabled. Existing All
scopes are an accepted configuration, not an activation/deployment blocker.
Netlify may materialize an All value into the built-in dev/branch-deploy/
preview/production records when an override is added. Preservation checks compare
those equivalent non-preview values and unchanged scopes, not record IDs or the
All-versus-expanded storage format. Explicit custom-branch values remain checked.
