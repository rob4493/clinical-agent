import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DecisionNotice, UnexpectedMessage, requestJson } from '../src/api';
import { analysisResult, Modules, Ready } from './fixtures';

interface PendingRequest { signal: AbortSignal; resolve: (response: Response) => void }
function reply(payload: unknown) { return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }); }
async function startForm() {
  const requests: PendingRequest[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
    if (!url.endsWith('/v1/analyze')) return Promise.resolve(reply(url.endsWith('/ready') ? Ready : Modules));
    // Deliberately ignore abort so stale-response defenses are independently exercised.
    return new Promise<Response>(resolve => requests.push({ signal: options.signal as AbortSignal, resolve }));
  }));
  const view = render(<App />);
  await screen.findByRole('option', { name: 'Fictional review module' });
  fireEvent.change(screen.getByLabelText(/Clinical module/), { target: { value: 'FictionalModule' } });
  fireEvent.change(screen.getByLabelText('Additional clinical information'), { target: { value: 'Fictional cancellation marker' } });
  return { requests, view };
}
function submitForm() { fireEvent.submit(document.getElementById('caseForm')!); }
async function complete(request: PendingRequest) { await act(async () => request.resolve(reply(analysisResult()))); }
afterEach(() => vi.useRealTimers());

describe('request cancellation without network or persistence', () => {
  it('an already cancelled API request never invokes Fetch', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController(); controller.abort();
    await expect(requestJson('/v1/analyze', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('cancellation during JSON body reading rejects a late parsed response', async () => {
    let finishBody!: (payload: unknown) => void;
    const response = reply(analysisResult());
    response.json = () => new Promise(resolve => { finishBody = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const controller = new AbortController();
    const pending = requestJson('/v1/analyze', controller.signal);
    await Promise.resolve(); await Promise.resolve(); controller.abort(); finishBody(analysisResult());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('Clear aborts immediately, removes case state and rejects late output', async () => {
    const { requests } = await startForm(); submitForm();
    fireEvent.click(screen.getByRole('button', { name: 'Clear case' }));
    expect(requests[0].signal.aborted).toBe(true);
    expect(screen.getByLabelText('Additional clinical information')).toHaveValue('');
    expect(screen.getByLabelText(/Clinical module/)).toHaveValue('');
    expect(screen.getByRole('region', { name: 'Evidence review' })).toHaveAttribute('aria-busy', 'false');
    await complete(requests[0]);
    expect(screen.queryByText(DecisionNotice)).not.toBeInTheDocument();
    expect(screen.queryByText(UnexpectedMessage)).not.toBeInTheDocument();
  });
  it('unmount aborts the active request and clears its deadline resource', async () => {
    const { requests, view } = await startForm();
    vi.useFakeTimers(); submitForm(); expect(vi.getTimerCount()).toBe(1);
    view.unmount(); expect(requests[0].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await complete(requests[0]);
    expect(screen.queryByText(DecisionNotice)).not.toBeInTheDocument();
  });
  it('the deadline aborts, restores controls and shows cancellation rather than provider failure', async () => {
    const { requests } = await startForm(); vi.useFakeTimers(); submitForm();
    await act(async () => vi.advanceTimersByTimeAsync(20000));
    expect(requests[0].signal.aborted).toBe(true);
    expect(screen.getByText('Request cancelled after the time limit. You may try again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled();
    expect(screen.getByLabelText('Additional clinical information')).toHaveValue('Fictional cancellation marker');
    await complete(requests[0]);
    expect(screen.queryByText(DecisionNotice)).not.toBeInTheDocument();
    expect(screen.queryByText(UnexpectedMessage)).not.toBeInTheDocument();
  });
  it('a permitted replacement after Clear cannot be overwritten by its predecessor', async () => {
    const { requests } = await startForm(); submitForm();
    fireEvent.click(screen.getByRole('button', { name: 'Clear case' }));
    fireEvent.change(screen.getByLabelText(/Clinical module/), { target: { value: 'FictionalModule' } });
    submitForm(); expect(requests).toHaveLength(2);
    expect(requests[0].signal.aborted).toBe(true); expect(requests[1].signal.aborted).toBe(false);
    await complete(requests[0]); expect(screen.queryByText(DecisionNotice)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyzing…' })).toBeDisabled();
    await complete(requests[1]); expect(screen.getByText(DecisionNotice)).toBeVisible();
  });
  it('duplicate submissions never create a second active request', async () => {
    const { requests } = await startForm(); submitForm(); submitForm(); submitForm();
    expect(requests).toHaveLength(1); expect(requests[0].signal.aborted).toBe(false);
    await complete(requests[0]); expect(screen.getByText(DecisionNotice)).toBeVisible();
  });
});
