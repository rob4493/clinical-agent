import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { DemoCases } from '../src/DemoCases';
import { DemoNotice } from '../src/api';
import { analysisResult, Modules, Ready } from './fixtures';

function mockHttp(mode = 'synthetic', available = Modules) {
  const requests = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/v1/modules') ? available : url.endsWith('/ready') ? Ready : analysisResult()), { headers: { 'Content-Type': 'application/json', 'X-Clinical-Mode': mode } }));
  vi.stubGlobal('fetch', requests);
  return requests;
}
async function openForm() {
  const requests = mockHttp(); render(<App />);
  await screen.findByLabelText('Try a demonstration case');
  return requests;
}
function selectCase(caseId: string) { fireEvent.change(screen.getByLabelText('Try a demonstration case'), { target: { value: caseId } }); }

describe('fictional input presets with mocked HTTP only', () => {
  it.each(['brief', 'mild', 'detailed', 'urgent', 'conflict', 'clarification', 'unsupported'])('loads %s through the retained preset dropdown without submitting', async caseId => {
    const requests = await openForm();
    const example = DemoCases.find(example => example.id === caseId)!;
    const selector = screen.getByLabelText('Try a demonstration case');
    selector.focus(); await userEvent.selectOptions(selector, caseId);
    expect(selector).toHaveValue(caseId);
    expect(screen.getByLabelText('Additional clinical information')).toHaveValue(example.narrative);
    expect(screen.getByLabelText(/Clinical module/)).toHaveValue('FictionalModule');
    expect(example.narrative).not.toMatch(/fictional demonstration/i);
    expect(requests.mock.calls.every(([url]) => !url.endsWith('/v1/analyze'))).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Explore cases' })).not.toBeInTheDocument();
    expect(document.querySelector('.demoShelf')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear case' })); expect(selector).toHaveValue('');
  });
  it.each([
    ['brief', 'brief', 'unknown', 'Recurrent pelvic discomfort. Timing, examination and test findings are not provided. Please review the reported pattern and uncertainty.'],
    ['mild', 'brief', 'unknown', 'Mild intermittent pelvic discomfort over several months. Additional findings are not provided.'],
    ['detailed', 'detailed', 'unknown', 'Intermittent pelvic discomfort over several months, with variable interference in daily activities. Examination and test findings are not provided. Please review the available evidence and its limitations.'],
    ['urgent', 'brief', 'unknown', 'sudden acute pelvic pain'],
    ['conflict', 'brief', 'no', 'pregnancy confirmed'],
    ['clarification', 'brief', 'unknown', 'pregnancy confirmed'],
    ['unsupported', 'brief', 'unknown', 'Persistent headache with light sensitivity. Please review the reported symptoms.'],
  ])('populates every applicable field for %s without submitting', async (caseId, caseType, pregnancy, narrative) => {
    const requests = await openForm(); selectCase(caseId);
    expect(screen.getByLabelText('Age range')).toHaveValue('25-34');
    expect(screen.getByLabelText('Case type')).toHaveValue(caseType);
    expect(screen.getByLabelText('Pregnancy status')).toHaveValue(pregnancy);
    expect(screen.getByLabelText('PID status')).toHaveValue('unknown');
    expect(screen.getByLabelText('Additional clinical information')).toHaveValue(narrative);
    expect(screen.getByLabelText(/Clinical module/)).toHaveValue('FictionalModule');
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled();
    expect(requests.mock.calls.every(([url]) => !url.endsWith('/v1/analyze'))).toBe(true);
  });
  it('switches cases, preserves the explicit module, and never restores edits on unrelated changes', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/Clinical module/), { target: { value: 'FictionalModule' } });
    selectCase('conflict'); selectCase('detailed');
    expect(screen.getByLabelText('Pregnancy status')).toHaveValue('unknown');
    expect(screen.getByLabelText(/Clinical module/)).toHaveValue('FictionalModule');
    fireEvent.change(screen.getByLabelText('Additional clinical information'), { target: { value: 'Edited fictional information' } });
    fireEvent.change(screen.getByLabelText('Age range'), { target: { value: '35-44' } });
    expect(screen.getByLabelText('Additional clinical information')).toHaveValue('Edited fictional information');
    expect(screen.getByLabelText('Age range')).toHaveValue('35-44');
    selectCase('brief');
    expect(screen.getByLabelText('Age range')).toHaveValue('25-34');
    expect(screen.getByLabelText('Additional clinical information')).toHaveValue('Recurrent pelvic discomfort. Timing, examination and test findings are not provided. Please review the reported pattern and uncertainty.');
  });
  it('Clear removes selection and all fields without browser persistence', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    await openForm(); selectCase('detailed');
    await userEvent.click(screen.getByRole('button', { name: 'Clear case' }));
    expect(screen.getByLabelText('Try a demonstration case')).toHaveValue('');
    expect(screen.getByLabelText('Age range')).toHaveValue('');
    expect(screen.getByLabelText('Case type')).toHaveValue('brief');
    expect(screen.getByLabelText('Pregnancy status')).toHaveValue('unknown');
    expect(screen.getByLabelText('PID status')).toHaveValue('unknown');
    expect(screen.getByLabelText('Additional clinical information')).toHaveValue('');
    expect(storage).not.toHaveBeenCalled();
    expect(screen.getByText(DemoNotice)).toBeVisible();
  });
  it('supports keyboard selection with a native select and associated explanation', async () => {
    await openForm(); const selector = screen.getByLabelText('Try a demonstration case');
    selector.focus(); expect(selector).toHaveFocus();
    await userEvent.selectOptions(selector, 'conflict');
    expect(selector).toHaveValue('conflict');
    expect(selector).toHaveAccessibleDescription(/Intentionally contradicts/);
    await userEvent.tab(); expect(screen.getByLabelText(/Clinical module/)).toHaveFocus();
  });
  it('submits edited structured fields separately and retains the intentional conflict', async () => {
    const requests = await openForm(); selectCase('conflict');
    fireEvent.change(screen.getByLabelText(/Clinical module/), { target: { value: 'FictionalModule' } });
    await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(3));
    const options = (requests.mock.calls[2] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(options.body as string)).toEqual({ moduleHint: 'FictionalModule', ageRange: '25-34', caseType: 'brief', pregnancyPossible: false, pidDiagnosedOrPresumed: null, additionalNotes: 'pregnancy confirmed' });
  });
  it('hides presets in standard mode and never adds inactive module options', async () => {
    mockHttp('standard', { modules: [] }); render(<App />);
    await screen.findByText(/No approved clinical modules are available/);
    expect(screen.queryByLabelText('Try a demonstration case')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Clinical module/).querySelectorAll('option')).toHaveLength(1);
    expect(screen.getByText(/Authentic clinical modules remain inactive/)).toBeVisible();
  });
  it.each([{ modules: [] }, { modules: [...Modules.modules, { ...Modules.modules[0], moduleId: 'OtherModule' }] }])('does not invent or choose between unavailable or ambiguous modules', async ({ modules }) => {
    mockHttp('synthetic', { modules }); render(<App />);
    await screen.findByLabelText('Try a demonstration case'); selectCase('brief');
    expect(screen.getByLabelText(/Clinical module/)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled();
  });
  it('shows compact scope before the form with expandable limitations and accurate fake-provider boundaries', async () => {
    await openForm(); const title = screen.getByRole('heading', { name: 'Current coverage' });
    expect(title.compareDocumentPosition(screen.getByLabelText('Try a demonstration case')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Endometriosis and chronic pelvic pain workflow/)).toBeVisible();
    const disclosure = screen.getByText('Clinical scope, limitations and boundary testing');
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
    await userEvent.click(disclosure);
    expect(disclosure.closest('details')).toHaveAttribute('open');
    for (const text of ['Medication selection or dosing', 'Diagnosis confirmation or exclusion', 'Disease probability or staging', 'Help test the boundaries']) expect(screen.getByText(text)).toBeVisible();
    for (const text of ['Early pregnancy pain and bleeding', 'Pelvic inflammatory disease', 'Polycystic ovary syndrome']) expect(screen.getByText(new RegExp(text))).toBeVisible();
    expect(screen.getAllByText('In development')).toHaveLength(3);
    expect(screen.getByText(/Use de-identified, minimum-necessary information only/)).toBeVisible();
    expect(screen.getByText(/Other wording receives an explicit scope or evidence limitation/)).toBeVisible();
    expect(DemoCases).toHaveLength(7);
  });
});
