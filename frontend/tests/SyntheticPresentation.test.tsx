import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import ResponsePanel from '../src/ResponsePanel';
import { DecisionNotice, DemoNotice, SyntheticNotice, readReview } from '../src/api';
import { Modules, Ready, analysisResult } from './fixtures';

function mockDemo(outcome: string) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/v1/modules') ? Modules : url.endsWith('/ready') ? Ready : analysisResult(outcome)), { headers: { 'Content-Type': 'application/json', 'X-Clinical-Mode': 'synthetic' } })));
}

describe('synthetic presentation without clinical approval claims', () => {
  it.each(['AgentResponse', 'DataConflict', 'ClarificationRequired', 'EvidenceInsufficient'])('shows one banner, one response label and the synthetic notice for %s', async outcome => {
    mockDemo(outcome); render(<App />);
    await screen.findByText(DemoNotice);
    await userEvent.click(screen.getByDisplayValue('FictionalModule'));
    await userEvent.click(screen.getByRole('button', { name: 'Analyze case' }));
    expect(await screen.findByText('Synthetic demonstration response')).toBeVisible();
    expect(screen.getAllByText(DemoNotice)).toHaveLength(1);
    expect(screen.getAllByText('Synthetic demonstration response')).toHaveLength(1);
    const panel = screen.getByRole('region', { name: 'Clinical evidence review' });
    expect(panel.lastElementChild).toHaveTextContent(SyntheticNotice);
    expect(panel).not.toHaveTextContent(/approved knowledge base|approved evidence|clinically validated|evidence-supported|authentic clinical evidence/i);
    expect(screen.queryByText(DecisionNotice)).not.toBeInTheDocument();
    expect(panel).not.toHaveStyle({ minHeight: '580px' });
    expect(panel.style.minHeight).toBe('');
    expect(panel).not.toHaveTextContent(/no urgent warning|no urgent issues/i);
    if (outcome === 'AgentResponse') {
      expect(screen.getByRole('heading', { name: 'Evidence summary' })).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
      const source = screen.getByRole('button', { name: '[1] View source details' });
      expect(panel).not.toHaveTextContent(/fictional example|fictional demonstration source/i);
      expect(source).not.toHaveAttribute('href');
      expect(source).toHaveAttribute('type', 'button');
      source.focus(); expect(source).toHaveFocus();
    }
  });
  it('validates the original server-controlled contract notice before synthetic display projection', () => {
    expect(readReview(analysisResult(), true).notice).toBe(SyntheticNotice);
    expect(readReview(analysisResult()).notice).toBe(DecisionNotice);
    const invalid = analysisResult(); invalid.response.decisionSupportNotice = 'Invented notice';
    expect(() => readReview(invalid, true)).toThrow();
  });
  it('retains warning-first order and shows a follow-up only when returned', () => {
    const payload = analysisResult('AgentResponse', true);
    payload.renderedText = payload.renderedText.replace('\n\nSources', '\n\nIs the structured context correct?\n\nSources');
    const { rerender } = render(<ResponsePanel review={readReview(payload, true)} synthetic />);
    const panel = screen.getByRole('region', { name: 'Clinical evidence review' });
    expect(panel.firstElementChild).toHaveClass('urgentPanel');
    expect(screen.getByRole('heading', { name: 'Questions to clarify' })).toBeVisible();
    expect(screen.getByText('Is the structured context correct?')).toBeVisible();
    rerender(<ResponsePanel review={readReview(analysisResult(), true)} synthetic />);
    expect(screen.queryByRole('heading', { name: 'Questions to clarify' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('does not reserve stale panel height or add decorative icons during loading', () => {
    render(<ResponsePanel review={null} synthetic pending />);
    const panel = screen.getByRole('region', { name: 'Evidence review' });
    expect(panel).toHaveAttribute('aria-busy', 'true');
    expect(panel.style.minHeight).toBe('');
    expect(panel.querySelector('[aria-hidden]')).toBeNull();
    expect(panel).not.toHaveTextContent(/approved evidence|not for clinical care/i);
  });
});
