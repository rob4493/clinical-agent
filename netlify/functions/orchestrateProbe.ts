import {createHash} from 'node:crypto';
import Prompts from '../../shared/orchestratePrompts.json';
import {OrchestrateTarget} from '../evaluation/orchestrateTarget';
import {createOrchestrateTransport,type OrchestrateTurn} from '../evaluation/orchestrateTransport';
import {createWatsonRuntime,type Transport} from '../evaluation/watsonShadow';
import {createAdmission} from '../evaluation/demoAdmission';
import {QuotaError,type QuotaStore} from '../evaluation/demoQuota';
import {ownThread} from '../evaluation/threadOwner';
import {createReceipts} from '../evaluation/visitReceipt';
import {netlifyQuota} from '../../frontend/src/server/netlifyQuota';

type Settings=Record<string,string|undefined>;
type Context={user?:{id:string;expiresAt:Date};deploy?:{id:string;context:string;published:boolean}};
type Outcome='PASS'|'FAIL'|'NOT_TESTED';
type Reason='completed'|'disabled'|'operatorRequired'|'inputRejected'|'configuration'|'incorrectEndpoint'|'authenticationFailure'|'authorizationFailure'|'endpointOrAgentUnavailable'|'quotaRejected'|'quotaUnavailable'|'networkFailure'|'timeout'|'providerUnavailable'|'providerResponse'|'continuityFailure'|'internal';
const Origin='https://deploy-preview-4--clinicalagent.netlify.app';
const FunctionDeadline=28000,ResponseReserve=1000;
const StoreName='EndoOrchestrateProbeQuota';
export const config={rateLimit:{windowLimit:3,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
const json=(status:number,report:unknown)=>new Response(JSON.stringify(report),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'}});

function allowed(settings:Settings,now:number){
 const expiry=Date.parse(settings.ORCHESTRATE_PROBE_TEST_UNTIL||'');
 return settings.ORCHESTRATE_PROBE_ENABLED==='true'&&settings.ORCHESTRATE_PROBE_KILL_SWITCH==='false'&&settings.OTEL_SDK_DISABLED==='true'
  &&settings.ORCHESTRATE_EMBED_PREVIEW_ENABLED==='false'&&settings.ORCHESTRATE_EMBED_KILL_SWITCH==='true'
  &&['TOOLS','PRIVACY','USAGE','QUOTA'].every(name=>settings['ORCHESTRATE_PROBE_'+name+'_VERIFIED']==='true')
  &&Number.isFinite(expiry)&&expiry>now&&expiry-now<=1800000;
}
function dailyVisit(now:number){
 const hex=createHash('sha256').update('Endo:OrchestrateProbe:v1:'+new Date(now).toISOString().slice(0,10)).digest('hex');
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
}
async function fixedBody(request:Request,signal:AbortSignal){
 const reader=request.body?.getReader();if(!reader)return false;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>64)return false;chunks.push(chunk.value);}return /^\s*\{\s*"action"\s*:\s*"probe"\s*\}\s*$/.test(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
 finally{signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Operator-only fixed nonclinical probe. No browser session tokens, prompts or provider
 * text are accepted/returned. Separate immutable tickets cap all probes at two calls/day.
 */
export function createProbe(options:{settings?:()=>Settings;transport?:Transport;store?:(signal:AbortSignal)=>Promise<QuotaStore>;clock?:()=>number}={}){
 const settings=options.settings??(()=>process.env),clock=options.clock??Date.now;
 return async function orchestrateProbe(request:Request,context:Context={}):Promise<Response>{
  const report:{version:'1';status:'PASS'|'FAIL';authentication:Outcome;firstTurn:Outcome;secondTurn:Outcome;continuity:Outcome;reason:Reason}={version:'1',status:'FAIL',authentication:'NOT_TESTED',firstTurn:'NOT_TESTED',secondTurn:'NOT_TESTED',continuity:'NOT_TESTED',reason:'internal'};
  let reason:Reason|undefined;
  const deadline=AbortSignal.timeout(FunctionDeadline-ResponseReserve);
  const signal=AbortSignal.any([request.signal,deadline]);
  try{
   const environment=settings(),address=new URL(request.url),operator=context.user;
   if(!allowed(environment,clock())||address.origin!==Origin||environment.ORCHESTRATE_EMBED_PREVIEW_ID!=='4'||environment.ORCHESTRATE_EMBED_PREVIEW_ORIGIN!==Origin||context.deploy?.context!=='deploy-preview'||context.deploy.published!==false||typeof context.deploy.id!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(context.deploy.id))return json(404,{...report,reason:'disabled'});
   if(!operator||!environment.ORCHESTRATE_EMBED_OPERATOR_IDS?.split(',').includes(operator.id)||!(operator.expiresAt instanceof Date)||!Number.isFinite(operator.expiresAt.getTime())||operator.expiresAt.getTime()<=clock())return json(403,{...report,reason:'operatorRequired'});
   if(request.method!=='POST'||address.search||request.headers.get('origin')!==Origin||request.headers.get('content-type')!=='application/json'||request.headers.get('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin')return json(400,{...report,reason:'inputRejected'});
   if(!await fixedBody(request,signal))return json(400,{...report,reason:'inputRejected'});
   signal.throwIfAborted();
   // Private projections configure reused helpers only; no legacy/public flag is mutated.
   const providerEnvironment={...environment,ORCHESTRATE_ENABLED:'true'};
   try{new OrchestrateTarget(providerEnvironment);}catch{return json(200,{...report,reason:!environment.ORCHESTRATE_API_URL||!/^https:\/\/api\.(?:dl\.watson-orchestrate\.ibm\.com|us-south\.watson-orchestrate\.cloud\.ibm\.com)\/instances\/[A-Za-z0-9-]+$/.test(environment.ORCHESTRATE_API_URL)?'incorrectEndpoint':'configuration'});}
   const credential=environment.WATSONX_AI_APIKEY;
   if(!credential||credential.length>512||/\s|[\u0000-\u001f]/.test(credential))return json(200,{...report,reason:'configuration'});
   const gated=()=>{if(!allowed(settings(),clock())||operator.expiresAt.getTime()<=clock()){reason='disabled';throw new Error();}};
   const factory=options.store??((operation:AbortSignal)=>netlifyQuota(StoreName,operation));
   const policy=()=>{gated();return {ENDO_DEMO_INFERENCE_ENABLED:'true',ENDO_DEMO_KILL_SWITCH:'false',OTEL_SDK_DISABLED:'true',ENDO_DEMO_DAILY_LIMIT:'2'};};
   const admission=createAdmission(factory,policy),visitId=dailyVisit(clock());
   const receipts=createReceipts(credential,clock),policyHash=createHash('sha256').update(JSON.stringify(Prompts.connectionProbe)).digest('hex');
   let receipt=receipts.start(policyHash),ordinal=0;
   let activeSignal:AbortSignal|undefined;
   const http:Transport=async(address,init)=>{
    gated();signal.throwIfAborted();const iam=address==='https://iam.cloud.ibm.com/identity/token';
    activeSignal=init.signal??undefined;
    if(!iam)report.authentication='PASS';
    try{
     const response=await (options.transport??fetch)(address,init);
     if(!response.ok){reason=iam||response.status===401?'authenticationFailure':response.status===403?'authorizationFailure':response.status===404?'endpointOrAgentUnavailable':'providerUnavailable';if(reason==='authenticationFailure')report.authentication='FAIL';}
     return response;
    }catch{reason=init.signal?.aborted?'timeout':'networkFailure';throw new Error();}
   };
   const authentication=createWatsonRuntime(http,clock);
   let expected='';
   const provider=createOrchestrateTransport({
    authorize:async turn=>{gated();return JSON.stringify(turn)===expected;},
    reserve:async operation=>{
     try{await admission.run(visitId,ordinal,operation,async()=>undefined);}catch(failure){reason=reason??(failure instanceof QuotaError?(failure.category==='unavailable'?'quotaUnavailable':'quotaRejected'):'quotaUnavailable');throw failure;}
    }
   },http,providerEnvironment,authentication);
   for(const prompt of Prompts.connectionProbe){
    // Revalidate the operator/window before reading the next receipt or touching
    // ownership storage; an expired session cannot begin another provider turn.
    gated();signal.throwIfAborted();
    const visit=receipts.read(receipt),threadId=visit.threadId;
    if(visit.ordinal!==ordinal||visit.policyHash!==policyHash)throw new Error();
    if(threadId)await ownThread(factory,visit.visitId,threadId,signal);
    // Only the new question is sent on turn two: replaying the name would not prove memory.
    const turn:OrchestrateTurn={messages:[{role:'user',content:prompt.text}],...(threadId?{threadId}:{})};expected=JSON.stringify(turn);
    let reply:{text:string;threadId:string};
    try{reply=await provider.complete(turn,signal);}catch{if(!reason)reason=activeSignal?.aborted?'timeout':report.authentication==='NOT_TESTED'?'authenticationFailure':'providerResponse';if(reason==='authenticationFailure')report.authentication='FAIL';if(ordinal===0)report.firstTurn='FAIL';else report.secondTurn='FAIL';throw new Error();}
    await ownThread(factory,visit.visitId,reply.threadId,signal);
    if(reply.text!==(ordinal===0?'Blue Lantern acknowledged.':'Blue Lantern')){reason='continuityFailure';report.continuity='FAIL';if(ordinal===0)report.firstTurn='FAIL';else report.secondTurn='FAIL';throw new Error();}
    receipt=receipts.advance(visit,reply.threadId,prompt.id);
    if(ordinal===0)report.firstTurn='PASS';else report.secondTurn='PASS';ordinal++;
   }
   gated();signal.throwIfAborted();return json(200,{...report,status:'PASS',continuity:'PASS',reason:'completed'});
  }catch{
   if(request.signal.aborted)return new Response(null,{status:499});
   return json(200,{...report,reason:deadline.aborted?'timeout':reason??'internal'});
  }
 };
}
export default createProbe();
