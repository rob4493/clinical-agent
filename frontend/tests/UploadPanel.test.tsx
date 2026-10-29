import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import UploadPanel from '../src/UploadPanel';
import { readDocument } from '../src/documents/readDocument';
import type { UploadSession } from '../src/documents/session';

vi.mock('../src/documents/readDocument', () => ({ readDocument: vi.fn() }));
const Report = { format: 'txt' as const, text: 'Normal MRI.', parts: [{ text: 'Normal MRI.', start: 0, end: 11, paragraph: 1 }] };
async function upload(text = Report.text) {
  vi.mocked(readDocument).mockResolvedValue({ ...Report, text, parts: [{ ...Report.parts[0], text, end: [...text].length }] });
  const changed = vi.fn<(session: UploadSession) => void>(); const view = render(<UploadPanel onChange={changed} />); const user = userEvent.setup();
  await user.upload(screen.getByLabelText('Choose files or drag and drop'), new File([text], 'report.txt', { type: 'text/plain' }));
  await screen.findByText('Ready for review', { exact: false }).catch(() => {});
  await user.click(screen.getByLabelText('I confirm these files are de-identified and necessary for this review.'));
  return { changed, view, user };
}
it('requires view/review confirmation, invalidates on edit, supports add/remove and discard', async () => {
  const { changed, user } = await upload();
  expect(changed.mock.lastCall![0].blocked).toBe(true); expect(screen.getByText('Confirm reviewed information')).toBeDisabled();
  const previewButton = screen.getByText('View uploaded file'); await user.click(previewButton); expect(screen.getByRole('dialog')).toBeInTheDocument();
  await user.keyboard('{Escape}'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(previewButton).toHaveFocus();
  await user.click(screen.getByText('Review extracted information')); expect(screen.getByLabelText('Reported text · Unverified')).toHaveValue('Normal MRI.');
  await user.click(screen.getByLabelText('I reviewed the uploaded document and verified the extracted information')); await user.click(screen.getByText('Confirm reviewed information'));
  expect(changed.mock.lastCall![0].blocked).toBe(false);
  await user.type(screen.getByLabelText('Reported text · Confirmed'), ' More reported text.'); expect(changed.mock.lastCall![0].blocked).toBe(true);
  await user.click(screen.getByText('Add missing reported information')); expect(screen.getAllByText('Remove candidate')).toHaveLength(2);
  await user.click(screen.getAllByText('Remove candidate')[1]); expect(screen.getAllByText('Remove candidate')).toHaveLength(1);
  await user.click(screen.getByText('Discard all uploads')); expect(changed.mock.lastCall![0]).toEqual({ blocked: false, documents: [], candidates: [] });
});
it('blocks confirmation until identifier warning is reviewed and never renders HTML', async () => {
  const { user, changed } = await upload('Email: synthetic@example.test <img src="https://not-contacted.invalid/" onerror="alert(1)">');
  expect(screen.getByRole('alert')).toHaveTextContent('Possible identifiers');
  await user.click(screen.getByText('View uploaded file')); expect(screen.getByRole('dialog').querySelector('img')).toBeNull();
  await user.click(screen.getByText('Close preview')); expect(screen.getByLabelText('I reviewed the uploaded document and verified the extracted information')).toBeDisabled();
  await user.click(screen.getByText('Review extracted information'));
  await user.click(screen.getByLabelText('I reviewed these warnings and verified the retained information contains no direct identifiers.'));
  expect(screen.getByLabelText('I reviewed the uploaded document and verified the extracted information')).toBeEnabled(); expect(changed.mock.lastCall![0].blocked).toBe(true);
});
it('aborts parsing on unmount and page lifecycle without persistence or object URLs', async () => {
  let signal: AbortSignal | undefined; vi.mocked(readDocument).mockImplementation((file, active) => { expect(file.type).toBe('text/plain'); signal = active; return new Promise(() => {}); });
  const changed = vi.fn(); const view = render(<UploadPanel onChange={changed} />);
  fireEvent.change(screen.getByLabelText('Choose files or drag and drop'), { target: { files: [new File(['text'], 'report.txt', { type: 'text/plain' })] } });
  await waitFor(() => expect(signal).toBeDefined()); view.unmount(); expect(signal!.aborted).toBe(true);
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});
it('rejects excessive counts and file sizes before creating workers', async () => {
  vi.mocked(readDocument).mockClear();
  vi.mocked(readDocument).mockResolvedValue(Report);
  render(<UploadPanel onChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Choose files or drag and drop'), { target: { files: Array.from({ length: 4 }, () => new File(['text'], 'report.txt', { type: 'text/plain' })) } });
  expect(screen.getByRole('status')).toHaveTextContent('Upload limit');
  fireEvent.change(screen.getByLabelText('Choose files or drag and drop'), { target: { files: Array.from({ length: 3 }, () => new File([new Uint8Array(800_000)], 'report.txt', { type: 'text/plain' })) } });
  expect(screen.getByRole('status')).toHaveTextContent('Upload limit');
  fireEvent.change(screen.getByLabelText('Choose files or drag and drop'), { target: { files: [new File([new Uint8Array(1_000_001)], 'report.txt', { type: 'text/plain' })] } });
  expect(screen.getByRole('status')).toHaveTextContent('Unable to read this document safely'); expect(readDocument).not.toHaveBeenCalled();
  fireEvent.drop(document.querySelector('.uploadDrop')!, { dataTransfer: { files: Array.from({ length: 3 }, () => new File(['Normal MRI.'], 'report.txt', { type: 'text/plain' })) } });
  await waitFor(() => expect(readDocument).toHaveBeenCalledTimes(3)); expect(document.querySelectorAll('.uploadItem')).toHaveLength(3);
  fireEvent.click(screen.getAllByText('Remove file')[0]); expect(document.querySelectorAll('.uploadItem')).toHaveLength(2);
  fireEvent(window, new Event('pageshow')); expect(document.querySelectorAll('.uploadItem')).toHaveLength(0);
});

it('keeps initial upload compact and requires de-identification after selecting files', async () => {
  vi.mocked(readDocument).mockResolvedValue(Report);
  const changed = vi.fn(); render(<UploadPanel onChange={changed} />);
  expect(screen.getByRole('heading', { name: 'Add notes or reports (optional)' })).toBeVisible();
  expect(screen.getByText('PDF, DOCX or TXT · Up to 3 files · 1 MB each')).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByText('File requirements and privacy').closest('details')).not.toHaveAttribute('open');
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText('Choose files or drag and drop'), new File(['Normal MRI.'], 'report.txt', { type: 'text/plain' }));
  await screen.findByText('Ready for review', { exact: true });
  expect(screen.getByLabelText('I confirm these files are de-identified and necessary for this review.')).not.toBeChecked();
  await user.click(screen.getByText('View uploaded file')); await user.click(screen.getByText('Close preview'));
  await user.click(screen.getByText('Review extracted information'));
  expect(screen.getByText('Confirm reviewed information')).toBeDisabled();
  expect(changed.mock.lastCall![0].blocked).toBe(true);
  await user.click(screen.getByLabelText('I confirm these files are de-identified and necessary for this review.'));
  await user.click(screen.getByLabelText('I reviewed the uploaded document and verified the extracted information'));
  await user.click(screen.getByText('Confirm reviewed information'));
  expect(changed.mock.lastCall![0].blocked).toBe(false);
  await user.click(screen.getByLabelText('I confirm these files are de-identified and necessary for this review.'));
  expect(changed.mock.lastCall![0].blocked).toBe(true);
});
