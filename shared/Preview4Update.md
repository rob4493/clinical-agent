# Deploy Preview #4 update

Target: PR #4, branch codex/synthetic-ibm-activation, preview
https://deploy-preview-4--clinicalagent.netlify.app/. No new PR or Production deploy.
The prepared parent is e04337b8830a2bf3e7cfd27ac20cdf8bccf815ed. No new commit exists
until the operator runs the commands below. All unrelated working-tree changes are
preserved; the release inventory alone is partially staged to omit unrelated files.

## Necessary deployment correction

The issuer now pins ORCHESTRATE_EMBED_PREVIEW_ID=4 and the exact configured PR #4
origin instead of a changing deploy ID. Netlify freezes Function variables per
deploy, so preconfiguring that deploy's eventual ID was circular. CONTEXT and
DEPLOY_ID are also not standard Function-runtime environment variables. The code
uses trusted context.deploy.context/published/id and trusted context.user instead.
Public Production, branch deploys, another preview origin and unauthenticated
operators remain rejected. Renewal ownership still uses the real immutable deploy
ID, preventing a token from an older build being renewed on the new build.
No signing key, existing credential, clinical contract or evidence claim changed.

## In the existing authenticated VS Code PowerShell terminal

Run from the repository. Keep private key values out of commands and output.

```powershell
# Run from your existing clinicalAgent checkout.
$cli = Join-Path (Get-Location) 'frontend\.testNetlifyTools\node_modules\netlify-cli\bin\run.js'
node $cli env:set ORCHESTRATE_EMBED_PREVIEW_ID 4 --site clinicalagent --context deploy-preview --scope functions
if ($LASTEXITCODE -ne 0) { throw 'Preview ID configuration failed.' }
node $cli env:set ORCHESTRATE_EMBED_PREVIEW_ORIGIN 'https://deploy-preview-4--clinicalagent.netlify.app' --site clinicalagent --context deploy-preview --scope functions
if ($LASTEXITCODE -ne 0) { throw 'Preview origin configuration failed.' }
node tools/checkEmbedEnvironment.ts
```

The check captures resolved CLI output in memory and prints only required names and
presence booleans for clinicalagent, Deploy Preview context, Functions scope. It
never prints values, tokens, stderr, keys or fingerprints and never changes settings.
Presence is not proof of valid values or approved controls. If the CLI/API withholds
secret metadata, confirm the key's presence in Netlify UI; never reveal the value.
The retired ORCHESTRATE_EMBED_PREVIEW_DEPLOY_ID is not required. Leave the existing
private key and SHA-256 pin unchanged. Do not set unverified controls to true just
to make the check or chat pass. Enabling remains subject to EmbeddedActivation.md.

The reviewed intended files are already staged by preparation. Check the index
before creating the commit; do not run git add . or stage remaining pending work.

```powershell
$ErrorActionPreference = 'Stop'
if ((git branch --show-current).Trim() -ne 'codex/synthetic-ibm-activation') { throw 'Wrong branch.' }
$expected = @(Get-Content -LiteralPath '.testAnonymous\Preview4Files.txt')
$actual = @(git diff --cached --name-only)
if (Compare-Object ($expected | Sort-Object) ($actual | Sort-Object)) { throw 'Staged inventory changed; stop.' }
if ((git write-tree).Trim() -ne (Get-Content -LiteralPath '.testAnonymous\Preview4Tree.txt' -Raw).Trim()) { throw 'Staged content changed; stop.' }
git -c core.whitespace=cr-at-eol diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Staged whitespace check failed.' }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
$parent = 'e04337b8830a2bf3e7cfd27ac20cdf8bccf815ed'
if ((git rev-parse HEAD).Trim() -ne $parent) { throw 'Local HEAD changed; stop for review.' }
if ((git rev-parse origin/codex/synthetic-ibm-activation).Trim() -ne $parent) { throw 'Remote feature branch changed; stop for review.' }
git commit -m 'feat: add protected IBM embedded chat preview'
if ($LASTEXITCODE -ne 0) { throw 'Commit failed.' }
$newCommit = (git rev-parse HEAD).Trim()
git push origin HEAD:codex/synthetic-ibm-activation
if ($LASTEXITCODE -ne 0) { throw 'Push failed; do not force-push.' }
$newCommit
git ls-remote origin refs/heads/codex/synthetic-ibm-activation refs/pull/4/head
```

No main update, new PR, manual netlify deploy, force push or production setting is
part of these commands. The existing PR head updates normally; its configured
Netlify integration should rebuild the same Preview #4 alias. This is an expected
trigger, not proof a build succeeded. In PR #4's Netlify check, confirm the new SHA,
successful build, embedSession Function and protected preview URL before testing.

## Hosted verification (pending until the operator pushes)

1. Confirm the existing team-login protection and operator allowlist; password-only
   protection cannot supply the required context.user. Do not make the preview public.
2. Confirm keys/pin and all required settings are Functions-scoped preview settings.
   Register or reuse only the matching IBM public key; do not rotate keys for this update.
3. Verify effective IBM tool/collaborator denial, nonclinical privacy/retention terms
   and bounded provider-side usage allowance. Endo's Blob session cap is not a cap
   on direct IBM messages. Keep activation false/kill true until these gates pass.
4. Check protected /api/ready and /api/v1/modules. Both modules and presets must remain
   available without IBM. Never test the token endpoint anonymously to bypass protection.
5. Start AI conversation once in Endo. Observe the /api/v1/embed-session status, not
   its token body. A valid authorized issuance consumes one session/day; do not burn
   the reservation with a separate test POST or copy the token. A 404 means preview
   selector/flags/window are closed; 403 means operator context/allowlist failed;
   503 means signing/key-pin/storage/renewal validation failed. None proves IBM access.
6. Confirm IBM's real composer renders inline, with no navigation or case projection.
7. Use only these already approved nonclinical messages in the same session:

> Nonclinical connectivity test. Remember the fictional object name Blue Lantern for this conversation. Reply only: Blue Lantern acknowledged.

> Nonclinical connectivity test. What fictional object name did I give you previously? Reply only with that name.

Expected continuity: the second answer identifies Blue Lantern. Do not substitute
mock replies. Record the actual operational outcome and latency without tokens,
HAR exports, transcripts, clinical text or credential-bearing screenshots. No
medical questions, uploads or patient information are permitted in this probe.
8. End session, verify unchanged case/result and leave preview kill=true. Token
   expiry is bounded, but SDK destroy cannot prove cancellation of an accepted IBM
   run or deletion of history. Do not reset/delete quota records to regain capacity.

## Exact staged inventory

- .env.example
- ReleaseFiles.txt
- backend/competition/evaluationSeal.py
- evaluation/review.json
- frontend/scripts/prepareEvaluation.mjs
- frontend/src/App.tsx
- frontend/src/GuidedFollowup.tsx
- frontend/src/embedded/AssistantPanel.tsx
- frontend/src/embedded/EmbeddedChat.tsx
- frontend/src/embedded/liveConfiguration.ts
- frontend/src/embedded/panel.css
- frontend/src/embedded/session.ts
- frontend/src/styles.css
- frontend/tests/AgentUi.test.tsx
- frontend/tests/AgentWorkflow.test.tsx
- frontend/tests/Context.test.tsx
- frontend/tests/Conversation.test.tsx
- frontend/tests/Dialogue.test.tsx
- frontend/tests/EmbedSession.test.ts
- frontend/tests/EmbeddedActivation.test.tsx
- frontend/tests/EmbeddedLifecycle.test.ts
- frontend/tests/EmbeddedPanel.test.tsx
- frontend/tests/GuidedFollowup.test.tsx
- frontend/tests/PreviewRelease.test.ts
- frontend/vite.config.ts
- netlify.toml
- netlify/evaluation/reviewSeal.ts
- netlify/functions/embedSession.ts
- shared/EmbeddedActivation.md
- shared/EmbeddedRelease.md
- shared/Preview4Update.md
- tools/checkEmbedEnvironment.ts

The inactive AssistantPanel/panel.css and their test are retained because the
existing canonical integrity review binds them. The normal UI does not import or
launch this old modal. Standalone assistant.html and its harness are not included.

## Validation status

Exact staged source-only snapshot validation passed: 1432 frontend/Function tests
in 47 files; 265 backend tests passed, one existing private-installation fixture
skip, one Starlette/AnyIO dependency warning. TypeScript, production build, npm ls,
pip check, source-only inventory (383 files), staged secret/private-path/size checks
and protected-claim byte comparisons passed. No dependencies were installed.
The backend command used the README's inactive release registry and a fresh local
pytest temp directory. Initial default-registry/temp-directory setup errors were
resolved through documented source-free setup, without test assertion changes.
The optional standalone page is absent from the tested snapshot and is not built.
Public activation and actual IBM inference are not established by these tests or
configuration flags. Deployment remains pending the operator's commit and push.
