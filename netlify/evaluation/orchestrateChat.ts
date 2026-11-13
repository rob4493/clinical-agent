import Prompts from '../../shared/orchestratePrompts.json';
import {analyze,CoverageMessage} from './analysis';
import {validateCase} from './input';
import {loadPackages,hashBytes,Module1} from './packages';
import {readOrchestrateTarget,type OrchestrateEnvironment} from './orchestrateTarget';
import {createOrchestrateTransport,type OrchestrateGate,type OrchestrateTurn} from './orchestrateTransport';
import {createReceipts,SessionError} from './visitReceipt';
import {QuotaError} from './demoQuota';
import {createWatsonRuntime,type Transport} from './watsonShadow';

export class ChatError extends Error {constructor(readonly code:'unavailable'|'inputRejected'|'outputRejected'){super('IBM conversation is unavailable. The case is unchanged.');}}
export function chatAvailable(environment:OrchestrateEnvironment=process.env){
 try{return !!readOrchestrateTarget(environment)&&environment.ORCHESTRATE_SYNTHETIC_AUTHORIZED==='true'&&environment.ORCHESTRATE_DISCUSSION_AUTHORIZED==='true'&&environment.ORCHESTRATE_HOSTED_CONTROLS_VERIFIED==='true'&&environment.ENDO_DEMO_INFERENCE_ENABLED==='true'&&environment.ENDO_DEMO_KILL_SWITCH==='false'&&environment.OTEL_SDK_DISABLED==='true'&&/^(?:[1-9]|[1-9]\d|100)$/.test(environment.ENDO_DEMO_DAILY_LIMIT||'')&&environment.ORCHESTRATE_SYNTHETIC_POLICY_HASH===hashBytes(JSON.stringify(Prompts))&&typeof environment.WATSONX_AI_APIKEY==='string'&&environment.WATSONX_AI_APIKEY.length>0&&environment.WATSONX_AI_APIKEY.length<=512&&!/\s|[\u0000-\u001f]/.test(environment.WATSONX_AI_APIKEY);}catch{return false;}
}
export function chatCapability(environment:OrchestrateEnvironment=process.env){return {version:'1',provider:'orchestrate',status:chatAvailable(environment)?'available':'blocked',mode:'controlledSynthetic',message:chatAvailable(environment)?'Configured for controlled fictional conversation; connectivity is not verified by this check.':'IBM conversation is disabled pending privacy and hosted abuse-control verification.',prompts:chatAvailable(environment)?Prompts.prompts:[]};}

/** This is a rejection screen, not a semantic clinical-grounding validator. Natural
 * AI discussion is separately labelled and requires explicit expert/policy approval.
 * It cannot add citations or replace Endo-verified clinical analysis.
 */
export function validateDiscussion(text:unknown):string{
 if(typeof text!=='string'||!text.trim()||text.length>4000||/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|https?:|www\.|\[\d|```|\d+(?:\.\d+)?\s*%|&(?:#\d+|[a-z]+);/i.test(text)||/\b(?:system prompt|bearer|api.?key|tool_calls|function_call|diagnos(?:e|ed|is) (?:is|confirmed)|confirms? (?:endometriosis|ectopic)|you (?:have|do not have)|patient has|ruled out|stage [1-4iv]+|\d+(?:\.\d+)?\s*(?:mg|mcg|ml|tablets?)|(?:start|stop|increase|decrease|take|prescribe) (?:\w+\s+){0,3}(?:medication|dose|ibuprofen|paracetamol|antibiotics?|hormones?))\b/i.test(text))throw new ChatError('outputRejected');
 return text;
}
type Admission={run<T>(visitId:string,ordinal:number,signal:AbortSignal,infer:(signal:AbortSignal)=>Promise<T>):Promise<T>};
/** No case/upload fields or raw visitor messages enter this controller. The signed
 * receipt binds the server-created visit, exact prompt IDs and provider thread.
 */
export function createChat(options:{environment?:OrchestrateEnvironment;admission:Admission;ownThread:(visitId:string,threadId:string,signal:AbortSignal)=>Promise<void>;transport?:Transport;clock?:()=>number}){
 const environment=options.environment??process.env;
 const guarded:Transport=async(address,init)=>{if(!chatAvailable(environment))throw new ChatError('unavailable');if(!options.transport)return fetch(address,init);return options.transport(address,init);};
 const authentication=createWatsonRuntime(guarded);
 return Object.freeze({capability:()=>chatCapability(environment),async handle(payload:unknown,signal:AbortSignal){
  if(!chatAvailable(environment))throw new ChatError('unavailable');signal.throwIfAborted();
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new ChatError('inputRejected');const request=payload as Record<string,unknown>;
  const receipts=createReceipts(environment.WATSONX_AI_APIKEY!,options.clock),keys=Object.keys(request).sort().join('|');
  if(request.version!=='1')throw new ChatError('inputRejected');
  if(request.action==='start'&&keys==='action|version')return {version:'1',state:'started',receipt:receipts.start(hashBytes(JSON.stringify(Prompts))),opening:'Choose an approved fictional prompt to begin. IBM generates the replies. Your current case and uploads are not sent.',prompts:Prompts.prompts};
  if(request.action!=='turn'||keys!=='action|promptId|receipt|version'||typeof request.promptId!=='string')throw new ChatError('inputRejected');
  const visit=receipts.read(request.receipt),prompt=Prompts.prompts.find(prompt=>prompt.id===request.promptId);
  if(visit.policyHash!==hashBytes(JSON.stringify(Prompts)))throw new SessionError();
  if(!prompt||visit.ordinal>=6||visit.promptIds.some(id=>!Prompts.prompts.some(prompt=>prompt.id===id)))throw new ChatError('inputRejected');
  const prompts=[...visit.promptIds,prompt.id].map(id=>Prompts.prompts.find(prompt=>prompt.id===id)!);
  const packages=loadPackages(),pin=hashBytes(JSON.stringify(packages));
  // Screen all authorized fictional context before optional inference; a topic
  // change cannot erase an earlier safety halt. Actual case data is never sent.
  const checked=analyze(validateCase({moduleHint:Module1,caseType:'detailed',pregnancyPossible:null,pidDiagnosedOrPresumed:null,additionalNotes:prompts.map(prompt=>prompt.text).join(' ')}),packages);
  if(checked.envelope.warnings.length||checked.envelope.response.message===CoverageMessage||['DataConflict','ClarificationRequired'].includes(String(checked.envelope.response.responseType)))return {version:'1',state:'safetyHalt',analysis:checked.envelope};
  const turn:OrchestrateTurn={messages:prompts.map(prompt=>({role:'user',content:prompt.text})),...(visit.threadId?{threadId:visit.threadId}:{})};
  const expected=JSON.stringify(turn);
  let admissionFailure:unknown;
  const gate:OrchestrateGate={authorize:async supplied=>chatAvailable(environment)&&JSON.stringify(supplied)===expected,reserve:async operation=>{try{if(visit.threadId)await options.ownThread(visit.visitId,visit.threadId,operation);await options.admission.run(visit.visitId,visit.ordinal,operation,async()=>undefined);}catch(failure){admissionFailure=failure;throw failure;}}};
  const provider=createOrchestrateTransport(gate,guarded,environment,authentication);
  let reply:{text:string;threadId:string};try{reply=await provider.complete(turn,signal);}catch(failure){if(admissionFailure instanceof QuotaError)throw admissionFailure;throw failure;}
  await options.ownThread(visit.visitId,reply.threadId,signal);
  signal.throwIfAborted();if(!chatAvailable(environment)||hashBytes(JSON.stringify(loadPackages()))!==pin)throw new ChatError('unavailable');
  return {version:'1',state:'replied',receipt:receipts.advance(visit,reply.threadId,prompt.id),text:validateDiscussion(reply.text),label:'AI-generated discussion — not Endo-verified evidence',prompts:Prompts.prompts};
 }});
}
export function chatFailure(failure:unknown){return failure instanceof SessionError?{status:409,code:'invalidSession'}:failure instanceof QuotaError?{status:failure.category==='unavailable'?503:429,code:failure.category==='unavailable'?'unavailable':'quotaExceeded'}:failure instanceof ChatError?{status:failure.code==='inputRejected'?422:503,code:failure.code}:{status:503,code:'unavailable'};}
