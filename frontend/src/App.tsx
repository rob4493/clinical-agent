import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ClinicalModule, Review, RuntimeMode, PregnancyContext } from './api';
import { CompetitionBanner, DemoNotice, isReady, readError, readModules, readReview, requestJson, UnexpectedMessage } from './api';
import ResponsePanel from './ResponsePanel';
import { DemoCases, PregnancyCases } from './DemoCases';
import PregnancyFields from './PregnancyFields';
import ScopePanel from './ScopePanel';

const AgeRanges = ['Under 18', '18–24', '25–34', '35–44', '45–54', '55–64', '65+'];
const configuredDeadline = import.meta.env.VITE_REQUEST_DEADLINE_MS || '20000';
if (!/^[0-9]+$/.test(configuredDeadline) || Number(configuredDeadline) < 1000 || Number(configuredDeadline) > 120000) throw new Error('Invalid request deadline configuration.');
const RequestDeadline = Number(configuredDeadline);
type Status = 'unknown' | 'yes' | 'no';

export function threeState(status: Status): boolean | null { return status === 'unknown' ? null : status === 'yes'; }

export default function App() {
  const [modules, setModules] = useState<ClinicalModule[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [ageRange, setAgeRange] = useState('');
  const [caseType, setCaseType] = useState<'brief' | 'detailed'>('brief');
  const [pregnancy, setPregnancy] = useState<Status>('unknown');
  const [pid, setPid] = useState<Status>('unknown');
  const [narrative, setNarrative] = useState('');
  const [earlyPregnancy, setEarlyPregnancy] = useState<PregnancyContext>({});
  const [demoCaseId, setDemoCaseId] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [availabilityError, setAvailabilityError] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [synthetic, setSynthetic] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('standard');
  const [canRequest, setCanRequest] = useState(false);
  const [pending, setPending] = useState(false);
  const [cancellationMessage, setCancellationMessage] = useState('');
  const requestController = useRef<AbortController | null>(null);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moduleController = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const pendingRequest = useRef(false);
  const mounted = useRef(true);
  const narrativeRef = useRef<HTMLTextAreaElement>(null);
  const moduleRef = useRef<HTMLSelectElement>(null);

  const clearCase = useCallback(() => {
    // Invalidate even a transport that ignores abort: a late result cannot restore cleared case data.
    requestGeneration.current += 1;
    requestController.current?.abort();
    if (requestTimer.current !== null) clearTimeout(requestTimer.current);
    requestTimer.current = null;
    pendingRequest.current = false;
    setPending(false); setReview(null); setError(''); setCancellationMessage('');
    requestController.current = null;
    setModuleId(''); setAgeRange(''); setCaseType('brief');
    setPregnancy('unknown'); setPid('unknown'); setNarrative(''); setDemoCaseId('');
    setEarlyPregnancy({});
  }, []);

  const loadAvailability = useCallback(async () => {
    moduleController.current?.abort();
    const controller = new AbortController();
    moduleController.current = controller;
    setLoading(true); setAvailabilityError(''); setReady(false);
    const timer = setTimeout(() => controller.abort(), RequestDeadline);
    try {
      const [catalog, readiness] = await Promise.all([
        requestJson('/v1/modules', controller.signal), requestJson('/ready', controller.signal),
      ]);
      if (!mounted.current || moduleController.current !== controller) return;
      if (catalog.status !== 200) throw new Error(UnexpectedMessage);
      if (catalog.runtimeMode !== readiness.runtimeMode) throw new Error(UnexpectedMessage);
      setSynthetic(readiness.runtimeMode === 'synthetic');
      setRuntimeMode(readiness.runtimeMode);
      const available = readModules(catalog.payload);
      setModules(available);
      setModuleId(selected => available.some(module => module.moduleId === selected) ? selected : '');
      setReady(readiness.status === 200 && isReady(readiness.payload));
      // Competition can return safe dependency-unavailable outcomes while listing
      // its modules. Allowing a request does not turn a 503 into readiness.
      setCanRequest(readiness.status === 200 && isReady(readiness.payload) || (readiness.runtimeMode === 'competition' && readiness.status === 503 && (readiness.payload as { reasonCode?: string })?.reasonCode === 'analysisUnavailable'));
    } catch {
      if (mounted.current && moduleController.current === controller) {
        setModules([]); setModuleId(''); setCanRequest(false); setAvailabilityError('Analysis is unavailable. Check that the backend is configured and reachable, then refresh availability.');
      }
    } finally {
      clearTimeout(timer);
      if (mounted.current && moduleController.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadAvailability();
    const resetPage = () => clearCase();
    window.addEventListener('pagehide', resetPage);
    window.addEventListener('pageshow', resetPage);
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
      requestController.current?.abort(); moduleController.current?.abort();
      if (requestTimer.current !== null) clearTimeout(requestTimer.current);
      window.removeEventListener('pagehide', resetPage); window.removeEventListener('pageshow', resetPage);
    };
  }, [clearCase, loadAvailability]);

  function discardReview() { setReview(null); setError(''); setCancellationMessage(''); }

  function chooseDemo(caseId: string) {
    if (!(synthetic || runtimeMode === 'competition') || pendingRequest.current) return;
    const example = [...DemoCases, ...PregnancyCases].find(example => example.id === caseId);
    setDemoCaseId(caseId);
    if (!example) return;
    discardReview();
    setAgeRange(example.ageRange); setCaseType(example.caseType);
    setPregnancy(example.pregnancy); setPid(example.pid); setNarrative(example.narrative);
    setEarlyPregnancy({ ...example.earlyPregnancy });
    // Choosing an example explicitly selects its sole backend-provided demo context.
    // Ambiguous or unavailable modules remain unselected; symptoms never choose one.
    const requestedModule = example.moduleId || (modules.length === 1 ? modules[0].moduleId : runtimeMode === 'competition' ? 'module_01_endo' : '');
    if (modules.some(module => module.moduleId === requestedModule && module.supportedCaseTypes.includes(example.caseType))) setModuleId(requestedModule);
  }

  useEffect(() => {
    if (pending || (!review && !error)) return;
    // Focus after disabled controls are restored; urgent content precedes ordinary results.
    const frame = requestAnimationFrame(() => document.getElementById(error ? 'requestError' : review?.warnings.length ? 'urgentTitle' : 'reviewTitle')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [review, error, pending]);

  async function submitCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = modules.find(module => module.moduleId === moduleId);
    if (pendingRequest.current || loading || !canRequest || !selected || !selected.supportedCaseTypes.includes(caseType)) return;
    // This ref closes the duplicate-click window before React applies state updates.
    pendingRequest.current = true; setPending(true); discardReview();
    const generation = ++requestGeneration.current;
    requestController.current?.abort();
    const controller = new AbortController(); requestController.current = controller;
    const timer = setTimeout(() => {
      controller.abort();
      if (mounted.current && requestGeneration.current === generation) {
        requestGeneration.current += 1;
        requestTimer.current = null;
        pendingRequest.current = false; setPending(false); requestController.current = null;
        setCancellationMessage('Request cancelled after the time limit. You may try again.');
      }
    }, RequestDeadline);
    requestTimer.current = timer;
    try {
      const result = await requestJson('/v1/analyze', controller.signal, {
        moduleHint: moduleId, ageRange: ageRange || null, caseType,
        pregnancyPossible: threeState(pregnancy), pidDiagnosedOrPresumed: threeState(pid),
        additionalNotes: narrative,
        ...(moduleId === 'module_02_early_pregnancy' ? { earlyPregnancy } : {}),
      });
      if (!mounted.current || controller.signal.aborted || requestGeneration.current !== generation) return;
      if (result.runtimeMode !== runtimeMode) throw new Error(UnexpectedMessage);
      if (result.status === 422) setError(readError(result.payload));
      else if ([200, 404, 503].includes(result.status)) {
        setReview(readReview(result.payload, synthetic, runtimeMode));
      } else throw new Error(UnexpectedMessage);
    } catch {
      if (mounted.current && !controller.signal.aborted && requestGeneration.current === generation) setError(UnexpectedMessage);
    } finally {
      clearTimeout(timer);
      if (requestTimer.current === timer) requestTimer.current = null;
      if (mounted.current && requestGeneration.current === generation) {
        pendingRequest.current = false; setPending(false); requestController.current = null;
      }
    }
  }

  const selected = modules.find(module => module.moduleId === moduleId);
  const supported = selected?.supportedCaseTypes.includes(caseType) ?? false;
  const canSubmit = Boolean(selected) && canRequest && !pending && !loading && supported;
  const examples = runtimeMode === 'competition' && moduleId === 'module_02_early_pregnancy' ? PregnancyCases : DemoCases;

  return <>
    <a className="skipLink" href="#caseForm">Skip to case entry</a>
    <main>
      <div className="pageIntro"><h1>Clinical Evidence Assistant</h1><p>Evidence review for clinicians</p></div>
      {synthetic && <aside className="demoBanner" aria-label="Synthetic demonstration boundary"><strong>{DemoNotice}</strong></aside>}
      {runtimeMode === 'competition' && <aside className="demoBanner" aria-label="Competition evaluation boundary"><strong>{CompetitionBanner}</strong></aside>}
      <aside className="privacyBanner" aria-label="Clinical and privacy boundaries"><strong>Clinician-facing only</strong><span>De-identified, minimum-necessary information only.</span><span>Not a diagnostic or prescribing system.</span></aside>
      <ScopePanel synthetic={synthetic} competition={runtimeMode === 'competition'} pregnancyAvailable={modules.some(module => module.moduleId === 'module_02_early_pregnancy')} />
      <div className="workspace">
        <section className="card caseCard" aria-labelledby="caseTitle">
          <div className="cardHeading"><div><h2 id="caseTitle">Build the case</h2><p className="cardSubtitle">Add key details for a focused evidence review.</p></div><span className="memoryLabel">In-memory only</span></div>
          <div className="availability" role="status" aria-live="polite">
            {loading ? 'Checking module availability…' : availabilityError || (!modules.length ? 'No approved clinical modules are available. The demo is not ready for analysis; no clinical module has been activated.' : !ready ? runtimeMode === 'competition' && canRequest ? 'Language provider unavailable. You can submit a case to review safety outcomes and the safe provider-unavailable response.' : 'Analysis services are not ready. An available module and configured analysis dependencies are required.' : synthetic || runtimeMode === 'competition' ? 'Ready for evidence review.' : 'Approved module and analysis dependencies available.')}
          </div>
          {!loading && (!ready || availabilityError) && <button type="button" className="textButton" onClick={() => { discardReview(); void loadAvailability(); }} disabled={pending}>Refresh availability</button>}
          <form id="caseForm" onSubmit={submitCase} autoComplete="off" aria-describedby={error ? 'requestError' : undefined}>
            <fieldset disabled={pending}>
              <legend className="visuallyHidden">Structured case context</legend>
              {(synthetic || runtimeMode === 'competition') && <div className="demoExamples">
                <label htmlFor="demoCase">Try a demonstration case</label>
                <select id="demoCase" value={demoCaseId} onChange={event => chooseDemo(event.target.value)} aria-describedby="demoCaseHelp">
                  <option value="">Choose an example</option>
                  {examples.map(example => <option key={example.id} value={example.id}>{example.label}</option>)}
                </select>
                <p id="demoCaseHelp" className="fieldHint">Review and edit before selecting Analyze. {examples.find(example => example.id === demoCaseId)?.explanation}</p>
              </div>}
              <div className="caseTopRow"><div className="moduleField"><label htmlFor="module">Clinical module <span className="required">Required</span></label>
              <select ref={moduleRef} id="module" value={moduleId} disabled={loading || !modules.length} required aria-describedby="moduleHelp" onChange={event => { setModuleId(event.target.value); setEarlyPregnancy({}); setDemoCaseId(''); discardReview(); }}>
                <option value="">Select a clinical module</option>{modules.map(module => <option key={module.moduleId} value={module.moduleId}>{module.displayName}</option>)}
              </select>
              <p id="moduleHelp" className="fieldHint">Choose explicitly. A module is never inferred from the narrative.</p>
              </div>
              <div className="fieldGrid">
                <div><label htmlFor="ageRange">Age range</label><select id="ageRange" value={ageRange} onChange={event => { setAgeRange(event.target.value); discardReview(); }}><option value="">Unknown / not provided</option>{AgeRanges.map(range => <option key={range} value={range.replace('–', '-')}>{range}</option>)}</select></div>
                <div><label htmlFor="caseType">Case type</label><select id="caseType" value={caseType} onChange={event => { setCaseType(event.target.value as 'brief' | 'detailed'); discardReview(); }}><option value="brief">Brief</option><option value="detailed">Detailed</option></select></div>
              </div></div>
              <div className="statusFields">
                <div><label htmlFor="pregnancy">Pregnancy status</label><select id="pregnancy" value={pregnancy} onChange={event => { setPregnancy(event.target.value as Status); discardReview(); }}><option value="unknown">Unknown / not provided</option><option value="yes">Possible / known</option><option value="no">Not possible</option></select></div>
                <div><label htmlFor="pid">PID status</label><select id="pid" value={pid} onChange={event => { setPid(event.target.value as Status); discardReview(); }}><option value="unknown">Unknown / not provided</option><option value="yes">Diagnosed or presumptively diagnosed</option><option value="no">Not diagnosed</option></select></div>
              </div>
              {moduleId === 'module_02_early_pregnancy' && <PregnancyFields context={earlyPregnancy} onChange={context => { setEarlyPregnancy(context); discardReview(); }} />}
              <div className="contextSummary"><p className="summaryLabel">Structured context · sent separately</p><div className="contextChips" aria-label="Selected structured context"><span>Age: {ageRange || 'Unknown'}</span><span>{caseType === 'brief' ? 'Brief' : 'Detailed'} case</span><span>Pregnancy: {pregnancy === 'unknown' ? 'Unknown' : pregnancy === 'yes' ? 'Possible / known' : 'Not possible'}</span><span>PID: {pid === 'unknown' ? 'Unknown' : pid === 'yes' ? 'Diagnosed / presumed' : 'Not diagnosed'}</span></div></div>
              <label htmlFor="narrative">Additional clinical information</label>
              <p id="narrativeHelp" className="fieldHint">Selected context is sent separately. Add only relevant clinical information; omit names, exact birth dates, addresses, contact details and medical-record numbers.</p>
              <textarea ref={narrativeRef} id="narrative" value={narrative} maxLength={2000} rows={6} aria-describedby={`narrativeHelp narrativeCount${error ? ' requestError' : ''}`} autoComplete="off" spellCheck={false} placeholder="Relevant symptoms, duration, test findings or a focused question. Omit identifiers; leave unreported information unknown." onChange={event => { setNarrative(event.target.value); discardReview(); }} />
              <p id="narrativeCount" className="characterCount">{narrative.length} / 2,000 characters</p>
            </fieldset>
            {!supported && selected && <p role="status" className="fieldHint">This module does not support the selected case type.</p>}
            {error && <p id="requestError" tabIndex={-1} className="errorPanel" role="alert">{error}</p>}
            <div className="formActions"><button className="primaryButton" type="submit" disabled={!canSubmit}>{pending ? 'Analyzing…' : 'Analyze'}</button><button className="clearButton" type="button" onClick={() => {
              clearCase();
              const generation = requestGeneration.current;
              requestAnimationFrame(() => {
                if (mounted.current && requestGeneration.current === generation) (moduleRef.current?.disabled ? narrativeRef.current : moduleRef.current)?.focus();
              });
            }}>Clear case</button></div>
            <p className="submissionStatus" role="status" aria-live="polite">{pending ? 'Request in progress. Please wait.' : cancellationMessage || (review ? 'Response available for review.' : '')}</p>
          </form>
        </section>
        <ResponsePanel review={review} synthetic={synthetic} competition={runtimeMode === 'competition'} pending={pending} />
      </div>
      {(synthetic || runtimeMode === 'competition') && <section className="demoShelf" aria-labelledby="demoShelfTitle">
        <div className="shelfHeading"><h2 id="demoShelfTitle">Explore cases</h2><p>Load an editable example. Review it before selecting Analyze.</p></div>
        <div className="demoCards">{examples.map((example, index) => <button type="button" key={example.id} className={`demoCard demoTone${index % 7}`} disabled={pending} aria-pressed={demoCaseId === example.id} aria-describedby="demoShelfHelp" onClick={() => chooseDemo(example.id)}><span className="demoIcon" aria-hidden="true">{['≡', '☷', '▤', '!', '⇄', '?', '○'][index % 7]}</span><span><strong>{example.label}</strong><small>{example.explanation}</small></span></button>)}</div>
        <p id="demoShelfHelp" className="fieldHint">Choosing a case fills the case fields and available demonstration module. Review before selecting Analyze; examples never submit automatically.</p>
      </section>}
      <footer>Clinical Evidence Assistant · Minimum necessary information. Independent clinical judgment.</footer>
    </main>
  </>;
}

