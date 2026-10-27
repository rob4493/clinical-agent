# Controlled reviewed presentation

The deterministic evaluation engine is the sole clinical authority. This disabled-by-default, Netlify-only mode allows selection and arrangement of repository-authored public display wording, not generative clinical paraphrasing. Authentic sources remain pending review; evaluation summaries are not approved for patient care. FastAPI remains deterministic and compatible without this optional field.

## Flow and contract

1. The Function validates input and completes deterministic conflict, urgent, retrieval, synthesis and citation checks.
2. It verifies the full evidence/review state before the provider boundary.
3. `offerPresentation` requires complete exact statement/source coverage. Unknown, changed, case-specific or partly mapped statements skip Watson for the whole response. Urgent warnings, prescribing-prefaced responses, conflicts, clarification, insufficient evidence, unavailable and outside-scope responses are ineligible.
4. Each eligible finding has a stable presentation ID, an approved variant ID, exact wording and exact claim IDs. This initial release has one variant per finding: selection is mandatory and exhaustive; only complete ordering/grouping may vary. IDs derive from module ownership, wording and claim bindings. The module ID is not sent.
5. IBM receives only `presentationVersion`, `findings` and `outputSchema`, plus fixed selection instructions. Findings contain `presentationId` and `variants`; a variant contains `variantId`, `claimIds` and `text`. No narratives, structured case values, demographics, measurements, dates, uploads, excerpts, filenames, document metadata, reflected case statements, source files, source IDs, official URLs or browser citation numbers enter this user message. Model/project identifiers remain only in IBM's required private server request envelope.
6. Model JSON must be exactly `{presentationVersion, paragraphs}`. There are one or two paragraphs, each exactly `{selections, claimIds, text}`. A selection is exactly `{presentationId, variantId}`. Every supplied finding must occur once, without duplicates or omissions. Text must equal the selected exact variant strings joined with one ASCII space. Claim IDs must equal the unique sorted union. Unknown properties, IDs, changed qualifications, new prose, URLs or extra claims fail validation. Duplicate JSON keys are rejected before validation. No repair, trimming, approximate matching or model-confidence assessment exists.
7. The server reconstructs accepted text from repository variants and maps claims to the already-returned source numbers. It does not return provider prose or provider metadata. The existing deterministic envelope is unchanged, with a separate optional sibling field: `reviewedPresentation: {presentationVersion: "1", paragraphs: [{text, numbers}]}`. IDs and claim bindings remain server-only. Official links remain solely in the existing source projection.
8. A second full provenance check runs after Watson. A stale package never returns an accepted presentation.
9. React validates the optional public shape, plain text and cited source numbers. Invalid optional content is ignored. Accepted paragraphs replace only the existing Summary wording beside the relevant visual, without another results section. Technical evidence, follow-up questions, limitations, scope boundaries, sources and the fixed notice remain in their existing locations. Urgent-first behavior and upload review are unchanged.

## Module 2 coverage inventory

`shared/reviewedVariants.json` adds 17 exact statement bindings: six existing synthesized atoms plus eleven project-authored public singleton statements. Three synthesized atoms already had shadow mappings; reviewed mode deliberately uses the complete mapped wording (including the assessment-urgency qualification) rather than shortening a qualification away. Eleven distinct nonurgent claim IDs cover every ordinary statement the current `retrieve2` / `pregnancyAtoms` path can return. Grouped brief/detailed responses are recognized only by complete coverage, never keywords.

| Existing claim IDs | Deterministic route / reviewed eligibility |
| --- | --- |
| M2NSymptoms, M2NPainAssessment | Early-pregnancy pain/bleeding and assessment-context pair; bleeding-only singleton remains eligible. Overall-presentation urgency retained. |
| M2NPulDefinition, M2NPulPossibility | Positive test plus specified transvaginal no-pregnancy findings; unresolved location and uncertainty retained. No inference from missing tests. |
| M2NEmptyUterus | Exact empty transvaginal-scan proposition; other scan findings and clinical context retained. |
| M2NHcgLocation | Unresolved-location serum-hCG limitation; not generalized to other tests. |
| M2NSerialLimits, M2NSymptomsOverHcg | Serial-hCG/location and changing-symptom limitations; no viability inference or individual schedule. Triple combined with M2NEmptyUterus is mapped separately. |
| M2NSingleScan | Incomplete very-early scan uncertainty about pregnancy loss; no diagnostic guarantee. |
| M2AIndeterminateHcg, M2ASerialScope | Initial stable emergency-department indeterminate transvaginal-scan context; no individual serial schedule and no implication against serial testing. Existing population/exclusion gates remain authoritative. |
| M2ANoCutoff, M2AUltrasoundMethod, M2NAlternativeScan, M2NPulReturn | Not selected by current ordinary retrieval. No new route or evidence eligibility added; intentionally unmapped. A future runtime change must add reviewed coverage explicitly. |
| M2NImmediateAssessment, M2NUrgentReferral | UK immediate-assessment/instability pathways: urgent-only, always skip Watson. |
| M2EctopicEmergency | Bounded FAQ urgent-symptom action: always skip Watson. |
| CDCFaintingCare, CDCPersistentDizzinessCare, CDCEmergencyAccess | Exact current-pregnancy/current-symptom/duration/access gates remain deterministic; urgent-only, always skip Watson. |

Singletons without a separately reviewed short translation retain their exact existing public wording. Jurisdiction, population, uncertainty, test context and exclusions remain bound to original claims and existing source details; this layer does not expand clinical scope. Negative or uncertain pregnancy testing, unsupported warning-action patterns, prescribing, injection, conflicts, clarification, scope failures and insufficient evidence remain intentionally ineligible. The three supported ordinary presets (brief, detailed, serial) are eligible; both supported urgent presets and all five remaining halt/unsupported presets skip.

## Protected-preview configuration and rollback

No environment changes are made by this implementation. For an explicitly authorized protected Deploy Preview, retain the established server-only IAM key, project, official HTTPS regional URL, model, API date and `WATSONX_AI_AUTH_TYPE=iam`. Set `WATSONX_ENABLED=true` and `WATSONX_PRESENTATION_MODE=reviewed` in that preview context only. The validated `WATSONX_AI_TIMEOUT_MS` integer range remains 100–12000 ms (default 1500). Never prefix these names with `VITE_`, put values in source control or print them. Production remains disabled until separately authorized.

- `shadow`: calls IBM, requires canonical exact-output conformance and discards output; existing deterministic body stays byte-identical.
- `reviewed`: calls IBM and displays only fully validated repository variants, with server-created citations in the optional field.
- Disabled: omit `WATSONX_ENABLED` or set it exactly `false`; no IAM/model calls occur. Malformed enabling/configuration fails safely.

Immediate rollback: set preview `WATSONX_PRESENTATION_MODE=shadow` to retain connectivity checks with deterministic display, or `WATSONX_ENABLED=false` to stop calls. Apply hosting-context changes through the normal protected release process. The React UI requires no provider setting or code change. A provider/configuration/JSON/validation/deadline failure automatically returns the complete deterministic response without an error panel.

Status header vocabulary is `skipped`, `shadow-success`, `shadow-fallback`, `reviewed-success`, `reviewed-fallback`. Only the two fallback statuses carry `X-Endo-Watson-Reason`, using the existing nine bounded categories. No error message, endpoint, HTTP code, prompt, token or provider payload is exposed.

## Operational and rollout limits

Native server fetch, official HTTPS validation, redirect rejection, memory-only expiration-aware IAM cache and isolated refresh waiters are reused. IAM/model share one bounded operation deadline, under the fifteen-second Function budget with at least a 1000 ms response reserve. Cancellation aborts transport; a disconnected client receives no clinical response. There are zero application retries. Health, readiness, import and discovery never call IBM. No clinical/provider logging is added.

All 78 claim bytes are unchanged. Review seals include the new vocabulary, validator and public rendering boundary; changes invalidate evaluation status until deliberately re-pinned and tested. Source documents remain excluded. Before Production activation, require human review of new display mappings, protected-preview testing with representative cases, IBM retention/telemetry review, latency/cost observation without payload capture, and separately authorized environment/release changes. A validated selection demonstrates exact vocabulary conformance, not diagnosis, clinical validation or general reasoning ability. One-variant selection may add latency without changing wording; unsupported mappings deliberately retain deterministic display.
