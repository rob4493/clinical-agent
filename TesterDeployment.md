# Public evaluation hosting

## [🌐 OPEN LIVE ENDO — AGENT ENDO AND STRUCTURED EVIDENCE REVIEW](https://clinicalagent.netlify.app/)

**Public website:** **https://clinicalagent.netlify.app/**

**Current milestone (November 21, 2026):** the website hosts **live anonymous
IBM watsonx Orchestrate Agent Endo chat** and the separate deterministic
Structured Evidence Review. A real IBM-generated first response was
confirmed using the public Production endpoint, after a secure anonymous
session was established. The working agent demonstration in protected
Preview #4 was also recorded and submitted for judging. No login is needed
for the public chat. The live first test did **not** test follow-up continuity.

**Verified public launch:** Netlify deployment `6b01aa92d599c4c7de59f902`,
application commit `0e906aa30b81234d41803619cb6f0af7eada9fa5`.
**Configured evaluation window (UTC):**
`2026-11-21T14:31:00Z` – `2027-01-21T14:31:00Z`.
Availability depends on provider service, quotas and kill switches.
The website remains strictly for fictional/de-identified evaluation, not
actual patient care. See [Production conversation controls](shared/ProductionChat.md).

This competition evaluation build is not approved for patient care. Use fictional or de-identified cases only. Reviewed with healthcare professionals for evaluation and feedback. Not validated or approved for patient care.

## One Netlify deployment

Use the root netlify.toml. A repository-root build base keeps production and CLI file patterns consistent. Its command installs the exact frontend lockfile with lifecycle scripts disabled and builds through npm --prefix frontend. It publishes frontend/dist, pins Node 24.21.0 and bundles the Netlify Functions with esbuild. The **deterministic evaluation function** requires no Python host, backend URL, database, provider API key or CLINICAL_EVIDENCE_ROOT. The **separate live conversation function** uses securely configured server-side IBM credentials and Netlify Blobs quotas.

Explicit rewrites route `/api/v1/conversation` to the `converse` Function and `/api/v1/embed-session` to `embedSession`; the general `/api/*` rewrite routes to `evaluate/:splat`. The final SPA fallback supports direct URLs and page refreshes. API failures remain sanitized JSON. VITE_BACKEND_URL configures only the separate local Vite/FastAPI development proxy; it is unnecessary for Netlify.

Build preparation verifies the trusted evaluation review record and creates an explicit public allowlist snapshot in ignored frontend/.evaluationBundle/content.json. It is statically imported only by server code and embedded in the function, outside the static publish directory. Runtime rechecks every embedded file against the trusted review pin. The only additional included file is Netlify's MIT runtime notice, netlify/RuntimeNotice.txt. There are no runtime evidence files or dynamic filesystem lookups. This avoids the local CLI's broad filesystem tracing and recursive copying of previous build/test directories. No original publications, intake files, private packages or source-file hashes are copied. Builds and startup never reseal changed evidence. A running function retains its immutable reviewed release; changes require a complete verified rebuild and deployment, not mutable evidence-file replacement.

## Availability and privacy

GET /api/health is liveness. GET /api/ready verifies local evaluation dependencies; GET /api/v1/modules discovers the two evaluation modules. POST /api/v1/analyze preserves the existing request and AnalysisResult shapes. Readiness means evaluation availability, never authentic clinical approval. Missing or altered reviewed files fail closed, and final response provenance is rechecked. Invalid discovery/readiness keeps Analyze unavailable.

The **Structured Evidence Review** server uses deterministic evidence-bound composition, not a live language model or vector service. **Separately**, the `converse` Function invokes the existing live IBM watsonx Orchestrate Agent Endo only after anonymous admission, privacy/safety checks and quota reservation. It retains input/privacy validation, conflicts, clarification, source-bound urgent warnings, module isolation and exact citations. Authentic module activation and pending source states remain unchanged. The deterministic `evaluate` function retains its source-bound analysis and does not use IBM chat. The separate `converse` function has bounded server-to-IBM requests, secure short-lived session receipts and immutable quota/lock records, without intentionally persisting raw clinical chat transcripts.

A five-second operation deadline bounds the function. Browser aborts prevent late UI updates. Request-signal cancellation is respected when propagated by the host; a buffered CDN may allow bounded computation to finish after a client disconnect. Guaranteed host-to-function disconnect propagation has not been established. Review platform logs, retention, access controls and request-body capture settings before tester access. Never enable payload logging or analytics.

## Local emulation

Netlify CLI 27.12.1 is separately approved, ignored tooling under frontend/.testNetlifyTools, installed with lifecycle scripts disabled. It is not an application dependency. The supported functions:serve --offline command runs the actual function emulator without an account.

This CLI also downloads an unused Deno Edge environment during full-site dev --offline startup. That bootstrap attempt was blocked by the test network guard. Full-site offline testing explicitly uses the existing internal --internal-disable-edge-functions switch; it is an internal test limitation, not a production setting or dependency patch. No Edge Function is configured.

A clean checkout does not include this optional tooling. To install exactly the reviewed CLI into ignored local tooling (not the application dependency files), an operator may run:

    npm install --prefix frontend/.testNetlifyTools --no-save --ignore-scripts --no-audit --no-fund netlify-cli@27.12.1

Keep its version pinned; do not authenticate or deploy merely to test locally. After building, from the repository root:

    node frontend/.testNetlifyTools/node_modules/netlify-cli/bin/run.js dev --offline --internal-disable-edge-functions --port 8892

Do not run two emulators together: they share generated function directories. Stop with Ctrl+C. No account login or deployment is required. The CLI recommends its optional TypeScript types package; none was added.

## Optional FastAPI development

FastAPI remains intact. Use Python 3.12 and the declared isolated backend environment, then python -B -m tools.runDemo --mode competition. Public competition composition requires no private files. Standard and production authentic modules remain inactive. Explicit legacy private evidence operation still requires legally obtained, separately verified files described in EVIDENCE_INSTALLATION.md and is not used by Netlify.

A separately authorized Python host can use python -B -m tools.serveTester with its assigned integer PORT; it binds 0.0.0.0 and disables access logs. This is optional, not the public Netlify backend.

## Release and rollback

Do not publish until inventory, source-only build, complete suites, privacy/integrity and actual-function browser checks pass and are reported. Roll back the complete Git commit and Netlify deploy, keeping code, public packages and review pins together. Never refresh hashes to bypass review. Protected evidence must never enter Git, release archives, image layers or static assets. No deployment is performed here.

Official documentation reviewed 2026-10-15:
- https://docs.netlify.com/build/functions/get-started/
- https://docs.netlify.com/api-and-cli-guides/cli-guides/local-development/
- https://docs.netlify.com/api-and-cli-guides/cli-guides/manage-functions/
- https://docs.netlify.com/build/configure-builds/file-based-configuration/

## Browser validation

Provide an already installed Playwright module path in `DEMO_PLAYWRIGHT_MODULE` and a loopback-only origin in `EVALUATION_ORIGIN`. Browser tooling is not an application dependency and must not be downloaded by a test. The current harnesses are:

- `evaluationBrowser.cjs`: both modules, all presets, manual questions, canonical requests and cancellation.
- `competitionBrowser.cjs`: additional Module 1 test-precision and structural-finding scenarios.
- `endoBrowser.cjs`: responsive navigation, uploads, urgent ordering, computed contrast, keyboard, reflow and reduced motion.
- `presentationBrowser.cjs`: compact summaries, citation navigation and disclosures at three widths.
- `uploadBrowser.cjs`: bounded PDF/DOCX/TXT review and negative-file cases.
- `demoBrowser.cjs`: synthetic/disabled FastAPI modes and concurrent request isolation; requires the two local graphs described in the harness.

For the first five, start the local Netlify emulator above and run each with `node frontend/tests/<name>`. Reports and screenshots remain ignored. `frontend/tests/localGuard.cjs` can be preloaded with `NODE_OPTIONS=--require=<absolute path>` for localhost-only Node connection counting. Set `DEMO_GUARD_REPORT` to a report filename, not an absolute path. This guard is test tooling, never a production monkey-patch.

Historical screenshot/design harnesses tied to retired headings or ports are superseded by these current checks. Physical Safari/iPad and assistive-technology certification remain separate; automated checks do not establish compliance.
