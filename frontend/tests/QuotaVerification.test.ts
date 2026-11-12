// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createVerification} from '../../netlify/functions/verifyQuota';
import {platformLogin} from '../../tools/previewAccessPolicy';
import type {QuotaStore} from '../../netlify/evaluation/demoQuota';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const Closed={QUOTA_VERIFICATION_ENABLED:'true',QUOTA_VERIFICATION_OPERATOR_IDS:'synthetic-operator',ENDO_DEMO_KILL_SWITCH:'true',OTEL_SDK_DISABLED:'true',WATSONX_CONVERSATION_MODE:'disabled',ORCHESTRATE_ENABLED:'false',ORCHESTRATE_SYNTHETIC_AUTHORIZED:'false',ORCHESTRATE_DISCUSSION_AUTHORIZED:'false',ORCHESTRATE_HOSTED_CONTROLS_VERIFIED:'false',ENDO_DEMO_INFERENCE_ENABLED:'false',WATSONX_ENABLED:'false',WATSONX_CONFLICT_ASSIST_ENABLED:'false',WATSONX_GUIDED_FOLLOWUP_ENABLED:'false'};
const Origin='https://deploy-preview-4--clinicalagent.netlify.app';
const Deploy={id:'synthetic-deploy',context:'deploy-preview',published:false};
const operator=()=>({user:{id:'synthetic-operator',expiresAt:new Date(Date.now()+60000)},deploy:{...Deploy}});
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
 for(const settings of [{},...Object.keys(Closed).map(key=>({...Closed,[key]:undefined})),{...Closed,ORCHESTRATE_ENABLED:'true'},{...Closed,ENDO_DEMO_KILL_SWITCH:'false'}]){
  const {factory}=storage();const response=await createVerification(()=>settings,factory)(request({action:'start'}),operator());expect([403,404]).toContain(response.status);expect(factory).not.toHaveBeenCalled();
 }
});
it.each(Object.entries(Closed).filter(([key])=>key!=='QUOTA_VERIFICATION_OPERATOR_IDS'))('retains the exact mandatory safety value for %s',async(key,value)=>{
 const {factory}=storage(),network=vi.fn();vi.stubGlobal('fetch',network);
 try{
  const settings={...Closed,[key]:value==='true'?'false':value==='false'?'true':'reviewed'};
  const response=await createVerification(()=>settings,factory)(request({action:'start'}),operator());
  expect(response.status).toBe(404);expect(factory).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();}
});
it('rejects missing, expired, unlisted or header-spoofed operators even on direct URLs',async()=>{
 const {factory}=storage(),handler=createVerification(()=>Closed,factory);
 for(const context of [{deploy:Deploy},{deploy:Deploy,user:{id:'other',expiresAt:new Date(Date.now()+60000)}},{deploy:Deploy,user:{id:'synthetic-operator',expiresAt:new Date(0)}},{deploy:Deploy,user:{id:'synthetic-operator',expiresAt:new Date('invalid')}}]){
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
it.each(['storeInitialization','initialWrite','metadataReadback','integrityVerification'] as const)('returns only the fixed protected start failure stage: %s',async stage=>{
 const network=vi.fn();vi.stubGlobal('fetch',network);
 const logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')];
 const failure=()=>{throw new Error('SyntheticPrivatePayloadAndCredential');};
 const write=vi.fn(async()=>stage==='initialWrite'?failure():{modified:true,etag:'synthetic-etag'});
 const read=vi.fn(async()=>stage==='metadataReadback'?failure():{data:{ownerId:'mismatch'},etag:'synthetic-etag'});
 const factory=vi.fn(async()=>stage==='storeInitialization'?failure():{set:write,getWithMetadata:read});
 try{
  const response=await createVerification(()=>Closed,factory)(request({action:'start'}),operator());
  expect(response.status).toBe(503);expect(response.headers.get('x-quota-verification')).toBe('application');
  expect(await response.json()).toEqual({code:'verificationFailed',stage});
  expect(factory).toHaveBeenCalledOnce();expect(write).toHaveBeenCalledTimes(stage==='storeInitialization'?0:1);
  expect(read).toHaveBeenCalledTimes(['storeInitialization','initialWrite'].includes(stage)?0:1);
  expect(network).not.toHaveBeenCalled();for(const log of logs)expect(log).not.toHaveBeenCalled();
 }finally{for(const log of logs)log.mockRestore();vi.unstubAllGlobals();}
});
it.each(['notModified','missingEtag','nullReadback','changedEtag','changedOwner','extraContent'])('does not accept incomplete or inconsistent initial writes: %s',async scenario=>{
 const write=vi.fn(async()=>({modified:scenario!=='notModified',etag:scenario==='missingEtag'?'':'synthetic-etag'}));
 const read=vi.fn(async(key:string)=>scenario==='nullReadback'?null:{etag:scenario==='changedEtag'?'other':'synthetic-etag',data:scenario==='extraContent'?{ownerId:key.slice(7),extra:true}:{ownerId:scenario==='changedOwner'?'other':key.slice(7)}});
 const response=await createVerification(()=>Closed,async()=>({set:write,getWithMetadata:read}))(request({action:'start'}),operator());
 expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'verificationFailed',stage:'integrityVerification'});expect(write).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledOnce();
});
it('preserves a partial write as failed verification without retrying, deleting or reserving quota',async()=>{
 const records=new Map<string,string>();
 const write=vi.fn(async(key:string,content:string)=>{records.set(key,content);return {modified:true,etag:'synthetic-etag'};});
 const read=vi.fn(async()=>{throw new Error('SyntheticReadFailure');});
 const response=await createVerification(()=>Closed,async()=>({set:write,getWithMetadata:read}))(request({action:'start'}),operator());
 expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'verificationFailed',stage:'metadataReadback'});
 expect([...records.keys()]).toHaveLength(1);expect([...records.keys()][0]).toMatch(/^thread\/[0-9a-f-]{36}$/);expect(write).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledOnce();
});
it('keeps malformed requests and reservation failures generic rather than assigning a start stage',async()=>{
 const factory=vi.fn(async()=>{throw new Error('SyntheticSecret');}),handler=createVerification(()=>Closed,factory);
 const oversized=await handler(request({action:'start',padding:'x'.repeat(300)}),operator());expect(await oversized.json()).toEqual({code:'verificationFailed'});expect(factory).not.toHaveBeenCalled();
 const reserved=await handler(request({action:'reserve',runId:'11111111-1111-4111-8111-111111111111'}),operator());expect(reserved.status).toBe(503);expect(await reserved.json()).toEqual({code:'verificationFailed'});
});
it('does not disclose a failure stage to unauthorized callers',async()=>{
 const factory=vi.fn(async()=>{throw new Error('SyntheticSecret');});
 for(const context of [{...operator(),user:undefined},{...operator(),user:{...operator().user,id:'other'}},{...operator(),deploy:{...Deploy,context:'production'}},{...operator(),deploy:{...Deploy,published:true}},{...operator(),user:{...operator().user,expiresAt:new Date(0)}}]){
  const response=await createVerification(()=>Closed,factory)(request({action:'start'}),context);expect([403,404]).toContain(response.status);expect(await response.json()).not.toHaveProperty('stage');
 }
 const disabled=await createVerification(()=>({...Closed,QUOTA_VERIFICATION_ENABLED:'false'}),factory)(request({action:'start'}),operator());expect(await disabled.json()).toEqual({code:'disabled'});expect(factory).not.toHaveBeenCalled();
});
it.each(['disabled','unlisted','expired','cancelled','metadataMissing'])('withholds a stage when protected authorization is lost during storage: %s',async change=>{
 const settings={...Closed},context=operator(),abort=new AbortController();
 const write=vi.fn(async()=>{
  if(change==='disabled')settings.QUOTA_VERIFICATION_ENABLED='false';
  if(change==='unlisted')settings.QUOTA_VERIFICATION_OPERATOR_IDS='other';
  if(change==='expired')context.user.expiresAt=new Date(0);
  if(change==='cancelled')abort.abort();
  if(change==='metadataMissing')context.deploy.id='';
  throw new Error('SyntheticPrivateDetail');
 });
 const response=await createVerification(()=>settings,async()=>({set:write,getWithMetadata:vi.fn()}))(new Request(request({action:'start'}),{signal:abort.signal}),context);
 expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'verificationFailed'});expect(write).toHaveBeenCalledOnce();
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
it('uses trusted runtime deployment context without reading process.env.CONTEXT',async()=>{
 const {factory}=storage();
 const settings=new Proxy(Closed,{get(target,key){if(key==='CONTEXT')throw new Error('Build metadata must not be read');return Reflect.get(target,key);}});
 const response=await createVerification(()=>settings,factory)(new Request(Origin+'/.netlify/functions/verifyQuota'),operator());
 expect(response.status).toBe(200);expect(await response.json()).toEqual({version:'1',status:'operatorReady',ibm:'disabled'});expect(factory).not.toHaveBeenCalled();
});
it.each([undefined,null,{}, {...Deploy,context:'production'}, {...Deploy,context:'branch-deploy'}, {...Deploy,published:true}, {...Deploy,published:undefined}, {...Deploy,published:'false'}, {...Deploy,id:undefined}, {...Deploy,id:''}, {...Deploy,id:'x'.repeat(129)}, {...Deploy,id:'invalid/id'}, {...Deploy,context:undefined}])('fails closed for absent, malformed or non-preview platform deployment metadata %#',async deploy=>{
 const {factory}=storage();const context={...operator(),deploy} as ReturnType<typeof operator>;
 const response=await createVerification(()=>({...Closed,CONTEXT:'deploy-preview'}),factory)(request({action:'start'}),context);
 expect(response.status).toBe(404);expect(await response.json()).toEqual({code:'disabled'});expect(factory).not.toHaveBeenCalled();
});
it.each(['https://deploy-preview-5--clinicalagent.netlify.app','https://clinicalagent.netlify.app','https://deploy-preview-4--clinicalagent.netlify.app.evil.invalid','http://deploy-preview-4--clinicalagent.netlify.app'])('rejects other preview, production and spoofed origins before storage %#',async origin=>{
 const {factory}=storage(),incoming=new Request(origin+'/.netlify/functions/verifyQuota',{method:'POST',headers:{Origin,'Content-Type':'application/json','x-nf-deploy-context':'deploy-preview','x-nf-deploy-id':'synthetic-deploy'},body:JSON.stringify({action:'start',deploy:Deploy})});
 expect((await createVerification(()=>Closed,factory)(incoming,operator())).status).toBe(404);expect(factory).not.toHaveBeenCalled();
});
it('does not accept deployment identity from headers, query or body, or from an omitted context',async()=>{
 const {factory}=storage(),handler=createVerification(()=>Closed,factory);
 const incoming=new Request(Origin+'/.netlify/functions/verifyQuota?context=deploy-preview',{method:'POST',headers:{Origin,'Content-Type':'application/json','x-nf-deploy-context':'deploy-preview','x-nf-deploy-id':'synthetic-deploy'},body:JSON.stringify({action:'start',deploy:Deploy})});
 expect((await handler(incoming,{user:operator().user})).status).toBe(404);expect((await handler(incoming)).status).toBe(404);
 expect((await handler(request({action:'start',deploy:Deploy}),operator())).status).toBe(400);expect(factory).not.toHaveBeenCalled();
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
