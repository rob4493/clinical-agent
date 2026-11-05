# Watson conflict assistance and dialog refinement

This separate Netlify server-only path is disabled by default. It does not resolve a discrepancy, select a report, diagnose, suggest treatment or produce clinical prose. Ordinary shadow/reviewed presentation still skips conflicts and retains its existing strict validators. FastAPI retains its deterministic conflict halt; this optional assistance is specific to the Netlify runtime.

## Explicit configuration

Use the existing Watson IAM key, project, official service URL, model, API version and bounded timeout settings. Add only `WATSONX_CONFLICT_ASSIST_ENABLED=false` and `WATSONX_CONFLICT_ASSIST_MODE=reviewed`. Both this feature and `WATSONX_ENABLED` must be exactly `true` to make a request; reviewed is the only supported conflict mode. No browser setting can enable it. No settings were changed in Netlify or IBM and no live provider call was made during implementation.

The shared server runtime in watsonShadow.ts owns one expiration-aware in-memory IAM cache with isolated cancellation waiters. The ordinary and conflict entry points use the same official HTTPS/redirect policy, 32 KiB strict provider envelope, duplicate-key detection, finish-reason/message/token validation and 100–12000 ms combined IAM/model deadline. The Function retains its 15000 ms total budget and 1000 ms response reserve. There are zero retries. Import, startup, builds, health, readiness and discovery never authenticate or generate. Browser/client cancellation aborts transport and returns no partial clinical response.

## Eligibility and privacy

Only a privacy/schema-validated, actual analysis request matching the existing six-field synthetic pregnancy-conflict legacy fixture is eligible. The deterministic result must be a successful DataConflict halt for pregnancyPossible, in Module 1, with no warnings. The exact signature includes brief, age range 25-34, pregnancyPossible=false, PID=null and the unchanged fixed narrative. Extra keys, canonical upload payloads, document-derived additions, injections, different narratives, unsupported concepts, other outcomes and urgent cases are skipped. The signature proves equivalence to the demonstration input, not report authenticity or a cryptographically authenticated fixture selection.

The projector checks the input locally and copies only static reviewed fixture metadata into a fresh object. The adapter independently compares this object with its canonical reviewed offer before transport. No raw input object is spread into a model request. IBM receives contractVersion, a server-created stable conflictId, supported concept ID/reviewed label, opaque R1/R2 source IDs, generic synthetic labels, canonical present/absent values, supplied final-report status/context and the repository-owned summary/question offer. The initial fixture supplies no dates or methods, so none are sent. No raw narrative, uploads, excerpts, filenames, identifiers, demographics, browser document references, measurements, images, official URLs, existing citations, clinician notes, source statements or arbitrary instructions are sent. Service credentials/project/model remain confined to their required server-side IAM/request envelopes.

The initial input definition is in netlify/evaluation/conflictAssistance.ts; static synthetic report metadata is shared/conflictFixture.json. No arbitrary medical-document extraction was added. All 78 clinical claims and existing clinical wording/source bindings are unchanged. New shared/conflictAssistance.json wording consists solely of organizational discrepancy summaries and verification questions, not new medical guidance or evidence approval.

## Opaque output and display

The model returns exactly contractVersion="1", the supplied conflictId, one supplied summaryVariantId and one or two unique supplied verificationQuestionIds. Extra/missing properties, duplicate JSON keys, unknown IDs, duplicate IDs, source-choice/resolution properties, provider prose, refusal/tool calls, truncation and unrecognized finish reasons are rejected. Wording is reconstructed on the server from the repository catalog; the browser verifies the exact public projection before displaying it. Watson cannot alter report cards or available resolution options.

Only validated assistance adds the optional `conflictAssistance` envelope field. Below the original cards, the dialog can show Watson-assisted verification questions and the note: These questions may help review the discrepancy. Endo does not determine which report is correct. Every failure silently preserves the complete deterministic workflow and byte-identical base response body. The only additional diagnostic is X-Endo-Watson-Conflict with skipped, reviewed-success or reviewed-fallback. No provider error detail, status, payload, endpoint or credential is logged or exposed.

## Interface and resolution boundaries

Report/source labels replace user-facing assertion terminology. Normalized values remain internal. Options use actual source labels, are grouped, and require Continue to confirmation followed by explicit confirmation. Original reports are preserved. Header and action footer remain fixed within the modal while its body scrolls; keyboard focus trapping, Escape, return focus, semantic groups and mobile stacking remain.

The shared contract retains all seven choices. The current two final reports have no distinct dates/methods/contexts or correction relationship, so only Use Synthetic report A, Use Synthetic report B, Keep unresolved and Request additional verification appear. Changed-over-time requires explicitly known non-overlapping date extents; missing/unknown dates and approximation without a known interval do not qualify. Different-context requires differing confirmed contexts or two supplied differing methods. Corrected/superseding requires supplied amended/corrected status or a valid explicit relationship. These options never select a medically correct source or authorize reanalysis. Optional local resolution notes remain predefined and never go to IBM. Automatic reanalysis remains unimplemented and analysis stays paused until the case is explicitly updated.

## Dependency remediation

Official npm metadata and machine-readable audit identified jsdom@30.1.2 -> undici@8.11.2, affected >=8.0.0 <8.12.2. First fixed 8.12.2 satisfies jsdom's ^8.11.2 range and requires Node >=22.19.0, compatible with project Node 24.21.0. Only the existing undici lockfile version, official registry URL and integrity value changed. No direct pin, dependency name, override or force flag was added; npm ci ran with scripts disabled. The audit after repair reports zero vulnerabilities.

This npm undici is development-only via jsdom and is not imported by the React bundle or Netlify Function. jsdom's external-resource/fetch paths are the relevant former exposure; application tests use mocked transports and block unintended requests. Native Node server fetch uses the host's own bundled implementation; patching this development dependency does not attest to the host runtime's internal HTTP implementation. Continue supported Node/runtime maintenance independently.

## Validation and release

Use ordinary frontend test/build preflight and complete backend tests, then dependency audits, source-only exports and guarded browser checks. Changes to these runtime files/catalogs deliberately invalidate evaluation integrity. Use only tools.reviewReseal's explicit reviewed maintenance command after source review; no build/startup hook refreshes pins. The feature remains disabled pending separately authorized mocked/protected-preview acceptance. No commit, push, merge, deployment, production setting or authentic module status change is part of this task.
