import {QuotaError,waitQuota,type QuotaStore} from './demoQuota';
/** Immutable ownership stores only random operational UUIDs. No transcript or
 * clinical context is persisted. Provider thread reuse by another visit fails closed.
 */
export async function ownThread(factory:(signal:AbortSignal)=>Promise<QuotaStore>,visitId:string,threadId:string,signal:AbortSignal){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!uuid.test(visitId)||!uuid.test(threadId))throw new QuotaError('unavailable');
 const operation=AbortSignal.any([signal,AbortSignal.timeout(1500)]),store=await waitQuota(factory(operation),operation),key='thread/'+threadId;
 const content=JSON.stringify({ownerId:visitId});await waitQuota(store.set(key,content,{onlyIfNew:true}),operation);
 const observed=await waitQuota(store.getWithMetadata(key),operation);
 if(!observed||typeof observed.etag!=='string'||!observed.etag||JSON.stringify(observed.data)!==content)throw new QuotaError('unavailable');
 operation.throwIfAborted();
}
