type Settings=Record<string,string|undefined>;
type OperatorContext={user?:{id:string;expiresAt:Date};deploy?:{id:string;context:string;published:boolean}};
const PreviewOrigin='https://deploy-preview-4--clinicalagent.netlify.app';
export const config={rateLimit:{windowLimit:6,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
function result(status:number,authorized=false){
 return new Response(JSON.stringify({status:authorized?'authorized':'unauthorized'}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'}});
}

/** Read-only platform identity check. No identity is accepted from headers/body;
 * success grants no token, inference permission, quota ticket or case access.
 */
export function createOperatorVerification(settings:()=>Settings=()=>process.env,clock:()=>number=Date.now){
 return async function verifyOperatorContext(request:Request,context:OperatorContext={}):Promise<Response>{
  try{
   const environment=settings(),address=new URL(request.url);
   if(environment.ORCHESTRATE_OPERATOR_DIAGNOSTIC_ENABLED!=='true'
    ||environment.ORCHESTRATE_EMBED_PREVIEW_ID!=='4'||environment.ORCHESTRATE_EMBED_PREVIEW_ORIGIN!==PreviewOrigin||address.origin!==PreviewOrigin
    ||context.deploy?.context!=='deploy-preview'||context.deploy.published!==false||typeof context.deploy.id!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(context.deploy.id)
    ||environment.ORCHESTRATE_EMBED_PREVIEW_ENABLED!=='false'||environment.ORCHESTRATE_EMBED_KILL_SWITCH!=='true'||environment.OTEL_SDK_DISABLED!=='true'
    ||environment.ORCHESTRATE_PROBE_ENABLED!==undefined&&environment.ORCHESTRATE_PROBE_ENABLED!=='false'
    ||environment.ORCHESTRATE_PROBE_KILL_SWITCH!==undefined&&environment.ORCHESTRATE_PROBE_KILL_SWITCH!=='true')return result(404);
   if(request.method!=='GET'||address.search||request.headers.has('origin')&&request.headers.get('origin')!==PreviewOrigin
    ||request.headers.has('sec-fetch-site')&&!['same-origin','none'].includes(request.headers.get('sec-fetch-site')!))return result(400);
   const allowlist=environment.ORCHESTRATE_EMBED_OPERATOR_IDS?.split(',');
   const operator=context.user;
   if(!allowlist?.length||allowlist.length>100||!allowlist.every(id=>/^[A-Za-z0-9-]{1,128}$/.test(id))
    ||!operator||typeof operator.id!=='string'||!allowlist.includes(operator.id)||!(operator.expiresAt instanceof Date)
    ||!Number.isFinite(operator.expiresAt.getTime())||operator.expiresAt.getTime()<=clock())return result(403);
   if(request.signal.aborted)return new Response(null,{status:499});
   return result(200,true);
  }catch{return result(503);}
 };
}
export default createOperatorVerification();
