# Endo conversational connection — prepared, not live

Reviewed 5 November 2026. **The application cannot currently conduct model-backed conversations.** External clinical-text transmission remains unauthorized. No IBM request, credential entry, live setting change or agent registration occurred in this work. Local follow-up is explicitly labeled as a bounded fallback, not IBM inference.

## Integration decision

Prefer native server-side watsonx.ai text/chat inference behind Endo's first-party controller. The transport is real HTTP request construction, not a scripted answer generator; its successful tests use injected mocked HTTP responses only. It reuses the existing bounded IAM/token/HTTP implementation and its documented response-envelope checks, without changing shadow/reviewed presentation behavior. No SDK or dependency was added.

IBM embedded Orchestrate chat is a supported separate product integration with its own authentication, thread history and retention controls. Endo's existing Orchestrate assets describe a public unauthenticated synthetic tool, not an authenticated conversation gateway. Tenant-specific retention, administrators' access, monitoring and authorization have not been verified. Therefore embedding hosted chat or forwarding messages to an existing agent is not authorized. Preserve those assets unchanged. Orchestrate can later coordinate separately approved operational tools; it cannot commit canonical changes, adjudicate conflicts or invoke reanalysis autonomously.

Official references checked 5 November 2026:

- [watsonx.ai API, IAM and regional endpoints](https://cloud.ibm.com/docs/apis/watsonx-ai)
- [Orchestrate embedding](https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=applications-embedding-agent-web)
- [Embedded-chat security](https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=applications-securing-embedded-chat)
- [Chat privacy and retention](https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=instance-chat-privacy-data-protection)
- [Agent API and direct authentication](https://developer.ibm.com/apis/catalog/watsonorchestrate--custom-assistants/Client%2BJWT%2BAuthentication%2Bfor%2BDirect%2BAPI%2BAccess%2Bin%2Bwatsonx%2BOrchestrate)

The embedding and privacy IBM Docs pages returned HTTP403 to direct retrieval here; official indexed information was available. This is a documentation assessment, not a verification of any IBM account or instance. Do not infer suitable retention or permission from the general documentation.

## Prepared server architecture

`netlify/evaluation/agentProvider.ts` delegates to the existing native-fetch IBM transport with a dedicated agent role and system instruction. It requests genuine natural discussion and context-aware questions in a bounded JSON envelope, not opaque presentation selections or fixed questionnaire templates. Observations are optional. `shared/observationContract.ts` is the single validator shared with offline evaluation; `shared/observations.schema.json` is a byte-identical runtime mirror of the unchanged Phase2A draft. Tests require equality. The schema is not newly clinically approved.

`agentService.ts` owns session context, explicit module selection, original case snapshot, clinician turns, validated assistant context and unverified proposals. A trusted server principal and policy are required before session creation and every turn. Browser-provided principal objects are not authentication. The default policy denies all access and the default grounding verifier rejects all prose. No environment variable bypasses those defaults. A fabricated conversation request to the public route cannot grant permission.

Before optional inference, screen the original case and all current turns with existing deterministic analysis. A warning, structured conflict, required clarification or unsupported urgent action coverage halts optional dialogue and returns the existing authoritative safety outcome. A new question cannot erase an earlier warning. Only exact public claim statements already selected by deterministic analysis form the initial agent evidence projection; a shared source does not authorize unrelated claims. Broader discussion evidence needs a separately reviewed selection strategy, not unrestricted retrieval.

The request contains only version, explicit module ID, bounded clinician turns, validated assistant context, selected project-authored public claims with their conditions/limitations/population/jurisdiction, and bounded observation definitions. The original case object, automatically assembled narrative, age/demographics, uploads, extracted excerpts, filenames, document metadata, source originals and source URLs are not forwarded. New turns remain untrusted data. Privacy validation runs locally; de-identification does not independently authorize transmission. The current gate prevents any of this text from leaving Endo.

Provider output has exactly version, paragraphs and observations. Each of at most four paragraphs has bounded text, kind and eligible claim IDs. Duplicate-key parsing, schema/source-span/module checks, no model URLs, bounded arrays and grounded claim references remain required. Citation numbers and source links are reconstructed on the server. Unsupported, malformed or unverified prose is rejected. No canonical setter, analysis tool, evidence selector or conflict winner is exposed to the model.

**Semantic grounding remains a blocker.** A trusted independently reviewed GroundingVerifier must validate each dynamic paragraph, including medical assertions embedded in acknowledgements or questions. Valid JSON, matching claim IDs, word overlap or a second model's confidence cannot prove preserved clinical meaning. The default verifier denies everything; the mocked positive verifier in tests is not a clinical safety validator. Fresh clinical discussion must not be enabled until the actual verification strategy, safety boundaries, expert corpus and thresholds are reviewed. No fixed response vocabulary is substituted and described as a completed natural AI agent.

Sessions are process-local, limited to16 concurrent sessions, six turns, 1,000 characters per turn, 12 validated assistant paragraphs and a60-second idle lifetime. Timed cleanup and End erase original context and proposals and abort active work. Subject mismatch, expiry and simultaneous turns are rejected. Provider failure preserves existing context and cannot apply updates. These closures are not durable across Netlify instances; a reviewed authenticated replay or affinity design is required before exposing session endpoints. Do not add a transcript database to solve this without separate authorization.

## Current public behavior

GET `/api/v1/conversation` reports a fixed, non-sensitive blocked capability. It never authenticates to IBM, loads a conversation, or examines a case. POST remains503 and blocked without reading a clinical body. The interface's Check IBM connection action queries this capability; it does not perform an IBM health test. The public route deliberately has no infer/start/end binding until real caller authentication and transmission authorization exist.

The local fallback now keeps pending changes collapsed. Clinicians can continue typing without reviewing them, include/exclude individual proposals when ready, and apply selected changes with one final approval. There is no per-observation confirm/reject ladder or duplicate final verification. Existing structured/free-text conflicts still block application; unresolved clarification is not silently resolved. Existing values are not proposed as duplicate changes. The application acknowledges a successful update and exposes Reanalyze case separately. No analysis happens merely because an update was approved.

## Required connection configuration and approval

The prepared direct-inference role uses the existing server-only WATSONX_AI_AUTH_TYPE, WATSONX_AI_APIKEY, WATSONX_AI_PROJECT_ID, WATSONX_AI_URL, WATSONX_AI_MODEL_ID, WATSONX_AI_API_VERSION and WATSONX_AI_TIMEOUT_MS settings. The conversation role accepts WATSONX_CONVERSATION_MODE=syntheticTest only after trusted server permission; the example/default remains disabled. Existing WATSONX_ENABLED presentation flags cannot authorize conversation. No browser Vite variable may contain credentials.

The exact model, project, region and instance have not been verified or selected here. Do not copy values from another deployment or print them. The official HTTPS allowlist and IAM token endpoint, redirects denied, zero application retries, combined bounded IAM/model deadline, cancellation, memory-only expiration-aware token cache, concurrent refresh waiters and32 KiB response limit remain inherited. Request projection is capped at32 KiB. No provider or case logging is added.

Before a real synthetic test, approve all of the following:

1. Exact fictional messages and permitted classification; exclude identifiers, uploaded/confirmed document content and unrelated clinical text. Separately authorize transmission of those exact examples.
2. Authenticated server principal/tenant boundary, CSRF/origin protection, rate limits, session ownership/replay and cleanup. A Netlify preview login alone is not organizational clinical authorization.
3. IBM instance, model/API version, project and region, least-privileged IAM credentials, provider retention/training/monitoring/subprocessor settings and organizational privacy/security approval. De-identification alone is insufficient.
4. An independently reviewed grounding strategy and extraction evaluation, clinician-reviewed test annotations and acceptance thresholds. Mock success is not measured model understanding or clinical validation.
5. An explicit code-reviewed host binding of the permission policy, grounding verifier and native provider, and a separate deployment/test approval. Do not expose the current process-local session interface as a durable public service.

If Orchestrate is later selected instead, independently obtain its instance/region, agent/environment identifier, server token/JWT configuration and verified retention policy. No Orchestrate agent ID is required for the chosen direct watsonx.ai adapter, and none was invented. Any hosted-chat embedding or script would need another review.

## Validation interpretation

Offline tests cover real IAM/chat request shapes, permission denial, bounded configuration, malformed output, novel wording passed to a trusted verifier, source authority, multi-turn context, provider outage, concurrent isolation, cancellation and session cleanup. UX tests verify collapsed proposals, exclusions, a single final application and separate reanalysis. These establish software contracts, not live IBM inference or clinical approval. The normal full backend suite and the isolated previously implicated concurrent test completed without reproducing the earlier Windows native access violation. Its root cause is not established; no Python concurrency code or warning policy was changed. Passing offline regressions does not satisfy the separate authorization, clinical-grounding or live-provider gates.
