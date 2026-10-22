import { checkUpload, DocumentError, UploadLimits, UploadMessage } from './types';
import type { ParsedDocument } from './types';

/** Disposable worker: cancellation/deadline terminates parsing, including synchronous ZIP/XML work. */
export async function readDocument(file: File, signal: AbortSignal): Promise<ParsedDocument> {
  const format = checkUpload(file.name, file.type, file.size); signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    let completed = false;
    const finish = (result?: ParsedDocument, message = UploadMessage) => {
      if (completed) return; completed = true; clearTimeout(timer); signal.removeEventListener('abort', cancel); worker.terminate();
      if (result) resolve(result); else reject(new DocumentError(message));
    };
    const cancel = () => finish(undefined, 'Document processing cancelled.');
    const timer = setTimeout(() => finish(undefined, 'Document processing exceeded the time limit.'), UploadLimits.milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = event => finish(event.data.result, event.data.error);
    worker.onerror = event => { event.preventDefault(); finish(); };
    void file.arrayBuffer().then(bytes => {
      if (!completed) worker.postMessage({ bytes, format }, [bytes]);
    }).catch(() => finish());
    if (signal.aborted) cancel();
  });
}
