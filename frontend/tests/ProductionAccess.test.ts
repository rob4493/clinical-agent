// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Transport} from '../../netlify/evaluation/watsonShadow';
import {createPublicConverse as createConverse,config} from '../../netlify/evaluation/publicConverse';
import {createVisitorAccess,isProductionRequest,productionWindow,ProductionOrigin,VisitorCookie} from '../../netlify/evaluation/productionAccess';
import {createProductionConversation} from '../../netlify/evaluation/productionConversation';
import {validateConversationTicket,type ConversationWindow} from '../../netlify/evaluation/conversationQuota';
import type {QuotaStore} from '../../netlify/evaluation/demoQuota';
const Now=Date.parse('2026-11-16T18:00:00Z');
const Settings={ENDO_CHAT_ENABLED:'true',ENDO_CHAT_KILL_SWITCH:'false',ENDO_CHAT_TOOL_POLICY:'approved-operations-enforced',ENDO_CHAT_PROVIDER_ALLOWANCE:'reviewed',ENDO_CHAT_REVIEW_REFERENCE:'SyntheticReviewedFixture',ENDO_CHAT_STARTED_AT:new Date(Now-1000).toISOString(),ENDO_CHAT_UNTIL:new Date(Now+3600000).toISOString(),ENDO_CHAT_DAILY_CALL_LIMIT:'50',ENDO_CHAT_DAILY_SESSION_LIMIT:'20',ENDO_CHAT_VISITOR_CALL_LIMIT:'12',ENDO_CHAT_VISITOR_SESSION_LIMIT:'3',ENDO_CHAT_NETWORK_CALL_LIMIT:'20',ENDO_CHAT_NETWORK_SESSION_LIMIT:'8',ENDO_CHAT_ACCESS_CODE:'SyntheticDemoAccessCode123',ENDO_CHAT_SESSION_SECRET:'SyntheticSessionSecretNeverUseInProduction123',ORCHESTRATE_ENABLED:'false',ENDO_DEMO_INFERENCE_ENABLED:'false',ENDO_DEMO_KILL_SWITCH:'true',OTEL_SDK_DISABLED:'true',ORCHESTRATE_API_URL:'https://api.eu-de.watson-orchestrate.cloud.ibm.com/instances/SyntheticTenant',ORCHESTRATE_AGENT_ID:'c6698d4e-a08d-4b77-bf05-139ff3b4c695',ORCHESTRATE_ENVIRONMENT:'live',WATSONX_AI_AUTH_TYPE:'iam',WATSONX_AI_APIKEY:'SyntheticServerKey',WATSONX_AI_TIMEOUT_MS:'1000'};
const Context={ip:'192.0.2.1',deploy:{id:'ProductionDeploy',context:'production',published:true}};
function fixture(){
 const environment={...Settings},records=new Map<string,{data:unknown;etag:string}>();let now=Now;
 const store:QuotaStore={async set(key,content){validateConversationTicket(key,content);if(records.has(key))return {modified:false};const record={data:JSON.parse(content),etag:String(records.size+1)};records.set(key,record);return {modified:true,etag:record.etag};},async getWithMetadata(key){validateConversationTicket(key);return records.get(key)??null;}};
 const provider=vi.fn<Transport>(async()=>{throw new Error('No provider request expected');}),service=createProductionConversation({environment,clock:()=>now,store:async()=>store,transport:provider}),handler=createConverse({environment,clock:()=>now,service});
 const request=(payload:unknown,headers:Record<string,string>={},origin=ProductionOrigin)=>new Request(origin+'/api/v1/conversation',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});
 return {environment,records,provider,service,handler,request,setNow:(value:number)=>{now=value;}};
}
it('defaults disabled, permits only an approved bounded window and never interprets a flag as proof of remote enforcement',()=>{
 expect(productionWindow({},Now)).toBeNull();expect(productionWindow(Settings,Now)).toMatchObject({dailyCalls:50,dailySessions:20} satisfies Partial<ConversationWindow>);
});
it('binds the rate rule to the exact application route and blocks alternate Function URLs',async()=>{
 expect(config.path).toBe('/api/v1/conversation');expect(config.rateLimit).toMatchObject({windowLimit:12,windowSize:60,aggregateBy:['ip','domain']});
 const f=fixture(),request=new Request(ProductionOrigin+'/.netlify/functions/converse',{method:'POST',headers:{Origin:ProductionOrigin,'Content-Type':'application/json'},body:JSON.stringify({version:'2',action:'start',syntheticOnly:true})});
 expect(isProductionRequest(request,Context)).toBe(false);expect((await f.handler(request,Context)).status).toBe(404);expect(f.records.size).toBe(0);expect(f.provider).not.toHaveBeenCalled();
});
it.each([
 {ENDO_CHAT_ENABLED:'false'},{ENDO_CHAT_KILL_SWITCH:'true'},{ENDO_CHAT_TOOL_POLICY:'unverified'},{ENDO_CHAT_SESSION_SECRET:''},{ENDO_CHAT_PROVIDER_ALLOWANCE:'unverified'},{ENDO_CHAT_REVIEW_REFERENCE:''},{WATSONX_AI_APIKEY:''},
 {ENDO_CHAT_DAILY_CALL_LIMIT:'1000'},{ENDO_CHAT_DAILY_SESSION_LIMIT:'201'},{ENDO_CHAT_UNTIL:new Date(Now).toISOString()},{ENDO_CHAT_STARTED_AT:new Date(Now+1).toISOString()},{ENDO_CHAT_UNTIL:new Date(Now+604800000).toISOString()},
 {ORCHESTRATE_ENABLED:'true'},{ENDO_DEMO_INFERENCE_ENABLED:'true'},{ENDO_DEMO_KILL_SWITCH:'false'},{OTEL_SDK_DISABLED:'false'},{ORCHESTRATE_ENVIRONMENT:'draft'},{ORCHESTRATE_AGENT_ID:'11111111-1111-4111-8111-111111111111'},
 {ORCHESTRATE_API_URL:'https://api.us-south.watson-orchestrate.cloud.ibm.com/instances/SyntheticTenant'}
])('fails closed for unsafe or incomplete production settings %j',async changes=>{
 const f=fixture();Object.assign(f.environment,changes);const response=await f.handler(f.request({version:'2',action:'start',syntheticOnly:true}),Context);expect(response.status).toBe(404);expect(f.records.size).toBe(0);expect(f.provider).not.toHaveBeenCalled();
});
it.each([{}, {deploy:{...Context.deploy,published:false}}, {deploy:{...Context.deploy,context:'deploy-preview'}},{deploy:{...Context.deploy,id:''}}])('rejects missing or non-published production identity %j',context=>{
 expect(isProductionRequest(new Request(ProductionOrigin+'/api/v1/conversation'),context)).toBe(false);
});
it('checks capability without cookies, storage or provider requests',async()=>{
 const f=fixture(),response=await f.handler(new Request(ProductionOrigin+'/api/v1/conversation'),Context);expect(await response.json()).toMatchObject({version:'2',status:'available',accessCodeRequired:false});expect(response.headers.has('Set-Cookie')).toBe(false);expect(f.records.size).toBe(0);expect(f.provider).not.toHaveBeenCalled();
});
it('issues only secure same-site HttpOnly visitor cookies without a login or code, with synthetic attestation',async()=>{
 const f=fixture(),response=await f.handler(f.request({version:'2',action:'start',syntheticOnly:true}),Context);expect(response.status).toBe(200);const reply=await response.json(),cookie=response.headers.get('Set-Cookie')!;expect(cookie).toContain(VisitorCookie+'=');expect(cookie).toContain('Secure; HttpOnly; SameSite=Strict');expect(cookie).toContain('Path=/');expect(cookie).not.toContain(Settings.ENDO_CHAT_ACCESS_CODE);expect(JSON.stringify(reply)).not.toContain('Synthetic');expect(f.provider).not.toHaveBeenCalled();
 const visitor=createVisitorAccess(f.environment,()=>Now,Context.ip).read(cookie);expect(visitor?.until).toBeLessThanOrEqual(Now+3600000);expect(visitor?.id).toMatch(/^[a-f0-9-]{36}$/);
});
it('rejects caller identity, browser identity headers, arbitrary thread IDs, uploads and automatic case objects',async()=>{
 const f=fixture();for(const payload of [
  {version:'2',action:'start',syntheticOnly:true,visitorId:randomUUID()},
  {version:'2',action:'start',syntheticOnly:false},
  {version:'2',action:'start',syntheticOnly:true,caseInput:{}},
  {version:'2',action:'turn',receipt:'unapproved',message:'hello',history:[],threadId:'unapproved'},
  {version:'2',action:'turn',receipt:'unapproved',message:'hello',history:[],uploads:[]}
 ]){const response=await f.handler(f.request(payload,{'X-Nf-User-Id':'operator','X-Endo-Authorized':'true'}),Context);expect(response.ok).toBe(false);expect(response.headers.has('Set-Cookie')).toBe(false);}
 expect(f.provider).not.toHaveBeenCalled();
});
it('rejects cross-site requests and deploy aliases even with a valid visitor cookie',async()=>{
 const f=fixture(),payload={version:'2',action:'start',syntheticOnly:true};expect((await f.handler(f.request(payload,{Origin:'https://unapproved.example'}),Context)).ok).toBe(false);expect((await f.handler(f.request(payload,{},'https://deploy-preview-4--clinicalagent.netlify.app'),Context)).status).toBe(404);expect(f.records.size).toBe(0);
});
it('rejects tampered, duplicate, expired and old-window visitor cookies',()=>{
 const env={...Settings};let now=Now;const access=createVisitorAccess(env,()=>now,Context.ip),issued=access.issue()!,cookie=issued.cookie.split(';')[0];expect(access.read(cookie)).toEqual(issued.visitor);expect(access.read(cookie+'A')).toBeNull();expect(access.read(cookie+'; '+cookie)).toBeNull();now=Now+3600001;expect(access.read(cookie)).toBeNull();now=Now;env.ENDO_CHAT_STARTED_AT=new Date(Now-2).toISOString();expect(access.read(cookie)).toBeNull();
});
it('prevents cross-visitor receipt replay before storage or provider access',async()=>{
 const f=fixture(),payload={version:'2',action:'start',syntheticOnly:true},one=await f.handler(f.request(payload),Context),first=await one.json(),two=await f.handler(f.request(payload),Context),cookie=two.headers.get('Set-Cookie')!.split(';')[0];const response=await f.handler(f.request({version:'2',action:'turn',message:'general education',receipt:first.receipt,history:[]},{Cookie:cookie}),Context);expect(response.status).toBe(422);expect(f.provider).not.toHaveBeenCalled();
});
it('completes mocked cookie-authenticated first and follow-up turns with the same server-owned IBM thread',async()=>{
 const f=fixture(),thread=randomUUID();
 f.provider.mockImplementation(async(address)=>new Response(JSON.stringify(address.includes('/identity/token')?{access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}:{thread_id:thread,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'General educational discussion only.'}}]}),{headers:{'Content-Type':'application/json'}}));
 const start=await f.handler(f.request({version:'2',action:'start',syntheticOnly:true}),Context),session=await start.json(),cookie=start.headers.get('Set-Cookie')!.split(';')[0];
 const first=await f.handler(f.request({version:'2',action:'turn',receipt:session.receipt,message:'what is endometriosis?',history:[]},{Cookie:cookie}),Context),one=await first.json();expect(first.status).toBe(200);expect(one.state).toBe('replied');
 const second=await f.handler(f.request({version:'2',action:'turn',receipt:one.receipt,message:'explain more simply',history:['what is endometriosis?']},{Cookie:cookie}),Context);expect(second.status).toBe(200);expect(await second.json()).toMatchObject({state:'replied'});
 const calls=f.provider.mock.calls.filter(([address])=>!address.includes('/identity/token'));expect(calls).toHaveLength(2);expect(new Headers(calls[1][1].headers).get('X-IBM-THREAD-ID')).toBe(thread);expect(JSON.parse(String(calls[1][1].body))).toEqual({messages:[{role:'user',content:'explain more simply'}],stream:false});
 expect(JSON.stringify(one)).not.toContain(thread);expect(JSON.stringify([...f.records.values()])).not.toContain('what is endometriosis');
});

it('binds visitor cookies to trusted runtime IP, never spoofable request headers',async()=>{const f=fixture(),start=await f.handler(f.request({version:'2',action:'start',syntheticOnly:true}),Context),session=await start.json(),cookie=start.headers.get('Set-Cookie')!.split(';')[0];expect(createVisitorAccess(f.environment,()=>Now,'198.51.100.2').read(cookie)).toBeNull();const reply=await f.handler(f.request({version:'2',action:'turn',receipt:session.receipt,message:'fictional education',history:[]},{Cookie:cookie,'X-Forwarded-For':Context.ip,'X-Nf-Client-Connection-Ip':Context.ip}),{...Context,ip:'198.51.100.2'});expect(reply.ok).toBe(false);expect(f.provider).not.toHaveBeenCalled();});
it('fails closed without trusted runtime IP and never uses caller visitor identities',async()=>{const f=fixture(),{ip,...withoutIp}=Context;void ip;const response=await f.handler(f.request({version:'2',action:'start',syntheticOnly:true},{'X-Forwarded-For':Context.ip}),withoutIp);expect(response.status).toBe(404);expect(f.records.size).toBe(0);});
it('caps session creation across fresh cookies on the same network',async()=>{const f=fixture();f.environment.ENDO_CHAT_NETWORK_SESSION_LIMIT='2';for(let i=0;i<2;i++)expect((await f.handler(f.request({version:'2',action:'start',syntheticOnly:true}),Context)).status).toBe(200);const blocked=await f.handler(f.request({version:'2',action:'start',syntheticOnly:true}),Context);expect(blocked.status).toBe(429);expect(f.provider).not.toHaveBeenCalled();expect(JSON.stringify([...f.records])).not.toContain(Context.ip);});
it('cannot activate from browser flags or approval fields',async()=>{const f=fixture();f.environment.ENDO_CHAT_TOOL_POLICY='unverified';const response=await f.handler(f.request({version:'2',action:'start',syntheticOnly:true,toolsVerified:true}),Context);expect(response.status).toBe(404);expect(f.records.size).toBe(0);});
