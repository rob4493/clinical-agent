import {createHash,createPrivateKey,createPublicKey,randomUUID,sign,verify} from 'node:crypto';
import {createQuota,waitQuota,type QuotaStore} from '../evaluation/demoQuota';
import {netlifyQuota} from '../../frontend/src/server/netlifyQuota';

type Settings=Record<string,string|undefined>;
type OperatorContext={user?:{id:string;expiresAt:Date};deploy?:{id:string;context:string;published:boolean}};
const TokenSeconds=120,SessionSeconds=600,RequestMilliseconds=5000;
const Uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const Headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export const config={rateLimit:{windowLimit:6,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
function json(payload:unknown,status:number){return new Response(JSON.stringify(payload),{status,headers:Headers});}
function enabled(settings:Settings,now:number){
 const until=Date.parse(settings.ORCHESTRATE_EMBED_TEST_UNTIL||'');
 return settings.ORCHESTRATE_EMBED_PREVIEW_ENABLED==='true'&&settings.ORCHESTRATE_EMBED_KILL_SWITCH==='false'&&settings.OTEL_SDK_DISABLED==='true'
  &&settings.ORCHESTRATE_EMBED_SECURITY_VERIFIED==='true'&&settings.ORCHESTRATE_EMBED_TOOLS_DENIED==='true'&&settings.ORCHESTRATE_EMBED_USAGE_VERIFIED==='true'&&settings.ORCHESTRATE_EMBED_PRIVACY_VERIFIED==='true'
  &&Number.isFinite(until)&&until>now&&until-now<=86400000;
}
/** Preview aliases survive rebuilds; deploy IDs do not. Context is platform-verified,
 * while the configured alias/PR pin limits admission to the reviewed preview only.
 */
function previewAllowed(settings:Settings,context:OperatorContext,origin:string){
 const preview=/^https:\/\/deploy-preview-([1-9]\d{0,8})--[a-z0-9-]+\.netlify\.app$/.exec(settings.ORCHESTRATE_EMBED_PREVIEW_ORIGIN||'');
 return !!preview&&preview[1]===settings.ORCHESTRATE_EMBED_PREVIEW_ID&&origin===settings.ORCHESTRATE_EMBED_PREVIEW_ORIGIN
  &&context.deploy?.context==='deploy-preview'&&context.deploy.published===false&&typeof context.deploy.id==='string'&&/^[A-Za-z0-9-]{1,128}$/.test(context.deploy.id);
}
async function body(request:Request,signal:AbortSignal){
 const reader=request.body?.getReader();if(!reader)throw new Error();let size=0;const pieces:Uint8Array[]=[];
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{for(;;){signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>4096)throw new Error();pieces.push(chunk.value);}return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(pieces));}
 finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
/** Preview-only issuer. Trusted platform context, never browser headers, identifies the operator.
 * No IAM key, clinical content, user-selected subject or source context enters the JWT.
 */
export function createEmbedSession(settings:()=>Settings=()=>process.env,factory:(signal:AbortSignal)=>Promise<QuotaStore>=signal=>netlifyQuota('EndoEmbeddedPreviewQuota',signal),clock:()=>number=Date.now){
 return async function embedSession(request:Request,context:OperatorContext={}):Promise<Response>{
  const environment=settings(),now=clock(),operator=context.user;
  if(!previewAllowed(environment,context,new URL(request.url).origin)||!enabled(environment,now))return json({code:'embedDisabled'},404);
  if(!operator||!environment.ORCHESTRATE_EMBED_OPERATOR_IDS?.split(',').includes(operator.id)||!(operator.expiresAt instanceof Date)||!Number.isFinite(operator.expiresAt.getTime())||operator.expiresAt.getTime()<=now)return json({code:'operatorRequired'},403);
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(RequestMilliseconds)]);
  try{
   const address=new URL(request.url),origin=environment.ORCHESTRATE_EMBED_PREVIEW_ORIGIN;
   if(!origin||!/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin)||address.origin!==origin||request.method!=='POST'||address.search||request.headers.get('origin')!==origin||request.headers.get('content-type')!=='application/json'||request.headers.get('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin')return json({code:'inputRejected'},400);
   const raw=await body(request,signal);
   // Fixed request grammar rejects duplicate JSON keys as well as every extra field.
   const start=/^\s*\{\s*"action"\s*:\s*"start"\s*\}\s*$/.test(raw);
   const renewal=/^\s*\{\s*"action"\s*:\s*"renew"\s*,\s*"token"\s*:\s*"([A-Za-z0-9_.-]{100,3000})"\s*\}\s*$/.exec(raw);
   if(!start&&!renewal)return json({code:'inputRejected'},400);
   const pem=environment.ORCHESTRATE_EMBED_PRIVATE_KEY;
   if(!pem||pem.length>12000||!pem.startsWith(['-----BEGIN','PRIVATE KEY-----'].join(' ')))throw new Error();
   const key=createPrivateKey(pem),publicKey=createPublicKey(key);
   if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength||0)<4096)throw new Error();
   const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
   if(!/^[a-f0-9]{64}$/.test(environment.ORCHESTRATE_EMBED_PUBLIC_KEY_SHA256||'')||fingerprint!==environment.ORCHESTRATE_EMBED_PUBLIC_KEY_SHA256)throw new Error();
   const binding=createHash('sha256').update('EndoEmbeddedOperator|'+context.deploy!.id+'|'+operator.id).digest('hex');
   const ownerId=binding.slice(0,8)+'-'+binding.slice(8,12)+'-4'+binding.slice(13,16)+'-a'+binding.slice(17,20)+'-'+binding.slice(20,32);
   const second=Math.floor(now/1000);let subject=randomUUID(),started=second;
   if(renewal){
    const parts=renewal[1].split('.');if(parts.length!==3||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')))throw new Error();
    const header=JSON.parse(Buffer.from(parts[0],'base64url').toString()),previous=JSON.parse(Buffer.from(parts[1],'base64url').toString());
    if(JSON.stringify(header)!==JSON.stringify({alg:'RS256',typ:'JWT'})||Object.keys(previous).sort().join('|')!=='exp|iat|jti|nbf|sub'||!Uuid.test(previous.sub)||!Number.isInteger(previous.iat)||previous.iat>second||previous.nbf!==previous.iat||!Number.isInteger(previous.exp)||previous.exp<=second||previous.exp>previous.iat+SessionSeconds||typeof previous.jti!=='string')throw new Error();
    // Original issuance time remains signed and fixed across renewals.
    subject=previous.sub;started=previous.iat;
   }
   const expires=Math.min(second+TokenSeconds,started+SessionSeconds,Math.floor(operator.expiresAt.getTime()/1000),Math.floor(Date.parse(environment.ORCHESTRATE_EMBED_TEST_UNTIL!)/1000));
   if(expires<=second)throw new Error();
   const store=await waitQuota(factory(signal),signal);
   if(start){await createQuota(store,clock,()=>0).reserve({visitorId:subject,ordinal:0,dailyLimit:1},signal);const written=await waitQuota(store.set('thread/'+subject,JSON.stringify({ownerId}),{onlyIfNew:true}),signal);if(!written.modified||!written.etag)throw new Error();}
   const owner=await waitQuota(store.getWithMetadata('thread/'+subject),signal);
   if(!owner?.etag||JSON.stringify(owner.data)!==JSON.stringify({ownerId}))throw new Error();
   if(!previewAllowed(settings(),context,address.origin)||!enabled(settings(),clock()))throw new Error();signal.throwIfAborted();
   const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
   const payload=Buffer.from(JSON.stringify({sub:subject,iat:started,nbf:started,exp:expires,jti:randomUUID()})).toString('base64url');
   const signature=sign('RSA-SHA256',Buffer.from(header+'.'+payload),key).toString('base64url');
   signal.throwIfAborted();return json({version:'1',token:header+'.'+payload+'.'+signature,expiresAt:expires*1000,sessionExpiresAt:Math.min((started+SessionSeconds)*1000,operator.expiresAt.getTime(),Date.parse(environment.ORCHESTRATE_EMBED_TEST_UNTIL!))},200);
  }catch{if(request.signal.aborted)return new Response(null,{status:499,headers:Headers});return json({code:'embedUnavailable'},503);}
 };
}
export default createEmbedSession();
