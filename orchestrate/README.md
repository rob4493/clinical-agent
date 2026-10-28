# Clarity Clinical Evidence — watsonx Orchestrate Integration

## SYNTHETIC DEMONSTRATION ONLY

This integration calls the **publicly accessible** Clarity Clinical Evidence
API at **https://clinicalagent.netlify.app**. That endpoint has no caller
authentication. Every request sent to it is accepted from any source.

**Do not submit patient-identifiable information through Orchestrate or any
other caller that targets the current endpoint.** This means: no patient names,
MRNs, exact dates of birth, phone numbers, email addresses, or postal addresses.
Do not send text copied from uploaded documents or clinical records.

This tool is for de-identified synthetic test cases only. It is not approved
for patient care.

---

## Directory contents

| File | Purpose |
|---|---|
| `endo-tool.openapi.yaml` | OpenAPI 3.0.3 tool specification for Orchestrate import |
| `agent-instructions.md` | Agent persona, verbatim-renderedText rule, and fail-closed rules |
| `cases/module01-endo.json` | 13 synthetic de-identified evaluation cases for Module 1 |
| `cases/module02-early-pregnancy.json` | 10 synthetic de-identified evaluation cases for Module 2 |
| `README.md` | This file |

---

## Current endpoint — public, unauthenticated

The live API is at `https://clinicalagent.netlify.app/api/v1/analyze`.
It is served by the Netlify edge function in `netlify/functions/evaluate.ts`.

| Property | Value |
|---|---|
| Authentication | None — publicly accessible |
| TLS | Enforced by Netlify (HTTPS only) |
| Body size limit | 65,536 bytes (enforced by the function) |
| PII safeguard | Server-side pattern filter on all free-text fields; rejects on match with HTTP 422 |
| CORS | Not set by the function; Orchestrate calls server-to-server |
| Rate limiting | Netlify platform defaults only |
| Clinical approval | None — competition evaluation evidence only |

Because there is no caller authentication, the Orchestrate connection for this
demonstration **must not** use an API key or credential setting. The OpenAPI
spec declares `security: []` on both operations to make this explicit.

---

## Future authenticated endpoint (prerequisite for clinical use)

Before this integration can be used with real clinical cases, an authorized
engineer must implement a separate service-to-service endpoint:

**`POST /api/v1/orchestrate/analyze`**

Requirements for that endpoint:

1. **Bearer-token caller authentication.** Validate token identity, audience,
   and expiry on every request. Reject unauthenticated requests with HTTP 401.
2. **Per-tenant API keys.** Issued to the Orchestrate instance only; never
   shared with browser clients.
3. **TLS enforcement.** HTTPS required; reject plain HTTP.
4. **Request rate limiting and quotas.** Protect against abuse.
5. **Thin wrapper only.** Delegate to the existing `POST /api/v1/analyze`
   analysis pipeline after authentication. Do not duplicate clinical logic.
6. **Audit logging.** Log operational metadata (event type, module ID,
   timestamp, outcome, latency). Never log case text, prompts, or identifiers.

Until this endpoint exists, Orchestrate may only be used with the public
endpoint for de-identified synthetic testing.

When the authenticated endpoint is ready:
- Update the `servers.url` in `endo-tool.openapi.yaml` to point to it.
- Add a `bearerAuth` security scheme and apply it to both operations.
- Update the Orchestrate connection with the issued API key.
- Rerun all synthetic cases to confirm the contract is identical.

---

## Setting up the tool in Orchestrate

### 1. Import the OpenAPI spec

Using the Orchestrate CLI:

```bash
orchestrate tools import -k openapi -f orchestrate/endo-tool.openapi.yaml -a <appID>
```

Or use the Orchestrate web console: **Tools → Import tool → OpenAPI**.

The spec registers two operations:

| `operationId` | Method + path | Purpose |
|---|---|---|
| `analyzeCase` | `POST /api/v1/analyze` | Submit a de-identified case |
| `listModules` | `GET /api/v1/modules` | List available modules |

### 2. Create the application connection

Because the current endpoint has no authentication:

1. In the Orchestrate console, create a new application connection.
2. Set **authentication type** to **No Auth** (or the equivalent option for an
   unauthenticated public API).
3. Set the **base URL** to `https://clinicalagent.netlify.app`.
4. Bind the connection to the imported tool's app ID.

Do not set a bearer token or API key for the current public endpoint. A
credential declared against a server that does not validate it would cause
Orchestrate to send an `Authorization` header that the function ignores,
creating the false impression that requests are authenticated.

### 3. Create the agent

1. Create a new agent in Orchestrate.
2. Paste the full contents of `agent-instructions.md` into the agent's
   instructions or persona field.
3. Grant the agent access to the imported `analyzeCase` and `listModules` tools.
4. Confirm the agent is configured to use the tools for clinical queries rather
   than answering from model knowledge.

---

## Privacy boundaries

### Must not be submitted

- Patient names
- Medical record numbers (MRNs)
- Exact dates of birth (use an age range such as "25-34")
- Phone numbers, email addresses, postal or physical addresses
- Uploaded document text, file names, or attachment content
- Any free text copied from clinical records without de-identification review

### May be submitted

- Clinician-entered de-identified narrative in `additionalNotes`
- Structured fields: age range, symptom descriptions, three-state flags
- The explicitly selected module identifier

### Server-side enforcement

The API applies a PII safeguard filter to every free-text field and rejects
inputs matching phone, MRN, date, or address patterns with HTTP 422. This is a
technical safeguard, not a de-identification guarantee. The submitter remains
responsible for de-identification before calling the tool.

### Orchestrate conversation history

Confirm the data-retention and training-use settings for your Orchestrate
instance before any use. Memory-only handling in the Endo app does not
establish memory-only handling by Orchestrate.

---

## Testing with synthetic cases

Use **only** the cases in `cases/module01-endo.json` and
`cases/module02-early-pregnancy.json`. These are fictional de-identified inputs.
Expected outcomes were verified against the offline competition evaluator.

Never use real patient cases for connectivity testing.

### Manual API validation (local competition server)

Start the competition server (see `docs/CompetitionRunbook.md`):

```powershell
$env:CLINICAL_RUNTIME_MODE = 'competition'
$env:CLINICAL_DEMO_MODE = 'false'
$env:LANGUAGE_PROVIDER = 'disabled'
.\.venvMilvus\Scripts\python.exe -B -m tests.support.competitionServer
```

Send a synthetic case:

```powershell
$body = '{"moduleHint":"module_01_endo","caseType":"brief","ageRange":"25-34","pregnancyPossible":null,"pidDiagnosedOrPresumed":null,"additionalNotes":"Recurrent pelvic discomfort. Timing, examination and test findings are not provided. Please review the reported pattern and uncertainty."}'
Invoke-RestMethod -Method POST -Uri http://127.0.0.1:8020/v1/analyze -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 10
```

Note: the competition server uses `/v1/analyze` (no `/api` prefix). The
deployed Netlify endpoint uses `/api/v1/analyze`.

### Checking a response

For each case, confirm:

- `responseType` matches `expectedResponseType` in the case file.
- `warnings` is non-empty when the case expects urgent content.
- `renderedText` ends with the decision-support notice.
- `sources` is non-empty for `AgentResponse` cases.
- `renderedText` is absent or empty only for unexpected errors.

### Checking Orchestrate agent behaviour

For each synthetic case:

1. Provide the narrative (clinician selects the module explicitly first).
2. Confirm the agent calls `analyzeCase` rather than answering directly.
3. Confirm the agent returns `renderedText` verbatim — not a summary.
4. For cases with `warnings`, confirm warnings appear before other content.
5. For `DataConflict` / `ClarificationRequired`, confirm the agent does not
   attempt to resolve the issue and does not proceed with clinical content.
6. For `EvidenceInsufficient` / `OutsideScope`, confirm no model-knowledge
   supplement appears.
7. For error responses (404, 422, 503), confirm only the neutral message
   appears, with no clinical content added.

---

## OpenAPI contract alignment

The spec was aligned to the production Netlify endpoint by inspecting:

- `netlify/functions/evaluate.ts` — route handlers and response shapes
- `netlify/evaluation/input.ts` — request validation and field constraints
- `netlify/evaluation/analysis.ts` — response envelope and outcome types
- `backend/app/models/input.py` — Python Pydantic model for field details
- `backend/app/models/pregnancy.py` — `PregnancyContext` sub-object
- `backend/app/models/output.py` — all eight `responseType` values
- `backend/app/models/analysis.py` — `AnalysisResult` envelope

Key contract points reproduced in the spec:

| Contract point | Spec location |
|---|---|
| `moduleHint` required, 1–64 chars | `ClinicalCaseInput.moduleHint` |
| `pregnancyPossible` / `pidDiagnosedOrPresumed` — three-state only | `ClinicalCaseInput` field descriptions |
| `earlyPregnancy` — Module 2 only | `PregnancyContext` schema + `ClinicalCaseInput` description |
| `additionalNotes` max 2000 chars | `ClinicalCaseInput.additionalNotes.maxLength` |
| Eight `responseType` values | `AnalysisResult.response.responseType` enum |
| `warnings[]` — urgent first | `AnalysisResult.warnings` description |
| `renderedText` — verbatim | `AnalysisResult.renderedText` description |
| `verifiedUrl` nullable | `CitedSource.source.verifiedUrl` |
| HTTP 200 / 404 / 422 / 503 | All documented on `analyzeCase` |

---

## Rollback

### Disable the Orchestrate tool

1. In the Orchestrate console, unpublish or deactivate the tool.
2. Delete the application connection.
3. The Endo API is unaffected; no API or frontend files were changed.

### Remove via Orchestrate CLI

```bash
orchestrate tools delete -k openapi -a <appID>
```

### Verify isolation

After rollback:
- `GET https://clinicalagent.netlify.app/api/v1/modules` still returns modules.
- No files in `orchestrate/` affect the API, frontend, or test suite.
- No clinical rules, evidence, claim packages, or manifests were modified.

---

## Architecture

```
Clinician (Orchestrate chat)
         │
         ▼ calls analyzeCase tool
Orchestrate agent
  — no clinical logic —
  — returns renderedText verbatim —
         │
         ▼ POST https://clinicalagent.netlify.app/api/v1/analyze
Netlify edge function (netlify/functions/evaluate.ts)
         │
         ├─ Schema + PII validation
         ├─ Module resolution
         ├─ Deterministic safety rules (U1 / U2 / U3)
         ├─ Approved evidence retrieval (module-isolated)
         ├─ Structured generation + citation validation
         └─ AnalysisResult envelope
              warnings[]        ← urgent first
              response{}        ← responseType discriminator
              sources[]         ← only cited sources
              renderedText      ← complete validated output
              decisionSupportNotice ← server-controlled, last
```

The agent is a relay. All clinical content flows from the API unchanged.

---

## Known limitations and remaining gates

| Gap | Detail |
|---|---|
| No caller authentication | Current endpoint is publicly accessible. Required before clinical use. |
| No future authenticated endpoint | `/api/v1/orchestrate/analyze` does not exist yet. |
| No production clinical approval | Modules are competition-eligible; no authentic expert review has occurred. |
| Milvus not connected | Competition runtime uses local deterministic retrieval. Live Milvus blocked pending SDK compatibility. |
| Orchestrate retention not verified | IBM-side data-retention policy must be reviewed before any patient-adjacent use. |
| Cancellation through Orchestrate not tested | Local browser-to-API cancellation is tested; gateway-level cancellation is not. |
| No rate limiting | Netlify platform defaults only; no per-caller limits. |

See `docs/OrchestratePreparation.md` for the full pre-registration checklist.

---

## Files not changed by this integration

The following files are unchanged and their clinical behaviour is unaffected:

- `netlify/functions/evaluate.ts`
- `netlify/evaluation/` (all files)
- `backend/` (all files)
- `frontend/` (all files)
- `tests/` (all files)
- `docs/` (all files)
- Evidence files, claim packages, manifests
- `.env.example`, `netlify.toml`, `pytest.ini`
