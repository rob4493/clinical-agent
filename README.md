# Clinical Evidence Assistant

A local demonstration that helps healthcare professionals review case information alongside supporting medical evidence. You can explore it without medical expertise by loading the supplied example cases.

**Use fictional cases only. This application is not approved for patient care.** It does not diagnose, estimate disease probability, infer disease stage or pregnancy viability, prescribe, provide medication doses, or choose treatment for a person.

## What works today

- A React website connected to a FastAPI backend.
- Explicit topic selection, structured case fields and editable examples.
- Conflict and clarification checks, predefined urgent warnings, evidence retrieval and citation validation.
- Concise responses, relevant source links and safe evidence-insufficient outcomes.
- Two competition topics: **Endometriosis and Chronic Pelvic Pain** and **Early Pregnancy Pain and Bleeding**.

The competition topics use separate, identity-verified evidence packages. Their eligibility for controlled evaluation does **not** approve the sources for authentic clinical use. All four authentic clinical modules remain inactive and pending review. The language provider is simulated in the offline evaluator; IBM and Milvus are not connected.

Original project code and original documentation are licensed under **Apache License 2.0**. Clinical sources, publisher files, knowledge documents and complete source-derived claim packages are **not distributed or licensed by this repository**. See [licensing boundaries](THIRD_PARTY_NOTICES.md).

A clean clone can run the fictional synthetic demo without private files. The two competition topics require a separately authorized private evidence installation; downloading this repository does not provide that evidence or permission to use it. See [private evidence installation](EVIDENCE_INSTALLATION.md) and the exact metadata-only [file inventory](EvidenceSources.example.json).

## Before you start

Use **Windows PowerShell**, **Python 3.12**, and **Node.js 24.15.0 or later within Node 24** with npm. The existing environment was checked with Node 24.21.0 and npm 11.19.0. Linux and macOS dependency installation have not been verified.

You need internet access for initial dependency installation. The offline application does not need an IBM account, API keys, Docker, a running Milvus service or a real `.env` file.

After this source-free release is published, download it through GitHub or use:

```powershell
git clone https://github.com/rob4493/clinical-agent.git
Set-Location clinical-agent
py -3.12 --version
node --version
npm --version
```

If you already have this project, open its existing folder instead. The folder must contain `backend`, `frontend`, `tests` and this README.

## Install once

Run these commands from the project folder in a fresh checkout. The Python environment stays inside the project; nothing is installed globally. If `.venvMilvus` already exists, reuse it rather than overwrite it.

```powershell
py -3.12 -m venv .venvMilvus
.\.venvMilvus\Scripts\python.exe -m pip install -c backend/constraintsMilvus.txt setuptools==81.0.0 -r backend/requirements.txt -r backend/requirementsTest.txt
.\.venvMilvus\Scripts\python.exe -m pip check
Set-Location frontend
npm ci
Set-Location ..
```

`pip check` should report `No broken requirements found.` Keep the declared versions and lockfile. If installation fails, stop and retain the error; do not use `--force`, `--legacy-peer-deps`, overrides or automatic dependency fixes. The Python requirements pin direct versions but do not fully lock transitive packages; a future clean installation may require compatibility review. No dependency installation was performed during push preparation.

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

Open **[http://127.0.0.1:5173/](http://127.0.0.1:5173/)** on the same computer. Confirm the persistent synthetic banner. Select the synthetic topic, load an example, review the dropdowns and select **Analyze**. The fictional evidence demonstrates workflow, not medical guidance. **Clear case** removes the case and response and cancels an active request. Missing information stays Unknown; a conflict or evidence limitation may be the intended outcome.

The launcher explicitly selects an inactive, source-free authentic registry and an isolated fictional graph. No protected documents, IBM account or external provider are needed. `--mode standard` instead keeps discovery empty and readiness at 503. Do not point a default `uvicorn backend.app.main:app` command at missing private source configurations.

## Run competition Modules 1 and 2

An authorized administrator must first follow [private evidence installation](EVIDENCE_INSTALLATION.md). The public repository intentionally cannot recreate protected packages from hashes or official links. Once the complete private installation is verified:

```powershell
.\.venvMilvus\Scripts\python.exe -B -m tools.runDemo --mode competition --private-root C:\clinicalPrivateEvidence
```

Use the same frontend command above. Confirm **Competition evaluation mode** and explicitly select **Endometriosis and Chronic Pelvic Pain** or **Early Pregnancy Pain and Bleeding**. The injected deterministic language provider is simulated; authentic sources remain pending review and authentic modules inactive. Missing or altered evidence prevents startup. Never edit hashes to force a download to match.

Keep age range and case type in dropdowns rather than repeating them in the narrative. Pregnancy and PID have Yes, No and Unknown states; PID means pelvic inflammatory disease, and this field records a clinician-reported diagnosis rather than one made by the app. Module 2 has additional pregnancy-test and ultrasound context. Responses use numbered citations with sources at the bottom. Absence of a warning does not prove safety.

Both commands bind only to localhost and disable access logs. They are offline local evaluation launchers, not public deployment commands. No live model or vector client is created.

## Privacy and response limitations

Do not enter names, exact birth dates, contact details, addresses, record numbers or real patient information. Case state stays in browser/request memory. There is no browser persistence, case database, analytics or intentional case/prompt/evidence/model-output logging. Clear and refresh remove the interface state. Privacy filtering is not a substitute for removing identifiers yourself.

Missing information remains Unknown. Conflicting facts stop analysis. Urgent source conditions, including pregnancy state, symptom timing, dizziness duration and access conditions, are not generalized. Sources retain their date, jurisdiction and population limits. Only cited verified URLs become links; other sources use an internal details panel.

Natural paraphrases are checked against bounded supported propositions, not accepted merely because they contain relevant words. Unrecognized wording can fail closed even when it might be clinically reasonable. No claim of diagnostic accuracy, HIPAA compliance, regulatory approval or production readiness is made.

## Check the installation

Source-free backend checks run against the explicit inactive registry:

```powershell
$env:MODULE_ROOT = (Resolve-Path backend/releaseModules).Path
.\.venvMilvus\Scripts\python.exe -B -m pytest tests/unit/testEvidenceInstallation.py tests/unit/testSyntheticDemo.py -v
.\.venvMilvus\Scripts\python.exe -m pip check
Set-Location frontend
npm test
npm run build
npm ls --depth=0
```

The full historical backend command remains `python -B -m pytest tests/ -v`. It requires the private evidence/knowledge/review fixtures at their original ignored paths in an authorized developer workspace; it does not silently invent or skip absent evidence. Clear `MODULE_ROOT` before running that original full suite. No historical assertions have been weakened. A public source-only clone cannot execute evidence-bearing regressions without those separately supplied fixtures.

`npm run build` produces `frontend/dist`, not a running server. It contains no source files or claim packages. A future static host needs a same-origin `/api/*` reverse proxy preserving runtime headers, TLS, access controls and disabled body logging. A controlled competition deployment can mount verified evidence privately after image creation; it must never bake it into image layers. No deployment or live-provider connection is performed by these instructions.

To create a source-only distribution in a new directory:

```powershell
.\.venvMilvus\Scripts\python.exe -B -m tools.releaseExport --destination .testSourceFreeRelease
```

Only the exact [ReleaseFiles.txt](ReleaseFiles.txt) allowlist is copied. Do not ZIP the working tree, use `git add .`, or build an image from an unrestricted context. The included default-deny `.dockerignore` blocks all files until an image-specific allowlist is reviewed. Export performs path, protected-file, size and recognized-secret checks; human review remains necessary for arbitrary credentials, patient information and ownership.

## Troubleshooting and shutdown

| Problem | What to do |
|---|---|
| Site will not open | Keep both PowerShell windows running and check the ports in the startup output. |
| No topics or provider unavailable | Use the exact synthetic launcher, or verify the private installation before competition startup. |
| Port already in use | Stop your own earlier server with Ctrl+C. Do not terminate an unfamiliar process. |
| Input rejected | Check the selections and remove identifying information. Do not replace Unknown with No to bypass validation. |
| Conflict or evidence insufficient | These can be intended safety outcomes. Try a supplied example; do not disable validators or edit evidence to force an answer. |
| Source/knowledge unavailable | Follow the private installation inventory; synthetic mode needs no clinical sources. Do not resave documents or refresh checksums casually. |

Backend checks: [health](http://127.0.0.1:8000/health) and [readiness](http://127.0.0.1:8000/ready). Health means the process is alive. Synthetic or competition readiness reflects its local demo dependencies, never authentic clinical approval. Standard mode remains unready.

Press **Ctrl+C in both windows** to stop. Closing the browser alone does not stop the servers.

## What is included

`backend`, `frontend`, `tests` and `tools` contain original application code, configuration, synthetic test fixtures and test tools. Requirements and the npm lockfile declare separately installed dependencies. `backend/releaseModules` holds inactive configurations without evidence. `EvidenceSources.example.json` holds only identities, filenames, official links, hashes and claim IDs. `ReleaseFiles.txt` is the exact source-release inventory.

Protected source originals, complete clinical packages, knowledge documents, intake originals, source-derived review packets, environments, node_modules, builds, screenshots, logs, local coding instructions and historical reports stay untracked. They must not be included in archives, frontend assets or image contexts. Apache 2.0 covers only original project work; it does not grant source rights, trademarks or third-party dependency rights.

## Tester hosting configuration

The root `netlify.toml` builds from `frontend` and publishes only `frontend/dist`, with Node 24.21.0. It includes SPA navigation and an API-unavailable fallback. Until an actual backend is assigned and its same-origin proxy is enabled, **Analyze stays disabled**. Setting `VITE_BACKEND_URL` does not configure a production Netlify proxy.

See [tester deployment instructions](TesterDeployment.md) for the commented proxy placeholder, the Python host command using its assigned `PORT`, private read-only evidence installation, health checks and prerequisites. No backend address is assumed and no hosting deployment is performed by these files. Clinical sources must never enter Git, the static site or an image layer.
