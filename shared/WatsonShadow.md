# Netlify watsonx.ai presentation shadow adapter

This is a server-only, disabled-by-default integration path. No IBM request, credential, deployment or model enablement was used to implement it. The deterministic analysis, visual Summary, upload review and 78 clinical claims remain authoritative and unchanged. Authentic sources remain pending review; no clinical approval is implied.

## Flow and egress boundary

The Function validates the request, performs deterministic analysis and citation construction, and verifies the full reviewed package state. Only then can the presentation projector run. It recognizes complete, exact source-bound public mapping atoms; mixed, unknown or case-specific text causes the whole shadow operation to be skipped. It verifies the selected module, public claim IDs and returned source coverage. Up to ten facts are generated with request-local F1/F2 identifiers, fixed public patient-friendly wording and approved evaluation claim IDs. Facts are discussion propositions, not assertions that a patient has a diagnosis or symptom. No case object is accepted by the projector or transport adapter.

The model receives only presentationVersion, moduleId, findings (factId, claimIds, wording) and fixed presentation instructions. IAM credentials and model/project configuration are confined to their required server-side authentication/request envelopes. No raw narrative, additionalNotes, demographics, measurements, dates, upload text, excerpts, filenames, document metadata, case-specific generated statements, publications, URLs, browser citation numbers, warning or prescribing text is forwarded. Structural-finding responses containing reflected case facts are skipped. A supported response is not necessarily an eligible presentation mapping.

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
| WATSONX_AI_TIMEOUT_MS | Default 1500; integer 100–3000. One total shadow budget includes refresh wait, IAM, generation, reading and validation. |

The .env.example placeholders do not enable Watson. Python's existing WATSONX_API_KEY and related settings are a separate integration boundary; they are not silently aliased. No provider setting may use a VITE_ prefix. Configuration uses private fields to avoid accidental object serialization of secrets. Settings are read only on an eligible analysis request, never during import, app construction, health, readiness or discovery.

The adapter permits only the documented regional model API hosts for Dallas, Frankfurt, London, Tokyo, Sydney, Toronto and Mumbai. IAM uses the fixed official HTTPS identity/token endpoint with a form-encoded API-key grant. Native fetch has redirect:error, credentials:omit and cache:no-store. No SDK, new dependency, application retry, streaming generation or tool call is used.

## Authentication, deadlines and cancellation

Tokens are kept only in the Function process and refreshed at least 60 seconds before the earlier reported expiry. Concurrent callers share one refresh. Cancelling one waiter does not cancel another; when the last waiter leaves, refresh is aborted. Credential rotation cannot inherit an old credential's token. A 401/403 clears the cached token without replaying generation. Cold starts and separate serverless instances have independent caches; no distributed coordination is claimed.

The existing Function deadline remains five seconds; frontend default is twenty seconds. Shadow receives at most the configured timeout and the remaining Function budget minus a response reserve. IAM refresh also has its own bounded lifetime. Each caller's wait consumes its total budget. Request cancellation is propagated to generation and refresh ownership; cancellation is not retryable. Native transport abort cannot prove IBM stopped remote computation or billing. No provider work runs as an unawaited background task.

## Strict response validation and deterministic fallback

The chat request asks for JSON using response_format:json_object and explicit JSON instructions. JSON mode is not treated as a factual or schema guarantee. The selected model must support this API; rejection falls back, with no alternative model or format.

The assistant content must be exactly:

```json
{"presentationVersion":"1","paragraphs":[{"factIds":["F1"],"claimIds":["suppliedClaimId"],"text":"exact supplied public wording"}]}
```

There must be one or two paragraphs, every supplied fact exactly once, exact union of claim IDs per paragraph and text equal to those facts' reviewed wording joined with spaces. Ordering/grouping may vary, but novel paraphrases are rejected. IDs alone cannot verify clinical equivalence. Unknown/duplicate IDs, duplicate JSON keys, additional properties, changed qualifiers, unbound text, omissions, refusal, tool calls, multiple results, truncation or any finish reason other than stop fail validation. Provider bodies are bounded to 32 KiB and assistant content to 16,000 characters. Only one complete assistant choice is accepted. HTTP, authentication, network, timeout, parsing, schema or grounding failure returns shadow-fallback while preserving deterministic body/status. Provider errors and response prose are discarded and never logged or returned.

The adapter emits no logs. Host request-body capture, APM, IBM retention and IBM-side telemetry must be separately reviewed before enabling. Do not add payload diagnostics to troubleshoot failures. Headers disclose only the bounded failure category described below, never an endpoint, status code, token, project ID, exception text or clinical data.

## Official references and remaining live gates

Reviewed 2026-10-26: [IBM watsonx.ai REST API](https://cloud.ibm.com/docs/apis/watsonx-ai), [IBM IAM token API](https://cloud.ibm.com/docs/apis/iam-identity-token-api), [IBM JSON response-format documentation](https://ibm.github.io/watsonx-ai-node-sdk/interfaces/1_3_x.WatsonXAI.TextChatResponseFormat-1.html). These establish official endpoints, IAM authentication, dated API versions and JSON-mode/truncation considerations. The SDK documentation was read, not installed.

Mocked tests exercise the real Function handler, projector, native-fetch boundary and fallback. Actual credentials, project/model authorization, model/API compatibility, regional availability, quotas, retention, latency and production-host disconnect behavior remain unverified. Public-endpoint rate limiting and access controls are separate prerequisites before enabling a billable provider on an unrestricted evaluation site. This task does not perform a live test, enable Watson, deploy or introduce an AI-controlled clinical response.

Changes to code or presentation mappings deliberately invalidate the evaluation seal. Refresh it only after reviewing the change and its tests; builds never refresh trust pins automatically. ReleaseFiles.txt includes this documentation and the server-only implementation/tests, never secrets or clinical source originals.

## Privacy-safe fallback diagnostics

X-Endo-Watson-Reason appears only alongside X-Endo-Watson: shadow-fallback. Its complete vocabulary is configuration, iam-timeout, iam-rejected, iam-response, model-timeout, model-rejected, model-response, presentation-validation and internal.

Configuration validation has a dedicated internal error type. HTTP rejection is classified by its IAM/model phase without disclosing the provider status or reading its error body. Wrong MIME type, invalid UTF-8/JSON, duplicate keys, malformed IAM fields or unexpected chat envelopes are response failures for the corresponding phase. Valid JSON that fails the local fact/claim-bound presentation validator is presentation-validation. Actual controlled deadline signals identify whether IAM or model processing was active, including shared IAM refresh timeouts. Unknown transport/programming failures map only to internal; exception messages, provider text and lookalike reason properties never select a category.

The status-returning adapter interface stays unchanged; a request-local callback communicates only the enum category to the Function. There is no mutable global diagnostic state or new console logging. Client disconnect handling remains an empty 499 response, not a clinical body created for diagnostic purposes. Shared refresh cancellation isolation, timeout values, validation, deterministic bodies, model-output discard, package checks and same-origin browser credentials remain unchanged. Diagnostics do not enable Watson or establish model compatibility. A later live preview can use the category to choose a bounded follow-up investigation without collecting sensitive payloads.
