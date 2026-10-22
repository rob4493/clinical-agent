import Schema from './clinicalData.schema.json';

type Definition = Record<string, any>;
export const SafeMessage='Invalid clinical data. Check the supported schema version, required fields and permitted values.';
export class ClinicalDataError extends Error { constructor(){super(SafeMessage);} }

function calendarDate(text:string,precision:string):boolean {
 const expressions:Record<string,RegExp>={day:/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,month:/^[0-9]{4}-[0-9]{2}$/,year:/^[0-9]{4}$/};
 if(!expressions[precision]?.test(text))return false;
 const parts=text.split('-').map(Number),year=parts[0],month=parts[1]??1,day=parts[2]??1;
 if(year<1||month<1||month>12||day<1)return false;
 const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 return day<=days[month-1];
}
function checkDate(record:Definition):boolean {
 const keys=Object.keys(record).sort().join(',');
 if(['unknown','notReported','notApplicable'].includes(record.kind))return keys==='kind';
 if(record.kind==='range')return keys==='end,kind,start'&&calendarDate(record.start,'day')&&calendarDate(record.end,'day')&&record.start<=record.end;
 return keys==='kind,precision,value'&&calendarDate(record.value,record.precision);
}
export function validateNode(content:unknown,definition:Definition=Schema,depth=0):void {
 if(depth>24)throw new ClinicalDataError();
 if(definition.$ref)return validateNode(content,(Schema.$defs as Definition)[definition.$ref.split('/').pop()],depth+1);
 if(definition.anyOf) {
  for(const option of definition.anyOf){try{validateNode(content,option,depth+1);return;}catch(failure){if(!(failure instanceof ClinicalDataError))throw failure;}}
  throw new ClinicalDataError();
 }
 if(Object.hasOwn(definition,'const')&&content!==definition.const||definition.enum&&!definition.enum.includes(content))throw new ClinicalDataError();
 const kind=definition.type;
 if(kind==='null'&&content!==null||kind==='boolean'&&typeof content!=='boolean')throw new ClinicalDataError();
 if(kind==='number'||kind==='integer') {
  if(typeof content!=='number'||!Number.isFinite(content)||kind==='integer'&&!Number.isInteger(content)||definition.minimum!==undefined&&content<definition.minimum||definition.maximum!==undefined&&content>definition.maximum)throw new ClinicalDataError();
 }
 if(kind==='string') {
  if(typeof content!=='string'||[...content].length<(definition.minLength??0)||[...content].length>(definition.maxLength??65536)||definition.pattern&&new RegExp(definition.pattern).exec(content)?.[0]!==content)throw new ClinicalDataError();
 }
 if(kind==='array') {
  if(!Array.isArray(content)||content.length<(definition.minItems??0)||content.length>(definition.maxItems??64))throw new ClinicalDataError();
  for(const entry of content)validateNode(entry,definition.items,depth+1);
  if(definition.uniqueItems&&new Set(content.map(entry=>JSON.stringify(entry))).size!==content.length)throw new ClinicalDataError();
  if(definition['x-uniqueId']&&new Set(content.map(entry=>entry[definition['x-uniqueId']])).size!==content.length)throw new ClinicalDataError();
 }
 if(kind==='object') {
  if(!content||typeof content!=='object'||Array.isArray(content))throw new ClinicalDataError();
  const record=content as Definition;
  if(Object.keys(record).some(name=>!Object.hasOwn(definition.properties,name))||(definition.required??[]).some((name:string)=>!Object.hasOwn(record,name)))throw new ClinicalDataError();
  for(const [name,entry] of Object.entries(record))validateNode(entry,definition.properties[name],depth+1);
  if(definition['x-stateValue']&&((record.state==='present')!==Object.hasOwn(record,'value')))throw new ClinicalDataError();
  if(definition['x-clinicalDate']&&!checkDate(record))throw new ClinicalDataError();
  if(definition['x-sourceSpan']&&(!('page' in record||'start' in record)||('start' in record)!==('end' in record)||'start' in record&&record.start>=record.end))throw new ClinicalDataError();
  if(definition['x-intent']&&((record.state==='reported')!==(!!record.requests?.length&&'origin' in record)||record.state!=='reported'&&Object.keys(record).join(',')!=='state'))throw new ClinicalDataError();
  if(definition['x-caseIntegrity'])checkIntegrity(record);
 }
}
function checkIntegrity(caseInput:Definition):void {
 const ids=new Set<string>(),spans:Definition[]=[];
 function visit(record:unknown):void {
  if(Array.isArray(record)){record.forEach(visit);return;}
  if(!record||typeof record!=='object')return;
  const fields=record as Definition;
  if('id' in fields){if(ids.has(fields.id))throw new ClinicalDataError();ids.add(fields.id);}
  if('documentId' in fields)spans.push(fields);
  Object.values(fields).forEach(visit);
 }
 visit(caseInput);
 const documents=new Set((caseInput.sourceDocuments??[]).map((record:Definition)=>record.id)),interpretations=new Set((caseInput.clinicianInterpretations??[]).map((record:Definition)=>record.id));
 if(spans.some(span=>!documents.has(span.documentId))||(caseInput.conflictingInterpretations??[]).some((conflict:Definition)=>conflict.interpretationIds.some((id:string)=>!interpretations.has(id))))throw new ClinicalDataError();
 if(caseInput.earlyPregnancy!=null&&caseInput.moduleId!=='module_02_early_pregnancy')throw new ClinicalDataError();
 if(new TextEncoder().encode(JSON.stringify(caseInput)).length>65536)throw new ClinicalDataError();
}
