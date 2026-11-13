import Prompts from '../shared/orchestratePrompts.json';
import {randomUUID} from 'node:crypto';
import {createQuota,type QuotaStore} from '../netlify/evaluation/demoQuota';
import type {OrchestrateTurn} from '../netlify/evaluation/orchestrateTransport';

/** Maintenance-only test preparation. No import/startup/build invocation and no
 * transport creation. Live execution requires separate authorization and a trusted
 * operator harness that composes actual quota, privacy and IAM controls.
 */
export async function runNonclinicalProbe(client:{authenticate(signal:AbortSignal):Promise<void>;complete(turn:OrchestrateTurn,signal:AbortSignal):Promise<{text:string;threadId:string}>},signal:AbortSignal,acknowledgement:'offline-mocked'|'authorized-live-nonclinical'){
 if(!['offline-mocked','authorized-live-nonclinical'].includes(acknowledgement))throw new Error('Explicit test authorization is required.');
 const report={execution:acknowledgement==='offline-mocked'?'mocked':'operatorAuthorizedLive',authentication:'notTested',firstInference:'notTested',secondInference:'notTested',context:'notTested'};
 try{signal.throwIfAborted();await client.authenticate(signal);report.authentication='passed';}catch{report.authentication='failed';return report;}
 let first:{text:string;threadId:string};
 try{first=await client.complete({messages:[{role:'user',content:Prompts.connectionProbe[0].text}]},signal);if(first.text!=='Blue Lantern acknowledged.')throw new Error();report.firstInference='passed';}catch{report.firstInference='failed';return report;}
 try{const second=await client.complete({threadId:first.threadId,messages:Prompts.connectionProbe.map(prompt=>({role:'user',content:prompt.text}))},signal);if(second.threadId!==first.threadId||second.text!=='Blue Lantern')throw new Error();report.secondInference='passed';report.context='passed';}catch{report.secondInference='failed';report.context='failed';}
 return report;
}

/** Use a fresh isolated verification store, never the production namespace. An
 * atomic fake proves the algorithm only; a hosted factory is separately required.
 */
export async function checkConcurrentQuota(factory:()=>Promise<QuotaStore>,signal:AbortSignal,acknowledgement:'offline-mocked'|'authorized-hosted-quota-check'){
 if(!['offline-mocked','authorized-hosted-quota-check'].includes(acknowledgement))throw new Error('Explicit test authorization is required.');
 const results=await Promise.allSettled(Array.from({length:40},async()=>{signal.throwIfAborted();const store=await factory();await createQuota(store).reserve({visitorId:randomUUID(),ordinal:0,dailyLimit:3},signal);}));
 const admitted=results.filter(result=>result.status==='fulfilled').length;
 return {execution:acknowledgement==='offline-mocked'?'mocked':'operatorAuthorizedHosted',attempted:40,limit:3,admitted,rejected:40-admitted,passed:admitted===3};
}
