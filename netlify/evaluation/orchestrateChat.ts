import Prompts from '../../shared/orchestratePrompts.json';
import {analyze,CoverageMessage} from './analysis';
import {validateCase} from './input';
import {loadPackages,hashBytes,Module1} from './packages';
import {readOrchestrateTarget,type OrchestrateEnvironment} from './orchestrateTarget';
import {createOrchestrateTransport,OrchestrateResponseError,type OrchestrateGate,type OrchestrateTurn} from './orchestrateTransport';
import {createReceipts,SessionError} from './visitReceipt';
import {QuotaError} from './demoQuota';
import {createWatsonRuntime,type Transport} from './watsonShadow';
import {DiscussionTextLimit,hasExecutableMarkup,isDiscussionRejection,isProviderRejection,ClinicalLanguageWarnings,isClinicalLanguageWarning,type ClinicalLanguageWarning,type DiscussionRejection} from '../../shared/discussionContract';
import {protectedDiscussionAllowed,type OperatorContext} from './protectedDiscussionPolicy';

export class ChatError extends Error {constructor(readonly code:'unavailable'|'inputRejected'|'outputRejected'){super('IBM conversation is unavailable. The case is unchanged.');}}
export class DiscussionError extends ChatError {constructor(readonly rejection:DiscussionRejection){super('outputRejected');}}
export function chatAvailable(environment:OrchestrateEnvironment=process.env){
 try{return !!readOrchestrateTarget(environment)&&environment.ORCHESTRATE_SYNTHETIC_AUTHORIZED==='true'&&environment.ORCHESTRATE_DISCUSSION_AUTHORIZED==='true'&&environment.ORCHESTRATE_HOSTED_CONTROLS_VERIFIED==='true'&&environment.ENDO_DEMO_INFERENCE_ENABLED==='true'&&environment.ENDO_DEMO_KILL_SWITCH==='false'&&environment.OTEL_SDK_DISABLED==='true'&&/^(?:[1-9]|[1-9]\d|100)$/.test(environment.ENDO_DEMO_DAILY_LIMIT||'')&&environment.ORCHESTRATE_SYNTHETIC_POLICY_HASH===hashBytes(JSON.stringify(Prompts))&&typeof environment.WATSONX_AI_APIKEY==='string'&&environment.WATSONX_AI_APIKEY.length>0&&environment.WATSONX_AI_APIKEY.length<=512&&!/\s|[\u0000-\u001f]/.test(environment.WATSONX_AI_APIKEY);}catch{return false;}
}
export function chatCapability(environment:OrchestrateEnvironment=process.env){return {version:'1',provider:'orchestrate',status:chatAvailable(environment)?'available':'blocked',mode:'controlledSynthetic',message:chatAvailable(environment)?'Configured for controlled fictional conversation; connectivity is not verified by this check.':'IBM conversation is disabled pending privacy and hosted abuse-control verification.',prompts:chatAvailable(environment)?Prompts.prompts:[]};}

/** Local grammatical qualification, not evidence that a diagnosis is excluded.
 * Only bounded modifiers may separate uncertainty from its exclusion predicate. */
function uncertainExclusion(before:string,predicate:string,question:boolean){
 const modifier='(?:(?:yet|currently|safely|fully|completely|reliably|confidently|definitively|conclusively|adequately)\\s+){0,2}';
 const negative="(?:cannot|can\\s+not|can't|could\\s+not|couldn't|must\\s+not|mustn't)";
 const attached=(pattern:string)=>{const match=new RegExp(pattern,'i').exec(before);return !!match&&!/\b(?:not|never)\s+$/i.test(before.slice(0,match.index));};
 if(/^rule\s+out$/i.test(predicate))return attached('\\b'+negative+'\\s+'+modifier+'$')
  ||attached('\\bunable\\s+to\\s+'+modifier+'$')
  ||attached('\\b(?:insufficient|inadequate|not\\s+enough|no)\\s+(?:information|evidence)\\s+to\\s+'+modifier+'$');
 if(attached('\\b'+negative+'\\s+'+modifier+'be\\s+'+modifier+'$')
  ||attached("\\b(?:not|never|hasn't|haven't|hadn't|isn't|aren't|wasn't|weren't)\\s+"+modifier+'(?:been\\s+)?'+modifier+'$'))return true;
 // Preserve direct questions, but an earlier predicate/conjunction cannot turn
 // an additional affirmative exclusion into a question about the first finding.
 return question&&!/\b(?:and|or|ruled|excluded|rule)\b/i.test(before)
  &&new RegExp('^(?:[-*]\\s*|\\d+[.)]\\s*)?(?:has|have|can|could)\\b[^.!?;:]{0,100}\\b(?:be|been)\\s+'+modifier+'$','i').test(before.trimStart());
}

/** This is a rejection screen, not a semantic clinical-grounding validator. Natural
 * AI discussion is separately labelled and requires explicit expert/policy approval.
 * References and statistics are unverified text, never canonical citations. It
 * cannot replace Endo-verified clinical analysis or verify medical accuracy.
 */
export function validateDiscussion(text:unknown,secrets:readonly string[]=[]):string{return screenDiscussion(text,secrets,false).text;}
/** Warning-only policy is reachable only after independently checking the same
 * trusted Preview #4 operator/window gate used by the conversation service. */
export function validateProtectedDiscussion(text:unknown,env:OrchestrateEnvironment,context:OperatorContext,now:number){
 if(!protectedDiscussionAllowed(env,context,now))throw new ChatError('unavailable');
 return screenDiscussion(text,[env.WATSONX_AI_APIKEY!],true);
}
function screenDiscussion(text:unknown,secrets:readonly string[],warningOnly:boolean):{text:string;warnings:ClinicalLanguageWarning[]}{
 const reject=(code:DiscussionRejection):never=>{throw new DiscussionError(code);};
 const warnings=new Set<ClinicalLanguageWarning>();
 const concern=(code:ClinicalLanguageWarning)=>{if(!warningOnly)reject(code);warnings.add(code);};
 if(typeof text!=='string')return reject('invalidText');
 if(!text.trim())return reject('emptyText');
 if(text.length>DiscussionTextLimit)return reject('responseTooLong');
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))return reject('invalidCharacters');
 // Check the entire bounded response, never a truncated prefix. Rendering uses
 // safe React presentation: references, %, fences and harmless markup stay inert and are
 // neither followed nor promoted to reviewed evidence. No provider text is logged.
 const normalized=text.replace(/[\u2018\u2019]/g,"'").replace(/\*\*|__/g,'').replace(/[^\S\r\n]+/g,' ');
 if(secrets.some(secret=>secret.length>0&&text.includes(secret))||/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{8,}|\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|authorization|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+%=-]{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/i.test(normalized))return reject('secretExposure');
 if(/(?:javascript|vbscript)\s*:|data\s*:\s*(?:text\/html|application\/(?:javascript|xhtml\+xml))|file\s*:\/\/|https?:\/\/[^/\s]+@/i.test(normalized))return reject('unsafeReference');
 if(hasExecutableMarkup(text))return reject('executableMarkup');
 if(/\bsystem prompt\b/i.test(normalized))return reject('internalInstruction');
 if(/\b(?:tool_calls|function_call)\b/i.test(normalized))return reject('actionDirective');
 if(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|tablets?)\b/i.test(normalized))return reject('medicationDose');
 if(/\b(?:your|(?:the|this) patient's)\s+(?:risk|probability|chance|likelihood)\s*(?:is|=|of)?\s*(?:(?:about|around|approximately)\s+)?\d+(?:\.\d+)?\s*%/i.test(normalized))concern('patientSpecificRisk');
 if(/\b(?:this|that|it)\s+is\s+(?:your|the\s+patient'?s)\s+(?:(?:definitive|confirmed)\s+)?diagnosis\b/i.test(normalized))concern('diagnosisAssertion');
 const questionPrefix=/^(?:[-*]\s*|\d+[.)]\s*)?(?:do|did|does)\s+(?:you|(?:the|this)\s+patient)\s+(?:currently\s+)?$/i;
 const statements=[
  {rejection:'unsupportedStaging',pattern:/\bstage [1-4iv]+\b/gi,allowed:(before:string,after:string)=>! /\b(?:your|you|(?:this|the) patient|patient's)\b/i.test(before+' '+after)},
  {rejection:'diagnosisAssertion',pattern:/\bdiagnos(?:e|ed|is)\s+(?:is|confirmed)\b/gi,allowed:(before:string,after:string,match:string)=>{
   if(!/^diagnosis\s+is$/i.test(match))return false;
   if(/^(?:uncertain|unconfirmed)\b|^not\s+(?:yet\s+)?(?:confirmed|established|possible)\b/i.test(after))return true;
   if(/\bno\s+(?:(?:definitive|confirmed|certain)\s+)?$/i.test(before)&&/^(?:possible|confirmed|established)\b/i.test(after))return true;
   if(/^(?:confirmed|established|certain|definite)\b/i.test(after))return false;
   return /\b(?:possible|potential|tentative|provisional)\s+$/i.test(before)
    ||/\bdifferential\s+$/i.test(before)&&/^(?:(?:a|an)\s+(?:list|set|range|process)|broad|wide|uncertain)\b/i.test(after);
  }},
  {rejection:'diagnosisConfirmation',pattern:/\bconfirms?\s+(?:endometriosis|ectopic)\b/gi,allowed:(before:string)=>
   /\b(?:(?:does|do|did|can|could|would)\s+not|doesn't|don't|didn't|cannot|can't|couldn't|wouldn't)\s*$/i.test(before)
    ||/^(?:nothing|no\s+(?:information|finding|symptom|detail|evidence))(?:\s+(?:in|from|about|here|this|the|provided|reported|description|discussion|information|alone)){0,8}\s*$/i.test(before.trim())},
  {rejection:'patientAssertion',pattern:/\b(?:you\s+(?:(?:definitely|certainly|clearly|absolutely)\s+)?(?:have|do\s+not\s+have|don't\s+have)|patient\s+(?:(?:definitely|certainly|clearly)\s+)?(?:has|does\s+not\s+have|doesn't\s+have))\b/gi,allowed:(before:string,after:string)=>
   /\b(?:if|whether)(?:\s+(?:the|this|a|your))?\s*$/i.test(before)
    ||/^(?:[-*]\s*|\d+[.)]\s*)?(?:do|did|can|could|would)\s+$/i.test(before)
    ||/^(?:not\s+(?:yet\s+)?)?(?:described|reported|mentioned|outlined|asked\s+about)\b/i.test(after)},
  {rejection:'prescribingInstruction',pattern:/\b(?:start|stop|increase|decrease|take|prescribe)\s+(?:\w+\s+){0,3}(?:medication|dose|ibuprofen|paracetamol|antibiotics?|hormones?)\b/gi,allowed:(before:string,_after:string,match:string)=>
   questionPrefix.test(before)||/^take\b/i.test(match)&&/\b(?:if|whether)\s+you\s+$/i.test(before)}
 ];
 // Normalize only for checking; return the exact original text. Each restricted
 // span needs its own attached qualification. A disclaimer, question, or negation
 // in another statement cannot authorize a subsequent unsafe assertion.
 for(const clause of normalized.split(/[\r\n.!?;:]+|\b(?:but|however|nevertheless)\b/i)){
  const current=clause.trim();
  for(const rule of statements)for(const match of current.matchAll(rule.pattern)){
   if(!rule.allowed(current.slice(0,match.index),current.slice(match.index!+match[0].length).trimStart(),match[0])){
    if(isClinicalLanguageWarning(rule.rejection))concern(rule.rejection);else reject(rule.rejection as DiscussionRejection);
   }
  }
 }
 // Exclusion predicates need their attached uncertainty even across a wrapped
 // line. Preserve sentence/question boundaries; never apply a whole-answer waiver.
 for(const paragraph of normalized.split(/\r?\n\s*\r?\n/))for(const segment of paragraph.matchAll(/[^.!?;:]+[.!?;:]?/g)){
  const sentence=segment[0].trim(),question=sentence.endsWith('?');
  for(const clause of sentence.split(/\b(?:but|however|nevertheless)\b/i))for(const match of clause.matchAll(/\b(?:ruled\s+out|rule\s+out|excluded)\b/gi)){
   if(!uncertainExclusion(clause.slice(0,match.index).replace(/\s+/g,' '),match[0],question))concern('diagnosticExclusion');
  }
 }
 return {text,warnings:ClinicalLanguageWarnings.filter(code=>warnings.has(code))};
}
type Admission={run<T>(visitId:string,ordinal:number,signal:AbortSignal,infer:(signal:AbortSignal)=>Promise<T>):Promise<T>};
/** No case/upload fields or raw visitor messages enter this controller. The signed
 * receipt binds the server-created visit, exact prompt IDs and provider thread.
 * The receipt is readable by the browser, not encrypted; binding prevents edits,
 * not inspection of operational IDs. IBM bearer tokens never enter the receipt.
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
  return {version:'1',state:'replied',receipt:receipts.advance(visit,reply.threadId,prompt.id),text:validateDiscussion(reply.text,[environment.WATSONX_AI_APIKEY!]),label:'AI-generated discussion — not Endo-verified evidence',prompts:Prompts.prompts};
 }});
}
export function chatFailure(failure:unknown):{status:number;code:string;outputRejection?:DiscussionRejection;outputStage?:'discussion'|'providerProtocol';responseRejection?:string}{
 if(failure instanceof OrchestrateResponseError){
  if(failure.rejection==='actionResponse')return {status:503,code:'outputRejected',outputStage:'providerProtocol',outputRejection:'providerAction'};
  return {status:503,code:'providerResponse',outputStage:'providerProtocol',responseRejection:isProviderRejection(failure.rejection)?failure.rejection:'unclassifiedProtocol'};
 }
 if(failure instanceof ChatError&&failure.code==='outputRejected')return {status:503,code:'outputRejected',outputStage:'discussion',outputRejection:failure instanceof DiscussionError&&isDiscussionRejection(failure.rejection)?failure.rejection:'unclassifiedOutput'};
 return failure instanceof SessionError?{status:409,code:'invalidSession'}:failure instanceof QuotaError?{status:failure.category==='unavailable'?503:429,code:failure.category==='unavailable'?'unavailable':'quotaExceeded'}:failure instanceof ChatError?{status:failure.code==='inputRejected'?422:503,code:failure.code}:{status:503,code:'unavailable'};
}
