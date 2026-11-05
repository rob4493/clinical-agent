# Phase 2A — offline language-understanding evaluation

Status: draft for privacy, security and clinical-expert review. **Synthetic fixtures and mocked model responses only.** This is not a Watson integration, a new clinical pipeline or clinical validation. Default provider access is disabled in code and cannot be enabled by an environment flag.

## Artifacts and boundaries

- observations.schema.json: canonical draft structured-observation contract, version1.0.0.
- shared/observationContract.ts: shared strict shape, duplicate-key, module/field, reference and UTF-16 span validator; tools/understanding/contract.ts is its compatibility re-export. The runtime schema mirror must match the draft observation schema byte-for-byte.
- corpus.json:51 original fictional episodes, corpus version1.0.0, annotations draftForExpertReview. Both modules are explicit; no authentic records, source files or reviewer identities.
- tools/understanding/projection.ts: registered-fixture-only minimization. It cannot accept arbitrary cases/messages.
- tools/understanding/adapter.ts: provider-neutral suggest interface, disabled default and injected offline mock.
- tools/understanding/machine.ts: immutable offline controller intentions, never a canonical setter or analysis dispatcher.
- tools/understanding/harness.ts: bounded/cancellable mock execution, independent existing deterministic safety gate and draft metric calibration.
- acceptance.json: engineering invariants and **unapproved** clinical acceptance fields.

Executable tooling lives under tools/understanding so evaluation remains data-only. None is imported by React, the Netlify Function, FastAPI, normal startup, readiness, discovery or build preparation. Full tests deliberately execute the offline harness; builds only type-check its tests. The78 claims, source approvals, clinical wording, urgent rules, upload workflow and Orchestrate baseline remain authoritative and unchanged. The separately permission-gated native controller is documented in shared/AgentConnection.md; it shares validation code, not this offline harness. Adding these public project-authored evaluation artifacts to ReleaseFiles does not add them to the runtime review manifest or authorize their execution in production.

## Versioned observation contract

The JSON Schema is the canonical Phase2A proposal contract, not a parallel ClinicalCase model. It references the existing canonical semantics through x-canonicalSchemaVersion and x-bindings. TypeScript imports FindingState from the canonical representation; TypeScript and Python tests independently verify state equality and every mapped path. No canonical schema changes are made.

A model may return only schemaVersion, a bounded observations array and a clarification intent or null. Each observation has a stable local ID, conceptId, exact canonical fieldPath, canonical state, temporalContext, exact sourceSpans, relation and relatedIds. Concepts distinguish bowel/urinary reports even where their existing text field is shared. Only the declared module/path pair is allowed. The version supports reported pain associations, explicit pregnancy/PID status, selected reported urgent indicators and selected early-pregnancy flags. It does not extract diagnoses, probabilities, stages, medication/doses, measurements, dates, test interpretations, evidence, citations or URLs. New fields require a separately reviewed contract version.

Caps:8 observations,3 spans per observation,4 related IDs,3 clarification turn references,16KiB response, explicit enums and no extra properties. Duplicate JSON keys/IDs/facts/spans/references, unsupported modules/paths, forward/self/cross-concept links, malformed relationships and invalid spans are rejected. Offsets are JavaScript UTF-16 code units, half-open start/end; boundaries cannot split a surrogate pair. Span content must exist and be nonempty in the exact original projected turn. The validator fixes verification=needsReview outside model output; a provider cannot assert clinician approval.

Unknown, notReported, absent, present and notApplicable are distinct. Per-binding allowedStates restrict nullable early-pregnancy booleans to representable states; notApplicable is rejected there rather than coerced to false/null. Not every canonical flag/state is executable by the current legacy analysis bridge; any future patch mapper needs a separate compatibility review. Historical/hypothetical positive observations do not become current positive flags. Corrects/clarifies/contradicts references preserve the earlier observation; they never choose which assertion is true. Existing canonicals may represent reported symptom context as text, but this draft contract does not serialize or apply that text into cases.

Schema and span validity **do not prove semantic support**. The tests deliberately show that a negation flip can satisfy structural validation and must be caught by annotation comparison and human verification. No model confidence is treated as truth. Phase2A has no semantic-entailment oracle and no canonical update function.

Version rule: changes to fields, bounds, state meaning, temporal interpretation, projection content or authority require a new reviewed contract version and updated test corpus. Annotation-only revisions receive a new corpus version after initial review/release. Contract/corpus semantic JSON digests in the run report identify inputs; they are not publication hashes, clinical approvals or trusted source-document signatures.

## Minimal input projection

Current input is projectionVersion, explicit moduleId, bounded questionId and a list of turn IDs/text. There are at most6 turns,512 UTF-16 characters each and2048 characters total. Only registered synthetic fixture IDs can create a projection. The builder reconstructs these exact keys instead of deleting forbidden fields from an arbitrary case. It performs existing identifier checks and additionally rejects exact dates and measurements under this initial projection policy. Context is only the bounded turns and a server-defined question concept; no complete canonical snapshot is given to the model.

Excluded: original complete narrative, demographics, age range, uploads/excerpts, filenames, document metadata, source files, evidence, claim IDs, clinical response, URLs, credentials, reference annotations and local-only safety snapshots. The corpus's local caseInput is used only by the existing deterministic safety engine. Some local Module2 snapshots contain explicitly fictional gestational context to exercise the unchanged engine; that numeric context is never projected or inferred from silence. A separate missing-gestation episode verifies clarification behavior.

A synthetic marker is not de-identification or permission to transmit. Three deliberately non-projectable fictional fixtures calibrate identifier/date/measurement rejection. Their inclusion is a privacy test, not permission to send such content. Current code has no external sender; there is no clinical-text authorization path. Future real-message projection requires separate organizational approval and a separately reviewed builder, not a forged synthetic marker.

## Adapter interface and execution policy

LanguageUnderstanding.suggest(readonlyProjection, AbortSignal) returns raw proposal JSON only. The adapter has no case setter, claim selector, evidence retriever, tool dispatcher or analysis callback. DefaultUnderstanding always rejects with a fixed error. Current evaluation accepts only an explicitly injected offlineMock, not an environment-selected provider. Mock code is trusted test code, not a sandbox for arbitrary plugins; tests block network constructors and assert zero attempts.

One invocation, no retries,1–1000ms mock deadline (default100ms), injected clock, abort propagation and cleanup. An uncooperative mock is bounded by a cancellation/deadline race. Timeout, cancellation, malformed/empty/refused/tool-like output and exceptions yield fixed operational statuses without provider bodies or exception messages. No rejected JSON is repaired. No content is logged or persisted by the harness. Concurrent evaluations retain no shared case state.

Future watsonx.ai work may implement the interface behind separately approved networking and privacy controls. It must not reuse the opaque-ID presentation transport for clinical text. IBM authentication, SDK/native HTTP, model configuration, retention, organizational access and live tests are not implemented here. No production feature flag can turn this phase into a sender.

## Explicit controller state machine

| State | Trusted event | Result / boundary |
|---|---|---|
| idle | clinician activate | question |
| question | validated adapter suggestion | proposal, clarification, or conflict; no data mutation |
| question / clarification / proposal | clinician answer | question awaiting another validated proposal; original assertions retained |
| clarification | clinician skip | pending information remains unresolved; review only through explicit controls |
| proposal | clinician review IDs | review; only existing current observations can be selected |
| review | clinician confirm | confirmed intention, not an applied case |
| confirmed | clinician reanalyze | reanalysisRequested intention only; no call to analyze |
| conflict | request verification / keep unresolved | conflict remains; neither model nor this controller selects truth |
| any active state | deterministic urgent or source-coverage halt | urgentPaused; optional review/confirmation blocked |
| any state | clinician End | ended; proposal and selected/reviewed information cleared |

Only controller-created immutable sessions and validator-created proposals are accepted. Sessions require explicit module selection and retain a bounded active-question concept/intent; cross-module proposals and question concepts are rejected. Adapter events cannot confirm, request analysis, choose evidence, change modules or declare urgency. New suggestions cannot omit or rewrite earlier observations. A current positive/negative contradiction produces a conflict regardless of the model's clarification intent. Historical versus current data are preserved without automatically adjudicating their relationship. Empty proposals remain questions; they are not updates. Future integration must also compare proposals with the current canonical snapshot for no-ops and obtain explicit clinician authorization before any write; Phase2A intentionally has no write capability. End retains only safe event-type trace metadata, not observations or text. These immutable examples are process-local, not a deployed serverless session service. Validator/session brands intentionally do not survive serialization. Future Netlify integration must reconstruct trusted state from authenticated, bounded replay and revalidate module/question/source invariants; storing transcripts to solve continuity needs separate approval.

## Corpus and annotations

The51 cases cover both modules with varied ordinary wording, coordinated observations, negation, all five states, typos, context, correction referents, contradictions, historical/hypothetical data, no-op input, unknown stability, missing gestation, supported urgent combinations, CDC duration/access boundaries, unsupported tests/prescribing, prompt injection, quoted template text and Unicode spans. Expected extraction labels are project-authored draft annotations, **not clinically approved ground truth**. No claim from an authentic publication is added. Clinical-expert adjudication and a held-out corpus are required before any model performance claim.

Reference responses are mocked exact annotations, deliberately not a local-NLU model. Their role is to validate the harness itself. A reference score of1.0 does not measure Watson, generalization, clinical accuracy or readiness. Adversarial mutations independently demonstrate missed facts, invented fields/facts, negation flips, temporal broadening, urgent misses, unauthorized update commands and invalid outputs.

## Metrics and interpretation

- correctExtractions: exact concept, canonical path, state, temporal context, source spans and relationship match.
- missedFacts: expected annotated observations not exactly recovered.
- inventedFacts: a structurally valid concept absent from the draft annotation.
- unsupportedInterpretations: a known concept with altered state, temporal/source/reference meaning.
- incorrectNegation: present/absent polarity reversal against a draft annotation.
- missedUrgentFacts: missed current positive annotated urgent indicators.
- urgentWarningFailures: a trusted gate result differing from the fixture's required warning or source-coverage halt.
- inappropriateUpdateProposals: a semantically mismatched current proposal that would be unsafe to treat as an update, or an attempted forbidden authority command. Actual canonical writes remain zero because there is no setter.
- invalidOutputs, clarificationErrors, privacyFailures and gateAnnotationMismatches: separate structural, conversational, projection and annotation-alignment counts.

Precision=correct/predicted; recall=correct/expected; zero denominators report null. Metrics may overlap and must not be summed as a count of distinct incidents. Exact-span scoring is deliberately strict; clinically equivalent alternative span annotations need expert adjudication. Unknown output concept IDs are structural rejections, not invented-fact matches. All model invocations in this harness are fakes, including urgent-fixture extraction probes. A future live controller must run existing urgent/conflict gates first and skip provider calls for those cases. The independent urgent gate uses the existing deterministic engine and existing public packages; a model omission cannot suppress that gate. Missed urgent extraction and warning failures are separate measures. Calibrated bad-gate injection proves that the warning metric is not silently constant zero.

The ordinary gate category means no urgent/conflict/clarification halt; it does not claim evidence sufficiency or successful clinical analysis.

Reports contain only fixture IDs, statuses, counts, versions and semantic digests, never turns, spans/excerpts, proposals, prompts or model payloads. No report is written automatically; the returned object can be inspected by authorized offline tooling. Do not snapshot raw fixtures/model outputs into release reports or logs.

## Draft acceptance and remaining gates

acceptance.json marks clinicalThresholdsApproved=false and leaves clinical precision/recall, per-module recall, temporal and clarification thresholds null. Proposed critical-review triggers are listed, not represented as validated thresholds. Engineering invariants require zero external calls, canonical writes, automatic analysis dispatches, model evidence authority and private-source reads. Passing those invariants is not clinical approval.

Before Phase2B: clinicians review/adjudicate schema meanings, annotation provenance, temporal/correction semantics, per-module coverage and failure severity; approve a held-out synthetic corpus and performance thresholds; review privacy/security and exact minimized projection. Before any external clinical-text transmission (including fictional clinical text under the present restriction): separate explicit authorization, organization-approved processing basis/consent/notice, authenticated/authorized access, provider/model/API/region/retention/monitoring terms verified for the actual instance, deadline/cancellation/logging controls, incident response and rollback. Before any deployment: separate clinical usability/safety evaluation and production approval. No source approval, authentic module activation or Orchestrate modification follows from Phase2A.

## Reproducible offline commands

From the repository root, using already installed declared dependencies:

```powershell
npm --prefix frontend test -- tests/Understanding.test.ts
.venvMilvus\Scripts\python.exe -B -m pytest -q tests/unit/testUnderstanding.py
npm --prefix frontend test -- --maxWorkers=1
npm --prefix frontend run build
.venvMilvus\Scripts\python.exe -m pip check
npm --prefix frontend ls --depth=0
.venvMilvus\Scripts\python.exe -B -m tools.reviewReseal
```

The last command is read-only. Offline-only harness edits do not require runtime resealing; changes to bound runtime or presentation files require the documented deliberate maintenance process. Do not install an IBM SDK, enable provider flags, invoke a live model, or import this harness into the application while running these commands.
