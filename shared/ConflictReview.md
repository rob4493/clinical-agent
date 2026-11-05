# Endo conflict review and integrity maintenance

## Inspection and plan

Before editing the maintenance tool, searched the tracked tools directory, frontend/scripts, frontend/package.json, evaluation/README.md, shared/README.md, shared/WatsonShadow.md, shared/WatsonReviewed.md, TesterDeployment.md, backend integrity code, and backend/frontend integrity tests for reseal/re-seal, review writes, regeneration and ReviewHash. Inspected git ls-tree and git log --all for tools, scripts and integrity documentation; searched history with git log -G for resealing and review-write patterns. The only historical match was the original public runtime commit 55a51e9, which added verification/build preparation, not a maintenance generator. No tracked documented canonical resealing command was found. Existing documentation requires deliberate human review and explicitly prohibits automatic build/startup resealing.

Approved baseline: seven staged files, including the pre-existing Orchestrate fixture. Orchestrate will remain byte-identical. New work will add bounded schema definitions and local review policy, a synthetic report fixture and accessible confirmation dialog, regressions and release inventory entries. Clinical engines and API case contracts remain unchanged. Resolutions stay browser-only and cannot authorize reanalysis: update the case explicitly before resubmitting. No narrative is rewritten or removed.

Plan: validate baseline; implement shared review records and conservative classification; integrate local fixture/dialog/session lifecycle; test focused behavior; test the manually invoked resealer; review non-clinical differences; reseal deliberately; run full frontend/backend, build, dependency, privacy/source-only and browser checks; stage explicit intended paths only. No commit, push or deployment.

## Maintenance command

The maintenance command is tools/reviewReseal.py, using the existing Python runtime. Default invocation is read-only. Writing requires both --write and --acknowledge-reviewed-nonclinical. It preserves all review metadata and checks immutable public claim packages and reviewed wording against the trusted published baseline before any write. It cannot approve clinical changes or create review records. It is never invoked by imports, app startup, tests, build preparation, deployment or runtime bundles.

Review every changed file and its tests first. Inspect the reported paths and hashes, then invoke the explicit write command. Inspect the generated diff and run the ordinary integrity checks and build. A recovery journal protects the three-file update; an interrupted operation must be recovered before another reseal. Runtime validation remains fail-closed during an interrupted multi-file update; filesystem-wide transactionality is not claimed.

## Commands and recovery

Read-only preview from the repository root:

```powershell
.\.venvMilvus\Scripts\python.exe -B -m tools.reviewReseal
```

For explicitly reviewed new non-clinical runtime files, repeat `--add relative/path` for each one. Review the printed changed bindings and target hashes. Writing requires:

```powershell
.\.venvMilvus\Scripts\python.exe -B -m tools.reviewReseal --write --acknowledge-reviewed-nonclinical
```

Pass the same reviewed `--add` arguments to the write invocation. This is a maintenance-only command. It uses standard-library Python and the existing source-only release validator; there is no SDK, credential lookup, directory crawl or network request. Metadata is preserved exactly. There is intentionally no metadata-update option, reviewer-identity entry or approval mechanism. Protected baselines cover both complete public claim packages (57 + 21 claims, including their source bindings), the package-integrity manifest and all three reviewed clinical presentation catalogs. Any changed byte requires a separate clinical-content review outside this tool.

Every file replacement is atomic, and caught failures restore the complete previous three-file set. A process or power interruption cannot be made a filesystem-wide three-file transaction: the `.testReviewResealRecovery.json` journal retains the previous bytes and another reseal refuses to proceed. Keep application readiness closed until recovery and verification. Recover with:

```powershell
.\.venvMilvus\Scripts\python.exe -B -m tools.reviewReseal --recover --write --acknowledge-reviewed-nonclinical
```

Do not delete the journal to bypass recovery. Inspect `git diff -- evaluation/review.json backend/competition/evaluationSeal.py netlify/evaluation/reviewSeal.ts`, verify unchanged clinical packages/catalogs, then run normal integrity tests and `npm --prefix frontend run build`. The journal is local ignored recovery state, never a release artifact. No tool can guarantee rollback if the filesystem itself becomes unwritable; preserve the journal and restore the previous three files together after fixing storage access. The tool never stages, commits, pushes, deploys or runs from application/build hooks.

## Review boundary

Conflict records are optional definitions in the canonical schema, synchronized into TypeScript/Python using `tools/schemaSync.py`. They are not new accepted case-request fields; existing strict case APIs remain unchanged. Only pregnancyPossible and pidDiagnosedOrPresumed are represented. Present, absent, unknown, notReported and notApplicable stay distinct. Only clinician-confirmed opposing present/absent reports qualify for this local review. The comparison retains temporal, context/method and correction differences rather than classifying every difference as a current contradiction. Unknown-versus-absent is not a conflict; different dates, contexts and amended/corrected reports are classified separately and never automatically adjudicated.

The existing conflicting-information fixture retains its exact legacy narrative and structured values. Separate, explicitly synthetic report A/B assertions demonstrate local review. Their confirmation is fixture metadata, not external-document authentication. No arbitrary uploaded report is parsed into status assertions in this slice. Because those fixtures have no in-memory original document preview, no misleading View confirmed source button is shown. The existing upload preview workflow is unchanged.

All seven handling choices remain in the shared contract and require a separate confirmation when supported by metadata. The current final-report fixture shows only the two source choices, keep unresolved and request verification. Options labelled use first/second express intent only: no value is applied to analysis. The confirmation explains that all disputed information remains excluded from reanalysis while analysis is paused. Changed-over-time, different-context, corrected-report, unresolved and verification options never collapse assertions. The local record includes option, concept, original assertion IDs, ISO session timestamp and an optional predefined safe note. A finite note vocabulary excludes free-form identifiers and unsupported clinical instructions. It is not a permanent EHR audit trail.

Clear, form edits, fixture/module changes, upload changes, page lifecycle and unmount release the review state. Original fixture assertions are never mutated. Closing the dialog preserves a Review conflict banner. Urgent warnings returned by the server remain first and visible; a warning must be acknowledged before opening the modal. Ordinary Watson presentation and clinical generation still skip unresolved conflicts on both servers. A separately disabled-by-default Netlify conflict-assistance path may send only static reviewed metadata for the exact synthetic fixture; it never sends original case/report text, browser source labels, resolution notes or uploaded information. See [Watson conflict assistance](WatsonConflict.md). Generic existing conflicts without verified assertion metadata retain the existing safe clarification view.
