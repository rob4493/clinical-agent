import {EmbeddedLoaderUrl,LiveConfiguration} from './liveConfiguration';
export interface ChatInstance {on:(event:string,handler:(event:{authToken:string|null})=>Promise<void>)=>void;off:(event:string,handler:(event:{authToken:string|null})=>Promise<void>)=>void;updateAuthToken:(token:string)=>void}
export interface EmbedLoader {init:(configuration:Record<string,unknown>)=>Promise<void>;destroy:()=>Promise<void>}
type Session={version:'1';token:string;expiresAt:number;sessionExpiresAt:number};
let active=false;
let loaderPromise:Promise<EmbedLoader>|null=null;
/** One official script per page; no credentials, narrative or case object is accepted. */
function load(signal:AbortSignal):Promise<EmbedLoader>{
 signal.throwIfAborted();
 if(!loaderPromise)loaderPromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=EmbeddedLoaderUrl;script.referrerPolicy='no-referrer';script.async=true;
  const abort=()=>{script.remove();loaderPromise=null;reject(new Error('cancelled'));};signal.addEventListener('abort',abort,{once:true});
  script.onload=()=>{signal.removeEventListener('abort',abort);const loader=(window as unknown as {wxoLoader?:EmbedLoader}).wxoLoader;if(!loader||typeof loader.init!=='function'||typeof loader.destroy!=='function'){reject(new Error('loaderUnavailable'));return;}resolve(loader);};
  script.onerror=()=>{signal.removeEventListener('abort',abort);script.remove();loaderPromise=null;reject(new Error('loaderUnavailable'));};document.head.append(script);
 });
 return loaderPromise;
}
export async function sessionToken(signal:AbortSignal,token?:string,transport:typeof fetch=fetch):Promise<Session>{
 const response=await transport('/api/v1/embed-session',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(token?{action:'renew',token}:{action:'start'})});
 signal.throwIfAborted();if(!response.ok){void response.body?.cancel().catch(()=>{});throw new Error(response.status===403?'operatorRequired':response.status===404?'embedDisabled':'embedUnavailable');}
 const reader=response.body?.getReader();if(!reader)throw new Error('embedUnavailable');const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>4096)throw new Error('embedUnavailable');chunks.push(chunk.value);}}
 finally{signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock();}
 signal.throwIfAborted();
 const combined=new Uint8Array(size);let position=0;for(const chunk of chunks){combined.set(chunk,position);position+=chunk.length;}
 const session=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));
 if(!session||Object.keys(session).sort().join('|')!=='expiresAt|sessionExpiresAt|token|version'||session.version!=='1'||typeof session.token!=='string'||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(session.token)||session.token.length>3000||!Number.isSafeInteger(session.expiresAt)||!Number.isSafeInteger(session.sessionExpiresAt)||session.expiresAt<=Date.now()||session.expiresAt>session.sessionExpiresAt||session.sessionExpiresAt-Date.now()>600000)throw new Error('embedUnavailable');
 return session;
}
/** Lifecycle owns only operational credentials. SDK destroy unmounts chat; it does
 * not prove cancellation of a remote run or deletion of IBM-retained history.
 */
export function startEmbedded(mount:HTMLElement,onStatus:(status:string)=>void,dependencies:{token?:typeof sessionToken;loader?:(signal:AbortSignal)=>Promise<EmbedLoader>}={}){
 if(active)throw new Error('sessionActive');active=true;
 const controller=new AbortController(),signal=controller.signal;let initialization:Promise<void>|undefined;let stopped=false,loader:EmbedLoader|undefined,instance:ChatInstance|undefined,session:Session|undefined,timer:ReturnType<typeof setTimeout>|undefined,expiry:ReturnType<typeof setTimeout>|undefined,refreshing:Promise<void>|null=null;
 const bootstrap=setTimeout(()=>stop('IBM interface initialization timed out. Try again after checking preview access.'),20000);
 function stop(message?:string){if(stopped)return;stopped=true;controller.abort();clearTimeout(bootstrap);clearTimeout(timer);clearTimeout(expiry);if(instance)try{instance.off('authTokenNeeded',refresh);}catch{}session=undefined;
  // Retain the lease until SDK teardown settles; never mount a second competing instance.
  void (async()=>{try{await loader?.destroy();await initialization;await loader?.destroy();}catch{}finally{mount.replaceChildren();active=false;}})();if(message)onStatus(message);
 }
 function schedule(){clearTimeout(timer);clearTimeout(expiry);if(!session||stopped)return;if(session.expiresAt<session.sessionExpiresAt)timer=setTimeout(()=>void refresh({authToken:null}),Math.max(1000,session.expiresAt-Date.now()-30000));expiry=setTimeout(()=>stop('IBM test session expired. End the session before reconnecting.'),session.expiresAt-Date.now());}
 async function refresh(event:{authToken:string|null}){
  if(stopped||!session)return;
  if(!refreshing)refreshing=(async()=>{try{const renewed=await (dependencies.token??sessionToken)(signal,session!.token);signal.throwIfAborted();session=renewed;instance?.updateAuthToken(renewed.token);schedule();}catch{if(!stopped)stop('IBM session renewal failed. The case is unchanged.');}finally{refreshing=null;}})();
  await refreshing;if(!stopped&&session)event.authToken=session.token;
 }
 void (async()=>{try{
  onStatus('Checking private preview authorization…');session=await (dependencies.token??sessionToken)(signal);signal.throwIfAborted();
  loader=await (dependencies.loader??load)(signal);signal.throwIfAborted();
  onStatus('Loading the authorized IBM interface…');
  initialization=loader.init({...LiveConfiguration,rootElementID:mount.id,token:session.token,showLauncher:false,openChatByDefault:true,layout:{customElement:mount},chatOptions:{...LiveConfiguration.chatOptions,onLoad:(client:ChatInstance)=>{if(stopped)return;instance=client;client.on('authTokenNeeded',refresh);clearTimeout(bootstrap);schedule();onStatus('IBM interface loaded. Use nonclinical test messages only.');}}});
  await initialization;
  if(stopped)await loader.destroy();
 }catch(failure){if(stopped)return;const code=failure instanceof Error?failure.message:'';stop(code==='operatorRequired'?'Operator authorization is required on the protected preview.':code==='embedDisabled'?'IBM preview activation is disabled. Complete the preview security configuration.':'IBM initialization failed. Check preview session configuration; the case is unchanged.');}})();
 return ()=>stop();
}
