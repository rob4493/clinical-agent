import {createAdmission} from '../evaluation/demoAdmission';
import {netlifyQuota} from '../../frontend/src/server/netlifyQuota';
import {createChat,chatFailure,ChatError} from '../evaluation/orchestrateChat';
import {parseJson} from '../evaluation/input';
import {ownThread} from '../evaluation/threadOwner';

// Platform IP controls complement immutable site-wide reservations. This rule must
// be confirmed in deployed processing logs; local mocks do not prove enforcement.
export const config={rateLimit:{windowLimit:12,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
const Headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const store=(signal:AbortSignal)=>netlifyQuota('EndoConversationQuota',signal);
const admission=createAdmission(store);
const chat=createChat({admission,ownThread:(visitId,threadId,signal)=>ownThread(store,visitId,threadId,signal)});
function json(content:unknown,status=200){return new Response(JSON.stringify(content),{status,headers:Headers});}
async function readBody(request:Request,signal:AbortSignal){
 const reader=request.body?.getReader();if(!reader)throw new ChatError('inputRejected');const parts:Uint8Array[]=[];let size=0;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{for(;;){signal.throwIfAborted();const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>6144)throw new ChatError('inputRejected');parts.push(next.value);}return parseJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch(failure){signal.throwIfAborted();if(failure instanceof ChatError)throw failure;throw new ChatError('inputRejected');}
 finally{signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
/** Same-origin anonymous synthetic chat only. No case object, raw message or
 * caller-selected thread ID is part of this endpoint's request contract.
 */
export function createConverse(service:Pick<ReturnType<typeof createChat>,'capability'|'handle'>=chat){return async function converse(request:Request):Promise<Response>{
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(15000)]);
 try{
  signal.throwIfAborted();const address=new URL(request.url);if(address.search)throw new ChatError('inputRejected');
  if(request.method==='GET')return json(service.capability());
  if(request.method!=='POST')return json({code:'inputRejected',detail:'This operation is unavailable.'},405);
  if(request.headers.get('origin')!==address.origin||request.headers.has('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'||!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw new ChatError('inputRejected');
  const result=await service.handle(await readBody(request,signal),signal);signal.throwIfAborted();return json(result);
 }catch(failure){if(request.signal.aborted)return new Response(null,{status:499,headers:Headers});const safe=chatFailure(failure);return json({version:'1',code:safe.code,detail:'Conversation is unavailable or the request was not permitted. The case is unchanged.'},safe.status);}
};}
export default createConverse();
