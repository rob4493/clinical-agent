import { getDocument, PDFWorker } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { assemble, parseSimple } from './parser';
import { DocumentError, ReadableMessage, UploadLimits, UploadMessage } from './types';
import { checkPdf } from './pdfBoundary';

// PDF data is supplied as bytes. No document-controlled URL is ever requested.
self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; format: 'pdf' | 'docx' | 'txt' }>) => {
  let document: Awaited<ReturnType<typeof getDocument>['promise']> | undefined;
  let loadingTask: ReturnType<typeof getDocument> | undefined;
  let transport: Worker | undefined;
  let pdfTransport: PDFWorker | undefined;
  let reply: { result?: unknown; error?: string } = {};
  try {
    const bytes = new Uint8Array(event.data.bytes);
    if (!bytes.length || bytes.length > UploadLimits.fileBytes) throw new DocumentError();
    if (event.data.format !== 'pdf') { reply = { result: parseSimple(bytes, event.data.format) }; }
    else {
    checkPdf(bytes);
    // An explicit same-origin port avoids PDF.js's DOM-dependent worker fallback.
    transport = new Worker(pdfWorker, { type: 'module' });
    pdfTransport = PDFWorker.create({ port: transport, verbosity: 0 });
    const task = loadingTask = getDocument({ data: bytes, worker: pdfTransport, verbosity: 0, useWorkerFetch: false, useSystemFonts: false, disableFontFace: true, useWasm: false, stopAtErrors: true, enableXfa: false, maxImageSize: 0 });
    task.onPassword = () => { void task.destroy(); };
    document = await task.promise;
    if (document.numPages > UploadLimits.pages || await document.getJSActions() || await document.getAttachments()) throw new DocumentError();
    const paragraphs: { text: string; page: number }[] = [];
    for (let page = 1; page <= document.numPages; page++) {
      const sheet = await document.getPage(page);
      if (await sheet.getJSActions()) throw new DocumentError();
      const annotations = await sheet.getAnnotations();
      if (annotations.some(annotation => !['Link', 'Text', 'Highlight'].includes(annotation.subtype) || annotation.actions || annotation.jsAction || annotation.file)) throw new DocumentError();
      const extracted = await sheet.getTextContent({ disableNormalization: true });
      const text = extracted.items.map(entry => 'str' in entry ? entry.str + (entry.hasEOL ? '\n' : ' ') : '').join('');
      paragraphs.push(...text.split('\n').filter(text => text.trim()).map(text => ({ text, page })));
      if (paragraphs.reduce((size, paragraph) => size + paragraph.text.length, 0) > UploadLimits.text) throw new DocumentError();
      sheet.cleanup();
    }
    const result = assemble('pdf', paragraphs, document.numPages);
    if (result.text.replace(/\s/g, '').length < 10) throw new DocumentError(ReadableMessage);
    reply = { result };
    }
  } catch (failure) {
    reply = { error: failure instanceof DocumentError ? failure.message : UploadMessage };
  } finally {
    try { await loadingTask?.destroy(); } catch { reply = { error: UploadMessage }; }
    finally { pdfTransport?.destroy(); transport?.terminate(); }
  }
  self.postMessage(reply);
};
