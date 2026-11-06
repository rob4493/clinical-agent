// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createVerification} from '../../netlify/functions/verifyQuota';
import {platformLogin} from '../../tools/previewAccessPolicy';
import type {QuotaStore} from '../../netlify/evaluation/demoQuota';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const Closed={CONTEXT:'deploy-preview',QUOTA_VERIFICATION_ENABLED:'true',QUOTA_VERIFICATION_OPERATOR_IDS:'synthetic-operator',ENDO_DEMO_KILL_SWITCH:'true',OTEL_SDK_DISABLED:'true',WATSONX_CONVERSATION_MODE:'disabled',ORCHESTRATE_ENABLED:'false',ORCHESTRATE_SYNTHETIC_AUTHORIZED:'false',ORCHESTRATE_DISCUSSION_AUTHORIZED:'false',ORCHESTRATE_HOSTED_CONTROLS_VERIFIED:'false',ENDO_DEMO_INFERENCE_ENABLED:'false',WATSONX_ENABLED:'false',WATSONX_CONFLICT_ASSIST_ENABLED:'false',WATSONX_GUIDED_FOLLOWUP_ENABLED:'false'};
const Origin='https://deploy-preview-1--clinicalagent.netlify.app';
const operator=()=>({user:{id:'synthetic-operator',expiresAt:new Date(Date.now()+60000)}});
const request=(payload:unknown)=>new Request(Origin+'/.netlify/functions/verifyQuota',{method:'POST',headers:{Origin,'Content-Type':'application/json'},body:JSON.stringify(payload)});
function storage(){
 const stores=new Map<string,Map<string,{data:unknown;etag:string}>>();
 const factory=vi.fn(async(name:string):Promise<QuotaStore>=>{
  expect(name).toMatch(/^EndoQuotaVerify[0-9a-f]{32}$/);expect(name).not.toBe('EndoConversationQuota');
  if(!stores.has(name))stores.set(name,new Map());const records=stores.get(name)!;
  return {set:async(key,content)=>{if(records.has(key))return {modified:false};const etag=String(records.size+1);records.set(key,{data:JSON.parse(content),etag});return {modified:true,etag};},getWithMetadata:async key=>records.get(key)??null};
 });return {factory,stores};
}
it('requires preview context, explicit operator opt-in and every IBM gate closed before storage',async()=>{
 for(const settings of [{},...Object.keys(Closed).map(key=>({...Closed,[key]:undefined})),{...Closed,CONTEXT:'production'},{...Closed,CONTEXT:'branch-deploy'},{...Closed,ORCHESTRATE_ENABLED:'true'},{...Closed,ENDO_DEMO_KILL_SWITCH:'false'}]){
  const {factory}=storage();const response=await createVerification(()=>settings,factory)(request({action:'start'}),operator());expect([403,404]).toContain(response.status);expect(factory).not.toHaveBeenCalled();
 }
});
it('rejects missing, expired, unlisted or header-spoofed operators even on direct URLs',async()=>{
 const {factory}=storage(),handler=createVerification(()=>Closed,factory);
 for(const context of [{},{user:{id:'other',expiresAt:new Date(Date.now()+60000)}},{user:{id:'synthetic-operator',expiresAt:new Date(0)}},{user:{id:'synthetic-operator',expiresAt:new Date('invalid')}}]){
  const incoming=request({action:'start'});incoming.headers.set('x-nf-user','synthetic-operator');expect((await handler(incoming,context)).status).toBe(403);
 }expect(factory).not.toHaveBeenCalled();
});
it('creates fresh test stores, admits exactly 3 of 40 independent requests and never invokes IBM',async()=>{
 const network=vi.fn(()=>{throw new Error('NetworkForbidden');});vi.stubGlobal('fetch',network);
 try{
  const {factory,stores}=storage(),handler=createVerification(()=>Closed,factory);
  const first=await (await handler(request({action:'start'}),operator())).json();
  const second=await (await handler(request({action:'start'}),operator())).json();expect(first.runId).not.toBe(second.runId);
  const otherWorker=createVerification(()=>Closed,factory,'other-worker');
  const responses=await Promise.all(Array.from({length:40},(_,index)=>(index%2?handler:otherWorker)(request({action:'reserve',runId:first.runId}),operator())));
  expect(responses.filter(response=>response.status===200)).toHaveLength(3);expect(responses.filter(response=>response.status===429)).toHaveLength(37);
  expect(stores.size).toBe(2);expect(network).not.toHaveBeenCalled();
  for(const records of stores.values())for(const record of records.values())expect(Object.keys(record.data as object).sort().join('|')).toMatch(/^(ownerId|dailyLimit|createdAt\|reservationId)$/);
 }finally{vi.unstubAllGlobals();}
});
it.each([{action:'start',store:'EndoConversationQuota'},{action:'reserve',runId:'EndoConversationQuota'},{action:'delete'},{action:'start',caseText:'SyntheticCase'},null])('rejects caller-selected stores, reset, content and malformed inputs %#',async payload=>{
 const {factory}=storage();const response=await createVerification(()=>Closed,factory)(request(payload),operator());expect([400,503]).toContain(response.status);expect(factory).not.toHaveBeenCalled();
});
it('distinguishes storage failure from quota exhaustion and rejects unknown runs',async()=>{
 const factory=vi.fn(async()=>{throw new Error('SyntheticSecret');}),handler=createVerification(()=>Closed,factory);
 const response=await handler(request({action:'start'}),operator());expect(response.status).toBe(503);expect(await response.text()).not.toContain('SyntheticSecret');
 const {factory:empty}=storage();expect((await createVerification(()=>Closed,empty)(request({action:'reserve',runId:'11111111-1111-4111-8111-111111111111'}),operator())).status).toBe(400);
});
it('rejects wrong origins, methods, queries, media types and oversized bodies before storage',async()=>{
 const {factory}=storage(),handler=createVerification(()=>Closed,factory);
 const wrongOrigin=request({action:'start'});wrongOrigin.headers.set('origin','https://outside.invalid');
 const oversized=request({action:'start',padding:'x'.repeat(300)});
 const wrongType=request({action:'start'});wrongType.headers.set('content-type','text/plain');
 for(const incoming of [wrongOrigin,oversized,wrongType,new Request(Origin+'/.netlify/functions/verifyQuota?reset=true'),new Request(Origin,{method:'DELETE'})])expect([400,503]).toContain((await handler(incoming,operator())).status);
 expect(factory).not.toHaveBeenCalled();
});
it('exposes an authenticated no-storage positive control',async()=>{
 const {factory}=storage(),response=await createVerification(()=>Closed,factory)(new Request(Origin+'/.netlify/functions/verifyQuota'),operator());expect(await response.json()).toEqual({version:'1',status:'operatorReady',ibm:'disabled'});expect(factory).not.toHaveBeenCalled();
});
it('requires a Netlify login redirect rather than missing routes, application failures or spoofable server headers',()=>{
 for(const status of [200,401,403,404,500])expect(platformLogin({status,headers:new Headers({server:'Netlify'})},Origin)).toBe(false);
 expect(platformLogin({status:302,headers:new Headers({location:'https://app.netlify.com/login'})},Origin)).toBe(true);
 for(const location of ['/login','https://app.netlify.com.evil.invalid/login','https://evil.invalid/auth','http://app.netlify.com/login','https://app.netlify.com/sites'])expect(platformLogin({status:302,headers:new Headers({location})},Origin)).toBe(false);
 expect(platformLogin({status:302,headers:new Headers({location:'https://app.netlify.com/login','x-quota-verification':'application'})},Origin)).toBe(false);
});
it('runs the browser harness with session-bound requests and reports quota errors and worker evidence accurately',async()=>{
 const script=readFileSync(new URL('../../tools/previewQuotaBrowser.js',import.meta.url),'utf8');
 for(const broken of [false,true]){
  let ordinal=0;const log=vi.fn();
  const fetch=vi.fn(async(route:string,options:RequestInit)=>{
   expect(route).toBe('/.netlify/functions/verifyQuota');expect(options).toMatchObject({credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'}});
   const payload=JSON.parse(String(options.body));
   if(payload.action==='start')return {status:200,json:async()=>({status:'freshStoreCreated',runId:'11111111-1111-4111-8111-111111111111'})};
   const position=ordinal++;
   return {status:broken&&position===39?503:position<3?200:429,json:async()=>broken&&position===39?{code:'verificationFailed'}:{outcome:position<3?'admitted':'exhausted',workerId:position%2?'workerA':'workerB'}};
  });
  await runInNewContext(script,{location:{hostname:'deploy-preview-1--clinicalagent.netlify.app',protocol:'https:'},fetch,AbortController,console:{log}});
  expect(fetch).toHaveBeenCalledTimes(41);expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({admitted:3,exhausted:broken?36:37,errors:broken?1:0,observedWorkers:2,capacityPassed:!broken,crossWorkerObserved:true,ibm:'notInvoked'});
 }
});
it('halts the browser runner and aborts pending work if more than three admissions are observed',async()=>{
 const script=readFileSync(new URL('../../tools/previewQuotaBrowser.js',import.meta.url),'utf8'),log=vi.fn();let signal:AbortSignal|undefined;
 const fetch=vi.fn(async(_route:string,options:RequestInit)=>{signal=options.signal!;const payload=JSON.parse(String(options.body));return {status:200,json:async()=>payload.action==='start'?{status:'freshStoreCreated',runId:'11111111-1111-4111-8111-111111111111'}:{outcome:'admitted',workerId:'syntheticWorker'}};});
 await expect(runInNewContext(script,{location:{hostname:'deploy-preview-1--clinicalagent.netlify.app',protocol:'https:'},fetch,AbortController,console:{log}})).rejects.toThrow('STOP: capacity exceeded');expect(signal?.aborted).toBe(true);expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({limitExceeded:true,capacityPassed:false});
});
it('refuses to execute the browser quota script on production',async()=>{
 const script=readFileSync(new URL('../../tools/previewQuotaBrowser.js',import.meta.url),'utf8'),fetch=vi.fn();
 await expect(runInNewContext(script,{location:{hostname:'clinicalagent.netlify.app',protocol:'https:'},fetch})).rejects.toThrow('Deploy Preview required');expect(fetch).not.toHaveBeenCalled();
});
