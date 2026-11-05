import {applyObservations,interpretMessage,interpretDialogue,TurnLimit,type Observation} from '../../shared/conversation';
import {exactKeys} from '../../shared/guidedFollowup';
import type {CanonicalCase,LegacyCase} from '../../shared/clinicalData';
import {validateCase,InputError} from './input';
import {analyze,CoverageMessage} from './analysis';
import {selectFollowup} from './structuredFollowup';
import type {Package} from './packages';

/** Same-origin, request-scoped interpretation only. There is deliberately no provider import or transport. */
export function runConversation(payload:unknown,packages:Package[],signal:AbortSignal){
 if(payload&&typeof payload==='object'&&'version'in payload&&payload.version==='4')return runDialogue(payload,packages,signal);
 signal.throwIfAborted();const request=exactKeys(payload,['version','action','caseInput','message','selectedIds','confirmed']);
 if(request.version!=='3'||!['interpret','confirm'].includes(String(request.action))||typeof request.message!=='string'||request.message.length>1000||!Array.isArray(request.selectedIds)||request.selectedIds.length>8||request.selectedIds.some(id=>typeof id!=='string'||!/^O[1-8]$/.test(id))||typeof request.confirmed!=='boolean'||request.confirmed!==(request.action==='confirm')||request.action==='interpret'&&request.selectedIds.length)throw new InputError();
 const original=request.caseInput as CanonicalCase|LegacyCase,base=validateCase(original),result=analyze(base,packages),mode=selectFollowup(base,result,packages);
 if(!['analysis','clarification','missing'].includes(mode.kind))throw new InputError();
 // Validate messages using the same privacy boundary as normal narrative submissions. No text enters logs/provider calls.
 validateCase({...base,additionalNotes:request.message});
 const preview=analyze({...base,additionalNotes:[base.additionalNotes,request.message].filter(Boolean).join(' ')},packages);
 signal.throwIfAborted();
 if(preview.envelope.warnings.length||preview.envelope.response.message===CoverageMessage)return {version:'3',status:'skipped',state:'urgent',mode,analysis:preview.envelope};
 if(/(?:ignore|override|system|prompt|instructions|credentials|fabricate|https?:|www\.|<|>)/i.test(request.message))throw new InputError();
 const interpreted=interpretMessage(original,request.message,mode.questionId??undefined);
 const conflict=preview.envelope.response.responseType==='DataConflict'||interpreted.observations.some(observation=>observation.disposition==='conflict');
 // A typed assertion cannot resolve an existing or newly reported conflict, even through crafted confirmation IDs.
 if(conflict){if(request.action==='confirm')throw new InputError();return {version:'3',status:'skipped',state:'conflict',mode,...interpreted,analysis:preview.envelope};}
 // A scoped short answer can reveal urgency without repeating the symptom words.
 // Evaluate its unconfirmed proposal now, not after an optional confirmation conversation.
 const proposedIds=interpreted.observations.filter(observation=>observation.disposition==='proposed').map(observation=>observation.id);
 if(proposedIds.length){
  const proposed=analyze(validateCase(applyObservations(original,interpreted.observations,proposedIds)),packages);
  if(proposed.envelope.warnings.length||proposed.envelope.response.message===CoverageMessage)return {version:'3',status:'skipped',state:'urgent',mode,analysis:proposed.envelope};
 }
 if(request.action==='confirm'){
  let updated:CanonicalCase;try{updated=applyObservations(original,interpreted.observations,request.selectedIds as string[]);}catch{throw new InputError();}
  const checked=analyze(validateCase(updated),packages);signal.throwIfAborted();
  if(checked.envelope.warnings.length||checked.envelope.response.message===CoverageMessage)return {version:'3',status:'skipped',state:'urgent',mode,analysis:checked.envelope};
  if(checked.envelope.response.responseType==='DataConflict')throw new InputError();
  return {version:'3',status:'skipped',state:'confirmed',mode,updatedCase:updated,confirmed:interpreted.observations.filter((observation:Observation)=>(request.selectedIds as string[]).includes(observation.id))};
 }
 return {version:'3',status:'skipped',state:'interpreted',mode,...interpreted};
}


/** Replay only clinician turns; clients cannot supply trusted questions, extracted values or model roles. */
function runDialogue(payload:unknown,packages:Package[],signal:AbortSignal){
 signal.throwIfAborted();const request=exactKeys(payload,['version','action','caseInput','turns','selectedIds','confirmed']);
 if(request.version!=='4'||!['interpret','confirm'].includes(String(request.action))||!Array.isArray(request.turns)||!request.turns.length||request.turns.length>TurnLimit||request.turns.some(turn=>typeof turn!=='string'||!turn.trim()||turn.length>1000)||!Array.isArray(request.selectedIds)||request.selectedIds.length>8||request.selectedIds.some(id=>typeof id!=='string'||!/^O[1-8]$/.test(id))||typeof request.confirmed!=='boolean'||request.confirmed!==(request.action==='confirm')||request.action==='interpret'&&request.selectedIds.length)throw new InputError();
 const original=request.caseInput as CanonicalCase|LegacyCase,base=validateCase(original),result=analyze(base,packages),mode=selectFollowup(base,result,packages),turns=request.turns as string[];
 if(!['analysis','clarification','missing'].includes(mode.kind))throw new InputError();
 for(const turn of turns){validateCase({...base,additionalNotes:turn});if(/(?:ignore|override|system|prompt|instructions|credentials|fabricate|https?:|www\.|<|>)/i.test(turn))throw new InputError();}
 const preview=analyze({...base,additionalNotes:[base.additionalNotes,...turns].filter(Boolean).join(' ')},packages);
 signal.throwIfAborted();
 if(preview.envelope.warnings.length||preview.envelope.response.message===CoverageMessage)return {version:'4',status:'skipped',state:'urgent',mode,analysis:preview.envelope};
 const interpreted=interpretDialogue(original,turns,mode.questionId??undefined);
 const conflict=preview.envelope.response.responseType==='DataConflict'||interpreted.observations.some(observation=>observation.disposition==='conflict');
 if(conflict){if(request.action==='confirm')throw new InputError();return {version:'4',status:'skipped',state:'conflict',mode,...interpreted};}
 const proposedIds=interpreted.observations.filter(observation=>observation.disposition==='proposed').map(observation=>observation.id);
 if(proposedIds.length){const proposedBase=validateCase(applyObservations(original,interpreted.observations,proposedIds));
 // Unconfirmed status and symptoms can arrive in different turns; never discard either for the safety preview.
 const previewCase=analyze({...proposedBase,additionalNotes:[proposedBase.additionalNotes,...turns].filter(Boolean).join(' ')},packages);if(previewCase.envelope.warnings.length||previewCase.envelope.response.message===CoverageMessage)return {version:'4',status:'skipped',state:'urgent',mode,analysis:previewCase.envelope};}
 if(request.action==='confirm'){
  if(interpreted.pending)throw new InputError();
  let updated:CanonicalCase;try{updated=applyObservations(original,interpreted.observations,request.selectedIds as string[]);}catch{throw new InputError();}
  const checked=analyze(validateCase(updated),packages);signal.throwIfAborted();
  if(checked.envelope.response.responseType==='DataConflict')throw new InputError();
  if(checked.envelope.warnings.length||checked.envelope.response.message===CoverageMessage)return {version:'4',status:'skipped',state:'urgent',mode,analysis:checked.envelope};
  return {version:'4',status:'skipped',state:'confirmed',mode,updatedCase:updated};
 }
 return {version:'4',status:'skipped',state:'interpreted',mode,...interpreted};
}
