import { reconstructAssistance, type PublicConflictAssistance } from '../../shared/conflictAssistance';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ConflictDialog from '../src/ConflictDialog';
import { ConflictReports } from '../src/DemoCases';
import { resolutionLabel } from '../../shared/conflictReview';
import App from '../src/App';
import { CompetitionNotice } from '../src/api';
import { analysisResult, Modules, Ready } from './fixtures';


function reviewFor(option: string) {
  const conflict = structuredClone(ConflictReports);
  if (option === 'changedOverTime') { conflict.assertions[0].effectiveDate = { kind: 'exact', precision: 'day', value: '2026-01-01' }; conflict.assertions[1].effectiveDate = { kind: 'exact', precision: 'day', value: '2026-02-01' }; conflict.conflictType = 'temporalDifference'; }
  if (option === 'differentContext') { conflict.assertions[1].contextId = 'PreviousContext'; conflict.conflictType = 'differentContext'; }
  if (option === 'correctedReport') { conflict.assertions[1].reportStatus = 'corrected'; conflict.conflictType = 'reportRelationship'; }
  return conflict;
}

function mountDialog(conflict = ConflictReports) { const confirm = vi.fn(), close = vi.fn(); render(<ConflictDialog conflict={conflict} onClose={close} onConfirm={confirm} />); return { confirm, close }; }

describe('Clinician conflict review', () => {
  it('opens with no source selected, focuses the dialog and supports Escape', async () => {
    const { close, confirm } = mountDialog(); const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus(); expect(dialog).toHaveAccessibleName('Conflicting information requires review');
    expect(screen.getAllByRole('radio')).toHaveLength(4); expect(screen.getAllByRole('radio').every(radio => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: 'Continue to confirmation' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
  });
  for (const option of ConflictReports.allowedOptions) it('requires explicit confirmation for ' + option, async () => {
    const conflict = reviewFor(option); const { confirm } = mountDialog(conflict);
    await userEvent.click(screen.getByRole('radio', { name: resolutionLabel(option, conflict) })); expect(confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Continue to confirmation' })); expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText(/No disputed value will be submitted/)).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText('Optional clinician resolution note'), 'Source verification is pending.');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm local resolution' }));
    expect(confirm).toHaveBeenCalledOnce(); expect(confirm.mock.calls[0][0]).toMatchObject({ option, reanalysis: 'paused', note: 'Source verification is pending.' });
  });
  it('traps keyboard focus and keeps safe assertion wording visible', async () => {
    mountDialog(); const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Pregnancy is reported as not possible.')).toBeVisible();
    expect(within(dialog).getByText('Pregnancy is reported as confirmed.')).toBeVisible();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true }); expect(screen.getAllByRole('radio').at(-1)).toHaveFocus();
    await userEvent.tab(); expect(screen.getByRole('button', { name: 'Close conflict review' })).toHaveFocus();
  });
  it('loads the fixture, opens only after server conflict, records locally and clears without persistence', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const conflict = analysisResult('DataConflict'); conflict.response.decisionSupportNotice = CompetitionNotice; conflict.renderedText = CompetitionNotice;
    const requests = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/v1/modules') ? { modules: [{ ...Modules.modules[0], moduleId: 'module_01_endo' }] } : url.endsWith('/ready') ? Ready : conflict), { headers: { 'X-Clinical-Mode': 'competition' } }));
    // Match the actual public runtime header used by the client.
    vi.stubGlobal('fetch', requests);
    render(<App />); await waitFor(() => expect(screen.getByLabelText('Try a demonstration case')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Try a demonstration case'), { target: { value: 'conflict' } });
    expect(screen.getByLabelText('Case narrative')).toHaveValue('pregnancy confirmed');
    expect(document.querySelector('input[name=clinicalModule]:checked')).toHaveAttribute('value', 'module_01_endo');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Analyze case' }));
    await screen.findByRole('button', {name:'Review conflict'});await waitFor(()=>expect(screen.getByRole('heading',{name:'Resolve conflicting information'})).toHaveFocus());expect(screen.queryByRole('dialog')).not.toBeInTheDocument();await userEvent.click(screen.getByRole('button',{name:'Review conflict'}));
    const dialog = await screen.findByRole('dialog'); expect(dialog).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close conflict review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review conflict' })).toHaveFocus());
    await userEvent.click(screen.getByRole('button', { name: 'Review conflict' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Keep unresolved' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to confirmation' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm local resolution' }));
    expect(screen.getByRole('button', { name: 'Analyze case' })).toBeDisabled();
    expect(requests.mock.calls.filter(([url]) => url.endsWith('/v1/analyze'))).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Clear case' }));
    expect(screen.queryByRole('button', { name: 'Review conflict' })).not.toBeInTheDocument(); expect(storage).not.toHaveBeenCalled();
  });
});

it('keeps server urgent warnings first and requires acknowledgement before opening conflict review', async () => {
  const conflict = analysisResult('DataConflict', true);
  conflict.response.decisionSupportNotice = CompetitionNotice;
  conflict.renderedText = 'Fictional urgent assessment warning. [1]\n\n' + CompetitionNotice;
  const requests = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/v1/modules') ? { modules: [{ ...Modules.modules[0], moduleId: 'module_01_endo' }] } : url.endsWith('/ready') ? Ready : conflict), { headers: { 'X-Clinical-Mode': 'competition' } }));
  vi.stubGlobal('fetch', requests); render(<App />);
  await waitFor(() => expect(screen.getByLabelText('Try a demonstration case')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Try a demonstration case'), { target: { value: 'conflict' } });
  await userEvent.click(screen.getByRole('button', { name: 'Analyze case' }));
  const urgent = await screen.findByRole('heading', { name: 'Urgent assessment' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.querySelector('.responseCard')!.firstElementChild).toHaveClass('urgentPanel');
  await waitFor(() => expect(urgent).toHaveFocus());
  await userEvent.click(screen.getByRole('button', { name: 'I have reviewed the urgent warning' }));
  await userEvent.click(screen.getByRole('button', { name: 'Review conflict' }));
  expect(await screen.findByRole('dialog')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Close conflict review' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review conflict' })).toHaveFocus());
  const submitted = JSON.parse((requests.mock.calls.find(([url]) => url.endsWith('/v1/analyze')) as unknown as [string, RequestInit])[1].body as string);
  expect(submitted).not.toHaveProperty('conflictReview'); expect(submitted).not.toHaveProperty('assertions');
});

it('shows grouped report wording without normalized values or unsupported explanation options', () => {
  mountDialog();
  expect(screen.getByRole('group', { name: 'Use for this analysis' })).toBeVisible();
  expect(screen.getByRole('group', { name: 'Do not resolve' })).toBeVisible();
  expect(screen.queryByRole('group', { name: 'Explain the discrepancy' })).not.toBeInTheDocument();
  expect(screen.queryByText('Normalized value')).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Use Synthetic report A for this analysis' })).toBeVisible();
  expect(screen.getByText('Your selection will not alter or delete the original reports.')).toBeVisible();
});

it('renders only reconstructed Watson questions without changing the four resolution options', () => {
  const assistance = reconstructAssistance({ contractVersion: '1', conflictId: ConflictReports.id, summaryVariantId: 'pregnancy-status-opposition', verificationQuestionIds: ['check-effective-dates'] });
  render(<ConflictDialog conflict={ConflictReports} assistance={assistance} onClose={vi.fn()} onConfirm={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Watson-assisted verification questions' })).toBeVisible();
  expect(screen.getByText(assistance.questions[0])).toBeVisible(); expect(screen.getAllByRole('radio')).toHaveLength(4);
  expect(document.querySelector('.conflictHeader')).toBeInTheDocument(); expect(document.querySelector('.conflictFooter')).toBeInTheDocument(); expect(document.querySelector('.conflictBody')).toBeInTheDocument();
});
for (const invalid of [{ summary: 'PrivateGeneratedSentinel' }, { conflictId: 'other' }, { verificationQuestionIds: ['invented'] }, { allowedOptions: ['firstAssertion'] }]) it('ignores invalid optional assistance and keeps the complete workflow ' + Object.keys(invalid), async () => {
  const assistance = { ...reconstructAssistance({ contractVersion: '1', conflictId: ConflictReports.id, summaryVariantId: 'pregnancy-status-opposition', verificationQuestionIds: ['check-effective-dates'] }), ...invalid } as PublicConflictAssistance;
  const confirm = vi.fn(); render(<ConflictDialog conflict={ConflictReports} assistance={assistance} onClose={vi.fn()} onConfirm={confirm} />);
  expect(screen.queryByRole('heading', { name: 'Watson-assisted verification questions' })).not.toBeInTheDocument(); expect(screen.getAllByRole('radio')).toHaveLength(4);
  await userEvent.click(screen.getByRole('radio', { name: 'Keep unresolved' })); await userEvent.click(screen.getByRole('button', { name: 'Continue to confirmation' }));
  expect(confirm).not.toHaveBeenCalled(); await userEvent.click(screen.getByRole('button', { name: 'Confirm local resolution' })); expect(confirm.mock.calls[0][0].option).toBe('unresolved');
  expect(document.body).not.toHaveTextContent('PrivateGeneratedSentinel');
});

it('shows actual structured conflict values without inventing absent report provenance',()=>{
 const submitted={caseInput:{moduleHint:'module_02_early_pregnancy',caseType:'brief' as const,pregnancyPossible:true,earlyPregnancy:{clinicallyStable:true,hemodynamicInstability:true},additionalNotes:''},fieldName:'earlyPregnancy.clinicallyStable'};
 render(<ConflictDialog submitted={submitted} onClose={vi.fn()} onConfirm={vi.fn()} onUpdate={vi.fn()}/>);
 expect(screen.getByRole('heading',{name:'Other submitted structured context'})).toBeVisible();expect(screen.getByText(/hemodynamic Instability: true/)).toBeVisible();expect(screen.getByText('Yes')).toBeVisible();expect(screen.queryByText('Synthetic report A')).not.toBeInTheDocument();
});
