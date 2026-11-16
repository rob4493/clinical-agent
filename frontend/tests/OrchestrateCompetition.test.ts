// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {CompetitionStore,competitionWindow,createCompetitionQuota,validateCompetitionTicket} from '../../netlify/evaluation/orchestrateCompetition';
import {netlifyQuota} from '../src/server/netlifyQuota';
import {createProbe,config} from '../../netlify/functions/orchestrateProbe';
import {QuotaError,validateTicket,type QuotaStore} from '../../netlify/evaluation/demoQuota';
import type {Transport} from '../../netlify/evaluation/watsonShadow';
const Origin='https://deploy-preview-4--clinicalagent.netlify.app';
const Now=Date.parse('2026-11-16T12:00:00Z');
const Settings={ORCHESTRATE_COMPETITION_ENABLED:'true',ORCHESTRATE_COMPETITION_STARTED_AT:new Date(Now-1000).toISOString(),ORCHESTRATE_COMPETITION_UNTIL:new Date(Now+14400000-1000).toISOString(),ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT:'50',ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT:'20',ORCHESTRATE_PROBE_ENABLED:'false',ORCHESTRATE_PROBE_EXCEPTION_ENABLED:'false',ORCHESTRATE_PROBE_KILL_SWITCH:'false',ORCHESTRATE_ENABLED:'false',ENDO_DEMO_INFERENCE_ENABLED:'false',ENDO_DEMO_KILL_SWITCH:'true',ORCHESTRATE_EMBED_PREVIEW_ENABLED:'false',ORCHESTRATE_EMBED_KILL_SWITCH:'true',OTEL_SDK_DISABLED:'true',ORCHESTRATE_EMBED_PREVIEW_ID:'4',ORCHESTRATE_EMBED_PREVIEW_ORIGIN:Origin,ORCHESTRATE_EMBED_OPERATOR_IDS:'operator',ORCHESTRATE_API_URL:'https://api.eu-de.watson-orchestrate.cloud.ibm.com/instances/SyntheticTenant',ORCHESTRATE_AGENT_ID:'c6698d4e-a08d-4b77-bf05-139ff3b4c695',ORCHESTRATE_ENVIRONMENT:'live',WATSONX_AI_AUTH_TYPE:'iam',WATSONX_AI_APIKEY:'SyntheticServerKey',WATSONX_AI_TIMEOUT_MS:'1000'};
const Context={user:{id:'operator',expiresAt:new Date(Now+14400000)},deploy:{id:'SyntheticDeploy',context:'deploy-preview',published:false}};
const signal=()=>new AbortController().signal;
const request=(body='{"action":"probe"}')=>new Request(Origin+'/.netlify/functions/orchestrateProbe',{method:'POST',headers:{Origin,'Content-Type':'application/json'},body});
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function memory(){
 const records=new Map<string,{data:unknown;etag:string}>();
 const store:QuotaStore={async set(key,content){validateCompetitionTicket(key,content);if(records.has(key))return {modified:false};const etag=String(records.size+1);records.set(key,{data:JSON.parse(content),etag});return {modified:true,etag};},async getWithMetadata(key){validateCompetitionTicket(key);return records.get(key)??null;}};
 return {store,records};
}
function fixture(){
 const environment={...Settings},storage=memory();let now=Now;
 const transport=vi.fn<Transport>(async(address,init)=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):json({thread_id:new Headers(init.headers).get('X-IBM-THREAD-ID')||randomUUID(),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:new Headers(init.headers).has('X-IBM-THREAD-ID')?'Blue Lantern':'Blue Lantern acknowledged.'}}]}));
 const factory=vi.fn(async()=>storage.store),handler=createProbe({settings:()=>environment,clock:()=>now,store:factory,transport});
 return {...storage,environment,transport,factory,handler,setNow:(value:number)=>{now=value;}};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('defaults disabled, accepts a bounded four-hour window and needs no legacy approvals',()=>{
 expect(competitionWindow({},Now)).toBeNull();expect(competitionWindow(Settings,Now)).toMatchObject({dailyCalls:50,dailySessions:20});
 expect(competitionWindow({...Settings,ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT:undefined,ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT:undefined},Now)).toMatchObject({dailyCalls:50,dailySessions:20});
 expect(config.rateLimit.windowLimit).toBe(60);
});
it.each([
 {ORCHESTRATE_COMPETITION_ENABLED:'false'},{ORCHESTRATE_PROBE_KILL_SWITCH:'true'},
 {ORCHESTRATE_COMPETITION_UNTIL:new Date(Now).toISOString()},{ORCHESTRATE_COMPETITION_STARTED_AT:new Date(Now+1).toISOString()},
 {ORCHESTRATE_COMPETITION_UNTIL:new Date(Now+14400001).toISOString()},{ORCHESTRATE_COMPETITION_STARTED_AT:'invalid'},
 {ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT:'0'},{ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT:'1001'},
 {ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT:'201'},{ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT:'1.5'},
 {ORCHESTRATE_ENABLED:'true'},{ENDO_DEMO_INFERENCE_ENABLED:'true'},{ENDO_DEMO_KILL_SWITCH:'false'},
 {ORCHESTRATE_EMBED_PREVIEW_ENABLED:'true'},{ORCHESTRATE_EMBED_KILL_SWITCH:'false'},{OTEL_SDK_DISABLED:'false'},
 {ORCHESTRATE_AGENT_ID:randomUUID()},{ORCHESTRATE_ENVIRONMENT:'draft'},
 {ORCHESTRATE_API_URL:'https://unapproved.invalid/instances/SyntheticTenant'}
])('fails closed on invalid competition configuration %#',async change=>{
 const f=fixture();Object.assign(f.environment,change);expect((await f.handler(request(),Context)).status).toBe(404);expect(f.factory).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
});
it('keeps readiness read-only and validates trusted operators before storage',async()=>{
 const f=fixture();const get=new Request(Origin+'/.netlify/functions/orchestrateProbe');expect((await f.handler(get,Context)).status).toBe(400);
 for(const user of [undefined,{id:'unlisted',expiresAt:Context.user.expiresAt},{id:'operator',expiresAt:new Date(Now)},{id:'operator',expiresAt:'tomorrow'}]){
  const req=request();req.headers.set('x-user-id','operator');expect((await f.handler(req,{...Context,user} as typeof Context)).status).toBe(403);
 }
 expect(f.factory).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
});
it.each([
 {...Context.deploy,context:'production'},{...Context.deploy,published:true},undefined,
])('denies production, published and absent deployment context %#',async deploy=>{
 const f=fixture();expect((await f.handler(request(),{...Context,deploy})).status).toBe(404);expect(f.transport).not.toHaveBeenCalled();expect(f.factory).not.toHaveBeenCalled();
});
it('rejects other preview origins and caller-controlled text or threads',async()=>{
 const f=fixture();expect((await f.handler(new Request('https://deploy-preview-5--clinicalagent.netlify.app/.netlify/functions/orchestrateProbe'),Context)).status).toBe(404);
 for(const body of ['{"action":"probe","text":"Synthetic case"}','{"action":"probe","threadId":"forged"}','{"action":"probe","caseInput":{}}'])expect((await f.handler(request(body),Context)).status).toBe(400);
 expect(f.factory).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
});
it('permits repeated independent two-turn attempts without daily visit locks, preserving continuity',async()=>{
 const f=fixture();for(let i=0;i<4;i++)expect(await (await f.handler(request(),Context)).json()).toMatchObject({status:'PASS',firstTurn:'PASS',secondTurn:'PASS',continuity:'PASS'});
 const calls=f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'));expect(calls).toHaveLength(8);
 for(let i=0;i<calls.length;i+=2){expect(new Headers(calls[i][1].headers).has('X-IBM-THREAD-ID')).toBe(false);expect(new Headers(calls[i+1][1].headers).has('X-IBM-THREAD-ID')).toBe(true);expect(String(calls[i+1][1].body)).not.toContain('Blue Lantern');}
 expect([...f.records.keys()].filter(key=>key.startsWith('session/'))).toHaveLength(4);expect([...f.records.keys()].filter(key=>key.startsWith('call/'))).toHaveLength(8);expect([...f.records.keys()].some(key=>/^(daily|visit)\//.test(key))).toBe(false);
 expect(CompetitionStore).toBe('EndoOrchestrateCompetitionV1');
});
it('enforces the session limit under concurrent requests across independent Function instances',async()=>{
 const f=fixture(),handlers=Array.from({length:8},()=>createProbe({settings:()=>f.environment,store:f.factory,transport:f.transport,clock:()=>Now}));
 const reports=await Promise.all(Array.from({length:35},async(_,i)=>(await handlers[i%handlers.length](request(),Context)).json()));
 expect(reports.filter(report=>report.status==='PASS')).toHaveLength(20);expect(reports.filter(report=>report.reason==='quotaRejected')).toHaveLength(15);
 expect(f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'))).toHaveLength(40);
});
it('enforces all fifty global call reservations atomically without visit tickets',async()=>{
 const m=memory(),window=competitionWindow(Settings,Now)!,quotas=Array.from({length:10},()=>createCompetitionQuota(async()=>m.store,window,()=>Now,()=>0));
 const outcomes=await Promise.allSettled(Array.from({length:90},(_,i)=>quotas[i%10].reserveCall(signal())));
 expect(outcomes.filter(value=>value.status==='fulfilled')).toHaveLength(50);expect(outcomes.filter(value=>value.status==='rejected'&&value.reason.category==='exhausted')).toHaveLength(40);
 expect([...m.records.keys()].filter(key=>key.startsWith('call/'))).toHaveLength(50);
});
it('counts failed responses and permits a fresh explicitly initiated attempt without retries',async()=>{
 const f=fixture();f.transport.mockImplementation(async address=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):new Response('SyntheticPrivateFailure',{status:503}));
 for(let i=0;i<3;i++)expect(await (await f.handler(request(),Context)).json()).toMatchObject({status:'FAIL',firstTurn:'FAIL',secondTurn:'NOT_TESTED',reason:'providerUnavailable'});
 expect(f.transport).toHaveBeenCalledTimes(6);expect([...f.records.keys()].filter(key=>key.startsWith('call/'))).toHaveLength(3);
 const results=[...f.records.entries()].filter(([key])=>key.startsWith('outcome/call/')).map(([,value])=>value.data);expect(results).toHaveLength(3);expect(results.every(value=>(value as {status:string}).status==='failed')).toBe(true);
 expect(JSON.stringify([...f.records.values()])).not.toMatch(/SyntheticPrivateFailure|SyntheticBearer|SyntheticServerKey|Blue Lantern|operator/);
});
it('counts IAM rejection conservatively but records that no agent request began',async()=>{
 const f=fixture();f.transport.mockImplementation(async()=>new Response('SyntheticPrivateIamFailure',{status:401}));
 expect(await (await f.handler(request(),Context)).json()).toMatchObject({authentication:'FAIL',reason:'authenticationFailure'});expect(f.transport).toHaveBeenCalledOnce();
 expect([...f.records.values()].some(value=>JSON.stringify(value.data)==='{"status":"failed","reason":"authenticationFailure","invoked":false}')).toBe(true);
});
it.each(['kill','expiry','operator','allowlist','replacementWindow','target'])('stops the second call when %s changes during the first response',async control=>{
 const f=fixture(),original=f.transport.getMockImplementation()!;
 f.transport.mockImplementation(async(url,init)=>{const result=await original(url,init);if(!url.includes('/identity/token')){if(control==='kill')f.environment.ORCHESTRATE_PROBE_KILL_SWITCH='true';if(control==='expiry')f.setNow(Now+14400000);if(control==='operator')Context.user.expiresAt=new Date(Now);if(control==='allowlist')f.environment.ORCHESTRATE_EMBED_OPERATOR_IDS='unlisted';if(control==='target')f.environment.ORCHESTRATE_API_URL='https://api.eu-de.watson-orchestrate.cloud.ibm.com/instances/OtherSyntheticTenant';if(control==='replacementWindow'){f.environment.ORCHESTRATE_COMPETITION_STARTED_AT=new Date(Now-500).toISOString();f.environment.ORCHESTRATE_COMPETITION_UNTIL=new Date(Now+10000).toISOString();}}return result;});
 try{expect((await (await f.handler(request(),Context)).json()).status).toBe('FAIL');expect(f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'))).toHaveLength(1);}finally{Context.user.expiresAt=new Date(Now+14400000);}
});
it('does not refund reservations or invoke IBM on storage/readback failure',async()=>{
 const f=fixture();f.store.getWithMetadata=async()=>null;expect(await (await f.handler(request(),Context)).json()).toMatchObject({reason:'quotaUnavailable'});expect(f.transport).not.toHaveBeenCalled();expect(f.records.has('policy/2026-11-16')).toBe(true);
});
it('never accepts a false conditional-write success or a mismatched etag',async()=>{
 for(const bad of [{modified:true},{modified:true,etag:'lie'}]){
  const m=memory(),original=m.store.set;m.store.set=async(key,content,options)=>{const written=await original(key,content,options);return key.startsWith('call/')?bad:written;};
  await expect(createCompetitionQuota(async()=>m.store,competitionWindow(Settings,Now)!,()=>Now,()=>0).reserveCall(signal())).rejects.toBeInstanceOf(QuotaError);
 }
});
it('fails closed if outcome accounting fails and never replays an IBM request',async()=>{
 const f=fixture(),original=f.store.set;f.store.set=async(key,content,options)=>{if(key.startsWith('outcome/'))throw new Error('SyntheticPrivateStorage');return original(key,content,options);};
 expect(await (await f.handler(request(),Context)).json()).toMatchObject({status:'FAIL',reason:'quotaUnavailable',accounting:'incomplete'});expect(f.transport).toHaveBeenCalledTimes(3);expect([...f.records.keys()].filter(key=>key.startsWith('call/'))).toHaveLength(2);
});
it('freezes a day\'s configured capacity without changing historical records',async()=>{
 const m=memory(),window=competitionWindow(Settings,Now)!;await createCompetitionQuota(async()=>m.store,window,()=>Now,()=>0).reserveSession(signal());
 await expect(createCompetitionQuota(async()=>m.store,{...window,dailyCalls:60},()=>Now,()=>0).reserveSession(signal())).rejects.toBeInstanceOf(QuotaError);
 expect([...m.records.keys()].filter(key=>key.startsWith('session/'))).toHaveLength(1);
});
it('permits a four-hour window across UTC midnight with correctly dated call reservations',async()=>{
 const m=memory();let now=Date.parse('2026-11-16T23:59:59Z');const window=competitionWindow({...Settings,ORCHESTRATE_COMPETITION_STARTED_AT:new Date(now).toISOString(),ORCHESTRATE_COMPETITION_UNTIL:new Date(now+14400000).toISOString()},now)!;const quota=createCompetitionQuota(async()=>m.store,window,()=>now,()=>0);
 await quota.reserveSession(signal());now+=2000;await quota.reserveCall(signal());expect(m.records.has('session/2026-11-16/0')).toBe(true);expect(m.records.has('call/2026-11-17/0')).toBe(true);
});
it('keeps the shared legacy adapter validator restrictive and rejects sensitive record payloads',()=>{
 expect(()=>validateTicket('call/2026-11-16/0')).toThrow();expect(()=>validateCompetitionTicket('visit/2026-11-16/'+randomUUID()+'/0')).toThrow();
 expect(()=>validateCompetitionTicket('call/2026-11-16/0',JSON.stringify({message:'SyntheticPrivateCase'}))).toThrow();
 expect(()=>validateCompetitionTicket('outcome/call/2026-11-16/'+randomUUID(),JSON.stringify({status:'failed',reason:'SyntheticPrivateError',invoked:true}))).toThrow();
});

it.skipIf(process.platform!=='win32')('workflow preserves All scopes/global fallbacks, updates preview overrides and closes safely on denial',()=>{
 const directory=mkdtempSync(join(tmpdir(),'endo-competition-script-')),file=join(directory,'harness.ps1'),script=resolve('../tools/competitionPreview.ps1');
 const harness=`param([string]$ScriptPath,[string]$Mode)
$ErrorActionPreference='Stop'
$global:FakePreview=@{ORCHESTRATE_ENABLED='false';ENDO_DEMO_INFERENCE_ENABLED='false';ENDO_DEMO_KILL_SWITCH='true';ORCHESTRATE_EMBED_PREVIEW_ENABLED='false';ORCHESTRATE_EMBED_KILL_SWITCH='true';OTEL_SDK_DISABLED='true';ORCHESTRATE_AGENT_ID='c6698d4e-a08d-4b77-bf05-139ff3b4c695';ORCHESTRATE_ENVIRONMENT='live';WATSONX_AI_AUTH_TYPE='iam';ORCHESTRATE_API_URL='https://api.eu-de.watson-orchestrate.cloud.ibm.com/instances/SyntheticTenant';ORCHESTRATE_EMBED_PREVIEW_ID='4';ORCHESTRATE_EMBED_PREVIEW_ORIGIN='https://deploy-preview-4--clinicalagent.netlify.app';ORCHESTRATE_EMBED_OPERATOR_IDS='synthetic-operator';ORCHESTRATE_PROBE_KILL_SWITCH='true'}
$global:FakeProduction=@{ORCHESTRATE_ENABLED='false';SYNTHETIC_MARKER='unchanged'}
$global:FakeDenied=$false;$global:Writes=0;$global:Creates=0
$global:FakeGlobal=@{};$global:FakeScopes=@{};$global:FakeOverrides=@{}
if($Mode -like 'multi*'){
 foreach($key in @('ORCHESTRATE_COMPETITION_ENABLED','ORCHESTRATE_PROBE_ENABLED','ORCHESTRATE_PROBE_EXCEPTION_ENABLED')){$global:FakePreview[$key]='false'}
 foreach($key in @('ORCHESTRATE_COMPETITION_STARTED_AT','ORCHESTRATE_COMPETITION_UNTIL','ORCHESTRATE_PROBE_TEST_UNTIL','ORCHESTRATE_PROBE_EXCEPTION_APPROVAL')){$global:FakePreview[$key]=''}
 $global:FakePreview['ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT']='50';$global:FakePreview['ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT']='20'
 foreach($key in $global:FakePreview.Keys){$global:FakeGlobal[$key]=$global:FakePreview[$key];$global:FakeProduction[$key]=$global:FakePreview[$key]}
}
foreach($key in $global:FakePreview.Keys){$global:FakeScopes[$key]=if($Mode -like 'multi*'){@('builds','functions','post_processing','runtime')}else{@('functions')}}
$global:OriginalGlobal=$global:FakeGlobal.Clone();$global:OriginalScopes=$global:FakeScopes.Clone()
function global:netlify {
 $global:LASTEXITCODE=0;$a=@($args)
 if($a[0] -eq 'env:list'){$idx=[Array]::IndexOf($a,'--context');if($a[$idx+1] -eq 'production'){$global:FakeProduction|ConvertTo-Json -Compress}else{$global:FakePreview|ConvertTo-Json -Compress};return}
 if($a[0] -ne 'api'){throw 'Unexpected CLI operation'}
 $idx=[Array]::IndexOf($a,'--data');$data=$a[$idx+1]|ConvertFrom-Json -DateKind String
 switch($a[1]) {
 'getSite' {@{name='clinicalagent';account_id='synthetic-account';sso_login=$true;sso_login_context='non_production';published_deploy=@{commit_ref='synthetic-main'}}|ConvertTo-Json -Depth 5 -Compress}
  'getEnvVars' {
  $rows=@(foreach($key in $global:FakePreview.Keys){
   $values=@();if($global:FakeGlobal.ContainsKey($key)){
    if($global:FakeOverrides.ContainsKey($key)){foreach($context in @('dev','branch-deploy','production')){$values+=@{context=$context;value=$global:FakeGlobal[$key]}}}else{$values+=@{context='all';value=$global:FakeGlobal[$key]}}
   }
   if($global:FakeOverrides.ContainsKey($key)){$values+=@{context='deploy-preview';value=$global:FakeOverrides[$key]}}elseif(!$global:FakeGlobal.ContainsKey($key)){$values+=@{context='deploy-preview';value=$global:FakePreview[$key]}}
   @{key=$key;scopes=$global:FakeScopes[$key];values=$values}
  });ConvertTo-Json -InputObject $rows -Depth 8 -Compress
 }
 'setEnvVarValue' {
  if($data.site_id -cne 'b1f36feb-3225-4a27-9dff-de780d166161' -or $data.body.context -cne 'deploy-preview'){throw 'Scope escape'}
  if(($Mode -eq 'deny' -or $Mode -eq 'multiDeny') -and !$global:FakeDenied -and $data.key -eq 'ORCHESTRATE_COMPETITION_UNTIL' -and $data.body.value -ne ''){$global:FakeDenied=$true;$global:LASTEXITCODE=1;Write-Output '403 Forbidden SyntheticPrivateProviderPayload';return}
  $global:FakePreview[$data.key]=$data.body.value;$global:FakeOverrides[$data.key]=$data.body.value;$global:Writes++;if($Mode -eq 'multiChanged' -and $data.key -eq 'ORCHESTRATE_COMPETITION_ENABLED' -and $data.body.value -eq 'true'){$global:FakeGlobal['ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT']='999'};Write-Output '{}'
 }
 'createEnvVars' {
  foreach($item in @($data.body)){if($global:FakePreview.ContainsKey($item.key)){throw 'Duplicate variable creation'};if($data.site_id -cne 'b1f36feb-3225-4a27-9dff-de780d166161' -or @($item.scopes).Count -ne 1 -or $item.scopes[0] -cne 'functions' -or $item.values[0].context -cne 'deploy-preview'){throw 'Scope escape'};$global:FakePreview[$item.key]=$item.values[0].value;$global:FakeOverrides[$item.key]=$item.values[0].value;$global:FakeScopes[$item.key]=@($item.scopes);$global:Creates++;$global:Writes++};Write-Output '[]'
 }
 default {throw 'Unexpected API operation'}
 }
}
$denied=$false
try{& $ScriptPath -Action Activate -Authorized -AcceptResidualRisks -DurationMinutes 240 -DailyCalls 50 -DailySessions 20}catch{$denied=$true;if($_.Exception.Message -notmatch 'HTTP403' -and !($Mode -eq 'multiChanged' -and $_.Exception.Message -ceq 'Variable scopes or non-preview values changed; stop and review.')){throw}}
if($Mode -eq 'deny' -or $Mode -eq 'multiDeny' -or $Mode -eq 'multiChanged'){if(!$denied){throw 'Expected write denial'}}else{if($denied -or $global:FakePreview.ORCHESTRATE_COMPETITION_ENABLED -cne 'true'){throw 'Activation failed'};if($global:FakePreview.ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT -cne '50' -or $global:FakePreview.ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT -cne '20'){throw 'Limits mismatch'};& $ScriptPath -Action Disable}
foreach($key in @('ORCHESTRATE_COMPETITION_ENABLED','ORCHESTRATE_PROBE_ENABLED','ORCHESTRATE_PROBE_EXCEPTION_ENABLED')){if($global:FakePreview[$key] -cne 'false'){throw 'Shutdown gate failed'}}
if($global:FakePreview.ORCHESTRATE_PROBE_KILL_SWITCH -cne 'true' -or $global:FakePreview.ORCHESTRATE_COMPETITION_UNTIL -cne '' -or $global:FakePreview.ORCHESTRATE_PROBE_EXCEPTION_APPROVAL -cne ''){throw 'Shutdown cleanup failed'}
if($global:FakeProduction.SYNTHETIC_MARKER -cne 'unchanged' -or $global:Writes -lt 1){throw 'Production changed or no writes'}
foreach($key in $global:OriginalGlobal.Keys){if($Mode -eq 'multiChanged' -and $key -eq 'ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT'){if($global:FakeGlobal[$key] -cne '999'){throw 'Global-change detection fixture failed'};continue};if($global:FakeGlobal[$key] -cne $global:OriginalGlobal[$key]){throw 'Global fallback changed'}}
foreach($key in $global:OriginalScopes.Keys){if(($global:FakeScopes[$key] -join ',') -cne ($global:OriginalScopes[$key] -join ',')){throw 'Variable scopes changed'}}
if($Mode -like 'multi*' -and $global:Creates -ne 0){throw 'Existing variables were duplicated'}
if($Mode -eq 'multi'){foreach($key in @('ORCHESTRATE_COMPETITION_ENABLED','ORCHESTRATE_COMPETITION_STARTED_AT','ORCHESTRATE_COMPETITION_UNTIL','ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT','ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT')){if(!$global:FakeOverrides.ContainsKey($key)){throw 'Missing preview override'}}}
Write-Output 'MockedWorkflowPassed'
`;
 try{writeFileSync(file,harness);for(const mode of ['normal','deny','multi','multiDeny','multiChanged']){const result=spawnSync('pwsh',['-NoProfile','-File',file,'-ScriptPath',script,'-Mode',mode],{encoding:'utf8',timeout:15000});expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('MockedWorkflowPassed');expect(result.stdout+result.stderr).not.toContain('SyntheticPrivateProviderPayload');}}
 finally{unlinkSync(file);rmdirSync(directory);}
});

it('rejects exhausted call capacity before IAM or provider and counts the rejected attempt session',async()=>{
 const f=fixture();f.environment.ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT='2';expect((await (await f.handler(request(),Context)).json()).status).toBe('PASS');
 const before=f.transport.mock.calls.length;expect(await (await f.handler(request(),Context)).json()).toMatchObject({authentication:'NOT_TESTED',reason:'quotaRejected'});expect(f.transport.mock.calls.length).toBe(before);
 expect([...f.records.keys()].filter(key=>key.startsWith('session/'))).toHaveLength(2);expect([...f.records.keys()].filter(key=>key.startsWith('call/'))).toHaveLength(2);
});
it('keeps action rejection and sanitized response diagnostics in competition mode',async()=>{
 const f=fixture();f.transport.mockImplementation(async address=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):json({thread_id:randomUUID(),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'SyntheticPrivateProse',tool_calls:[{function:{name:'SyntheticTool',arguments:'{}'}}]}}]}));
 const report=await (await f.handler(request(),Context)).json();expect(report).toMatchObject({reason:'providerResponse',responseRejection:'actionResponse',secondTurn:'NOT_TESTED'});expect(f.transport).toHaveBeenCalledTimes(2);expect(JSON.stringify(report)).not.toMatch(/SyntheticPrivateProse|SyntheticTool|SyntheticBearer/);
});
it('rejects a provider changing its thread and never performs a third call',async()=>{
 const f=fixture();f.transport.mockImplementation(async(address,init)=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):json({thread_id:randomUUID(),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:new Headers(init.headers).has('X-IBM-THREAD-ID')?'Blue Lantern':'Blue Lantern acknowledged.'}}]}));
 expect(await (await f.handler(request(),Context)).json()).toMatchObject({firstTurn:'PASS',secondTurn:'FAIL',reason:'providerResponse',responseRejection:'threadMismatch'});expect(f.transport).toHaveBeenCalledTimes(3);
});

it('enables competition record validation only for the exact new store name',async()=>{
 vi.stubGlobal('netlifyBlobsContext',undefined);vi.stubEnv('NETLIFY_BLOBS_CONTEXT',Buffer.from(JSON.stringify({siteID:'synthetic-site',token:'SyntheticStorageToken',edgeURL:'https://storage.invalid',uncachedEdgeURL:'https://strong.invalid'})).toString('base64'));
 const http=vi.fn<typeof fetch>(async()=>new Response(null,{status:200,headers:{etag:'synthetic-etag'}}));
 const current=await netlifyQuota(CompetitionStore,signal(),{OTEL_SDK_DISABLED:'true'},http),legacy=await netlifyQuota('EndoOrchestrateProbeQuota',signal(),{OTEL_SDK_DISABLED:'true'},http);
 const data=JSON.stringify({reservationId:randomUUID(),createdAt:Now});await current.set('call/2026-11-16/0',data,{onlyIfNew:true});expect(http).toHaveBeenCalled();const before=http.mock.calls.length;
 await expect(legacy.set('call/2026-11-16/0',data,{onlyIfNew:true})).rejects.toThrow();await expect(current.set('visit/2026-11-16/'+randomUUID()+'/0',data,{onlyIfNew:true})).rejects.toThrow();expect(http.mock.calls.length).toBe(before);
});
