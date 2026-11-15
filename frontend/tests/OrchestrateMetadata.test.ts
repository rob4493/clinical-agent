// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {createIamVerification} from '../../netlify/functions/verifyIam';
import {ApprovedLiveOperations,LiveProbeAgent} from '../../netlify/evaluation/orchestrateProbePolicy';
const Now=Date.parse('2026-11-14T12:00:00Z'),Origin='https://deploy-preview-4--clinicalagent.netlify.app';
const Base='https://api.eu-de.watson-orchestrate.cloud.ibm.com/instances/SyntheticTenant';
const Context={user:{id:'operator',expiresAt:new Date(Now+60000)},deploy:{id:'synthetic-deploy',context:'deploy-preview',published:false}};
const request=(action='metadata')=>new Request(Origin+'/.netlify/functions/verifyIam',{method:'POST',headers:{Origin,'Content-Type':'application/json'},body:JSON.stringify({action})});
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
function fixture(change:Record<string,string|undefined>={}){
 const settings={...Settings,ORCHESTRATE_METADATA_DIAGNOSTIC_ENABLED:'true',ORCHESTRATE_PROBE_EXCEPTION_ENABLED:'false',ORCHESTRATE_API_URL:Base,ORCHESTRATE_AGENT_ID:LiveProbeAgent,ORCHESTRATE_ENVIRONMENT:'live',...change};
 const tools=ApprovedLiveOperations.map((operation,index)=>({id:'tool-'+index,name:operation.tool,binding:{openapi:{http_method:operation.method,http_path:new URL(operation.url).pathname,security:[],servers:['https://clinicalagent.netlify.app']}},is_async:false}));
 const replies=new Map<string,unknown>([
  ['/agents/'+LiveProbeAgent+'/environment',[{name:'live',id:'live-env',current_version:'2.0.0'}]],
  ['/agents/'+LiveProbeAgent+'/releases/status?environment_id=live-env',{deployment_status:'success'}],
  ['/agents/'+LiveProbeAgent,{id:LiveProbeAgent,tools:['tool-0','tool-1'],collaborators:[]}],
  ['/tools',tools],...tools.map(tool=>['/tools/'+tool.id,tool] as [string,unknown])
 ]);
 const transport=vi.fn(async(url:string,init:RequestInit)=>{
  if(url==='https://iam.cloud.ibm.com/identity/token')return json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600});
  expect(init.method).toBe('GET');expect(init).toMatchObject({redirect:'error',credentials:'omit',cache:'no-store'});
  expect(url.startsWith(Base+'/v1/orchestrate/')).toBe(true);expect(new Headers(init.headers).get('authorization')).toBe('Bearer SyntheticBearer');
  const path=url.slice((Base+'/v1/orchestrate').length);if(!replies.has(path))throw new Error('UnexpectedSyntheticMetadataRoute');return json(replies.get(path));
 });
 return {settings,tools,replies,transport,handler:createIamVerification({settings:()=>settings,transport,clock:()=>Now})};
}
afterEach(()=>vi.restoreAllMocks());
it('is disabled by default and keeps GET zero-network even when metadata is opted in',async()=>{
 const f=fixture({ORCHESTRATE_METADATA_DIAGNOSTIC_ENABLED:undefined});expect((await f.handler(request(),Context)).status).toBe(404);expect(f.transport).not.toHaveBeenCalled();
 const g=fixture();expect(await (await g.handler(new Request(request().url),Context)).json()).toMatchObject({status:'READY',reason:'operatorReady'});expect(g.transport).not.toHaveBeenCalled();
});
it('exchanges IAM once, reads only fixed metadata and never labels shared definitions Live-confirmed',async()=>{
 const f=fixture(),logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')];
 const result=await f.handler(request(),Context),r=await result.json();
 expect(r).toMatchObject({status:'BLOCKED',reason:'liveSnapshotNotEstablished',authentication:'PASS',liveAgentAssociation:'NOT_VERIFIED',deployment:{version:'matches',release:'matches'},indirectActions:'UNKNOWN'});
 expect(r.tools).toHaveLength(2);for(const tool of r.tools)expect(tool).toMatchObject({scope:'sharedOrDraft',operationId:'notExposed',method:'matches',path:'matches',servers:'matches',declaredAuthentication:'noneDeclared'});
 expect(f.transport.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(1);expect(f.transport).toHaveBeenCalledTimes(7);
 const output=JSON.stringify(r)+JSON.stringify([...result.headers]);for(const x of ['SyntheticBearer','SyntheticDiagnosticKey','tool-0','operator','access_token',LiveProbeAgent,Base])expect(output).not.toContain(x);
 for(const log of logs)expect(log).not.toHaveBeenCalled();expect(result.headers.get('cache-control')).toBe('no-store');
});
it.each(['ORCHESTRATE_ENABLED','ORCHESTRATE_SYNTHETIC_AUTHORIZED','ORCHESTRATE_DISCUSSION_AUTHORIZED','ORCHESTRATE_HOSTED_CONTROLS_VERIFIED','ENDO_DEMO_INFERENCE_ENABLED','WATSONX_ENABLED','WATSONX_CONFLICT_ASSIST_ENABLED','WATSONX_GUIDED_FOLLOWUP_ENABLED','ORCHESTRATE_PROBE_ENABLED','ORCHESTRATE_PROBE_EXCEPTION_ENABLED'])('rejects active inference or exception gate %s before IAM',async key=>{const f=fixture({[key]:'true'});expect((await f.handler(request(),Context)).status).toBe(404);expect(f.transport).not.toHaveBeenCalled();});
it('rejects missing/spoofed/expired operators, published/production deployments and other previews',async()=>{
 const f=fixture();for(const context of [{},{...Context,user:{id:'other',expiresAt:Context.user.expiresAt}},{...Context,user:{id:'operator',expiresAt:new Date(Now)}},{...Context,deploy:{...Context.deploy,context:'production'}},{...Context,deploy:{...Context.deploy,published:true}}]){const r=request();r.headers.set('x-user-id','operator');expect([403,404]).toContain((await f.handler(r,context)).status);}
 expect((await f.handler(new Request(request().url.replace('preview-4','preview-5')),Context)).status).toBe(404);expect(f.transport).not.toHaveBeenCalled();
});
it.each([{ORCHESTRATE_API_URL:'https://other.invalid/instances/x'},{ORCHESTRATE_AGENT_ID:'other'},{ORCHESTRATE_ENVIRONMENT:'draft'}])('rejects incorrect targets before any token exchange %#',async change=>{const f=fixture(change);expect(await (await f.handler(request(),Context)).json()).toMatchObject({reason:'metadataConfiguration'});expect(f.transport).not.toHaveBeenCalled();});
it('does not accept arbitrary paths, URLs, clinical input or duplicate request keys',async()=>{
 const f=fixture();for(const body of ['{"action":"metadata","url":"https://other.invalid"}','{"action":"metadata","case":{}}','{"action":"metadata","action":"metadata"}']){const r=new Request(request().url,{method:'POST',headers:{Origin,'Content-Type':'application/json'},body});expect((await f.handler(r,Context)).status).toBe(400);}expect(f.transport).not.toHaveBeenCalled();
});
it.each([401,403,404,429,503,302])('stops on metadata HTTP %s without retry or reflection',async status=>{
 const f=fixture();f.transport.mockImplementation(async url=>url.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):new Response('SensitiveProviderBody',{status}));
 const r=await (await f.handler(request(),Context)).json();expect(r.reason).toBe(status===401?'metadataUnauthorized':status===403?'metadataForbidden':'metadataUnavailable');expect(JSON.stringify(r)).not.toContain('SensitiveProviderBody');expect(f.transport).toHaveBeenCalledTimes(2);
});
it.each(['bad-id','extra-tool','different-host','callback','extra-binding','unknown-extension','version-reference'])('preserves discrepancies or rejects unexplained shapes: %s',async scenario=>{
 const f=fixture();if(scenario==='bad-id')f.replies.set('/agents/'+LiveProbeAgent,{id:LiveProbeAgent,tools:['../credentials','tool-1']});
 else if(scenario==='extra-tool')f.replies.set('/agents/'+LiveProbeAgent,{id:LiveProbeAgent,tools:['tool-0','tool-1','tool-2']});
 else if(scenario==='version-reference')f.replies.set('/agents/'+LiveProbeAgent+'/environment',[{name:'live',id:'live-env',current_version:'internal-version-id'}]);
 else {const tool=f.tools[0] as any;if(scenario==='different-host')tool.binding.openapi.servers=['https://other.invalid'];else if(scenario==='callback')tool.binding.openapi.callback={callback_url:'https://other.invalid',method:'POST'};else if(scenario==='extra-binding')tool.binding.flow={flow_id:'secret-flow'};else tool.binding.openapi.unrecognizedAction='secret-action';}
 const r=await (await f.handler(request(),Context)).json();expect(r.status).not.toBe('PASS');
 if(['bad-id','extra-tool'].includes(scenario))expect(r.reason).toBe('metadataInvalid');else if(scenario==='different-host')expect(r.tools[0].servers).toBe('different');else if(scenario==='version-reference')expect(r.deployment.version).toBe('notExposed');else expect(r.tools[0].indirectActions).toBe('presentOrUnexplained');
 expect(f.transport.mock.calls.some(([url])=>url.startsWith('https://other.invalid')||url.includes('/credentials'))).toBe(false);
});
it('reads referenced live connection configuration but never credential resources',async()=>{
 const f=fixture();(f.tools[0].binding.openapi as any).connection_id='connection-1';f.replies.set('/connections/applications?connection_id=connection-1',{app_id:'application-1'});f.replies.set('/connections/applications/application-1/configurations/live',{app_id:'application-1',environment:'live',security_scheme:'api_key',server_url:'https://other.invalid',app_config_data:{secret:'SensitiveNeverReturned'}});
 const r=await (await f.handler(request(),Context)).json();expect(r.tools[0]).toMatchObject({connection:'liveMetadataRead',liveAuthentication:'different',liveServer:'different'});expect(JSON.stringify(r)).not.toContain('SensitiveNeverReturned');expect(f.transport).toHaveBeenCalledTimes(9);
});
it.each(['oversize','duplicate','html','missing-live','wrong-agent'])('fails closed on malformed metadata: %s',async scenario=>{
 const f=fixture();if(scenario==='missing-live')f.replies.set('/agents/'+LiveProbeAgent+'/environment',[{name:'draft'}]);else if(scenario==='wrong-agent')f.replies.set('/agents/'+LiveProbeAgent,{id:'other',tools:[]});
 else f.transport.mockImplementation(async url=>url.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):scenario==='html'?new Response('private',{headers:{'content-type':'text/html'}}):new Response(scenario==='oversize'?'x'.repeat(262145):'{"name":"live","name":"draft"}',{headers:{'content-type':'application/json'}}));
 expect(await (await f.handler(request(),Context)).json()).toMatchObject({reason:'metadataInvalid'});
});
it('stops after metadata revocation and cannot reuse a token across requests',async()=>{
 const f=fixture();const original=f.transport.getMockImplementation()!;f.transport.mockImplementation(async(url,init)=>{const response=await original(url,init);if(url.includes('/environment'))f.settings.ORCHESTRATE_METADATA_DIAGNOSTIC_ENABLED='false';return response;});expect((await f.handler(request(),Context)).status).toBe(404);expect(f.transport).toHaveBeenCalledTimes(2);
});
it('never starts metadata after IAM rejection and never reuses an IAM token on a second invocation',async()=>{
 const f=fixture();f.transport.mockResolvedValueOnce(new Response('PrivateIAMFailure',{status:401}));expect(await (await f.handler(request(),Context)).json()).toMatchObject({reason:'iamHttp401'});expect(f.transport).toHaveBeenCalledTimes(1);
 await f.handler(request(),Context);expect(f.transport.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(2);
});
it('bounds stalled metadata transport, preserves cancellation and never retries',async()=>{
 const f=fixture();f.transport.mockImplementation(async url=>url.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):new Promise<Response>(()=>{}));
 const abort=new AbortController(),pending=f.handler(new Request(request(),{signal:abort.signal}),Context);await new Promise(resolve=>setTimeout(resolve,10));abort.abort();expect((await pending).status).toBe(499);expect(f.transport).toHaveBeenCalledTimes(2);
 const g=fixture();g.transport.mockImplementation(async url=>url.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):new Promise<Response>(()=>{}));expect(await (await g.handler(request(),Context)).json()).toMatchObject({reason:'metadataTimeout'});expect(g.transport).toHaveBeenCalledTimes(2);
});
it('rejects expired or revoked authorization between metadata calls',async()=>{
 const f=fixture();const original=f.transport.getMockImplementation()!;f.transport.mockImplementation(async(url,init)=>{const response=await original(url,init);if(url.includes('/environment'))f.settings.ORCHESTRATE_IAM_DIAGNOSTIC_KILL_SWITCH='true';return response;});expect((await f.handler(request(),Context)).status).toBe(404);expect(f.transport).toHaveBeenCalledTimes(2);
});
it.each([
 ['environmentList','environmentEnvelope'],['liveEnvironment','liveEnvironmentSelection'],['releaseStatus','objectExpected'],
 ['agentDefinition','toolReferences'],['toolInventory','inventoryEnvelope'],['moduleListingDefinition','objectExpected'],
 ['clinicalAnalysisDefinition','objectExpected'],['moduleListingConnection','connectionIdentity'],['clinicalAnalysisConnection','connectionIdentity']
] as const)('returns a fixed stage and check for %s without provider data',async(stage,check)=>{
 const f=fixture();
 if(stage==='environmentList')f.replies.set('/agents/'+LiveProbeAgent+'/environment',{private:'SensitiveStagePayload'});
 else if(stage==='liveEnvironment')f.replies.set('/agents/'+LiveProbeAgent+'/environment',[{name:'draft'}]);
 else if(stage==='releaseStatus')f.replies.set('/agents/'+LiveProbeAgent+'/releases/status?environment_id=live-env',[]);
 else if(stage==='agentDefinition')f.replies.set('/agents/'+LiveProbeAgent,{id:LiveProbeAgent,tools:[]});
 else if(stage==='toolInventory')f.replies.set('/tools',{tools:f.tools});
 else if(stage.endsWith('Definition')){const index=stage==='moduleListingDefinition'?0:1;f.replies.set('/tools/tool-'+index,{...f.tools[index],binding:{private:'SensitiveStagePayload'}});}
 else {const index=stage==='moduleListingConnection'?0:1;(f.tools[index].binding.openapi as any).connection_id='connection-1';f.replies.set('/connections/applications?connection_id=connection-1',{app_id:'application-1'});f.replies.set('/connections/applications/application-1/configurations/live',{app_id:'application-1',environment:'draft',private:'SensitiveStagePayload'});}
 const report=await (await f.handler(request(),Context)).json();expect(report).toEqual({version:'1',status:'FAIL',reason:'metadataInvalid',stage,check,authentication:'PASS'});expect(JSON.stringify(report)).not.toMatch(/SensitiveStagePayload|SyntheticBearer|SyntheticDiagnosticKey|connection-1|application-1|http/);
 expect(f.transport.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(1);
});
it.each(['contentType','invalidJson','responseTooLarge'] as const)('distinguishes fixed response-reader failure %s',async check=>{
 const f=fixture();f.transport.mockImplementation(async url=>url.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):new Response(check==='responseTooLarge'?'x'.repeat(262145):'not JSON',{headers:{'content-type':check==='contentType'?'text/html':'application/json'}}));
 expect(await (await f.handler(request(),Context)).json()).toMatchObject({stage:'environmentList',check,authentication:'PASS'});expect(f.transport).toHaveBeenCalledTimes(2);
});
it('does not claim IAM succeeded for a local target-validation failure',async()=>{
 const f=fixture({ORCHESTRATE_ENVIRONMENT:'draft'});expect(await (await f.handler(request(),Context)).json()).toMatchObject({stage:'configuration',check:'targetMismatch',authentication:'NOT_TESTED'});expect(f.transport).not.toHaveBeenCalled();
});
it.each(['displayNameOnly','nameOutsideAgentReferences','duplicateReferencedMatch','referencesAbsent','unsupportedFields','renamedCanonicalName'] as const)('classifies selection failure without accepting substitutes: %s',async scenario=>{
 const f=fixture(),expected=ApprovedLiveOperations[0].tool;
 if(scenario==='displayNameOnly'){(f.tools[0] as any).display_name=expected;(f.tools[0] as {name:string}).name='DifferentCanonicalName';}
 else if(scenario==='nameOutsideAgentReferences')f.tools[0].id='unreferenced-tool';
 else if(scenario==='duplicateReferencedMatch')f.replies.set('/tools',[...f.tools,structuredClone(f.tools[0])]);
 else if(scenario==='referencesAbsent')f.replies.set('/tools',f.tools.map((tool,index)=>({...tool,id:'unreferenced-'+index,name:'OtherCanonicalName'})));
 else if(scenario==='unsupportedFields')f.replies.set('/tools',[{id:{private:'SecretIdentifier'},display_name:expected},f.tools[1]]);
 else (f.tools[0] as {name:string}).name='DifferentCanonicalName';
 const report=await (await f.handler(request(),Context)).json();
 expect(report).toMatchObject({status:'FAIL',reason:'metadataInvalid',stage:'moduleListingDefinition',check:'toolSelection',authentication:'PASS',selection:{referenceScope:'genericAgentNotLiveSnapshot'}});
 const s=report.selection;
 if(scenario==='displayNameOnly')expect(s).toMatchObject({canonicalNames:'zero',canonicalNamesReferencedByAgent:'zero',displayNameOnlyReferencedByAgent:'one'});
 else if(scenario==='nameOutsideAgentReferences')expect(s).toMatchObject({canonicalNames:'one',canonicalNamesReferencedByAgent:'zero',agentReferencesFoundInInventory:'one'});
 else if(scenario==='duplicateReferencedMatch')expect(s).toMatchObject({canonicalNames:'multiple',canonicalNamesReferencedByAgent:'multiple'});
 else if(scenario==='referencesAbsent')expect(s).toMatchObject({canonicalNames:'zero',agentReferencesFoundInInventory:'zero'});
 else if(scenario==='unsupportedFields')expect(s).toMatchObject({missingOrNonStringNames:true,missingOrInvalidIds:true});
 else expect(s).toMatchObject({canonicalNames:'zero',agentReferencesFoundInInventory:'multiple',displayNameOnlyReferencedByAgent:'zero'});
 expect(f.transport).toHaveBeenCalledTimes(5);expect(f.transport.mock.calls.some(([url])=>/\/tools\//.test(url))).toBe(false);
 expect(JSON.stringify(report)).not.toMatch(/DifferentCanonicalName|OtherCanonicalName|unreferenced|SecretIdentifier|SyntheticBearer|tool-0|list_available|http/);
});
it('does not mistake duplicate unreferenced names for multiple agent-referenced matches',async()=>{
 const f=fixture();f.replies.set('/tools',[...f.tools,{...f.tools[0],id:'unreferenced-tool'}]);expect(await (await f.handler(request(),Context)).json()).toMatchObject({status:'BLOCKED',reason:'liveSnapshotNotEstablished'});
});
const Settings={ORCHESTRATE_IAM_DIAGNOSTIC_ENABLED:'true',ORCHESTRATE_IAM_DIAGNOSTIC_KILL_SWITCH:'false',ORCHESTRATE_IAM_DIAGNOSTIC_UNTIL:new Date(Now+300000).toISOString(),ORCHESTRATE_EMBED_PREVIEW_ID:'4',ORCHESTRATE_EMBED_PREVIEW_ORIGIN:Origin,ORCHESTRATE_EMBED_OPERATOR_IDS:'operator',ORCHESTRATE_EMBED_PREVIEW_ENABLED:'false',ORCHESTRATE_EMBED_KILL_SWITCH:'true',OTEL_SDK_DISABLED:'true',ENDO_DEMO_KILL_SWITCH:'true',WATSONX_CONVERSATION_MODE:'disabled',ORCHESTRATE_ENABLED:'false',ORCHESTRATE_SYNTHETIC_AUTHORIZED:'false',ORCHESTRATE_DISCUSSION_AUTHORIZED:'false',ORCHESTRATE_HOSTED_CONTROLS_VERIFIED:'false',ENDO_DEMO_INFERENCE_ENABLED:'false',WATSONX_ENABLED:'false',WATSONX_CONFLICT_ASSIST_ENABLED:'false',WATSONX_GUIDED_FOLLOWUP_ENABLED:'false',ORCHESTRATE_PROBE_ENABLED:'false',ORCHESTRATE_PROBE_KILL_SWITCH:'true',ORCHESTRATE_PROBE_TEST_UNTIL:'',WATSONX_AI_AUTH_TYPE:'iam',WATSONX_AI_APIKEY:'SyntheticDiagnosticKey',WATSONX_AI_TIMEOUT_MS:'100'};
