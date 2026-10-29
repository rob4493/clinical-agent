import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import App from '../src/App';
import { ReviewNavigation, WorkflowBar } from '../src/ReviewShell';
import { EvaluationBanner } from '../src/api';
import { DemoCases, PregnancyCases } from '../src/DemoCases';
import { Modules, Ready } from './fixtures';

it('brands the public page Endo without changing internal identifiers', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/v1/modules') ? Modules : Ready), { headers: { 'X-Clinical-Mode': 'standard' } })));
  render(<App />); await screen.findByRole('radio', { name: 'Fictional review module' });
  expect(document.title).toBe('Endo | Clinical Evidence Assistant');
  expect(screen.getByRole('link', { name: 'Endo — case details' })).toHaveAttribute('href', '#caseForm');
  expect(document.querySelector('footer strong')).toHaveTextContent('Endo');
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New evidence review');
  const html = readFileSync('index.html', 'utf8');
  expect(html).toContain('<title>Endo | Clinical Evidence Assistant</title>'); expect(html).not.toContain('Clarity Clinical Support');
  expect(document.querySelector('input[name=clinicalModule]:checked')).toBeNull(); expect(screen.getByRole('button', { name: 'Analyze case' })).toBeDisabled();
});
it('exposes only real section navigation and no saved-case or account controls', () => {
  render(<ReviewNavigation />);
  const navigation = screen.getByRole('navigation', { name: 'Review sections' });
  expect(Array.from(navigation.querySelectorAll('a')).map(link => link.getAttribute('href'))).toEqual(['#caseForm', '#uploadTitle', '#evidenceWorkspace', '#scopeTitle']);
  expect(navigation).not.toHaveTextContent(/saved|profile|login|notification/i);
});
it('announces the actual workflow stage without simulated completion', () => {
  const view = render(<WorkflowBar pending={false} hasResponse={false} />); expect(document.querySelector('[aria-current=step]')).toHaveTextContent('Case details');
  view.rerender(<WorkflowBar pending hasResponse={false} />); expect(document.querySelector('[aria-current=step]')).toHaveTextContent('Analyze');
  view.rerender(<WorkflowBar pending={false} hasResponse />); expect(document.querySelector('[aria-current=step]')).toHaveTextContent('Evidence review');
});
it('keeps case entry and its privacy indicator without a companion or routine safety panel', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/v1/modules') ? Modules : Ready))));
  render(<App />); await screen.findByRole('radio', { name: 'Fictional review module' });
  expect(screen.queryByText(/review companion|evidence, with context|safety comes first/i)).not.toBeInTheDocument();
  expect(document.querySelector('.evidenceRail')).toBeNull();
  expect(screen.getByText('In-memory only')).toBeVisible();
  expect(screen.getByRole('group', { name: /Select clinical module/ })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

function mockModules(mode = 'standard') {
  const requests = vi.fn(async (url: string, options?: RequestInit) => new Response(JSON.stringify(url.endsWith('/v1/modules') ? { modules: [
    { moduleId: 'module_01_endo', displayName: 'Endometriosis', supportedCaseTypes: ['brief', 'detailed'] },
    { moduleId: 'module_02_early_pregnancy', displayName: 'Early pregnancy', supportedCaseTypes: ['brief', 'detailed'] },
  ] } : url.endsWith('/ready') ? Ready : { detail: 'Remove direct identifiers before resubmitting.' }), { status: options?.method === 'POST' ? 422 : 200, headers: { 'X-Clinical-Mode': mode } }));
  vi.stubGlobal('fetch', requests); return requests;
}
it('requires an explicit accessible module card and keeps context collapsed initially', async () => {
  const requests = mockModules(); render(<App />);
  const endo = await screen.findByRole('radio', { name: 'Endometriosis & Chronic Pelvic Pain' });
  const pregnancy = screen.getByRole('radio', { name: 'Early Pregnancy Pain & Bleeding' });
  expect(endo).not.toBeChecked(); expect(pregnancy).not.toBeChecked();
  expect(screen.queryByText('Additional clinical context')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Analyze case' })).toBeDisabled();
  fireEvent.submit(document.getElementById('caseForm')!);
  expect(screen.getByRole('alert')).toHaveTextContent('Select the clinical module before analyzing this case.');
  expect(requests.mock.calls.some(([url]) => url.endsWith('/v1/analyze'))).toBe(false);
  await userEvent.click(endo); expect(endo).toBeChecked();
  expect(endo.closest('label')).toHaveClass('selected');
  expect(document.querySelector('.additionalContext')).not.toHaveAttribute('open');
  expect(screen.queryByLabelText('Pregnancy test result')).not.toBeInTheDocument();
  await userEvent.click(screen.getByText('Additional clinical context'));
  expect(screen.getByLabelText('Pregnancy status')).toHaveValue('unknown');
  await userEvent.selectOptions(screen.getByLabelText('Age range'), '25-34');
  await userEvent.click(screen.getByText('Additional clinical context', { exact: false }));
  expect(document.querySelector('.contextPreview')).toHaveTextContent('Age: 25-34');
  expect(document.querySelector('.contextPreview')).toBeVisible();
});
it('resets module-specific findings without converting missing values into negatives', async () => {
  const requests = mockModules(); render(<App />);
  await userEvent.click(await screen.findByRole('radio', { name: 'Early Pregnancy Pain & Bleeding' }));
  await userEvent.click(screen.getByText('Additional clinical context'));
  await userEvent.selectOptions(screen.getByLabelText('Pregnancy test result'), 'positive');
  await userEvent.selectOptions(screen.getByLabelText('Clinician reports clinical stability'), 'yes');
  await userEvent.selectOptions(screen.getByLabelText('Pregnancy status'), 'yes');
  await userEvent.click(screen.getByRole('radio', { name: 'Endometriosis & Chronic Pelvic Pain' }));
  expect(screen.queryByLabelText('Pregnancy test result')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Pregnancy status')).toHaveValue('unknown');
  await userEvent.click(screen.getByRole('radio', { name: 'Early Pregnancy Pain & Bleeding' }));
  expect(screen.getByLabelText('Pregnancy test result')).toHaveValue('');
  expect(screen.getByLabelText('Clinician reports clinical stability')).toHaveValue('');
  await userEvent.click(screen.getByRole('button', { name: 'Analyze case' }));
  await waitFor(() => expect(requests.mock.calls.some(([url]) => url.endsWith('/v1/analyze'))).toBe(true));
  const request = JSON.parse(requests.mock.calls.find(([url]) => url.endsWith('/v1/analyze'))![1]!.body as string);
  expect(request).toMatchObject({ pregnancyPossible: null, pidDiagnosedOrPresumed: null, earlyPregnancy: {} });
  expect(document.querySelector('.additionalContext')).toHaveAttribute('open');
  await userEvent.click(screen.getByRole('button', { name: 'Clear case' }));
  expect(screen.getAllByRole('radio').every(radio => !(radio as HTMLInputElement).checked)).toBe(true);
  expect(screen.queryByText('Additional clinical context')).not.toBeInTheDocument();
});

it('blocks invalid entered gestation without changing optional unknown semantics', async () => {
  const requests = mockModules(); render(<App />);
  await userEvent.click(await screen.findByRole('radio', { name: 'Early Pregnancy Pain & Bleeding' }));
  await userEvent.click(screen.getByText('Additional clinical context'));
  fireEvent.change(screen.getByLabelText('Reported gestation (weeks)'), { target: { value: '46' } });
  expect(screen.getByRole('button', { name: 'Analyze case' })).toBeDisabled();
  fireEvent.submit(document.getElementById('caseForm')!);
  expect(requests.mock.calls.some(([url]) => url.endsWith('/v1/analyze'))).toBe(false);
  fireEvent.change(screen.getByLabelText('Reported gestation (weeks)'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Analyze case' })).toBeEnabled();
});

it('orders the workflow and keeps scope and repeated unknown context out of the primary path', async () => {
  mockModules('competition'); render(<App />);
  await screen.findByRole('radio', { name: 'Endometriosis & Chronic Pelvic Pain' });
  expect(screen.getByLabelText('Try a demonstration case')).toHaveValue('');
  expect(screen.getByRole('option', { name: 'Choose a demonstration case' })).toBeInTheDocument();
  expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  expect(screen.getByText('Select a clinical module to begin')).toBeVisible();
  expect(screen.getAllByText(EvaluationBanner)).toHaveLength(1);
  expect(document.querySelector('.privacyBanner')).toBeNull();
  expect(document.querySelector('.workflowBar > p')).toBeNull();
  await userEvent.click(screen.getByRole('radio', { name: 'Endometriosis & Chronic Pelvic Pain' }));
  const order = ['.demoExamples', '.moduleChoices', '#narrative', '.additionalContext', '.uploadPanel', '.formActions'];
  for (let index = 1; index < order.length; index++) expect(document.querySelector(order[index - 1])!.compareDocumentPosition(document.querySelector(order[index])!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelector('.contextSummary')).toBeNull();
  expect(document.querySelector('.contextChips')).toBeNull();
  expect(document.querySelector('.contextPreview')).toBeNull();
  expect(document.querySelector('.additionalContext')).not.toHaveAttribute('open');
  expect(document.querySelector('.scopePanel')).not.toHaveAttribute('open');
  expect(document.querySelector('.workspace')!.compareDocumentPosition(document.querySelector('.scopePanel')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const scope = screen.getByText('Scope & safety', { selector: 'summary' }); scope.focus();
  expect(scope).toHaveFocus();
  await userEvent.click(scope); expect(document.querySelector('.scopePanel')).toHaveAttribute('open');
  expect(screen.getByText(/Production clinical modules remain inactive/)).toBeVisible();
});
it('loads exact fixture fields and only the fixture-assigned module without submitting', async () => {
  const requests = mockModules('competition'); render(<App />);
  const selector = await screen.findByLabelText('Try a demonstration case');
  await waitFor(() => expect(selector).toBeEnabled());
  const preset = PregnancyCases.find(example => example.id === 'pregDetailed')!;
  await userEvent.selectOptions(selector, preset.id);
  expect(screen.getByDisplayValue(preset.moduleId)).toBeChecked();
  expect(screen.getByLabelText('Case narrative')).toHaveValue(preset.narrative);
  expect(screen.getByLabelText('Age range')).toHaveValue(preset.ageRange);
  expect(screen.getByLabelText('Case type')).toHaveValue(preset.caseType);
  expect(screen.getByLabelText('Pregnancy status')).toHaveValue(preset.pregnancy);
  expect(screen.getByLabelText('PID status')).toHaveValue(preset.pid);
  expect(document.querySelector('.additionalContext')).not.toHaveAttribute('open');
  expect(screen.getByText('Demonstration case loaded — verify the selected module and case information before analyzing')).toBeVisible();
  expect(requests.mock.calls.filter(([url]) => url.endsWith('/v1/analyze'))).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Analyze case' }));
  await waitFor(() => expect(requests.mock.calls.filter(([url]) => url.endsWith('/v1/analyze'))).toHaveLength(1));
  const payload = JSON.parse(requests.mock.calls.find(([url]) => url.endsWith('/v1/analyze'))![1]!.body as string);
  expect(payload).toEqual({ moduleHint: preset.moduleId, ageRange: preset.ageRange, caseType: preset.caseType, pregnancyPossible: preset.pregnancy === 'yes' ? true : preset.pregnancy === 'no' ? false : null, pidDiagnosedOrPresumed: preset.pid === 'yes' ? true : preset.pid === 'no' ? false : null, additionalNotes: preset.narrative, earlyPregnancy: preset.earlyPregnancy });
  await userEvent.selectOptions(selector, 'brief');
  expect(screen.getByDisplayValue(DemoCases[0].moduleId)).toBeChecked();
  expect(screen.getByLabelText('Case narrative')).toHaveValue(DemoCases[0].narrative);
  expect(screen.queryByLabelText('Pregnancy test result')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Pregnancy status')).toHaveValue('unknown');
  expect(screen.getByLabelText('PID status')).toHaveValue('unknown');
  await userEvent.click(screen.getByRole('button', { name: 'Clear case' }));
  expect(selector).toHaveValue(''); expect(screen.getByLabelText('Case narrative')).toHaveValue('');
  expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
});
it('uses state-aware guidance without claiming an empty case is ready', async () => {
  mockModules(); render(<App />);
  await screen.findByRole('radio', { name: 'Endometriosis & Chronic Pelvic Pain' });
  expect(screen.getByText('Select a clinical module to begin')).toBeVisible();
  expect(screen.queryByText('Ready for evidence review.')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Case narrative'), 'Use early pregnancy module.');
  expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Analyze case' })).toBeDisabled();
  await userEvent.clear(screen.getByLabelText('Case narrative'));
  await userEvent.click(screen.getByRole('radio', { name: 'Endometriosis & Chronic Pelvic Pain' }));
  expect(screen.getByText('Module selected — enter or review the case narrative')).toBeVisible();
  await userEvent.type(screen.getByLabelText('Case narrative'), 'Synthetic context for review.');
  expect(screen.getByText('Ready to analyze')).toBeVisible();
  expect(screen.getByText('Module selected explicitly; narrative text will not override it.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Clear case' }));
  expect(screen.getByText('Select a clinical module to begin')).toBeVisible();
});
