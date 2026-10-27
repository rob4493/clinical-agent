# Netlify watsonx.ai presentation shadow adapter

This is a server-only, disabled-by-default integration path. No IBM request, credential, deployment or model enablement was used to implement it. The deterministic analysis, visual Summary, upload review and 78 clinical claims remain authoritative and unchanged. Authentic sources remain pending review; no clinical approval is implied.

## Flow and egress boundary

The Function validates the request, performs deterministic analysis and citation construction, and verifies the full reviewed package state. Only then can the presentation projector run. It recognizes complete, exact source-bound public mapping atoms; mixed, unknown or case-specific text causes the whole shadow operation to be skipped. It verifies the selected module, public claim IDs and returned source coverage. Up to ten facts are generated with request-local F1/F2 identifiers, fixed public patient-friendly wording and approved evaluation claim IDs. Facts are discussion propositions, not assertions that a patient has a diagnosis or symptom. No case object is accepted by the projector or transport adapter.

The model receives only a requiredOutput wrapper containing the canonical public presentation plus fixed copy-only instructions. The internal Presentation retains moduleId and findings for eligibility validation, but those fields are not sent to IBM. IAM credentials and model/project configuration are confined to their required server-side authentication/request envelopes. No raw narrative, additionalNotes, demographics, measurements, dates, upload text, excerpts, filenames, document metadata, case-specific generated statements, publications, URLs, browser citation numbers, warning or prescribing text is forwarded. Structural-finding responses containing reflected case facts are skipped. A supported response is not necessarily an eligible presentation mapping.

Warnings, conflicts, clarification, insufficient evidence, unavailable modules/providers and outside-scope outcomes are skipped. The shadow result is never inserted into the analysis envelope, renderedText, visual Summary or browser state. X-Endo-Watson remains skipped, shadow-success or shadow-fallback. Only shadow-fallback also includes X-Endo-Watson-Reason with one bounded category; skipped and shadow-success never carry a reason. Normal errors and disconnects retain existing status semantics. No clinical output is returned after a client disconnect. Provenance is checked again after shadow completion.

## Configuration (Netlify server scope only)

| Name | Requirement |
|---|---|
| WATSONX_ENABLED | Absent or exact false disables; only exact true opts in. Other values fail to deterministic fallback. |
| WATSONX_PRESENTATION_MODE | Only exact shadow is implemented; no display/live-replacement mode. |
| WATSONX_AI_AUTH_TYPE | Exact iam. |
| WATSONX_AI_APIKEY | Server secret; no whitespace/control characters; never a URL parameter. |
| WATSONX_AI_PROJECT_ID | Canonical UUID for the authorized IBM project. |
| WATSONX_AI_URL | Explicit official regional HTTPS origin; no userinfo, port notation, path, query, fragment or redirect. |
| WATSONX_AI_MODEL_ID | Explicit format-validated model identifier; availability is not inferred. |
| WATSONX_AI_API_VERSION | Explicit valid ISO date; never defaults to today's date. |
| WATSONX_AI_TIMEOUT_MS | Default 1500; integer 100–8000. One total shadow budget includes refresh wait, IAM, generation, reading and validation. |

The .env.example placeholders do not enable Watson. Python's existing WATSONX_API_KEY and related settings are a separate integration boundary; they are not silently aliased. No provider setting may use a VITE_ prefix. Configuration uses private fields to avoid accidental object serialization of secrets. Settings are read only on an eligible analysis request, never during import, app construction, health, readiness or discovery.

The adapter permits only the documented regional model API hosts for Dallas, Frankfurt, London, Tokyo, Sydney, Toronto and Mumbai. IAM uses the fixed official HTTPS identity/token endpoint with a form-encoded API-key grant. Native fetch has redirect:error, credentials:omit and cache:no-store. No SDK, new dependency, application retry, streaming generation or tool call is used.

## Authentication, deadlines and cancellation

Tokens are kept only in the Function process and refreshed at least 60 seconds before the earlier reported expiry. Concurrent callers share one refresh. Cancelling one waiter does not cancel another; when the last waiter leaves, refresh is aborted. Credential rotation cannot inherit an old credential's token. A 401/403 clears the cached token without replaying generation. Cold starts and separate serverless instances have independent caches; no distributed coordination is claimed.

The Function total deadline is ten seconds; frontend default is twenty seconds. Shadow receives at most the configured timeout and the remaining Function budget minus a 500 ms response reserve. Its maximum shadow budget is 8000 ms. Named constants keep these bounds aligned; the default configured timeout remains 1500 ms. IAM refresh also has its own bounded lifetime. Each caller's wait consumes its total budget. Request cancellation is propagated to generation and refresh ownership; cancellation is not retryable. Native transport abort cannot prove IBM stopped remote computation or billing. No provider work runs as an unawaited background task.

## Strict response validation and deterministic fallback

The chat request asks for JSON using response_format:json_object and explicit JSON instructions. JSON mode is not treated as a factual or schema guarantee. The selected model must support this API; rejection falls back, with no alternative model or format.

The assistant must return the exact server-generated requiredOutput value, whose shape is:

```json
{"presentationVersion":"1","paragraphs":[{"factIds":["F1"],"claimIds":["suppliedClaimId"],"text":"exact supplied public wording"}]}
```

The server constructs exactly one paragraph. Its factIds contain every supplied fact once in supplied order; claimIds are the unique union sorted deterministically; text joins the exact reviewed wording with one ASCII space, without trimming or normalization. The fixed instruction requests the exact requiredOutput value, without wrapper, commentary, Markdown, reordered properties or array entries. After duplicate-key-protected parsing, the unchanged validatePresentation runs first, followed by exact JSON structural/property-order equality against the canonical object. Novel paraphrases, alternative grouping, reordering and text changes are rejected. JSON formatting whitespace outside string values does not alter parsed structure; reviewed string bytes are never normalized. IDs alone cannot verify clinical equivalence. Unknown/duplicate IDs, duplicate JSON keys, additional properties, changed qualifiers, unbound text, omissions, refusal, tool calls, multiple results, truncation or any finish reason other than stop fail validation. Provider bodies are bounded to 32 KiB and assistant content to 16,000 characters. Only one complete assistant choice is accepted. HTTP, authentication, network, timeout, parsing, schema or grounding failure returns shadow-fallback while preserving deterministic body/status. Provider errors and response prose are discarded and never logged or returned.

The adapter emits no logs. Host request-body capture, APM, IBM retention and IBM-side telemetry must be separately reviewed before enabling. Do not add payload diagnostics to troubleshoot failures. Headers disclose only the bounded failure category described below, never an endpoint, status code, token, project ID, exception text or clinical data.

## Official references and remaining live gates

Reviewed 2026-10-26: [IBM watsonx.ai REST API](https://cloud.ibm.com/docs/apis/watsonx-ai), [IBM IAM token API](https://cloud.ibm.com/docs/apis/iam-identity-token-api), [IBM JSON response-format documentation](https://ibm.github.io/watsonx-ai-node-sdk/interfaces/1_3_x.WatsonXAI.TextChatResponseFormat-1.html). These establish official endpoints, IAM authentication, dated API versions and JSON-mode/truncation considerations. The SDK documentation was read, not installed.

Mocked tests exercise the real Function handler, projector, native-fetch boundary and fallback. Actual credentials, project/model authorization, model/API compatibility, regional availability, quotas, retention, latency and production-host disconnect behavior remain unverified. Public-endpoint rate limiting and access controls are separate prerequisites before enabling a billable provider on an unrestricted evaluation site. This task does not perform a live test, enable Watson, deploy or introduce an AI-controlled clinical response.

Changes to code or presentation mappings deliberately invalidate the evaluation seal. Refresh it only after reviewing the change and its tests; builds never refresh trust pins automatically. ReleaseFiles.txt includes this documentation and the server-only implementation/tests, never secrets or clinical source originals.

## Privacy-safe fallback diagnostics

X-Endo-Watson-Reason appears only alongside X-Endo-Watson: shadow-fallback. Its complete vocabulary is configuration, iam-timeout, iam-rejected, iam-response, model-timeout, model-rejected, model-response, presentation-validation and internal.

Configuration validation has a dedicated internal error type. HTTP rejection is classified by its IAM/model phase without disclosing the provider status or reading its error body. Wrong MIME type, invalid outer UTF-8/JSON, duplicate outer keys, malformed IAM fields or unexpected chat envelopes are response failures for the corresponding phase. Generated presentation JSON failures are local presentation-validation failures. Valid JSON that fails the local fact/claim-bound presentation validator is presentation-validation. Actual controlled deadline signals identify whether IAM or model processing was active, including shared IAM refresh timeouts. Unknown transport/programming failures map only to internal; exception messages, provider text and lookalike reason properties never select a category.

The status-returning adapter interface stays unchanged; a request-local callback communicates only the enum category to the Function. There is no mutable global diagnostic state or new console logging. Client disconnect handling remains an empty 499 response, not a clinical body created for diagnostic purposes. Shared refresh cancellation isolation, timeout values, validation, deterministic bodies, model-output discard, package checks and same-origin browser credentials remain unchanged. Diagnostics do not enable Watson or establish model compatibility. A later live preview can use the category to choose a bounded follow-up investigation without collecting sensitive payloads.

## Documented response metadata compatibility

Reviewed 2026-10-27 against IBM's [chat API example](https://www.ibm.com/docs/en/watsonx/saas?topic=code-chat), [chat/tool example](https://dataplatform.cloud.ibm.com/docs/content/wsj/analyze-data/fm-api-chat-tools.html?audience=wdp&context=wx) and [SDK response field documentation](https://ibm.github.io/watsonx-ai-node-sdk/interfaces/1_3_x.WatsonXAI.TextChatStreamItem.html). The indexed IBM examples show created_at and system.warnings with id, message and more_info; the SDK documents optional model_version. The main IBM page returned 403 on direct retrieval; no authenticated access or bypass was attempted. The [official SDK type definitions](https://github.com/IBM/watsonx-ai-node-sdk/blob/main/src/types/vml_v1.ts) were also read directly: message is required, while id and more_info are optional. The generic additional_properties warning map is deliberately excluded from this bounded compatibility correction; arbitrary nested metadata remains rejected. No SDK was installed and no third-party warning passages were copied into fixtures.

Only created_at, model_version and system were added to the existing top-level allowlist. All are optional. created_at is at most 40 characters and must be a timezone-bearing ISO timestamp with valid calendar date, hours, minutes and seconds; fractional seconds and numeric offsets are supported. model_version is a nonempty 1–128-character ASCII version label beginning with a letter or digit and containing only letters, digits, dots, underscores, plus or minus signs. This is a bounded version-label check, not a claim to verify a model release or full semantic-version specification.

system must be an object with only optional warnings. If supplied, warnings must be an array of at most eight objects. Each warning requires message (nonempty text, at most 2048 characters); optional id must be a nonempty token of at most 128 characters. Optional more_info must be an absolute HTTP/HTTPS URL of at most 2048 characters without whitespace or userinfo. Unknown system/warning keys, malformed types and oversized fields fail as model-response. Empty system/warnings are permitted; null is not an object/array substitute. These are local safety bounds; the unchanged 32 KiB response-wide limit also applies.

Metadata is validated and discarded. Warning links are never followed, rendered, logged, returned or treated as evidence; messages cannot become instructions or presentation text. Existing model identity, single choice, completion/role/content, usage, duplicate-key, reviewed fact/claim/text, deadline and cancellation checks remain unchanged. A valid envelope with invalid presentation still yields presentation-validation, and no Watson prose is displayed. No prompt, model, endpoint, API version, token limit, timeout or environment setting changed.

## Canonical shadow-conformance stage

The separate optional `reviewed` mode is documented in [WatsonReviewed.md](WatsonReviewed.md). The shadow wire format, exact-output validator and discard behavior below are unchanged.

This phase checks provider connectivity and exact-output conformance only. It does not authorize unrestricted generative clinical paraphrasing. canonicalPresentation builds presentationVersion exactly "1" and one paragraph with only factIds, claimIds and text from the already-approved Presentation. The Watson user message has exactly one property: requiredOutput. Module/source IDs, URLs, citation numbers, clinical conditions and original case data are excluded. The builder never generates, shortens, expands, reorders or normalizes wording.

The model is instructed to return the value itself, without a wrapper, code fences or commentary, and preserve all property/array order, punctuation and spacing. IBM JSON mode remains enabled. Valid JSON proceeds through the existing strict presentation validator and then exact equality with the canonical object. Invalid generated JSON (including Markdown), wrappers, reordered IDs/properties, extra/missing/duplicate facts or changed text yield presentation-validation. Malformed outer provider envelopes still yield model-response. No output repair, trimming, approximate matching or semantic similarity is used. Validated provider prose is discarded; only the existing privacy-safe status/reason headers can differ from the deterministic response.

All model/endpoint/API-version/token-limit/timeout/retry settings, the 32 KiB response limit, metadata checks, cancellation, evidence provenance, uploads and clinical presentation remain unchanged. The 78 claim packages are not modified.
