// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import type {Store} from '@netlify/blobs';
import {createQuotaInitializationInspector,inspectQuotaInitialization,netlifyQuota} from '../src/server/netlifyQuota';
const Name='EndoQuotaVerifyInitialization';
const Enabled={OTEL_SDK_DISABLED:'true'};
const signal=()=>new AbortController().signal;
const Context={siteID:'synthetic-site',token:'SyntheticStorageToken',edgeURL:'https://storage.invalid',uncachedEdgeURL:'https://strong.invalid'};
function configure(content:unknown){vi.stubGlobal('netlifyBlobsContext',undefined);vi.stubEnv('NETLIFY_BLOBS_CONTEXT',Buffer.from(JSON.stringify(content)).toString('base64'));}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});

it('constructs the pinned SDK client with automatic configuration without HTTP, storage methods or credential reads',async()=>{
 configure(Context);const network=vi.fn(()=>{throw new Error('NetworkForbidden');});vi.stubGlobal('fetch',network);
 const logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')];
 const settings=new Proxy(Enabled,{get(target,key){if(key!=='OTEL_SDK_DISABLED')throw new Error('Unexpected configuration read');return Reflect.get(target,key);}});
 expect(await inspectQuotaInitialization(Name,signal(),settings)).toBe('initializationReady');
 expect(network).not.toHaveBeenCalled();for(const log of logs)expect(log).not.toHaveBeenCalled();
});
it.each([{}, {siteID:'synthetic-site'}, {token:'SyntheticStorageToken'}, 'not-an-object'])('identifies the pinned SDK missing automatic configuration error %#',async content=>{
 configure(content);const network=vi.fn();vi.stubGlobal('fetch',network);
 expect(await inspectQuotaInitialization(Name,signal(),Enabled)).toBe('automaticConfigurationUnavailable');expect(network).not.toHaveBeenCalled();
});
it('handles absent and malformed encoded runtime configuration without exposing it',async()=>{
 vi.stubGlobal('netlifyBlobsContext',undefined);vi.stubEnv('NETLIFY_BLOBS_CONTEXT','');
 expect(await inspectQuotaInitialization(Name,signal(),Enabled)).toBe('automaticConfigurationUnavailable');
 vi.stubEnv('NETLIFY_BLOBS_CONTEXT',Buffer.from('not-json').toString('base64'));
 expect(await inspectQuotaInitialization(Name,signal(),Enabled)).toBe('automaticConfigurationUnavailable');
 vi.stubGlobal('netlifyBlobsContext',Context);
 expect(await inspectQuotaInitialization(Name,signal(),Enabled)).toBe('automaticConfigurationUnavailable');
});
it('does not overclassify unrelated SDK errors as a missing automatic configuration',async()=>{
 configure(null);expect(await inspectQuotaInitialization(Name,signal(),Enabled)).toBe('initializationUnknown');
 const getStore=vi.fn(()=>{throw new Error('MissingBlobsEnvironmentError SyntheticPrivatePayload');});
 const inspect=createQuotaInitializationInspector(async()=>({getStore}) as unknown as Pick<typeof import('@netlify/blobs'),'getStore'>);
 expect(await inspect(Name,signal(),Enabled)).toBe('initializationUnknown');
});
it('classifies import rejection only as sdkImportFailed, irrespective of its message or name',async()=>{
 const load=vi.fn(async()=>{const error=new Error('SyntheticPrivatePayload');error.name='MissingBlobsEnvironmentError';throw error;});
 expect(await createQuotaInitializationInspector(load)(Name,signal(),Enabled)).toBe('sdkImportFailed');expect(load).toHaveBeenCalledOnce();
});
it('reports unknown for unexpected SDK exports or invalid client objects',async()=>{
 for(const module of [{},{getStore:()=>null},{getStore:()=>({})}]){
  const inspect=createQuotaInitializationInspector(async()=>module as unknown as Pick<typeof import('@netlify/blobs'),'getStore'>);
  expect(await inspect(Name,signal(),Enabled)).toBe('initializationUnknown');
 }
});
it.each([[Name,{}],['invalid/name',Enabled],['Endo'+'a'.repeat(49),Enabled]])('classifies adapter rejection before loading the SDK %#',async(name,environment)=>{
 const load=vi.fn();expect(await createQuotaInitializationInspector(load)(String(name),signal(),environment as typeof Enabled)).toBe('adapterRejected');expect(load).not.toHaveBeenCalled();
});
it('does not mistake successful construction for verified strong-read or write permission',async()=>{
 configure({siteID:Context.siteID,token:Context.token,edgeURL:Context.edgeURL});
 const network=vi.fn();vi.stubGlobal('fetch',network);
 expect(await inspectQuotaInitialization(Name,signal(),Enabled)).toBe('initializationReady');expect(network).not.toHaveBeenCalled();
});
it('uses the same strong-consistency constructor and supplies only a denying transport',async()=>{
 const set=vi.fn(),getWithMetadata=vi.fn(),getStore=vi.fn(()=>({set,getWithMetadata}) as unknown as Store);
 const inspect=createQuotaInitializationInspector(async()=>({getStore}) as unknown as Pick<typeof import('@netlify/blobs'),'getStore'>);
 expect(await inspect(Name,signal(),Enabled)).toBe('initializationReady');expect(getStore).toHaveBeenCalledWith({name:Name,consistency:'strong',fetch:expect.any(Function)});
 expect(set).not.toHaveBeenCalled();expect(getWithMetadata).not.toHaveBeenCalled();
 const transport=getStore.mock.calls[0] as unknown as [{fetch:typeof fetch}];await expect(transport[0].fetch('https://storage.invalid')).rejects.toThrow('Demo usage is unavailable. No IBM request was started.');
});
it('fails closed if initialization attempts to use its transport without making a network request',async()=>{
 const network=vi.fn();vi.stubGlobal('fetch',network);
 const getStore=vi.fn((options:{fetch:typeof fetch})=>{void options.fetch('https://storage.invalid').catch(()=>{});return {} as Store;});
 const inspect=createQuotaInitializationInspector(async()=>({getStore}) as unknown as Pick<typeof import('@netlify/blobs'),'getStore'>);
 expect(await inspect(Name,signal(),Enabled)).toBe('initializationUnknown');expect(network).not.toHaveBeenCalled();
});
it('cancels a pending import and never constructs a late client',async()=>{
 let resolve!:(sdk:Pick<typeof import('@netlify/blobs'),'getStore'>)=>void;
 const load=vi.fn(()=>new Promise<Pick<typeof import('@netlify/blobs'),'getStore'>>(done=>{resolve=done;})),abort=new AbortController();
 const pending=createQuotaInitializationInspector(load)(Name,abort.signal,Enabled);abort.abort();expect(await pending).toBe('initializationUnknown');
 const getStore=vi.fn();resolve({getStore});await Promise.resolve();expect(getStore).not.toHaveBeenCalled();
 const already=vi.fn();expect(await createQuotaInitializationInspector(already)(Name,abort.signal,Enabled)).toBe('initializationUnknown');expect(already).not.toHaveBeenCalled();
});
it('keeps operational adapter failures generic outside the protected diagnostic',async()=>{
 vi.stubGlobal('netlifyBlobsContext',undefined);vi.stubEnv('NETLIFY_BLOBS_CONTEXT','');
 await expect(netlifyQuota(Name,signal(),Enabled,vi.fn())).rejects.toMatchObject({category:'unavailable',message:'Demo usage is unavailable. No IBM request was started.'});
});
