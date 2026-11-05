import {createHash} from 'node:crypto';
import Corpus from '../../evaluation/understanding/corpus.json';
import Contract from '../../evaluation/understanding/observations.schema.json';
import {analyze,CoverageMessage} from '../../netlify/evaluation/analysis';
import {validateCase} from '../../netlify/evaluation/input';
import {loadPackages} from '../../netlify/evaluation/packages';
import {parseJson} from '../../netlify/evaluation/input';
import {createMock,type OfflineMock} from './adapter';
import {episodes,projectFixture,type Episode} from './projection';
import {EvaluationError,validateProposal,type ProposedObservation,type ValidatedProposal} from './contract';

export interface Clock {now:()=>number;delay:(callback:()=>void,milliseconds:number)=>()=>void}
const SystemClock:Clock={now:()=>Date.now(),delay:(callback,milliseconds)=>{const timer=setTimeout(callback,milliseconds);return()=>clearTimeout(timer);}};
export type Outcome={status:'proposed';proposal:ValidatedProposal}|{status:'rejected'|'disabled'|'timeout'|'cancelled'|'projectionRejected';authorityAttempt?:boolean};
/** A combined, abortable offline deadline with no retries; only an explicit mock capability is accepted. */
export async function evaluateMock(episodeId:string,adapter:OfflineMock|null=null,signal:AbortSignal=new AbortController().signal,timeout=100,clock:Clock=SystemClock):Promise<Outcome>{
 if(signal.aborted)return {status:'cancelled'};
 if(!Number.isInteger(timeout)||timeout<1||timeout>1000)throw new EvaluationError();
 let input;try{input=projectFixture(episodeId);}catch{return {status:'projectionRejected'};}
 if(!adapter)return {status:'disabled'};
 if(adapter.kind!=='offlineMock')throw new EvaluationError();
 const controller=new AbortController(),deadline=clock.now()+timeout;let expired=false,authorityAttempt=false,cleanup=()=>{},detach=()=>{};
 try{
  const interrupted=new Promise<never>((resolve,reject)=>{void resolve;const cancel=()=>{controller.abort();reject(new EvaluationError());};signal.addEventListener('abort',cancel,{once:true});detach=()=>signal.removeEventListener('abort',cancel);cleanup=clock.delay(()=>{expired=true;cancel();},timeout);});
  // Racing also bounds mocks that ignore their signal. Rejections are consumed by the race.
  const raw=await Promise.race([Promise.resolve().then(()=>{controller.signal.throwIfAborted();return adapter.suggest(input,controller.signal);}),interrupted]);
  if(signal.aborted)return {status:'cancelled'};
  if(clock.now()>=deadline)return {status:'timeout'};
  if(typeof raw!=='string'||raw.length>16384||new TextEncoder().encode(raw).length>16384)throw new EvaluationError();
  authorityAttempt=forbiddenAuthority(raw);const validated=validateProposal(raw,input);
  if(signal.aborted)return {status:'cancelled'};if(clock.now()>=deadline)return {status:'timeout'};return {status:'proposed',proposal:validated};
 }catch{return {status:signal.aborted?'cancelled':expired?'timeout':'rejected',authorityAttempt};}
 finally{controller.abort();cleanup();detach();}
}
export function deterministicGate(episode:Episode):string {const result=analyze(validateCase(episode.caseInput),loadPackages());if(result.envelope.response.responseType==='DataConflict')return 'conflict';if(result.envelope.response.responseType==='ClarificationRequired')return 'clarification';if(result.envelope.response.message===CoverageMessage)return 'coverageUnavailable';return result.envelope.warnings.length?'urgent':'ordinary';}
export interface Metrics {expectedFacts:number;predictedFacts:number;correctExtractions:number;missedFacts:number;inventedFacts:number;unsupportedInterpretations:number;incorrectNegation:number;missedUrgentFacts:number;urgentWarningFailures:number;inappropriateUpdateProposals:number;invalidOutputs:number;clarificationErrors:number;privacyFailures:number;gateAnnotationMismatches:number}
export function emptyMetrics():Metrics{return {expectedFacts:0,predictedFacts:0,correctExtractions:0,missedFacts:0,inventedFacts:0,unsupportedInterpretations:0,incorrectNegation:0,missedUrgentFacts:0,urgentWarningFailures:0,inappropriateUpdateProposals:0,invalidOutputs:0,clarificationErrors:0,privacyFailures:0,gateAnnotationMismatches:0};}
function signature(observation:ProposedObservation){return JSON.stringify([observation.conceptId,observation.fieldPath,observation.state,observation.temporalContext,observation.sourceSpans,observation.relation,observation.relatedIds]);}
/** Draft annotations measure mock behavior, not real-model accuracy or clinical validity. */
export function score(episode:Episode,outcome:Outcome,gate?:string):Metrics {
 const metrics=emptyMetrics(),expected=episode.expected.observations,predicted=outcome.status==='proposed'?outcome.proposal.proposal.observations:[];
 if(episode.expectedProjection==='deny'){metrics.privacyFailures=outcome.status==='projectionRejected'?0:1;return metrics;}
 metrics.inappropriateUpdateProposals=outcome.status!=='proposed'&&outcome.authorityAttempt?1:0;
 const actualGate=gate??deterministicGate(episode);
 metrics.expectedFacts=expected.length;metrics.predictedFacts=predicted.length;
 const matched=new Set<string>();
 for(const observation of predicted){const exact=expected.find(fact=>signature(fact)===signature(observation));if(exact){metrics.correctExtractions++;matched.add(exact.id);continue;}
  const same=expected.find(fact=>fact.conceptId===observation.conceptId);
  if(!same)metrics.inventedFacts++;else metrics.unsupportedInterpretations++;
  if(same&&['present','absent'].includes(same.state)&&['present','absent'].includes(observation.state)&&same.state!==observation.state)metrics.incorrectNegation++;
  if(observation.temporalContext==='current')metrics.inappropriateUpdateProposals++;
 }
 metrics.missedFacts=expected.filter(fact=>!matched.has(fact.id)).length;
 const urgentConcepts=['suddenAcutePelvicPain','severeAcutePelvicPain','suddenSevereAbdominalOrPelvicPain','shoulderPain','weakness','dizziness','fainting','hemodynamicInstability','heavyBleeding'];
 metrics.missedUrgentFacts=expected.filter(fact=>fact.temporalContext==='current'&&fact.state==='present'&&urgentConcepts.includes(fact.conceptId)&&!matched.has(fact.id)).length;
 metrics.invalidOutputs=['rejected','timeout','cancelled','disabled'].includes(outcome.status)?1:0;
 metrics.clarificationErrors=JSON.stringify(outcome.status==='proposed'?outcome.proposal.proposal.clarification:null)===JSON.stringify(episode.expected.clarification)?0:1;
 metrics.gateAnnotationMismatches=actualGate===episode.expectedSafety?0:1;
 metrics.urgentWarningFailures=['urgent','coverageUnavailable'].includes(episode.expectedSafety)&&actualGate!==episode.expectedSafety?1:0;
 return metrics;
}
export function forbiddenAuthority(raw:string):boolean {
 if(typeof raw!=='string'||raw.length>16384)return false;
 const forbidden=new Set(['canonicalCase','updatedCase','reanalyze','verification','claimIds','sources','diagnosis','treatment']);
 function inspect(record:unknown):boolean {if(!record||typeof record!=='object')return false;return Object.entries(record).some(([key,entry])=>forbidden.has(key)||inspect(entry));}
 try{return inspect(parseJson(raw));}catch{return false;}
}
export async function runReferenceEvaluation(){const reports=[];const total=emptyMetrics();for(const episode of episodes()){
 const outcome=await evaluateMock(episode.id,createMock(async()=>JSON.stringify(episode.expected)));
 const metrics=score(episode,outcome);for(const key of Object.keys(total) as (keyof Metrics)[])total[key]+=metrics[key];
 reports.push({episodeId:episode.id,status:outcome.status,metrics});
 }return {corpusDigest:createHash('sha256').update(JSON.stringify(Corpus)).digest('hex'),contractDigest:createHash('sha256').update(JSON.stringify(Contract)).digest('hex'),corpusVersion:'1.0.0',contractVersion:'1.0.0',mode:'offlineMocksOnly',clinicalThresholdsApproved:false,providerAccess:false,caseCount:reports.length,total,precision:total.predictedFacts?total.correctExtractions/total.predictedFacts:null,recall:total.expectedFacts?total.correctExtractions/total.expectedFacts:null,reports};}
