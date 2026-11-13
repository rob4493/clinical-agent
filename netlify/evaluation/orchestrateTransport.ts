import {parseJson} from './input';
import {createWatsonRuntime,type Transport} from './watsonShadow';
import {OrchestrateError,readOrchestrateTarget,type OrchestrateEnvironment,type OrchestrateTarget} from './orchestrateTarget';

export interface OrchestrateTurn {messages:readonly {role:'user'|'assistant';content:string}[];threadId?:string}
export interface OrchestrateGate {
 authorize(turn:Readonly<OrchestrateTurn>,target:OrchestrateTarget):Promise<boolean>;
 reserve(signal:AbortSignal):Promise<void>;
}
const ClosedGate:OrchestrateGate={authorize:async()=>false,reserve:async()=>{throw new OrchestrateError();}};
const Uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function exact(content:unknown,names:string[],required=names):Record<string,unknown>{
 if(!content||typeof content!=='object'||Array.isArray(content)||Object.keys(content).some(name=>!names.includes(name))||required.some(name=>!Object.hasOwn(content,name)))throw new OrchestrateError();return content as Record<string,unknown>;
}
function bounded(text:unknown,limit:number):text is string{return typeof text==='string'&&text.length>0&&text.length<=limit&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);}
function wait<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{const abort=()=>reject(new OrchestrateError());if(signal.aborted){void operation.catch(()=>{});abort();return;}signal.addEventListener('abort',abort,{once:true});operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
async function readReply(response:Response,signal:AbortSignal){
 if(!response.ok||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){void response.body?.cancel().catch(()=>{});throw new OrchestrateError();}
 const reader=response.body?.getReader();if(!reader)throw new OrchestrateError();let size=0;const parts:Uint8Array[]=[];
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{for(;;){signal.throwIfAborted();const part=await wait(reader.read(),signal);if(part.done)break;size+=part.value.length;if(size>32768)throw new OrchestrateError();parts.push(part.value);}}
 finally{signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock();}
 const reply=exact(parseJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts))),['id','object','created','model','thread_id','choices','usage'],['choices','thread_id']);
 if(!Uuid.test(String(reply.thread_id))||reply.id!==undefined&&!bounded(reply.id,256)||reply.model!==undefined&&!bounded(reply.model,200)||reply.object!==undefined&&reply.object!=='chat.completion'||reply.created!==undefined&&(!Number.isSafeInteger(reply.created)||Number(reply.created)<0)||!Array.isArray(reply.choices)||reply.choices.length!==1)throw new OrchestrateError();
 const choice=exact(reply.choices[0],['index','finish_reason','message']),message=exact(choice.message,['role','content']);
 if(choice.index!==0||choice.finish_reason!=='stop'||message.role!=='assistant'||!bounded(message.content,16000))throw new OrchestrateError();
 if(reply.usage!==undefined){const usage=exact(reply.usage,['prompt_tokens','completion_tokens','total_tokens']);if(Object.values(usage).some(count=>!Number.isSafeInteger(count)||Number(count)<0)||Number(usage.total_tokens)!==Number(usage.prompt_tokens)+Number(usage.completion_tokens))throw new OrchestrateError();}
 return {text:message.content,threadId:String(reply.thread_id)};
}

/** Prepared Live-agent transport, not a public route or clinical output validator.
 * Only a trusted server projection/ownership policy plus quota admission can call
 * IBM. Returned text stays internal until Endo's separate grounding checks pass.
 */
export function createOrchestrateTransport(gate:OrchestrateGate=ClosedGate,transport:Transport=(address,options)=>fetch(address,options),environment:OrchestrateEnvironment=process.env,authentication?:Pick<ReturnType<typeof createWatsonRuntime>,'authenticate'>){
 const iam=authentication??createWatsonRuntime(transport);
 return Object.freeze({async complete(supplied:OrchestrateTurn,signal:AbortSignal){
  try{
   signal.throwIfAborted();const target=readOrchestrateTarget(environment);if(!target)throw new OrchestrateError();
   const fields=exact(supplied,['messages','threadId'],['messages']);
   if(fields.threadId!==undefined&&!Uuid.test(String(fields.threadId))||!Array.isArray(fields.messages)||!fields.messages.length||fields.messages.length>12)throw new OrchestrateError();
   const messages=fields.messages.map(suppliedMessage=>{const message=exact(suppliedMessage,['role','content']);if(!['user','assistant'].includes(String(message.role))||!bounded(message.content,1600))throw new OrchestrateError();return Object.freeze({role:message.role as 'user'|'assistant',content:message.content});});
   if(messages[0].role!=='user'||messages.at(-1)?.role!=='user')throw new OrchestrateError();
   const turn=Object.freeze({messages:Object.freeze(messages),...(fields.threadId?{threadId:String(fields.threadId)}:{})});
   if(new TextEncoder().encode(JSON.stringify(turn)).length>16384)throw new OrchestrateError();
   const operation=AbortSignal.any([signal,AbortSignal.timeout(target.timeout())]);
   if(!await wait(gate.authorize(turn,target),operation))throw new OrchestrateError();
   await wait(gate.reserve(operation),operation);operation.throwIfAborted();
   const bearer=await wait(iam.authenticate(environment,operation,target.timeout()),operation);operation.throwIfAborted();
   // This documented compatibility endpoint invokes the supplied deployed agent,
   // not a model ID. The server-owned continuation belongs in IBM's header,
   // never an undocumented body field or a browser-provided ownership assertion.
   const response=await wait(transport(target.apiBase()+'/v1/orchestrate/'+target.agentId()+'/chat/completions',{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+bearer,...(turn.threadId?{'X-IBM-THREAD-ID':turn.threadId}:{})},body:JSON.stringify({messages:turn.messages,stream:false}),signal:operation}),operation);
   const reply=await readReply(response,operation);operation.throwIfAborted();if(turn.threadId&&reply.threadId!==turn.threadId)throw new OrchestrateError();return reply;
  }catch{signal.throwIfAborted();throw new OrchestrateError();}
 }});
}
