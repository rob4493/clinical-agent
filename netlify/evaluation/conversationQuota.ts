import {createHash,randomInt,randomUUID} from 'node:crypto';
import {QuotaError,waitQuota,validateTicket,type QuotaStore} from './demoQuota';
export const ConversationStore='EndoPublicConversationV2';
/** UTC calendar months, clamping month-end dates; never a fixed 60-day approximation.
 * This public availability bound does not extend visitor sessions or diagnostics. */
export function maximumPublicEvaluationEnd(startedAt:number):number{
 if(!Number.isSafeInteger(startedAt)||startedAt<0)return NaN;
 const date=new Date(startedAt);if(!Number.isFinite(date.getTime()))return NaN;
 const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+2);
 const last=new Date(date.getTime());last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
 date.setUTCDate(Math.min(day,last.getUTCDate()));return date.getTime();
}
export interface ConversationWindow {startedAt:number;until:number;dailyCalls:number;dailySessions:number;visitorCalls?:number;visitorSessions?:number;networkCalls?:number;networkSessions?:number}
const Uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const Reasons=new Set(['completed','disabled','configuration','authenticationFailure','authorizationFailure','endpointOrAgentUnavailable','quotaRejected','quotaUnavailable','networkFailure','timeout','providerUnavailable','providerResponse','continuityFailure','internal']);
export type ConversationOutcome={status:'passed'|'failed';reason:string;invoked:boolean};
type Ticket={kind:'session'|'call';day:string;reservationId:string};

/** Only this versioned store accepts conversation operational records. No patient,
 * prompt, transcript, operator identity, credential or provider ID is permitted. */
export function validateChatLock(key:string,content?:string){
 if(!/^chat\/lock\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:[0-9]|1[01])$/.test(key)||content!==undefined&&content!=='{"consumed":true}')throw new QuotaError('unavailable');
}
export function validateConversationTicket(key:string,content?:string):void{
 if(/^stop\/[a-f0-9]{64}$/.test(key)){if(content!==undefined&&content!=='{"stopped":true}')throw new QuotaError('unavailable');return;}
 if(key.startsWith('budget/')){const match=/^budget\/(?:visitor|network)\/[a-f0-9]{64}\/(.+)$/.exec(key);if(!match||! /^(?:policy|session|call)\//.test(match[1]))throw new QuotaError('unavailable');validateConversationTicket(match[1],content);return;}
 if(key.startsWith('chat/lock/')){validateChatLock(key,content);return;}
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
export function createConversationQuota(factory:(signal:AbortSignal)=>Promise<QuotaStore>,window:ConversationWindow,clock:()=>number=Date.now,startSlot:(limit:number)=>number=randomInt){
 async function use<T>(signal:AbortSignal,task:(store:QuotaStore,operation:AbortSignal)=>Promise<T>):Promise<T>{
  const operation=AbortSignal.any([signal,AbortSignal.timeout(2000)]);
  try{const store=await waitQuota(factory(operation),operation);return await waitQuota(task(store,operation),operation);}catch{throw new QuotaError('unavailable');}
 }
 async function write(store:QuotaStore,key:string,content:string,signal:AbortSignal,collision=false){
  validateConversationTicket(key,content);signal.throwIfAborted();const written=await waitQuota(store.set(key,content,{onlyIfNew:true}),signal);
  if(written.modified===false&&collision)return false;
  if(written.modified!==true||!written.etag)throw new QuotaError('unavailable');
  const observed=await waitQuota(store.getWithMetadata(key),signal);signal.throwIfAborted();
  if(!observed||observed.etag!==written.etag||JSON.stringify(observed.data)!==content)throw new QuotaError('unavailable');return true;
 }
 async function reserve(kind:Ticket['kind'],signal:AbortSignal):Promise<Ticket>{
  if(!Number.isSafeInteger(window.startedAt)||!Number.isSafeInteger(window.until)||window.until<=window.startedAt||clock()<window.startedAt||clock()>=window.until||window.until>maximumPublicEvaluationEnd(window.startedAt))throw new QuotaError('unavailable');
  let exhausted=false;
  try{return await use(signal,async(store,operation)=>{
   const day=new Date(clock()).toISOString().slice(0,10),key='policy/'+day,content=JSON.stringify({version:'1',dailyCalls:window.dailyCalls,dailySessions:window.dailySessions});
   validateConversationTicket(key,content);await waitQuota(store.set(key,content,{onlyIfNew:true}),operation);
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
  async record(ticket:Ticket,outcome:ConversationOutcome,signal:AbortSignal){
   await use(signal,async(store,operation)=>{await write(store,'outcome/'+ticket.kind+'/'+ticket.day+'/'+ticket.reservationId,JSON.stringify(outcome),operation);});
  }
 });
}
export type ConversationQuota=ReturnType<typeof createConversationQuota>;
export type ConversationTicket=Awaited<ReturnType<ConversationQuota['reserveSession']>>;

/** Immutable, window-scoped operational stop. No historical tickets are changed. */
export function productionStopKey(window:ConversationWindow){return 'stop/'+createHash('sha256').update(JSON.stringify([window.startedAt,window.until])).digest('hex');}
export async function assertProductionRunning(factory:(signal:AbortSignal)=>Promise<QuotaStore>,window:ConversationWindow,signal:AbortSignal){const operation=AbortSignal.any([signal,AbortSignal.timeout(2000)]);try{const store=await waitQuota(factory(operation),operation);if(await waitQuota(store.getWithMetadata(productionStopKey(window)),operation))throw new QuotaError('unavailable');}catch{throw new QuotaError('unavailable');}}
