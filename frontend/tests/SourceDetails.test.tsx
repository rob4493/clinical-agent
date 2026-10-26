import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ResponsePanel from '../src/ResponsePanel';
import { readReview } from '../src/api';
import { analysisResult } from './fixtures';

const Details = { title: 'Fictional pelvic review reference', status: 'Demonstration only; no clinical authority', statements: ['A bounded review statement.'], limitations: 'Not clinically validated evidence.' };
function mockDetails(payload: unknown = Details, mode = 'synthetic') {
  const transport = vi.fn(async (requestPath: string) => { expect(requestPath.startsWith('/api/v1/')).toBe(true); return new Response(JSON.stringify(payload), { headers: { 'X-Clinical-Mode': mode } }); });
  vi.stubGlobal('fetch', transport); return transport;
}
function openPanel() { const view = render(<ResponsePanel review={readReview(analysisResult(), true)} synthetic />); fireEvent.click(screen.getByRole('button', { name: 'Sources (1)' })); return view; }

describe('internal read-only demo source details', () => {
  it('opens only local source content and restores keyboard focus', async () => {
    const transport = mockDetails(); openPanel();
    const source = screen.getByRole('button', { name: '[1] View source details' });
    source.focus(); await userEvent.keyboard('{Enter}');
    expect(await screen.findByText(Details.title)).toBeVisible();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Source details');
    const close = screen.getByRole('button', { name: 'Close source' });
    expect(close).toHaveFocus(); await userEvent.tab(); expect(close).toHaveFocus();
    expect(transport.mock.calls[0][0]).toBe('/api/v1/demo/sources/FictionalSource');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(source).toHaveFocus();
  });
  it.each([null, { ...Details, statements: ['<svg>unsafe</svg>'] }, { ...Details, statements: [] }])('rejects malformed source content', async payload => {
    mockDetails(payload); openPanel(); await userEvent.click(screen.getByRole('button', { name: /View source/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Source details are unavailable');
    // Project-owned visual icons are allowed outside the untrusted source dialog.
    expect(screen.getByRole('dialog').querySelector('svg')).toBeNull();
    for (const icon of document.querySelectorAll('svg')) expect(icon.closest('.summaryIcons[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByText('unsafe')).not.toBeInTheDocument();
  });
  it('rejects a changed authoritative runtime mode', async () => {
    mockDetails(Details, 'standard'); openPanel(); await userEvent.click(screen.getByRole('button', { name: /View source/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Source details are unavailable');
    expect(screen.queryByText(Details.title)).not.toBeInTheDocument();
  });
  it('aborts detail loading and removes the dialog when the case clears', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((requestPath: string, options: RequestInit) => { expect(requestPath.startsWith('/api/v1/demo/sources/')).toBe(true); signal = options.signal as AbortSignal; return new Promise(() => {}); }));
    const { rerender } = openPanel(); await userEvent.click(screen.getByRole('button', { name: /View source/ }));
    await waitFor(() => expect(signal).toBeDefined()); rerender(<ResponsePanel review={null} synthetic />);
    expect(signal!.aborted).toBe(true); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
