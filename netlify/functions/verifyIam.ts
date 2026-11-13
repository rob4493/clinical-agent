import {classifyIamFailure,createWatsonRuntime,type Transport} from '../evaluation/watsonShadow';

type Settings=Record<string,string|undefined>;
type Context={user?:{id:string;expiresAt:Date};deploy?:{id:string;context:string;published:boolean}};
const Origin='https://deploy-preview-4--clinicalagent.netlify.app';
const IamUrl='https://iam.cloud.ibm.com/identity/token';
const FunctionDeadline=4000,OperationBudget=2000,WindowLimit=600000;
const ClosedFlags=['ORCHESTRATE_ENABLED','ORCHESTRATE_SYNTHETIC_AUTHORIZED','ORCHESTRATE_DISCUSSION_AUTHORIZED','ORCHESTRATE_HOSTED_CONTROLS_VERIFIED','ENDO_DEMO_INFERENCE_ENABLED','WATSONX_ENABLED','WATSONX_CONFLICT_ASSIST_ENABLED','WATSONX_GUIDED_FOLLOWUP_ENABLED'];
export const config={rateLimit:{windowLimit:2,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
type Reason='disabled'|'operatorRequired'|'operatorReady'|'inputRejected'|'configuration'|'iamAccepted'|'iamRejected'|'iamHttp400'|'iamHttp401'|'iamHttp403'|'iamHttp429'|'iamHttp5xx'|'iamResponseInvalid'|'iamTimeout'|'networkFailure'|'internal';
class NetworkFailure extends Error{}
function result(http:number,status:'PASS'|'FAIL'|'READY'|'DISABLED',reason:Reason){return new Response(JSON.stringify({version:'1',status,reason}),{status:http,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'}});}
function permitted(e:Settings,context:Context,url:string,now:number){
 const expiry=Date.parse(e.ORCHESTRATE_IAM_DIAGNOSTIC_UNTIL||'');const d=context.deploy;
 return e.ORCHESTRATE_IAM_DIAGNOSTIC_ENABLED==='true'&&e.ORCHESTRATE_IAM_DIAGNOSTIC_KILL_SWITCH==='false'&&Number.isFinite(expiry)&&expiry>now&&expiry-now<=WindowLimit
 &&e.ORCHESTRATE_EMBED_PREVIEW_ID==='4'&&e.ORCHESTRATE_EMBED_PREVIEW_ORIGIN===Origin&&new URL(url).origin===Origin
 &&d?.context==='deploy-preview'&&d.published===false&&typeof d.id==='string'&&/^[A-Za-z0-9-]{1,128}$/.test(d.id)
 &&e.ORCHESTRATE_EMBED_PREVIEW_ENABLED==='false'&&e.ORCHESTRATE_EMBED_KILL_SWITCH==='true'&&e.OTEL_SDK_DISABLED==='true'
 &&e.ENDO_DEMO_KILL_SWITCH==='true'&&e.WATSONX_CONVERSATION_MODE==='disabled'&&ClosedFlags.every(k=>e[k]==='false')
 &&[undefined,'false'].includes(e.ORCHESTRATE_PROBE_ENABLED)&&[undefined,'true'].includes(e.ORCHESTRATE_PROBE_KILL_SWITCH)
 &&(!e.ORCHESTRATE_PROBE_TEST_UNTIL||Number.isFinite(Date.parse(e.ORCHESTRATE_PROBE_TEST_UNTIL))&&Date.parse(e.ORCHESTRATE_PROBE_TEST_UNTIL)<=now)
 &&[undefined,'false'].includes(e.ORCHESTRATE_EDITABLE_AUTHORIZED)&&[undefined,'false'].includes(e.QUOTA_VERIFICATION_ENABLED);
}
function operator(e:Settings,context:Context,now:number){const ids=e.ORCHESTRATE_EMBED_OPERATOR_IDS?.split(','),u=context.user;return !!ids?.length&&ids.length<=100&&ids.every(id=>/^[A-Za-z0-9-]{1,128}$/.test(id))&&!!u&&typeof u.id==='string'&&ids.includes(u.id)&&u.expiresAt instanceof Date&&Number.isFinite(u.expiresAt.getTime())&&u.expiresAt.getTime()>now;}
async function fixedBody(request:Request,signal:AbortSignal){const reader=request.body?.getReader();if(!reader)return false;let size=0;const chunks:Uint8Array[]=[];const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});try{for(;;){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>64)return false;chunks.push(part.value);}return /^\s*\{\s*"action"\s*:\s*"verify"\s*\}\s*$/.test(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}finally{signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock();}}
/** Prepared only. GET performs no credential access or network. Approved POST may
 * exchange a token once, but cannot contact Orchestrate, models, tools or storage. */
export function createIamVerification(options:{settings?:()=>Settings;transport?:Transport;clock?:()=>number}={}){
 const settings=options.settings??(()=>process.env),clock=options.clock??Date.now;
 return async function verifyIam(request:Request,context:Context={}):Promise<Response>{
  const deadline=AbortSignal.timeout(FunctionDeadline),signal=AbortSignal.any([request.signal,deadline]);let activeIamSignal:AbortSignal|undefined;let iamRejection:Reason|undefined;
  try{
   if(request.signal.aborted)return new Response(null,{status:499});
   const e=settings(),address=new URL(request.url);
   if(!permitted(e,context,request.url,clock()))return result(404,'DISABLED','disabled');
   if(!operator(e,context,clock()))return result(403,'FAIL','operatorRequired');
   const recheck=()=>{signal.throwIfAborted();const fresh=settings();if(!permitted(fresh,context,request.url,clock())||!operator(fresh,context,clock()))throw new Error();};
   if(address.search||request.headers.has('origin')&&request.headers.get('origin')!==Origin||request.headers.has('sec-fetch-site')&&!['same-origin','none'].includes(request.headers.get('sec-fetch-site')!))return result(400,'FAIL','inputRejected');
   if(request.method==='GET')return result(200,'READY','operatorReady');
   if(request.method!=='POST'||request.headers.get('origin')!==Origin||request.headers.get('content-type')!=='application/json'||!await fixedBody(request,signal))return result(400,'FAIL','inputRejected');
   recheck();let calls=0;
   const transport:Transport=async(url,init)=>{
    recheck();if(url!==IamUrl||init.method!=='POST'||init.redirect!=='error'||init.credentials!=='omit'||init.cache!=='no-store'||calls!==0)throw new Error();calls++;activeIamSignal=init.signal??undefined;
    let response:Response;
    try{response=await (options.transport??fetch)(url,init);}catch{if(activeIamSignal?.aborted)throw new Error();throw new NetworkFailure();}
    // Preserve only an allowlisted status category. The existing broker cancels
    // rejected bodies; no provider body, header or credential data is inspected.
    if(response.status!==200)iamRejection=response.status===400?'iamHttp400':response.status===401?'iamHttp401':response.status===403?'iamHttp403':response.status===429?'iamHttp429':response.status>=500&&response.status<=599?'iamHttp5xx':'iamRejected';
    return response;
   };
   // Fresh per invocation: success cannot come from a previously cached token.
   // The returned token is discarded and the broker is never kept globally.
   await createWatsonRuntime(transport,clock).authenticate(e,signal,OperationBudget);
   recheck();return result(200,'PASS','iamAccepted');
  }catch(error){
   if(request.signal.aborted)return new Response(null,{status:499});
   try{if(!permitted(settings(),context,request.url,clock()))return result(404,'DISABLED','disabled');if(!operator(settings(),context,clock()))return result(403,'FAIL','operatorRequired');}catch{return result(503,'FAIL','internal');}
   // A request failure before token transport is not evidence of an IAM timeout.
   const brokerReason=classifyIamFailure(error);
   const reason:Reason=activeIamSignal?.aborted||deadline.aborted&&!!activeIamSignal?'iamTimeout':error instanceof NetworkFailure?'networkFailure':brokerReason==='iamRejected'?iamRejection??'iamRejected':brokerReason;
   return result(200,'FAIL',reason);
  }
 };
}
export default createIamVerification();
