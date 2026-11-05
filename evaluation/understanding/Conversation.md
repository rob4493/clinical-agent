# Historical conversational rehearsal — offline only

Scope: this document describes the synthetic mocked protocol and controller under tools/understanding, not the native runtime. The current server architecture and blocked capability endpoint are documented in [AgentConnection.md](../../shared/AgentConnection.md). These offline tools have no native-fetch default or deployment role. A simulated response must never be presented as Watson inference.

## Separation of responsibilities

`tools/understanding/dialogue.ts` defines a replaceable language agent, pure IBM chat-request preparation and a closed discussion/optional-observation envelope. A response need not extract anything. The model can choose discussion, clarification, a summary intention or an offer to review. Multiple observations retain the Phase2A schema, original turn spans, temporal context and uncertainty. Neither the envelope nor controller has a canonical setter, conflict winner, evidence selector, update-confirmation authority or analysis-dispatch callback.

`agentSession.ts` owns immutable session history in a server-compatible closure. Registered synthetic turns are replayed with validated assistant context. Topic changes do not require accepting an update or answering a fixed questionnaire. A clinician can request review later. Suggestions remain needsReview; no automatic confirmation is implemented. The existing application confirmation and separate reanalysis paths remain unchanged. End clears history and proposals, aborts in-flight work and prevents a late response from restoring them. Errors retain previous context, not partial generated output. Concurrent calls in one session are rejected; distinct sessions are isolated.

Every turn screens both the original fixture and the augmented message through existing deterministic analysis. This prevents a question from erasing a previously detected warning. The host can supply an additional conservative safety halt, never downgrade the built-in gate. Emergency, conflict, clarification and source-coverage outcomes pause optional inference. Existing clinical-rule coverage is unchanged; this is not a new semantic urgent detector. Ambiguous symptoms beyond current coverage still require expert evaluation. In particular, the synthetic Correction test supplies an explicit trusted conflict halt; it does not claim the existing deterministic engine understands every correction sentence.

## Evidence and conversational freedom

Only exact complete mappings returned by the existing reviewed-presentation projector, or complete public claim statements already selected by deterministic analysis, become discussion topics. Claim IDs and citation numbers are reconstructed by Endo. A shared source alone cannot authorize a different claim. Cross-module or arbitrary caller-created topic arrays are rejected. Novel evidence, diagnoses, treatment statements and model-supplied citations cannot pass the validator.

**Known product gap:** this does not certify unrestricted fresh medical paraphrases. No semantic-equivalence validator currently proves that arbitrary new prose preserves population, test, threshold, action, uncertainty and qualifications. Such prose is rejected, not approved using keywords or similarity. Medical explanations use existing reviewed wording, while bounded conversational acts permit acknowledgement, topic exploration, uncertainty and natural limitations. Consequently this rehearsal does not yet deliver the full requested free-form AI experience. A separately reviewed approach to grounding fresh language and a clinical safety evaluation remain necessary. The implementation does not disguise this limitation as a genuine live AI assistant.

Summaries may choose supported topics and retain previously validated proposals. There is no free-form clinical summary authority and no conversion of an unknown state into a negative. The browser's new collapsed recap shows exact clinician statements, explicitly unverified, rather than an invented interpretation.

## IBM protocol and privacy gate

`watsonAgent.ts` prepares the real IAM and `/ml/v1/text/chat` HTTP shapes behind an injected, registered mocked transport. It has **no native-fetch default or runtime import**. `WatsonAgent` is unconditionally disabled, independent of existing Watson presentation settings. This is deliberately stronger than a default-off environment variable: enabling existing presentation mode cannot transmit clinician messages. The mock-registration seam is trusted test code, not a sandbox for arbitrary JavaScript.

Only repository-registered fictional projection/history is accepted by the offline adapter. Allowed input: version, explicit module, bounded synthetic turns/question context, validated prior discussion, server-selected public wording and claim IDs, canonical observation definitions and fixed instructions. No original case object, additionalNotes, demographics, uploads, excerpts, filenames, document metadata, exact dates or measurements is projected. Authentic clinician messages are not accepted. Calling request preparation creates no connection.

Protocol controls: exact IAM auth type; official HTTPS endpoint allowlist; external configuration, never browser credentials; redirect:error; credentials:omit; JSON mode; one choice with stop completion; duplicate-key rejection; 32 KiB request/response caps; 16 KiB structured content; 1,024 output tokens; zero retries; one combined 100–12,000 ms operation deadline; abortable body reads and transport; memory-only expiration-aware IAM caching; shared refresh isolated by waiter count. Provider metadata is bounded and discarded. The default controller additionally denies inference unless an explicit trusted synthetic safety gate permits it. No payload/error logging or persistent transcript exists.

## Interface changes in the running app

Guided Follow-up opens the blocked IBM workspace; local collection is an explicit fallback choice. Its original-statement recap and pending changes are collapsed, and selected case changes receive one final approval. It does not call this offline rehearsal or simulate IBM inference. Current behavior and compatibility contracts are documented in [GuidedFollowup.md](../../shared/GuidedFollowup.md).

## Testing and interpretation

`dialogue.json` registers fourteen fictional discussion experiences, including the requested questions, informal wording, context, uncertainty, correction, injection and an unsupported urgent-coverage case across both modules. Existing 51-case extraction annotations remain unchanged. `Agent.test.ts` exercises mocked protocol, discussion without extraction, optional review, failure, authority limits, malformed output, privacy, concurrency and cancellation. `AgentUi.test.tsx` checks accurate labeling, recap, keyboard interaction, End cleanup and no persistence. Passing mocks verifies software wiring, not model quality, clinical accuracy or expert-approved annotations.

Run from the root:

```powershell
npm --prefix frontend test -- tests/Agent.test.ts tests/AgentUi.test.tsx --maxWorkers=1
npm --prefix frontend run build
.venvMilvus\Scripts\python.exe -B -m pytest -q tests/unit/testUnderstanding.py
```

## Remaining authorization and architecture gates

1. Clinical experts must approve the observation semantics, multi-turn corpus, clinical explanation bindings, held-out cases and performance thresholds. Phase2A thresholds remain draft/null.
2. Approve a method for validating fresh clinical wording; existing exact mappings are the present safe limit.
3. Organizational privacy/security review must approve the exact minimized transmission, lawful basis, clinician notice/consent as applicable, tenant authorization, retention, monitoring, subprocessors, model/region and agreements. De-identification alone is insufficient. Public anonymous access is not authorization.
4. Approve an authenticated session/replay design for Netlify. The closure is intentionally process-local and not durable across serverless instances. Do not persist sensitive transcripts to solve this without separate approval. Define limits, idle expiry, ownership, CSRF/origin protection, rate limits and cleanup.
5. Separately authorize even fictional-text IBM inference, a native transport binding, operational IAM testing and monitored rollback. No external inference was performed here. Deployment/production enablement requires another review.

Orchestrate remains optional operational coordination, not the chat authority, evidence engine or canonical editor. Existing Orchestrate assets are unchanged.

Official protocol references checked 4 November 2026: [IBM watsonx.ai API](https://cloud.ibm.com/docs/apis/watsonx-ai), [IBM JSON-mode documentation](https://ibm.github.io/watsonx-ai-node-sdk/interfaces/1_4_x.WatsonXAI.TextChatResponseFormat-1.html). These describe transport/format behavior, not permission to process clinical data. Existing organizational and provider-retention review gates in shared/ConversationalAgent.md remain unresolved.
