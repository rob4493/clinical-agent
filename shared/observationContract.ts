import Schema from './observations.schema.json';
import type {FindingState} from './clinicalData';
import {parseJson} from '../netlify/evaluation/input';

export const ContractVersion='1.0.0';
export type ConceptId=keyof typeof Schema['x-bindings'];
export interface Turn {id:string;text:string}
export interface Projection {projectionVersion:'1.0.0';moduleId:string;questionId:string;turns:Turn[]}
export interface Span {turnId:string;start:number;end:number}
export interface ProposedObservation {id:string;conceptId:ConceptId;fieldPath:string;state:FindingState;temporalContext:'current'|'historical'|'hypothetical';sourceSpans:Span[];relation:'reported'|'clarifies'|'corrects'|'contradicts';relatedIds:string[]}
export interface ProposedOutput {schemaVersion:'1.0.0';observations:ProposedObservation[];clarification:{conceptId:ConceptId|'unspecified';reason:'uncertain'|'ambiguous'|'missing'|'referent'|'conflict'|'unsupported';sourceTurnIds:string[]}|null}
export interface ValidatedProposal {moduleId:string;verification:'needsReview';proposal:ProposedOutput}
export class EvaluationError extends Error {constructor(){super('Offline understanding evaluation rejected.');}}
const Validated=new WeakSet<object>();
type Shape=Record<string,any>;
/** Small closed-schema validator: no remote references, coercion, defaults or repair. */
export function validateShape(content:unknown,schema:Shape=Schema,depth=0):void {
 if(depth>12)throw new EvaluationError();
 if(schema.anyOf){for(const option of schema.anyOf){try{validateShape(content,option,depth+1);return;}catch{}}throw new EvaluationError();}
 if(schema.const!==undefined&&content!==schema.const||schema.enum&&!schema.enum.includes(content))throw new EvaluationError();
 if(schema.type==='null'){if(content!==null)throw new EvaluationError();return;}
 if(schema.type==='string'){if(typeof content!=='string'||content.length<(schema.minLength??0)||content.length>(schema.maxLength??(typeof schema.const==='string'?schema.const.length:Math.max(...(schema.enum??[]).map((entry:string)=>entry.length),0)))||schema.pattern&&!new RegExp(schema.pattern).test(content))throw new EvaluationError();return;}
 if(schema.type==='integer'){if(typeof content!=='number'||!Number.isInteger(content)||content<schema.minimum||content>schema.maximum)throw new EvaluationError();return;}
 if(schema.type==='array'){if(!Array.isArray(content)||content.length<schema.minItems||content.length>schema.maxItems)throw new EvaluationError();content.forEach(entry=>validateShape(entry,schema.items,depth+1));return;}
 if(schema.type==='object'){if(!content||typeof content!=='object'||Array.isArray(content))throw new EvaluationError();const record=content as Shape;if(Object.keys(record).some(key=>!Object.hasOwn(schema.properties,key))||schema.required.some((key:string)=>!Object.hasOwn(record,key)))throw new EvaluationError();for(const key of Object.keys(record))validateShape(record[key],schema.properties[key],depth+1);return;}
 throw new EvaluationError();
}
export function freeze<T>(record:T):T {if(record&&typeof record==='object'){Object.values(record).forEach(freeze);Object.freeze(record);}return record;}
function boundary(text:string,offset:number){return offset===0||offset===text.length||!(text.charCodeAt(offset)>=0xdc00&&text.charCodeAt(offset)<=0xdfff&&text.charCodeAt(offset-1)>=0xd800&&text.charCodeAt(offset-1)<=0xdbff);}
/** Syntax, module bindings and source references are verified, not semantic clinical truth. */
export function validateProposal(raw:string,input:Projection):ValidatedProposal {
 try{
  if(typeof raw!=='string'||raw.length>16384||new TextEncoder().encode(raw).length>16384)throw new EvaluationError();
  const proposal=parseJson(raw) as ProposedOutput;validateShape(proposal);
  const ids=new Set<string>(),facts=new Set<string>();
  for(const observation of proposal.observations){
   const binding=Schema['x-bindings'][observation.conceptId],key=[observation.conceptId,observation.state,observation.temporalContext].join(':');
   if(ids.has(observation.id)||facts.has(key)||observation.fieldPath!==binding.path||!(binding.allowedStates as string[]).includes(observation.state)||!(binding.modules as string[]).includes(input.moduleId)||new Set(observation.relatedIds).size!==observation.relatedIds.length)throw new EvaluationError();
   ids.add(observation.id);facts.add(key);
   if(observation.relation==='reported'&&observation.relatedIds.length||observation.relation!=='reported'&&!observation.relatedIds.length)throw new EvaluationError();
   const spans=new Set<string>();
   for(const span of observation.sourceSpans){const turn=input.turns.find(turn=>turn.id===span.turnId),identity=JSON.stringify(span);if(!turn||span.start>=span.end||span.end>turn.text.length||!turn.text.slice(span.start,span.end).trim()||!boundary(turn.text,span.start)||!boundary(turn.text,span.end)||spans.has(identity))throw new EvaluationError();spans.add(identity);}
  }
  for(const observation of proposal.observations)for(const id of observation.relatedIds){const related=proposal.observations.find(candidate=>candidate.id===id);if(!related||id===observation.id||related.conceptId!==observation.conceptId||Number(id.slice(1))>=Number(observation.id.slice(1)))throw new EvaluationError();}
  if(proposal.clarification){const {conceptId,sourceTurnIds}=proposal.clarification;if(new Set(sourceTurnIds).size!==sourceTurnIds.length||sourceTurnIds.some(id=>!input.turns.some(turn=>turn.id===id))||conceptId!=='unspecified'&&!(Schema['x-bindings'][conceptId].modules as string[]).includes(input.moduleId))throw new EvaluationError();}
  const result=freeze({moduleId:input.moduleId,verification:'needsReview' as const,proposal});Validated.add(result);return result;
 }catch{throw new EvaluationError();}
}
export function isValidated(proposal:unknown):proposal is ValidatedProposal{return !!proposal&&typeof proposal==='object'&&Validated.has(proposal);}
