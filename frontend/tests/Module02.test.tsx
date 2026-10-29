import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { PregnancyCases } from '../src/DemoCases';
import { CompetitionNotice } from '../src/api';
import { analysisResult } from './fixtures';

function mockApi() {
  const requests = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/v1/analyze')) expect(options?.method).toBe('POST');
    let payload: unknown;
    if (url.endsWith('/v1/modules')) payload = { modules: [
      { moduleId: 'module_01_endo', displayName: 'Endometriosis competition', supportedCaseTypes: ['brief', 'detailed'] },
      { moduleId: 'module_02_early_pregnancy', displayName: 'Early Pregnancy Pain & Bleeding', supportedCaseTypes: ['brief', 'detailed'] },
    ] };
    else if (url.endsWith('/ready')) payload = { status: 'ready', reasonCode: 'ready' };
    else {
      const result = analysisResult('EvidenceInsufficient');
      result.response.decisionSupportNotice = CompetitionNotice;
      result.renderedText = result.renderedText.replace(/Decision-support notice:[\s\S]*$/, CompetitionNotice);
      payload = result;
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Clinical-Mode': 'competition' } });
  });
  vi.stubGlobal('fetch', requests);
  return requests;
}

describe('Module 2 input-only competition presets', () => {
  for (const preset of PregnancyCases) it(`submits ${preset.id} through structured API fields`, async () => {
    const requests = mockApi();
    render(<App />);
    await screen.findByRole('radio', { name: 'Early Pregnancy Pain & Bleeding' });
    await userEvent.selectOptions(screen.getByLabelText('Try a demonstration case'), preset.id);
    expect(screen.getByDisplayValue('module_02_early_pregnancy')).toBeChecked();
    expect(document.querySelector('.additionalContext')).not.toHaveAttribute('open');
    expect(screen.getByLabelText('Case narrative')).toHaveValue(preset.narrative);
    expect(screen.getByLabelText('Reported gestation (weeks)')).toHaveValue(preset.earlyPregnancy?.gestationalWeeks);
    expect(requests.mock.calls.filter(([url]) => url.endsWith('/v1/analyze'))).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Analyze case' }));
    await waitFor(() => expect(requests.mock.calls.some(([url]) => url.endsWith('/v1/analyze'))).toBe(true));
    const call = requests.mock.calls.find(([url]) => url.endsWith('/v1/analyze'))!;
    const payload = JSON.parse(call[1]?.body as string);
    expect(payload.earlyPregnancy).toEqual(preset.earlyPregnancy);
    expect(payload.additionalNotes).toBe(preset.narrative);
    expect(payload.moduleHint).toBe('module_02_early_pregnancy');
    expect(payload.pregnancyPossible).toBe(preset.pregnancy === 'yes');
    await userEvent.click(screen.getByRole('button', { name: 'Clear case' }));
    expect(screen.queryByLabelText('Reported gestation (weeks)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Case narrative')).toHaveValue('');
  });

  it('does not carry early-pregnancy context into Module 1', async () => {
    const requests = mockApi(); render(<App />);
    await screen.findByRole('radio', { name: 'Early Pregnancy Pain & Bleeding' });
    await userEvent.selectOptions(screen.getByLabelText('Try a demonstration case'), 'pregDetailed');
    await userEvent.click(screen.getByDisplayValue('module_01_endo'));
    expect(screen.queryByLabelText('Pregnancy test result')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Analyze case' }));
    await waitFor(() => expect(requests.mock.calls.some(([url]) => url.endsWith('/v1/analyze'))).toBe(true));
    const call = requests.mock.calls.find(([url]) => url.endsWith('/v1/analyze'))!;
    expect(JSON.parse(call[1]?.body as string)).not.toHaveProperty('earlyPregnancy');
  });
});
