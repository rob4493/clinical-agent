import type {Store} from '@netlify/blobs';
import {QuotaError,validateTicket,waitQuota,type QuotaStore} from '../../../netlify/evaluation/demoQuota';

export type QuotaInitialization='sdkImportFailed'|'automaticConfigurationUnavailable'|'adapterRejected'|'initializationReady'|'initializationUnknown';
type SdkLoader=()=>Promise<Pick<typeof import('@netlify/blobs'),'getStore'>>;
const loadSdk:SdkLoader=()=>import('@netlify/blobs');
class InitializationFailure extends QuotaError {
 constructor(readonly classification:Exclude<QuotaInitialization,'initializationReady'>){super('unavailable');}
}

/** Shared construction path: the pinned SDK only constructs a client here.
 * It does not authenticate remotely, create a store or execute a storage method.
 */
async function initializeStore(name:string,signal:AbortSignal,environment:Record<string,string|undefined>,transport:typeof fetch,load:SdkLoader=loadSdk):Promise<Store>{
 if(environment.OTEL_SDK_DISABLED!=='true'||!/^Endo[A-Za-z0-9]{1,48}$/.test(name))throw new InitializationFailure('adapterRejected');
 if(signal.aborted)throw new InitializationFailure('initializationUnknown');
 let sdk:Awaited<ReturnType<SdkLoader>>;
 try{sdk=await waitQuota(load(),signal);}catch{throw new InitializationFailure(signal.aborted?'initializationUnknown':'sdkImportFailed');}
 if(signal.aborted)throw new InitializationFailure('initializationUnknown');
 try{
  const store=sdk.getStore({name,consistency:'strong',fetch:transport});
  if(!store||typeof store.set!=='function'||typeof store.getWithMetadata!=='function')throw new QuotaError('unavailable');
  return store;
 }
 catch(error){
  // The private SDK error is not exported. Classify only its exact error name
  // from this synchronous getStore call, never message text or import failures.
  throw new InitializationFailure(error instanceof Error&&error.name==='MissingBlobsEnvironmentError'?'automaticConfigurationUnavailable':'initializationUnknown');
 }
}

/** No store escapes this inspection, and no network-capable transport is supplied. */
export function createQuotaInitializationInspector(load:SdkLoader=loadSdk){
 return async function inspect(name:string,signal:AbortSignal,environment:Record<string,string|undefined>=process.env):Promise<QuotaInitialization>{
  let transportAttempted=false;
  const denyNetwork:typeof fetch=async()=>{transportAttempted=true;throw new QuotaError('unavailable');};
  try{
   await initializeStore(name,signal,environment,denyNetwork,load);
   return signal.aborted||transportAttempted?'initializationUnknown':'initializationReady';
  }catch(error){return transportAttempted?'initializationUnknown':error instanceof InitializationFailure?error.classification:'initializationUnknown';}
 };
}
export const inspectQuotaInitialization=createQuotaInitializationInspector();

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
  const store=await initializeStore(name,signal,environment,boundedFetch);
  return Object.freeze({
   async set(key:string,content:string){signal.throwIfAborted();validateTicket(key,content);try{return await store.set(key,content,{onlyIfNew:true,span:NoopSpan});}catch{throw new QuotaError('unavailable');}},
   async getWithMetadata(key:string){signal.throwIfAborted();validateTicket(key);try{return await store.getWithMetadata(key,{type:'json',consistency:'strong',span:NoopSpan});}catch{throw new QuotaError('unavailable');}}
  });
 }catch{throw new QuotaError('unavailable');}
}
