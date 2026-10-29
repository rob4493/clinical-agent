import { useEffect, useRef, useState } from 'react';
import { readDocument } from './documents/readDocument';
import { extractCandidates, screenIdentifiers } from './documents/review';
import { checkUpload, DocumentError, UploadLimits, UploadMessage } from './documents/types';
import type { Candidate, ParsedDocument } from './documents/types';
import type { UploadSession } from './documents/session';

interface Upload { id: string; file: File; status: string; parsed?: ParsedDocument; candidates: Candidate[]; viewed: boolean; reviewed?: boolean; confirmed: boolean }

/** Browser-memory review boundary. Original bytes, names and excerpts never enter an API request. */
export default function UploadPanel({ onChange, disabled = false }: { onChange: (session: UploadSession) => void; disabled?: boolean }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [warningReviewed, setWarningReviewed] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [message, setMessage] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const controllers = useRef(new Map<string, AbortController>());
  const current = useRef<Upload[]>([]);
  const dialog = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  current.current = uploads;

  function update(records: Upload[]) { current.current = records; setUploads(records); }
  function invalidate(records = current.current) { setConfirmChecked(false); setWarningReviewed(false); update(records.map(upload => ({ ...upload, status: upload.parsed ? 'Needs correction' : upload.status, confirmed: false, candidates: upload.candidates.map(candidate => ({ ...candidate, verification: 'unverified' })) }))); }
  function discard() {
    generation.current++; controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); busy.current = false;
    update([]); setPreviewId(''); setReviewId(''); setSearch(''); setConfirmChecked(false); setWarningReviewed(false); setAcknowledged(false); setMessage('');
  }
  useEffect(() => {
    const clear = () => discard(); window.addEventListener('pagehide', clear); window.addEventListener('pageshow', clear);
    return () => { generation.current++; controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); current.current = []; window.removeEventListener('pagehide', clear); window.removeEventListener('pageshow', clear); };
  }, []);
  useEffect(() => {
    onChange({ blocked: uploads.length > 0 && uploads.some(upload => !upload.confirmed), documents: uploads.map(upload => ({ id: upload.id, format: upload.parsed?.format ?? 'txt' })), candidates: uploads.flatMap(upload => upload.candidates) });
  }, [uploads, onChange]);
  useEffect(() => { if (previewId) dialog.current?.focus(); }, [previewId]);

  async function addFiles(files: File[]) {
    if (disabled) return;
    if (busy.current) return;
    if (files.length + current.current.length > UploadLimits.files || files.reduce((size, file) => size + file.size, 0) + current.current.reduce((size, upload) => size + upload.file.size, 0) > UploadLimits.totalBytes) { setMessage('Upload limit: three files and 2 MB total.'); return; }
    try { files.forEach(file => checkUpload(file.name, file.type, file.size)); } catch { setMessage(UploadMessage); return; }
    const added = files.map(file => ({ id: 'Document' + crypto.randomUUID().replaceAll('-', ''), file, status: 'Uploaded', candidates: [], viewed: false, confirmed: false } as Upload));
    setAcknowledged(false);
    invalidate([...current.current, ...added]); setMessage(''); busy.current = true;
    const activeGeneration = generation.current;
    try {
      // Sequential workers bound aggregate decompression and memory pressure.
      for (const upload of added) {
        if (generation.current !== activeGeneration || !current.current.some(record => record.id === upload.id)) continue;
        const controller = new AbortController(); controllers.current.set(upload.id, controller);
        update(current.current.map(record => record.id === upload.id ? { ...record, status: 'Extracting' } : record));
        try {
          const parsed = await readDocument(upload.file, controller.signal), candidates = extractCandidates(parsed, upload.id);
          if (generation.current !== activeGeneration || controller.signal.aborted) continue;
          setWarningReviewed(false); setConfirmChecked(false);
          update(current.current.map(record => record.id === upload.id ? { ...record, parsed, candidates, status: screenIdentifiers(parsed.text + '\n' + record.file.name).length ? 'Possible identifiers detected' : 'Ready for review' } : record));
        } catch (failure) {
          if (generation.current === activeGeneration && !controller.signal.aborted) update(current.current.map(record => record.id === upload.id ? { ...record, status: 'Extraction failed' } : record));
          if (generation.current === activeGeneration && !controller.signal.aborted) setMessage(failure instanceof DocumentError ? failure.message : UploadMessage);
        } finally { controllers.current.delete(upload.id); }
      }
    } finally { if (generation.current === activeGeneration) busy.current = false; }
  }
  function remove(id: string) { controllers.current.get(id)?.abort(); controllers.current.delete(id); invalidate(current.current.filter(upload => upload.id !== id)); if (reviewId === id) setReviewId(''); if (previewId === id) closePreview(); }
  function openPreview(upload: Upload, button: HTMLElement) {
    returnFocus.current = button; setPage(1); setSearch(''); setPreviewId(upload.id);
    update(current.current.map(record => record.id === upload.id ? { ...record, viewed: true } : record));
  }
  function closePreview() { setPreviewId(''); setSearch(''); returnFocus.current?.focus(); }
  function edit(id: string, candidateId: string, text: string) { invalidate(current.current.map(upload => upload.id === id ? { ...upload, candidates: upload.candidates.map(candidate => candidate.id === candidateId ? { ...candidate, text } : candidate) } : upload)); }
  const warnings = uploads.flatMap(upload => [...screenIdentifiers(upload.parsed?.text ?? ''), ...screenIdentifiers(upload.file.name), ...screenIdentifiers(upload.candidates.map(candidate => candidate.text).join('\n'))].map(warning => ({ ...warning, documentId: upload.id })));
  const eligible = acknowledged && uploads.length > 0 && uploads.every(upload => upload.parsed && upload.viewed && upload.reviewed && upload.candidates.length && upload.candidates.every(candidate => candidate.text.trim())) && (!warnings.length || warningReviewed);
  function confirm() {
    if (!eligible || !confirmChecked) return;
    update(current.current.map(upload => ({ ...upload, status: 'Confirmed', confirmed: true, candidates: upload.candidates.map(candidate => ({ ...candidate, verification: 'clinicianVerified' })) })));
    setMessage('Confirmed. Analysis still validates privacy, schema and text limits.');
  }
  const active = uploads.find(upload => upload.id === reviewId), preview = uploads.find(upload => upload.id === previewId);
  const visibleParts = preview?.parsed?.parts.filter(part => !part.page || part.page === page) ?? [];
  const previewText = visibleParts.map(part => part.text).join('\n');
  return <section className="uploadPanel" aria-labelledby="uploadTitle">
    <h3 id="uploadTitle" tabIndex={-1}>Add notes or reports (optional)</h3>
    <p className="fieldHint" id="uploadPrivacy">PDF, DOCX or TXT · Up to 3 files · 1 MB each</p>
    <div className="uploadDrop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }}>
      <label htmlFor="documentFiles">Choose files or drag and drop</label><input className="uploadInput" id="documentFiles" type="file" multiple accept=".pdf,.docx,.txt" disabled={disabled || uploads.some(upload => upload.status === 'Extracting')} aria-describedby="uploadPrivacy" onChange={event => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    </div>
    <details className="uploadRequirements"><summary>File requirements and privacy</summary>
      <p>Up to three files, 1 MB each and 2 MB total. PDFs must contain readable text and no more than twenty pages. DOCX and UTF-8 TXT are also supported. No scans, OCR or medical-image interpretation.</p>
      <p>Remove patient names, birth dates, addresses, phone/email details, medical-record, insurance and account identifiers. Automated screening cannot guarantee de-identification; you are responsible for confirming it.</p>
      <p>Files and previews stay in browser memory. View each file, review the extracted text and explicitly confirm it before analysis. Original files and filenames are not submitted.</p>
    </details>
    {!!uploads.length && <label className="uploadCheck"><input type="checkbox" checked={acknowledged} onChange={event => { setAcknowledged(event.target.checked); invalidate(); }} />I confirm these files are de-identified and necessary for this review.</label>}
    <p role="status" aria-live="polite">{message}</p>
    {uploads.map(upload => <article className="uploadItem" key={upload.id}><strong>{upload.file.name}</strong><p>{upload.file.type || 'Type checked from content'} · {upload.file.size.toLocaleString()} bytes{upload.parsed?.pageCount ? ` · ${upload.parsed.pageCount} pages` : ''} · <span role="status">{upload.status}</span></p>
      <div className="uploadActions"><button type="button" onClick={event => openPreview(upload, event.currentTarget)}>View uploaded file</button><button type="button" disabled={!upload.parsed} onClick={() => { setReviewId(upload.id); update(current.current.map(record => record.id === upload.id ? { ...record, reviewed: true } : record)); }}>Review extracted information</button><button type="button" onClick={() => remove(upload.id)}>Remove file</button></div>
    </article>)}
    {warnings.length > 0 && <aside className="uploadWarning" role="alert"><strong>Possible identifiers detected</strong><ul>{warnings.slice(0, 12).map((warning, index) => <li key={index}>{warning.category} — character {warning.start + 1} in a document, filename or edited candidate.</li>)}</ul><p>Review the original and correct the candidates or remove the file. The original is not redacted. Server privacy checks may still reject identifiers.</p><label className="uploadCheck"><input type="checkbox" checked={warningReviewed} onChange={event => { setWarningReviewed(event.target.checked); setConfirmChecked(false); }} />I reviewed these warnings and verified the retained information contains no direct identifiers.</label></aside>}
    {active?.parsed && <div className="uploadReview"><div><h4>Original extracted text</h4><pre>{active.parsed.text}</pre></div><div><h4>Review reported information</h4><p>Verbatim text candidates, not clinical conclusions. Confidence: not scored. Verify every item against the original.</p>{active.candidates.map(candidate => <div className="candidate" key={candidate.id}><label htmlFor={candidate.id}>Reported text · {candidate.verification === 'clinicianVerified' ? 'Confirmed' : 'Unverified'}</label><textarea id={candidate.id} value={candidate.text} rows={3} maxLength={2000} onChange={event => edit(active.id, candidate.id, event.target.value)} /><small>{candidate.page ? `Page ${candidate.page}; ` : ''}paragraph {candidate.paragraph ?? 'document-wide'}; characters {candidate.start + 1}–{candidate.end}. Source excerpt: {candidate.excerpt}</small><button type="button" onClick={() => invalidate(current.current.map(upload => upload.id === active.id ? { ...upload, candidates: upload.candidates.filter(record => record.id !== candidate.id) } : upload))}>Remove candidate</button></div>)}
      <button type="button" disabled={active.candidates.length >= UploadLimits.candidates} onClick={() => { const candidate: Candidate = { id: 'Observation' + crypto.randomUUID().replaceAll('-', ''), documentId: active.id, text: '', excerpt: [...active.parsed!.text].slice(0, 240).join(''), start: 0, end: [...active.parsed!.text].length, verification: 'unverified', confidence: null }; invalidate(current.current.map(upload => upload.id === active.id ? { ...upload, candidates: [...upload.candidates, candidate] } : upload)); }}>Add missing reported information</button></div></div>}
    {!!uploads.length && <><p className="fieldHint">View each original, review every item, and confirm. Edits or file changes invalidate confirmation. Only confirmed reported text is currently supported; structured tests, dates and other rich fields are not inferred.</p><label className="uploadCheck"><input type="checkbox" checked={confirmChecked} disabled={!eligible} onChange={event => setConfirmChecked(event.target.checked)} />I reviewed the uploaded document and verified the extracted information</label><div className="uploadActions"><button type="button" disabled={!eligible || !confirmChecked} onClick={confirm}>Confirm reviewed information</button><button type="button" onClick={discard}>Discard all uploads</button></div></>}
    {preview && <div className="previewBackdrop"><div className="documentDialog" role="dialog" aria-modal="true" aria-labelledby="documentPreviewTitle" tabIndex={-1} ref={dialog} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); closePreview(); }
      if (event.key === 'Tab') { const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input')); const first = controls[0], last = controls.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); } }
    }}><h3 id="documentPreviewTitle">View uploaded file</h3><p>{preview.file.name}</p><p>{preview.parsed?.format === 'pdf' ? 'Safe extracted-text PDF preview. Visual layout, images and active content are not rendered.' : preview.parsed?.format === 'docx' ? 'Safe plain-text DOCX preview. Formatting may not be preserved.' : 'Escaped plain-text preview.'}</p>
      {!preview.parsed ? <p role="alert">Preview unavailable. This file has not passed safe text extraction.</p> : <><label htmlFor="documentSearch">Find text in this preview</label><input id="documentSearch" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} /><p role="status">{search ? previewText.toLowerCase().includes(search.toLowerCase()) ? 'Text found on this page.' : 'Text not found on this page.' : ''}</p>{preview.parsed.pageCount && <div className="uploadActions"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button><span>Page {page} of {preview.parsed.pageCount}</span><button type="button" disabled={page >= preview.parsed.pageCount} onClick={() => setPage(page + 1)}>Next page</button></div>}<pre>{previewText}</pre></>}
      <button type="button" onClick={closePreview}>Close preview</button></div></div>}
  </section>;
}
