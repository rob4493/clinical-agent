# Guided Follow-up â€” current workflow and compatibility

Deterministic analysis, evidence eligibility, clinical wording, conflicts and urgent warnings remain authoritative. Live IBM conversation is blocked. [AgentConnection.md](AgentConnection.md) describes the prepared native connection and its remaining approval gates.

## Entry and provider status

Supported analysis, missing-information and supported clarification outcomes can offer Guided Follow-up. Activating it opens an honest blocked-agent workspace. Check IBM connection queries only GET /api/v1/conversation; no message, original case or IBM credential is sent. Use local fallback explicitly opens the bounded local collection interface. The fallback is not model inference.

Conflicts open the existing clinician conflict-review interface. Scope questions return to explicit module/question selection. Technical failures return to the case. Triggered warnings and urgent source-coverage limitations remain first and must not be delayed by optional conversation. More information cannot replace unavailable evidence.

Nothing opens or invokes a provider on Analyze or initial rendering. The desktop panel is inline; mobile uses a focus-contained modal. End returns focus to the entry control. Clear, refresh and unmount discard component state and cancel active work. No browser persistence or analytics is added.

## Typed local fallback â€” version4

The server replays bounded original clinician turns, active question references, pending uncertainty and opposing assertions. Clients cannot supply trusted assistant roles, interpreted values or pending topics. Every turn passes existing privacy and malicious-input checks. The source narrative and uploaded material remain unchanged.

A topic mention may route a clarification but cannot assert a finding. A short answer is meaningful only against a known question. Historical/hypothetical language, uncertain polarity and ambiguous referents remain unresolved. Limited qualifier spelling repair never repairs clinical terms, negation or uncertainty into a positive finding. Explicit corrections retain competing assertions rather than making the latest statement true.

The finite grammar supports only its reviewed vocabulary. It cannot answer unrestricted medical questions. New language coverage requires review; broad regex expansion is not a substitute for language understanding.

## Optional case changes

Proposals stay inside Pending case changes (N), collapsed by default. Clinicians may keep talking without opening it. Each item retains its original value and proposed wording. Include checkboxes allow exclusions; Edit answer returns the original turn to the composer. Already documented values offer no duplicate update.

Apply selected changes is the single final approval. The server replays and validates the selected IDs; arbitrary client values, fields and IDs cannot become canonical changes. Unresolved clarification and competing assertions continue to block application under existing rules. There is no per-observation confirm/reject ladder or duplicate final verification.

Successful application uses the existing acknowledgement and leaves the previous analysis intact. Reanalyze case is a separate clinician-triggered operation. The session change review is not an EHR audit record or document authentication. No original report, narrative or conflicting assertion is deleted.

Symptom observations append bounded interpreter-authored wording to existing reportedContext fields. Pregnancy/PID retain distinct present, absent, unknown and notReported meanings. Unknown is never false; symptoms alone do not establish PID status. Numeric or unsupported context returns to the existing structured form rather than being inferred.

## Structured choices â€” version2

The closed choice vocabulary remains in shared/followupModes.ts and the server recomputes eligibility for every request. Reviewed answer submission produces a proposal; one final Confirm case update applies it. Decline leaves values unchanged. The version3 single-message path remains a compatibility boundary; version4 is the current typed replay path. The old version1 free-text request is rejected.

An explicitly enabled version2 Watson choice adapter may receive only opaque public module/mode/question/choice/acknowledgement IDs. Its transport independently validates the closed projection before IAM. Typed version3/4 turns have no provider transport. The new native conversation role is separate, blocked and cannot be enabled by the existing presentation/guided flags.

The opaque-choice transport requires exact true for both WATSONX_ENABLED and WATSONX_GUIDED_FOLLOWUP_ENABLED, with WATSONX_GUIDED_FOLLOWUP_MODE=reviewed. Defaults remain disabled. These settings never authorize typed conversation transmission.

No typed notes, uploads, excerpts, filenames, demographics, measurements, source URLs, case objects or patient identifiers enter the opaque-choice adapter. Existing envelope validation, duplicate-key protection, bounded deadlines, memory-only IAM caching, cancellation, zero retries and sanitized failures remain required. Provider failure cannot apply a change or alter the existing clinical result.

## Conflict and emergency boundaries

The existing conflict dialog preserves verified source-labeled assertions when available, or honestly labeled submitted structured/free-text statements otherwise. Selecting local handling and applying a canonical correction remain separate under that existing conflict-specific workflow. The optional-case-update simplification does not relax it. Endo and IBM cannot decide which assertion is true.

New urgent findings are screened by the existing deterministic engine before routine interpretation or confirmation. Unconfirmed status and symptoms from different turns are considered by the existing safety preview. A supported warning interrupts optional questioning. Unsupported urgent-action coverage retains the sanitized limitation without invented instructions or partial routine analysis. Urgent content stays outside disclosures.

The 78 claims, clinical source bindings, module lifecycle status, upload protections and Orchestrate baseline remain unchanged. See [current architecture](ConversationalAgent.md) for privacy, authentication and live-inference gates.
