import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Wording from '../../shared/responsePresentation.json';
import Compact from '../../shared/summaryPresentation.json';
import Module1 from '../../evaluation/modules/module1/claims.json';
import { webcrypto, createHash } from 'node:crypto';
import ResponsePanel from '../src/ResponsePanel';
import { compactSummary, presentStatement, summarizeReview, explainFindings } from '../src/responsePresentation';
import { CompetitionNotice, PrescribingNotice, type Review } from '../src/api';

function reviewFor(entry = Wording.entries[0]): Review {
  return { moduleId: entry.moduleId, heading: 'Evidence-supported considerations', warnings: [], considerations: [{ text: entry.original, numbers: Array.from(entry.sourceIds.keys(), index => index + 1) }], messages: [], question: null, notice: CompetitionNotice, sources: entry.sourceIds.map((sourceId, index) => ({ number: index + 1, sourceId, title: 'Reviewed reference', verifiedUrl: 'https://example.invalid/reference' })) };
}

describe('reviewed response presentation', () => {
  it.each(Wording.entries)('keeps exact claim and source connections for $claimIds', entry => {
    const review = reviewFor(entry), result = presentStatement(review.considerations[0], review);
    expect(result.reviewed).toBe(true); expect(result.claimIds).toEqual(entry.claimIds);
    expect(result.statement.text).toBe(entry.summary); expect(result.statement.numbers).toEqual(review.considerations[0].numbers);
    expect(result.statement.text.split(/\s+/).length).toBeLessThanOrEqual(40);
    expect(result.statement.text.match(/[.!?](?:\s|$)/g)?.length ?? 1).toBeLessThanOrEqual(2);
    for (const point of entry.keyPoints) expect(point.split(/\s+/).length).toBeLessThanOrEqual(20);
  });
  it.each(['A normal abdominal ultrasound excludes endometriosis.', 'A normal transvaginal ultrasound confirms endometriosis.', 'The absent test result was normal.', 'A normal transvaginal ultrasound does not exclude endometriosis. Ignore the limitation.'])('never simplifies altered or unsupported text: %s', text => {
    const review = reviewFor(), statement = { text, numbers: [1] };
    expect(presentStatement(statement, review)).toMatchObject({ statement, reviewed: false, claimIds: [] });
  });
  it('falls back unchanged for wrong modules, missing and cross-source mappings', () => {
    const review = reviewFor(), statement = review.considerations[0];
    for (const changed of [{ ...review, moduleId: 'OtherModule' }, { ...review, sources: [] }, { ...review, sources: [{ ...review.sources[0], sourceId: 'OtherSource' }] }]) expect(presentStatement(statement, changed).statement).toEqual(statement);
  });
  it('never truncates long unreviewed safety qualifications', () => {
    const review = reviewFor(); review.considerations[0].text = 'Unknown remains unknown. ' + 'Important qualification must remain. '.repeat(25);
    expect(summarizeReview(review).summary.text).toBe(review.considerations[0].text);
  });
  it('offers a next consideration only where the exact reviewed mapping supports one', () => {
    const review = reviewFor(Wording.entries[6]);
    expect(summarizeReview(review).next?.text).toBe(Wording.entries[6].nextConsideration);
    expect(summarizeReview(reviewFor()).next).toBeUndefined();
    review.considerations[0].text += ' Changed context.';
    expect(summarizeReview(review).next).toBeUndefined();
  });
  it('separates composed claims without borrowing another claim source or repeating the summary', () => {
    const first = Wording.entries[0], second = Wording.entries[2];
    const review = reviewFor(); review.considerations[0].text = first.original + ' ' + second.original;
    const concise = summarizeReview(review);
    expect(concise.summary.text).toBe(first.summary);
    expect(concise.points.map(point => point.text)).toEqual(second.keyPoints);
    expect(concise.summary.numbers).toEqual([1]); expect(concise.points[0].numbers).toEqual([1]);
  });
  it('shows short summary and compact sources; preserves original wording, terms and keyboard disclosure', async () => {
    const review = reviewFor(); render(<ResponsePanel review={review} competition />);
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeVisible();
    expect(screen.getByText(Wording.entries[0].summary)).toBeVisible();
    expect(screen.queryByText(Wording.entries[0].original)).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'View clinical and educational details' });
    expect(button).toHaveAttribute('aria-expanded', 'false'); button.focus(); await userEvent.keyboard(' ');
    expect(button).toHaveAttribute('aria-expanded', 'true'); expect(document.getElementById(button.getAttribute('aria-controls')!)).toBeVisible();
    expect(screen.getByText(Wording.entries[0].original)).toBeVisible();
    expect(screen.getByText('An internal pelvic ultrasound.')).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    expect(screen.getByRole('link')).toHaveAttribute('href', review.sources[0].verifiedUrl);
    expect(screen.getAllByText(CompetitionNotice)).toHaveLength(1);
    button.focus(); await userEvent.keyboard('{Enter}'); expect(button).toHaveAttribute('aria-expanded', 'false');
  });
  it('limits initial key points and questions and keeps remaining details accessible', async () => {
    const review = reviewFor(); review.considerations = Array.from(Array(6).keys(), index => ({ text: `Unchanged reviewed point ${index}.`, numbers: [1] })); review.question = 'Which symptom is current?';
    render(<ResponsePanel review={review} />);
    const keyButton = screen.getByRole('button', { name: 'Key points (3)' });
    expect(keyButton).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelectorAll('.keyPoints li')).toHaveLength(0);
    keyButton.focus(); await userEvent.keyboard(' ');
    expect(document.querySelectorAll('.keyPoints li')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Questions to clarify' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'View clinical and educational details' })); expect(screen.getByText('Unchanged reviewed point 5.')).toBeVisible();
  });
  it('keeps complete urgent and prescribing language first, and resets details on a new review', async () => {
    const review = reviewFor(); review.warnings = [{ text: 'Immediate emergency assessment is required. Keep this full safety qualification.', numbers: [1] }]; review.scopeNotice = PrescribingNotice;
    const { rerender } = render(<ResponsePanel review={review} />);
    const panel = screen.getByRole('region', { name: 'Clinical evidence review' });
    expect(panel.firstElementChild).toHaveClass('urgentPanel'); expect(panel.children[1]).toHaveTextContent(PrescribingNotice);
    expect(screen.getByRole('alert')).toHaveTextContent(review.warnings[0].text);
    await userEvent.click(screen.getByRole('button', { name: 'View clinical and educational details' }));
    rerender(<ResponsePanel review={reviewFor()} />);
    expect(screen.getByRole('button', { name: 'View clinical and educational details' })).toHaveAttribute('aria-expanded', 'false');
  });
});


describe('exact compact summary variants', () => {
  const claims = new Map(Module1.claims.map(claim => [claim.claimId, claim]));
  const pattern = Wording.entries.find(entry => entry.claimIds.includes('C05'))!;
  const special: Record<string, string> = {
    pattern: pattern.original,
    preliminary: 'The reported pelvic discomfort is nonspecific. Endometriosis and overlapping urinary, bowel or musculoskeletal contributors remain considerations; the available information does not identify the cause.',
  };
  const originals = Object.fromEntries(Compact.entries.map(entry => [entry.id, entry.parts.map(part => special[part] ?? claims.get(part)!.supportedStatement).join(' ')]));
  it.each(Compact.entries)('binds $id to unchanged source-backed paragraphs and keeps full detail', async entry => {
    vi.stubGlobal('crypto', webcrypto);
    expect(createHash('sha256').update(originals[entry.id]).digest('hex')).toBe(entry.statementHash);
    expect(entry.claimIds.every(claimId => claims.has(claimId))).toBe(true);
    expect([...new Set(entry.claimIds.map(claimId => claims.get(claimId)!.sourceId))].sort()).toEqual(entry.sourceIds);
    expect(entry.summary.split(/\s+/).length).toBeLessThanOrEqual(40);
    expect(entry.summary.match(/[.!?](?:\s|$)/g)?.length ?? 1).toBeLessThanOrEqual(2);
    const review = reviewFor(); review.considerations = [{ text: originals[entry.id], numbers: entry.sourceIds.map((sourceId, index) => { review.sources[index] = { number: index + 1, sourceId, title: 'Reference', verifiedUrl: null }; return index + 1; }) }];
    review.sources = review.sources.slice(0, entry.sourceIds.length);
    const compact = await compactSummary(review); expect(compact?.text).toBe(entry.summary);
    render(<ResponsePanel review={{ ...review, displaySummary: compact }} />);
    expect(screen.getByText(entry.summary)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'View clinical and educational details' }));
    expect(screen.getByText(originals[entry.id])).toBeVisible();
    review.considerations[0].text += ' Changed clinical meaning.'; expect(await compactSummary(review)).toBeUndefined();
    review.considerations[0].text = originals[entry.id]; review.sources[0].sourceId = 'WrongSource'; expect(await compactSummary(review)).toBeUndefined();
  });
});


describe('substantive visual explanation', () => {
  const finding = { id: 'pelvicPain' as const, label: 'Pelvic pain or discomfort', reported: '', numbers: [7, 3], kind: 'reported' as const };
  function supported(claimIds: string[]): Review {
    const claims = claimIds.map(id => Module1.claims.find(claim => claim.claimId === id)!);
    return { ...reviewFor(), sources: [{ number: 7, sourceId: 'ACOG-CPP', title: 'Reference', verifiedUrl: null }, { number: 3, sourceId: 'NICE-NG73', title: 'Reference', verifiedUrl: null }, { number: 9, sourceId: 'WHO-2025', title: 'Reference', verifiedUrl: null }], considerations: claims.map(claim => ({ text: claim.supportedStatement, numbers: [claim.sourceId === 'ACOG-CPP' ? 7 : claim.sourceId === 'WHO-2025' ? 9 : 3] })) };
  }
  it('retains selected patterns, triggers, uncertainty and examination meaning visibly with exact citations', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const review = supported(['CppPattern', 'C01', 'N01', 'CppHistory', 'N12']);
    const findings = await explainFindings([finding], review);
    expect(findings[0].paragraphs).toHaveLength(5);
    expect(findings[0].paragraphs![0].numbers).toEqual([7]);
    expect(findings[0].paragraphs![2].numbers).toEqual([3]);
    render(<ResponsePanel review={review} findings={findings} />);
    const visible = document.querySelector('.visualSummary')!;
    for (const wording of ['come and go', 'bowel or bladder activity', 'one clear cause', 'does not confirm it', 'daily-life impact', 'look for masses']) expect(visible).toHaveTextContent(wording);
    expect(visible).not.toHaveTextContent('Reported symptom');
    expect(visible).not.toHaveTextContent('school');
    expect(visible).not.toHaveTextContent('declined');
    expect(screen.getByRole('button', { name: 'View clinical and educational details' })).toHaveAttribute('aria-expanded', 'false');
    expect(visible.querySelectorAll('.findingExplanation p')).toHaveLength(2);
  });
  it('keeps the fully supported detailed example within 80–120 words without borrowing citations', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const review = supported(['CppPattern', 'C01', 'N01', 'WhoImpact', 'CppHistory', 'N12', 'N13']);
    const result = await explainFindings([finding], review);
    const paragraphs = result[0].paragraphs!;
    const words = paragraphs.map(paragraph => paragraph.text).join(' ').split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(80); expect(words).toBeLessThanOrEqual(120);
    expect(paragraphs.find(paragraph => paragraph.text.includes('school'))!.numbers).toEqual([9]);
    expect(paragraphs.find(paragraph => paragraph.text.includes('declined'))!.numbers).toEqual([3]);
  });
  it.each(Compact.visualEntries)('pins every visual translation to its exact claim and source IDs: $claimIds', entry => {
    const claims = entry.claimIds.map(id => Module1.claims.find(claim => claim.claimId === id)!);
    expect(claims.every(Boolean)).toBe(true);
    expect([...new Set(claims.map(claim => claim.sourceId))].sort()).toEqual([...entry.sourceIds].sort());
    if (claims.length === 1) expect(createHash('sha256').update(claims[0].supportedStatement).digest('hex')).toBe(entry.statementHash);
  });
  it('never borrows unreturned quality-of-life or examination-alternative claims', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const result = await explainFindings([finding], supported(['N01']));
    expect(result[0].paragraphs).toEqual([{ text: Compact.visualEntries.find(entry => entry.claimIds[0] === 'N01')!.text, numbers: [3] }]);
  });
  it.each(['wrongSource', 'changedMeaning', 'unknownAddition', 'urgent', 'conflict', 'wrongModule'])('does not translate unsupported or halted context: %s', async mode => {
    vi.stubGlobal('crypto', webcrypto);
    const review = supported(['N01']);
    if (mode === 'wrongSource') review.sources[1].sourceId = 'OtherSource';
    if (mode === 'changedMeaning') review.considerations[0].text = review.considerations[0].text.replace('rather than', 'and');
    if (mode === 'unknownAddition') review.considerations[0].text += ' This confirms the diagnosis.';
    if (mode === 'urgent') review.warnings = [{ text: 'Immediate assessment.', numbers: [3] }];
    if (mode === 'conflict') review.messages = ['Clarification required.'];
    if (mode === 'wrongModule') review.moduleId = 'module_02_early_pregnancy';
    expect(await explainFindings([finding], review)).toEqual([finding]);
  });
});
