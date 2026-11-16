import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {isOrchestrateApiUrl,type OrchestrateEnvironment} from './orchestrateTarget';
import type {ConversationWindow} from './conversationQuota';
export const ProductionOrigin='https://clinicalagent.netlify.app';
export const VisitorCookie='__Host-endo-demo';
export type DeployContext={deploy?:{id:string;context:string;published:boolean}};
export type Visitor={id:string;started:number;until:number};
/** An administrator opt-in is not evidence of IBM-side enforcement. Activation
 * requires independently reviewed effective restrictions, outside this process. */
export function productionWindow(env:OrchestrateEnvironment,now:number):ConversationWindow|null{
 const startedAt=Date.parse(env.ENDO_CHAT_STARTED_AT||''),until=Date.parse(env.ENDO_CHAT_UNTIL||'');
 const integer=(value:string|undefined,fallback:number,max:number)=>value===undefined?fallback:/^[1-9]\d{0,2}$/.test(value)&&Number(value)<=max?Number(value):NaN;
 const dailyCalls=integer(env.ENDO_CHAT_DAILY_CALL_LIMIT,50,50),dailySessions=integer(env.ENDO_CHAT_DAILY_SESSION_LIMIT,20,20);
 if(env.ENDO_CHAT_ENABLED!=='true'||env.ENDO_CHAT_KILL_SWITCH!=='false'||env.ENDO_CHAT_TOOL_POLICY!=='approved-operations-enforced'
  ||env.OTEL_SDK_DISABLED!=='true'||env.ORCHESTRATE_ENABLED!=='false'||env.ENDO_DEMO_INFERENCE_ENABLED!=='false'||env.ENDO_DEMO_KILL_SWITCH!=='true'
  ||env.ORCHESTRATE_AGENT_ID!=='c6698d4e-a08d-4b77-bf05-139ff3b4c695'||env.ORCHESTRATE_ENVIRONMENT!=='live'||env.WATSONX_AI_AUTH_TYPE!=='iam'
  ||!isOrchestrateApiUrl(env.ORCHESTRATE_API_URL)||new URL(env.ORCHESTRATE_API_URL!).hostname!=='api.eu-de.watson-orchestrate.cloud.ibm.com'
  ||!env.WATSONX_AI_APIKEY||env.WATSONX_AI_APIKEY.length>512||/\s|[\u0000-\u001f]/.test(env.WATSONX_AI_APIKEY)
  ||!env.ENDO_CHAT_SESSION_SECRET||env.ENDO_CHAT_SESSION_SECRET.length<32||env.ENDO_CHAT_SESSION_SECRET.length>256||/\s/.test(env.ENDO_CHAT_SESSION_SECRET)
  ||!env.ENDO_CHAT_ACCESS_CODE||env.ENDO_CHAT_ACCESS_CODE.length<20||env.ENDO_CHAT_ACCESS_CODE.length>128||/\s/.test(env.ENDO_CHAT_ACCESS_CODE)
  ||![now,startedAt,until,dailyCalls,dailySessions].every(Number.isFinite)||startedAt>now||until<=now||until<=startedAt||until-startedAt>14400000)return null;
 return {startedAt,until,dailyCalls,dailySessions};
}
export function isProductionRequest(request:Request,context:DeployContext){
 const url=new URL(request.url);
 return url.origin===ProductionOrigin&&!url.search&&context.deploy?.context==='production'&&context.deploy.published===true&&typeof context.deploy.id==='string'&&/^[A-Za-z0-9-]{1,128}$/.test(context.deploy.id);
}
export function createVisitorAccess(env:OrchestrateEnvironment,clock:()=>number=Date.now){
 const signature=(text:string)=>createHmac('sha256',env.ENDO_CHAT_SESSION_SECRET!).update('Endo visitor v1\0'+text).digest();
 function read(header:string|null):Visitor|null{
  try{
   const window=productionWindow(env,clock());if(!window||!header||header.length>8192)return null;
   const found=header.split(';').map(value=>value.trim()).filter(value=>value.startsWith(VisitorCookie+'='));if(found.length!==1)return null;
   const token=found[0].slice(VisitorCookie.length+1);if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)||token.length>1024)return null;
   const [body,mac]=token.split('.'),actual=Buffer.from(mac,'base64url'),expected=signature(body);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;
   const value=JSON.parse(Buffer.from(body,'base64url').toString('utf8')) as Visitor;
   if(Object.keys(value).sort().join('|')!=='id|started|until'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id)||value.started!==window.startedAt||!Number.isSafeInteger(value.until)||value.until<=clock()||value.until>window.until)return null;
   return value;
  }catch{return null;}
 }
 return {read,
  issue(accessCode:unknown){
   const window=productionWindow(env,clock());if(!window||typeof accessCode!=='string'||accessCode.length>128)return null;
   if(!timingSafeEqual(signature('access:'+accessCode),signature('access:'+env.ENDO_CHAT_ACCESS_CODE)))return null;
   const visitor:Visitor={id:randomUUID(),started:window.startedAt,until:Math.min(window.until,clock()+3600000)},body=Buffer.from(JSON.stringify(visitor)).toString('base64url');
   return {visitor,cookie:`${VisitorCookie}=${body}.${signature(body).toString('base64url')}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0,Math.floor((visitor.until-clock())/1000))}`};
  }
 };
}
