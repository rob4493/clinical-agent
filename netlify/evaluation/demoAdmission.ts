import {createQuota,QuotaError,waitQuota,type QuotaStore} from './demoQuota';

const StorageDeadline=1500;
/** Future anonymous route must call this gate before each individual inference.
 * It does not authorize clinical transmission and is not wired into a public route.
 */
export function createAdmission(storeFactory:(signal:AbortSignal)=>Promise<QuotaStore>,environment:()=>Record<string,string|undefined>=()=>process.env){
 function policy(){
  const settings=environment();
  if(settings.ENDO_DEMO_INFERENCE_ENABLED!=='true'||settings.ENDO_DEMO_KILL_SWITCH!=='false'||settings.OTEL_SDK_DISABLED!=='true'||!settings.ENDO_DEMO_DAILY_LIMIT||!/^(?:[1-9]|[1-9]\d|100)$/.test(settings.ENDO_DEMO_DAILY_LIMIT))throw new QuotaError('unavailable');
  return Number(settings.ENDO_DEMO_DAILY_LIMIT);
 }
 return Object.freeze({async run<T>(visitorId:string,ordinal:number,signal:AbortSignal,infer:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const dailyLimit=policy(),abort=new AbortController(),cancel=()=>abort.abort(),timer=setTimeout(cancel,StorageDeadline);
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  try{
   // The factory must bind the same storage signal to its injected HTTP fetch.
   // Factory initialization is lazy and never occurs when policy is disabled.
   const store=await waitQuota(storeFactory(abort.signal),abort.signal);abort.signal.throwIfAborted();
   await createQuota(store).reserve({visitorId,ordinal,dailyLimit},abort.signal);
  }
  finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
  // Kill switch is checked again after asynchronous storage. Consumed tickets
  // are never refunded, including failures or cancellation before inference.
  signal.throwIfAborted();if(policy()!==dailyLimit)throw new QuotaError('unavailable');
  return infer(signal);
 }});
}
