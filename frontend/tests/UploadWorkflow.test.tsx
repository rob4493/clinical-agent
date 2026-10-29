import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import App from '../src/App';
import { readDocument } from '../src/documents/readDocument';
import { analysisResult, Modules, Ready } from './fixtures';
vi.mock('../src/documents/readDocument', () => ({ readDocument: vi.fn() }));

it('blocks Analyze until explicit document review and sends only confirmed canonical data', async () => {
  const requests: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const payload = url.endsWith('/v1/modules') ? Modules : url.endsWith('/ready') ? Ready : analysisResult();
    if (options?.body) requests.push(JSON.parse(options.body as string));
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'X-Clinical-Mode': 'standard' } });
  }));
  vi.mocked(readDocument).mockResolvedValue({ format: 'txt', text: 'Normal MRI.', parts: [{ text: 'Normal MRI.', start: 0, end: 11 }] });
  render(<App />); const user = userEvent.setup();
  await screen.findByRole('radio', { name: 'Fictional review module' }); await user.click(screen.getByDisplayValue('FictionalModule'));
  fireEvent.change(screen.getByLabelText('Case narrative'), { target: { value: 'Manual context.' } });
  await user.upload(screen.getByLabelText('Choose files or drag and drop'), new File(['Normal MRI.'], 'report.txt', { type: 'text/plain' }));
  await screen.findByText('Ready for review', { exact: true });
  await user.click(screen.getByLabelText('I confirm these files are de-identified and necessary for this review.')); expect(screen.getByRole('button', { name: 'Analyze case' })).toBeDisabled();
  fireEvent.submit(document.getElementById('caseForm')!); expect(requests).toHaveLength(0);
  await user.click(screen.getByText('View uploaded file')); await user.click(screen.getByText('Close preview')); await user.click(screen.getByText('Review extracted information'));
  await user.click(screen.getByLabelText('I reviewed the uploaded document and verified the extracted information')); await user.click(screen.getByText('Confirm reviewed information'));
  await user.click(screen.getByRole('button', { name: 'Analyze case' })); await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ schemaVersion: '1.0.0', moduleId: 'FictionalModule', originalNarrative: { state: 'present', value: 'Manual context.' }, clinicianInterpretations: [{ text: { state: 'present', value: 'Normal MRI.' }, verification: 'clinicianVerified' }] });
  expect(JSON.stringify(requests)).not.toContain('report.txt'); expect(screen.getByLabelText('Case narrative')).toHaveValue('Manual context.');
  await user.click(screen.getByRole('button', { name: 'Clear case' })); expect(document.querySelector('.uploadItem')).toBeNull(); expect(screen.getByLabelText('Case narrative')).toHaveValue('');
});
