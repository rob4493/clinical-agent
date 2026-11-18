# Protected editable IBM discussion

## Evidence and scope

The operator reported Blue Lantern Test #3 PASS: IBM authentication, first response,
second response and thread continuity all passed against Live Agent Endo v2.0.0,
UUID c6698d4e-a08d-4b77-bf05-139ff3b4c695, EU-DE. This is connectivity evidence;
it does not verify clinical correctness, immutable Live tool bindings or indirect actions.
The new editable path has only been tested offline with mocked IBM responses.

## Two separate modes

The existing Evidence review now offers an expandable IBM discussion, including
before a structured review exists. Collapse keeps React history; New conversation
explicitly clears it. No browser storage is used. Typed messages alone are sent;
case fields, analysis, documents and reviewed renderedText are never automatically
copied. Ordinary education requires no module. Responses are labelled AI-generated
discussion, not independently verified clinical evidence.

Explicit structured-review requests are redirected to the existing structured form
without invoking IBM or submitting a case. Clinicians review/select its fields and
submit explicitly. That established route retains privacy screening, three-state
semantics and authoritative renderedText; chat cannot rewrite it or apply updates.
This milestone does not implement a new generative-to-tool submission relay.

## Access and operational contract

Existing `/api/v1/conversation`, version 2, accepts start with syntheticOnly:true,
then turn with an opaque receipt, message and prior user-message history. No caller
thread ID, assistant transcript, case object or attachment is accepted. Receipts use
AES-256-GCM with a domain-separated HMAC-derived existing server key. They bind the
operator, server-created session, IBM thread, ordinal, authorized window and keyed
history digest. The browser cannot inspect or select a provider thread. No raw
operator IDs, transcripts or case fields are written to operational storage.

Immutable per-turn locks and strong readback prevent concurrent/replayed calls.
Protected testing authorization can last up to seven days, with no automatic
renewal. Each receipt still expires at the earlier of the window or its original
trusted operator session expiry. Reauthentication and New conversation may be
needed sooner; the seven-day setting never extends SSO or persists chat history.
UTC daily quotas continue independently and existing tickets are never reset.
Thread ownership uses the existing immutable owner records. Only the latest message
is sent with X-IBM-THREAD-ID on continuation; earlier messages are not replayed.
Maximum 12 user turns, 1,600 characters each, 24 KiB request, existing provider
response limits, 4,000-character displayed reply. Cancellation/failure never retries;
the receipt is consumed and an explicit New conversation is required. Failed drafts
and visible history remain available. Provider refusals have a fixed safe message.

The versioned competition namespace shares its frozen daily call/session capacity
with Blue Lantern (default 50 calls/20 sessions). Each conversation start reserves a
session; each turn reserves a call before IAM. Accounting failures are fail-closed.
Historical quota records and algorithms are unchanged. New records contain only a
consumed bit for an opaque session/ordinal lock. No quota refunds or resets.

## Safety boundaries and limitations

Every supplied user turn receives the existing privacy validation. Latest, prior
and cumulative fictional reports are screened using existing approved safety rules
in a disposable screening projection, never a canonical case. A safety halt consumes
the receipt and pauses further IBM discussion; reported improvement cannot silently
erase it. Existing warnings are returned verbatim. Screens remain deterministic and
cannot detect all patient identifiers or clinical harms in arbitrary natural text.

The verified transport/parser rejects action-bearing provider output. Existing
validateDiscussion independently screens output for prohibited diagnosis/prescribing,
unsupported citations and unsafe markup. It is NOT a semantic grounding verifier.
Discussion is not promoted into approved evidence. The separate evidence service's
default-deny grounding verifier remains unchanged. IBM may execute remote tools
before returning; local rejection does not prevent those actions. Editable messages
therefore need explicit scoped operator privacy/risk authorization before activation.

## Deployment and activation (not performed by local implementation)

1. Review/authorize the local patch, commit/push to draft PR #4, verify protected
   unpublished Preview #4. No Production/public activation.
2. Separately authorize an editable synthetic-only session, including residual Live
   bindings, unexpected remote actions, retention and internal-usage risks.
3. Use competitionPreview.ps1 -Action Activate -Authorized -AcceptResidualRisks
   -EditableDiscussion. This sets the existing ORCHESTRATE_DISCUSSION_AUTHORIZED
   Deploy Preview override, preserving scopes/global/Production.
   Do not enable ORCHESTRATE_ENABLED, ENDO_DEMO_INFERENCE_ENABLED or embedded chat.
4. Operator manually rebuilds Preview #4. Authenticated GET conversation returns
   version 2 / available only for the trusted allowlisted operator and fresh window.
   This check does not reserve storage or call IAM/IBM. Anonymous, wrong-preview,
   published, expired or disabled access cannot use version 2.
5. Explicitly initiate each typed synthetic conversation. No automatic test/send.
6. competitionPreview.ps1 Disable closes the shared window/kill switch. It also restores
   the existing discussion authorization preview override to false. Manual rebuild and
   authenticated blocked GET complete runtime shutdown. Expiry alone is not cleanup.

Public competition access without an IBM login remains a separate authorization and
abuse-control decision. This implementation requires existing Preview #4 SSO and
trusted operator access; it does not introduce a public anonymous inference route.

## Local validation and exact change inventory

- 1,952 frontend/Function tests passed, including 33 new editable-conversation tests.
- Relevant backend, hosting, security and release suites: 178 passed, one private
  installation/junction test skipped; one dependency deprecation warning. A stalled
  sandbox run was stopped; the logged run in a fresh writable directory passed.
- TypeScript and production build passed. Canonical verification: 129 bindings,
  preserving the original 127 and adding the two new runtime modules below.
- All 78 reviewed claims, their source bindings, approved warning rules/wording,
  canonical schema, OpenAPI tool definitions and IBM transport/parser are unchanged.
- Tests use mocks, not additional IBM requests. No staging, commit, push or deploy.
- Existing competition shutdown was saved with Production/global values unchanged;
  operator manual Preview #4 rebuild is still needed for runtime shutdown verification.

Changed existing files:

```text
ReleaseFiles.txt
backend/competition/evaluationSeal.py
evaluation/review.json
frontend/src/App.tsx
frontend/src/GuidedFollowup.tsx
frontend/src/ResponsePanel.tsx
frontend/tests/AgentWorkflow.test.tsx
frontend/tests/EmbeddedActivation.test.tsx
frontend/tests/GuidedFollowup.test.tsx
frontend/tests/OrchestrateCompetition.test.ts
netlify/evaluation/orchestrateCompetition.ts
netlify/evaluation/reviewSeal.ts
netlify/functions/converse.ts
tools/competitionPreview.ps1
```

New files:

```text
frontend/src/EditableConversation.tsx
frontend/tests/EditableConversation.test.tsx
frontend/tests/ProtectedConversation.test.ts
netlify/evaluation/protectedConversation.ts
shared/ProtectedConversation.md
```

## Bounded discussion output and sanitized rejection categories

Provider protocol validation remains separate from the educational-discussion screen. Discussion is bounded to 16,000 characters within the unchanged 32,768-byte provider response limit. The entire answer is screened; unsafe tails are never silently truncated. References, percentages, ordinary stage terminology and harmless presentation syntax receive presentation-only formatting, never raw HTML parsing, network fetching, verification, or promotion to canonical evidence. Paragraph boundaries remain available to statement checks.

Failures expose only fixed outputStage/outputRejection or responseRejection codes. Categories distinguish length/characters, executable markup, unsafe references, secrets, actions, medication doses, patient-specific staging/risk, definitive diagnosis/exclusion and prescribing. No provider text, identifiers, tokens or exception details are returned or logged. This conservative heuristic screen does not establish medical accuracy and can still reject qualified clinical language; AI discussion remains explicitly unverified. A live retest requires separate authorization, consumes existing quota normally, and must not retry automatically.

## Conversation presentation

Only IBM assistant discussion uses pinned react-markdown and remark-gfm. Headings, emphasis, lists, quotes and horizontally scrollable tables are React elements. All generated links are inactive, images never load, and raw HTML is escaped. Only attribute-free literal br nodes become visual breaks; code examples remain literal. Original assistant/user strings, receipts, history and structured clinical renderedText are unchanged. References remain unverified and formatting grants no clinical authority. No validation or activation rule changes.

## Diagnostic exclusion qualification

The fixed diagnosticExclusion category covers exclusion predicates (ruled out, rule out, excluded). The default strict policy requires directly attached negation or insufficient-information wording, allowing bounded uncertainty modifiers and wrapped lines. Under strict policy, each predicate is checked independently; a disclaimer, earlier question or unrelated uncertainty cannot authorize a definitive exclusion. Original discussion text is returned unchanged. Direct questions require question punctuation and cannot waive an additional coordinated assertion. This remains a conservative grammatical screen, not semantic clinical verification; the fixed category does not identify the exact provider phrase and no provider text is retained.

## Section navigation icons

IBM Markdown headings are grouped into native details/summary sections, initially expanded. Pinned local Lucide SVGs are decorative and never derived from patient findings or interpreted as risk/diagnostic evidence. Exact heading aliases select history, symptoms, gynecologic history, differential, investigations, treatment, documentation and follow-up icons; unmatched titles use a neutral file icon. All icons retain the neutral Endo palette, including safety headings. Recognized safety sections and their ancestors are non-collapsible; existing approved warning alerts remain independent. Enter/Space and native pointer activation retain original headings and source text. Quoted/code headings and raw provider HTML never become controls.

## Authorized synthetic-preview clinical-language policy

The editable protected Preview #4 route uses warning-only clinical-language screening after the same trusted deployment/operator/window guard, now shared with the validator. No caller flag, header or environment-only assertion selects this policy. Patient assertions, diagnostic exclusions, diagnosis assertions/confirmation, patient-specific staging and percentage-risk heuristics emit only fixed clinicalWarnings categories. They are not findings, verification or clinical validation. The full original reply remains inspectable and unchanged; warning notices are separate from Markdown/text history. Warnings never authorize prescribing, dosing, secrets, injection, unsafe references, provider actions or oversized/invalid output. Input privacy, emergency safety-halt, session ownership and immutable quotas remain mandatory. Clinical flags are not written to logs or quota records. Legacy/default and Production validation retain strict rejection behavior. No Production activation or policy change is included.

## Standalone section-title compatibility

Section boundaries are identified structurally before icon classification. Consecutively numbered standalone titles require their own body blocks and an explicit heading/bold cue or table-outline evidence. Peer standalone bold titles are also supported. Strictly structured indented ordered outlines require a bold title and body for every item plus a table; ordinary instruction lists, prose, nested lists, quotations and table cells stay unchanged. Unknown major titles use neutral icons. Markdown heading depth preserves nested subsections. Each response starts expanded and has per-response Expand all / Collapse all controls when multiple collapsible sections exist; safety sections and their ancestors cannot be collapsed. Original source strings and numbering remain unchanged; only the derived presentation tree changes. The offline ibmHeadingFixtures.json records synthetic variants of the operator-reported visible title, not a captured provider response. Its parser assertions distinguish genuine Markdown headings, bold paragraphs and ordered-list syntax; the visible label alone cannot establish which IBM emitted.

## Protected safety-halt rationale

Only the trusted Preview #4 editable route calls protectedSafety.ts. It reuses canonical privacy validation and both existing deterministic safety modules before IAM or agent calls. A screening-only copy recognizes bounded fainted/briefly lost consciousness/passed out and sudden severe abdominal-pain descriptions, expands ordinary negative contractions and preserves explicit bullet-list assertion scope. Original clinician messages and conversation history are unchanged. Global assertions.ts, safety.ts, policy.json, structured review and clinical claims are unchanged.

The server returns fixed finding codes with latest/earlier report provenance, distinguishes actual rule triggers from additional reported findings, keeps pregnancy unknown when unconfirmed, and retains rule/source metadata and original warning wording. The UI renders this as a persistent alert independently of the collapsible chat and Markdown response. It uses fixed trusted vocabulary; malformed explanation metadata falls back to escaped original warnings. Clients cannot supply warning text or explanation fields in accepted requests. No AI-generated safety rationale is used.

BP/HR parsing accepts only bounded integer formats and omits conflicting, uncertain or noncurrent measurements. Values remain unverified, unclassified supporting observations, never numeric triggers or evidence of resolution. No hypotension, tachycardia or shock threshold/classification is added. With unknown pregnancy in the reconstructed heavy-bleeding case, heavy bleeding is the existing trigger; sudden severe abdominal pain and fainting are additional positive reports rather than invented independent rule triggers. This bounded screen is not clinical validation or comprehensive natural-language triage. Rationale, narrative, measurements and transcripts are never logged or persisted; the existing immutable consumed-turn lock, quotas, operator gates and explicit reset behavior remain intact.

## Protected discussion notice and initiation

The editable UI keeps the persistent privacy notice and no longer requires a
fictional-information checkbox. Explicit Send initiates a synthetic-only session
with the unchanged syntheticOnly:true contract. This is not new processing consent
or permission to submit identifiable information: separately approved operator
authorization, protected-preview restrictions and server privacy/safety checks
remain mandatory. Document-upload acknowledgments are separate and unchanged.
Failures, refusals and safety halts set explicit in-memory halted state; only
New conversation clears it. No automatic retry or resubmission occurs.
