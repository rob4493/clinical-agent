import {describe,it,expect,vi} from 'vitest';
import {createProductionIamOnce,config,Ticket} from '../../netlify/functions/productionIamOnce';

const now=Date.parse('2026-11-21T05:00:00Z');
const context={site:{id:'b1f36feb-3225-4a27-9dff-de780d166161'},deploy:{id:'approved-production-deploy',context:'production',published:true}};
function settings():Record<string,string|undefined>{return {
 ENDO_PRODUCTION_IAM_ENABLED:'true',ENDO_PRODUCTION_IAM_KILL_SWITCH:'false',
 ENDO_PRODUCTION_IAM_STARTED_AT:new Date(now-1000).toISOString(),ENDO_PRODUCTION_IAM_UNTIL:new Date(now+599000).toISOString(),
 ENDO_CHAT_ENABLED:'false',ENDO_CHAT_KILL_SWITCH:'true',ORCHESTRATE_ENABLED:'false',ENDO_DEMO_INFERENCE_ENABLED:'false',ENDO_DEMO_KILL_SWITCH:'true',OTEL_SDK_DISABLED:'true',
 WATSONX_AI_AUTH_TYPE:'iam',WATSONX_AI_APIKEY:'mock-not-a-real-key',WATSONX_AI_TIMEOUT_MS:'5000'
};}
function setup(e=settings()){
 let value:unknown=null;
 const set=vi.fn(async(_key:string,text:string)=>{if(value)return {modified:false};value=JSON.parse(text);return {modified:true};});
 const read=vi.fn(async()=>value),store=vi.fn(async()=>({set,read}));
 const transport=vi.fn(async()=>new Response(JSON.stringify({access_token:'mock-token-never-exposed',token_type:'Bearer',expires_in:3600}),{headers:{'Content-Type':'application/json'}}));
 const log=vi.fn();
 const run=createProductionIamOnce({settings:()=>e,clock:()=>now,store,transport,log});
 return {e,set,read,store,transport,log,run};
}
describe('Production scheduled IAM one-shot',()=>{
 it('is scheduled, with no custom public path',()=>{expect(config).toEqual({schedule:'0 0 1 1 *'});});
 it('uses the existing IAM broker and only logs sanitized success',async()=>{
  const x=setup();await x.run(context);
  expect(x.transport).toHaveBeenCalledTimes(1);
  const [url,init]=x.transport.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe('https://iam.cloud.ibm.com/identity/token');expect(init.method).toBe('POST');
  expect(new URLSearchParams(String(init.body)).get('grant_type')).toBe('urn:ibm:params:oauth:grant-type:apikey');
  expect(new URLSearchParams(String(init.body)).get('apikey')).toBe(x.e.WATSONX_AI_APIKEY);
  expect(x.log).toHaveBeenCalledExactlyOnceWith({status:'PASS',iamHttp:200,errorCode:null,runtimeConfigurationAccessed:true});
  expect(JSON.stringify(x.log.mock.calls)).not.toMatch(/mock-token|mock-not-a-real-key|nonce|access_token/);
 });
 it.each([
  ['disabled','ENDO_PRODUCTION_IAM_ENABLED','false'],['kill','ENDO_PRODUCTION_IAM_KILL_SWITCH','true'],
  ['missing kill','ENDO_PRODUCTION_IAM_KILL_SWITCH',undefined],['expired','ENDO_PRODUCTION_IAM_UNTIL',new Date(now).toISOString()],
  ['too long','ENDO_PRODUCTION_IAM_UNTIL',new Date(now+600001).toISOString()],['future','ENDO_PRODUCTION_IAM_STARTED_AT',new Date(now+1).toISOString()],
  ['public inference','ENDO_CHAT_ENABLED','true'],['demo inference','ENDO_DEMO_INFERENCE_ENABLED','true'],['telemetry','OTEL_SDK_DISABLED','false']
 ])('rejects %s before credential access',async(_label,key,value)=>{
  const e=settings();e[key]=value;Object.defineProperty(e,'WATSONX_AI_APIKEY',{get(){throw Error('must not read');}});
  const x=setup(e);await x.run(context);expect(x.store).not.toHaveBeenCalled();expect(x.transport).not.toHaveBeenCalled();
  expect(x.log.mock.calls[0][0].runtimeConfigurationAccessed).toBe(false);
 });
 it.each([
  {},{...context,site:{id:'wrong'}},{...context,deploy:{...context.deploy,context:'deploy-preview'}},
  {...context,deploy:{...context.deploy,published:false}}
 ])('rejects an unverified production/site context',async c=>{const x=setup();await x.run(c);expect(x.store).not.toHaveBeenCalled();expect(x.transport).not.toHaveBeenCalled();});
 it('concurrent and repeated invocations cannot repeat IAM',async()=>{
  const x=setup();await Promise.all([x.run(context),x.run(context),x.run(context)]);await x.run(context);
  expect(x.transport).toHaveBeenCalledTimes(1);expect(x.set.mock.calls.every(([key])=>key===Ticket)).toBe(true);
 });
 it('an HTTP rejection consumes the one-shot allowance and omits private error details',async()=>{
  const x=setup();x.transport.mockImplementation(async()=>new Response(JSON.stringify({errorCode:'BXNIM0415E',errorMessage:'private provider text',apikey:'mock-not-a-real-key'}),{status:400}));
  await x.run(context);await x.run(context);expect(x.transport).toHaveBeenCalledTimes(1);
  expect(x.log.mock.calls[0][0]).toEqual({status:'FAIL',iamHttp:400,errorCode:'BXNIM0415E',runtimeConfigurationAccessed:true});
  expect(JSON.stringify(x.log.mock.calls)).not.toMatch(/private|mock-not-a-real-key/);
 });
 it('network failure is never retried',async()=>{const x=setup();x.transport.mockRejectedValue(Error('private'));await x.run(context);await x.run(context);expect(x.transport).toHaveBeenCalledTimes(1);expect(x.log.mock.calls[0][0].status).toBe('FAIL');});
 it('rejects malformed successful token responses',async()=>{const x=setup();x.transport.mockImplementation(async()=>new Response('{}',{headers:{'Content-Type':'application/json'}}));await x.run(context);expect(x.log.mock.calls[0][0].status).toBe('FAIL');});
 it('does not access the key on ambiguous storage readback',async()=>{const x=setup();x.read.mockResolvedValue({version:1,nonce:'not-the-owner'});await x.run(context);expect(x.transport).not.toHaveBeenCalled();expect(x.log.mock.calls[0][0].runtimeConfigurationAccessed).toBe(false);});
 it('does not access the key when storage fails',async()=>{const x=setup();x.set.mockRejectedValue(Error('private'));await x.run(context);expect(x.transport).not.toHaveBeenCalled();expect(x.log.mock.calls[0][0].runtimeConfigurationAccessed).toBe(false);});
 it('rechecks expiration after claiming the record',async()=>{const x=setup();x.read.mockImplementation(async()=>{x.e.ENDO_PRODUCTION_IAM_KILL_SWITCH='true';return {};});await x.run(context);expect(x.transport).not.toHaveBeenCalled();});
 it('does not expose arbitrary error-code text',async()=>{const x=setup();x.transport.mockImplementation(async()=>new Response(JSON.stringify({errorCode:'secret-provider-message'}),{status:401}));await x.run(context);expect(x.log.mock.calls[0][0].errorCode).toBeNull();});
});
