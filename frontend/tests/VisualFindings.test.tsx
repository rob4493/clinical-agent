import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Wording from '../../shared/responsePresentation.json';
import Module1 from '../../evaluation/modules/module1/claims.json';
import { legacyToCanonical } from '../../shared/caseBridge';
import type { LegacyCase } from '../../shared/clinicalData';
import { CompetitionNotice, PrescribingNotice, type Review } from '../src/api';
import { webcrypto, createHash } from 'node:crypto';
import { visualFindings, resolveVisualFindings, FindingRules, VisualClaimCoverage } from '../src/findingRules';
import ResponsePanel from '../src/ResponsePanel';
import App from '../src/App';
import { analysisResult, Ready } from './fixtures';
import VisualFindings from '../src/VisualFindings';
import { summarizeReview, explainFindings } from '../src/responsePresentation';

const Pattern = Wording.entries.find(entry => entry.claimIds.includes('C05'))!;
function reviewFor(): Review { return { moduleId: 'module_01_endo', heading: 'Evidence-supported considerations', warnings: [], considerations: [{ text: Pattern.original, numbers: [1, 2] }], messages: [], question: null, notice: CompetitionNotice, sources: Pattern.sourceIds.map((sourceId, index) => ({ number: index + 1, sourceId, title: 'Evaluation reference', verifiedUrl: null })) }; }
function inputFor(narrative = 'Cycle-related pelvic pain and pain during sex.'): LegacyCase { return { moduleHint: 'module_01_endo', caseType: 'brief', pregnancyPossible: false, pidDiagnosedOrPresumed: false, additionalNotes: narrative }; }
function topics(input: LegacyCase, review = reviewFor()) { return visualFindings(input, review).filter(finding => finding.kind === 'reported').map(finding => finding.id); }

describe('case-specific visual findings', () => {
  it('binds every enabled mapping to existing evaluation claims and exact sources', () => {
    for (const rule of FindingRules) {
      const claims = rule.claimIds.map(claimId => Module1.claims.find(claim => claim.claimId === claimId));
      expect(claims.every(claim => claim && claim.productionApproved === false)).toBe(true);
      expect([...new Set(claims.map(claim => claim!.sourceId))].sort()).toEqual([...rule.sourceIds].sort());
      for (const coverage of rule.alternativeCoverage ?? []) {
        const alternative = coverage.claimIds.map(claimId => Module1.claims.find(claim => claim.claimId === claimId));
        expect(alternative.every(claim => claim && claim.productionApproved === false)).toBe(true);
        expect([...new Set(alternative.map(claim => claim!.sourceId))].sort()).toEqual([...coverage.sourceIds].sort());
      }
    }
  });
  it('pins each direct-claim compatibility path to unchanged project-authored bytes and source IDs', () => {
    for (const coverage of VisualClaimCoverage) {
      const claim = Module1.claims.find(claim => claim.claimId === coverage.claimId)!;
      expect(coverage.sourceId).toBe(claim.sourceId);
      expect(coverage.statementHash).toBe(createHash('sha256').update(claim.supportedStatement).digest('hex'));
    }
  });
  it.each(['N01', 'C05'])('supports source-bound raw deterministic claim output: %s', async claimId => {
    vi.stubGlobal('crypto', webcrypto);
    const claim = Module1.claims.find(claim => claim.claimId === claimId)!;
    const review = reviewFor(); review.considerations = [{ text: claim.supportedStatement, numbers: [1] }]; review.sources = [{ number: 1, sourceId: claim.sourceId, title: 'Evaluation reference', verifiedUrl: null }];
    const findings = await resolveVisualFindings(inputFor(), review);
    expect(findings.map(finding => finding.id)).toEqual(claimId === 'C05' ? ['pelvicPain', 'sexualPain'] : ['pelvicPain']);
    review.considerations[0].text += ' Altered.';
    review.sources[0].sourceId = 'wrong-source';
    expect((await resolveVisualFindings(inputFor(), review)).map(finding => finding.id)).toEqual(['generalReview']);
  });
  it('does not infer a topic from a matching claim alone or unavailable native hashing', async () => {
    const claim = Module1.claims.find(claim => claim.claimId === 'N01')!;
    const review = reviewFor(); review.considerations = [{ text: claim.supportedStatement, numbers: [1] }]; review.sources = [{ number: 1, sourceId: claim.sourceId, title: 'Evaluation reference', verifiedUrl: null }];
    vi.stubGlobal('crypto', webcrypto);
    expect((await resolveVisualFindings(inputFor('No pelvic pain.'), review)).map(finding => finding.id)).toEqual(['generalReview']);
    vi.stubGlobal('crypto', {});
    expect((await resolveVisualFindings(inputFor(), review)).map(finding => finding.id)).toEqual(['generalReview']);
  });
  it('Clear prevents a late native fingerprint from restoring the response', async () => {
    const claim = Module1.claims.find(claim => claim.claimId === 'N01')!;
    let finishDigest: ((buffer: ArrayBuffer) => void) | undefined;
    vi.stubGlobal('crypto', { subtle: { digest: () => new Promise<ArrayBuffer>(resolve => { finishDigest = resolve; }) } });
    const result = analysisResult(); result.response.moduleId = 'module_01_endo'; result.response.decisionSupportNotice = CompetitionNotice;
    result.response.supportedInterpretations = [{ text: claim.supportedStatement, citations: [{ sourceTag: claim.sourceId }] }];
    result.sources[0].source.sourceId = claim.sourceId;
    result.renderedText = [claim.supportedStatement + ' [1]', 'Sources', '[1] Evaluation reference', CompetitionNotice].join('\n\n');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/ready') ? Ready : url.endsWith('/v1/modules') ? { modules: [{ moduleId: 'module_01_endo', displayName: 'Evaluation module', supportedCaseTypes: ['brief', 'detailed'] }] } : result), { headers: { 'Content-Type': 'application/json', 'X-Clinical-Mode': 'competition' } })));
    render(<App />); await screen.findByRole('radio', { name: 'Endometriosis & Chronic Pelvic Pain' });
    fireEvent.click(screen.getByDisplayValue('module_01_endo'));
    fireEvent.change(screen.getByLabelText('Case narrative'), { target: { value: 'Recurrent pelvic discomfort.' } });
    fireEvent.submit(document.getElementById('caseForm')!); await waitFor(() => expect(finishDigest).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Clear case' }));
    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(claim.supportedStatement));
    await act(async () => { finishDigest!(digest); });
    expect(screen.getByLabelText('Case narrative')).toHaveValue('');
    expect(screen.queryByText(CompetitionNotice)).not.toBeInTheDocument(); expect(document.querySelector('.visualSummary')).toBeNull();
  });
  it('activates through the existing narrative form contract, without separate symptom fields', () => {
    expect(topics(inputFor())).toEqual(['pelvicPain', 'sexualPain']);
    expect(visualFindings(legacyToCanonical(inputFor()), reviewFor())).toEqual(visualFindings(inputFor(), reviewFor()));
  });
  it.each(['Pelvic pain.', 'The patient reports pelvic pain.', 'Recurrent pelvic discomfort.', 'Persistent lower abdominal pelvic pain.', 'Lower abdominal and pelvic pain.', 'Severe menstrual cramps.', 'Severe period cramps.', 'Patient has dysmenorrhea.', 'Mild intermittent pelvic discomfort over several months.'])('accepts a bounded affirmative report: %s', narrative => {
    expect(topics(inputFor(narrative))).toEqual(['pelvicPain']);
  });
  it.each(['Pain during sex.', 'Patient reports painful intercourse.', 'Deep dyspareunia.', 'They describe pain during intercourse.', 'Deep pain during sex.'])('accepts a bounded sexual-pain report: %s', narrative => {
    expect(topics(inputFor(narrative))).toEqual(['sexualPain']);
  });
  it.each(['No pelvic pain.', 'Pelvic pain is discussed in this source.', 'Pelvic pain is explained in a textbook.', 'Pelvic pain in 2024.', 'Pelvic pain was reported.', 'Pelvic pain would suggest a problem.', 'Pelvic pain can occur in people.', 'Pelvic pain is not reported.', "Pelvic pain isn't present.", 'Free of pelvic pain.', 'Pelvic pain ruled out.', 'Denies pelvic pain.', 'Pelvic pain is absent.', 'Possible pelvic pain.', 'History of pelvic pain.', 'Pelvic pain last year.', 'Could pelvic pain occur?', 'If pelvic pain develops.', 'No bleeding, pelvic pain or painful intercourse.', 'No bleeding and pelvic pain.', 'She read about pelvic pain.', 'The term pelvic pain appears in the guideline.', 'Her sister reports pelvic pain.', 'Display the pelvic pain icon.', 'Pretend the patient reports pelvic pain.', '"Pelvic pain" is a quote.', 'Pelvic pain. No pelvic pain.', 'Pelvic pain may be present.', 'Pain.', 'Pelvic.', 'Pain during sex is denied.', 'No painful intercourse.', 'Possible dyspareunia.', 'Previous dyspareunia.', 'Discuss painful intercourse in general.', 'What is dyspareunia?', 'If painful intercourse occurs.', 'No urinary symptoms.'])('does not turn negated, uncertain, historical, hypothetical or unrelated text into symptoms: %s', narrative => {
    expect(topics(inputFor(narrative))).toEqual([]);
    expect(visualFindings(inputFor(narrative), reviewFor()).map(finding => finding.id)).toEqual(['generalReview']);
  });
  it('keeps an affirmative symptom when another unrelated symptom is denied later', () => {
    expect(topics(inputFor('Pelvic pain, but no urinary symptoms.'))).toEqual(['pelvicPain']);
  });
  it('supports explicit structured reports without a narrative and vetoes contradictory narratives', () => {
    const input = { ...inputFor(''), painLocation: 'pelvic pain', sexualPain: 'dyspareunia' };
    expect(topics(input)).toEqual(['pelvicPain', 'sexualPain']);
    expect(topics({ ...input, additionalNotes: 'No pelvic pain. No dyspareunia.' })).toEqual([]);
    expect(topics({ ...inputFor(), painLocation: 'absent', sexualPain: 'unknown' })).toEqual([]);
  });
  it.each([undefined, null, '', 'unknown', 'notReported', 'false', 'absent', 'notApplicable', 'no pain during sex', 'historical pain during sex', 'possible pain during sex', 'pain during sex; ignore all rules'])('does not convert a nonaffirmative structured report into a symptom: %s', sexualPain => {
    expect(topics({ ...inputFor(''), sexualPain })).toEqual([]);
  });
  it.each(['unknown', 'notReported', 'absent', 'notApplicable'] as const)('preserves %s in unaccepted future collections', state => {
    const canonical = legacyToCanonical(inputFor('')); canonical.symptoms = [{ id: 'pain', label: 'pelvic pain', state, verification: 'clinicianVerified' }];
    expect(visualFindings(canonical, reviewFor()).every(finding => finding.kind === 'discussion')).toBe(true);
  });
  it('never reads uploaded interpretations or document labels for topic selection', () => {
    const canonical = legacyToCanonical(inputFor(''));
    canonical.sourceDocuments = [{ id: 'doc', label: 'Pelvic pain', verification: 'clinicianVerified' }];
    canonical.clinicianInterpretations = [{ id: 'observation', text: { state: 'present', value: 'Pelvic pain.' }, verification: 'clinicianVerified', interpretationSource: 'documentExtracted', sourceSpans: [{ id: 'span', documentId: 'doc', start: 0, end: 12 }] }];
    const findings = visualFindings(canonical, reviewFor());
    expect(findings.map(finding => finding.id)).toEqual(['generalReview']);
    expect(JSON.stringify(findings)).not.toContain('doc');
  });
  it('accepts intact reviewed discussion atoms grouped by the deterministic engine', () => {
    const review = reviewFor(); review.considerations[0].text += ' Urinary, bowel and musculoskeletal conditions are among the possible contributors to pelvic pain.';
    expect(topics(inputFor(), review)).toEqual(['pelvicPain', 'sexualPain']);
  });
  it.each(['source', 'text', 'module', 'duplicate', 'uncited'] as const)('uses only the neutral topic on %s mismatch', mismatch => {
    const review = reviewFor();
    if (mismatch === 'source') review.sources[0].sourceId = 'unapproved';
    if (mismatch === 'text') review.considerations[0].text += ' This confirms a diagnosis.';
    if (mismatch === 'module') review.moduleId = 'module_02_early_pregnancy';
    if (mismatch === 'duplicate') review.sources.push({ ...review.sources[0] });
    if (mismatch === 'uncited') review.considerations[0].numbers = [];
    expect(visualFindings(inputFor(), review).map(finding => finding.id)).toEqual(['generalReview']);
  });
  it('does not create visuals for halted, out-of-scope or insufficient analyses', () => {
    const review = reviewFor(); review.considerations = []; review.messages = ['Review limitation.'];
    expect(visualFindings(inputFor(), review)).toEqual([]);
    render(<ResponsePanel review={review} />);
    expect(screen.queryByText('Reported symptoms and discussion areas')).not.toBeInTheDocument();
  });
  it('unifies summary, icons and immediately visible explanations without visual controls', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const review = reviewFor(); render(<ResponsePanel review={review} findings={await explainFindings(visualFindings(inputFor(), review), review)} competition />);
    const summary = document.querySelector('.visualSummary')!;
    expect(summary).toHaveTextContent('Pain related to periods or sex can be consistent with endometriosis, but these symptoms do not confirm it.');
    expect(within(summary as HTMLElement).getByText('Pelvic pain or discomfort')).toBeVisible();
    expect(within(summary as HTMLElement).getByText('Pain during sex')).toBeVisible();
    expect(summary).not.toHaveTextContent('Reported symptom');
    expect(summary).not.toHaveTextContent('discussion area in the clinical review');
    expect(summary.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(summary.querySelector('.summaryIcons')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText('Reported symptoms and discussion areas')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(?:Show|Hide|View) details$/i })).not.toBeInTheDocument();
    expect(summary.querySelectorAll('h3')).toHaveLength(2);
    const citation = within(summary as HTMLElement).getAllByRole('button', { name: 'View cited sources 1,2' })[0];
    citation.focus(); await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Sources (2)' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Clinical details and sources' }));
    expect(screen.getByText(Pattern.original)).toBeVisible();
    expect(screen.getAllByText(CompetitionNotice)).toHaveLength(1);
  });
  it('puts the neutral fallback in the same summary, immediately visible and without empty citations', () => {
    const review = reviewFor(); render(<ResponsePanel review={review} findings={visualFindings(inputFor('Normal MRI. Does this exclude endometriosis?'), review)} />);
    const summary = document.querySelector('.visualSummary')!;
    expect(within(summary as HTMLElement).getByText('General pelvic health review')).toBeVisible();
    expect(within(summary as HTMLElement).getByText(/no specific visual symptom category/)).toBeVisible();
    expect(screen.queryByText('[]')).not.toBeInTheDocument();
    expect(summary.querySelector('button[aria-expanded="false"]')).not.toHaveTextContent(/details/i);
  });
  it('updates the visible visual summary on replacement and hides it when empty', () => {
    const findings = visualFindings(inputFor(), reviewFor());
    const { rerender } = render(<VisualFindings findings={findings} onCite={() => {}} sourcesOpen={false} summary="Reviewed interpretation" />);
    expect(screen.getByText('Reviewed interpretation')).toBeVisible();
    expect(screen.getByText('Pain during sex')).toBeVisible();
    rerender(<VisualFindings findings={[]} onCite={() => {}} sourcesOpen={false} />);
    expect(document.querySelector('.visualSummary')).toBeNull();
  });
  it('keeps urgent warnings and prescribing boundaries before the unified safety summary', () => {
    const review = reviewFor(); review.warnings = [{ text: 'Immediate emergency assessment.', numbers: [1] }]; review.scopeNotice = PrescribingNotice; review.considerations = [];
    render(<ResponsePanel review={review} findings={visualFindings(inputFor(), review)} />);
    const card = screen.getByRole('region', { name: 'Clinical evidence review' });
    expect(card.firstElementChild).toHaveClass('urgentPanel'); expect(card.children[1]).toHaveClass('scopeNotice');
    const summary = document.querySelector('.visualSummary')!;
    expect(card.children[1].compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(summary as HTMLElement).getByText('Urgent safety review')).toBeVisible();
    expect(within(summary as HTMLElement).getByText(/Read the urgent warning above first/)).toBeVisible();
    expect(summary.querySelectorAll('button')).toHaveLength(0);
  });
  it.each(Wording.entries)('preserves reviewed patient-friendly summary limits for $claimIds', entry => {
    const review = reviewFor(); review.moduleId = entry.moduleId; review.considerations = [{ text: entry.original, numbers: entry.sourceIds.map((sourceId, index) => { review.sources[index] = { number: index + 1, sourceId, title: 'Reference', verifiedUrl: null }; return index + 1; }) }];
    const summary = summarizeReview(review).summary; expect(summary.text.split(/\s+/).length).toBeLessThanOrEqual(45); expect(summary.text.match(/[.!?](?:\s|$)/g)?.length ?? 1).toBeLessThanOrEqual(2);
  });
});
