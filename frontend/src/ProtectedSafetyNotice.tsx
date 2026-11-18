import {SafetyFindingLabels,isSafetyExplanation,type FindingReport,type SafetyExplanation} from '../../shared/protectedSafetyContract';

function Findings({reports}:{reports:FindingReport[]}){return <ul>{reports.map(report=><li key={report.code+report.reported}>{report.reported==='earlier'?'Earlier reported: ':'Reported in this turn: '}{SafetyFindingLabels[report.code]}</li>)}</ul>;}
/** Fixed server-classified facts only; no Markdown, AI wording or HTML execution. */
export default function ProtectedSafetyNotice({warnings,explanation}:{warnings:string[];explanation:SafetyExplanation|null}){
 if(!isSafetyExplanation(explanation))return <div role="alert">{warnings.map((text,index)=><p key={index}>{text}</p>)}</div>;
 return <div role="alert" className="protectedSafetyNotice">
  <h4>{explanation.priority==='emergency'?'Immediate independent emergency assessment recommended':explanation.priority==='assessment'?'Independent clinical assessment required':'Safety clarification required'}</h4>
  <h5>Why this warning appeared</h5>
  {explanation.triggers.length?<Findings reports={explanation.triggers}/>:<p>{explanation.priority==='clarification'?'The reported information requires safety clarification before this conversation can continue.':'An existing safety rule remains active. No current trigger finding can be reliably summarized from this wording; independent assessment is still required.'}</p>}
  {!!explanation.supporting.length&&<><p>Additional reported findings, not independent triggers for this warning:</p><Findings reports={explanation.supporting}/></>}
  {(explanation.measurements.bloodPressure||explanation.measurements.heartRate!==undefined)&&<p>Other reported measurements: {explanation.measurements.bloodPressure&&<>BP {explanation.measurements.bloodPressure.systolic}/{explanation.measurements.bloodPressure.diastolic}. </>}{explanation.measurements.heartRate!==undefined&&<>HR {explanation.measurements.heartRate}. </>}These values are unclassified and were not used to activate the safety rule.</p>}
  <h5>Why it matters</h5>
  <p>{explanation.priority==='emergency'?'The reported warning signs require independent assessment of a potentially time-sensitive problem. Their cause is not established.':'The reported concern requires independent assessment or clarification; its cause is not established.'} Routine AI discussion cannot determine a safe cause or assess clinical stability.</p>
  <h5>What remains unknown</h5>
  <p>{explanation.pregnancy==='unknown'?'Pregnancy status is unknown or unconfirmed; pregnancy is not assumed present or absent.':explanation.pregnancy==='conflicting'?'Pregnancy information is conflicting and requires clarification.':explanation.pregnancy==='reportedPossibleOrKnown'?'Pregnancy is reported as possible or known, not independently verified by this application.':'Pregnancy is reported negative, not independently verified by this application.'} No diagnosis, cause or completed independent assessment is verified by this conversation.</p>
  <p><strong>Conversation paused before contacting IBM.</strong> The safety warning has not been resolved by this discussion. Starting a new conversation does not establish that the reported concern has resolved.</p>
  <details><summary>Underlying safety-rule wording and references</summary><p>Source pathway context is not confirmation of this patient's pregnancy status or a diagnosis.</p>{warnings.map((text,index)=><p key={index}>{text}</p>)}<ul>{explanation.sourceRules.map((rule,index)=><li key={index}>{rule.ruleId}: {rule.sourceTags.join(', ')}</li>)}</ul></details>
 </div>;
}
