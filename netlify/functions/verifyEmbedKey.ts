import {createHash,createPrivateKey,createPublicKey,randomBytes,sign,verify} from 'node:crypto';

type Settings=Record<string,string|undefined>;
type OperatorContext={user?:{id:string;expiresAt:Date};deploy?:{id:string;context:string;published:boolean}};
const PreviewOrigin='https://deploy-preview-4--clinicalagent.netlify.app';

/** Uses actual injected secret bytes, never management-plane placeholders. No JWT is issued. */
export function validateEmbedKey(pem:unknown,pin:unknown):{status:'PASS'|'FAIL';reason:string}{
 if(typeof pem!=='string'||!pem)return {status:'FAIL',reason:'keyMissing'};
 if(pem.length>12000)return {status:'FAIL',reason:'keyTooLarge'};
 if(pem.includes('\\n')&&!pem.includes('\n'))return {status:'FAIL',reason:'literalNewlines'};
 if(!pem.startsWith('-----BEGIN PRIVATE KEY-----')||!pem.includes('\n'))return {status:'FAIL',reason:'unencryptedPkcs8Required'};
 if(typeof pin!=='string'||!/^[a-f0-9]{64}$/.test(pin))return {status:'FAIL',reason:'fingerprintFormat'};
 try{
  const key=createPrivateKey(pem);
  if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength||0)<4096)return {status:'FAIL',reason:'rsa4096Required'};
  const publicKey=createPublicKey(key);
  const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
  if(fingerprint!==pin)return {status:'FAIL',reason:'fingerprintMismatch'};
  const challenge=randomBytes(32);
  if(!verify('RSA-SHA256',challenge,publicKey,sign('RSA-SHA256',challenge,key)))return {status:'FAIL',reason:'signingFailed'};
  return {status:'PASS',reason:'keyVerified'};
 }catch{return {status:'FAIL',reason:'keyUnparseable'};}
}

export const config={rateLimit:{windowLimit:6,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
const json=(status:number,result:{status:string;reason:string})=>new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'}});

/** Read-only preview diagnostic. Platform context authorizes before secrets are accessed.
 * Does not use the issuer, storage, IBM, activation acknowledgements or test window.
 */
export function createKeyVerification(settings:()=>Settings=()=>process.env,clock:()=>number=Date.now){
 return async function verifyEmbedKey(request:Request,context:OperatorContext={}):Promise<Response>{
  try{
   const environment=settings(),address=new URL(request.url),operator=context.user;
   if(environment.ORCHESTRATE_EMBED_DIAGNOSTIC_ENABLED!=='true'||environment.ORCHESTRATE_EMBED_PREVIEW_ENABLED!=='false'||environment.ORCHESTRATE_EMBED_KILL_SWITCH!=='true'||environment.OTEL_SDK_DISABLED!=='true'
    ||environment.ORCHESTRATE_EMBED_PREVIEW_ID!=='4'||environment.ORCHESTRATE_EMBED_PREVIEW_ORIGIN!==PreviewOrigin||address.origin!==PreviewOrigin
    ||context.deploy?.context!=='deploy-preview'||context.deploy.published!==false||typeof context.deploy.id!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(context.deploy.id))return json(404,{status:'FAIL',reason:'diagnosticDisabled'});
   if(!operator||!environment.ORCHESTRATE_EMBED_OPERATOR_IDS?.split(',').includes(operator.id)||!(operator.expiresAt instanceof Date)||!Number.isFinite(operator.expiresAt.getTime())||operator.expiresAt.getTime()<=clock())return json(403,{status:'FAIL',reason:'operatorRequired'});
   if(request.method!=='GET'||address.search||request.headers.get('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'&&request.headers.get('sec-fetch-site')!=='none')return json(400,{status:'FAIL',reason:'inputRejected'});
   if(request.signal.aborted)return new Response(null,{status:499});
   const result=validateEmbedKey(environment.ORCHESTRATE_EMBED_PRIVATE_KEY,environment.ORCHESTRATE_EMBED_PUBLIC_KEY_SHA256);
   if(request.signal.aborted)return new Response(null,{status:499});
   return json(200,result);
  }catch{return json(503,{status:'FAIL',reason:'verificationUnavailable'});}
 };
}
export default createKeyVerification();
