# Endo conversational architecture — current status

Endo's deterministic evidence engine remains the clinical authority. **Live IBM conversation is blocked.** No configuration value alone authorizes external clinical-text transmission. The site must not describe the local fallback or mocked test responses as IBM inference.

## Current application behavior

Guided Follow-up opens a blocked IBM workspace. Check IBM connection reads only the same-origin capability endpoint; it does not authenticate to IBM or send case information. Clinicians may explicitly choose Use local fallback for bounded information collection.

The local interpreter replays original clinician turns, the active question, uncertainty and competing assertions. It is a finite grammar, not general language understanding. Topic mentions can request clarification but cannot establish symptoms. Negation, historical/hypothetical content and uncertainty must not become confirmed findings. No expanding keyword collection is presented as a semantic AI agent.

Pending observations stay in a collapsed review summary. Clinicians can continue typing without accepting updates. Included changes receive one explicit final approval; existing conflicts retain their separate resolution requirements. No-op values are not proposed again. Original narrative and reports remain intact. Reanalysis requires a separate clinician action. Clear, End, refresh, module changes and unmount discard session state as appropriate.

The desktop fallback is inline; mobile uses a focus-contained sheet. Transcript and composer use the existing responsive layout without browser persistence. Accessibility automation does not replace human screen-reader and physical-device review.

## Prepared native connection

[AgentConnection.md](AgentConnection.md) is the detailed connection specification. The server-only native-fetch adapter uses the existing IBM IAM/chat transport, strict envelopes, bounded combined deadline, memory-only token caching, cancellation and zero application retries. No SDK or external service was added.

The controller requires a trusted authenticated principal and an independent transmission policy. Its default policy denies access. The public conversation route reports blocked; start/infer/end operations are deliberately not bound to public requests. Process-local session closures are not a durable Netlify session solution.

Model output may propose discussion paragraphs and optional structured observations. It cannot select modules/evidence, approve sources, diagnose, prescribe, choose a conflict winner, mutate canonical data or trigger reanalysis. Every generated paragraph requires a trusted grounding verifier, including assertions hidden in questions or acknowledgements. The default verifier rejects all prose. JSON validity, a claim ID, source-span existence, word overlap or a model's confidence does not establish semantic truth.

The observation validator lives in shared/observationContract.ts. The runtime schema mirror shared/observations.schema.json must remain byte-identical to the original draft evaluation schema. Neither the contract nor passing mocked tests grants clinical approval.

## Privacy and hosting decision

Direct watsonx.ai inference behind Endo's first-party UI/controller is the prepared path. Orchestrate is optional for separately approved operational coordination. Existing Orchestrate assets remain unchanged and do not establish a configured or authorized hosted agent. Embedded chat has separate retention, memory, observability and authentication requirements; tenant settings have not been verified.

External messages, including fictional clinical text, require separate explicit authorization. Approve the exact minimum-necessary projection, data classification, lawful processing basis/notice or consent as applicable, organization/tenant authentication, model/project/region, provider retention/training/monitoring/subprocessors, rate/origin/CSRF controls, cancellation and rollback. De-identification alone is insufficient. No raw upload, extracted excerpt, filename, identifier or complete original case object may be forwarded by the prepared projection. Never put clinical content in URLs, logs, analytics, tracing tags or persistent conversation stores.

Only operational audit metadata is allowed under existing policy. Sensitive source turns and proposed interpretations are session-scoped review material, not application logs. Persistent clinical provenance would require a separate approved storage/retention policy.

## Approval gates and limits

Before a live test: review the grounding/extraction strategy and held-out clinical safety corpus; approve performance thresholds; implement authenticated session ownership/replay suitable for the host; verify actual IBM instance controls; and separately authorize the exact fictional test. Before deployment or broader data access, obtain the corresponding clinical, organizational privacy/security and deployment approvals. No source approval or authentic module activation follows from this preparation.

The normal backend regression suite completed without reproducing the earlier Windows native access violation. Its root cause is not established. Offline validation is not evidence of model accuracy, privacy compliance or live-agent readiness.

## Supporting specifications

- [Native connection, official IBM references and configuration](AgentConnection.md)
- [Current local fallback and confirmation contracts](GuidedFollowup.md)
- [Phase2A extraction corpus and evaluation metrics](../evaluation/understanding/Guide.md)
- [Historical synthetic dialogue rehearsal](../evaluation/understanding/Conversation.md)

The evaluation harnesses remain offline-only. Their registered fixtures, mocked transports and draft annotations are test assets, not application conversation providers. The native runtime shares the validator implementation without importing those offline harnesses.
