// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {createProbe} from '../../netlify/functions/orchestrateProbe';
import type {QuotaStore} from '../../netlify/evaluation/demoQuota';
import type {Transport} from '../../netlify/evaluation/watsonShadow';
import Prompts from '../../shared/orchestratePrompts.json';
const Origin='https://deploy-preview-4--clinicalagent.netlify.app';
const Now=Date.parse('2026-11-07T12:00:00Z');
const Thread='11111111-1111-4111-8111-111111111111';
const Settings={ORCHESTRATE_PROBE_ENABLED:'true',ORCHESTRATE_PROBE_KILL_SWITCH:'false',ORCHESTRATE_PROBE_TEST_UNTIL:'2026-11-07T12:20:00Z',ORCHESTRATE_PROBE_TOOLS_VERIFIED:'true',ORCHESTRATE_PROBE_PRIVACY_VERIFIED:'true',ORCHESTRATE_PROBE_USAGE_VERIFIED:'true',ORCHESTRATE_PROBE_QUOTA_VERIFIED:'true',ORCHESTRATE_EMBED_PREVIEW_ENABLED:'false',ORCHESTRATE_EMBED_KILL_SWITCH:'true',ORCHESTRATE_EMBED_PREVIEW_ID:'4',ORCHESTRATE_EMBED_PREVIEW_ORIGIN:Origin,ORCHESTRATE_EMBED_OPERATOR_IDS:'operator',OTEL_SDK_DISABLED:'true',ORCHESTRATE_API_URL:'https://api.dl.watson-orchestrate.ibm.com/instances/SyntheticTenant',ORCHESTRATE_AGENT_ID:'22222222-2222-4222-8222-222222222222',ORCHESTRATE_ENVIRONMENT:'live',WATSONX_AI_AUTH_TYPE:'iam',WATSONX_AI_APIKEY:'SyntheticServerKey',WATSONX_AI_TIMEOUT_MS:'1000',ORCHESTRATE_ENABLED:'false',ENDO_DEMO_INFERENCE_ENABLED:'false',ENDO_DEMO_KILL_SWITCH:'true'};
const Context={user:{id:'operator',expiresAt:new Date(Now+600000)},deploy:{id:'SyntheticDeploy',context:'deploy-preview',published:false}};
const json=(contents:unknown)=>new Response(JSON.stringify(contents),{headers:{'content-type':'application/json'}});
const request=(body='{"action":"probe"}')=>new Request(Origin+'/.netlify/functions/orchestrateProbe',{method:'POST',headers:{Origin,'Content-Type':'application/json'},body});
function fixture(){
 const environment={...Settings},records=new Map<string,{data:unknown;etag:string}>();
 const storage:QuotaStore={async set(key,content){if(records.has(key))return {modified:false};const etag=String(records.size+1);records.set(key,{data:JSON.parse(content),etag});return {modified:true,etag};},async getWithMetadata(key){return records.get(key)??null;}};
 const store=vi.fn(async()=>storage);
 const transport=vi.fn<Transport>(async(address,init)=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):json({thread_id:Thread,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:new Headers(init.headers).get('X-IBM-THREAD-ID')?'Blue Lantern':'Blue Lantern acknowledged.'}}]}));
 const handler=createProbe({settings:()=>environment,store,transport,clock:()=>Now});return {environment,records,store,transport,handler};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it('runs two real-shaped mocked turns with one IAM identity and server-only thread continuity',async()=>{
 const {handler,transport,environment,records}=fixture();const before=JSON.stringify(environment);
 const response=await handler(request(),Context),report=await response.json();expect(response.status).toBe(200);
 expect(report).toEqual({version:'1',status:'PASS',authentication:'PASS',firstTurn:'PASS',secondTurn:'PASS',continuity:'PASS',reason:'completed'});
 const calls=transport.mock.calls;expect(calls).toHaveLength(3);expect(calls[0][0]).toBe('https://iam.cloud.ibm.com/identity/token');
 expect(calls[1][0]).toBe(Settings.ORCHESTRATE_API_URL+'/v1/orchestrate/'+Settings.ORCHESTRATE_AGENT_ID+'/chat/completions');
 const first=JSON.parse(String(calls[1][1].body)),second=JSON.parse(String(calls[2][1].body));
 expect(first).toEqual({messages:[{role:'user',content:Prompts.connectionProbe[0].text}],stream:false});
 expect(second).toEqual({messages:[{role:'user',content:Prompts.connectionProbe[1].text}],stream:false});
 expect(new Headers(calls[1][1].headers).has('X-IBM-THREAD-ID')).toBe(false);expect(new Headers(calls[2][1].headers).get('X-IBM-THREAD-ID')).toBe(Thread);expect(JSON.stringify(second)).not.toContain('Blue Lantern');expect(new Headers(calls[1][1].headers).get('Authorization')).toBe(new Headers(calls[2][1].headers).get('Authorization'));
 expect(JSON.stringify(environment)).toBe(before);expect([...records.keys()].filter(key=>key.startsWith('daily/'))).toHaveLength(2);
 for(const forbidden of ['SyntheticBearer','SyntheticServerKey',Thread,'Blue Lantern','SyntheticTenant','receipt'])expect(JSON.stringify(report)).not.toContain(forbidden);
 expect(JSON.stringify([...records.values()])).not.toMatch(/Blue Lantern|message|prompt|caseInput/);
});
it('is disabled at import/construction and for missing or unverified gates without storage or HTTP',async()=>{
 const network=vi.fn();vi.stubGlobal('fetch',network);
 expect((await createProbe()(request(),Context)).status).toBe(404);expect(network).not.toHaveBeenCalled();
 for(const name of ['ORCHESTRATE_PROBE_ENABLED','ORCHESTRATE_PROBE_TOOLS_VERIFIED','ORCHESTRATE_PROBE_PRIVACY_VERIFIED','ORCHESTRATE_PROBE_USAGE_VERIFIED','ORCHESTRATE_PROBE_QUOTA_VERIFIED','OTEL_SDK_DISABLED']){
  const {handler,environment,transport,store}=fixture();environment[name as keyof typeof environment]='false';expect((await handler(request(),Context)).status).toBe(404);expect(transport).not.toHaveBeenCalled();expect(store).not.toHaveBeenCalled();
 }
});
it('rejects production, published previews, expired operators and spoofed identity',async()=>{
 const {handler,transport}=fixture();
 for(const context of [{deploy:Context.deploy},{...Context,user:{...Context.user,id:'other'}},{...Context,user:{...Context.user,expiresAt:new Date(Now)}}]){
  const req=request();req.headers.set('x-user-id','operator');expect((await handler(req,context)).status).toBe(403);
 }
 for(const deploy of [{...Context.deploy,context:'production'},{...Context.deploy,published:true}])expect((await handler(request(),{...Context,deploy})).status).toBe(404);
 expect(transport).not.toHaveBeenCalled();
});
it.each(['{"action":"probe","text":"SyntheticPatientText"}','{"action":"probe","threadId":"forged"}','{"action":"probe","uploads":[]}','{"action":"probe","action":"probe"}','x'.repeat(65)])('accepts no caller text, thread, uploads or malformed input %#',async body=>{
 const {handler,transport,store}=fixture();const response=await handler(request(body),Context);expect(response.status).toBe(400);expect(transport).not.toHaveBeenCalled();expect(store).not.toHaveBeenCalled();expect(await response.text()).not.toContain('SyntheticPatientText');
});
it('admits only one simultaneous two-turn probe and prevents later session replay',async()=>{
 const {handler,transport}=fixture();const responses=await Promise.all(Array.from({length:20},()=>handler(request(),Context)));const reports=await Promise.all(responses.map(response=>response.json()));
 expect(reports.filter(report=>report.status==='PASS')).toHaveLength(1);expect(reports.filter(report=>report.reason==='quotaRejected')).toHaveLength(19);
 expect(transport.mock.calls.filter(([address])=>!address.includes('/identity/token'))).toHaveLength(2);
 expect((await (await handler(request(),Context)).json()).reason).toBe('quotaRejected');
});
it('fails closed on unavailable quota storage before IAM',async()=>{
 const {environment,transport}=fixture();const handler=createProbe({settings:()=>environment,store:async()=>{throw new Error('SyntheticStorageSecret');},transport,clock:()=>Now});
 const report=await (await handler(request(),Context)).json();expect(report.reason).toBe('quotaUnavailable');expect(transport).not.toHaveBeenCalled();
});
it.each([[401,'authenticationFailure'],[403,'authorizationFailure'],[404,'endpointOrAgentUnavailable'],[503,'providerUnavailable']])('classifies agent HTTP failure %s without body/status disclosure',async(status,reason)=>{
 const {handler,transport}=fixture();transport.mockImplementation(async address=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):new Response('SyntheticProviderSecret',{status:Number(status)}));
 const report=await (await handler(request(),Context)).json();expect(report.reason).toBe(reason);expect(JSON.stringify(report)).not.toContain('SyntheticProviderSecret');expect(JSON.stringify(report)).not.toContain(String(status));expect(transport).toHaveBeenCalledTimes(2);
});
it('distinguishes IAM rejection from agent authorization and invalid endpoint configuration',async()=>{
 const first=fixture();first.transport.mockResolvedValue(new Response('SyntheticAuthSecret',{status:401}));const report=await (await first.handler(request(),Context)).json();expect(report).toMatchObject({authentication:'FAIL',reason:'authenticationFailure'});expect(first.transport).toHaveBeenCalledOnce();
 const second=fixture();second.environment.ORCHESTRATE_API_URL='https://dl.watson-orchestrate.ibm.com';expect((await (await second.handler(request(),Context)).json()).reason).toBe('incorrectEndpoint');expect(second.transport).not.toHaveBeenCalled();
});
it('detects failed contextual answer and rejects malformed provider payloads',async()=>{
 const first=fixture();first.transport.mockImplementation(async(address,init)=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):json({thread_id:Thread,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:new Headers(init.headers).get('X-IBM-THREAD-ID')?'I do not know.':'Blue Lantern acknowledged.'}}]}));
 expect(await (await first.handler(request(),Context)).json()).toMatchObject({firstTurn:'PASS',secondTurn:'FAIL',continuity:'FAIL',reason:'continuityFailure'});
 const second=fixture();second.transport.mockImplementation(async address=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):json({unknown:'SyntheticProviderSecret'}));expect((await (await second.handler(request(),Context)).json()).reason).toBe('providerResponse');
});
it('handles timeout, network failure and client cancellation without retries or logs',async()=>{
 const logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')];
 const first=fixture();first.environment.WATSONX_AI_TIMEOUT_MS='100';first.transport.mockImplementation(async(address,init)=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):new Promise((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(new Error('SyntheticTimeoutSecret')),{once:true})));
 expect((await (await first.handler(request(),Context)).json()).reason).toBe('timeout');expect(first.transport).toHaveBeenCalledTimes(2);
 const second=fixture();second.transport.mockRejectedValue(new TypeError('SyntheticNetworkSecret'));expect((await (await second.handler(request(),Context)).json()).reason).toBe('networkFailure');expect(second.transport).toHaveBeenCalledOnce();
 const third=fixture(),controller=new AbortController();controller.abort();const req=new Request(request(),{signal:controller.signal});const response=await third.handler(req,Context);expect(response.status).toBe(499);expect(await response.text()).toBe('');expect(third.transport).not.toHaveBeenCalled();
 for(const log of logs)expect(log).not.toHaveBeenCalled();
});
it('rejects expired windows and stops on a revoked probe gate between turns',async()=>{
 const first=fixture();first.environment.ORCHESTRATE_PROBE_TEST_UNTIL='2026-11-07T11:59:00Z';expect((await first.handler(request(),Context)).status).toBe(404);
 const second=fixture();const original=second.transport.getMockImplementation()!;second.transport.mockImplementation(async(address,init)=>{const reply=await original(address,init);if(!address.includes('/identity/token'))second.environment.ORCHESTRATE_PROBE_KILL_SWITCH='true';return reply;});
 expect((await (await second.handler(request(),Context)).json()).reason).toBe('disabled');expect(second.transport.mock.calls.filter(([address])=>!address.includes('/identity/token'))).toHaveLength(1);
});

it('keeps browser-supplied thread headers outside the trusted provider turn',async()=>{
 const {handler,transport}=fixture(),req=request();req.headers.set('X-IBM-THREAD-ID','33333333-3333-4333-8333-333333333333');
 expect((await (await handler(req,Context)).json()).status).toBe('PASS');
 expect(new Headers(transport.mock.calls[1][1].headers).has('X-IBM-THREAD-ID')).toBe(false);
 expect(new Headers(transport.mock.calls[2][1].headers).get('X-IBM-THREAD-ID')).toBe(Thread);
});

it('rejects a changed provider thread and burns the failed reservation without retry',async()=>{
 const {handler,transport}=fixture();const original=transport.getMockImplementation()!;
 transport.mockImplementation(async(address,init)=>new Headers(init.headers).has('X-IBM-THREAD-ID')?json({thread_id:'33333333-3333-4333-8333-333333333333',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'Blue Lantern'}}]}):original(address,init));
 expect(await (await handler(request(),Context)).json()).toMatchObject({status:'FAIL',firstTurn:'PASS',secondTurn:'FAIL',continuity:'NOT_TESTED',reason:'providerResponse'});
 expect(transport).toHaveBeenCalledTimes(3);
 expect((await (await handler(request(),Context)).json()).reason).toBe('quotaRejected');
 expect(transport).toHaveBeenCalledTimes(3);
});

it('stops before turn two when the platform operator expires',async()=>{
 const {environment,store,transport}=fixture();let now=Now;const original=transport.getMockImplementation()!;
 transport.mockImplementation(async(address,init)=>{const reply=await original(address,init);if(!address.includes('/identity/token'))now=Context.user.expiresAt.getTime();return reply;});
 const handler=createProbe({settings:()=>environment,store,transport,clock:()=>now});
 expect((await (await handler(request(),Context)).json()).reason).toBe('disabled');expect(transport).toHaveBeenCalledTimes(2);
});

it('cancels an active model request without a partial report or second turn',async()=>{
 const {handler,transport}=fixture(),abort=new AbortController();let operation:AbortSignal|undefined;
 transport.mockImplementation(async(address,init)=>{if(address.includes('/identity/token'))return json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600});operation=init.signal??undefined;return new Promise((_resolve,reject)=>operation?.addEventListener('abort',()=>reject(new Error('SyntheticPrivateError')),{once:true}));});
 const pending=handler(new Request(request(),{signal:abort.signal}),Context);
 await vi.waitFor(()=>expect(operation).toBeDefined());abort.abort();const response=await pending;
 expect(response.status).toBe(499);expect(await response.text()).toBe('');expect(operation?.aborted).toBe(true);expect(transport).toHaveBeenCalledTimes(2);
});

it('denies a thread already owned by another server visit',async()=>{
 const {handler,transport,records}=fixture();records.set('thread/'+Thread,{data:{ownerId:'33333333-3333-4333-8333-333333333333'},etag:'existing'});
 const report=await (await handler(request(),Context)).json();expect(report.status).toBe('FAIL');expect(report.secondTurn).toBe('NOT_TESTED');expect(transport).toHaveBeenCalledTimes(2);
});
