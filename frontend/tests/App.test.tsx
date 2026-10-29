import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DecisionNotice, DemoNotice, UnexpectedMessage } from '../src/api';
import { analysisResult, ConsiderationText, Modules, Ready } from './fixtures';

function reply(payload: unknown, status = 200, runtimeMode = 'standard') { return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', 'X-Clinical-Mode': runtimeMode } }); }
function mockHttp(payload: unknown = analysisResult(), status = 200, modules: unknown = Modules, readiness: unknown = Ready, runtimeMode = 'standard') {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/v1/modules')) return reply(modules, 200, runtimeMode);
    if (url.endsWith('/ready')) return reply(readiness, (readiness as { status: string }).status === 'ready' ? 200 : 503, runtimeMode);
    if (url.endsWith('/v1/analyze') && options?.method === 'POST') return reply(payload, status, runtimeMode);
    throw new Error('Unexpected mocked HTTP path');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
async function chooseModule() {
  await screen.findByRole('radio', { name: 'Fictional review module' });
  await userEvent.click(screen.getByDisplayValue('FictionalModule'));
}
async function submit() { await chooseModule(); await userEvent.click(screen.getByRole('button', { name: 'Analyze case' })); }

describe('clinician workflow with mocked HTTP only', () => {
  it.each(['AgentResponse', 'DataConflict', 'ClarificationRequired', 'EvidenceInsufficient'])('labels the backend synthetic mode and %s outcome persistently', async outcome => {
    mockHttp(analysisResult(outcome), 200, Modules, Ready, 'synthetic'); render(<App />);
    expect(await screen.findByText(DemoNotice)).toBeVisible();
    await submit();
    expect(await screen.findByText('Synthetic demonstration response')).toBeVisible();
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear case' }));
    expect(screen.getByText(DemoNotice)).toBeVisible();
    expect(screen.queryByText('Synthetic demonstration response')).not.toBeInTheDocument();
  });
  it('keeps urgent content before the synthetic response label', async () => {
    mockHttp(analysisResult('AgentResponse', true), 200, Modules, Ready, 'synthetic'); render(<App />); await submit();
    await screen.findByText('Fictional urgent assessment warning.', { exact: false });
    const panel = screen.getByRole('region', { name: 'Clinical evidence review' });
    expect(panel.firstElementChild).toHaveClass('urgentPanel');
    expect(panel).toHaveTextContent('Synthetic demonstration response');
  });
  it('does not claim demo mode from a synthetic-looking module name alone', async () => {
    mockHttp(analysisResult(), 200, { modules: [{ ...Modules.modules[0], displayName: 'Synthetic module label' }] }); render(<App />);
    await screen.findByRole('radio', { name: 'Synthetic module label' });
    expect(screen.queryByText(DemoNotice)).not.toBeInTheDocument();
  });
  it('fails closed when the runtime changes during submission', async () => {
    mockHttp(analysisResult(), 200, Modules, Ready, 'synthetic'); render(<App />);
    await screen.findByText(DemoNotice);
    vi.stubGlobal('fetch', vi.fn(async () => reply(analysisResult(), 200, 'standard')));
    await submit();
    expect(await screen.findByText(UnexpectedMessage)).toBeVisible();
    expect(screen.queryByText(ConsiderationText)).not.toBeInTheDocument();
    expect(screen.getByText(DemoNotice)).toBeVisible();
  });
  it('loads modules but requires explicit selection', async () => {
    const fetchMock = mockHttp(); render(<App />);
    await screen.findByRole('radio', { name: 'Fictional review module' });
    expect(document.querySelector('input[name=clinicalModule]:checked')).toBeNull();
    expect(screen.getByRole('button', { name: 'Analyze case' })).toBeDisabled();
    fireEvent.submit(document.getElementById('caseForm')!);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/v1/analyze'))).toHaveLength(0);
    expect(screen.queryByText(/No.*urgent/i)).not.toBeInTheDocument();
  });
  it('shows the empty module and not-ready state without fabricated options', async () => {
    mockHttp(undefined, 200, { modules: [] }, { status: 'notReady', reasonCode: 'noAvailableModules' }); render(<App />);
    expect(await screen.findByText(/No approved clinical modules are available/)).toBeVisible();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryAllByRole('option').filter(option => option.textContent?.includes('Fictional'))).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Analyze case' })).toBeDisabled();
  });
  it('handles module transport failure generically', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private host and credentials'))); render(<App />);
    expect(await screen.findByText('Evaluation services are unavailable. Refresh availability to try again.')).toBeVisible();
    expect(document.body).not.toHaveTextContent('private host');
    expect(screen.getByRole('button', { name: 'Analyze case' })).toBeDisabled();
  });
  it.each([404, 200])('keeps Analyze visibly closed for a backend-free static site with status %s', async status => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url.startsWith('/api/')).toBe(true);
      return status === 404
        ? reply({ detail: 'Analysis is unavailable. No backend is configured for this site.' }, 404)
        : new Response('<html><body>Static SPA fallback</body></html>', { headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock); render(<App />);
    expect(await screen.findByText('Evaluation services are unavailable. Refresh availability to try again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Analyze case' })).toBeDisabled();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    fireEvent.submit(document.getElementById('caseForm')!);
    expect(fetchMock.mock.calls.some(argumentsList => String(argumentsList[0]).endsWith('/v1/analyze'))).toBe(false);
    expect(document.body).not.toHaveTextContent('Static SPA fallback');
  });
  it('keeps unavailable analysis dependencies closed', async () => {
    mockHttp(undefined, 200, Modules, { status: 'notReady', reasonCode: 'analysisUnavailable' }); render(<App />); await chooseModule();
    expect(await screen.findByText(/Analysis services are not ready/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Analyze case' })).toBeDisabled();
  });
  it.each([
    ['unknown', 'unknown', null, null], ['yes', 'no', true, false], ['no', 'yes', false, true],
  ])('submits structured fields and exact narrative for %s/%s', async (pregnancy, pid, pregnancyJson, pidJson) => {
    const fetchMock = mockHttp(); render(<App />); await chooseModule();
    await userEvent.selectOptions(screen.getByLabelText('Age range'), '25-34');
    await userEvent.selectOptions(screen.getByLabelText('Case type'), 'detailed');
    await userEvent.selectOptions(screen.getByLabelText('Pregnancy status'), pregnancy!);
    await userEvent.selectOptions(screen.getByLabelText('PID status'), pid!);
    await userEvent.type(screen.getByLabelText('Case narrative'), 'Fictional additional context only.');
    expect(screen.getByLabelText('Age range')).toHaveValue('25-34');
    expect(screen.queryByLabelText('Selected structured context')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Analyze case' }));
    await screen.findByRole('heading', { name: 'Evidence summary' });
    const options = fetchMock.mock.calls.find(([url]) => url.endsWith('/v1/analyze'))![1]!;
    expect(JSON.parse(options.body as string)).toEqual({ moduleHint: 'FictionalModule', ageRange: '25-34', caseType: 'detailed', pregnancyPossible: pregnancyJson, pidDiagnosedOrPresumed: pidJson, additionalNotes: 'Fictional additional context only.' });
    expect(options.credentials).toBe('same-origin'); expect(options.cache).toBe('no-store');
  });
  it('renders considerations, numbered citations, exact safe links and the fixed final notice', async () => {
    mockHttp(); render(<App />); await submit();
    expect(await screen.findByRole('heading', { name: 'Evidence summary' })).toBeVisible();
    expect(screen.getByText(ConsiderationText)).toBeVisible();
    expect(screen.queryByRole('link', { name: /Fictional reference.*opens in a new tab/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sources (1)' }));
    const link = screen.getByRole('link', { name: /Fictional reference.*opens in a new tab/ });
    expect(link).toHaveAttribute('href', 'https://fictional.invalid/Evidence%2FAlpha');
    expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    const panel = screen.getByRole('region', { name: 'Clinical evidence review' });
    expect(panel.lastElementChild).toHaveTextContent(DecisionNotice);
    expect(document.body).not.toHaveTextContent('FictionalSource');
    expect(document.body).not.toHaveTextContent('private.bin'); expect(document.body).not.toHaveTextContent('private provider payload');
    expect(screen.queryByRole('heading', { name: 'Urgent assessment' })).not.toBeInTheDocument();
  });
  it('renders urgent content first even with a dependency failure', async () => {
    mockHttp(analysisResult('EvidenceInsufficient', true), 503); render(<App />); await submit();
    const panel = await screen.findByRole('region', { name: 'Clinical evidence review' });
    expect(panel.firstElementChild).toHaveAttribute('role', 'alert');
    expect(panel.firstElementChild).toHaveTextContent('Fictional urgent assessment warning.');
    expect(panel.lastElementChild).toHaveTextContent(DecisionNotice);
  });
  it.each([
    ['DataConflict', 200, 'Resolve conflicting information'], ['ClarificationRequired', 200, 'Clarification required'],
    ['EvidenceInsufficient', 200, 'Evidence insufficient or unavailable'], ['ModuleUnavailable', 404, 'Module unavailable'],
    ['EvidenceInsufficient', 503, 'Evidence insufficient or unavailable'], ['SelectModuleRequired', 200, 'Select a clinical module'],
  ])('renders safe %s/%s outcomes', async (outcome, status, heading) => {
    mockHttp(analysisResult(outcome), status); render(<App />); await submit();
    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Sources' })).not.toBeInTheDocument();
    expect(screen.getByText(DecisionNotice)).toBeVisible();
    if (outcome === 'DataConflict' || outcome === 'ClarificationRequired') expect(screen.getByText('Please clarify the reported pregnancy status.')).toBeVisible();
  });
  it('uses the sanitized privacy-validation detail', async () => {
    mockHttp({ detail: 'Remove direct identifiers before resubmitting.' }, 422); render(<App />); await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Remove direct identifiers before resubmitting.');
    expect(screen.queryByText(ConsiderationText)).not.toBeInTheDocument();
  });
  it('handles unexpected validation/provider payloads without exposing them', async () => {
    mockHttp({ detail: [{ input: 'private case', ctx: 'secret' }] }, 422); render(<App />); await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(UnexpectedMessage);
    expect(document.body).not.toHaveTextContent('private case'); expect(document.body).not.toHaveTextContent('secret');
  });
  it('blocks duplicate submits and prevents late responses restoring cleared case state', async () => {
    let resolveResponse!: (response: Response) => void;
    const pendingResponse = new Promise<Response>(resolve => { resolveResponse = resolve; });
    const fetchMock = mockHttp();
    fetchMock.mockImplementation(async url => url.endsWith('/v1/analyze') ? pendingResponse : reply(url.endsWith('/ready') ? Ready : Modules));
    render(<App />); await chooseModule();
    await userEvent.type(screen.getByLabelText('Case narrative'), 'Fictional transient narrative');
    fireEvent.submit(document.getElementById('caseForm')!); fireEvent.submit(document.getElementById('caseForm')!);
    expect(await screen.findByRole('button', { name: 'Analyzing…' })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/v1/analyze'))).toHaveLength(1);
    const signal = fetchMock.mock.calls.find(([url]) => url.endsWith('/v1/analyze'))![1]!.signal!;
    await userEvent.click(screen.getByRole('button', { name: 'Clear case' }));
    expect(signal.aborted).toBe(true); expect(screen.getByLabelText('Case narrative')).toHaveValue('');
    expect(document.querySelector('input[name=clinicalModule]:checked')).toBeNull();
    resolveResponse(reply(analysisResult()));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Evidence summary' })).not.toBeInTheDocument());
  });
  it('clears all entered fields and the response', async () => {
    mockHttp(); render(<App />); await chooseModule();
    await userEvent.selectOptions(screen.getByLabelText('Age range'), '25-34');
    await userEvent.selectOptions(screen.getByLabelText('Case type'), 'detailed');
    await userEvent.selectOptions(screen.getByLabelText('Pregnancy status'), 'yes');
    await userEvent.selectOptions(screen.getByLabelText('PID status'), 'no');
    await userEvent.type(screen.getByLabelText('Case narrative'), 'Fictional context');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze case' }));
    await screen.findByText(DecisionNotice);
    await userEvent.click(screen.getByRole('button', { name: 'Clear case' }));
    expect(document.querySelector('input[name=clinicalModule]:checked')).toBeNull();
    expect(screen.queryByLabelText('Age range')).not.toBeInTheDocument();
    await chooseModule();
    expect(screen.getByLabelText('Age range')).toHaveValue(''); expect(screen.getByLabelText('Case type')).toHaveValue('brief');
    expect(screen.getByLabelText('Pregnancy status')).toHaveValue('unknown'); expect(screen.getByLabelText('PID status')).toHaveValue('unknown');
    expect(screen.getByLabelText('Case narrative')).toHaveValue(''); expect(screen.queryByText(DecisionNotice)).not.toBeInTheDocument();
  });
  it('retains no case state across remounts or browser page restoration', async () => {
    mockHttp(); const view = render(<App />); await chooseModule();
    await userEvent.type(screen.getByLabelText('Case narrative'), 'Fictional transient context');
    fireEvent(window, new Event('pageshow'));
    expect(screen.getByLabelText('Case narrative')).toHaveValue('');
    view.unmount(); render(<App />);
    expect(screen.getByLabelText('Case narrative')).toHaveValue('');
    expect(screen.queryByLabelText('Pregnancy status')).not.toBeInTheDocument();
  });
  it('never persists or logs case information or places it in URLs', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const cookieWrite = vi.spyOn(document, 'cookie', 'set');
    const databaseOpen = vi.fn(); vi.stubGlobal('indexedDB', { open: databaseOpen });
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const fetchMock = mockHttp(); render(<App />); await chooseModule();
    await userEvent.type(screen.getByLabelText('Case narrative'), 'Fictional private marker');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze case' })); await screen.findByText(DecisionNotice);
    expect(storageWrite).not.toHaveBeenCalled(); expect(cookieWrite).not.toHaveBeenCalled(); expect(databaseOpen).not.toHaveBeenCalled();
    logs.forEach(log => expect(log).not.toHaveBeenCalled());
    fetchMock.mock.calls.forEach(([url]) => expect(url).not.toContain('marker'));
    expect(window.location.href).not.toContain('marker');
  });
  it('provides keyboard access, labels, privacy context and narrative bounds', async () => {
    mockHttp(); render(<App />); await screen.findByRole('radio', { name: 'Fictional review module' });
    await userEvent.tab(); expect(screen.getByRole('link', { name: 'Skip to case entry' })).toHaveFocus();
    await userEvent.tab(); expect(screen.getByRole('link', { name: 'Endo — case details' })).toHaveFocus();
    for (const label of ['Case details', 'Documents', 'Evidence review', 'Scope & safety']) {
      await userEvent.tab(); expect(screen.getByRole('link', { name: new RegExp(label) })).toHaveFocus();
    }
    await userEvent.tab(); expect(screen.getByRole('radio')).toHaveFocus();
    expect(screen.getByLabelText('Case narrative')).toHaveAttribute('maxlength', '2000');
    expect(screen.getByLabelText('Case narrative')).toHaveAccessibleDescription(/Do not include patient identifiers/);
    expect(screen.getByRole('complementary', { name: 'Clinical and privacy boundaries' })).toHaveTextContent('clinician-facing decision support only');
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  });
  it('retains entered context and focuses ordinary results after analysis', async () => {
    mockHttp(); render(<App />); await chooseModule();
    await userEvent.selectOptions(screen.getByLabelText('Age range'), '25-34');
    await userEvent.type(screen.getByLabelText('Case narrative'), 'Fictional context for refinement.');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze case' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Evidence summary' })).toHaveFocus());
    expect(screen.getByLabelText('Age range')).toHaveValue('25-34');
    expect(screen.getByLabelText('Case narrative')).toHaveValue('Fictional context for refinement.');
  });
  it('focuses the urgent heading before ordinary results', async () => {
    mockHttp(analysisResult('AgentResponse', true)); render(<App />); await submit();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Urgent assessment' })).toHaveFocus());
    expect(screen.getByRole('alert')).toHaveTextContent('Priority warning — review first');
  });
  it('focuses and associates sanitized validation feedback without deleting input', async () => {
    mockHttp({ detail: 'Remove direct identifiers before resubmitting.' }, 422); render(<App />); await chooseModule();
    await userEvent.type(screen.getByLabelText('Case narrative'), 'Fictional validation case.');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze case' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
    expect(screen.getByLabelText('Case narrative')).toHaveAccessibleDescription(/Remove direct identifiers/);
    expect(screen.getByLabelText('Case narrative')).toHaveValue('Fictional validation case.');
    expect(document.getElementById('caseForm')).toHaveAttribute('aria-describedby', 'requestError');
  });
  it('returns Clear focus to the required explicit module selection', async () => {
    mockHttp(); render(<App />); await submit();
    await screen.findByText(DecisionNotice);
    await userEvent.click(screen.getByRole('button', { name: 'Clear case' }));
    await waitFor(() => expect(screen.getByRole('radio')).toHaveFocus());
    expect(document.querySelector('input[name=clinicalModule]:checked')).toBeNull();
    expect(screen.getByRole('button', { name: 'Analyze case' })).toBeDisabled();
  });
  it('exposes a stable busy workspace and secondary Clear while analysis is pending', async () => {
    const fetchMock = mockHttp();
    fetchMock.mockImplementation(async url => url.endsWith('/v1/analyze') ? new Promise<Response>(() => {}) : reply(url.endsWith('/ready') ? Ready : Modules));
    render(<App />); await chooseModule();
    await userEvent.click(screen.getByRole('button', { name: 'Analyze case' }));
    expect(screen.getByRole('region', { name: 'Evidence review' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Analysis in progress')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Analyzing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear case' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Clear case' }));
    expect(screen.getByRole('region', { name: 'Evidence review' })).toHaveAttribute('aria-busy', 'false');
  });
  it.each([
    ['AgentResponse', 'Evidence-supported response', 'supported'],
    ['DataConflict', 'Analysis paused · conflicting information', 'conflict'],
    ['ClarificationRequired', 'Analysis paused · clarification needed', 'clarification'],
    ['EvidenceInsufficient', 'Analysis unavailable · review limitation', 'insufficient'],
  ])('distinguishes %s with text as well as a visual state', async (outcome, label, tone) => {
    mockHttp(analysisResult(outcome)); render(<App />); await submit();
    expect(await screen.findByText(label)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Clinical evidence review' })).toHaveClass(tone);
    expect(screen.getByText(DecisionNotice)).toBeVisible();
  });
});

