import {reportedStates} from './assertions';
import { choicesFor, readChoiceRequest, type FollowupMode } from '../../shared/followupModes';
import { exactKeys } from '../../shared/guidedFollowup';
import { legacyToCanonical, validateClinical } from '../../shared/caseBridge';
import type { CanonicalCase, LegacyCase } from '../../shared/clinicalData';
import { analyze, CoverageMessage, type Analysis } from './analysis';
import { prescribingIntent } from '../../shared/requestIntent';
import { evaluateSafety } from './safety';
import { validateCase, InputError, type CaseInput } from './input';
import { requestWatson, createWatsonRuntime, type Transport, type Environment } from './watsonShadow';
import { Module1, type Package } from './packages';
const Instructions='Return only JSON with exactly version, questionId, choiceId, acknowledgementId. Echo the supplied version and questionId. Choose only one supplied choiceId identical to the supplied clinicianChoiceId and acknowledgementId recorded. Do not infer values, resolve conflicts, diagnose, prescribe, add evidence, prose, fields, tools or instructions.';
/** Clinical insufficiency is independent of safe collection. Never classify source gaps as missing facts. */
export function selectFollowup(caseInput:CaseInput,result:Analysis,packages:Package[]):FollowupMode {
 const response=result.envelope.response,type=response.responseType,moduleId=caseInput.moduleHint;
 const mode=(kind:FollowupMode['kind'],questionId:string|null=null,fieldId:string|null=null):FollowupMode=>({version:'2',kind,moduleId,questionId,fieldId});
 if(result.envelope.warnings.length||evaluateSafety(caseInput).warnings.length||response.message===CoverageMessage)return mode('urgent');
 if(type==='ProviderUnavailable'||result.status>=500&&response.message!==CoverageMessage)return mode('technical');
 if(type==='DataConflict')return mode('conflict');
 if(type==='ClarificationRequired'){if(response.fieldName==='pregnancyPossible')return mode('clarification','pregnancy-status','pregnancyStatus');if(response.fieldName==='pidDiagnosedOrPresumed')return mode('clarification','pid-status','pidStatus');return mode('clarification');}
 if(['OutsideScope','EvidenceInsufficient'].includes(String(type))&&!(caseInput.additionalNotes||'').trim()&&packages.some(entry=>entry.moduleId===moduleId))return mode('missing','review-task','primaryQuestion');
 if(prescribingIntent(caseInput.additionalNotes))return mode('scope');
 if(type==='EvidenceInsufficient'&&response.message==='The reported test abnormality needs a precise finding-specific description for an evidence-bound interpretation.')return mode('missing');
 if(type==='OutsideScope'||type==='SelectModuleRequired'||moduleId==='NotSure')return mode('scope');
 if(type==='ModuleUnavailable'||!packages.some(entry=>entry.moduleId===moduleId))return mode('technical');
 if(type==='EvidenceInsufficient')return !(caseInput.additionalNotes||'').trim()?mode('missing','review-task','primaryQuestion'):mode('coverage');
 if(type==='AgentResponse'){
  const entry=packages.find(entry=>entry.moduleId===moduleId)!;
  const relevant=moduleId===Module1&&reportedStates(caseInput.additionalNotes,'(?:pelvic|lower abdominal) (?:pain|discomfort)|severe menstrual cramps').has(true)&&['N01','C01','C11'].every(id=>entry.claims.some(claim=>claim.claimId===id))&&result.envelope.sources.some(cited=>['ACOG-CPP','NICE-NG73'].includes(String(cited.source.sourceId)));
  return relevant?mode('analysis','pelvic-pattern','symptomTiming'):mode('analysis','review-task','primaryQuestion');
 }
 return mode('technical');
}
function canonicalCase(original:unknown):CanonicalCase{return original&&typeof original==='object'&&'schemaVersion' in original?structuredClone(validateClinical(original)):legacyToCanonical(original as LegacyCase);}
function applyChoice(original:unknown,questionId:string,choiceId:string){const updated=canonicalCase(original),choice=choicesFor(questionId).find(choice=>choice.id===choiceId)!;if(!choice.state)return updated;
 if(questionId==='pregnancy-status'||questionId==='pid-status'){updated[questionId==='pregnancy-status'?'pregnancyStatus':'pidStatus']={state:choice.state};}
 else if(choice.fieldId==='primaryQuestion'){updated.primaryQuestion={state:choice.state,...(choice.text?{value:choice.text}:{})};}
 else {const context={...updated.reportedContext};const field=choice.fieldId as keyof NonNullable<CanonicalCase['reportedContext']>;if(choice.state==='notReported')delete context[field];else context[field]=choice.state==='unknown'?null:choice.text;updated.reportedContext=context;}
 validateCase(updated);return updated;
}
export function createChoiceService(requestModel:typeof requestWatson=requestWatson){return async function followup(payload:unknown,packages:Package[],signal:AbortSignal,budget:number,environment:Environment=process.env){
 signal.throwIfAborted();let request;try{request=readChoiceRequest(payload);}catch{throw new InputError();}
 const base=validateCase(request.caseInput),result=analyze(base,packages),mode=selectFollowup(base,result,packages);
 if(!['analysis','clarification','missing'].includes(mode.kind)||!mode.questionId||request.questionId!==mode.questionId)throw new InputError();
 if(request.action==='start')return {status:'skipped',state:'active',mode};
 const choice=choicesFor(mode.questionId).find(choice=>choice.id===request.choiceId)!;
 const updated=applyChoice(request.caseInput,mode.questionId,choice.id);
 // A choice is only a proposal. Existing safety/conflict outcomes remain authoritative and cannot be resolved by a model.
 const preview=analyze(validateCase(updated),packages);
 if(request.action==='confirm')return {status:'skipped',state:'confirmed',mode,updatedCase:updated};
 const proposal={choiceId:choice.id,label:choice.label,fieldId:choice.fieldId??mode.fieldId,state:choice.state??'unchanged'};
 if(preview.envelope.warnings.length||preview.envelope.response.message===CoverageMessage)return {status:'skipped',state:'urgent',mode,proposal,analysis:preview.envelope};
 if(['DataConflict','ClarificationRequired'].includes(String(preview.envelope.response.responseType)))return {status:'skipped',state:'proposal',mode,proposal};
 if(environment.WATSONX_ENABLED!=='true'||environment.WATSONX_GUIDED_FOLLOWUP_ENABLED!=='true')return {status:'skipped',state:'proposal',mode,proposal};
 try{
  const offered={version:'2',moduleId:mode.moduleId,modeId:mode.kind,questionId:mode.questionId,clinicianChoiceId:choice.id,allowedChoiceIds:[choice.id],allowedAcknowledgementIds:['recorded']};
  const returned=exactKeys(await requestModel(offered,Instructions,signal,budget,environment,'guided'),['version','questionId','choiceId','acknowledgementId']);signal.throwIfAborted();
  if(returned.version!=='2'||returned.questionId!==mode.questionId||returned.choiceId!==choice.id||returned.acknowledgementId!=='recorded')throw new Error('Invalid selection.');
  return {status:'reviewed-success',state:'proposal',mode,proposal};
 }catch{signal.throwIfAborted();return {status:'reviewed-fallback',state:'proposal',mode,proposal};}
};}
export function createChoiceAdapter(transport:Transport){return createChoiceService(createWatsonRuntime(transport).request);}
export const runChoiceFollowup=createChoiceService();
