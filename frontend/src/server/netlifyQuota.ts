import type {Store} from '@netlify/blobs';
import {QuotaError,validateTicket,type QuotaStore} from '../../../netlify/evaluation/demoQuota';

// The pinned SDK only uses setAttributes on this supported span option. Supplying
// a non-recording span bypasses its global-tracer lookup; bootstrap is never loaded.
type StorageSpan=NonNullable<NonNullable<Parameters<Store['set']>[2]>['span']>;
const NoopSpan:StorageSpan={
 spanContext:()=>({traceId:'00000000000000000000000000000000',spanId:'0000000000000000',traceFlags:0}),
 setAttribute(){return this;},setAttributes(){return this;},addEvent(){return this;},addLink(){return this;},addLinks(){return this;},
 setStatus(){return this;},updateName(){return this;},end(){},isRecording:()=>false,recordException(){}
};

/** Lazy, server-only operational storage. No case, message, prompt or model output
 * is accepted by this adapter. Do not import it from browser components.
 */
export async function netlifyQuota(name:string,signal:AbortSignal,environment:Record<string,string|undefined>=process.env,transport:typeof fetch=fetch):Promise<QuotaStore>{
 if(environment.OTEL_SDK_DISABLED!=='true'||!/^Endo[A-Za-z0-9]{1,48}$/.test(name))throw new QuotaError('unavailable');
 const boundedFetch:typeof fetch=async(address,options)=>{
  // Supported SDK injection avoids its internal retry loop. Ambiguous storage
  // failures burn no model permission and never surface response bodies.
  if(signal.aborted)return new Response(null,{status:499});
  try{
   const response=await transport(address,{...options,redirect:'error',credentials:'omit',cache:'no-store',signal});
   if(response.status>=500||[401,403,429].includes(response.status)){void response.body?.cancel().catch(()=>{});return new Response(null,{status:499});}
   return response;
  }catch{return new Response(null,{status:499});}
 };
 try{
  const {getStore}=await import('@netlify/blobs');
  signal.throwIfAborted();const store=getStore({name,consistency:'strong',fetch:boundedFetch});
  return Object.freeze({
   async set(key:string,content:string){signal.throwIfAborted();validateTicket(key,content);try{return await store.set(key,content,{onlyIfNew:true,span:NoopSpan});}catch{throw new QuotaError('unavailable');}},
   async getWithMetadata(key:string){signal.throwIfAborted();validateTicket(key);try{return await store.getWithMetadata(key,{type:'json',consistency:'strong',span:NoopSpan});}catch{throw new QuotaError('unavailable');}}
  });
 }catch{throw new QuotaError('unavailable');}
}
