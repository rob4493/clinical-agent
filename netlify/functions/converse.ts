import {createPublicConverse} from '../evaluation/publicConverse';
import type {DeployContext} from '../evaluation/productionAccess';
import {createAdmission} from '../evaluation/demoAdmission';
import {netlifyQuota} from '../../frontend/src/server/netlifyQuota';
import {createChat,chatFailure,ChatError} from '../evaluation/orchestrateChat';
import {InputError,parseJson} from '../evaluation/input';
import {ownThread} from '../evaluation/threadOwner';
import {createProtectedConversation,type OperatorContext} from '../evaluation/protectedConversation';
import {CompetitionStore} from '../evaluation/orchestrateCompetition';

// Platform IP controls complement immutable site-wide reservations. This rule must
// be confirmed in deployed processing logs; local mocks do not prove enforcement.
// Keep the internal rewrite target routable. Netlify disables the default URL
// with a custom path; the handler still rejects direct alternate-path requests.
export const config={path:['/api/v1/conversation','/.netlify/functions/converse'],rateLimit:{windowLimit:12,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
const Headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const store=(signal:AbortSignal)=>netlifyQuota('EndoConversationQuota',signal);
const admission=createAdmission(store);
const chat=createChat({admission,ownThread:(visitId,threadId,signal)=>ownThread(store,visitId,threadId,signal)});
const editable=createProtectedConversation({store:signal=>netlifyQuota(CompetitionStore,signal)});
function json(content:unknown,status=200){return new Response(JSON.stringify(content),{status,headers:Headers});}
async function readBody(request:Request,signal:AbortSignal){
 const reader=request.body?.getReader();if(!reader)throw new ChatError('inputRejected');const parts:Uint8Array[]=[];let size=0;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{for(;;){signal.throwIfAborted();const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>24576)throw new ChatError('inputRejected');parts.push(next.value);}const payload=parseJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));if(size>6144&&(!payload||typeof payload!=='object'||(payload as {version?:unknown}).version!=='2'))throw new ChatError('inputRejected');return payload;}catch(failure){signal.throwIfAborted();if(failure instanceof ChatError)throw failure;throw new ChatError('inputRejected');}
 finally{signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
/** Version 1 retains its legacy fixed-prompt contract. Version 2 accepts editable
 * synthetic discussion only through trusted Preview #4 operator authorization.
 * Neither version accepts caller-selected provider thread IDs or case objects.
 */
export function createConverse(service:Pick<ReturnType<typeof createChat>,'capability'|'handle'>=chat,protectedService=editable){return async function converse(request:Request,context:OperatorContext={}):Promise<Response>{
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(27000)]);
 try{
  signal.throwIfAborted();const address=new URL(request.url);if(address.search)throw new ChatError('inputRejected');
  if(request.method==='GET')return json(protectedService.capability(context).status==='available'&&address.origin==='https://deploy-preview-4--clinicalagent.netlify.app'?protectedService.capability(context):service.capability());
  if(request.method!=='POST')return json({code:'inputRejected',detail:'This operation is unavailable.'},405);
  if(request.headers.get('origin')!==address.origin||request.headers.has('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'||!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw new ChatError('inputRejected');
  const payload=await readBody(request,signal),version=payload&&typeof payload==='object'?(payload as {version?:unknown}).version:undefined;
  if(version==='2'&&address.origin!=='https://deploy-preview-4--clinicalagent.netlify.app')throw new ChatError('unavailable');
  const result=version==='2'?await protectedService.handle(payload,context,signal):await service.handle(payload,signal);signal.throwIfAborted();return json(result);
 }catch(failure){if(request.signal.aborted)return new Response(null,{status:499,headers:Headers});const safe=chatFailure(failure instanceof InputError?new ChatError('inputRejected'):failure);return json({version:'1',code:safe.code,...(safe.outputStage?{outputStage:safe.outputStage}:{}),...(safe.outputRejection?{outputRejection:safe.outputRejection}:{}),...(safe.responseRejection?{responseRejection:safe.responseRejection}:{}),detail:'Conversation is unavailable or the request was not permitted. The case is unchanged.'},safe.status);}
};}
const protectedHandler=createConverse(),publicHandler=createPublicConverse();
export default (request:Request,context:OperatorContext&DeployContext={})=>new URL(request.url).origin==='https://clinicalagent.netlify.app'?publicHandler(request,context):protectedHandler(request,context);
