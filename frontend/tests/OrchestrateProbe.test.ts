// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createProbe} from '../../netlify/functions/orchestrateProbe';
import type {QuotaStore} from '../../netlify/evaluation/demoQuota';
import type {Transport} from '../../netlify/evaluation/watsonShadow';
import Prompts from '../../shared/orchestratePrompts.json';
import {ApprovedLiveOperations,LiveProbeAgent,LiveProbeVersion,ExceptionRisks,liveAccessReviewValid,liveProbeAuthorizationValid} from '../../netlify/evaluation/orchestrateProbePolicy';
const Origin='https://deploy-preview-4--clinicalagent.netlify.app';
const Now=Date.parse('2026-11-07T12:00:00Z');
const Thread='11111111-1111-4111-8111-111111111111';
const AccessReview={version:'1',agentId:LiveProbeAgent,agentVersion:LiveProbeVersion,environment:'live',apiUrl:'https://api.eu-de.watson-orchestrate.cloud.ibm.com/instances/SyntheticTenant',operations:ApprovedLiveOperations.map(operation=>({...operation})),collaborators:[],delegatedAgents:[],workflows:[],otherActionPaths:[],evidence:{reference:'SyntheticOfflineReview',reviewedAt:new Date(Now-1000).toISOString(),validUntil:new Date(Now+3600000).toISOString(),scope:'effectiveRuntimePermissions',caseSubmission:'blockedForConnectionProbe',downstreamInference:'blockedForConnectionProbe'}};
const Settings={ORCHESTRATE_PROBE_EXCEPTION_ENABLED:'false',ORCHESTRATE_PROBE_EXCEPTION_APPROVAL:'',ORCHESTRATE_PROBE_ACCESS_REVIEW:JSON.stringify(AccessReview),ORCHESTRATE_PROBE_ENABLED:'true',ORCHESTRATE_PROBE_KILL_SWITCH:'false',ORCHESTRATE_PROBE_TEST_UNTIL:'2026-11-07T12:20:00Z',ORCHESTRATE_PROBE_TOOLS_VERIFIED:'true',ORCHESTRATE_PROBE_PRIVACY_VERIFIED:'true',ORCHESTRATE_PROBE_USAGE_VERIFIED:'true',ORCHESTRATE_PROBE_QUOTA_VERIFIED:'true',ORCHESTRATE_EMBED_PREVIEW_ENABLED:'false',ORCHESTRATE_EMBED_KILL_SWITCH:'true',ORCHESTRATE_EMBED_PREVIEW_ID:'4',ORCHESTRATE_EMBED_PREVIEW_ORIGIN:Origin,ORCHESTRATE_EMBED_OPERATOR_IDS:'operator',OTEL_SDK_DISABLED:'true',ORCHESTRATE_API_URL:'https://api.eu-de.watson-orchestrate.cloud.ibm.com/instances/SyntheticTenant',ORCHESTRATE_AGENT_ID:LiveProbeAgent,ORCHESTRATE_ENVIRONMENT:'live',WATSONX_AI_AUTH_TYPE:'iam',WATSONX_AI_APIKEY:'SyntheticServerKey',WATSONX_AI_TIMEOUT_MS:'1000',ORCHESTRATE_ENABLED:'false',ENDO_DEMO_INFERENCE_ENABLED:'false',ENDO_DEMO_KILL_SWITCH:'true'};
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
it('accepts the reviewed EU-DE Live Agent Endo target only',async()=>{
 const host='api.eu-de.watson-orchestrate.cloud.ibm.com';
 const {handler,environment,transport}=fixture();
 environment.ORCHESTRATE_API_URL='https://'+host+'/instances/SyntheticTenant';
 environment.ORCHESTRATE_AGENT_ID='c6698d4e-a08d-4b77-bf05-139ff3b4c695';
 expect((await (await handler(request(),Context)).json()).status).toBe('PASS');
 expect(transport.mock.calls[1][0]).toBe(environment.ORCHESTRATE_API_URL+'/v1/orchestrate/'+environment.ORCHESTRATE_AGENT_ID+'/chat/completions');
 expect(new Headers(transport.mock.calls[2][1].headers).get('X-IBM-THREAD-ID')).toBe(Thread);
 // A valid regional endpoint with invalid non-URL config is not misclassified.
 const invalid=fixture();invalid.environment.ORCHESTRATE_API_URL=environment.ORCHESTRATE_API_URL;invalid.environment.ORCHESTRATE_ENVIRONMENT='draft';
 expect((await (await invalid.handler(request(),Context)).json()).reason).toBe('configuration');expect(invalid.transport).not.toHaveBeenCalled();expect(invalid.store).not.toHaveBeenCalled();
});
it.each([
 'https://api.eu-gb.watson-orchestrate.cloud.ibm.com/instances/SyntheticTenant',
 'https://api.eu-de.watson-orchestrate.cloud.ibm.com.evil.invalid/instances/SyntheticTenant',
 'https://dl.watson-orchestrate.ibm.com/instances/SyntheticTenant',
 'http://api.eu-de.watson-orchestrate.cloud.ibm.com/instances/SyntheticTenant',
 'https://api.eu-de.watson-orchestrate.cloud.ibm.com/instances/-tenant',
 'https://api.eu-de.watson-orchestrate.cloud.ibm.com/instances/SyntheticTenant/extra'
])('rejects unsafe regional probe targets before quota or IAM %#',async address=>{
 const {handler,environment,transport,store}=fixture();environment.ORCHESTRATE_API_URL=address;
 expect((await (await handler(request(),Context)).json()).reason).toBe('incorrectEndpoint');expect(transport).not.toHaveBeenCalled();expect(store).not.toHaveBeenCalled();
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

it('requires a separate reviewed access record even when every legacy verification flag is true',async()=>{
 const f=fixture();f.environment.ORCHESTRATE_PROBE_ACCESS_REVIEW='';
 const credentialRead=vi.fn(()=>{throw new Error('UnexpectedCredentialAccess');});Object.defineProperty(f.environment,'WATSONX_AI_APIKEY',{get:credentialRead});
 expect(await (await f.handler(request(),Context)).json()).toMatchObject({reason:'livePolicyRequired',authentication:'NOT_TESTED'});
 expect(f.store).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();expect(credentialRead).not.toHaveBeenCalled();
});
it.each(['extraTool','changedDestination','changedMethod','credentialMetadata','collaborators','delegatedAgents','workflows','otherActionPaths','expiredReview','futureReview','clinicalCaseAllowed','downstreamCallsAllowed','wrongAgent','wrongVersion','wrongInstance','wrongRegion'])('denies incompatible access-review inventory before storage/IAM: %s',async scenario=>{
 const f=fixture(),review:any=structuredClone(AccessReview);
 if(scenario==='extraTool')review.operations.push({...review.operations[0],tool:'UnexpectedTool'});
 else if(scenario==='changedDestination')review.operations[1].url='https://unexpected.invalid/api/v1/analyze';
 else if(scenario==='changedMethod')review.operations[0].method='POST';
 else if(scenario==='credentialMetadata')review.operations[0].authorization='SyntheticCredentialNeverReturned';
 else if(['collaborators','delegatedAgents','workflows','otherActionPaths'].includes(scenario))review[scenario]=['UnexpectedOperation'];
 else if(scenario==='expiredReview')review.evidence.validUntil=new Date(Now).toISOString();
 else if(scenario==='futureReview')review.evidence.reviewedAt=new Date(Now+1).toISOString();
 else if(scenario==='clinicalCaseAllowed')review.evidence.caseSubmission='allowed';
 else if(scenario==='downstreamCallsAllowed')review.evidence.downstreamInference='allowed';
 else if(scenario==='wrongAgent')review.agentId='22222222-2222-4222-8222-222222222222';
 else if(scenario==='wrongVersion')review.agentVersion='1.0.0';
 else if(scenario==='wrongInstance')review.apiUrl=review.apiUrl.replace('SyntheticTenant','OtherSyntheticTenant');
 else if(scenario==='wrongRegion')review.apiUrl=review.apiUrl.replace('eu-de','us-south');
 f.environment.ORCHESTRATE_PROBE_ACCESS_REVIEW=JSON.stringify(review);
 const log=vi.spyOn(console,'log'),error=vi.spyOn(console,'error');
 const report=await (await f.handler(request(),Context)).json();
 expect(report.reason).toBe('livePolicyRequired');expect(f.transport).not.toHaveBeenCalled();expect(f.store).not.toHaveBeenCalled();
 expect(JSON.stringify(report)).not.toMatch(/SyntheticCredential|SyntheticTenant|SyntheticOfflineReview|UnexpectedOperation|Bearer|access_token/);
 expect(log).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
});
it('rejects malformed, oversized and duplicate-key review records',()=>{
 for(const value of ['{}','null','x'.repeat(8193),Settings.ORCHESTRATE_PROBE_ACCESS_REVIEW.replace('"version":"1"','"version":"1","version":"1"')])expect(liveAccessReviewValid({...Settings,ORCHESTRATE_PROBE_ACCESS_REVIEW:value},Now)).toBe(false);
 expect(liveAccessReviewValid(Settings,Now)).toBe(true);
});
it('rechecks the reviewed inventory between turns without refunding tickets',async()=>{
 const f=fixture();f.transport.mockImplementation(async(address)=>{
  if(address.includes('/identity/token'))return json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600});
  f.environment.ORCHESTRATE_PROBE_ACCESS_REVIEW='';return json({thread_id:Thread,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'Blue Lantern acknowledged.'}}]});
 });
 const report=await (await f.handler(request(),Context)).json();expect(report.reason).toBe('disabled');expect(report.secondTurn).toBe('NOT_TESTED');expect(f.transport).toHaveBeenCalledTimes(2);
 expect([...f.records.keys()].filter(key=>key.startsWith('daily/'))).toHaveLength(1);
});
it('exhausted daily reservations reject before IAM without changing capacity',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(Now);
 const f=fixture(),day=new Date(Now).toISOString().slice(0,10);
 for(let i=0;i<2;i++)f.records.set('daily/'+day+'/'+i,{data:{reservationId:'44444444-4444-4444-8444-444444444444',createdAt:Now},etag:'occupied'});
 const report=await (await f.handler(request(),Context)).json();expect(report.reason).toBe('quotaRejected');expect(f.transport).not.toHaveBeenCalled();
 expect([...f.records.keys()].filter(key=>key.startsWith('daily/'))).toHaveLength(2);
});

// Synthetic approvals below exercise code only. No real approval or IBM access is implied.
function exceptionFixture(){
 const f=fixture(),review=structuredClone(AccessReview);
 review.evidence.scope='independentlyReviewedLiveBindings';review.evidence.caseSubmission='possibleUnderException';review.evidence.downstreamInference='possibleUnderException';
 const raw=JSON.stringify(review);f.environment.ORCHESTRATE_PROBE_ACCESS_REVIEW=raw;f.environment.ORCHESTRATE_PROBE_EXCEPTION_ENABLED='true';f.environment.ORCHESTRATE_PROBE_TOOLS_VERIFIED='false';f.environment.ORCHESTRATE_PROBE_USAGE_VERIFIED='false';
 const approval={version:'1',reference:'SyntheticOneTestApproval',test:'blueLanternTwoTurn',agentId:LiveProbeAgent,agentVersion:LiveProbeVersion,apiUrl:Settings.ORCHESTRATE_API_URL,previewId:'4',previewOrigin:Origin,operatorId:'operator',reviewHash:createHash('sha256').update(raw).digest('hex'),approvedAt:new Date(Now).toISOString(),expiresAt:Settings.ORCHESTRATE_PROBE_TEST_UNTIL,maxAgentCalls:2,maxAttempts:1,automaticRetries:0,noRealPatientData:true,acceptedRisks:[...ExceptionRisks]};
 f.environment.ORCHESTRATE_PROBE_EXCEPTION_APPROVAL=JSON.stringify(approval);return {...f,approval,review};
}
it('admits one mocked v2.0.0 exception attempt without claiming technical tool or spending verification',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(Now);const f=exceptionFixture(),before=JSON.stringify(f.environment);
 expect(liveProbeAuthorizationValid(f.environment,Now,'operator')).toBe(true);
 const report=await (await f.handler(request(),Context)).json();expect(report).toEqual({version:'1',status:'PASS',authentication:'PASS',firstTurn:'PASS',secondTurn:'PASS',continuity:'PASS',reason:'completed'});
 const calls=f.transport.mock.calls;expect(calls).toHaveLength(3);
 expect(JSON.parse(String(calls[1][1].body))).toEqual({messages:[{role:'user',content:Prompts.connectionProbe[0].text}],stream:false});
 expect(JSON.parse(String(calls[2][1].body))).toEqual({messages:[{role:'user',content:Prompts.connectionProbe[1].text}],stream:false});
 expect(new Headers(calls[2][1].headers).get('X-IBM-THREAD-ID')).toBe(Thread);expect(JSON.stringify(calls[2][1].body)).not.toContain('Blue Lantern');
 expect(JSON.stringify(report)).not.toMatch(/SyntheticOneTestApproval|operator|access_token|SyntheticServerKey|11111111|Blue Lantern|reviewHash/);
 expect(JSON.stringify(f.environment)).toBe(before);expect(f.environment.ORCHESTRATE_PROBE_TOOLS_VERIFIED).toBe('false');expect(f.environment.ORCHESTRATE_PROBE_USAGE_VERIFIED).toBe('false');
 expect((await (await f.handler(request(),Context)).json()).reason).toBe('quotaRejected');expect(f.transport).toHaveBeenCalledTimes(3);
 expect([...f.records.keys()].filter(key=>key.startsWith('daily/'))).toHaveLength(2);
});
it.each(['noApproval','oldVersion','wrongOperator','missingRisk','changedReview','wrongWindow','expired','future','extraMetadata','moreCalls','moreAttempts','retries','patientData','unknownDestination','unknownTool','collaborator','unreviewedBindings'])('fails closed on incompatible exception approval or v2 inventory: %s',async scenario=>{
 const f=exceptionFixture(),approval:any=structuredClone(f.approval),review:any=structuredClone(f.review);
 if(scenario==='oldVersion')approval.agentVersion='1.0.0';
 else if(scenario==='wrongOperator')approval.operatorId='anotherOperator';
 else if(scenario==='missingRisk')approval.acceptedRisks.pop();
 else if(scenario==='changedReview')approval.reviewHash='0'.repeat(64);
 else if(scenario==='wrongWindow')approval.expiresAt=new Date(Now+120000).toISOString();
 else if(scenario==='expired')approval.expiresAt=new Date(Now).toISOString();
 else if(scenario==='future')approval.approvedAt=new Date(Now+1).toISOString();
 else if(scenario==='extraMetadata')approval.authorization='SyntheticPrivateMetadata';
 else if(scenario==='moreCalls')approval.maxAgentCalls=3;
 else if(scenario==='moreAttempts')approval.maxAttempts=2;
 else if(scenario==='retries')approval.automaticRetries=1;
 else if(scenario==='patientData')approval.noRealPatientData=false;
 else if(scenario==='unknownDestination')review.operations[0].url='https://unexpected.invalid/modules';
 else if(scenario==='unknownTool')review.operations.push({...review.operations[0],tool:'OtherTool'});
 else if(scenario==='collaborator')review.collaborators=['OtherAgent'];
 else if(scenario==='unreviewedBindings')review.evidence.scope='agentSelfReport';
 f.environment.ORCHESTRATE_PROBE_ACCESS_REVIEW=JSON.stringify(review);
 if(['unknownDestination','unknownTool','collaborator','unreviewedBindings'].includes(scenario))approval.reviewHash=createHash('sha256').update(f.environment.ORCHESTRATE_PROBE_ACCESS_REVIEW).digest('hex');
 f.environment.ORCHESTRATE_PROBE_EXCEPTION_APPROVAL=scenario==='noApproval'?'':JSON.stringify(approval);
 expect((await (await f.handler(request(),Context)).json()).reason).toBe('livePolicyRequired');expect(f.store).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
});
it('rejects v1 review inventory even with a freshly supplied approval hash',async()=>{
 const f=exceptionFixture(),review={...f.review,agentVersion:'1.0.0'};f.environment.ORCHESTRATE_PROBE_ACCESS_REVIEW=JSON.stringify(review);
 f.environment.ORCHESTRATE_PROBE_EXCEPTION_APPROVAL=JSON.stringify({...f.approval,reviewHash:createHash('sha256').update(f.environment.ORCHESTRATE_PROBE_ACCESS_REVIEW).digest('hex')});
 expect((await (await f.handler(request(),Context)).json()).reason).toBe('livePolicyRequired');expect(f.transport).not.toHaveBeenCalled();expect(f.store).not.toHaveBeenCalled();
});
it('rejects risk acceptance masquerading as technical verification',async()=>{
 for(const key of ['ORCHESTRATE_PROBE_TOOLS_VERIFIED','ORCHESTRATE_PROBE_USAGE_VERIFIED'] as const){const f=exceptionFixture();f.environment[key]='true';expect((await f.handler(request(),Context)).status).toBe(404);expect(f.transport).not.toHaveBeenCalled();expect(f.store).not.toHaveBeenCalled();}
});
it('does not activate an exception through its approval record alone',async()=>{
 const f=exceptionFixture();f.environment.ORCHESTRATE_PROBE_EXCEPTION_ENABLED='false';expect((await f.handler(request(),Context)).status).toBe(404);expect(f.store).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
});
it('requires a same-UTC-day approval window to preserve the existing single-attempt ticket guarantee',()=>{
 const f=exceptionFixture(),issued=Date.parse('2026-11-07T23:50:00Z'),expiry='2026-11-08T00:10:00Z';
 f.environment.ORCHESTRATE_PROBE_TEST_UNTIL=expiry;const review=structuredClone(f.review);review.evidence.reviewedAt=new Date(issued).toISOString();review.evidence.validUntil=new Date(issued+3600000).toISOString();
 f.environment.ORCHESTRATE_PROBE_ACCESS_REVIEW=JSON.stringify(review);f.environment.ORCHESTRATE_PROBE_EXCEPTION_APPROVAL=JSON.stringify({...f.approval,reviewHash:createHash('sha256').update(f.environment.ORCHESTRATE_PROBE_ACCESS_REVIEW).digest('hex'),approvedAt:new Date(issued).toISOString(),expiresAt:expiry});
 expect(liveProbeAuthorizationValid(f.environment,issued,'operator')).toBe(false);
});
it('rechecks exception revocation between turns and never retries or refunds',async()=>{
 const f=exceptionFixture();f.transport.mockImplementation(async address=>{if(address.includes('/identity/token'))return json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600});f.environment.ORCHESTRATE_PROBE_EXCEPTION_APPROVAL='';return json({thread_id:Thread,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'Blue Lantern acknowledged.'}}]});});
 const report=await (await f.handler(request(),Context)).json();expect(report.reason).toBe('disabled');expect(report.secondTurn).toBe('NOT_TESTED');expect(f.transport).toHaveBeenCalledTimes(2);
});
