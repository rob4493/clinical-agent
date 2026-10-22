import { expect, it, vi } from 'vitest';
import { readDocument } from '../src/documents/readDocument';
import { UploadLimits } from '../src/documents/types';

function workerFixture() {
  const worker = { terminate: vi.fn(), postMessage: vi.fn(), onmessage: null as null | ((event: { data: unknown }) => void), onerror: null as null | ((event: Event) => void) };
  vi.stubGlobal('Worker', vi.fn(function () { return worker; })); return worker;
}
function fileFixture() { return { name: 'report.txt', size: 12, type: 'text/plain', arrayBuffer: () => Promise.resolve(new ArrayBuffer(12)) } as File; }
it('terminates workers on success and uses transferred bytes', async () => {
  const worker = workerFixture(); const result = readDocument(fileFixture(), new AbortController().signal); await Promise.resolve();
  expect(worker.postMessage).toHaveBeenCalledOnce(); const parsed = { format: 'txt', text: 'Reported text.', parts: [] };
  worker.onmessage!({ data: { result: parsed } }); expect(await result).toEqual(parsed); expect(worker.terminate).toHaveBeenCalledOnce();
});
it('cancels and ignores late results without retaining a worker', async () => {
  const worker = workerFixture(), controller = new AbortController(); const result = readDocument(fileFixture(), controller.signal);
  controller.abort(); await expect(result).rejects.toThrow('cancelled'); worker.onmessage!({ data: { result: { text: 'late' } } }); expect(worker.terminate).toHaveBeenCalledOnce();
});
it('bounds parser and initial file-read time', async () => {
  vi.useFakeTimers();
  try {
    const worker = workerFixture(); const result = readDocument({ ...fileFixture(), arrayBuffer: () => new Promise(() => {}) } as File, new AbortController().signal);
    const rejection = expect(result).rejects.toThrow('time limit'); await vi.advanceTimersByTimeAsync(UploadLimits.milliseconds); await rejection; expect(worker.terminate).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
it('sanitizes worker errors and malformed-file failure', async () => {
  const worker = workerFixture(); const result = readDocument(fileFixture(), new AbortController().signal); worker.onerror!(new Event('error'));
  await expect(result).rejects.toThrow('Unable to read this document safely');
});
