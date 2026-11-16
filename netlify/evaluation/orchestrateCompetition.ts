import {randomInt,randomUUID} from 'node:crypto';
import {QuotaError,waitQuota,validateTicket,type QuotaStore} from './demoQuota';
import {LiveProbeAgent} from './orchestrateProbePolicy';
import {isOrchestrateApiUrl,type OrchestrateEnvironment} from './orchestrateTarget';

export const CompetitionStore='EndoOrchestrateCompetitionV1';
export interface CompetitionWindow {startedAt:number;until:number;dailyCalls:number;dailySessions:number}
export function competitionWindow(env:OrchestrateEnvironment,now:number):CompetitionWindow|null{
 const integer=(value:string|undefined,fallback:number,max:number)=>value===undefined?fallback:/^[1-9]\d{0,3}$/.test(value)&&Number(value)<=max?Number(value):NaN;
 const startedAt=Date.parse(env.ORCHESTRATE_COMPETITION_STARTED_AT||''),until=Date.parse(env.ORCHESTRATE_COMPETITION_UNTIL||'');
 const dailyCalls=integer(env.ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT,50,1000),dailySessions=integer(env.ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT,20,200);
 if(env.ORCHESTRATE_COMPETITION_ENABLED!=='true'||env.ORCHESTRATE_PROBE_KILL_SWITCH!=='false'||env.OTEL_SDK_DISABLED!=='true'
  ||env.ORCHESTRATE_ENABLED!=='false'||env.ENDO_DEMO_INFERENCE_ENABLED!=='false'||env.ENDO_DEMO_KILL_SWITCH!=='true'
  ||env.ORCHESTRATE_EMBED_PREVIEW_ENABLED!=='false'||env.ORCHESTRATE_EMBED_KILL_SWITCH!=='true'
  ||env.ORCHESTRATE_AGENT_ID!==LiveProbeAgent||env.ORCHESTRATE_ENVIRONMENT!=='live'||!isOrchestrateApiUrl(env.ORCHESTRATE_API_URL)
  ||new URL(env.ORCHESTRATE_API_URL!).hostname!=='api.eu-de.watson-orchestrate.cloud.ibm.com'
  ||![now,startedAt,until,dailyCalls,dailySessions].every(Number.isFinite)||startedAt>now||until<=now||until-startedAt>14400000||until<=startedAt)return null;
 return {startedAt,until,dailyCalls,dailySessions};
}
const Uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const Reasons=new Set(['completed','disabled','configuration','authenticationFailure','authorizationFailure','endpointOrAgentUnavailable','quotaRejected','quotaUnavailable','networkFailure','timeout','providerUnavailable','providerResponse','continuityFailure','internal']);
export type CompetitionOutcome={status:'passed'|'failed';reason:string;invoked:boolean};
type Ticket={kind:'session'|'call';day:string;reservationId:string};

/** Only this versioned store accepts competition operational records. No patient,
 * prompt, transcript, operator identity, credential or provider ID is permitted. */
export function validateCompetitionTicket(key:string,content?:string):void{
 if(key.startsWith('thread/')){validateTicket(key,content);return;}
 if(!/^(?:policy\/\d{4}-\d{2}-\d{2}|(?:session|call)\/\d{4}-\d{2}-\d{2}\/(?:0|[1-9]\d{0,2})|outcome\/(?:session|call)\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36})$/.test(key))throw new QuotaError('unavailable');
 if(content===undefined)return;
 try{
  if(content.length>256)throw new Error();const value=JSON.parse(content);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
  const keys=Object.keys(value).sort().join('|');
  if(key.startsWith('policy/')){
   if(keys!=='dailyCalls|dailySessions|version'||value.version!=='1'||!Number.isInteger(value.dailyCalls)||value.dailyCalls<1||value.dailyCalls>1000||!Number.isInteger(value.dailySessions)||value.dailySessions<1||value.dailySessions>200)throw new Error();
  }else if(key.startsWith('outcome/')){
   if(keys!=='invoked|reason|status'||!['passed','failed'].includes(value.status)||!Reasons.has(value.reason)||typeof value.invoked!=='boolean')throw new Error();
  }else if(keys!=='createdAt|reservationId'||!Uuid.test(value.reservationId)||!Number.isSafeInteger(value.createdAt)||value.createdAt<0)throw new Error();
 }catch{throw new QuotaError('unavailable');}
}

/** Atomic capacity slots, not mutable counters or one-attempt daily visit locks.
 * Historical stores are never opened. Partial failures burn capacity; never refund.
 * A day's limits are frozen so overlapping deploys cannot enlarge that day's cap.
 */
export function createCompetitionQuota(factory:(signal:AbortSignal)=>Promise<QuotaStore>,window:CompetitionWindow,clock:()=>number=Date.now,startSlot:(limit:number)=>number=randomInt){
 async function use<T>(signal:AbortSignal,task:(store:QuotaStore,operation:AbortSignal)=>Promise<T>):Promise<T>{
  const operation=AbortSignal.any([signal,AbortSignal.timeout(2000)]);
  try{const store=await waitQuota(factory(operation),operation);return await waitQuota(task(store,operation),operation);}catch{throw new QuotaError('unavailable');}
 }
 async function write(store:QuotaStore,key:string,content:string,signal:AbortSignal,collision=false){
  validateCompetitionTicket(key,content);signal.throwIfAborted();const written=await waitQuota(store.set(key,content,{onlyIfNew:true}),signal);
  if(written.modified===false&&collision)return false;
  if(written.modified!==true||!written.etag)throw new QuotaError('unavailable');
  const observed=await waitQuota(store.getWithMetadata(key),signal);signal.throwIfAborted();
  if(!observed||observed.etag!==written.etag||JSON.stringify(observed.data)!==content)throw new QuotaError('unavailable');return true;
 }
 async function reserve(kind:Ticket['kind'],signal:AbortSignal):Promise<Ticket>{
  if(clock()<window.startedAt||clock()>=window.until||window.until-window.startedAt>14400000)throw new QuotaError('unavailable');
  let exhausted=false;
  try{return await use(signal,async(store,operation)=>{
   const day=new Date(clock()).toISOString().slice(0,10),key='policy/'+day,content=JSON.stringify({version:'1',dailyCalls:window.dailyCalls,dailySessions:window.dailySessions});
   validateCompetitionTicket(key,content);await waitQuota(store.set(key,content,{onlyIfNew:true}),operation);
   const policy=await waitQuota(store.getWithMetadata(key),operation);
   if(!policy?.etag||JSON.stringify(policy.data)!==content)throw new QuotaError('unavailable');
   const limit=kind==='call'?window.dailyCalls:window.dailySessions,first=startSlot(limit);
   if(!Number.isInteger(first)||first<0||first>=limit)throw new QuotaError('unavailable');
   const record={reservationId:randomUUID(),createdAt:clock()};
   for(let offset=0;offset<limit;offset++){
    if(await write(store,kind+'/'+day+'/'+((first+offset)%limit),JSON.stringify(record),operation,true))return {kind,day,reservationId:record.reservationId};
   }
   exhausted=true;throw new QuotaError('exhausted');
  });}catch{throw new QuotaError(exhausted?'exhausted':'unavailable');}
 }
 return Object.freeze({reserveSession:(signal:AbortSignal)=>reserve('session',signal),reserveCall:(signal:AbortSignal)=>reserve('call',signal),
  async record(ticket:Ticket,outcome:CompetitionOutcome,signal:AbortSignal){
   await use(signal,async(store,operation)=>{await write(store,'outcome/'+ticket.kind+'/'+ticket.day+'/'+ticket.reservationId,JSON.stringify(outcome),operation);});
  }
 });
}
export type CompetitionQuota=ReturnType<typeof createCompetitionQuota>;
export type CompetitionTicket=Awaited<ReturnType<CompetitionQuota['reserveSession']>>;
