# Public evaluation summaries

These packages contain original, project-authored summaries of clinical facts and guidance for evaluation of the application. They are **not reproductions of, or replacements for, the referenced publications**. Consult the official publications for their complete recommendations, context, currency and terms of use.

Both packages are `reviewedForEvaluation` and `competitionReady`, solely for evaluation and feedback. Neither is approved for clinical care. Sources remain `pendingReview`; `productionApproved` remains false. Authentic module activation and approval are unchanged. FastAPI competition mode and the server-side Netlify evaluation function use these public packages without private source files. The separately installed private graph remains available only through its explicit legacy launcher option. Netlify embeds a verified immutable release snapshot; it does not load evidence from disk or a private service.

**Reviewed with healthcare professionals for evaluation and feedback. Not validated or approved for patient care.**

| Package | Public equivalents | Omitted claims |
| --- | ---: | ---: |
| `modules/module1/claims.json` | 57 | 0 |
| `modules/module2/claims.json` | 21 | 0 |

Stable claim IDs and module ownership are retained. Each claim has independently composed statement and retrieval text, applicability conditions, population, jurisdiction and limitations. Bibliographic metadata and official URLs identify the sources; a URL is not clinical approval, a permission grant or a promise that the link was recently checked. Preserve `urlVerificationStatus`: a stored official URL marked `unresolved` must not become a clickable verified link merely because it appears here.

## Integrity

`integrity.json` pins only the bytes of these two public summary packages. Claim and package `contentHash` fields cover their respective objects with that field omitted, serialized as UTF-8 JSON using sorted keys, no ASCII escaping and compact separators. The manifest SHA-256 covers the actual JSON file bytes, including the final newline. These are new public-artifact pins, not hashes of underlying publications and not replacements for any private package pins. Hashes establish consistency, not medical validity, authorship, copyright clearance or distributed locking.

`review.json` binds evaluation status to the exact public packages, citation metadata and safety/generation implementation. A separately pinned review digest in trusted application code prevents editing this record to refresh status automatically. Availability and final response provenance recheck it; any covered change fails closed until deliberate review and resealing. Application startup and builds never regenerate the pins. This is a release-integrity boundary, not an unforgeable signature against someone authorized to rewrite the entire application.

## Safety boundaries

- Explicit module selection and conflict resolution remain prerequisites.
- The supplied populations, named tests, action strengths, thresholds, exclusions and jurisdictions must remain attached to each proposition. Retrieval text is a search description, not independently sufficient clinical evidence.
- Module 1 preserves distinctions among examination, transvaginal ultrasound, MRI and CA-125; PID disposition requires an explicitly established structured PID status. The oral-temperature disposition threshold is strictly greater than 38.5 Celsius, separate from 38.3 in the diagnostic discussion.
- Module 2 retains the ACEP initial-emergency-assessment population and exclusions; it supplies no individualized serial-testing schedule. NICE pathways retain their UK and gestational scope. FAQ155's explicit emergency-room wording must not be expanded from its named symptoms to the entire serious-symptom list. CDC pregnancy, current-symptom, persistence and provider-access conditions stay separate; postpartum use is not enabled.
- The existing Module 1 emergency detection gate is retained as a platform condition. Its broad detection scope must not be mistaken for direct FAQ action evidence for isolated dizziness or fainting. E01 explicitly limits action coverage: the public runtime fails closed for unsupported isolated patterns, while directly supported symptom combinations retain their warning.
- RCOG and inaccessible ACOG Practice Bulletin 193 claims remain absent. Unsupported action coverage must fail closed, without routine partial output.
- No diagnosis, numerical probability, stage or viability inference, prescribing, dosage or individual treatment selection is authorized.

Only numbered citations and exact eligible public source metadata may reach a response. Private documents, paths, review records and source-file hashes do not belong in these packages. No PDF, HTML capture, intake original or publisher passage is included. The project's Apache licence applies only to its original contributions; it does not license the referenced publications, names, trademarks or other third-party content.

## Review and validation

Run public-only checks from the repository root with the existing Python environment:

```powershell
.\.venvMilvus\Scripts\python.exe -B -m pytest tests/unit/testEvaluationPackages.py -q --noconftest -p no:cacheprovider
```

The public-only command deliberately excludes the historical application's conftest, whose startup fixtures require separately installed evidence. The complete public inventory is `ClaimInventory.csv`. Local private-fixture comparisons emit only claim IDs and check outcomes; no private wording is placed in public snapshots or test fixtures. Checks include source bindings, metadata preservation, individual editorial anchors, negative controls, quotation markers and exact phrase overlap. These tests cannot prove unrestricted semantic equivalence or legal clearance. Evaluation review does not confer authentic clinical approval, regulatory approval or clinical validation.
