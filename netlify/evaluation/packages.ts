import { createHash } from 'node:crypto';
import Content from '../../frontend/.evaluationBundle/content.json';
import { ReviewHash } from './reviewSeal';

export const EvaluationNotice = 'Reviewed with healthcare professionals for evaluation and feedback. Not validated or approved for patient care.';
export const DecisionNotice = 'Decision-support notice: Evidence support only; not a diagnosis, treatment selection, or substitute for clinical judgment.';
export const Module1 = 'module_01_endo';
export const Module2 = 'module_02_early_pregnancy';
export interface Claim { claimId:string; moduleId:string; sourceId:string; supportedStatement:string; retrievalText:string; conditions:string[]; limitations:string[]; intendedPopulation:string; jurisdiction:string; productionApproved:false; contentHash:string }
export interface Source { sourceId:string; organization:string; title:string; publicationDate:string|null; officialUrl:string; urlVerificationStatus:'verifiedOfficialRetrieval'|'unresolved'; lifecycleStatus:'pendingReview' }
export interface Package { moduleId:string; packageId:string; claims:Claim[]; sources:Source[]; reviewStatus:string; competitionStatus:string; productionApproved:false; contentHash:string }
export class EvidenceError extends Error { constructor() { super('Evaluation evidence is unavailable.'); } }
export function hashBytes(contents:Uint8Array|string):string { return createHash('sha256').update(contents).digest('hex'); }
export function canonical(content:unknown):string {
 if (Array.isArray(content)) return '['+content.map(canonical).join(',')+']';
 if (content && typeof content==='object') return '{'+Object.keys(content).sort().map(key=>JSON.stringify(key)+':'+canonical((content as Record<string,unknown>)[key])).join(',')+'}';
 return JSON.stringify(content);
}
function unsigned(content:Record<string,unknown>):Record<string,unknown> { return Object.fromEntries(Object.entries(content).filter(([key])=>key!=='contentHash')); }
function safeRead(name:string):Buffer {
 if (!name || name.includes('\\') || name.includes(':') || name.split('/').some(part=>!part || part==='.' || part==='..')) throw new EvidenceError();
 const encoded=(Content.files as Record<string,string>)[name];
 if(typeof encoded!=='string')throw new EvidenceError();
 const contents=Buffer.from(encoded,'base64');
 if(contents.length<1||contents.length>1_000_000||contents.toString('base64')!==encoded)throw new EvidenceError();
 return contents;
}
export function loadPackages():Package[] {
 try {
  // Static server-only imports avoid broad filesystem tracing. A deployed
  // function uses one immutable reviewed release, never mutable local evidence.
  const contents=safeRead('evaluation/review.json');
  if(hashBytes(contents)!==ReviewHash) throw new EvidenceError();
  const review=JSON.parse(contents.toString('utf8'));
  if(review.reviewStatus!=='reviewedForEvaluation' || review.competitionStatus!=='competitionReady' || review.productionApproved!==false || review.notice!==EvaluationNotice) throw new EvidenceError();
  for(const [name,pin] of Object.entries(review.files)) if(hashBytes(safeRead(name))!==pin) throw new EvidenceError();
  return [1,2].map(number=>{
   const packageBytes=safeRead(`evaluation/modules/module${number}/claims.json`);
   const entry=JSON.parse(packageBytes.toString('utf8')) as Package;
   if(entry.moduleId!==(number===1?Module1:Module2) || entry.claims.length!==(number===1?57:21) || entry.reviewStatus!=='reviewedForEvaluation' || entry.competitionStatus!=='competitionReady' || entry.productionApproved!==false || hashBytes(canonical(unsigned(entry as unknown as Record<string,unknown>)))!==entry.contentHash) throw new EvidenceError();
   const sourceIds=new Set(entry.sources.map(source=>source.sourceId));
   if(sourceIds.size!==entry.sources.length || new Set(entry.claims.map(claim=>claim.claimId)).size!==entry.claims.length) throw new EvidenceError();
   for(const source of entry.sources) {
    const url=new URL(source.officialUrl);
    if(source.lifecycleStatus!=='pendingReview' || url.protocol!=='https:' || url.username || url.password || url.hash || !['verifiedOfficialRetrieval','unresolved'].includes(source.urlVerificationStatus)) throw new EvidenceError();
   }
   for(const claim of entry.claims) if(claim.moduleId!==entry.moduleId || !sourceIds.has(claim.sourceId) || claim.productionApproved!==false || hashBytes(canonical(unsigned(claim as unknown as Record<string,unknown>)))!==claim.contentHash) throw new EvidenceError();
   return entry;
  });
 } catch { throw new EvidenceError(); }
}
