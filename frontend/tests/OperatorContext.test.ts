// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createOperatorVerification} from '../../netlify/functions/verifyOperatorContext';
const Now=Date.parse('2026-11-11T12:00:00Z');
const Origin='https://deploy-preview-4--clinicalagent.netlify.app';
const Settings={ORCHESTRATE_OPERATOR_DIAGNOSTIC_ENABLED:'true',ORCHESTRATE_EMBED_PREVIEW_ID:'4',ORCHESTRATE_EMBED_PREVIEW_ORIGIN:Origin,ORCHESTRATE_EMBED_OPERATOR_IDS:'operator',ORCHESTRATE_EMBED_PREVIEW_ENABLED:'false',ORCHESTRATE_EMBED_KILL_SWITCH:'true',OTEL_SDK_DISABLED:'true'};
const Context={user:{id:'operator',expiresAt:new Date(Now+60000)},deploy:{id:'preview-deploy',context:'deploy-preview',published:false}};
const request=(headers:Record<string,string>={})=>new Request(Origin+'/.netlify/functions/verifyOperatorContext',{headers});
it('reports only authorization without reading secrets, fetching, or logging',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('network forbidden'));
 const log=vi.spyOn(console,'log'),error=vi.spyOn(console,'error');
 const settings=new Proxy(Settings,{get(target,key){if(!(key in target)&&!['ORCHESTRATE_PROBE_ENABLED','ORCHESTRATE_PROBE_KILL_SWITCH'].includes(String(key)))throw new Error('unexpected configuration read');return Reflect.get(target,key);}});
 try{const response=await createOperatorVerification(()=>settings,()=>Now)(request(),Context);
  expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'authorized'});
  expect(response.headers.get('cache-control')).toBe('no-store');expect(fetch).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
 }finally{fetch.mockRestore();log.mockRestore();error.mockRestore();}
});
it('rejects missing, unlisted, expired, invalid, and serialized platform users despite spoofed headers',async()=>{
 const handler=createOperatorVerification(()=>Settings,()=>Now);
 const headers={'x-user-id':'operator','x-nf-user':'operator','x-nf-user-id':'operator','authorization':'Bearer synthetic'};
 for(const user of [undefined,{...Context.user,id:'unlisted'},{...Context.user,expiresAt:new Date(Now)},{...Context.user,expiresAt:new Date(NaN)},{...Context.user,expiresAt:new Date(Now+60000).toISOString()}]){
  const response=await handler(request(headers),{...Context,user} as typeof Context);
  expect(response.status).toBe(403);expect(await response.json()).toEqual({status:'unauthorized'});
 }
 expect((await handler(request({'x-user-id':'unlisted'}),Context)).status).toBe(200);
});
it('defaults closed and isolates preview four without changing activation or window settings',async()=>{
 for(const changes of [{ORCHESTRATE_OPERATOR_DIAGNOSTIC_ENABLED:undefined},{ORCHESTRATE_EMBED_PREVIEW_ID:'5'},{ORCHESTRATE_EMBED_PREVIEW_ENABLED:'true'},{ORCHESTRATE_EMBED_KILL_SWITCH:'false'},{OTEL_SDK_DISABLED:'false'},{ORCHESTRATE_PROBE_ENABLED:'true'},{ORCHESTRATE_PROBE_KILL_SWITCH:'false'}]){
  expect((await createOperatorVerification(()=>({...Settings,...changes}),()=>Now)(request(),Context)).status).toBe(404);
 }
 for(const deploy of [{...Context.deploy,published:true},{...Context.deploy,context:'production'},undefined])expect((await createOperatorVerification(()=>Settings,()=>Now)(request(),{...Context,deploy})).status).toBe(404);
 expect((await createOperatorVerification(()=>Settings,()=>Now)(new Request('https://deploy-preview-5--clinicalagent.netlify.app/.netlify/functions/verifyOperatorContext'),Context)).status).toBe(404);
 expect((await createOperatorVerification(()=>({}),()=>Now)(request(),Context)).status).toBe(404);
});
it('rejects alternate methods, query identity, and cross-site requests',async()=>{
 const handler=createOperatorVerification(()=>Settings,()=>Now);
 for(const input of [new Request(request(),{method:'POST'}),new Request(request().url+'?user=operator'),request({'sec-fetch-site':'cross-site'}),request({origin:'https://example.invalid'})])expect((await handler(input,Context)).status).toBe(400);
});
it('fails closed on malformed configuration and cancels without an authorized body',async()=>{
 expect((await createOperatorVerification(()=>({...Settings,ORCHESTRATE_EMBED_OPERATOR_IDS:'operator,'}),()=>Now)(request(),Context)).status).toBe(403);
 expect((await createOperatorVerification(()=>{throw new Error('private detail');})(request(),Context)).status).toBe(503);
 const abort=new AbortController();abort.abort();const response=await createOperatorVerification(()=>Settings,()=>Now)(new Request(request(),{signal:abort.signal}),Context);
 expect(response.status).toBe(499);expect(await response.text()).toBe('');
});
