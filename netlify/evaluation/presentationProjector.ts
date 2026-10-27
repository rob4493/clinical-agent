import Wording from '../../shared/responsePresentation.json';
import Compact from '../../shared/summaryPresentation.json';
import { hashBytes, type Package } from './packages';
import type { Analysis } from './analysis';

export interface PresentationFact { factId:string; claimIds:string[]; wording:string }
export interface Presentation { presentationVersion:'1'; moduleId:string; findings:PresentationFact[] }

/** Exact public mappings are the only egress vocabulary; case objects never enter this boundary. */
export function projectPresentation(result:Analysis, packages:Package[]):Presentation|null {
 if(result.status!==200||result.envelope.warnings.length||result.envelope.response.responseType!=='AgentResponse')return null;
 const entry=packages.find(candidate=>candidate.moduleId===result.envelope.response.moduleId);
 const statements=result.envelope.response.supportedInterpretations;
 if(!entry||!Array.isArray(statements)||!statements.length||statements.length>3)return null;
 const mappings=[...Wording.entries.map(mapping=>({moduleId:mapping.moduleId,hash:hashBytes(mapping.original),claimIds:mapping.claimIds,sourceIds:mapping.sourceIds,wording:mapping.summary})),
  ...Compact.entries.map(mapping=>({moduleId:mapping.moduleId,hash:mapping.statementHash,claimIds:mapping.claimIds,sourceIds:mapping.sourceIds,wording:mapping.summary})),
  ...Compact.visualEntries.map(mapping=>({moduleId:'module_01_endo',hash:mapping.statementHash,claimIds:mapping.claimIds,sourceIds:mapping.sourceIds,wording:mapping.text}))];
 const selected:typeof mappings=[];
 for(const statement of statements) {
  if(!statement||typeof statement!=='object'||typeof statement.text!=='string'||statement.text.length>6000||!Array.isArray(statement.citations))return null;
  const tags:unknown[]=statement.citations.map((citation:unknown)=>citation&&typeof citation==='object'&&'sourceTag' in citation?citation.sourceTag:null);
  if(tags.some(tag=>typeof tag!=='string')||new Set(tags).size!==tags.length)return null;
  const candidates=mappings.filter(mapping=>mapping.moduleId===entry.moduleId&&mapping.sourceIds.every(id=>tags.includes(id)));
  const sentences=statement.text.split(/(?<=[.!?])\s+/);
  if(sentences.length>20)return null;
  const spans=new Map<number,{end:number;mapping:typeof mappings[number]}[]>();
  for(let start=0;start<sentences.length;start++)for(let end=start+1;end<=Math.min(sentences.length,start+8);end++) {
   const fingerprint=hashBytes(sentences.slice(start,end).join(' '));
   const mapping=candidates.find(candidate=>candidate.hash===fingerprint);
   if(mapping)spans.set(start,[...(spans.get(start)||[]),{end,mapping}]);
  }
  function cover(start:number):typeof mappings|null {
   if(start===sentences.length)return [];
   for(const span of spans.get(start)||[]) {const remaining=cover(span.end);if(remaining)return [span.mapping,...remaining];}
   return null;
  }
  const covered=cover(0);
  // Mixed or case-specific wording prevents the entire request from leaving the server.
  if(!covered||tags.some(tag=>!covered.some(mapping=>mapping.sourceIds.includes(tag as string))))return null;
  selected.push(...covered);
 }
 const unique=[...new Map(selected.map(mapping=>[mapping.hash,mapping])).values()];
 if(!unique.length||unique.length>10)return null;
 for(const mapping of unique) {
  if(mapping.wording.length>2000||/[<>\u0000-\u001f]|https?:\/\/|\b\d+(?:\.\d+)?\s*(?:cm|mm|mg|ml|weeks?|years?)\b/i.test(mapping.wording))return null;
  if(mapping.claimIds.some(id=>!entry.claims.some(claim=>claim.claimId===id&&claim.moduleId===entry.moduleId&&claim.productionApproved===false&&mapping.sourceIds.includes(claim.sourceId))))return null;
  if(mapping.sourceIds.some(id=>!result.envelope.sources.some(source=>source.source.sourceId===id)))return null;
 }
 return {presentationVersion:'1',moduleId:entry.moduleId,findings:unique.map((mapping,index)=>({factId:'F'+(index+1),claimIds:[...mapping.claimIds],wording:mapping.wording}))};
}

export class PresentationError extends Error { constructor(){super('Invalid presentation.');} }

/** IDs alone cannot establish semantic equivalence: accept only complete supplied public wording. */
export function validatePresentation(payload:unknown, supplied:Presentation):void {
 function fields(content:unknown, names:string[]):Record<string,unknown> {
  if(!content||typeof content!=='object'||Array.isArray(content)||Object.keys(content).sort().join('|')!==[...names].sort().join('|'))throw new PresentationError();
  return content as Record<string,unknown>;
 }
 const output=fields(payload,['presentationVersion','paragraphs']);
 if(output.presentationVersion!=='1'||!Array.isArray(output.paragraphs)||output.paragraphs.length<1||output.paragraphs.length>2)throw new PresentationError();
 const used=new Set<string>();
 for(const paragraph of output.paragraphs) {
  const part=fields(paragraph,['factIds','claimIds','text']);
  if(!Array.isArray(part.factIds)||!part.factIds.length||part.factIds.length>10||!Array.isArray(part.claimIds)||typeof part.text!=='string')throw new PresentationError();
  const facts=part.factIds.map(id=>{const fact=supplied.findings.find(fact=>fact.factId===id);if(!fact||used.has(fact.factId))throw new PresentationError();used.add(fact.factId);return fact;});
  const claims=[...new Set(facts.flatMap(fact=>fact.claimIds))].sort();
  if(part.claimIds.length!==claims.length||new Set(part.claimIds).size!==part.claimIds.length||[...part.claimIds].sort().join('|')!==claims.join('|')||part.text!==facts.map(fact=>fact.wording).join(' '))throw new PresentationError();
 }
 if(used.size!==supplied.findings.length)throw new PresentationError();
}
