import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import Wording from '../../shared/responsePresentation.json';
import ResponsePanel from '../src/ResponsePanel';
import { presentStatement, summarizeReview } from '../src/responsePresentation';
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
