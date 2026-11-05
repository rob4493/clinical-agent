import {parseJson} from '../../netlify/evaluation/input';
import Corpus from '../../evaluation/understanding/dialogue.json';
import {dialogueProjection,isTrustedTopics} from './agentSession';
import {ConversationActs,DisabledAgent,DialogueError,prepareChat,type DialogueInput,type LanguageAgent} from './dialogue';

type Transport=(url:string,request:RequestInit)=>Promise<Response>;
interface AgentConfig {authType:'iam';apiKey:string;projectId:string;endpoint:string;modelId:string;apiVersion:string;timeout:number}
const OfficialHosts=new Set(['us-south.ml.cloud.ibm.com','eu-de.ml.cloud.ibm.com','eu-gb.ml.cloud.ibm.com','jp-tok.ml.cloud.ibm.com','au-syd.ml.cloud.ibm.com','ca-tor.ml.cloud.ibm.com','ap-south-1.aws.wxai.ibm.com']);
const MockTransports=new WeakSet<Transport>();
/** A test seam, not a sandbox for untrusted JavaScript. Never install this as a runtime transport. */
export function mockTransport(callback:Transport):Transport {const transport:Transport=(url,request)=>callback(url,request);MockTransports.add(transport);return transport;}
export const WatsonAgent=DisabledAgent;
function record(payload:unknown):Record<string,any>{if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new DialogueError();return payload as Record<string,any>;}
function exact(payload:unknown,names:string[]){const result=record(payload);if(Object.keys(result).some(name=>!names.includes(name)))throw new DialogueError();return result;}
function bounded(content:unknown,limit:number):content is string{return typeof content==='string'&&content.trim().length>0&&content.length<=limit&&!/[\u0000-\u001f]/.test(content);}
/** Compatibility metadata is discarded; it cannot become dialogue or instructions. */
function metadata(payload:Record<string,any>){
 if(payload.created_at!==undefined&&(!bounded(payload.created_at,40)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(payload.created_at)||!Number.isFinite(Date.parse(payload.created_at))||new Date(payload.created_at.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==payload.created_at.slice(0,10)))throw new DialogueError();
 if(payload.model_version!==undefined&&(!bounded(payload.model_version,128)||!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(payload.model_version)))throw new DialogueError();
 if(payload.system!==undefined){const system=exact(payload.system,['warnings']);if(system.warnings!==undefined){if(!Array.isArray(system.warnings)||system.warnings.length>8)throw new DialogueError();for(const supplied of system.warnings){const warning=exact(supplied,['id','message','more_info']);if(!bounded(warning.message,2048)||warning.id!==undefined&&(!bounded(warning.id,128)||!/^[A-Za-z0-9._-]+$/.test(warning.id)))throw new DialogueError();if(warning.more_info!==undefined){if(!bounded(warning.more_info,2048))throw new DialogueError();const link=new URL(warning.more_info);if(!['https:','http:'].includes(link.protocol)||!link.hostname||link.username||link.password)throw new DialogueError();}}}}
 if(payload.id!==undefined&&!bounded(payload.id,256)||payload.object!==undefined&&payload.object!=='chat.completion'||payload.created!==undefined&&(!Number.isSafeInteger(payload.created)||payload.created<0))throw new DialogueError();
 if(payload.usage!==undefined){const usage=exact(payload.usage,['prompt_tokens','completion_tokens','total_tokens']);if(!['prompt_tokens','completion_tokens','total_tokens'].every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0)||usage.completion_tokens>1024||usage.total_tokens!==usage.prompt_tokens+usage.completion_tokens)throw new DialogueError();}
}
function wait<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{const abort=()=>reject(new DialogueError());if(signal.aborted){void operation.catch(()=>{});reject(new DialogueError());return;}signal.addEventListener('abort',abort,{once:true});operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
async function readJson(response:Response,signal:AbortSignal):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)throw new DialogueError();let size=0;const pieces:Uint8Array[]=[];
 try{if(response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw new DialogueError();
  for(;;){const chunk=await wait(reader.read(),signal);if(chunk.done)break;size+=chunk.value.length;if(size>32768)throw new DialogueError();pieces.push(chunk.value);}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(pieces));JSON.parse(text);return parseJson(text);
 }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
function assertSynthetic(input:DialogueInput){
 if(!isTrustedTopics(input.topics,input.projection.moduleId))throw new DialogueError();
 const fixtures=Corpus.turns.map(turn=>dialogueProjection(turn.id));
 if(!fixtures.some(fixture=>JSON.stringify(fixture)===JSON.stringify(input.projection))||input.history.length>12||input.history.some(turn=>turn.role==='user'?!fixtures.some(fixture=>fixture.moduleId===input.projection.moduleId&&fixture.turns.some(source=>source.text===turn.content)):turn.role!=='assistant'||!turn.content.split('\n\n').every(text=>ConversationActs.includes(text)||input.topics.some(topic=>topic.text===text))))throw new DialogueError();
}
/** Prepared IBM HTTP protocol, callable only with registered mocked transports and fixture projections.
 * There is deliberately no native-fetch default, environment enable flag, or deployed import.
 */
export function createOfflineWatsonAgent(transport:Transport,configuration:AgentConfig,clock:()=>number=Date.now):LanguageAgent {
 if(!MockTransports.has(transport))throw new DialogueError();
 const config={...configuration};let endpoint:URL;
 try{endpoint=new URL(config.endpoint);}catch{throw new DialogueError();}
 if(config.authType!=='iam'||!config.apiKey||config.apiKey.length>512||/[\s\u0000-\u001f]/.test(config.apiKey)||!config.projectId||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(config.projectId)||!config.modelId||!/^[A-Za-z0-9][A-Za-z0-9./_-]{0,199}$/.test(config.modelId)||!/^\d{4}-\d{2}-\d{2}$/.test(config.apiVersion)||!Number.isFinite(Date.parse(config.apiVersion))||new Date(config.apiVersion).toISOString().slice(0,10)!==config.apiVersion||endpoint.protocol!=='https:'||!OfficialHosts.has(endpoint.hostname)||endpoint.username||endpoint.password||endpoint.port||endpoint.search||endpoint.hash||endpoint.pathname!=='/'||!Number.isInteger(config.timeout)||config.timeout<100||config.timeout>12000)throw new DialogueError();
 let token:{text:string;expires:number}|null=null;
 let refresh:{controller:AbortController;promise:Promise<string>;waiters:number}|null=null;
 async function access(signal:AbortSignal):Promise<string>{
  if(token&&token.expires>clock())return token.text;
  if(!refresh){
   const controller=new AbortController(),active={controller,promise:Promise.resolve(''),waiters:0};refresh=active;
   active.promise=(async()=>{
    const response=await wait(transport('https://iam.cloud.ibm.com/identity/token',{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({grant_type:'urn:ibm:params:oauth:grant-type:apikey',apikey:config.apiKey}).toString(),signal:controller.signal}),controller.signal);
    const reply=record(await readJson(response,controller.signal));
    if(typeof reply.access_token!=='string'||!/^[A-Za-z0-9._~-]{1,8192}$/.test(reply.access_token)||typeof reply.token_type!=='string'||reply.token_type.toLowerCase()!=='bearer'||!Number.isInteger(reply.expires_in)||reply.expires_in<=60||reply.expires_in>86400)throw new DialogueError();
    controller.signal.throwIfAborted();token={text:reply.access_token,expires:clock()+(reply.expires_in-60)*1000};return token.text;
   })().finally(()=>{if(refresh===active)refresh=null;});
  }
  const active=refresh;active.waiters++;
  try{return await wait(active.promise,signal);}finally{active.waiters--;if(!active.waiters&&refresh===active)active.controller.abort();}
 }
 return Object.freeze({async respond(input:Readonly<DialogueInput>,signal:AbortSignal){
  assertSynthetic(input);signal.throwIfAborted();const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,config.timeout);signal.addEventListener('abort',abort,{once:true});
  try{
   const body=JSON.stringify(prepareChat(input,config.modelId,config.projectId));if(new TextEncoder().encode(body).length>32768)throw new DialogueError();
   const bearer=await access(controller.signal);controller.signal.throwIfAborted();
   const response=await wait(transport(endpoint.origin+'/ml/v1/text/chat?version='+config.apiVersion,{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json',Accept:'application/json'},body,signal:controller.signal}),controller.signal);
   const payload=exact(await readJson(response,controller.signal),['id','model_id','model','object','created','created_at','model_version','system','choices','usage']);metadata(payload);
   if(payload.model_id!==undefined&&payload.model_id!==config.modelId||payload.model!==undefined&&payload.model!==config.modelId||!Array.isArray(payload.choices)||payload.choices.length!==1)throw new DialogueError();
   const choice=exact(payload.choices[0],['index','finish_reason','message']),message=exact(choice.message,['role','content']);
   if(choice.index!==0||choice.finish_reason!=='stop'||message.role!=='assistant'||typeof message.content!=='string'||new TextEncoder().encode(message.content).length>16384)throw new DialogueError();
   JSON.parse(message.content);parseJson(message.content);controller.signal.throwIfAborted();return message.content;
  }catch{throw new DialogueError();}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
 }});
}
