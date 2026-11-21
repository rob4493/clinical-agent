// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {productionWindow} from '../../netlify/evaluation/productionAccess';
import {createProductionConversation} from '../../netlify/evaluation/productionConversation';
import {createConversationQuota,maximumPublicEvaluationEnd,validateConversationTicket,productionStopKey} from '../../netlify/evaluation/conversationQuota';
import type {QuotaStore} from '../../netlify/evaluation/demoQuota';
import type {Transport} from '../../netlify/evaluation/watsonShadow';
const Now=Date.parse('2026-11-16T12:00:00Z');
const Settings={ENDO_CHAT_ENABLED:'true',ENDO_CHAT_KILL_SWITCH:'false',ENDO_CHAT_TOOL_POLICY:'approved-operations-enforced',ENDO_CHAT_PROVIDER_ALLOWANCE:'reviewed',ENDO_CHAT_REVIEW_REFERENCE:'SyntheticReviewedFixture',ENDO_CHAT_STARTED_AT:new Date(Now-1000).toISOString(),ENDO_CHAT_UNTIL:new Date(Now+3600000).toISOString(),ENDO_CHAT_DAILY_CALL_LIMIT:'50',ENDO_CHAT_DAILY_SESSION_LIMIT:'20',ENDO_CHAT_VISITOR_CALL_LIMIT:'12',ENDO_CHAT_VISITOR_SESSION_LIMIT:'3',ENDO_CHAT_NETWORK_CALL_LIMIT:'20',ENDO_CHAT_NETWORK_SESSION_LIMIT:'8',ENDO_CHAT_ACCESS_CODE:'SyntheticDemoAccessCode123',ENDO_CHAT_SESSION_SECRET:'SyntheticSessionSecretNeverUseInProduction123',ORCHESTRATE_ENABLED:'false',ENDO_DEMO_INFERENCE_ENABLED:'false',ENDO_DEMO_KILL_SWITCH:'true',OTEL_SDK_DISABLED:'true',ORCHESTRATE_API_URL:'https://api.eu-de.watson-orchestrate.cloud.ibm.com/instances/SyntheticTenant',ORCHESTRATE_AGENT_ID:'c6698d4e-a08d-4b77-bf05-139ff3b4c695',ORCHESTRATE_ENVIRONMENT:'live',WATSONX_AI_AUTH_TYPE:'iam',WATSONX_AI_APIKEY:'SyntheticServerKey',WATSONX_AI_TIMEOUT_MS:'1000'};
const Context={network:'a'.repeat(64),id:'11111111-1111-4111-8111-111111111111',started:Now-1000,until:Now+3600000};
const signal=()=>new AbortController().signal;
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function memory(){
 const records=new Map<string,{data:unknown;etag:string}>();
 const store:QuotaStore={async set(key,content){validateConversationTicket(key,content);if(records.has(key))return {modified:false};const etag=String(records.size+1);records.set(key,{data:JSON.parse(content),etag});return {modified:true,etag};},async getWithMetadata(key){validateConversationTicket(key);return records.get(key)??null;}};
 return {store,records};
}

function fixture(){
 const environment={...Settings},storage=memory();let now=Now;
 const transport=vi.fn<Transport>(async(address,init)=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):json({thread_id:new Headers(init.headers).get('X-IBM-THREAD-ID')||randomUUID(),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'This educational discussion cannot establish a diagnosis.'}}]}));
 const service=createProductionConversation({environment,store:async()=>storage.store,transport,clock:()=>now});
 const start=()=>service.handle({version:'2',action:'start',syntheticOnly:true},Context,signal());
 const turn=(receipt:unknown,message='what is endometriosis?',history:string[]=[],context=Context)=>service.handle({version:'2',action:'turn',receipt,message,history},context,signal());
 return {...storage,environment,transport,service,start,turn,setNow:(value:number)=>{now=value;}};
}
it('sends edited first/follow-up text using server-owned thread, without replaying history',async()=>{
 const f=fixture(),started=await f.start(),first=await f.turn(started.receipt),second=await f.turn(first.receipt,'could you explain more?',['what is endometriosis?']);
 expect(first).toMatchObject({state:'replied'});expect(second).toMatchObject({state:'replied'});
 const calls=f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'));expect(calls).toHaveLength(2);
 expect(JSON.parse(String(calls[1][1].body))).toEqual({messages:[{role:'user',content:'could you explain more?'}],stream:false});
 expect(new Headers(calls[0][1].headers).has('X-IBM-THREAD-ID')).toBe(false);expect(new Headers(calls[1][1].headers).get('X-IBM-THREAD-ID')).toMatch(/^[a-f0-9-]{36}$/);
 expect(JSON.stringify(second)).not.toContain('thread_id');expect(JSON.stringify([...f.records.values()])).not.toContain('what is endometriosis');
});
it('starts an isolated conversation and rejects receipt tampering, cross-operator use and history edits',async()=>{
 const f=fixture(),one=await f.start(),two=await f.start();expect(one.receipt).not.toBe(two.receipt);
 await expect(f.turn(String(one.receipt)+'A')).rejects.toThrow();
 await expect(f.turn(one.receipt,'hello',[],{...Context,id:randomUUID()})).rejects.toThrow();
 const reply=await f.turn(one.receipt);await expect(f.turn(reply.receipt,'explain more',['changed history'])).rejects.toThrow();
});
it('atomically consumes a turn once, including concurrent duplicates',async()=>{
 const f=fixture(),start=await f.start();const results=await Promise.allSettled([f.turn(start.receipt),f.turn(start.receipt)]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'))).toHaveLength(1);
});
it.each(['ENDO_CHAT_ENABLED','ENDO_CHAT_TOOL_POLICY'])('defaults closed without %s',async key=>{
 const f=fixture();delete (f.environment as Record<string,string|undefined>)[key];await expect(f.start()).rejects.toThrow();expect(f.transport).not.toHaveBeenCalled();
});
it('rejects expired, unknown and old-window visitor identities',async()=>{const f=fixture();for(const context of [{...Context,until:Now},{...Context,id:'spoofed'},{...Context,started:Now-2}]){await expect(f.service.handle({version:'2',action:'start',syntheticOnly:true},context,signal())).rejects.toThrow();}expect(f.records.size).toBe(0);expect(f.transport).not.toHaveBeenCalled();});
it('closes on kill switch and session expiry',async()=>{
 const f=fixture(),start=await f.start();f.environment.ENDO_CHAT_KILL_SWITCH='true';await expect(f.turn(start.receipt)).rejects.toThrow();f.environment.ENDO_CHAT_KILL_SWITCH='false';f.setNow(Now+14400000);await expect(f.turn(start.receipt)).rejects.toThrow();expect(f.transport).not.toHaveBeenCalled();
});
it('screens privacy and urgency before IBM, preserving approved warning text',async()=>{
 const f=fixture(),start=await f.start();await expect(f.turn(start.receipt,'email patient@example.com')).rejects.toThrow();
 const reply=await f.turn(start.receipt,'patient is pregnant with fainting and sudden severe pelvic pain');expect(reply.state).toBe('safetyHalt');expect(reply.warnings?.join(' ')).toContain('Immediate emergency assessment');expect(f.transport).not.toHaveBeenCalled();await expect(f.turn(start.receipt,'feeling better')).rejects.toThrow();
});
it('routes an explicit structured request to the existing workflow without submitting case data',async()=>{
 const f=fixture(),start=await f.start();expect(await f.turn(start.receipt,'please analyze this case')).toMatchObject({state:'structuredRequired'});expect(f.transport).not.toHaveBeenCalled();
});
it.each(['invalid','action','refusal','threadMismatch','timeout','authentication'])('fails closed for provider %s without retries',async kind=>{
 const f=fixture(),start=await f.start();
 f.transport.mockImplementation(async(address)=>{
  if(address.includes('/identity/token'))return kind==='authentication'?new Response(null,{status:401}):json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600});
  if(kind==='timeout')throw new Error('synthetic network failure');
  return json(kind==='invalid'?{}:{thread_id:randomUUID(),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'general education',...(kind==='action'?{tool_calls:[]}:{}),...(kind==='refusal'?{refusal:'declined'}:{})}}]});
 });
 if(kind==='refusal')expect(await f.turn(start.receipt)).toMatchObject({state:'refused'});
 else if(kind==='threadMismatch'){const first=await f.turn(start.receipt);await expect(f.turn(first.receipt,'more',['what is endometriosis?'])).rejects.toThrow();}
 else await expect(f.turn(start.receipt)).rejects.toThrow();
 expect(f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token')).length).toBeLessThanOrEqual(kind==='threadMismatch'?2:1);
});
it('enforces shared daily call and conversation quotas',async()=>{
 const f=fixture();f.environment.ENDO_CHAT_DAILY_CALL_LIMIT='1';f.environment.ENDO_CHAT_DAILY_SESSION_LIMIT='1';
 const start=await f.start(),first=await f.turn(start.receipt);await expect(f.turn(first.receipt,'more',['what is endometriosis?'])).rejects.toThrow();await expect(f.start()).rejects.toThrow();expect(f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'))).toHaveLength(1);
});
it('denies action-bearing caller fields and patient identifiers without a provider call',async()=>{
 const f=fixture(),start=await f.start();
 await expect(f.service.handle({version:'2',action:'turn',receipt:start.receipt,history:[],message:'hello',threadId:randomUUID()},Context,signal())).rejects.toThrow();
 await expect(f.turn(start.receipt,'medical record 123456789')).rejects.toThrow();expect(f.transport).not.toHaveBeenCalled();
});
it('retains prior urgency after a later improvement and does not display prescribing output',async()=>{
 const f=fixture(),start=await f.start(),one=await f.turn(start.receipt,'general educational discussion');
 const urgent=await f.turn(one.receipt,'patient is pregnant with fainting',['general educational discussion']);expect(urgent.state).toBe('safetyHalt');
 await expect(f.turn(one.receipt,'feeling better',['general educational discussion'])).rejects.toThrow();
 const next=await f.start();f.transport.mockImplementation(async(address)=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):json({thread_id:randomUUID(),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'take 20 mg medication'}}]}));await expect(f.turn(next.receipt)).rejects.toThrow();
});
it('aborts a slow provider once, counts the attempted call and retains no transcript',async()=>{
 const f=fixture();f.environment.WATSONX_AI_TIMEOUT_MS='100';const start=await f.start();
 f.transport.mockImplementation(async(address,init)=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):new Promise((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})));
 await expect(f.turn(start.receipt)).rejects.toThrow();expect(f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'))).toHaveLength(1);
 expect([...f.records.entries()].filter(([key])=>key.startsWith('outcome/call/'))[0][1].data).toMatchObject({status:'failed',invoked:true});
});
it('fails closed when strong lock readback or audit writing fails',async()=>{
 const f=fixture(),start=await f.start(),original=f.store.getWithMetadata;
 f.store.getWithMetadata=async key=>key.startsWith('chat/lock/')?null:original(key);await expect(f.turn(start.receipt)).rejects.toThrow();expect(f.transport).not.toHaveBeenCalled();
 const g=fixture(),session=await g.start(),write=g.store.set;g.store.set=async(key,...args)=>{if(key.startsWith('outcome/call/'))throw new Error('synthetic storage fault');return write(key,...args);};await expect(g.turn(session.receipt)).rejects.toThrow();
});

it('validates only production operational records and never historical ticket shapes',()=>{expect(()=>validateConversationTicket('chat/lock/'+randomUUID()+'/12','{"consumed":true}')).toThrow();expect(()=>validateConversationTicket('visit/2026-11-16/'+randomUUID()+'/0')).toThrow();expect(()=>validateConversationTicket('chat/lock/'+randomUUID()+'/0','{"transcript":"unapproved"}')).toThrow();});

it('reuses preview safety explanations and source/caution screening for anonymous discussion',async()=>{const f=fixture(),start=await f.start();const urgent=await f.turn(start.receipt,'Sudden severe lower-abdominal pain, heavy vaginal bleeding and fainting. BP 86/52; HR 124. Pregnancy status unknown.');expect(urgent.state).toBe('safetyHalt');expect(urgent.safetyExplanation).toMatchObject({pregnancy:'unknown'});expect(f.transport).not.toHaveBeenCalled();expect('readingSourceIds' in urgent).toBe(false);const next=await f.start();f.transport.mockImplementation(async(address)=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):json({thread_id:randomUUID(),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'The patient has pelvic pain. Endometriosis is an educational discussion topic.'}}]}));const reply=await f.turn(next.receipt);expect(reply.text).toBe('The patient has pelvic pain. Endometriosis is an educational discussion topic.');expect(reply.clinicalWarnings).toContain('patientAssertion');expect(reply.readingSourceIds).toContain('WHO-2025');});
it('enforces visitor call limits before IAM independently of site capacity',async()=>{const f=fixture();f.environment.ENDO_CHAT_VISITOR_CALL_LIMIT='1';const start=await f.start(),first=await f.turn(start.receipt);await expect(f.turn(first.receipt,'more',['what is endometriosis?'])).rejects.toThrow();expect(f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'))).toHaveLength(1);const other={...Context,id:randomUUID()};const second=await f.service.handle({version:'2',action:'start',syntheticOnly:true},other,signal());await f.service.handle({version:'2',action:'turn',receipt:second.receipt,message:'fictional education',history:[]},other,signal());expect(f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'))).toHaveLength(2);});
it('enforces shared network limits across independent visitor cookies',async()=>{const f=fixture();f.environment.ENDO_CHAT_NETWORK_CALL_LIMIT='1';const start=await f.start();await f.turn(start.receipt);const other={...Context,id:randomUUID()},second=await f.service.handle({version:'2',action:'start',syntheticOnly:true},other,signal());await expect(f.service.handle({version:'2',action:'turn',receipt:second.receipt,message:'fictional education',history:[]},other,signal())).rejects.toThrow();expect(f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'))).toHaveLength(1);});

it('honors an immutable operational stop before IAM without rebuilding or resetting tickets',async()=>{const f=fixture(),start=await f.start();const key=productionStopKey(productionWindow(f.environment,Now)!);await f.store.set(key,'{"stopped":true}',{onlyIfNew:true});const count=f.records.size;expect(await f.service.available(signal())).toBe(false);await expect(f.turn(start.receipt)).rejects.toThrow();expect(f.records.size).toBe(count);expect(f.transport).not.toHaveBeenCalled();});


it('preserves frozen site quotas across renewed sessions and UTC days throughout two months',async()=>{
 const storage=memory();let now=Now+40*86400000;
 const window={startedAt:Now,until:maximumPublicEvaluationEnd(Now),dailyCalls:1,dailySessions:1};
 const quota=()=>createConversationQuota(async()=>storage.store,window,()=>now,()=>0);
 await quota().reserveCall(signal());await quota().reserveSession(signal());
 await expect(quota().reserveCall(signal())).rejects.toThrow();
 await expect(quota().reserveSession(signal())).rejects.toThrow();
 // Another release window or visitor cannot reset the same UTC site's tickets.
 const changed={...window,startedAt:Now+1};
 await expect(createConversationQuota(async()=>storage.store,changed,()=>now,()=>0).reserveCall(signal())).rejects.toThrow();
 now+=86400000;await quota().reserveCall(signal());await quota().reserveSession(signal());
 expect([...storage.records.keys()].filter(key=>key.startsWith('policy/'))).toHaveLength(2);
 now=window.until;await expect(quota().reserveCall(signal())).rejects.toThrow();
});
it('keeps the operational stop effective late in a public evaluation period',async()=>{
 const f=fixture();f.environment.ENDO_CHAT_STARTED_AT=new Date(Now).toISOString();
 f.environment.ENDO_CHAT_UNTIL=new Date(maximumPublicEvaluationEnd(Now)).toISOString();
 f.setNow(Now+40*86400000);const window=productionWindow(f.environment,Now+40*86400000)!;
 expect(await f.service.available(signal())).toBe(true);
 await f.store.set(productionStopKey(window),'{"stopped":true}',{onlyIfNew:true});
 expect(await f.service.available(signal())).toBe(false);expect(f.transport).not.toHaveBeenCalled();
});
