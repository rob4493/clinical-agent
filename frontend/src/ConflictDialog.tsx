import { canonicalToLegacy, legacyToCanonical, validateClinical } from '../../shared/caseBridge';
import type { CanonicalCase, LegacyCase } from '../../shared/clinicalData';
import { useEffect, useRef, useState } from 'react';
import type { ConflictReview, ConflictResolution, ResolutionOption } from '../../shared/clinicalData';
import { recordResolution, resolutionLabel, availableResolutions, ResolutionNotes, validateConflict } from '../../shared/conflictReview';
import { readConflictAssistance, type PublicConflictAssistance } from '../../shared/conflictAssistance';

/** Session-only clinician handling. It cannot decide source truth or authorize reanalysis. */
function VerifiedConflictDialog({ conflict, assistance, onClose, onConfirm }: { conflict: ConflictReview; assistance?: PublicConflictAssistance; onClose: () => void; onConfirm: (resolution: ConflictResolution) => void }) {
  validateConflict(conflict);
  const choices = availableResolutions(conflict);
  let verifiedAssistance: PublicConflictAssistance | undefined;
  try { if (assistance?.conflictId === conflict.id) verifiedAssistance = readConflictAssistance(assistance); } catch { /* The complete deterministic workflow remains available. */ }
  const dialog = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [option, setOption] = useState<ResolutionOption | ''>('');
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const background = Array.from(document.querySelectorAll('.applicationShell, .reviewNavigation, .skipLink'));
    const previouslyInert = background.filter(element => element.hasAttribute('inert'));
    background.forEach(element => element.setAttribute('inert', ''));
    dialog.current?.focus();
    return () => { background.filter(element => !previouslyInert.includes(element)).forEach(element => element.removeAttribute('inert')); previous?.focus(); };
  }, []);
  useEffect(() => { dialog.current?.focus(); if (body.current) body.current.scrollTop = 0; }, [confirming]);
  const groups: { label: string; options: ResolutionOption[] }[] = [
    { label: 'Use for this analysis', options: ['firstAssertion', 'secondAssertion'] },
    { label: 'Explain the discrepancy', options: ['changedOverTime', 'differentContext', 'correctedReport'] },
    { label: 'Do not resolve', options: ['unresolved', 'requestVerification'] },
  ];
  return <div className="sourceOverlay"><section ref={dialog} className="sourceDialog conflictDialog" role="dialog" aria-modal="true" aria-labelledby="conflictDialogTitle" aria-describedby="conflictDialogHelp" tabIndex={-1} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') {
      const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="cardHeading conflictHeader"><h2 id="conflictDialogTitle">Conflicting information requires review</h2><button type="button" onClick={onClose}>Close conflict review</button></header>
    <div ref={body} className="conflictBody">
    <p id="conflictDialogHelp">Endo cannot determine which report is correct. These synthetic, clinician-confirmed reports concern {conflict.label.toLowerCase()}.</p>
    <div className="conflictAssertions">{conflict.assertions.map((report, index) => <article key={report.id} aria-labelledby={`assertionTitle${index}`}><h3 id={`assertionTitle${index}`}>{report.sourceLabel}</h3><p>{report.displayText}</p><dl>{report.effectiveDate && ['exact', 'approximate', 'range'].includes(report.effectiveDate.kind) && <><dt>Effective date</dt><dd>{report.effectiveDate.kind === 'range' ? `${report.effectiveDate.start} to ${report.effectiveDate.end}` : `${report.effectiveDate.kind === 'approximate' ? 'Approximately ' : ''}${report.effectiveDate.value}`}</dd></>}{report.reportStatus && <><dt>Report status</dt><dd>{report.reportStatus}</dd></>}{report.method && <><dt>Method</dt><dd>{report.method}</dd></>}</dl></article>)}</div>
    {verifiedAssistance && <section aria-labelledby="conflictAssistTitle"><h3 id="conflictAssistTitle">Watson-assisted verification questions</h3><p>{verifiedAssistance.summary}</p><ul>{verifiedAssistance.questions.map(question => <li key={question}>{question}</li>)}</ul><p className="fieldHint">These questions may help review the discrepancy. Endo does not determine which report is correct.</p></section>}
    {!confirming ? <>
      <h3>How should this discrepancy be handled?</h3><p>Your selection will not alter or delete the original reports.</p>
      {groups.map(group => { const options = group.options.filter(choice => choices.includes(choice)); return options.length ? <fieldset key={group.label} className="resolutionGroup"><legend>{group.label}</legend>{options.map(choice => <label className="resolutionChoice" key={choice}><input type="radio" name="conflictResolution" value={choice} checked={option === choice} onChange={() => setOption(choice)} />{resolutionLabel(choice, conflict)}</label>)}</fieldset> : null; })}
    </> : <>
      <h3>Confirm local handling</h3><p>{option && resolutionLabel(option, conflict)}</p><p>Affected concept: {conflict.label}. Sources: {conflict.assertions.map(report => report.sourceLabel).join(' and ')}.</p>
      <p>No disputed value will be submitted for reanalysis. Analysis remains paused. Update the case explicitly before analyzing again; the original reports are preserved.</p>
      <label htmlFor="resolutionNote">Optional clinician resolution note</label><select id="resolutionNote" value={note} onChange={event => setNote(event.target.value)}>{ResolutionNotes.map((text, index) => <option key={index} value={text}>{text || 'No note'}</option>)}</select>
      <p className="fieldHint">Choose a predefined note. Identifiers and clinical instructions cannot be entered.</p>
    </>}
    </div>
    <footer className="conflictFooter">{!confirming ? <button type="button" disabled={!option || !choices.includes(option)} onClick={() => setConfirming(true)}>Continue to confirmation</button> : <><button type="button" onClick={() => setConfirming(false)}>Back to resolution options</button><button type="button" onClick={() => { if (option) onConfirm(recordResolution(conflict, option, note, new Date().toISOString())); }}>Confirm local resolution</button></>}</footer>
  </section></div>;
}

interface SubmittedConflict {caseInput:CanonicalCase|LegacyCase;fieldName:string;additionalAssertion?:string}
function SubmittedConflictDialog({submitted,onClose,onUpdate}:{submitted:SubmittedConflict;onClose:()=>void;onUpdate:(updated:CanonicalCase)=>void}){
 const dialog=useRef<HTMLElement>(null),[choice,setChoice]=useState(''),[confirming,setConfirming]=useState(false);
 const original='schemaVersion'in submitted.caseInput?canonicalToLegacy(submitted.caseInput):submitted.caseInput;
 const field=submitted.additionalAssertion?null:submitted.fieldName==='pregnancyPossible'?'pregnancyStatus':submitted.fieldName==='pidDiagnosedOrPresumed'?'pidStatus':null;
 const path=submitted.fieldName.split('.');
 const originalValue=field==='pregnancyStatus'?original.pregnancyPossible:field==='pidStatus'?original.pidDiagnosedOrPresumed:path[0]==='earlyPregnancy'&&path.length===2?original.earlyPregnancy?.[path[1] as keyof NonNullable<LegacyCase['earlyPregnancy']>]:original[submitted.fieldName as keyof LegacyCase];
 const displayValue=originalValue===undefined?'Not reported':originalValue===null?'Unknown':typeof originalValue==='boolean'?originalValue?'Yes':'No':typeof originalValue==='object'?'Review the submitted structured context':String(originalValue);
 const structuredPair=submitted.fieldName.startsWith('earlyPregnancy.')?Object.entries(original.earlyPregnancy??{}).filter(([,entry])=>entry!==null&&entry!==undefined).map(([name,entry])=>name.replace(/([a-z])([A-Z])/g,'$1 $2')+': '+String(entry)).join('; '):null;
 useEffect(()=>{const previous=document.activeElement as HTMLElement;const background=Array.from(document.querySelectorAll('.applicationShell,.reviewNavigation,.skipLink'));background.forEach(element=>element.setAttribute('inert',''));dialog.current?.focus();return()=>{background.forEach(element=>element.removeAttribute('inert'));previous?.focus();};},[]);
 function apply(){if(!field||!['present','absent','unknown','notReported'].includes(choice))return;const updated='schemaVersion'in submitted.caseInput?structuredClone(validateClinical(submitted.caseInput)):legacyToCanonical(submitted.caseInput);updated[field]={state:choice as 'present'|'absent'|'unknown'|'notReported'};onUpdate(updated);}
 return <div className="sourceOverlay"><section ref={dialog} className="sourceDialog conflictDialog" role="dialog" aria-modal="true" aria-labelledby="submittedConflictTitle" tabIndex={-1} onKeyDown={event=>{if(event.key==='Escape')onClose();if(event.key==='Tab'){const controls=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');if(!controls?.length)return;const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}}><header><h2 id="submittedConflictTitle">Review conflicting information</h2><button type="button" onClick={onClose}>Close conflict review</button></header><div className="conflictBody"><p>Endo cannot determine which statement is correct. These are submitted case statements, not verified source-report provenance.</p><div className="conflictAssertions"><article><h3>Submitted structured field</h3><p>{field?field==='pregnancyStatus'?'Pregnancy status':'PID diagnostic status':'Review Additional clinical context'}</p><p>{displayValue}</p></article><article><h3>{structuredPair?'Other submitted structured context':'Submitted case text'}</h3><p>{structuredPair||original.additionalNotes||'Not reported'}</p></article>{submitted.additionalAssertion&&<article><h3>New clinician follow-up (unconfirmed)</h3><p>{submitted.additionalAssertion}</p></article>}</div>{field?<fieldset><legend>Clinician-confirmed structured value</legend>{['present','absent','unknown','notReported'].map(state=><label className="resolutionChoice" key={state}><input type="radio" name="confirmedConflict" value={state} checked={choice===state} onChange={()=>{setChoice(state);setConfirming(false);}}/>{({present:'Yes',absent:'No',unknown:'Unknown',notReported:'Not reported'})[state as 'present']}</label>)}</fieldset>:<p>The structured field has no reviewed correction choice here. Return to Additional clinical context to verify it manually.</p>}
 {confirming&&<section aria-label="Proposed canonical correction"><h3>Confirm canonical correction</h3><p>Original value: {originalValue===undefined?'Not reported':originalValue===null?'Unknown':String(originalValue)}</p><p>Proposed clinician choice: {choice}</p><p>The original narrative and reports remain unchanged. The next analysis may still identify a conflict. Reanalysis is a separate action.</p></section>}</div><footer>{!confirming?<button type="button" disabled={!choice} onClick={()=>setConfirming(true)}>Review proposed correction</button>:<button type="button" onClick={apply}>Confirm canonical correction</button>}<button type="button" onClick={onClose}>Request verification / keep unresolved</button></footer></section></div>;
}
export default function ConflictDialog(props:{conflict?:ConflictReview;submitted?:SubmittedConflict;assistance?:PublicConflictAssistance;onClose:()=>void;onConfirm:(resolution:ConflictResolution)=>void;onUpdate?:(updated:CanonicalCase)=>void;additionalAssertion?:string}){
 if(props.conflict)return <VerifiedConflictDialog {...props} conflict={props.conflict}/>;
 if(props.submitted&&props.onUpdate)return <SubmittedConflictDialog submitted={{...props.submitted,additionalAssertion:props.additionalAssertion}} onClose={props.onClose} onUpdate={props.onUpdate}/>;
 return null;
}
