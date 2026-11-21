import {netlifyQuota} from '../../frontend/src/server/netlifyQuota';
import {ConversationStore} from './conversationQuota';
import {createProductionConversation} from './productionConversation';
import {createVisitorAccess,isProductionRequest,productionWindow,ProductionOrigin,type DeployContext} from './productionAccess';
import {chatFailure,ChatError} from './discussionSafety';
import {InputError,parseJson} from './input';
import type {OrchestrateEnvironment} from './orchestrateTarget';

// Platform rule complements immutable site-wide daily and per-conversation limits.
// Declarative configuration is not proof of observed hosted rate enforcement.
export const config={path:['/api/v1/conversation','/.netlify/functions/converse'],rateLimit:{windowLimit:12,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
const Headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function json(value:unknown,status=200,cookie?:string){return new Response(JSON.stringify(value),{status,headers:{...Headers,...(cookie?{'Set-Cookie':cookie}:{})}});}
async function body(request:Request,signal:AbortSignal){
 const reader=request.body?.getReader();if(!reader)throw new ChatError('inputRejected');let size=0;const parts:Uint8Array[]=[];
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{for(;;){signal.throwIfAborted();const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>24576)throw new ChatError('inputRejected');parts.push(next.value);}return parseJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}
 finally{signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function createPublicConverse(options:{environment?:OrchestrateEnvironment;clock?:()=>number;service?:ReturnType<typeof createProductionConversation>}={}){
 const env=options.environment??process.env,clock=options.clock??Date.now,service=options.service??createProductionConversation({environment:env,clock,store:signal=>netlifyQuota(ConversationStore,signal)});
 return async(request:Request,context:DeployContext={}):Promise<Response>=>{
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(27000)]);
  try{
   const enabled=isProductionRequest(request,context)&&!!productionWindow(env,clock());
   // No cookie writes, reservations, IAM or provider activity on capability GET.
   // A bounded strong read checks the immediate operational stop marker.
   if(request.method==='GET')return json({version:'2',status:enabled&&await service.available(signal)?'available':'blocked',mode:'anonymousSyntheticDiscussion',accessCodeRequired:false});
   if(!enabled)return json({version:'2',code:'disabled'},404);
   if(request.method!=='POST')return json({version:'2',code:'inputRejected'},405);
   if(request.headers.get('origin')!==ProductionOrigin||request.headers.has('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'||!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw new ChatError('inputRejected');
   const payload=await body(request,signal);if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new ChatError('inputRejected');
   const input=payload as Record<string,unknown>,access=createVisitorAccess(env,clock,context.ip);let visitor=access.read(request.headers.get('cookie')),cookie:string|undefined;
   if(input.action==='start'){
    if(Object.keys(input).sort().join('|')!=='action|syntheticOnly|version')throw new ChatError('inputRejected');
    if(!visitor){const issued=access.issue();if(!issued)return json({version:'2',code:'unavailable'},503);visitor=issued.visitor;cookie=issued.cookie;}
    // Only server-issued cookie identity reaches the conversation service.
    const result=await service.handle({version:input.version,action:'start',syntheticOnly:input.syntheticOnly},visitor,signal);signal.throwIfAborted();return json(result,200,cookie);
   }
   if(!visitor)return json({version:'2',code:'invalidSession'},403);
   const result=await service.handle(input,visitor,signal);signal.throwIfAborted();return json(result);
  }catch(error){if(request.signal.aborted)return new Response(null,{status:499,headers:Headers});const safe=chatFailure(error instanceof InputError?new ChatError('inputRejected'):error);return json({version:'2',code:safe.code,...('outputRejection' in safe&&safe.outputRejection?{outputRejection:safe.outputRejection}:{}),...('responseRejection' in safe&&safe.responseRejection?{responseRejection:safe.responseRejection}:{}),detail:'Conversation unavailable or request not permitted. Your structured case is unchanged.'},safe.status);}
 };
}
export default createPublicConverse();
