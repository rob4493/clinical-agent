// No cookies, Authorization, redirects, response-body output or file persistence.
import {createHash} from 'node:crypto';
import {platformLogin} from './previewAccessPolicy.ts';
const address=new URL(process.argv[2]);
if(address.protocol!=='https:'||!/^deploy-preview-[1-9]\d*--clinicalagent\.netlify\.app$/.test(address.hostname)||address.pathname!=='/'||address.search||address.hash||address.username||address.password)throw new Error('Use the standard clinicalagent GitHub Deploy Preview origin only.');
const paths=['/','/api/v1/conversation','/.netlify/functions/converse','/.netlify/functions/verifyQuota','/__quota_access_missing__'];
let passed=true;
for(const {path,method} of [...paths.map(path=>({path,method:'GET'})),...paths.slice(1,4).map(path=>({path,method:'POST'}))]){
 const response=await fetch(new URL(path,address),{method,...(method==='POST'?{headers:{'Content-Type':'application/json',Origin:address.origin},body:JSON.stringify({action:'start',version:'1'})}:{}),redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
 const application=response.headers.has('x-quota-verification')||response.headers.has('x-clinical-mode');
 // A 401/403/404, Netlify server header, or generic HTML is not proof of access
 // protection. Unknown challenge formats stay inconclusive for operator review.
 const protectedRedirect=platformLogin(response,address.origin);
 const bytes=await response.arrayBuffer();
 console.log(JSON.stringify({path,method,status:response.status,netlifyLoginRedirect:protectedRedirect,applicationResponse:application,bodyFingerprint:createHash('sha256').update(new Uint8Array(bytes)).digest('hex').slice(0,16),result:protectedRedirect?'platformLoginRedirect':'inconclusiveOrFailed'}));
 if(!protectedRedirect){passed=false;break;}
}
process.exitCode=passed?0:1;
