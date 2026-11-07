# Embedded agent release preparation

Priority changed to IBM's supported Embedded agent channel on 6 November 2026.
Stop extending the custom chat API and do not execute the earlier deployment scripts
for this feature. Existing assets remain intact. No commit, push, merge, deployment,
IBM configuration change, signing-key creation or inference is part of preparation.

## Bounded implementation plan

1. Preserve the operator-supplied Live configuration exactly, without deriving
   identifiers from the separate API connection example.
2. Prepare an isolated React assistant page with its own `root`, no Endo case props,
   no uploads, no transcript persistence and no external script loading.
3. Build that page alongside Endo, keeping activation unconditionally blocked until
   the real IBM controls and supported JWT bootstrap have been verified.
4. Verify this preparation with UI/network-exclusion checks and the production build.
5. The SDK/JWT bootstrap is now implemented for an operator-only preview; keep it
   disabled until the controls below pass, then test genuine IBM conversation and request final
   production deployment approval. No local text is represented as an IBM reply.

## Verified integration input

The operator copied the snippet from Endo Clinical Assistant > Channels > Embedded
agent > Live, version 1.3.0. `frontend/src/embedded/liveConfiguration.ts` preserves
the supplied orchestrationID, hostURL, rootElementID and chatOptions.agentId. The
generated loader is `/wxochat/wxoLoader.js?embed=true` on the supplied host and calls
`wxoLoader.init()` after load. No agentEnvironmentId, CRN, integration ID, alternate
host or SDK auth property has been invented. An example from another IBM deployment
must not override this generated configuration. Confirm the actual resolved Live
version during the hosted test because the snippet itself does not pin a version.

The standalone entry is `/assistant.html`. It has its own React root and imports no
Endo case, API, analysis, upload or clinical-parser modules. No context, case object,
URL payload, prompt, filename, extracted text or opener reference is passed. The single Endo AI Assistant section beneath Evidence summary offers Start AI
conversation. It expands inline, with one session lifecycle and a separate
endoEmbeddedAgentMount element. The embedded mount receives no case props.
The local fallback retains reviewed collection and confirmation controls in the
same section; it is not IBM inference. The
standalone page remains a development harness, not the primary assistant entry.
Third-party script access and SDK browser storage/telemetry still require review.
A separate page is not a claim of cross-origin isolation or zero retention.

## Operator confirmation of Live snippet

On 6 November 2026 the operator supplied the complete generated Live script in
this conversation. Every stored configuration field and the loader URL match it
exactly. `operatorSuppliedLiveSnippet` records that provenance only; it is not
independent verification of tenant permissions or the currently resolved version.
The supplied snippet contains no JWT bootstrap configuration. Do not interpret
that omission as authorization to use unsecured public embedding.

The operator explicitly marked Embed Security, all-tools denial, chat retention
and hard account/instance spending limits as **not yet verified**. No application
flag, loader callback or configuration change may turn this preparation on. The
SDK is not loaded, so no embedded tools can execute through this page; that is
not a claim that tools have been disabled in IBM. Before enabling the SDK, verify
a server-enforced tool deny policy and the remaining release gates below.

## Exact release blockers

| Requirement | Current evidence | Resolution location |
| --- | --- | --- |
| Embed Security | Operator reports unverified | IBM Settings > Embed Security; inspect before changing the tenant-wide setting |
| Anonymous JWT bootstrap | Supported signed-JWT model documented; tenant setup unverified | Server-only RS256 private key and IBM-registered public key; verify this tenant's supported initialization/refresh contract |
| Tool denial | No confirmed channel/principal deny for existing Live agent | IBM permissions/connections/runtime policy; verify all Endo tools, other connected tools and collaborators are denied for the embedded principal |
| Hard spending ceiling | No verified enforceable ceiling | IBM instance/plan or a supported upstream enforcement mechanism covering every billable request |
| Chat privacy/retention | Operator reports unverified | IBM Data Retention, tracing/analytics, memory, upload settings and approved public clinical-free-text policy |
| Hosted rendering/inference | Not attempted | Protected preview using actual SDK and existing Live agent, once security prerequisites pass |

Netlify can host this page and a small server-only JWT issuer, keep its private key
out of VITE variables, return no-store responses, and limit token-issuance requests.
No visitor login is inherently required: the intended issuer generates a distinct,
opaque session identity rather than using a person's identifier. It must not issue
tokens until IBM security, tool permissions, privacy and spending controls are
established. The current page contains no issuer, private key or JWT.

IBM documents RS256 signing and JWT expiry/renewal for embedded chat. Current embed
documentation says encrypted user_payload is unnecessary without OBO; the older
direct-API SSO examples have different requirements. Do not copy their fields or
Assistant-builder identityTokenExpired API into this agent channel without checking
the generated SDK's supported contract. Do not weaken Embed Security for anonymity.
Changing Embed Security can affect other integrations in this tenant; it requires
operator review and must not be done as an unapproved production change.

JWT issuance limits constrain issued sessions, not messages sent directly from the
browser to IBM. One unexpired bearer credential can authorize repeated requests;
short expiry, browser counters, hidden UI buttons and Netlify's existing
EndoConversationQuota do not establish a per-message or monetary ceiling. Stopping
renewals does not revoke an already accepted remote run. A public release requires
an enforced provider/gateway allowance and bounded per-run work whose relationship
to charges is verified. IBM billing alerts explicitly do not stop charges. Do not
equate MCP tool rate limits or infrastructure throttling with an inference budget.

IBM announced a tenant-wide Global Rate Limiter on 20 October 2026, configured
through the Control Plane Controls page. Its documented scope is chat requests
across agents and workspaces, with rejection when the limit is reached. Confirm
availability in this tenant, coverage of anonymous embedded requests, allowed time
windows, concurrent enforcement and maximum billable work per accepted request.
A request-rate cap alone is not a verified daily monetary ceiling. Do not change
this shared tenant policy without operator approval. The detailed documentation
returned 403 during this review, so its precise limits remain unverified.

No documented channel-specific all-tools-off switch has been verified for v1.3.0.
Do not assume a User-level JWT denies team-credential tools. Hiding tool controls,
omitting case context, or asking the model not to use tools is not enforcement. If
this version exposes tools and runtime permission denial cannot be established,
the same existing agent needs an approved tool-free release or supported deny policy
before public embed. Do not create a duplicate agent or change Live during this task.

IBM's chat-privacy documentation describes chat-history retention of 30–365 days
(default 30 days) and deletion of chat-uploaded files approximately four hours after
the most recent upload. That file policy explicitly excludes tool-uploaded files.
Retention for traces, agent memory and tool files must be verified separately.
These are documented product policies, not verified tenant settings. Agent memory is separate; disabling it
does not itself delete existing memory/history. Treat these as explicit review
items. A demo label or reminder cannot prevent visitors entering patient data.
Do not claim session-only processing. Keep uploads, voice, canonical-case context
and unreviewed tools excluded from the proposed initial release. Verify exclusions
at IBM's server boundary, not only in the browser UI.

## Required real acceptance tests

All results below are pending. No mock conversation satisfies these checks.

- Verify configured security rejects missing, expired and tampered credentials;
  identities cannot retrieve another anonymous session's history. Do not save tokens.
- Send nonclinical text asking the agent to remember the fictional name Blue Lantern.
  Ask for it on a subsequent turn and then ask a natural follow-up. Judge actual
  continuity rather than requiring a scripted literal reply.
- Inspect authoritative permissions and a controlled denial test/operational trace
  to establish zero connected-tool execution. The agent saying it used no tools
  is not evidence. Use no clinical payload or production-side-effecting tool test.
- Verify the enforced allowance under concurrent requests and bearer replay, including
  rejection at the ceiling. Do not deliberately exceed an unverified monetary cap.
- Inspect only sanitized request shapes to establish no current case, analysis,
  upload or filename is transmitted. Do not export a HAR containing JWTs or text.
- Test actual SDK keyboard/focus, 360px mobile layout, scrolling, close/reopen,
  renewal, network failure and loading once under React StrictMode. Confirm the
  active Live agent version. Do not assert tool denial from browser appearance.

The shortest safe interim path is a private operator preview of the official widget,
after tool denial and nonclinical data handling are verified, using an explicitly
bounded operator test allowance. That is validation only, not the public no-login
release. If a hard public cap cannot be established, keep public activation blocked;
obtain a supported IBM enforcement option before adding more integration code.
No final deployment approval should be requested until the real acceptance tests pass.

## Primary references, checked 6 November 2026

- [IBM embedding procedure](https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=applications-embedding-agent-web)
- [IBM embedded-chat security](https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=applications-securing-embedded-chat)
- [IBM security configuration](https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=chat-configuring-security-embedded)
- [IBM data retention](https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=settings-managing-data-retention)
- [IBM asset/enterprise controls](https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=overview-controls)
- [IBM billing FAQ](https://cloud.ibm.com/docs/account?topic=account-billusagefaqs)

Some IBM Docs pages returned 403 on direct retrieval; official indexed page content
was available. This research is not a read of the existing tenant's configuration.

- [IBM chat privacy and file retention](https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=instance-chat-privacy-data-protection)
- [IBM Global Rate Limiter announcement](https://community.ibm.com/community/user/blogs/bruno-fernandes-dos-santos/2026/10/20/whats-new-in-watsonx-orchestrate-for-october-2026-mid-month-release)

## Preparation validation

The three new configuration/UI/network-exclusion checks pass. TypeScript and the
production build pass, producing `frontend/dist/assistant.html` alongside Endo.
These are preparation checks, not chatbot simulations or real IBM results. The
page intentionally blocks external connections and scripts with CSP; inspect the
built page using Vite preview rather than relying on development HMR, whose socket
and inline bootstrap are not permitted by this preparation CSP. The clinical UI expands the blocked inline assistant rather than navigating to this harness. The standalone harness still does not initialize IBM. The unified panel now uses
the operator-only SDK/JWT implementation documented in EmbeddedActivation.md;
public production is rejected even if preview flags are accidentally enabled.

No real inference, continuity, mobile SDK rendering, token isolation, tool-denial
or enforced-spending result is claimed. The 78 clinical claims, existing emergency
code and 114 review bindings remain unchanged/valid. Final deployment approval is
not yet requested because the minimum real security/function tests cannot run
until the verified tenant settings are supplied.

### Follow-up verification on 6 November 2026

The isolated EmbeddedAssistant suite passed 3/3; the production build, including
TypeScript checking, passed. The read-only resealing check reported all three
representations unchanged. Protected claim packages, reviewed variants and the
Module 1 Orchestrate baseline match HEAD. No live IBM call was made.

The normal full frontend run failed during loading in 42 suites with sandbox
temporary-file ENOENT errors (83 tests passed in the remaining suite). Retries
with workspace-local temporary storage, including a host-context run, stalled
and were interrupted. The targeted backend evaluation run also stalled and was
interrupted. These broader runs are not passes and must be completed before any
release. Existing unrelated working-tree changes were preserved; nothing staged.

## In-page integration validation

The unified assistant replaces the competing modal, guided drawer and standalone
chat entry in the normal application. Start AI conversation expands the same
section on desktop and mobile. End session or Escape cancels the active local
request, clears conversational proposals and restores activation focus without
changing the case or result. One optional local fallback preserves explicit final
confirmation and separate reanalysis. The former custom OrchestrateChat and modal
files remain preserved development assets, not active conversation entry points.
There is no embedded SDK initialization or token issuer. A legacy API capability
response cannot authorize browser-direct inference. IBM controls remain blocked.

The previously shared Vite-preview link served static files and proxied /api to an
unavailable local FastAPI process. The correct evaluation development command is:

```powershell
npm --prefix frontend run build
node frontend/.testNetlifyTools/node_modules/netlify-cli/bin/run.js dev --offline --no-open --port 8897 --functions-port 9997
```

That CLI path is existing ignored local tooling, not an application dependency.
Use the approved CLI installation procedure on a new machine. Netlify Dev runs
actual local Functions and redirects; ordinary Vite preview is not a Function host.
The isolated CLI reported its optional local Database could not start; Endo does
not require it. Function requests for discovery, readiness and analysis returned
200. No database or IBM connection was used to obtain these results.

Validation: 44 frontend/Function test files, 1390 tests passed; TypeScript and
production build passed. The earlier direct Vitest invocation preceded bundle
regeneration and correctly failed stale-evidence validation; the normal test
command regenerated the bundle and passed without bypasses. All three canonical
seals agree. Protected claims and reviewed wording match HEAD byte-for-byte.
Browser checks confirmed both module results, preset selection, in-page opening,
closing and preserved case state. Desktop 1440px and mobile 390px captures are in
ignored frontend/screenshots/embeddedDesktop.png and embeddedMobile.png.
Upload-specific regressions are included in the full suite; no new real upload
was submitted during the browser check. Actual IBM inference remains untested and
blocked. No security setting, live environment, Git index or deployment changed.

## Unified assistant acceptance

The UI has one Endo AI Assistant heading, one primary activation action, one
provider-status message and one active surface. There is no modal, mobile portal,
second chatbot, transcript persistence or navigation. The composer uses normal
page flow, avoiding nested scroll regions. Existing conflict review still opens
its separately required verification dialog; it is not an AI conversation.
Original clinical packages, source bindings and reviewed wording remain unchanged.
Desktop/mobile captures: frontend/screenshots/unifiedAssistantDesktop.png and
unifiedAssistantMobile.png (ignored, never release inputs).

Final consolidation validation: 44 frontend/Function files and 1392 tests passed;
focused GuidedFollowup suite 20/20; TypeScript/production build and npm ls passed.
The initial consolidation regression run found four old-modal/entry expectations;
those were migrated to inline activation and confirmation without dropping their
clinical assertions. The final full rerun passed. No commit or staging occurred.

## Operator-preview implementation update

See EmbeddedActivation.md for the implemented RS256 bootstrap, official loader
lifecycle and exact manual setup. The earlier statements that no issuer or loader
exists describe the prior preparation stage. They no longer describe the code.
Public production remains rejected; no key, IBM settings or live test was created.
The new lifecycle is integrated into the same unified assistant section, not a new
page. Real inference remains pending the documented external setup and controls.

Implementation inventory for the JWT/bootstrap task: .env.example, ReleaseFiles.txt,
netlify.toml, netlify/functions/embedSession.ts, frontend/vite.config.ts,
frontend/src/GuidedFollowup.tsx, frontend/src/styles.css,
frontend/src/embedded/session.ts, frontend/src/embedded/EmbeddedChat.tsx,
frontend/tests/EmbedSession.test.ts, frontend/tests/EmbeddedLifecycle.test.ts,
frontend/tests/EmbeddedActivation.test.tsx, frontend/tests/GuidedFollowup.test.tsx,
frontend/tests/AgentWorkflow.test.tsx, frontend/tests/AgentUi.test.tsx,
frontend/tests/Context.test.tsx, frontend/tests/Conversation.test.tsx,
frontend/tests/Dialogue.test.tsx, shared/EmbeddedActivation.md, this document,
evaluation/review.json, backend/competition/evaluationSeal.py and
netlify/evaluation/reviewSeal.ts. Earlier working-tree changes were preserved.
The three seals were regenerated only by the canonical maintenance command.
No original publications, credentials or generated inspection sources enter the
inventory. The source-only export contains 384 files, has no private evidence or
assistant.html, and builds using existing installed dependencies through a local
test junction, without installing anything. This is not a fresh dependency install.

Final JWT/bootstrap task results: 1427/1427 frontend/Function tests in 47 files,
107 backend integrity/evaluation tests, build/typecheck, dependency checks and
source-only export/build passed. Live IBM tests are still pending manual setup.
