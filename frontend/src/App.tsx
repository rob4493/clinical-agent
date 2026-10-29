import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ClinicalModule, Review, RuntimeMode, PregnancyContext } from './api';
import { EvaluationBanner, DemoNotice, isReady, readError, readModules, readReview, requestJson, UnexpectedMessage } from './api';
import ResponsePanel from './ResponsePanel';
import { compactSummary, explainFindings } from './responsePresentation';
import { resolveVisualFindings } from './findingRules';
import type { FindingCard } from './findingRules';
import { DemoCases, PregnancyCases } from './DemoCases';
import PregnancyFields from './PregnancyFields';
import ScopePanel from './ScopePanel';
import UploadPanel from './UploadPanel';
import { analysisRequest, EmptySession } from './documents/session';
import type { UploadSession } from './documents/session';
import { DocumentError } from './documents/types';
import { ReviewNavigation, WorkflowBar } from './ReviewShell';

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
  const [demoLoaded, setDemoLoaded] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [findings, setFindings] = useState<FindingCard[]>([]);
  const [error, setError] = useState('');
  const [availabilityError, setAvailabilityError] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [synthetic, setSynthetic] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('standard');
  const [canRequest, setCanRequest] = useState(false);
  const [pending, setPending] = useState(false);
  const [uploads, setUploads] = useState<UploadSession>(EmptySession);
  const [uploadGeneration, setUploadGeneration] = useState(0);
  const [contextOpen, setContextOpen] = useState(false);
  const updateUploads = useCallback((session: UploadSession) => { setUploads(session); setReview(null); setFindings([]); setError(''); if (session.documents.length) setDemoLoaded(false); }, []);
  const [cancellationMessage, setCancellationMessage] = useState('');
  const requestController = useRef<AbortController | null>(null);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moduleController = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const pendingRequest = useRef(false);
  const mounted = useRef(true);
  const narrativeRef = useRef<HTMLTextAreaElement>(null);
  const moduleRef = useRef<HTMLInputElement>(null);

  const clearCase = useCallback(() => {
    // Invalidate even a transport that ignores abort: a late result cannot restore cleared case data.
    requestGeneration.current += 1;
    requestController.current?.abort();
    if (requestTimer.current !== null) clearTimeout(requestTimer.current);
    requestTimer.current = null;
    pendingRequest.current = false;
    setPending(false); setReview(null); setFindings([]); setError(''); setCancellationMessage('');
    requestController.current = null;
    setModuleId(''); setAgeRange(''); setCaseType('brief');
    setPregnancy('unknown'); setPid('unknown'); setNarrative(''); setDemoCaseId(''); setDemoLoaded(false);
    setEarlyPregnancy({}); setContextOpen(false);
    setUploads(EmptySession); setUploadGeneration(generation => generation + 1);
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
        setModules([]); setModuleId(''); setCanRequest(false); setAvailabilityError('Evaluation services are unavailable. Refresh availability to try again.');
      }
    } finally {
      clearTimeout(timer);
      if (mounted.current && moduleController.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    document.title = 'Endo | Clinical Evidence Assistant';
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

  function discardReview() { setReview(null); setFindings([]); setError(''); setCancellationMessage(''); setDemoLoaded(false); }

  function chooseDemo(caseId: string) {
    if (!(synthetic || runtimeMode === 'competition') || pendingRequest.current) return;
    if (!caseId) { setDemoCaseId(''); setDemoLoaded(false); return; }
    const example = examples.find(example => example.id === caseId);
    if (!example) return;
    const assignedId = synthetic ? example.syntheticModuleId : example.moduleId;
    const assignedModule = modules.find(module => module.moduleId === assignedId);
    if (!assignedModule?.supportedCaseTypes.includes(example.caseType)) return;
    discardReview();
    setUploads(EmptySession); setUploadGeneration(generation => generation + 1);
    // The fixture's reviewed assignment is an explicit choice, not symptom routing.
    setModuleId(assignedModule.moduleId); setDemoCaseId(caseId);
    setAgeRange(example.ageRange); setCaseType(example.caseType);
    setPregnancy(example.pregnancy); setPid(example.pid); setNarrative(example.narrative);
    setEarlyPregnancy({ ...example.earlyPregnancy }); setContextOpen(false); setDemoLoaded(true);
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
    if (!selected) { setError('Select the clinical module before analyzing this case.'); moduleRef.current?.focus(); return; }
    if (pendingRequest.current || loading || uploads.blocked || !validContext || !canRequest || !selected || !selected.supportedCaseTypes.includes(caseType)) return;
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
      const payload = analysisRequest({
        moduleHint: moduleId, ageRange: ageRange || null, caseType,
        pregnancyPossible: threeState(pregnancy), pidDiagnosedOrPresumed: threeState(pid),
        additionalNotes: narrative,
        ...(moduleId === 'module_02_early_pregnancy' ? { earlyPregnancy } : {}),
      }, uploads);
      const result = await requestJson('/v1/analyze', controller.signal, payload);
      if (!mounted.current || controller.signal.aborted || requestGeneration.current !== generation) return;
      if (result.runtimeMode !== runtimeMode) throw new Error(UnexpectedMessage);
      if (result.status === 422) { setContextOpen(true); setError(readError(result.payload)); }
      else if ([200, 404, 503].includes(result.status)) {
        const completed = readReview(result.payload, synthetic, runtimeMode);
        const visuals = await resolveVisualFindings(payload, completed);
        // Native fingerprinting is asynchronous: cancellation still owns the result.
        if (!mounted.current || controller.signal.aborted || requestGeneration.current !== generation) return;
        const displaySummary = await compactSummary(completed);
        if (!mounted.current || controller.signal.aborted || requestGeneration.current !== generation) return;
        const explained = await explainFindings(visuals, completed);
        if (!mounted.current || controller.signal.aborted || requestGeneration.current !== generation) return;
        setFindings(explained); setReview(displaySummary ? { ...completed, displaySummary } : completed);
      } else throw new Error(UnexpectedMessage);
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && requestGeneration.current === generation) setError(failure instanceof DocumentError ? failure.message : UnexpectedMessage);
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
  const validContext = earlyPregnancy.gestationalWeeks == null || Number.isFinite(earlyPregnancy.gestationalWeeks) && earlyPregnancy.gestationalWeeks >= 0 && earlyPregnancy.gestationalWeeks <= 45 && Math.abs(earlyPregnancy.gestationalWeeks * 10 - Math.round(earlyPregnancy.gestationalWeeks * 10)) < 0.000001;
  const canSubmit = validContext && Boolean(selected) && canRequest && !pending && !loading && supported && !uploads.blocked;
  const examples = (synthetic ? DemoCases : runtimeMode === 'competition' ? [...DemoCases, ...PregnancyCases] : []).filter(example => modules.some(module => module.moduleId === (synthetic ? example.syntheticModuleId : example.moduleId) && module.supportedCaseTypes.includes(example.caseType)));
  const caseStatus = !selected ? 'Select a clinical module to begin' : demoLoaded ? 'Demonstration case loaded — verify the selected module and case information before analyzing' : uploads.blocked ? 'Review and confirm uploaded information before analysis' : validContext && (narrative.trim() || uploads.candidates.length) ? 'Ready to analyze' : 'Module selected — enter or review the case narrative';

  function chooseModule(nextId: string) {
    if (nextId === moduleId) return;
    // Do not transfer module-specific context or confirmed document findings to a new module.
    setModuleId(nextId); setEarlyPregnancy({}); setPregnancy('unknown'); setPid('unknown');
    setDemoCaseId(''); setContextOpen(false); setUploads(EmptySession); setUploadGeneration(generation => generation + 1);
    discardReview();
  }
  const contextLabel = [ageRange ? `Age: ${ageRange}` : '', caseType === 'detailed' ? 'Detailed case' : '', pregnancy !== 'unknown' ? `Pregnancy: ${pregnancy === 'yes' ? 'Possible / known' : 'Not possible'}` : '', pid !== 'unknown' ? `PID: ${pid === 'yes' ? 'Diagnosed / presumed' : 'Not diagnosed'}` : '', Object.keys(earlyPregnancy).some(key => earlyPregnancy[key as keyof PregnancyContext] != null) ? 'Early-pregnancy context entered' : ''].filter(Boolean).join(' · ');

  return <>
    <a className="skipLink" href="#caseForm">Skip to case entry</a>
    <ReviewNavigation />
    <div className="applicationShell">
    <WorkflowBar pending={pending} hasResponse={Boolean(review)} />
    <main>
      <div className="pageIntro"><p className="eyebrow">Endo · Clinical Evidence Assistant</p><h1>New evidence review</h1><p>Bring the case into focus. Review the evidence with confidence and care.</p></div>
      <aside className="demoBanner" aria-label="Clinical and privacy boundaries"><strong>{EvaluationBanner}</strong>{synthetic && <p>{DemoNotice}</p>}</aside>
      <div className="workspace">
        <section className="card caseCard" aria-labelledby="caseTitle">
          <div className="cardHeading"><div><h2 id="caseTitle">Build the case</h2><p className="cardSubtitle">Add key details for a focused evidence review.</p></div><span className="memoryLabel">In-memory only</span></div>
          <div className="availability" role="status" aria-live="polite">
            {loading ? 'Checking module availability…' : availabilityError || (!modules.length ? 'No approved clinical modules are available. The demo is not ready for analysis; no clinical module has been activated.' : !ready ? runtimeMode === 'competition' && canRequest ? 'Language provider unavailable. You can submit a case to review safety outcomes and the safe provider-unavailable response.' : 'Analysis services are not ready. An available module and configured analysis dependencies are required.' : pending ? 'Analyzing case…' : caseStatus)}
          </div>
          {!loading && (!ready || availabilityError) && <button type="button" className="textButton" onClick={() => { discardReview(); void loadAvailability(); }} disabled={pending}>Refresh availability</button>}
          <form id="caseForm" tabIndex={-1} onSubmit={submitCase} onInvalid={() => setContextOpen(true)} autoComplete="off" aria-describedby={error ? 'requestError' : undefined}>
            <fieldset disabled={pending}>
              <legend className="visuallyHidden">Structured case context</legend>
              {(synthetic || runtimeMode === 'competition') && <div className="demoExamples">
                <p className="eyebrow">Demonstration / evaluation</p>
                <label htmlFor="demoCase">Try a demonstration case</label>
                <select id="demoCase" value={demoCaseId} disabled={loading || !examples.length} onChange={event => chooseDemo(event.target.value)} aria-describedby="demoCaseHelp">
                  <option value="">Choose a demonstration case</option>
                  {examples.map(example => <option key={example.id} value={example.id}>{example.label}</option>)}
                </select>
                <p id="demoCaseHelp" className="fieldHint">Review and edit before selecting Analyze case. {examples.find(example => example.id === demoCaseId)?.explanation}</p>
              </div>}
              <fieldset className="moduleChoices" aria-describedby="moduleHelp">
                <legend>Select clinical module <span className="required">Required</span></legend>
                <div className="moduleCards">{modules.map((module, index) => <label key={module.moduleId} className={`moduleCard${moduleId === module.moduleId ? ' selected' : ''}`}>
                  <input ref={index === 0 ? moduleRef : undefined} type="radio" name="clinicalModule" value={module.moduleId} checked={moduleId === module.moduleId} disabled={loading} onChange={() => chooseModule(module.moduleId)} />
                  <span>{module.moduleId === 'module_01_endo' ? 'Endometriosis & Chronic Pelvic Pain' : module.moduleId === 'module_02_early_pregnancy' ? 'Early Pregnancy Pain & Bleeding' : module.displayName}</span>
                  <span className="moduleState" aria-hidden="true">{moduleId === module.moduleId ? 'Selected' : 'Select module'}</span>
                </label>)}</div>
                <p id="moduleHelp" className="fieldHint">{moduleId ? 'Module selected explicitly; narrative text will not override it.' : 'Select the clinical module before analyzing this case.'}</p>
              </fieldset>
              <label htmlFor="narrative">Case narrative</label>
              <p id="narrativeHelp" className="fieldHint">Enter relevant symptoms, duration, examination findings, test results or a focused clinical question. Do not include patient identifiers.</p>
              <textarea ref={narrativeRef} id="narrative" value={narrative} maxLength={2000} rows={6} aria-describedby={`narrativeHelp narrativeCount${error ? ' requestError' : ''}`} autoComplete="off" spellCheck={false} placeholder="Relevant symptoms, duration, test findings or a focused question. Omit identifiers; leave unreported information unknown." onChange={event => { setNarrative(event.target.value); discardReview(); }} />
              <p id="narrativeCount" className="characterCount">{narrative.length} / 2,000 characters</p>
              {selected && <details className="additionalContext" open={contextOpen} onToggle={event => setContextOpen(event.currentTarget.open)}>
                <summary>Additional clinical context{!contextOpen && contextLabel && <span className="contextPreview">{contextLabel}</span>}</summary>
              <div className="fieldGrid">
                <div><label htmlFor="ageRange">Age range</label><select id="ageRange" value={ageRange} onChange={event => { setAgeRange(event.target.value); discardReview(); }}><option value="">Unknown / not provided</option>{AgeRanges.map(range => <option key={range} value={range.replace('–', '-')}>{range}</option>)}</select></div>
                <div><label htmlFor="caseType">Case type</label><select id="caseType" value={caseType} onChange={event => { setCaseType(event.target.value as 'brief' | 'detailed'); discardReview(); }}><option value="brief">Brief</option><option value="detailed">Detailed</option></select></div>
              </div>
              <div className="statusFields">
                <div><label htmlFor="pregnancy">Pregnancy status</label><select id="pregnancy" value={pregnancy} onChange={event => { setPregnancy(event.target.value as Status); discardReview(); }}><option value="unknown">Unknown / not provided</option><option value="yes">Possible / known</option><option value="no">Not possible</option></select></div>
                <div><label htmlFor="pid">PID status</label><select id="pid" value={pid} onChange={event => { setPid(event.target.value as Status); discardReview(); }}><option value="unknown">Unknown / not provided</option><option value="yes">Diagnosed or presumptively diagnosed</option><option value="no">Not diagnosed</option></select></div>
              </div>
              {moduleId === 'module_02_early_pregnancy' && <PregnancyFields context={earlyPregnancy} onChange={context => { setEarlyPregnancy(context); discardReview(); }} />}
              </details>}
              <UploadPanel key={uploadGeneration} onChange={updateUploads} disabled={pending} />
            </fieldset>
            {!supported && selected && <p role="status" className="fieldHint">This module does not support the selected case type.</p>}
            {error && <p id="requestError" tabIndex={-1} className="errorPanel" role="alert">{error}</p>}
            <div className="formActions"><button className="primaryButton" type="submit" disabled={!canSubmit}>{pending ? 'Analyzing…' : 'Analyze case'}</button><button className="clearButton" type="button" onClick={() => {
              clearCase();
              const generation = requestGeneration.current;
              requestAnimationFrame(() => {
                if (mounted.current && requestGeneration.current === generation) (moduleRef.current ?? narrativeRef.current)?.focus();
              });
            }}>Clear case</button></div>
            <p className="submissionStatus" role="status" aria-live="polite">{pending ? 'Request in progress. Please wait.' : cancellationMessage || (review ? 'Response available for review.' : '')}</p>
          </form>
        </section>
        <ResponsePanel findings={findings} review={review} synthetic={synthetic} competition={runtimeMode === 'competition'} pending={pending} />
      </div>
      <ScopePanel synthetic={synthetic} competition={runtimeMode === 'competition'} pregnancyAvailable={modules.some(module => module.moduleId === 'module_02_early_pregnancy')} />
      <footer><strong>Endo</strong><span>Minimum necessary information. Independent clinical judgment.</span></footer>
    </main>
    </div>
  </>;
}

