import Policy from './policy.json';
import Schema from '../../shared/clinicalData.schema.json';
import { canonicalToLegacy, legacyToCanonical } from '../../shared/caseBridge';
import { ClinicalDataError } from '../../shared/schemaRules';
import type { LegacyCase } from '../../shared/clinicalData';

export type RecordFields = Record<string,unknown>;
export interface CaseInput extends RecordFields { moduleHint:string; caseType:'brief'|'detailed'; additionalNotes:string|null; ageRange:string|null; pregnancyPossible:boolean|null; pidDiagnosedOrPresumed:boolean|null; earlyPregnancy:RecordFields|null; urgentFindings:RecordFields|null }
export class InputError extends Error { constructor() { super('Invalid request. Check the required fields and permitted values, and remove patient names, dates of birth, contact details, and medical record numbers before resubmitting.'); } }
export function parseJson(text:string):unknown {
 // JSON.parse accepts duplicate keys. Reject them before schema validation so a
 // conflicting structured status cannot be silently overwritten.
 let position=0;
 function whitespace() { while(/\s/.test(text[position]||'') && position<text.length) position++; }
 function parse(depth:number):unknown {
  if(depth>20) throw new InputError(); whitespace();
  const character=text[position];
  if(character==='{' || character==='[') {
   position++; const object=character==='{'?Object.create(null):[]; const keys=new Set<string>(); whitespace();
   const end=character==='{'?'}':']'; if(text[position]===end) {position++;return object;}
   for(;;) {
    let key=''; if(character==='{') { const parsed=parse(depth+1); if(typeof parsed!=='string' || keys.has(parsed)) throw new InputError(); key=parsed;keys.add(key);whitespace();if(text[position++]!==':') throw new InputError(); }
    const result=parse(depth+1); if(character==='{') object[key]=result; else object.push(result);
    whitespace(); const next=text[position++]; if(next===end) return object; if(next!==',') throw new InputError();
   }
  }
  if(character==='"') {
   const start=position++; let escaped=false;
   while(position<text.length) { const next=text[position++]; if(next==='"' && !escaped) return JSON.parse(text.slice(start,position)); escaped=next==='\\'?!escaped:false; }
   throw new InputError();
  }
  const match=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(position));
  if(!match) throw new InputError(); position+=match[0].length; return JSON.parse(match[0]);
 }
 const result=parse(0);whitespace();if(position!==text.length) throw new InputError();return result;
}
export function textField(fields:RecordFields,name:string):string { return typeof fields[name]==='string'?fields[name] as string:''; }
export function context(caseInput:CaseInput):RecordFields { return caseInput.earlyPregnancy||{}; }
export function weeks(caseInput:CaseInput):number|null { const candidate=context(caseInput).gestationalWeeks;return typeof candidate==='number'?candidate:null; }
export function pattern(expression:string,flags='i'):RegExp { return new RegExp(expression,flags); }
export function validateCase(payload:unknown):CaseInput {
 try {return validateRequest(payload);} catch(failure) {if(failure instanceof ClinicalDataError)throw new InputError();throw failure;}
}
function validateRequest(payload:unknown):CaseInput {
 if(payload&&typeof payload==='object'&&!Array.isArray(payload)&&Object.hasOwn(payload,'schemaVersion'))payload=canonicalToLegacy(payload);
 const root={...Schema.$defs.LegacyCase,$defs:Schema.$defs} as unknown as RecordFields;
 function validate(content:unknown,schema:RecordFields):unknown {
  if(schema.$ref) return validate(content,(root.$defs as RecordFields)[String(schema.$ref).split('/').pop()!] as RecordFields);
  if(Array.isArray(schema.anyOf)) {
   for(const option of schema.anyOf) {try{return validate(content,option);}catch{}}
   throw new InputError();
  }
  if(schema.const!==undefined && content!==schema.const || Array.isArray(schema.enum) && !schema.enum.includes(content)) throw new InputError();
  if(schema.type==='null') {if(content!==null) throw new InputError();return null;}
  if(schema.type==='boolean') {if(typeof content!=='boolean') throw new InputError();return content;}
  if(schema.type==='number' || schema.type==='integer') {
   if(typeof content!=='number' || !Number.isFinite(content) || schema.type==='integer' && !Number.isInteger(content) || typeof schema.minimum==='number' && content<schema.minimum || typeof schema.maximum==='number' && content>schema.maximum) throw new InputError();return content;
  }
  if(schema.type==='string') {
   if(typeof content!=='string') throw new InputError(); content=content.trim();
   const value=content as string;
   if(typeof schema.maxLength==='number' && [...value].length>schema.maxLength || typeof schema.minLength==='number' && [...value].length<schema.minLength || typeof schema.pattern==='string' && !pattern(schema.pattern,'').test(value)) throw new InputError();
   return value;
  }
  if(schema.type==='object') {
   if(!content || typeof content!=='object' || Array.isArray(content)) throw new InputError();
   const fields=content as RecordFields, properties=schema.properties as Record<string,RecordFields>, result:RecordFields=Object.create(null);
   if(schema.additionalProperties===false && Object.keys(fields).some(key=>!Object.hasOwn(properties,key))) throw new InputError();
   for(const [key,definition] of Object.entries(properties)) {
    if(Object.hasOwn(fields,key)) result[key]=validate(fields[key],definition);
    else if(Array.isArray(schema.required) && schema.required.includes(key)) throw new InputError();
    else result[key]=Object.hasOwn(definition,'default')?definition.default:null;
   }
   return result;
  }
  return content;
 }
 const result=validate(payload,root) as CaseInput;
 if(result.moduleHint!=='NotSure')legacyToCanonical(result as unknown as LegacyCase);
 if(result.earlyPregnancy!==null && result.moduleHint!=='module_02_early_pregnancy') throw new InputError();
 for(const [name,content] of Object.entries(result)) {
  if(typeof content!=='string' || ['moduleHint','caseType'].includes(name)) continue;
  for(const expression of Policy.piiPatterns) if(pattern(expression,'').test(content)) throw new InputError();
  // JavaScript \d is ASCII-only, unlike Python's Unicode-aware matcher. Deny
  // non-ASCII decimal identifiers rather than introducing a privacy bypass.
  if(/[^\x00-\x7f]/.test(content) && /\p{Nd}{7,}|\p{Nd}{1,4}[-/.]\p{Nd}{1,2}[-/.]\p{Nd}{1,4}/u.test(content)) throw new InputError();
 }
 return result;
}
