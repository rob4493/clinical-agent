import { useEffect, useRef, useState } from 'react';
import { plainText, requestJson } from './api';

interface Details { title: string; status: string; statements: string[]; limitations: string; organization?: string; date?: string; sourceType?: string; captureStatus?: string; jurisdiction?: string }

export default function SourceDetails({ sourceId, onClose, competition = false }: { sourceId: string; onClose: () => void; competition?: boolean }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); setFailed(true); }, 10000);
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    async function loadDetails() {
      try {
        if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(sourceId)) throw new Error();
        const result = await requestJson((competition ? '/v1/competition/sources/' : '/v1/demo/sources/') + encodeURIComponent(sourceId), controller.signal);
        if (result.status !== 200 || result.runtimeMode !== (competition ? 'competition' : 'synthetic')) throw new Error();
        const fields = result.payload as Details;
        if (!fields || !Array.isArray(fields.statements) || !fields.statements.length || fields.statements.length > 32) throw new Error();
        const projection = { title: plainText(fields.title, 500), status: plainText(fields.status, 100),
          statements: fields.statements.map(statement => plainText(statement, 6000)), limitations: plainText(fields.limitations, competition ? 6000 : 1000),
          ...(competition ? { organization: plainText(fields.organization, 500), ...(fields.date == null ? {} : { date: plainText(fields.date, 200) }), sourceType: plainText(fields.sourceType, 100), captureStatus: plainText(fields.captureStatus, 500), jurisdiction: plainText(fields.jurisdiction, 100) } : {}) };
        if (!controller.signal.aborted) setDetails(projection);
      } catch { if (!controller.signal.aborted) setFailed(true); }
      finally { clearTimeout(timer); }
    }
    void loadDetails();
    return () => { controller.abort(); clearTimeout(timer); previousFocus?.focus(); };
  }, [sourceId, competition]);
  return <div className="sourceOverlay"><section className="sourceDialog" role="dialog" aria-modal="true" aria-labelledby="sourceDetailsTitle" onKeyDown={event => {
    if (event.key === 'Escape') onClose();
    // The read-only dialog has one interactive control; keep keyboard focus inside it.
    if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus(); }
  }}><div className="cardHeading"><h2 id="sourceDetailsTitle">Source details</h2><button ref={closeRef} type="button" onClick={onClose}>Close source</button></div>
    {failed ? <p role="alert">Source details are unavailable. Please try again.</p> : !details ? <p role="status">Loading source details…</p> : <>
      <h3>{details.title}</h3>{details.organization && <p>{details.organization}{details.date ? ` · ${details.date}` : ''}</p>}{details.sourceType && <p>{details.sourceType} · {details.jurisdiction}</p>}{details.captureStatus && <p>{details.captureStatus}</p>}<p>{details.status}</p><h3>Available statements</h3><ul>{details.statements.map((statement, index) => <li key={index}>{statement}</li>)}</ul><h3>Limitations</h3><p>{details.limitations}</p>
    </>}
  </section></div>;
}
