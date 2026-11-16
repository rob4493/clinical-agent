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
