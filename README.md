# Endo

Clinical Evidence Assistant

A clinician-facing evaluation application that helps healthcare professionals review de-identified case information alongside supporting medical evidence. The supplied demonstration cases allow evaluators to inspect the workflow without entering a case manually.

Public evaluation site: **[clinicalagent.netlify.app](https://clinicalagent.netlify.app/)**

**Use fictional cases only. This application is not approved for patient care.** It does not diagnose, estimate disease probability, infer disease stage or pregnancy viability, prescribe, provide medication doses, or choose treatment for a person.

Developers and future integrations share a [versioned clinical-data contract](shared/README.md). Existing submissions remain compatible. Optional de-identified document review is available, with explicit clinician confirmation before analysis.

## What works today

- A React website with a same-origin Netlify evaluation API; FastAPI remains available for local development.
- Explicit module-card selection, a primary case-narrative input, conditionally displayed structured fields and reviewed demonstration cases.
- Conflict and clarification checks, predefined urgent warnings, evidence retrieval and citation validation.
- Concise clinician-oriented responses, relevant source links, reviewed visuals and safe evidence-insufficient outcomes.
- Browser-memory PDF, DOCX and TXT review with clinician confirmation before analysis.
- Optional server-side watsonx.ai presentation support that cannot replace the deterministic clinical analysis.
- IBM watsonx Orchestrate integration assets for a separate conversational evaluation agent.
- Two competition topics: **Endometriosis and Chronic Pelvic Pain** and **Early Pregnancy Pain and Bleeding**.

The competition topics use separate, integrity-verified, project-authored evaluation summary packages. Their eligibility for controlled evaluation does **not** approve the sources for authentic clinical use. All four authentic clinical modules remain inactive and pending review. A clean local checkout remains deterministic and does not require IBM or Milvus. Authorized hosted environments can separately enable the constrained watsonx.ai presentation adapter, and the Orchestrate assets can connect a deployed IBM agent to the same public evaluation API.

Original project code and original documentation are licensed under **Apache License 2.0**. Clinical sources, publisher files, knowledge documents and complete source-derived claim packages are **not distributed or licensed by this repository**. See [licensing boundaries](THIRD_PARTY_NOTICES.md).

A clean clone can run the fictional synthetic demo and both public competition topics without private evidence, API keys or a CLINICAL_EVIDENCE_ROOT setting. The competition topics use project-authored evaluation summaries, not original publications. Reviewed with healthcare professionals for evaluation and feedback. Not validated or approved for patient care. The optional legacy private-source graph is documented separately in [private evidence installation](EVIDENCE_INSTALLATION.md).

## Before you start

Use **Windows PowerShell**, **Python 3.12**, and **Node.js 24.15.0 or later within Node 24** with npm. The existing environment was checked with Node 24.21.0 and npm 11.19.0. Linux and macOS dependency installation have not been verified.

You need internet access for initial dependency installation. The offline application does not need an IBM account, API keys, Docker, a running Milvus service or a real `.env` file.

Download the published release through GitHub or clone it:

```powershell
git clone https://github.com/rob4493/clinical-agent.git
Set-Location clinical-agent
py -3.12 --version
node --version
npm --version
```

If you already have this project, open its existing folder instead. The folder must contain `backend`, `frontend`, `netlify`, `shared`, `evaluation`, `tests` and this README. The `orchestrate` directory is included in releases that contain the IBM agent integration assets.

## Install once

Run these commands from the project folder in a fresh checkout. The Python environment stays inside the project; nothing is installed globally. If `.venvMilvus` already exists, reuse it rather than overwrite it.

```powershell
py -3.12 -m venv .venvMilvus
.\.venvMilvus\Scripts\python.exe -m pip install -c backend/constraintsMilvus.txt setuptools==81.0.0 -r backend/requirements.txt -r backend/requirementsTest.txt
.\.venvMilvus\Scripts\python.exe -m pip check
Set-Location frontend
npm ci --ignore-scripts
Set-Location ..
```

`pip check` should report `No broken requirements found.` Keep the declared versions and lockfile. If installation fails, stop and retain the error; do not use `--force`, `--legacy-peer-deps`, overrides or automatic dependency fixes. The Python requirements pin direct versions but do not fully lock transitive packages; a future clean installation may require compatibility review.

## Start the fictional demo

Open two PowerShell windows in the project folder. Keep both windows open.

**Window 1 — backend:**

```powershell
.\.venvMilvus\Scripts\python.exe -B -m tools.runDemo --mode synthetic
```

**Window 2 — website:**

```powershell
Set-Location frontend
$env:VITE_BACKEND_URL = 'http://127.0.0.1:8000'
npm run dev
```

Open **[http://127.0.0.1:5173/](http://127.0.0.1:5173/)** on the same computer. Confirm the persistent synthetic banner. Select the synthetic topic, load an example, review the case and select **Analyze case**. The fictional evidence demonstrates workflow, not medical guidance. **Clear case** removes the case and response and cancels an active request. Missing information stays Unknown; a conflict or evidence limitation may be the intended outcome.

The launcher explicitly selects an inactive, source-free authentic registry and an isolated fictional graph. No protected documents, IBM account or external provider are needed. `--mode standard` instead keeps discovery empty and readiness at 503. Do not point a default `uvicorn backend.app.main:app` command at missing private source configurations.

## Run competition Modules 1 and 2

No source download or private installation is needed for the public evaluation packages. Run:

```powershell
.\.venvMilvus\Scripts\python.exe -B -m tools.runDemo --mode competition
```

Use the same frontend command above. Confirm the evaluation/privacy banner. Load a demonstration case, or explicitly select **Endometriosis & Chronic Pelvic Pain** or **Early Pregnancy Pain & Bleeding** for manual entry. The professional-review statement and detailed limits remain under **Scope & safety** below the workspace. The local launcher composes responses deterministically from the reviewed public summaries and does not enable a live model. Authentic sources remain pending review and authentic modules inactive. Missing or altered public packages or safety code invalidate evaluation readiness. Do not edit hashes to bypass review.

Keep age range and case type in dropdowns rather than repeating them in the narrative. Pregnancy and PID have Yes, No and Unknown states; PID means pelvic inflammatory disease, and this field records a clinician-reported diagnosis rather than one made by the app. Module 2 has additional pregnancy-test and ultrasound context. Results start with a short Evidence summary when an exact reviewed mapping is available. Clinical considerations, full clinical details and Sources expand on request. Click a numbered citation to open its source list; urgent warnings and prescribing boundaries stay visible. Absence of a warning does not prove safety.

Both commands bind only to localhost and disable access logs. They are offline local evaluation launchers, not public deployment commands. No live model or vector client is created.

## Privacy and response limitations

Do not enter names, exact birth dates, contact details, addresses, record numbers or real patient information. Case state stays in browser/request memory. There is no browser persistence, case database, analytics or intentional case/prompt/evidence/model-output logging. Clear and refresh remove the interface state. Privacy filtering is not a substitute for removing identifiers yourself.

Missing information remains Unknown. Conflicting facts stop analysis. Urgent source conditions, including pregnancy state, symptom timing, dizziness duration and access conditions, are not generalized. Sources retain their date, jurisdiction and population limits. Only cited verified URLs become links; other sources use an internal details panel.

Natural paraphrases are checked against bounded supported propositions, not accepted merely because they contain relevant words. Unrecognized wording can fail closed even when it might be clinically reasonable. No claim of diagnostic accuracy, HIPAA compliance, regulatory approval or production readiness is made.

## Check the installation

Source-free backend checks run against the explicit inactive registry. Run these from the project root:

```powershell
$env:MODULE_ROOT = (Resolve-Path backend/releaseModules).Path
.\.venvMilvus\Scripts\python.exe -B -m pytest tests/unit/testPublicEvaluation.py tests/unit/testEvaluationPackages.py tests/unit/testRequestPolicy.py tests/unit/testEvidenceInstallation.py tests/unit/testClinicalSchema.py tests/unit/testDocumentBridge.py tests/unit/testResponsePresentation.py -q
.\.venvMilvus\Scripts\python.exe -m tools.schemaSync --check
.\.venvMilvus\Scripts\python.exe -m pip check
Set-Location frontend
npm test -- --maxWorkers=1
npm run build
node tests/uploadBuild.mjs
npm ls --depth=0
Set-Location ..
```

The full historical backend command remains `python -B -m pytest tests/ -v`. It requires the private evidence/knowledge/review fixtures at their original ignored paths in an authorized developer workspace; it does not silently invent or skip absent evidence. Clear `MODULE_ROOT` before running that original full suite. No historical assertions have been weakened. A public source-only clone cannot execute evidence-bearing regressions without those separately supplied fixtures.

`npm run build` produces `frontend/dist`; it does not start a server. The public site uses the same-origin Netlify Function in this repository. It needs no separately hosted backend or private evidence. Plain static hosting alone cannot provide analysis. FastAPI is retained as a separate local-development option. A local build does not activate IBM or Milvus merely by being installed; IBM runtime behavior requires explicit server-side configuration.

To create a source-only distribution in a new directory:

```powershell
.\.venvMilvus\Scripts\python.exe -B -m tools.releaseExport --destination .testSourceFreeRelease
```

Only the exact [ReleaseFiles.txt](ReleaseFiles.txt) allowlist is copied. Do not ZIP the working tree, use `git add .`, or build an image from an unrestricted context. The included default-deny `.dockerignore` blocks all files until an image-specific allowlist is reviewed. Export performs path, protected-file, size and recognized-secret checks; human review remains necessary for arbitrary credentials, patient information and ownership.

## Troubleshooting and shutdown

| Problem | What to do |
|---|---|
| Site will not open | Keep both PowerShell windows running and check the ports in the startup output. |
| No topics or provider unavailable | Use the exact synthetic or public competition launcher and verify the reviewed public package files. |
| Port already in use | Stop your own earlier server with Ctrl+C. Do not terminate an unfamiliar process. |
| Input rejected | Check the selections and remove identifying information. Do not replace Unknown with No to bypass validation. |
| Conflict or evidence insufficient | These can be intended safety outcomes. Try a supplied example; do not disable validators or edit evidence to force an answer. |
| Source/knowledge unavailable | Verify the public review pins for competition mode. The private installer is only for legacy private-source operation; never refresh pins to bypass review. |

Backend checks: [health](http://127.0.0.1:8000/health) and [readiness](http://127.0.0.1:8000/ready). Health means the process is alive. Synthetic or competition readiness reflects its local demo dependencies, never authentic clinical approval. Standard mode remains unready.

Press **Ctrl+C in both windows** to stop. Closing the browser alone does not stop the servers.

## What is included

`backend`, `frontend`, `netlify`, `orchestrate`, `shared`, `evaluation`, `tests` and `tools` contain original application code, configuration, public evaluation packages, integration assets, synthetic fixtures and test tools. Requirements and the npm lockfile declare separately installed dependencies. `backend/releaseModules` holds inactive configurations without evidence. `EvidenceSources.example.json` holds only identities, filenames, official links, hashes and claim IDs. `ReleaseFiles.txt` is the exact source-release inventory.

Protected source originals, private source-runtime packages, knowledge documents, intake originals, source-derived review packets, environments, node_modules, builds, screenshots, logs, local coding instructions and historical reports stay untracked. They must not be included in archives, frontend assets or image contexts. Apache 2.0 covers only original project work; it does not grant source rights, trademarks or third-party dependency rights.

## Tester hosting configuration

The public evaluation site runs entirely on Netlify: the React interface calls a same-origin TypeScript Function through `/api/*`. The deterministic core requires no separate backend, provider API key or private evidence installation. Optional watsonx.ai operation requires separately configured server-side IBM credentials. The root `netlify.toml` pins Node 24.21.0, installs and builds through `npm --prefix frontend`, publishes only `frontend/dist`, and supports page refreshes. Its repository-root base keeps function paths consistent. Run `npm ci` and `npm run build` inside `frontend`.

Modules 1 and 2 use the repository's original evaluation summaries and deterministic server-side composition. They are reviewedForEvaluation and competitionReady, never approved for patient care. Original clinical publications are not distributed. FastAPI remains available for local development. See [hosting, health checks, local emulation and rollback](TesterDeployment.md). A failed integrity or availability check keeps Analyze unavailable. No deployment is performed by these files.


## Optional document review

You can add a de-identified PDF, DOCX or TXT note using **Add notes or reports (optional)**. Read the privacy warning first. Files stay in browser memory; original files are not sent to the server or saved by the application.

View the extracted text, review and correct every item, then select **Confirm reviewed information** before **Analyze case**. This does not verify the medical accuracy of the document. Remove names, birth dates, contact details and record numbers yourself; automated screening can miss identifiers.

Use short text documents: up to 1 MB each, three files and 2 MB total. Scans and medical images are unsupported. PDF previews show text and page numbers, not original page layout. Your manual notes plus confirmed text must fit the existing 2,000-character analysis limit. Clear case or refresh removes the upload session.

See [Document review and limits](shared/DocumentReview.md) for supported formats, safety limits and current limitations.


## Endo interface

Endo is the Clinical Evidence Assistant shown in the browser. The centered case workspace keeps explicit module selection, document review and evidence safeguards. The current website does not embed the separate Orchestrate agent and has no Review Companion panel. See [Endo design and accessibility](shared/EndoDesign.md) for the visual system and its differences from the design reference.

Response display and reviewed plain-language wording: see [Response presentation](shared/ResponsePresentation.md).

Protected Netlify Deploy Previews use browser-managed same-origin credentials for `/api/*`, so an existing Netlify login also authenticates API requests. The client never reads or constructs cookies, adds Authorization headers, or sends requests to a cross-origin API target; redirects remain blocked. This does not change server-to-IBM authentication.

## IBM watsonx integrations

The clinical authority remains the deterministic Endo engine. It validates the request, applies safety rules, selects reviewed claims and reconstructs warnings, wording, sources and citations. IBM models cannot replace that analysis or create unrestricted clinical content.

### watsonx.ai presentation modes

The Netlify runtime includes an optional, server-only watsonx.ai presentation adapter. The repository and clean local checkout work without IBM; an authorized hosted environment activates the adapter only through server-side configuration.

- `shadow` sends a bounded public presentation payload, validates the model result and discards it. The visible response remains deterministic.
- `reviewed` accepts only opaque selections from repository-approved presentation variants. The server validates every selection, then reconstructs the exact trusted wording, claim bindings and citations locally.

The presentation adapter never receives raw case narratives, demographics, measurements, uploaded text, filenames, document metadata, patient identifiers, source files, official URLs or browser-generated citation numbers. Urgent, conflicting, clarification, insufficient-evidence and unsupported presentation cases can skip the model and retain deterministic handling. Provider failure, timeout, cancellation or validation failure falls back to the unchanged deterministic response.

See [shadow-mode safeguards](shared/WatsonShadow.md) and [reviewed-mode configuration and rollback](shared/WatsonReviewed.md). Keep IBM credentials and configuration in server-side environment variables only; never place them in frontend or Vite settings.

### watsonx Orchestrate agent

The `orchestrate` directory contains the IBM Bob-assisted integration package:

- An OpenAPI 3.0.3 specification exposing only `GET /api/v1/modules` and `POST /api/v1/analyze`.
- Fail-closed agent instructions requiring the Endo analysis tool for every clinical evaluation.
- Verified synthetic Module 1 and Module 2 demonstration cases.
- Setup, evaluation and deployment documentation.

The Orchestrate agent provides a separate conversational interface. Its IBM agent model can read a de-identified conversation, request an explicit module and build a tool call, but the Endo API remains the clinical authority. The agent must return the API's `renderedText` without adding, removing or modifying clinical content.

This creates a different privacy boundary from the direct website: the website's watsonx.ai presentation adapter does not receive case details, while the Orchestrate agent necessarily processes the de-identified conversation needed to build its tool request. The current Orchestrate integration is therefore for fictional, synthetic and de-identified evaluation only. Do not send uploaded document text, filenames, identifiers or real patient information through the agent. The public evaluation endpoint is not an authenticated clinical service.

IBM Bob was used during development to help prepare the OpenAPI tool specification, agent instructions, synthetic fixtures and integration documentation. Bob is not part of the live case-analysis runtime.

Before any patient-adjacent use, independently review authentication, authorization, rate limiting, audit behavior, IBM retention and data-handling settings, institutional security requirements and applicable healthcare agreements. Embedding the Orchestrate agent into the Endo website would also require server-side token signing and secure key management; it is not enabled by the current frontend.

## Simplified clinician workspace

For a manual case, choose a clinical-module card. Alternatively, a demonstration case loads its reviewed fixture-assigned module and exact fields without submitting. Neither a case nor a module is preselected; Clear case removes the selection. Cards are populated from server discovery, so unavailable modules are never selectable. Workflow order is demonstration selector, module cards, Case narrative, Additional clinical context, optional upload, then Analyze case. Case narrative is the main input. Optional age range, case type, pregnancy/PID status and module-specific findings remain editable under **Additional clinical context**, initially collapsed. Unanswered findings remain unknown. Switching modules clears pregnancy/PID and early-pregnancy context and discards uploads that would need review for the new module; manual narrative is retained for clinician review.

The compact upload control accepts PDF, DOCX or TXT. **File requirements and privacy** explains the limits. After selecting files, confirm they are de-identified, view each file, review its extracted information and explicitly confirm before analysis. The original files and filenames stay in browser memory. Result headings are **Evidence summary**, **Clinical considerations** and **Clinical details and sources**; urgent warnings and prescribing boundaries remain visible first.
