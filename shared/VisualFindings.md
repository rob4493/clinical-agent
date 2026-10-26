# Unified visual Summary: narrative-form presentation boundary

Endo's normal narrative form now drives the combined visual Summary after each successful in-scope analysis. The same accepted request and deterministic result are used; no new API, symptom field, schema, clinical rule, evidence selection, upload parser or claim is introduced.

## Exact reviewed display triggers

`frontend/src/findingRules.ts` is the centralized typed mapping. Each symptom rule records its visual ID, patient-friendly and clinical labels, supported legacy/canonical field, accepted explicit values, bounded narrative phrase expression, required existing claim IDs/source IDs, citation coverage and reported-topic status. Obsolete hidden explanations, clinical-label duplicates and detail-target metadata have been removed. Original SVG components in FindingIcon.tsx supply pelvic-pain, sexual-pain and neutral discussion symbols. The reference sheet is not bundled.

An affirmative input signal alone is insufficient. A successful, module-consistent result must satisfy one of these source-bound coverage paths:

- The existing reviewed N01/C05 discussion sentence with NICE-NG73 and ACOG-CPP citation coverage. Whole reviewed statements keep their exact mapping; deterministic paragraphs grouping that intact complete sentence with other evidence are compatible too.
- Direct project-authored N01 (pelvic topic) or C05 (pelvic/sexual-pain topic) sentences whose native SHA-256 fingerprints and exact cited source IDs match the typed VisualClaimCoverage table. These are claim-text fingerprints, not source-file hashes. No complete claim package is added to the frontend.
- The existing nonspecific pelvic-discomfort synthesis (N01/C01/C11, NICE-NG73 and ACOG-CPP), for the pelvic topic only.

This presentation check does not validate or paraphrase the rest of the clinical response: the unchanged server remains responsible for clinical grounding. resolveVisualFindings uses native Web Crypto asynchronously; if it is unavailable or fails, the neutral visual remains. App rechecks cancellation and request generation after hashing, so a late result cannot restore cleared state.

The two input paths are:

1. Explicit structured report: painLocation exactly `pelvic` or `pelvic pain`; sexualPain exactly `pain during sex` or `dyspareunia`. These are existing supported fields, not new schema enums.
2. Affirmative narrative report: a clause beginning with a reviewed symptom phrase, optionally preceded by a bounded report subject/verb (patient/person/individual/she/they/he reports/describes/has/experiences/presents with; reports/reported/experiencing/having/presents with; symptoms include; age-year-old with/reports/has) and/or current/ongoing/recurrent/persistent/intermittent/cyclic/cyclical/cycle-related/period-related/severe/mild/moderate/chronic/sudden/acute/deep/worsening modifiers.

Pelvic phrase forms: pelvic pain or discomfort; lower abdominal pelvic pain, lower abdominal/pelvic pain or lower abdominal and pelvic pain; menstrual cramps, severe menstrual cramps, period cramps, severe period cramps; dysmenorrhea. Sexual-pain forms: pain during sex/intercourse, painful sex/intercourse, dyspareunia/deep dyspareunia, deep pain with/during sex/intercourse. Only those two visual categories are active. A report may end at the phrase or continue with the bounded timing/context forms over/for/since/during/with/throughout/lasting/affecting/associated with, a reported severity out of 10, or is present/reported/ongoing/persistent/recurrent/severe/mild/moderate/intermittent/constant/worse/worsening/cyclic/cyclical. Unsupported continuations (for example a source definition or a detached year) are excluded. A full report phrase plus compatible deterministic output is required; a word such as pain, sex, pelvic or a source reference alone is insufficient.

Narrative clauses are bounded by sentence punctuation/newlines, commas and conjunctions. Negation/uncertainty/history/hypothetical/quotation/instruction/generic-source or unrelated-person context suppresses that topic, including negated lists. A contradictory, historical, uncertain or negated occurrence suppresses that category even if another occurrence is affirmative. Negative list context carries across commas/and until a new explicit report or contrast resets it. Questions mentioning the symptom are not affirmative reports. This deliberately conservative grammar may fall back for complex or unsupported wording instead of guessing. Structured/narrative disagreement suppresses the topic. Missing information is never converted to a negative finding.

Only originalNarrative/legacy additionalNotes typed by the clinician is classified. Native hashes cover already-returned evidence-bound result sentences, never documents or narrative. No uploaded document, filename, source label, source span, extracted observation or unconfirmed text is read by the visual selector. Unknown/absent/notReported/notApplicable/false remain distinct. Future unaccepted canonical collections remain rejected by the existing projection.

## Success fallback and safety ordering

If no specific mapping is supported, a neutral General pelvic health review visual is always shown for a successful result, including Module 2. It does not assert symptom presence or absence and has no invented citation. Conflict, clarification, out-of-scope, evidence-insufficient and provider failures do not receive success visuals. Successful urgent results show only an Urgent safety review discussion visual after the intact warning and scope boundary. It adds no clinical assessment or routine considerations.

Placement: urgent warning, prescribing/scope boundary, combined visual and patient-friendly Summary, then existing next consideration/key points/educational details/sources. Existing educational prose, citation mappings, URLs, all nine short-summary variants and all 78 clinical claims are unchanged. No diagnosis, treatment recommendation, source approval, or clinical urgency is inferred from a visual.

## Unified summary and privacy

VisualFindings.tsx renders each finding name as a heading beside its decorative icon and a substantive, immediately visible patient-friendly explanation. It removes the Reported symptom badge and generic discussion-area filler. Icons remain aria-hidden; adjacent text carries the meaning. Citation buttons open the existing source disclosure with keyboard or touch.

The fixed visualEntries in shared/summaryPresentation.json bind each translation to exact project-authored claim-text SHA-256 fingerprints, claim IDs, source IDs and eligible visual categories. explainFindings reads only returned considerations and source metadata, never the case narrative or uploads. Complete sentence-span coverage and complete cited-source coverage are required for each translated paragraph. Altered wording, added qualifications, missing sources or unknown text prevent that paragraph from being translated. Duplicate atoms are deduplicated. No model paraphrasing or new retrieval occurs.

The returned evidence determines which details can appear. CppPattern supports continuous/intermittent pain and its timing/triggers; C01 supports overlapping contributors and unresolved cause; N01/C05 preserve diagnostic uncertainty; CppHistory supports daily impact and focused history; N12 supports examination findings. N13 supports the UK examination alternative only when actually returned. WhoImpact supports school/work/sexual wellbeing and the limitation on inferring extent only when returned. These details are not borrowed from another claim merely because its source was cited. The user's illustrative paragraph is therefore not inserted as a universal template.

Explanations use at most two paragraphs per finding. Approximately 80–120 words is a target when selected evidence supports that detail, not a minimum: narrow evidence stays shorter and more extensive supported qualifications are not truncated. Multiple findings may share relevant context without inventing a distinct clinical conclusion. Unmapped results preserve the existing summary instead of generating new language; their finding heading remains visible. Original complete considerations and citation mappings remain unchanged in the collapsed clinical and educational details. Urgent results never receive ordinary translated symptom explanations.

The redundant bottom Explore cases section and its exclusive styles were removed. The native Try a demonstration case dropdown, shared DemoCases/PregnancyCases definitions, field-prefilling behavior and all supported presets remain operational. Tests and browser harnesses use that retained dropdown.

The existing cancellation/generation guards run before a completed result can create the summary. It remains in component memory only and clears with the response, Clear, refresh, form edits, upload changes or replacement requests. No persistence, logging, telemetry, provider decision or external request was added. The presentation files remain integrity-pinned; changing them invalidates the review seal until deliberately reviewed and tested.

## Inactive categories and limitations

Food/digestive patterns, digestive issues, ovulation pain, fatigue, back/leg/chest symptoms, fertility, urinary symptoms and irregular cycles stay inactive pending reviewed mappings. No hidden icons or placeholders are displayed. Module 2 has a neutral discussion visual only. A neutral visual is not an evidence-insufficient clinical outcome and does not replace the original server result.

This is a bounded visual topic classifier, not general NLP, a symptom extractor, diagnostic inference or a new clinical decision engine. Complex sentences, alternative spellings, mixed/uncertain assertions, absent compatible output or an unsupported phrase yield the neutral visual. No source approval or clinical validation is implied. The original nine short-summary mappings remain unchanged. shared/summaryPresentation.json adds eight exact paragraph-fingerprint/source-bound short display variants for known Module 1 result compositions. These remain a fallback for results without a supported substantive visual explanation. Original complete paragraphs remain in the educational disclosure; no dynamic paraphrasing is used. Other unmatched wording remains intact rather than being truncated.

## Verification

Run `npm test -- --maxWorkers=1`, `npm run build`, `node tests/uploadBuild.mjs` in frontend. `visualBrowser.cjs` uses already-installed Playwright via DEMO_PLAYWRIGHT_MODULE and EVALUATION_ORIGIN (loopback 8892 by default). It exercises the normal production form through the actual Netlify Function, with no injected fields, response mocks or component replacement, at desktop/tablet/mobile widths. It covers affirmative narratives, the existing Brief/Mild/Detailed presets, neutral fallback, negation, uncertainty, urgent ordering, halted/outside-scope outcomes, keyboard/tap citation and educational controls, immediately visible explanations, reduced motion, Clear and no persistence. Screenshots/reports remain ignored local artifacts.
