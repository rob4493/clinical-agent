// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createProtectedConversation} from '../../netlify/evaluation/protectedConversation';
import {validateCompetitionTicket} from '../../netlify/evaluation/orchestrateCompetition';
import {createConverse} from '../../netlify/functions/converse';
import type {QuotaStore} from '../../netlify/evaluation/demoQuota';
import type {Transport} from '../../netlify/evaluation/watsonShadow';
const Origin='https://deploy-preview-4--clinicalagent.netlify.app';
const Now=Date.parse('2026-11-16T12:00:00Z');
const Settings={ORCHESTRATE_DISCUSSION_AUTHORIZED:'true',ORCHESTRATE_COMPETITION_ENABLED:'true',ORCHESTRATE_COMPETITION_STARTED_AT:new Date(Now-1000).toISOString(),ORCHESTRATE_COMPETITION_UNTIL:new Date(Now+14400000-1000).toISOString(),ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT:'50',ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT:'20',ORCHESTRATE_PROBE_ENABLED:'false',ORCHESTRATE_PROBE_EXCEPTION_ENABLED:'false',ORCHESTRATE_PROBE_KILL_SWITCH:'false',ORCHESTRATE_ENABLED:'false',ENDO_DEMO_INFERENCE_ENABLED:'false',ENDO_DEMO_KILL_SWITCH:'true',ORCHESTRATE_EMBED_PREVIEW_ENABLED:'false',ORCHESTRATE_EMBED_KILL_SWITCH:'true',OTEL_SDK_DISABLED:'true',ORCHESTRATE_EMBED_PREVIEW_ID:'4',ORCHESTRATE_EMBED_PREVIEW_ORIGIN:Origin,ORCHESTRATE_EMBED_OPERATOR_IDS:'operator',ORCHESTRATE_API_URL:'https://api.eu-de.watson-orchestrate.cloud.ibm.com/instances/SyntheticTenant',ORCHESTRATE_AGENT_ID:'c6698d4e-a08d-4b77-bf05-139ff3b4c695',ORCHESTRATE_ENVIRONMENT:'live',WATSONX_AI_AUTH_TYPE:'iam',WATSONX_AI_APIKEY:'SyntheticServerKey',WATSONX_AI_TIMEOUT_MS:'1000'};
const Context={user:{id:'operator',expiresAt:new Date(Now+14400000)},deploy:{id:'SyntheticDeploy',context:'deploy-preview',published:false}};
const signal=()=>new AbortController().signal;
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function memory(){
 const records=new Map<string,{data:unknown;etag:string}>();
 const store:QuotaStore={async set(key,content){validateCompetitionTicket(key,content);if(records.has(key))return {modified:false};const etag=String(records.size+1);records.set(key,{data:JSON.parse(content),etag});return {modified:true,etag};},async getWithMetadata(key){validateCompetitionTicket(key);return records.get(key)??null;}};
 return {store,records};
}

function fixture(operatorContext=Context){
 const environment={...Settings},storage=memory();let now=Now;
 const transport=vi.fn<Transport>(async(address,init)=>address.includes('/identity/token')?json({access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}):json({thread_id:new Headers(init.headers).get('X-IBM-THREAD-ID')||randomUUID(),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'This educational discussion cannot establish a diagnosis.'}}]}));
 const service=createProtectedConversation({environment,store:async()=>storage.store,transport,clock:()=>now});
 const start=()=>service.handle({version:'2',action:'start',syntheticOnly:true},operatorContext,signal());
 const turn=(receipt:unknown,message='what is endometriosis?',history:string[]=[],context=operatorContext)=>service.handle({version:'2',action:'turn',receipt,message,history},context,signal());
 return {...storage,environment,transport,service,start,turn,setNow:(value:number)=>{now=value;}};
}
it.each([1,3,7])('maintains an operator-bound receipt/thread across a %s-day window and fails closed at expiry',async days=>{
 const until=Now+days*86400000,operator={...Context,user:{...Context.user,expiresAt:new Date(until+60000)}},f=fixture(operator);
 f.environment.ORCHESTRATE_COMPETITION_STARTED_AT=new Date(Now).toISOString();f.environment.ORCHESTRATE_COMPETITION_UNTIL=new Date(until).toISOString();
 const started=await f.start(),one=await f.turn(started.receipt);f.setNow(until-1);const two=await f.turn(one.receipt,'could you explain more?',['what is endometriosis?']);expect(two.state).toBe('replied');
 const calls=f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'));expect(calls).toHaveLength(2);expect(new Headers(calls[1][1].headers).get('X-IBM-THREAD-ID')).toMatch(/^[a-f0-9-]{36}$/);
 f.setNow(until);const count=f.records.size;await expect(f.turn(two.receipt,'more',['what is endometriosis?','could you explain more?'])).rejects.toThrow();expect(f.records.size).toBe(count);expect(f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'))).toHaveLength(2);expect(f.environment.ORCHESTRATE_COMPETITION_UNTIL).toBe(new Date(until).toISOString());
});
it('does not extend a receipt past its original operator expiry even after a fresh sign-in',async()=>{
 const day=86400000,original={...Context,user:{...Context.user,expiresAt:new Date(Now+day)}},f=fixture(original);
 f.environment.ORCHESTRATE_COMPETITION_STARTED_AT=new Date(Now).toISOString();f.environment.ORCHESTRATE_COMPETITION_UNTIL=new Date(Now+7*day).toISOString();const start=await f.start();
 f.setNow(Now+day);await expect(f.turn(start.receipt)).rejects.toThrow();const reauthenticated={...Context,user:{...Context.user,expiresAt:new Date(Now+7*day)}};
 await expect(f.turn(start.receipt,'what is endometriosis?',[],reauthenticated)).rejects.toThrow();expect(f.transport).not.toHaveBeenCalled();expect(await f.service.handle({version:'2',action:'start',syntheticOnly:true},reauthenticated,signal())).toMatchObject({state:'started'});
});
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
 f.environment.ORCHESTRATE_EMBED_OPERATOR_IDS='operator,other';await expect(f.turn(one.receipt,'hello',[],{...Context,user:{...Context.user,id:'other'}})).rejects.toThrow();
 const reply=await f.turn(one.receipt);await expect(f.turn(reply.receipt,'explain more',['changed history'])).rejects.toThrow();
});
it('atomically consumes a turn once, including concurrent duplicates',async()=>{
 const f=fixture(),start=await f.start();const results=await Promise.allSettled([f.turn(start.receipt),f.turn(start.receipt)]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(f.transport.mock.calls.filter(([url])=>!url.includes('/identity/token'))).toHaveLength(1);
});
it.each(['ORCHESTRATE_DISCUSSION_AUTHORIZED','ORCHESTRATE_COMPETITION_ENABLED'])('defaults closed without %s',async key=>{
 const f=fixture();delete (f.environment as Record<string,string|undefined>)[key];await expect(f.start()).rejects.toThrow();expect(f.transport).not.toHaveBeenCalled();
});
it.each([
 {},{...Context,user:{...Context.user,expiresAt:new Date(Now)}},{...Context,user:{...Context.user,id:'spoofed'}},
 {...Context,deploy:{...Context.deploy,published:true}},{...Context,deploy:{...Context.deploy,context:'production'}}
])('rejects unauthenticated/expired/non-preview context %j',async context=>{
 const f=fixture();await expect(f.service.handle({version:'2',action:'start',syntheticOnly:true},context,signal())).rejects.toThrow();expect(f.records.size).toBe(0);expect(f.transport).not.toHaveBeenCalled();
});
it('closes on kill switch and session expiry',async()=>{
 const f=fixture(),start=await f.start();f.environment.ORCHESTRATE_PROBE_KILL_SWITCH='true';await expect(f.turn(start.receipt)).rejects.toThrow();f.environment.ORCHESTRATE_PROBE_KILL_SWITCH='false';f.setNow(Now+14400000);await expect(f.turn(start.receipt)).rejects.toThrow();expect(f.transport).not.toHaveBeenCalled();
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
 const f=fixture();f.environment.ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT='1';f.environment.ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT='1';
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
it('requires exact preview origin and ignores spoofed browser identity headers',async()=>{
 const f=fixture(),handler=createConverse(undefined,f.service),body=JSON.stringify({version:'2',action:'start',syntheticOnly:true});
 const response=await handler(new Request(Origin+'/api/v1/conversation',{method:'POST',headers:{Origin,'Content-Type':'application/json','X-Nf-User-Id':'operator'},body}));expect(response.status).toBe(503);expect(f.records.size).toBe(0);
 const wrong='https://clinicalagent.netlify.app';expect((await handler(new Request(wrong+'/api/v1/conversation',{method:'POST',headers:{Origin:wrong,'Content-Type':'application/json'},body}),Context)).status).toBe(503);
});
