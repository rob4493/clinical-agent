# Shared clinical data contract

The canonical contract is **[clinicalData.schema.json](clinicalData.schema.json), version 1.0.0**. It describes transient, de-identified case information. It is not clinical evidence, a diagnosis, permission to prescribe, or source approval. The optional browser-memory document workflow is described in [DocumentReview.md](DocumentReview.md); timelines, comparison services and Watson document integration remain unimplemented.

## Consumers and synchronization

React validates through the shared adapter and uses the generated pregnancy type. Netlify validates the canonical `LegacyCase` definition or a canonical request before its existing safety pipeline. FastAPI documents both request formats; its native model retains privacy hooks and additionally validates against the shared definition and canonical bridge. Deterministic engines consume the existing compatibility view after this validation. No clinical claim or rule is rewritten.

`tools/schemaSync.py` generates `shared/clinicalData.ts`, `backend/app/models/clinicalData.py` and `shared/schemaArtifacts.json`. Do not edit them independently. The manifest binds exact UTF-8 bytes, including line endings. Run from the root after an explicitly reviewed schema edit:

```powershell
.\.venvMilvus\Scripts\python.exe -m tools.schemaSync
.\.venvMilvus\Scripts\python.exe -m tools.schemaSync --check
```

Frontend test/build preflight verifies these hashes without generating anything. Backend tests regenerate expected bytes in memory and compare legacy constraints with the native model. A shared synthetic corpus exercises both validators. Evaluation integrity also binds shared schema/adapters/validators; changed files invalidate readiness until deliberate review. No build/startup command refreshes evidence seals.

`schemaRules.py` and `schemaRules.ts` implement this bounded local JSON Schema profile. Internal `$ref` values are resolved without network access. Explicit `x-stateValue`, `x-clinicalDate`, `x-sourceSpan`, `x-intent` and `x-caseIntegrity` rules additionally enforce conditional values, calendar dates, span ordering, intent shape, global IDs and reference integrity. **A generic validator that ignores these extensions is insufficient.** Use the provided validators. New schema keywords require implementation/review and cross-runtime tests; they must not be silently ignored.

## Meaning of missingness

| State | Meaning |
| --- | --- |
| `notReported` | No information was supplied. |
| `unknown` | Information explicitly records uncertainty/null. |
| `absent` | An explicit negative/false finding was reported. |
| `present` | An explicit positive/true finding or supplied text/measurement was reported. |
| `notApplicable` | Applicability was explicitly recorded as not applicable. |

Missing information never becomes false, absent, normal, stable, negative or a clinician conclusion. A text/measurement value is allowed only with `present`; supplied wording is not proof of a diagnosis. Empty legacy text is preserved and establishes no clinical finding. Missing/empty arrays contain no reported entries; they do not deny symptoms. Verification is independent: unknown/notReported, unverified, needsReview, clinicianVerified or rejected. Verifying extracted text does not approve evidence or activate a module. Confidence is an optional finite 0–1 number, with no automatic default or clinical probability meaning.

Early-pregnancy enums, nullable booleans and numeric bounds are unchanged. An omitted key is not reported, null is unknown, and false/true are explicit reports. No pregnancy location, viability, stability, test result, trend or date is inferred. Urgent flags/measurements preserve reported values without deriving symptom presence from narrative.

## Backward compatibility and analysis support

`legacyToCanonical` / `canonicalToLegacy` are in `shared/caseBridge.ts` and `backend/app/models/caseBridge.py`. They preserve moduleHint, ageRange, caseType, pregnancyPossible, pidDiagnosedOrPresumed, additionalNotes and earlyPregnancy, plus all existing pain/history/urgent fields. Legacy defaults remain unchanged. Omitted versus null remains distinguishable in the canonical object; both keep their existing unknown clinical behavior in the old engine.

`reportedContext` holds existing free-text pain/history compatibility fields, not inferred symptoms. Narrative is not parsed into findings, dates or conclusions. The existing prescribing detector expressions are shared without changing behavior. Client intent metadata never suppresses server checks.

Canonical analysis accepts the implemented legacy fields, urgent indicators, early-pregnancy context and a separate primary question. That question is appended verbatim only in the analysis view; originalNarrative is unchanged. Combined text must still fit the existing 2,000-character/privacy bounds; nothing is truncated.

The schema validates richer symptoms, tests, procedures, treatments, interpretations, conflicts, missing information and document references. **Populated unsupported collections receive sanitized 422 from analyze**, rather than being silently discarded or treated as validated clinical input. Not-applicable flags that cannot be faithfully represented by the old engine are rejected there too. Rich intent categories not yet consumed cannot silently become clinical instructions. Extending this projection requires explicit safety tests.

Module identifiers are syntax-validated, not approved by the schema. Module availability stays at the registry. Selection is mandatory and explicit; narrative cannot choose/change a module. `NotSure` remains a legacy selection request, not a canonical clinical case.

Serialize Pydantic records with `model_dump(mode="json", exclude_unset=True)` to preserve omitted versus supplied fields. Never log that output or raw validation details. Public errors are fixed/bounded. Schema validation is not a de-identification guarantee; existing privacy checks still apply before analysis, and document extraction requires explicit clinician review; automated screening cannot guarantee de-identification.

## Dates, references and future integrations

Dates distinguish exact, approximate, range, unknown, notReported and notApplicable. Exact/approximate dates explicitly specify day (`YYYY-MM-DD`), month (`YYYY-MM`) or year (`YYYY`) precision. Calendar validity, leap years and years 0001–9999 are checked. Ranges have ordered day endpoints. Relative dates, invalid dates, year zero and invented precision are rejected. Document creation dates must never become test dates or symptom onset by inference.

Item IDs are bounded and unique across a case. Conflicts reference existing interpretation IDs. Source spans reference declared document IDs, with a page and/or ordered text offsets; they carry no private filesystem paths or publication files. Offsets are zero-based, end-exclusive Unicode code-point positions; pages are one-based. Future extractors must use this convention consistently. Media-type metadata does not authorize uploads or medical-image interpretation.

The implemented browser-memory workflow uses a bounded **unverified extraction-result adapter** with document IDs, source spans, explicit unscored confidence and clinician review. Its supported reasoning projection is limited to confirmed reported text. Structured extraction into dates, symptoms, tests, treatments and other rich fields remains a future reviewed extension. Timelines/comparisons must preserve conflicting observations. A future Watson adapter must receive a validated bounded projection, separate untrusted case/document data from instructions, and retain evidence/citation/output validators. No integration may infer module selection, fill gaps, persist case content by default or bypass safety gates.

## Versioning and change proposals

Unknown versions are rejected without coercion/fallback. Proposals need examples, compatibility classification, explicit semantic migration, privacy review and cross-runtime tests. Breaking meaning/required-field/enum/constraint changes need a new major version. Compatible optional additions need a minor version and explicitly supported readers. Documentation-only changes may use a patch version. Readers enumerate supported versions; numbers alone never confer compatibility.

Review effects on missingness, module selection, conflicts, urgent precedence, source ownership, evidence eligibility, prescribing boundaries and payload bounds. Regenerate representations, run conformance/drift/legacy equivalence and complete suites, then review integrity pins. Do not change the 78 claims as a side effect.

## Confirmed document text profile

The authorized upload workflow now projects only clinicianVerified, documentExtracted text observations with verified document references and source spans. The canonical schema remains 1.0.0; filenames, file bytes and review excerpts remain browser-only. Original narrative stays separate. Both servers revalidate and append the reported text verbatim to the bounded compatibility view. Other rich fields remain rejected, not silently ignored. See [DocumentReview.md](DocumentReview.md) for the attestation boundary, privacy limitations and unsupported formats.
