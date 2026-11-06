import {randomInt,randomUUID} from 'node:crypto';

export class QuotaError extends Error {
 constructor(readonly category:'unavailable'|'exhausted'|'replayed'){super('Demo usage is unavailable. No IBM request was started.');}
}
export interface QuotaStore {
 set(key:string,content:string,options:{onlyIfNew:true}):Promise<{modified:boolean;etag?:string}>;
 getWithMetadata(key:string):Promise<{data:unknown;etag?:string}|null>;
}
export interface Reservation {visitorId:string;ordinal:number;dailyLimit:number}
const UuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Storage accepts operational tickets only, even if a caller is compromised. */
export function validateTicket(key:string,content?:string):void{
 if(!/^(?:policy\/\d{4}-\d{2}-\d{2}|daily\/\d{4}-\d{2}-\d{2}\/(?:0|[1-9]\d?)|visit\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\/[0-5]|thread\/[0-9a-f-]{36})$/.test(key))throw new QuotaError('unavailable');
 if(content!==undefined){
  try{if(content.length>128)throw new QuotaError('unavailable');const record=JSON.parse(content);
   if(key.startsWith('policy/')){if(!record||Object.keys(record).join('|')!=='dailyLimit'||!Number.isInteger(record.dailyLimit)||record.dailyLimit<1||record.dailyLimit>100)throw new QuotaError('unavailable');}
   else if(key.startsWith('thread/')){if(!record||Object.keys(record).join('|')!=='ownerId'||!UuidPattern.test(record.ownerId))throw new QuotaError('unavailable');}
   else if(!record||Object.keys(record).sort().join('|')!=='createdAt|reservationId'||!UuidPattern.test(record.reservationId)||!Number.isSafeInteger(record.createdAt)||record.createdAt<0)throw new QuotaError('unavailable');
  }catch{throw new QuotaError('unavailable');}
 }
}
export function waitQuota<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(new QuotaError('unavailable'));
  if(signal.aborted){void operation.catch(()=>{});abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}

/** Immutable capacity tickets, not a read/modify/write counter. Two-phase failure
 * can burn capacity; it can never refund or create extra model-call permission.
 */
export function createQuota(store:QuotaStore,clock:()=>number=Date.now,startSlot:(limit:number)=>number=randomInt,nonce:()=>string=randomUUID){
 async function claim(key:string,signal:AbortSignal):Promise<boolean>{
  const record={reservationId:nonce(),createdAt:clock()};
  try{
   signal.throwIfAborted();validateTicket(key,JSON.stringify(record));
   const written=await waitQuota(store.set(key,JSON.stringify(record),{onlyIfNew:true}),signal);
   if(written.modified===false)return false;
   // Do not trust success flags alone: prove the exact conditional record exists
   // on a strongly consistent read, including the returned ETag.
   if(written.modified!==true||typeof written.etag!=='string'||!written.etag)throw new QuotaError('unavailable');
   signal.throwIfAborted();const observed=await waitQuota(store.getWithMetadata(key),signal);
   if(!observed||observed.etag!==written.etag||!observed.data||typeof observed.data!=='object'||Array.isArray(observed.data))throw new QuotaError('unavailable');
   const saved=observed.data as Record<string,unknown>;
   if(Object.keys(saved).sort().join('|')!=='createdAt|reservationId'||saved.reservationId!==record.reservationId||saved.createdAt!==record.createdAt)throw new QuotaError('unavailable');
   return true;
  }catch(failure){if(failure instanceof QuotaError)throw failure;throw new QuotaError('unavailable');}
 }
 return Object.freeze({async reserve(request:Reservation,signal:AbortSignal):Promise<void>{
  signal.throwIfAborted();
  const {visitorId,ordinal,dailyLimit}=request;
  if(!UuidPattern.test(visitorId)||!Number.isInteger(ordinal)||ordinal<0||ordinal>5||!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100)throw new QuotaError('unavailable');
  const day=new Date(clock()).toISOString().slice(0,10),first=startSlot(dailyLimit);
  if(!Number.isInteger(first)||first<0||first>=dailyLimit)throw new QuotaError('unavailable');
  // The first deployment freezes today's capacity. Overlapping deployments may
  // not enlarge or reset it by changing configuration or naming a new namespace.
  try{
   const key='policy/'+day,content=JSON.stringify({dailyLimit});validateTicket(key,content);
   await waitQuota(store.set(key,content,{onlyIfNew:true}),signal);signal.throwIfAborted();
   const policy=await waitQuota(store.getWithMetadata(key),signal);
   if(!policy||typeof policy.etag!=='string'||!policy.etag||JSON.stringify(policy.data)!==content)throw new QuotaError('unavailable');
  }catch{throw new QuotaError('unavailable');}
  if(!await claim('visit/'+day+'/'+visitorId+'/'+ordinal,signal))throw new QuotaError('replayed');
  signal.throwIfAborted();
  for(let offset=0;offset<Math.min(dailyLimit,8);offset++){
   if(await claim('daily/'+day+'/'+((first+offset)%dailyLimit),signal)){signal.throwIfAborted();return;}
   signal.throwIfAborted();
  }
  // Collisions may reject early even with unused slots: availability never wins
  // over the configured global admission ceiling.
  throw new QuotaError('exhausted');
 }});
}
