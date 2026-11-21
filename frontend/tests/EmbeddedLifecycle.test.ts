import {afterEach,expect,it,vi} from 'vitest';
import {startEmbedded,sessionToken,type EmbedLoader,type ChatInstance} from '../src/embedded/session';
import {EmbeddedLoaderUrl} from '../src/embedded/liveConfiguration';
afterEach(()=>vi.useRealTimers());
const Token='eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJTeW50aGV0aWMifQ.U3ludGhldGljU2lnbmF0dXJl';
function setup(){
 const mount=document.createElement('div');mount.id='SyntheticEmbedMount';document.body.append(mount);let listener:((event:{authToken:string|null})=>Promise<void>)|undefined;
 const client:ChatInstance={on:vi.fn((event,handler)=>{expect(event).toBe('authTokenNeeded');listener=handler;}),off:vi.fn(),updateAuthToken:vi.fn()};
 const loader:EmbedLoader={init:vi.fn(async(configuration)=>{(configuration.chatOptions as {onLoad:(instance:ChatInstance)=>void}).onLoad(client);}),destroy:vi.fn(async()=>{})};
 const token=vi.fn(async(signal:AbortSignal)=>{signal.throwIfAborted();return {version:'1' as const,token:Token,expiresAt:Date.now()+120000,sessionExpiresAt:Date.now()+600000};});
 const statuses=vi.fn(),getLoader=vi.fn(async()=>loader),stop=startEmbedded(mount,statuses,{token,loader:getLoader});
 return {mount,client,loader,token,statuses,getLoader,stop,listener:()=>listener};
}
it('authorizes before loading and passes no case, narrative or upload context',async()=>{const test=setup();await vi.waitFor(()=>expect(test.loader.init).toHaveBeenCalledOnce());expect(test.token).toHaveBeenCalledOnce();expect(test.getLoader).toHaveBeenCalledOnce();const configuration=vi.mocked(test.loader.init).mock.calls[0][0];expect(Object.keys(configuration).sort()).toEqual(['chatOptions','hostURL','layout','openChatByDefault','orchestrationID','rootElementID','showLauncher','token']);expect(configuration.rootElementID).toBe('SyntheticEmbedMount');expect(configuration.rootElementID).not.toBe('root');expect(configuration.layout).toEqual({customElement:test.mount});test.stop();await vi.waitFor(()=>expect(test.loader.destroy).toHaveBeenCalled());});
it('renews through the documented event and updates the token without a second session',async()=>{const test=setup();await vi.waitFor(()=>expect(test.listener()).toBeDefined());const event={authToken:null};await test.listener()!(event);expect(test.token).toHaveBeenCalledTimes(2);expect(test.client.updateAuthToken).toHaveBeenCalledWith(Token);expect(event.authToken).toBe(Token);expect(test.loader.init).toHaveBeenCalledOnce();test.stop();await Promise.resolve();});
it('cancels bootstrap and prevents loading when closed before authorization completes',async()=>{const mount=document.createElement('div');let signal:AbortSignal|undefined;const loader=vi.fn();const stop=startEmbedded(mount,vi.fn(),{token:async(requestSignal)=>{signal=requestSignal;await new Promise(resolve=>requestSignal.addEventListener('abort',resolve,{once:true}));requestSignal.throwIfAborted();throw new Error();},loader});stop();await vi.waitFor(()=>expect(signal?.aborted).toBe(true));expect(loader).not.toHaveBeenCalled();});
it('rejects a second simultaneous session and detaches renewal on cleanup',async()=>{const test=setup();await vi.waitFor(()=>expect(test.listener()).toBeDefined());expect(()=>startEmbedded(document.createElement('div'),vi.fn())).toThrow('sessionActive');test.stop();await vi.waitFor(()=>expect(test.client.off).toHaveBeenCalled());const calls=test.token.mock.calls.length;await test.listener()!({authToken:null});expect(test.token).toHaveBeenCalledTimes(calls);});
it('expires a session and cancels its transport',async()=>{vi.useFakeTimers();const test=setup();await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(120000);test.stop();await vi.advanceTimersByTimeAsync(0);expect(test.loader.destroy).toHaveBeenCalled();});
it('sends only a fixed operational bootstrap request with same-origin credentials',async()=>{const transport=vi.fn(async()=>new Response(JSON.stringify({version:'1',token:Token,expiresAt:Date.now()+120000,sessionExpiresAt:Date.now()+600000})));await sessionToken(new AbortController().signal,undefined,transport);const [url,options]=transport.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('/api/v1/embed-session');expect(JSON.parse(String(options.body))).toEqual({action:'start'});expect(options.credentials).toBe('same-origin');expect(options.redirect).toBe('error');expect(options.headers).not.toHaveProperty('Authorization');});
it('does not load IBM for a denied bootstrap',async()=>{const loader=vi.fn(),status=vi.fn();const stop=startEmbedded(document.createElement('div'),status,{token:async()=>{throw new Error('embedDisabled');},loader});await vi.waitFor(()=>expect(status).toHaveBeenCalledWith(expect.stringContaining('preview activation is disabled')));expect(loader).not.toHaveBeenCalled();stop();});
it('uses only the exact official loader URL',()=>{expect(EmbeddedLoaderUrl).toBe('https://dl.watson-orchestrate.ibm.com/wxochat/wxoLoader.js?embed=true');});

it('loads the official script once and reuses it across sequential sessions',async()=>{
 let appended=0;const instance:ChatInstance={on:vi.fn(),off:vi.fn(),updateAuthToken:vi.fn()},loader:EmbedLoader={init:vi.fn(async(configuration)=>{(configuration.chatOptions as {onLoad:(client:ChatInstance)=>void}).onLoad(instance);}),destroy:vi.fn(async()=>{})};
 vi.stubGlobal('wxoLoader',loader);
 vi.spyOn(document.head,'append').mockImplementation((...nodes)=>{for(const node of nodes)if(node instanceof HTMLScriptElement){expect(node.src).toBe(EmbeddedLoaderUrl);appended++;queueMicrotask(()=>node.dispatchEvent(new Event('load')));}});
 const token=async()=>({version:'1' as const,token:Token,expiresAt:Date.now()+120000,sessionExpiresAt:Date.now()+600000});
 const first=startEmbedded(document.createElement('div'),vi.fn(),{token});await vi.waitFor(()=>expect(loader.init).toHaveBeenCalledTimes(1));first();await vi.waitFor(()=>expect(loader.destroy).toHaveBeenCalledTimes(2));
 const second=startEmbedded(document.createElement('div'),vi.fn(),{token});await vi.waitFor(()=>expect(loader.init).toHaveBeenCalledTimes(2));expect(appended).toBe(1);second();await vi.waitFor(()=>expect(loader.destroy).toHaveBeenCalledTimes(4));
});

it('cancels a stalled token-response body on session abort',async()=>{
 const cancelled=vi.fn(),controller=new AbortController();
 const transport=vi.fn(async()=>new Response(new ReadableStream<Uint8Array>({start(stream){stream.enqueue(new TextEncoder().encode('{'));},cancel:cancelled})));
 const pending=sessionToken(controller.signal,undefined,transport);const rejected=expect(pending).rejects.toBeDefined();await vi.waitFor(()=>expect(transport).toHaveBeenCalledOnce());await Promise.resolve();controller.abort();await rejected;expect(cancelled).toHaveBeenCalledOnce();
});
