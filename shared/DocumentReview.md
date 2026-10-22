# De-identified document review

The upload workflow accepts text PDFs, DOCX and UTF-8 TXT. It does not support scans, OCR, images, DICOM or medical-image interpretation. Files are processed only in browser memory; neither server receives original file bytes, filenames or source excerpts. Nothing is persisted by the application.

## Limits and readers

Three files; 1,000,000 bytes per file; 2,000,000 total bytes. One disposable worker runs at a time. The 10-second deadline includes reading the file; cancellation, removal and page lifecycle cleanup terminate the worker. PDF pages are limited to 20. Extracted text is limited to 16,000 Unicode code points and 16 paragraphs/candidates per document. Each candidate is at most 2,000 code points. Confirmed analysis, including manually typed text, must fit the existing 2,000-character analysis limit. Nothing is silently truncated.

PDF.js 6.4.299 extracts page text, with verbosity disabled, no font rendering, no WASM, no image rendering and no document URL. A conservative preflight admits unfiltered or single FlateDecode streams with direct lengths, rejecting object/xref streams, escaped PDF names, unsupported filters, indirect stream lengths, encryption and active-content markers. Decoded streams have a 1 MB per-stream, 4 MB aggregate and 100:1 expansion ceiling before PDF.js runs. Catalog/page action and attachment checks also run. Some otherwise valid PDFs are deliberately unsupported; export a simple text PDF or TXT instead. This is a restricted text-reader profile, not a general-purpose PDF sanitizer.

DOCX uses fflate 0.8.3 and saxes 6.0.0. ZIP metadata is checked before decompression: 128 entries, 1 MB per expanded entry, 4 MB total, 100:1 expansion ratio. Paths, duplicate names, symlinks, encryption, unsupported methods, inconsistent headers and CRC failures are rejected. XML parsing rejects DTDs, declarations, external relationships, embedded objects, macros, unsupported binary members and excessive depth. Paragraphs and table-cell paragraphs are read in document order. No document links are opened.

TXT requires valid UTF-8 (optional BOM). Binary signatures, unsafe control characters and empty text are rejected. No encoding is guessed.

These are input/expansion/text/time budgets, **not a browser-process hard heap quota**. Browser workers have no portable hard memory-limit API. Workers are terminated on deadline; no claim of protection from every browser/parser vulnerability is made. The approved parser versions must continue receiving vulnerability review.

## Preview and review

Every file has View uploaded file. The dialog shows escaped text; PDF pages have navigation and page-local text search. PDF visual layout/images are not rendered. DOCX formatting is not preserved. Unsafe/unreadable files receive a bounded explanation. Raw PDFs are never embedded and no file object URL is created, so there is no document object URL to leak or revoke. Close returns focus to the originating button; Escape and keyboard focus cycling are supported.

The clinician must acknowledge de-identification, view each original text preview, open the review panel, edit/remove/add reported text as needed, then explicitly confirm. Files or candidate edits invalidate confirmation. Original text remains separate from editable observations. All observations start unverified; confidence is explicitly **not scored**, rather than an invented clinical probability. Unicode code-point spans and reliable page/paragraph references point into normalized extracted text, not binary byte offsets. A manually added observation has a document-wide span and must be verified against that document.

Identifier screening produces category/location warnings for common email, phone, labeled record/account/insurance, labeled birth-date, postal-address and labeled patient-name patterns. Warnings repeat no matched value. Review acknowledgement does not redact the original or bypass server privacy validation. Screening is incomplete and does not guarantee de-identification.

Clear case, discard, removal, pagehide/pageshow and unmount release file references and cancel parsing. No browser storage, analytics, external extraction service, model call or document-driven fetch is added. JavaScript garbage collection controls when released memory is reclaimed; this is not guaranteed secure erasure.

## Schema and server boundary

Schema 1.0.0 is unchanged. The conservative extraction profile stores complete reported paragraphs as documentExtracted observations in clinicianInterpretations. It does not infer diagnoses, structured symptoms, dates, urgent flags, pregnancy, PID, stability, test results or module selection. The clinician's manually selected module stays authoritative.

Confirmed sourceDocuments use generated IDs as labels; display filenames and excerpts remain browser-only. DOCX mediaType is omitted because schema 1.0.0 does not define that MIME value. File type is still checked by the upload reader. Verification is not evidence approval or document authentication.

Both canonical adapters require clinicianVerified observations/documents, explicit documentExtracted origin, present nonempty text and valid source spans; unreferenced documents are rejected. They project verified text verbatim after the original narrative into the existing engine's bounded analysis view. User intent is rechecked over the combined text. The original canonical narrative remains unchanged. Unsupported structured collections/dates receive sanitized 422 rather than being ignored. Existing privacy, conflict, urgent, prescribing, evidence/citation, module-isolation and cancellation safeguards still execute server-side. Confirmation is a clinician attestation, not proof of external authorship or tamper resistance.

Files never reach Netlify or FastAPI; only confirmed bounded canonical JSON does. No upload endpoint, disk storage, temporary publication, source approval or clinical activation was added. Legacy requests remain equivalent and all 78 claim bytes are protected by regression hashes.

## Local verification

From frontend, run npm test -- --maxWorkers=1, npm run build, node tests/uploadBuild.mjs, npm ls --depth=0 and reporting-only npm audit. Do not run npm audit fix automatically. From the repository root, run .venvMilvus/Scripts/python.exe -m pytest -q with a fresh workspace-local --basetemp and .venvMilvus/Scripts/python.exe -m pip check. Browser helpers tests/evaluationBrowser.cjs and tests/uploadBrowser.cjs require the existing external Playwright test tooling and a local Netlify origin; they never upload authentic documents. Keep screenshots and reports in the ignored frontend/screenshots directory. Use only synthetic documents when testing.
