# Endo design system

Endo is the user-facing product name. Clinical Evidence Assistant is its descriptive subtitle. Repository/package names, APIs, schema identifiers, module IDs, environment variables, classes and all 78 clinical claims are unchanged.

## Reference and deliberate differences

Endo_Mockup_2.png supplies the visual direction: deep-plum navigation, charcoal workflow bar, warm-cream workspace, blush supporting cards, coral actions, editorial serif headings and restrained botanical line work. The supplied reference image is not distributed with the application. The decoration is original CSS and is hidden from assistive technology.

The navigation links to real case, document, evidence and scope sections. There are no saved cases, login, notifications, profiles, inactive destinations or invented evidence-library controls. Workflow steps reflect the actual case/pending/response state and are not simulated completion buttons.

The real controls replace the reference's broad patient-context chips. Explicit age range, case type, pregnancy/PID and early-pregnancy fields remain unchanged. A single bounded narrative is retained instead of introducing unsupported independent clinical text fields. Documents are operational rather than marked Coming soon. Required privacy, evaluation and decision-support notices remain visible.

Desktop case entry is wide enough for the actual controls and document review. Results appear below centered, single-column case entry. The former Review Companion rail was removed because it repeated form and safety information and could imply a separate reviewer. The main content is capped at 1200 CSS pixels, including padding, on wide screens. Sources themselves remain at the bottom of the response. Analyze and Clear remain in normal document flow so the action area cannot cover labels during long reviews. Compact navigation replaces a drawer on narrower screens, avoiding extra modal controls. The In-memory only indicator remains visible beside the case heading at every width. Mobile document previews occupy the available screen.

## Tokens and components

frontend/src/styles.css is the CSS authority for palette, local font stacks, spacing, borders, radii, shadows, focus, state colors and breakpoints. Primary palette: plum #6D2850, cream #F5EDE4, coral #C95C45, blush #E8B4AA and charcoal #25242A. The primary action uses a darker coral derivative #A83F2D for white-text contrast. Major type uses local Georgia/Times fallbacks; interface text uses Inter when already installed, then system fonts. No webfont, external asset or font-provider request is made.

ReviewShell.tsx contains real-section navigation, the state-driven workflow bar without a separate review companion. Existing App, ResponsePanel, ScopePanel and UploadPanel retain their responsibilities. No clinical validation or parser logic moved into a visual component. The stylesheet and shell are explicitly included in the reviewed evaluation integrity boundary; the build permits that one reviewed stylesheet, not arbitrary CSS inputs. No evidence-original exclusion was relaxed.

Wide layout begins at 1440 CSS pixels. Navigation compacts below 1100, mobile navigation/full-screen dialogs apply below 600. The narrowest navigation can wrap below 360. CSS controls these breakpoints without duplicate JavaScript layout logic.

## Safety and accessibility

Triggered urgent content remains first in the response, with an explicit label, exclamation indicator, strong contrast and role=alert. Prescribing/scope boundaries precede ordinary considerations. A companion explanation of warning priority is not a clinical warning or an assurance of safety. Empty response sections and uncited source headings are not introduced.

The skip link, semantic headings, labels, fieldsets, required selection, focus rings, error associations, status announcements, dialog focus trapping/return and reduced-motion rules remain. Navigation anchors target focusable real sections. Focus order includes the new navigation before the existing scope and case controls; tests retain the previous form assertions and explicitly test the added links. Buttons retain at least 44-pixel touch targets. Text wraps instead of clamping source titles.

Measured text/background contrast pairs are 12.28:1 (ink/cream), 6.44:1 (secondary text/surface), 8.75:1 (cream/plum), 6.15:1 (white/action coral) and 8.62:1 (urgent text/surface). Browser checks include three widths, 320-pixel reflow, an 840-pixel effective layout representing a wide viewport at 200% zoom, and reduced motion. These checks are not a full WCAG certification or physical iPad/Safari validation.

## Preservation and verification

The PDF/DOCX/TXT readers, upload/expansion/text/time limits, confirmation gate, warning acknowledgement, memory cleanup, legacy adapters, canonical schema semantics, module selection, claims, citations and clinical rules are unchanged. Original files remain in browser memory. Only clinician-confirmed bounded text reaches the existing server validation boundary.

Run npm test -- --maxWorkers=1, npm run build, node tests/uploadBuild.mjs, npm ls --depth=0 and reporting-only npm audit from frontend. Run the normal backend suite and pip check through the existing isolated interpreter. Existing guarded evaluationBrowser.cjs and uploadBrowser.cjs remain; endoBrowser.cjs adds branding/navigation/contrast/reflow checks and eight Endo captures. Screenshots are local ignored artifacts in frontend/screenshots; no real case documents are used.

Remaining limitations: local font availability affects exact typography; functional forms and mandatory notices make the page longer than the static reference. The design deliberately has no fabricated evidence summary, persistent case history or account controls. Physical-device, Safari and assistive-technology review remain separate validation steps before deployment approval.
