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
export type ResponseRejection='httpNotSuccessful'|'contentType'|'bodyUnavailable'|'bodyReadFailed'|'bodyTooLarge'|'invalidUtf8'|'invalidJson'|'invalidShape'|'unexpectedFields'|'missingRequiredFields'|'invalidThreadId'|'invalidMetadata'|'invalidChoices'|'incompatibleMessageContent'|'finishReason'|'usageValidation'|'threadMismatch'|'actionResponse'|'providerRefusal'|'textTooLong'|'textInvalidCharacters';
/** Fixed codes only: never retain provider content, keys, headers or exception causes. */
export class OrchestrateResponseError extends OrchestrateError {
 constructor(readonly rejection:ResponseRejection,readonly httpSuccess:boolean){super();}
}
/** Pure protocol normalization, NOT clinical validation or evidence grounding.
 * Unknown JSON metadata is discarded, never rendered, replayed or executed.
 * Only explicit assistant text is returned to the caller's independent validator.
 */
export function parseOrchestrateResponse(payload:unknown):{text:string;threadId:string}{
 const reject=(code:ResponseRejection):never=>{throw new OrchestrateResponseError(code,true);};
 const assistantText=(value:unknown):string=>{
  if(typeof value!=='string'||!value.length)return reject('incompatibleMessageContent');
  if(value.length>16000)return reject('textTooLong');
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))return reject('textInvalidCharacters');
  return value;
 };
 const record=(value:unknown,required:string[]):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return reject('invalidShape');
  if(required.some(name=>!Object.hasOwn(value,name)))return reject('missingRequiredFields');
  return value as Record<string,unknown>;
 };
 // Presence of an action field is rejected even when null/empty. No dispatcher
 // exists here. This local rejection cannot prevent actions already run by IBM.
 const actionKeys=new Set(['toolcall','toolcalls','toolcallid','functioncall','functioncalls','function','functions','action','actions','externalaction','externalactions','workflow','workflows','delegation','delegations','delegate','delegates','delegatedagents','collaborator','collaborators','collaboratoragents','requiredaction','stepdetails','stephistory','command','commands','execute','invoke','invocation','invocations','handoff','handoffs']);
 const actionTypes=new Set(['toolcall','toolcalls','toolresponse','toolresult','functioncall','functioncalloutput','externalaction','workflow','workflowcall','delegation','agentcall','handoff','requiredaction']);
 const normalized=(key:string)=>key.replace(/[_-]/g,'').toLowerCase();
 let nodes=0;
 function scan(value:unknown,depth=0):void{
  if(depth>20||++nodes>4096)reject('invalidShape');
  if(Array.isArray(value)){for(const item of value)scan(item,depth+1);return;}
  if(value&&typeof value==='object'){
   for(const [key,item] of Object.entries(value)){
    const name=normalized(key);
    if(actionKeys.has(name)||(['type','eventtype','finishreason'].includes(name)&&typeof item==='string'&&actionTypes.has(normalized(item)))||(name==='role'&&['tool','function'].includes(String(item))))reject('actionResponse');
    scan(item,depth+1);
   }
  }
 }
 scan(payload);
 const reply=record(payload,['choices','thread_id']);
 if(typeof reply.thread_id!=='string'||!Uuid.test(reply.thread_id))return reject('invalidThreadId');
 if(reply.id!==undefined&&!bounded(reply.id,256)||reply.model!==undefined&&!bounded(reply.model,200)||reply.object!==undefined&&!bounded(reply.object,200)||reply.created!==undefined&&(!Number.isSafeInteger(reply.created)||Number(reply.created)<0))reject('invalidMetadata');
 if(!Array.isArray(reply.choices)||reply.choices.length!==1)return reject('invalidChoices');
 const choice=record(reply.choices[0],['index','finish_reason','message']),message=record(choice.message,['role']);
 if(choice.index!==0)reject('invalidChoices');
 if(message.role!=='assistant')reject('incompatibleMessageContent');
 if(message.refusal!==undefined&&message.refusal!==null){if(!bounded(message.refusal,16000))reject('incompatibleMessageContent');return reject('providerRefusal');}
 if(choice.finish_reason==='content_filter')return reject('providerRefusal');
 if(choice.finish_reason!=='stop')reject('finishReason');
 if(!Object.hasOwn(message,'content'))return reject('missingRequiredFields');
 let text:string;
 if(typeof message.content==='string')text=message.content;
 else if(Array.isArray(message.content)&&message.content.length>0&&message.content.length<=32){
  // Conservative text-only adapter; never stringify arbitrary objects or forms.
  // The cloud response schema does not enumerate content-part variants. These
  // explicit typed-text parts are locally supported, not tenant-verified.
  text=message.content.map(part=>{const block=record(part,[]);if(block.type==='refusal')return reject('providerRefusal');if(block.type!=='text'||!Object.hasOwn(block,'text'))return reject('incompatibleMessageContent');return assistantText(block.text);}).join('');
 }else return reject('incompatibleMessageContent');
 assistantText(text);
 if(reply.usage!==undefined){
  const value=reply.usage;
  if(!value||typeof value!=='object'||Array.isArray(value))return reject('usageValidation');
  const usage=value as Record<string,unknown>;
  if(['prompt_tokens','completion_tokens','total_tokens'].some(key=>!Object.hasOwn(usage,key)||!Number.isSafeInteger(usage[key])||Number(usage[key])<0)||Number(usage.total_tokens)!==Number(usage.prompt_tokens)+Number(usage.completion_tokens))reject('usageValidation');
 }
 return {text,threadId:reply.thread_id};
}
async function readReply(response:Response,signal:AbortSignal){
 const reject=(code:ResponseRejection):never=>{throw new OrchestrateResponseError(code,response.ok);};
 if(!response.ok||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){void response.body?.cancel().catch(()=>{});reject(!response.ok?'httpNotSuccessful':'contentType');}
 let reader:ReadableStreamDefaultReader<Uint8Array>;
 try{if(!response.body)return reject('bodyUnavailable');reader=response.body.getReader();}catch(error){if(error instanceof OrchestrateResponseError)throw error;return reject('bodyReadFailed');}
 let size=0;const parts:Uint8Array[]=[];
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{for(;;){signal.throwIfAborted();const part=await wait(reader.read(),signal);if(part.done)break;size+=part.value.length;if(size>32768)reject('bodyTooLarge');parts.push(part.value);}}
 catch(error){if(error instanceof OrchestrateResponseError)throw error;return reject('bodyReadFailed');}
 finally{signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock();}
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));}catch{return reject('invalidUtf8');}
 let parsed:unknown;try{parsed=parseJson(text);}catch{return reject('invalidJson');}
 return parseOrchestrateResponse(parsed);
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
   const reply=await readReply(response,operation);operation.throwIfAborted();if(turn.threadId&&reply.threadId!==turn.threadId)throw new OrchestrateResponseError('threadMismatch',true);return reply;
  }catch(error){signal.throwIfAborted();if(error instanceof OrchestrateResponseError)throw error;throw new OrchestrateError();}
 }});
}
