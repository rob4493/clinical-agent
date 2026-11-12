import {randomUUID} from 'node:crypto';
import {createQuota,QuotaError,type QuotaStore} from '../evaluation/demoQuota';
import {netlifyQuota} from '../../frontend/src/server/netlifyQuota';

type Settings=Record<string,string|undefined>;
type OperatorContext={user?:{id:string;expiresAt:Date};deploy?:{id:string;context:string;published:boolean}};
const PreviewOrigin='https://deploy-preview-4--clinicalagent.netlify.app';
const WorkerId=randomUUID();
const RunPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ClosedFlags=['ORCHESTRATE_ENABLED','ORCHESTRATE_SYNTHETIC_AUTHORIZED','ORCHESTRATE_DISCUSSION_AUTHORIZED','ORCHESTRATE_HOSTED_CONTROLS_VERIFIED','ENDO_DEMO_INFERENCE_ENABLED','WATSONX_ENABLED','WATSONX_CONFLICT_ASSIST_ENABLED','WATSONX_GUIDED_FOLLOWUP_ENABLED'];
function closed(settings:Settings){return settings.QUOTA_VERIFICATION_ENABLED==='true'&&settings.ENDO_DEMO_KILL_SWITCH==='true'&&settings.OTEL_SDK_DISABLED==='true'&&settings.WATSONX_CONVERSATION_MODE==='disabled'&&ClosedFlags.every(flag=>settings[flag]==='false');}
// CONTEXT is build metadata, not a guaranteed Functions environment variable.
// Only platform deployment metadata and the exact request origin select this preview.
function previewAllowed(request:Request,context:OperatorContext){
 return new URL(request.url).origin===PreviewOrigin&&context?.deploy?.context==='deploy-preview'&&context.deploy.published===false
  &&typeof context.deploy.id==='string'&&/^[A-Za-z0-9-]{1,128}$/.test(context.deploy.id);
}
function json(payload:unknown,status=200){return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Quota-Verification':'application','X-Content-Type-Options':'nosniff'}});}

/** Operator-only storage test. No IBM imports, credential access, clinical inputs,
 * production store selection, deletion, reset or inference permission exists here.
 * Platform-verified context.user is required even on the direct Function URL.
 */
export function createVerification(settings:()=>Settings=()=>process.env,factory:(name:string,signal:AbortSignal)=>Promise<QuotaStore>=(name,signal)=>netlifyQuota(name,signal),workerId:string=WorkerId){
 return async function verifyQuota(request:Request,context:OperatorContext={}):Promise<Response>{
  const environment=settings(),operator=context?.user;
  if(!previewAllowed(request,context)||!closed(environment))return json({code:'disabled'},404);
  const allowed=(environment.QUOTA_VERIFICATION_OPERATOR_IDS||'').split(',').filter(Boolean);
  if(!operator||!allowed.includes(operator.id)||!(operator.expiresAt instanceof Date)||!Number.isFinite(operator.expiresAt.getTime())||operator.expiresAt.getTime()<=Date.now())return json({code:'operatorRequired'},403);
  const address=new URL(request.url);
  if(request.method==='GET'&&!address.search)return json({version:'1',status:'operatorReady',ibm:'disabled'});
  if(request.method!=='POST'||address.search||request.headers.get('origin')!==address.origin||request.headers.get('content-type')!=='application/json')return json({code:'inputRejected'},400);
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(10000)]);
  try{
   // Bound streamed input, including requests with a missing/false Content-Length.
   const reader=request.body?.getReader();if(!reader)return json({code:'inputRejected'},400);
   let body='';let size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
   const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
   try{for(;;){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>256)throw new Error();body+=decoder.decode(part.value,{stream:true});}body+=decoder.decode();}
   finally{signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock();}
   let payload;try{payload=JSON.parse(body);}catch{return json({code:'inputRejected'},400);}
   if(!payload||typeof payload!=='object'||Array.isArray(payload))return json({code:'inputRejected'},400);
   const keys=Object.keys(payload).sort().join('|');
   const start=payload.action==='start'&&keys==='action';
   if(!start&&(payload.action!=='reserve'||keys!=='action|runId'||typeof payload.runId!=='string'||!RunPattern.test(payload.runId)))return json({code:'inputRejected'},400);
   const runId=start?randomUUID():payload.runId as string;
   // Only this fixed test prefix and a strict UUID can reach the SDK. Neither a
   // caller nor environment configuration can select EndoConversationQuota.
   const name='EndoQuotaVerify'+runId.replaceAll('-','');
   if(!previewAllowed(request,context)||!closed(settings()))return json({code:'disabled'},404);
   const store=await factory(name,signal),key='thread/'+runId;
   if(start){
    const written=await store.set(key,JSON.stringify({ownerId:runId}),{onlyIfNew:true});
    const observed=await store.getWithMetadata(key);
    if(!written.modified||!written.etag||observed?.etag!==written.etag||JSON.stringify(observed.data)!==JSON.stringify({ownerId:runId}))throw new Error();
    return json({version:'1',runId,status:'freshStoreCreated',limit:3});
   }
   const marker=await store.getWithMetadata(key);
   if(!marker?.etag||JSON.stringify(marker.data)!==JSON.stringify({ownerId:runId}))return json({code:'unknownRun'},400);
   if(!previewAllowed(request,context)||!closed(settings()))return json({code:'disabled'},404);
   try{await createQuota(store).reserve({visitorId:randomUUID(),ordinal:0,dailyLimit:3},signal);return json({outcome:'admitted',workerId});}
   catch(failure){if(failure instanceof QuotaError&&failure.category==='exhausted')return json({outcome:'exhausted',workerId},429);throw failure;}
  }catch{return json({code:'verificationFailed'},503);}
 };
}
export default createVerification();
