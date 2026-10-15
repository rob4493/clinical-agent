import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import ResponsePanel from '../src/ResponsePanel';
import { readReview, DecisionNotice } from '../src/api';
import { CompetitionBanner, CompetitionNotice } from '../src/api';
import { analysisResult, Modules, Ready } from './fixtures';

function reply(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', 'X-Clinical-Mode': 'competition' } });
}

function mockCompetition(outcome = 'AgentResponse', unavailable = false) {
  const result = analysisResult(outcome);
  result.response.decisionSupportNotice = CompetitionNotice;
  result.renderedText = result.renderedText.slice(0, result.renderedText.lastIndexOf('\n\n') + 2) + CompetitionNotice;
  if (result.sources.length) result.sources[0].source.verifiedUrl = null as unknown as string;
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/v1/modules')) return reply(Modules);
    if (url.endsWith('/ready')) return reply(unavailable ? { status: 'notReady', reasonCode: 'analysisUnavailable', availableModuleCount: 1 } : Ready, unavailable ? 503 : 200);
    if (url.endsWith('/v1/analyze')) return reply(result, outcome === 'ProviderUnavailable' ? 503 : 200);
    if (url.includes('/v1/competition/sources/')) return reply({ title: 'Fictional reference', organization: 'Synthetic organization', date: '2026', sourceType: 'Synthetic document', captureStatus: 'Synthetic browser capture', status: 'Competition-eligible evidence', statements: ['Synthetic evidence statement'], limitations: 'Synthetic limited scope', jurisdiction: 'Synthetic jurisdiction' });
    throw new Error('Unexpected mocked path');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('competition presentation with mocked HTTP only', () => {
  it('renders an emergency-only response without ordinary headings or unavailable labels', () => {
    const result = analysisResult('AgentResponse');
    result.response.supportedInterpretations = [];
    result.warnings = [{ ruleId: 'U1', text: 'Immediate emergency assessment is recommended. These findings do not confirm ectopic pregnancy.', sourceTags: ['FictionalSource'] }];
    result.renderedText = [result.warnings[0].text + ' [1]', 'Sources', '[1] Fictional reference', DecisionNotice].join('\n\n');
    render(<ResponsePanel review={readReview(result)} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Immediate emergency assessment');
    expect(screen.queryByText('Evidence-supported considerations')).not.toBeInTheDocument();
    expect(screen.queryByText(/Analysis unavailable/)).not.toBeInTheDocument();
    expect(screen.getByText(DecisionNotice)).toBeVisible();
    expect(screen.getByRole('link', { name: /Fictional reference/ })).toBeVisible();
  });
  it('shows one persistent authoritative banner and renders a safe provider-unavailable outcome', async () => {
    mockCompetition('ProviderUnavailable', true);
    render(<App />);
    expect(await screen.findByText(CompetitionBanner)).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText(/Clinical module/), 'FictionalModule');
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(await screen.findByRole('heading', { name: 'Provider unavailable' })).toBeVisible();
    expect(screen.getByText(CompetitionNotice)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear case' }));
    expect(screen.getAllByText(CompetitionBanner)).toHaveLength(1);
    expect(screen.queryByText(CompetitionNotice)).not.toBeInTheDocument();
  });
  it('loads editable presets without submitting and opens unresolved source details internally', async () => {
    const requests = mockCompetition();
    render(<App />);
    await screen.findByText(CompetitionBanner);
    await screen.findByRole('option', { name: 'Fictional review module' });
    await userEvent.selectOptions(screen.getByLabelText('Try a demonstration case'), 'brief');
    expect(screen.getByLabelText(/Clinical module/)).toHaveValue('FictionalModule');
    expect(requests.mock.calls.some(([url]) => url.endsWith('/v1/analyze'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    await screen.findByRole('heading', { name: 'Evidence-supported considerations' });
    expect(document.querySelector('.directAnswer')).toBeInTheDocument();
    expect(document.querySelector('.considerations')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '[1] View source details' })).toHaveTextContent('View source details');
    await userEvent.click(screen.getByRole('button', { name: /View source/ }));
    expect(await screen.findByText('Synthetic browser capture')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Fictional reference/ })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('renders one natural multi-claim paragraph without numbered cards or repeated notices', () => {
    const result = analysisResult();
    const text = 'Several evidence-supported considerations overlap; the reported information does not identify a cause.';
    result.response.decisionSupportNotice = CompetitionNotice;
    result.response.supportedInterpretations = [{ text, citations: [{ sourceTag: 'FictionalSource' }] }];
    result.renderedText = [text + ' [1]', 'Sources', '[1] Fictional reference', CompetitionNotice].join('\n\n');
    render(<ResponsePanel review={readReview(result, false, 'competition')} competition />);
    expect(document.querySelectorAll('.directAnswer')).toHaveLength(1);
    expect(document.querySelector('.considerations')).not.toBeInTheDocument();
    expect(screen.getAllByText(CompetitionNotice)).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Fictional reference/ })).toHaveAttribute('href', 'https://fictional.invalid/Evidence%2FAlpha');
    expect(document.querySelector('.sourceTitle')).toHaveAttribute('title', 'Fictional reference');
  });

});
