import {randomUUID} from 'node:crypto';
import type {Store} from '@netlify/blobs';
import {createWatsonRuntime,type Transport} from '../evaluation/watsonShadow';
import {waitQuota} from '../evaluation/demoQuota';

// Netlify does not expose scheduled functions through a public URL. January 1
// is deliberately outside the administrative window; Run now is the test path.
export const config={schedule:'0 0 1 1 *'};
export const Ledger='EndoProductionIamOnceV1',Ticket='one-authorized-exchange';
type Settings=Record<string,string|undefined>;
type Context={site?:{id:string};deploy?:{id:string;context:string;published:boolean}};
type RecordStore={set:(key:string,value:string)=>Promise<{modified:boolean}>;read:(key:string)=>Promise<unknown>};
type Report={status:'PASS'|'FAIL';iamHttp:number|null;errorCode:string|null;runtimeConfigurationAccessed:boolean};
const Site='b1f36feb-3225-4a27-9dff-de780d166161';
const Iam='https://iam.cloud.ibm.com/identity/token';
const Window=600000;
const NoopSpan:NonNullable<NonNullable<Parameters<Store['set']>[2]>['span']>={
 spanContext:()=>({traceId:'00000000000000000000000000000000',spanId:'0000000000000000',traceFlags:0}),
 setAttribute(){return this;},setAttributes(){return this;},addEvent(){return this;},addLink(){return this;},addLinks(){return this;},
 setStatus(){return this;},updateName(){return this;},end(){},isRecording:()=>false,recordException(){}
};
async function openStore(signal:AbortSignal):Promise<RecordStore>{
 const {getStore}=await import('@netlify/blobs');
 const boundedFetch:typeof fetch=async(url,init)=>{
  try{const r=await fetch(url,{...init,redirect:'error',signal});
   if(r.status>=500||[401,403,429].includes(r.status)){void r.body?.cancel();return new Response(null,{status:499});}return r;
  }catch{return new Response(null,{status:499});}
 };
 const store=getStore({name:Ledger,consistency:'strong',fetch:boundedFetch});
 return {set:(key,value)=>store.set(key,value,{onlyIfNew:true,span:NoopSpan}),read:key=>store.get(key,{type:'json',consistency:'strong',span:NoopSpan})};
}
function permitted(e:Settings,c:Context,now:number){
 const start=Date.parse(e.ENDO_PRODUCTION_IAM_STARTED_AT||''),end=Date.parse(e.ENDO_PRODUCTION_IAM_UNTIL||'');
 return e.ENDO_PRODUCTION_IAM_ENABLED==='true'&&e.ENDO_PRODUCTION_IAM_KILL_SWITCH==='false'
  &&Number.isFinite(start)&&Number.isFinite(end)&&start<=now&&now<end&&end>start&&end-start<=Window
  &&c.site?.id===Site&&c.deploy?.context==='production'&&c.deploy.published===true&&/^[A-Za-z0-9-]{1,128}$/.test(c.deploy.id)
  &&e.ENDO_CHAT_ENABLED!=='true'&&e.ENDO_CHAT_KILL_SWITCH!=='false'&&e.ORCHESTRATE_ENABLED==='false'
  &&e.ENDO_DEMO_INFERENCE_ENABLED==='false'&&e.ENDO_DEMO_KILL_SWITCH==='true'&&e.OTEL_SDK_DISABLED==='true';
}
async function errorCode(response:Response,signal:AbortSignal):Promise<string|null>{
 const reader=response.body?.getReader();if(!reader)return null;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{let size=0;const chunks:Uint8Array[]=[];
  for(;;){signal.throwIfAborted();const c=await reader.read();if(c.done)break;size+=c.value.length;if(size>32768)return null;chunks.push(c.value);}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  // Only IBM's documented fixed message-code format is admitted, never prose.
  return typeof value.errorCode==='string'&&/^BXNIM[0-9]{4}[A-Z]$/.test(value.errorCode)?value.errorCode:null;
 }catch{return null;}finally{signal.removeEventListener('abort',cancel);cancel();}
}
export function createProductionIamOnce(options:{settings?:()=>Settings;clock?:()=>number;store?:(signal:AbortSignal)=>Promise<RecordStore>;transport?:Transport;log?:(value:Report)=>void}={}){
 const settings=options.settings??(()=>process.env),clock=options.clock??Date.now;
 return async function run(context:Context):Promise<void>{
  const report:Report={status:'FAIL',iamHttp:null,errorCode:null,runtimeConfigurationAccessed:false};
  const signal=AbortSignal.timeout(12000);
  try{
   if(!permitted(settings(),context,clock()))return;
   const store=await waitQuota((options.store??openStore)(signal),signal),claim={version:1,nonce:randomUUID()};
   // This fixed ticket is never reset, refunded or keyed by expiry/deployment.
   // Even a failed token request permanently consumes this diagnostic allowance.
   const written=await waitQuota(store.set(Ticket,JSON.stringify(claim)),signal);
   if(written.modified!==true)return;
   const read=await waitQuota(store.read(Ticket),signal);
   if(!read||typeof read!=='object'||JSON.stringify(read)!==JSON.stringify(claim))return;
   signal.throwIfAborted();if(!permitted(settings(),context,clock()))return;
   const e=settings(),key=e.WATSONX_AI_APIKEY;
   report.runtimeConfigurationAccessed=typeof key==='string'&&key.length>0;
   let calls=0;
   const transport:Transport=async(url,init)=>{
    if(++calls!==1||url!==Iam||init.method!=='POST'||init.redirect!=='error'||init.credentials!=='omit'||init.cache!=='no-store'||!permitted(settings(),context,clock()))throw new Error();
    const response=await (options.transport??fetch)(url,init);report.iamHttp=response.status;
    if(response.status!==200){report.errorCode=await errorCode(response,init.signal??signal);return new Response(null,{status:response.status});}
    return response;
   };
   // Fresh broker; tokens are neither returned, logged nor cached between runs.
   await createWatsonRuntime(transport,clock).authenticate(e,signal,5000);
   signal.throwIfAborted();if(permitted(settings(),context,clock()))report.status='PASS';
  }catch{/* No private exception or provider text reaches logs. */}
  finally{(options.log??(value=>console.log(JSON.stringify(value))))(report);}
 };
}
const run=createProductionIamOnce();
export default async function productionIamOnce(_request:Request,context:Context){await run(context);}
