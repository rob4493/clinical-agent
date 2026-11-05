import {randomUUID} from 'node:crypto';
import {analyze,CoverageMessage} from './analysis';
import {validateCase,parseJson} from './input';
import {loadPackages,hashBytes} from './packages';
import {createAgentProvider,AgentError,type AgentProvider,type AgentPayload} from './agentProvider';
import {freeze,validateProposal,type Projection,type ValidatedProposal} from '../../shared/observationContract';

export interface AgentPrincipal {subject:string;classification:'fictionalSynthetic'}
export interface AgentPolicy {authorize(principal:AgentPrincipal):boolean}
export interface GroundingVerifier {verify(text:string,claimIds:readonly string[],payload:Readonly<AgentPayload>):Promise<boolean>}
export interface AgentParagraph {text:string;kind:'discussion'|'question'|'acknowledgement';claimIds:string[]}
interface Session {subject:string;moduleId:string;original:unknown;expires:number;busy:boolean;turns:{id:string;text:string}[];history:AgentParagraph[];proposals:ValidatedProposal[];closed:boolean;paused:boolean;abort:AbortController|null;timer:ReturnType<typeof setTimeout>|null}
const DenyPolicy:AgentPolicy=Object.freeze({authorize:()=>false});
const DenyGrounding:GroundingVerifier=Object.freeze({verify:async()=>false});
export const AgentStatus=Object.freeze({version:'1',provider:'watsonx',status:'blocked',reasonCode:'authorizationRequired',message:'IBM conversation is not enabled. A separately authorized synthetic test and verified server authentication are required.'});
function exact(content:unknown,names:string[]):Record<string,any>{if(!content||typeof content!=='object'||Array.isArray(content)||Object.keys(content).sort().join('|')!==[...names].sort().join('|'))throw new AgentError();return content as Record<string,any>;}
function wait<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{const abort=()=>reject(new AgentError());if(signal.aborted){void operation.catch(()=>{});reject(new AgentError());return;}signal.addEventListener('abort',abort,{once:true});operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}

/** The default verifier denies novel prose. A separately reviewed verifier is a
 * prerequisite, not an assertion that citation IDs or another model prove truth.
 */
export async function validateAgentReply(content:unknown,payload:AgentPayload,verifier:GroundingVerifier,signal:AbortSignal){
 const output=exact(content,['version','paragraphs','observations']);
 if(output.version!=='1'||!Array.isArray(output.paragraphs)||!output.paragraphs.length||output.paragraphs.length>4)throw new AgentError();
 const allowed=new Set(payload.evidence.map(claim=>claim.claimId)),paragraphs:AgentParagraph[]=[];
 for(const supplied of output.paragraphs){const paragraph=exact(supplied,['text','kind','claimIds']);
  if(typeof paragraph.text!=='string'||!paragraph.text.trim()||paragraph.text.length>1600||/[<>\u0000-\u001f]|https?:\/\//i.test(paragraph.text)||!['discussion','question','acknowledgement'].includes(paragraph.kind)||!Array.isArray(paragraph.claimIds)||paragraph.claimIds.length>8||new Set(paragraph.claimIds).size!==paragraph.claimIds.length||paragraph.claimIds.some((id:unknown)=>typeof id!=='string'||!allowed.has(id)))throw new AgentError();
  signal.throwIfAborted();if(!await verifier.verify(paragraph.text,paragraph.claimIds,payload))throw new AgentError();signal.throwIfAborted();paragraphs.push(paragraph as AgentParagraph);
 }
 const projection:Projection={projectionVersion:'1.0.0',moduleId:payload.moduleId,questionId:'none',turns:[...payload.turns]};
 const suggestion=output.observations===null?null:validateProposal(JSON.stringify(output.observations),projection);
 return freeze({paragraphs,suggestion});
}

/** First-party, permission-gated session controller. No canonical setter or analysis
 * dispatch tool is exposed to IBM. Process-local sessions are not durable serverless storage.
 */
export function createAgentService(options:{policy?:AgentPolicy;provider?:AgentProvider;grounding?:GroundingVerifier;clock?:()=>number}={}){
 const policy=options.policy??DenyPolicy,provider=options.provider??createAgentProvider(),grounding=options.grounding??DenyGrounding,clock=options.clock??Date.now,sessions=new Map<string,Session>();
 function authorized(principal:AgentPrincipal){try{if(!principal||principal.classification!=='fictionalSynthetic'||!principal.subject||principal.subject.length>128||!policy.authorize(principal))throw new AgentError();}catch{throw new AgentError();}}
 function close(id:string,session:Session){session.closed=true;session.abort?.abort();if(session.timer)clearTimeout(session.timer);session.original=null;session.turns=[];session.history=[];session.proposals=[];sessions.delete(id);}
 function schedule(id:string,session:Session){if(session.timer)clearTimeout(session.timer);session.timer=setTimeout(()=>close(id,session),60000);session.timer.unref?.();}
 function expire(){for(const [id,session] of sessions)if(session.expires<=clock())close(id,session);}
 function getSession(id:string,principal:AgentPrincipal){authorized(principal);expire();const session=sessions.get(id);if(!session||session.subject!==principal.subject||session.closed)throw new AgentError();return session;}
 function start(original:unknown,principal:AgentPrincipal){authorized(principal);expire();if(sessions.size>=16)throw new AgentError();const checked=validateCase(original);if(!['module_01_endo','module_02_early_pregnancy'].includes(checked.moduleHint))throw new AgentError();const id=randomUUID(),session:Session={subject:principal.subject,moduleId:checked.moduleHint,original:structuredClone(original),expires:clock()+60000,busy:false,turns:[],history:[],proposals:[],closed:false,paused:false,abort:null,timer:null};sessions.set(id,session);schedule(id,session);return {sessionId:id};}
 async function turn(id:string,message:string,principal:AgentPrincipal,signal:AbortSignal){
  const session=getSession(id,principal);signal.throwIfAborted();if(session.paused||session.busy||session.turns.length>=6||typeof message!=='string'||!message.trim()||message.length>1000)throw new AgentError();session.busy=true;
  const abort=new AbortController(),cancel=()=>abort.abort(),timer=setTimeout(cancel,12000);signal.addEventListener('abort',cancel,{once:true});
  session.abort=abort;
  try{
   const packages=loadPackages(),pin=hashBytes(JSON.stringify(packages)),base=validateCase(session.original),turns=[...session.turns,{id:'T'+(session.turns.length+1),text:message}];
   // Submitted conversation cannot erase a warning already present in the case.
   for(const notes of [base.additionalNotes,[base.additionalNotes,...turns.map(turn=>turn.text)].join(' ')]){
    const checked=analyze(validateCase({...base,additionalNotes:notes}),packages);
    if(checked.envelope.warnings.length||checked.envelope.response.message===CoverageMessage||['DataConflict','ClarificationRequired'].includes(String(checked.envelope.response.responseType))){session.paused=true;return {status:'safetyHalt' as const,analysis:checked.envelope};}
   }
   const result=analyze(validateCase({...base,additionalNotes:[base.additionalNotes,...turns.map(turn=>turn.text)].join(' ')}),packages),entry=packages.find(entry=>entry.moduleId===session.moduleId);
   const sourceIds=new Set(result.envelope.sources.map(source=>source.source.sourceId));
   // Only exact selected public statements are eligible for the initial agent path.
   // A source match by itself does not authorize every claim from that source.
   const statements=Array.isArray(result.envelope.response.supportedInterpretations)?result.envelope.response.supportedInterpretations as {text:string}[]:[];
   const selected=entry?.claims.filter(claim=>sourceIds.has(claim.sourceId)&&statements.some(statement=>statement.text===claim.supportedStatement))??[];
   const payload:AgentPayload=freeze({version:'1',moduleId:session.moduleId,turns,history:session.history.map(paragraph=>({text:paragraph.text,claimIds:paragraph.claimIds})),evidence:selected.slice(0,8).map(claim=>({claimId:claim.claimId,wording:claim.supportedStatement,conditions:claim.conditions,limitations:claim.limitations,population:claim.intendedPopulation,jurisdiction:claim.jurisdiction}))});
   // Never forward the original case, uploads, metadata or automatically assembled narratives.
   const raw=await wait(provider.infer(payload,abort.signal),abort.signal);
   abort.signal.throwIfAborted();const content=typeof raw==='string'?parseJson(raw):raw;
   const validated=await wait(validateAgentReply(content,payload,grounding,abort.signal),abort.signal);
   if(session.closed||hashBytes(JSON.stringify(loadPackages()))!==pin)throw new AgentError();
   // A model cannot silently establish a safety-critical structured status. Pause
   // without routine prose; existing deterministic confirmation/safety review owns it.
   if(validated.suggestion?.proposal.observations.some(observation=>observation.temporalContext==='current'&&(observation.fieldPath.startsWith('urgentIndicators.')||['pregnancyStatus','pidStatus'].includes(observation.fieldPath)))){session.paused=true;session.proposals.push(validated.suggestion);return {status:'verificationRequired' as const,pendingObservationCount:validated.suggestion.proposal.observations.length};}
   session.turns=turns;session.history=[...session.history,...validated.paragraphs].slice(-12);session.expires=clock()+60000;schedule(id,session);
   if(validated.suggestion?.proposal.observations.length)session.proposals.push(validated.suggestion);
   const paragraphs=validated.paragraphs.map(paragraph=>({text:paragraph.text,numbers:[...new Set(paragraph.claimIds.map(id=>{const claim=entry?.claims.find(claim=>claim.claimId===id),source=result.envelope.sources.find(source=>source.source.sourceId===claim?.sourceId);if(!source)throw new AgentError();return source.number;}))]}));
   const used=new Set(paragraphs.flatMap(paragraph=>paragraph.numbers));
   const sources=result.envelope.sources.filter(source=>used.has(source.number)).map(source=>({number:source.number,title:source.source.title,url:source.source.verifiedUrl}));
   return {status:'inferred' as const,paragraphs,sources,pendingObservationCount:session.proposals.reduce((count,proposal)=>count+proposal.proposal.observations.length,0)};
  }catch{signal.throwIfAborted();throw new AgentError();}finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);abort.abort();session.abort=null;session.busy=false;}
 }
 function end(id:string,principal:AgentPrincipal){close(id,getSession(id,principal));}
 return Object.freeze({start,turn,end,status:()=>AgentStatus});
}
