// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {createKeyVerification,validateEmbedKey} from '../../netlify/functions/verifyEmbedKey';
const Now=Date.parse('2026-11-07T12:00:00Z');
const Pair=generateKeyPairSync('rsa',{modulusLength:4096});
const Pem=Pair.privateKey.export({type:'pkcs8',format:'pem'}).toString();
const Pin=createHash('sha256').update(Pair.publicKey.export({type:'spki',format:'der'})).digest('hex');
const Origin='https://deploy-preview-4--clinicalagent.netlify.app';
const Settings={ORCHESTRATE_EMBED_DIAGNOSTIC_ENABLED:'true',ORCHESTRATE_EMBED_PREVIEW_ENABLED:'false',ORCHESTRATE_EMBED_KILL_SWITCH:'true',OTEL_SDK_DISABLED:'true',ORCHESTRATE_EMBED_PREVIEW_ID:'4',ORCHESTRATE_EMBED_PREVIEW_ORIGIN:Origin,ORCHESTRATE_EMBED_OPERATOR_IDS:'operator',ORCHESTRATE_EMBED_PRIVATE_KEY:Pem,ORCHESTRATE_EMBED_PUBLIC_KEY_SHA256:Pin};
const Context={user:{id:'operator',expiresAt:new Date(Now+60000)},deploy:{id:'preview-deploy',context:'deploy-preview',published:false}};
const request=()=>new Request(Origin+'/.netlify/functions/verifyEmbedKey');

it('validates actual PEM and emits only a fixed result without network or logging',async()=>{
 const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Unexpected network'));
 const log=vi.spyOn(console,'log'),error=vi.spyOn(console,'error');
 try{
  const response=await createKeyVerification(()=>Settings,()=>Now)(request(),Context);
  expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'PASS',reason:'keyVerified'});
  expect(response.headers.get('cache-control')).toBe('no-store');expect(network).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
 }finally{network.mockRestore();log.mockRestore();error.mockRestore();}
});
it('requires explicit diagnostic opt-in, closed activation and unpublished preview',async()=>{
 for(const changes of [{ORCHESTRATE_EMBED_DIAGNOSTIC_ENABLED:undefined},{ORCHESTRATE_EMBED_PREVIEW_ENABLED:'true'},{ORCHESTRATE_EMBED_KILL_SWITCH:'false'},{ORCHESTRATE_EMBED_PREVIEW_ID:'5'},{OTEL_SDK_DISABLED:'false'}]){
  expect((await createKeyVerification(()=>({...Settings,...changes}),()=>Now)(request(),Context)).status).toBe(404);
 }
 for(const deploy of [{...Context.deploy,context:'production'},{...Context.deploy,published:true}])expect((await createKeyVerification(()=>Settings,()=>Now)(request(),{...Context,deploy})).status).toBe(404);
});
it('authorizes actual platform user before reading secret material',async()=>{
 const secret=vi.fn(()=>{throw new Error('SyntheticSecret');});
 const settings={...Settings};Object.defineProperty(settings,'ORCHESTRATE_EMBED_PRIVATE_KEY',{get:secret});
 const handler=createKeyVerification(()=>settings,()=>Now);
 for(const context of [{deploy:Context.deploy},{...Context,user:{...Context.user,id:'unlisted'}},{...Context,user:{...Context.user,expiresAt:new Date(Now)}}]){
  expect((await handler(new Request(Origin+'/.netlify/functions/verifyEmbedKey',{headers:{'x-user-id':'operator'}}),context)).status).toBe(403);
 }
 expect(secret).not.toHaveBeenCalled();
});
it('bounds and sanitizes real key failures without returning fingerprint or key bytes',async()=>{
 const weak=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
 for(const [pem,pin,reason] of [[undefined,Pin,'keyMissing'],['x'.repeat(12001),Pin,'keyTooLarge'],[Pem.replaceAll('\n','\\n'),Pin,'literalNewlines'],[Pair.privateKey.export({type:'pkcs1',format:'pem'}).toString(),Pin,'unencryptedPkcs8Required'],[Pem,'MASKED','fingerprintFormat'],[Pem,'0'.repeat(64),'fingerprintMismatch'],[weak,Pin,'rsa4096Required'],[Pem.split('\n')[0]+'\nSyntheticSecret',Pin,'keyUnparseable']]){
  const result=validateEmbedKey(pem,pin);expect(result).toEqual({status:'FAIL',reason});
  expect(JSON.stringify(result)).not.toContain(Pin);expect(JSON.stringify(result)).not.toContain('SyntheticSecret');
 }
});
it('preserves the exact former PKCS8 prefix predicate without storing a key header fixture',()=>{
 const header=Pem.split('\n')[0];
 for(const candidate of [Pem,Pem.replaceAll('\n','\r\n'),' '+Pem,'"'+Pem+'"',Pem.replace('BEGIN','BEGINX'),Pem.replace('PRIVATE KEY','PUBLIC KEY'),Pem.replace(/^-{5}/,'------'),header,header+'\nSyntheticSecret',header+'-\nSyntheticSecret']){
  const acceptedHeader=candidate.startsWith(header)&&candidate.includes('\n');
  expect(validateEmbedKey(candidate,Pin).reason==='unencryptedPkcs8Required').toBe(!acceptedHeader);
 }
});
it('rejects input misuse and does not answer an aborted request',async()=>{
 const handler=createKeyVerification(()=>Settings,()=>Now);
 for(const req of [new Request(Origin+'/.netlify/functions/verifyEmbedKey?case=SyntheticSecret'),new Request(Origin+'/.netlify/functions/verifyEmbedKey',{method:'POST',body:'SyntheticSecret'}),new Request(Origin+'/.netlify/functions/verifyEmbedKey',{headers:{'sec-fetch-site':'cross-site'}})])expect((await handler(req,Context)).status).toBe(400);
 const controller=new AbortController();controller.abort();const response=await handler(new Request(Origin+'/.netlify/functions/verifyEmbedKey',{signal:controller.signal}),Context);expect(response.status).toBe(499);expect(await response.text()).toBe('');
});
it('does not accept operator identity from headers, query parameters or request bodies',async()=>{
 const handler=createKeyVerification(()=>Settings,()=>Now);
 for(const req of [
  new Request(Origin+'/.netlify/functions/verifyEmbedKey?operator=operator'),
  new Request(Origin+'/.netlify/functions/verifyEmbedKey',{headers:{'x-user-id':'operator','x-nf-user-id':'operator',Authorization:'Bearer SyntheticToken'}}),
  new Request(Origin+'/.netlify/functions/verifyEmbedKey',{method:'POST',body:JSON.stringify({user:Context.user})})
 ])expect((await handler(req,{deploy:Context.deploy})).status).toBe(403);
});
it('never emits key material or exception messages when injected configuration fails',async()=>{
 const error=vi.spyOn(console,'error'),log=vi.spyOn(console,'log'),warn=vi.spyOn(console,'warn');
 try{
  const settings={...Settings};Object.defineProperty(settings,'ORCHESTRATE_EMBED_PRIVATE_KEY',{get:()=>{throw new Error('SyntheticSecretProviderDetails');}});
  const response=await createKeyVerification(()=>settings,()=>Now)(request(),Context);
  expect(response.status).toBe(503);expect(await response.json()).toEqual({status:'FAIL',reason:'verificationUnavailable'});
  expect(error).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();expect(warn).not.toHaveBeenCalled();
 }finally{error.mockRestore();log.mockRestore();warn.mockRestore();}
});
