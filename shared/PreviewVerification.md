# Private Deploy Preview verification

Prepared on `codex/synthetic-ibm-activation`. The operator authorized a private GitHub
Deploy Preview targeting `main` on 6 November 2026. No additional login or credential
sharing is requested. The execution sandbox cannot write the Git index or resolve
GitHub through Git, so the authorized mutations are handed to the existing terminal.
No commit, push, deploy, settings write, hosted storage operation or IBM call has
been performed by Codex.
Use a standard GitHub pull-request Deploy Preview, not a CLI draft or branch deploy.
Production remains public and unchanged; the operator has confirmed the existing
Deploy Preview visibility is Private. Do not merge the PR or publish its deploy.

## Plan and boundaries

1. Add a separate default-closed Function, with platform user authentication and an
   operator allowlist, for isolated storage checks only.
2. Add unauthenticated access tests and an authenticated browser operator runner.
3. Run focused tests, TypeScript and the complete frontend suite. Preserve existing
   clinical code, provider settings and review seals.
4. After authorization, configure only Deploy Preview Functions gates, review and
   commit the intended branch changes, push that branch, then open a PR.
5. Verify platform protection first, authenticated route existence second, then
   run hosted storage tests. Keep IBM disabled throughout.

## Operator-only Function

`netlify/functions/verifyQuota.ts` requires trusted platform
`context.deploy.context === 'deploy-preview'`, `context.deploy.published === false`,
a bounded valid deployment ID and the exact request origin
`https://deploy-preview-4--clinicalagent.netlify.app`. Missing or malformed platform
metadata, Production and other previews fail closed. It does not read the build-only
`process.env.CONTEXT` or accept deployment identity from headers, queries or bodies.
All twelve existing inference-disabled setting checks remain mandatory, including
`QUOTA_VERIFICATION_ENABLED=true`, plus a nonexpired platform `context.user` whose
`id` appears in `QUOTA_VERIFICATION_OPERATOR_IDS` (comma-separated, no spaces).
It trusts no user header, body identity, browser-supplied permission or secret token.
Missing platform identity is a hard denial; do not replace this with basic password
protection or a client-provided user header. Netlify documents platform verification
of this context for private projects and team login protection.

Every IBM flag listed below must be explicitly closed. GET is a no-storage positive
control retaining `version: 1`, `status: operatorReady`, `ibm: disabled` and adding
only the fixed `initialization` classification below. POST start generates a random UUID internally,
constructs `EndoQuotaVerify` plus its 32 hex digits, and conditionally creates and
strongly reads a run marker. A collision fails; it never overwrites an old run.
POST reserve accepts only an existing run UUID and performs one limit-3 reservation.
The fixed prefix cannot select `EndoConversationQuota`. No storage name configuration,
arbitrary keys, clinical content, list, delete, reset, refunds or IBM callbacks exist.
The shared production quota adapter and namespace remain unchanged.

The browser runner starts a fresh store for each execution and issues 40 distinct
HTTP requests. Each request creates an independent SDK adapter. Counts distinguish
actual quota exhaustion from storage/authentication/network errors. Require exactly
3 admissions, 37 exhaustion results and zero errors. `observedWorkers > 1` is required
before claiming evidence across Function workers; a single-worker result is partial.
Worker IDs are random per process, not host/user/IP identifiers. No tickets are
deleted, even after a failed test. Test records contain only operational UUIDs,
timestamps and a fixed capacity. Old run IDs must never be reused for a new test.
The test is not an atomicity proof for all failures, a spending cap, or IBM validation.

## Initialization-only GET

After the same preview/operator/expiration and twelve safety checks, GET uses the
quota adapter's shared SDK-construction path with a network-denying transport.
It calls no storage methods, returns no store, and never reserves capacity or reads
IBM credentials. The local SDK import and constructor have a two-second inspection
deadline, composed with client cancellation. Authorization is checked again after
the asynchronous import. No runtime context payload is copied, decoded by our
diagnostic, returned or logged; only the pinned SDK consumes its automatic context.

The response keeps HTTP 200 for an authorized GET, with `initialization` set to:

- `sdkImportFailed`: local SDK import rejected, independent of exception wording.
- `automaticConfigurationUnavailable`: the pinned SDK's exact
  `MissingBlobsEnvironmentError` arose in the synchronous `getStore` phase.
- `adapterRejected`: the adapter's existing telemetry/name validation rejected input.
- `initializationReady`: the client was constructed without any transport attempt.
- `initializationUnknown`: cancellation, unexpected errors/exports, malformed client,
  or any attempted use of the denied transport. No inference from error messages.

`operatorReady` proves authorization only. `initializationReady` does not prove
storage permissions, strong-read endpoint availability, immutable writes, rate
limits or IBM access. Malformed runtime configuration that does not yield the
recognized SDK error stays unknown. Protected POST failures keep their existing
fixed-stage behavior; other operational adapter failures stay generic.

No hosted GET/POST or deployment is authorized merely by this document. Testing
uses synthetic automatic context and mocked transports only; no manual Netlify
credential injection is part of the initialization diagnostic.

The protected `action=start` failure response retains HTTP 503 and
`code: verificationFailed`, with only a fixed `stage` added after authorization:
`storeInitialization`, `initialWrite`, `metadataReadback` or `integrityVerification`.
The first is the adapter factory; the next two identify the failed operation;
the last means operations returned but the existing integrity comparison failed.
These labels do not distinguish SDK configuration, network, permission or service
errors within an operation. No exception text, token, endpoint, store/run identifier
or contents are returned or logged. Authorization and all inference-disabled gates
are rechecked before returning a stage. Revoked/expired sessions, cancellation,
malformed requests and reservation failures retain generic behavior. A 503 can
follow a successful partial write; never treat it as successful verification,
retry it automatically, delete records or reset quota. No extra hosted test is
authorized by this documentation.

## Preview-only configuration commands

These are prepared commands, not authorization to execute them. Run only after
authorization in the authenticated VS Code PowerShell terminal. Do not use env:list,
env:get, env:import or copy credentials. These commands write only nonsecret gate
settings for Deploy Previews, affecting other previews on this project too.
They do not change production values. Do not change the existing IBM target/key.
Before executing, confirm the existing gate variables include the Functions scope
using dashboard scope metadata without revealing their values. Stop if a scope
change would be needed: scopes apply to the variable across contexts. The commands
intentionally omit `--scope` to preserve existing scopes; this installed CLI rejects
combining context and scope updates on existing variables. Newly created nonsecret
gates use the CLI's default scopes, including Functions.

```powershell
# Run from the repository root.
$ErrorActionPreference = 'Stop'
$netlifyCli = Join-Path $PWD 'frontend/.testNetlifyTools/node_modules/netlify-cli/bin/run.js'
node $netlifyCli status
if ($LASTEXITCODE -ne 0) { throw 'Status check failed.' }
# Confirm the linked project is clinicalagent before continuing.
$closedFlags = @(
  'ORCHESTRATE_ENABLED', 'ORCHESTRATE_SYNTHETIC_AUTHORIZED',
  'ORCHESTRATE_DISCUSSION_AUTHORIZED', 'ORCHESTRATE_HOSTED_CONTROLS_VERIFIED',
  'ENDO_DEMO_INFERENCE_ENABLED', 'WATSONX_ENABLED',
  'WATSONX_CONFLICT_ASSIST_ENABLED', 'WATSONX_GUIDED_FOLLOWUP_ENABLED'
)
foreach ($flag in $closedFlags) {
  node $netlifyCli env:set $flag false --context deploy-preview
  if ($LASTEXITCODE -ne 0) { throw 'Preview gate update failed.' }
}
foreach ($setting in @(
  @('ENDO_DEMO_KILL_SWITCH','true'),
  @('OTEL_SDK_DISABLED','true'),
  @('WATSONX_CONVERSATION_MODE','disabled'),
  @('QUOTA_VERIFICATION_ENABLED','true')
)) {
  node $netlifyCli env:set $setting[0] $setting[1] --context deploy-preview
  if ($LASTEXITCODE -ne 0) { throw 'Preview control update failed.' }
}
# Enter your Netlify account user ID, not a token or password.
$operatorId = Read-Host 'Netlify operator user ID (nonsecret)'
if ([string]::IsNullOrWhiteSpace($operatorId) -or $operatorId -match '[,\s]') {
  throw 'One nonempty operator ID is required.'
}
node $netlifyCli env:set QUOTA_VERIFICATION_OPERATOR_IDS $operatorId --context deploy-preview
if ($LASTEXITCODE -ne 0) { throw 'Operator allowlist update failed.' }
```

No model project, URL, ID or IBM key is needed for this storage-only check. No new
daily-limit variable is needed: the isolated harness pins capacity 3 internally.
`ENDO_DEMO_DAILY_LIMIT` and `ORCHESTRATE_SYNTHETIC_POLICY_HASH` are unused here.
Netlify supplies storage credentials through its native server context; never export
or override those credentials. Function settings require a new deploy to take effect.

## Git and Deploy Preview steps, after explicit authorization

First confirm in Netlify's dashboard that the production branch is **not**
`codex/synthetic-ibm-activation`, that branch deployment of this branch is disabled,
that pull-request Deploy Previews are enabled, and preview visibility remains Private.
If those conditions are not already true, stop for operator review. Do not change
production branch settings. A draft GitHub PR still triggers a real Deploy Preview.

```powershell
git branch --show-current
git diff --check
git diff --stat
git ls-files --others --exclude-standard
# Review all existing tracked changes and all required untracked integration files.
# Stage reviewed tracked changes interactively, preserving unrelated edits.
git add -p
# Stage only these new verification files; explicitly stage any other reviewed,
# required untracked Orchestrate files from the existing working branch separately.
git add -- netlify/functions/verifyQuota.ts tools/previewAccess.mjs tools/previewAccessPolicy.ts tools/previewQuotaBrowser.js frontend/tests/QuotaVerification.test.ts shared/PreviewVerification.md
git diff --cached --check
git diff --cached --stat
git diff --cached
# Do not commit until all intended integration dependencies are included.
git commit -m "Prepare private preview quota verification"
if ($LASTEXITCODE -ne 0) { throw 'Commit failed.' }
git push -u origin codex/synthetic-ibm-activation
if ($LASTEXITCODE -ne 0) { throw 'Push failed.' }
```

Open a **draft** GitHub PR from `codex/synthetic-ibm-activation` to `main`
using GitHub's UI. Do not merge. If this branch already
has a PR, use it instead. Inspect the Netlify check and use only its standard URL:
`https://deploy-preview-<PR number>--clinicalagent.netlify.app/`.
Confirm it says Deploy Preview, not production or branch deploy. Review native
`converse` rate-rule processing results. This harness does not alter that rule.

## Access verification before any quota requests

No authenticated browser session is needed for this command. It uses native fetch
without cookies/Authorization and never follows redirects or prints response bodies.

```powershell
node tools/previewAccess.mjs 'https://deploy-preview-<PR number>--clinicalagent.netlify.app/'
if ($LASTEXITCODE -ne 0) { throw 'Access control is failed or inconclusive. Do not run quota checks.' }
```

Replace the PR number. The script checks GET for homepage, conversation API, direct
`converse`, direct `verifyQuota`, and a known missing path; it also checks POST for
the three API/Function routes. It accepts only redirects to an HTTPS Netlify app
login/auth path, without application response markers. A plain 401, 403, 404, 5xx,
Netlify server header, generic HTML or application error is **not a pass**. Other
legitimate platform challenge formats remain inconclusive until reviewed. Do not
weaken the classifier to accept arbitrary errors. In a signed-out browser, confirm
these URLs present Netlify's access/login experience. Do not send login-page bodies.

Then sign in normally as the allowlisted Netlify operator and visit the direct
`/.netlify/functions/verifyQuota` URL: require HTTP 200 with `operatorReady` and the
application marker `X-Quota-Verification: application`. This positive control proves
the endpoint exists behind the platform boundary. Verify the conversation endpoint
returns its blocked capability with the authenticated session. Check homepage access
works when signed in. If any unauthenticated request reaches an application handler,
stop: platform protection is not established, even if the handler returns 403/503.
The harness independently denies missing/unlisted users on its direct URL.

Only after all those checks, paste `tools/previewQuotaBrowser.js` into the console
of the authenticated standard preview page. It uses the existing browser session;
do not extract cookies, paste access tokens, or run from production. Share only
the access-test summaries and final numeric quota report. If multiple workers are
not observed, report that limitation and repeat with a fresh run after review.

After testing, the operator can set `QUOTA_VERIFICATION_ENABLED=false` in the same
Deploy Preview Functions context and redeploy the preview, or close the PR and
confirm the preview is unavailable. Do not delete or reset production/test tickets.
IBM inference remains disabled; this workflow cannot run the Blue Lantern probe.

References checked 6 November 2026:
- https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/
- https://docs.netlify.com/build/functions/api/#user
- https://docs.netlify.com/build/data-and-storage/netlify-blobs/
- https://docs.netlify.com/deploy/deploy-types/deploy-previews/

## Local verification results

6 November 2026: new verification suite 14 tests passed; complete frontend suite
42 files / 1,385 tests passed; TypeScript `--noEmit` and `npm --prefix frontend run
build` passed. Run Vitest from `frontend` because existing tests read paths relative
to that directory. The initial repository-root invocation was interrupted and
replaced with the successful correctly located run. A stable ignored temporary
directory was used to avoid sandbox temporary-file issues. Generated scratch files
outside ignored directories were removed; existing work was preserved.

Repository-wide `git diff --check` reports pre-existing trailing whitespace in
`frontend/src/App.tsx` at lines 58, 85, 120 and 126. It was not changed by this work.
Review that existing diff before the future commit; do not silently reformat it.
No hosted access, native rate-rule, storage concurrency or IBM result is claimed.

## Authorized terminal handoff, 6 November 2026

The ignored local `.testPreviewOperator` folder contains executable PowerShell
handoff scripts, a PR body and `ApprovedFiles.json`. The manifest pins the current
base commit and SHA-256 of exactly 36 reviewed files. The commit script refuses
an existing staged change, changed HEAD, changed approved content, unexpected
staging or whitespace errors. Existing `.gitattributes` uses `* -text`; Git must
preserve the integrity-bound bytes. `core.whitespace=cr-at-eol` recognizes existing
CRLF endings and the whitespace check passes without formatting any source.

The selection includes disabled Orchestrate integration code and tests needed to
exercise the actual conversation API/direct Function, quota primitives and adapter,
the new harness and access scripts, pinned dependency/notice changes, and matching
review seals. All 114 bindings validate against the proposed commit snapshot.
Both claim packages (57 + 21 = 78 claims), protected evidence integrity and existing
emergency-rule code are unchanged. The remaining 11 files stay unstaged and intact:
README/release-list edits; Orchestrate README, agent instructions, fictional
conversational cases and connection identity example; AgentConnection, AnonymousDemo,
OrchestrateActivation and OrchestrateConnection documentation; and chatBrowser.cjs.
The pre-existing broad clinical/persistent-memory instruction changes are not
approved by this deployment and are not included in the commit.

First verify the dashboard deployment-source and variable-scope metadata conditions
above. Run these commands in the authenticated VS Code PowerShell terminal:

```powershell
Set-Location 'C:\Users\rob44\OneDrive\Desktop\clinicalAgent'
& .\.testPreviewOperator\TestBackend.ps1
& .\.testPreviewOperator\ConfigurePreview.ps1
& .\.testPreviewOperator\CommitReviewed.ps1
& .\.testPreviewOperator\PushPreview.ps1
```

Run each separately and stop on any error. Configuration affects Deploy Preview
values only, preserves existing scopes and does not read or print IBM credentials.
The push script verifies ancestry, exact committed paths and approved content,
then pushes an explicit feature-branch refspec without force. It opens/reuses a
draft PR targeting main using existing GitHub CLI access if available; otherwise
it prints the GitHub compare link for the existing browser login. It never merges.
This avoids broad `git add .`, changes to main, or committing unrelated edits.

After Netlify reports the private Deploy Preview ready, run the access checker
above with its actual standard URL. The checker stops on the first failed or
inconclusive route. Only after its success and the authenticated positive controls
may the operator execute the browser quota runner. That runner aborts pending
requests when it observes a fourth admission and stops; storage operations already
accepted remotely cannot be undone. No retry or new test may follow a failure.
Return PR URL, actual preview URL, access summaries, authenticated positive-control
status and the numeric quota report (including workers). Do not send cookies,
headers containing credentials, environment values or provider output.

Updated local results: 15 verification tests passed; the focused quota/check suites
passed 48 tests; the complete frontend suite passed 42 files / 1,386 tests;
TypeScript passed. The deployment remains blocked on operator execution, not on
new credentials. The two-turn IBM test remains unperformed and not ready until
hosted access and quota controls pass.

Additional backend checks were attempted for package integrity, grounding, safety
and reviews. Default temporary-file fixtures initially errored in the sandbox; a
retry with an explicit writable base directory progressed without those errors but
did not finish. A separate safety-suite attempt also did not finish. Both attempts
were interrupted; no complete backend pass is claimed. `TestBackend.ps1` runs the
same 548 selected checks in the operator terminal before committing. Stop on any
failure. No tests or clinical rules were changed to accommodate the sandbox.
