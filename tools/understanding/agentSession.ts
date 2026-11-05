import {projectFixture} from './projection';
import {freeze,type ValidatedProposal} from './contract';
import {DisabledAgent,DialogueError,DialogueVersion,validateDiscussion,type DialogueInput,type EvidenceTopic,type LanguageAgent,type ValidatedDiscussion} from './dialogue';
import Corpus from '../../evaluation/understanding/dialogue.json';
import {episodes} from './projection';
import {analyze,CoverageMessage} from '../../netlify/evaluation/analysis';
import {validateCase} from '../../netlify/evaluation/input';
import {loadPackages} from '../../netlify/evaluation/packages';
import {offerPresentation} from '../../netlify/evaluation/reviewedPresentation';

const TrustedTopics=new WeakMap<object,string>();
export function isTrustedTopics(topics:readonly EvidenceTopic[],moduleId:string):boolean{return TrustedTopics.get(topics)===moduleId;}
/** Only a deterministic result can offer evidence; the model receives no retrieval capability. */
export function topicsForFixture(id:string):readonly EvidenceTopic[]{
 const turn=Corpus.turns.find(turn=>turn.id===id),fixture=episodes().find(episode=>episode.id===turn?.fixtureId);if(!fixture)throw new DialogueError();
 const packages=loadPackages(),result=analyze(validateCase(fixture.caseInput),packages),offer=offerPresentation(result,packages),entry=packages.find(entry=>entry.moduleId===fixture.moduleId);
 // A partial presentation offer cannot authorize a paraphrase. A complete exact
 // public claim already returned by deterministic analysis is the only fallback.
 const statements=Array.isArray(result.envelope.response.supportedInterpretations)?result.envelope.response.supportedInterpretations as {text:string;citations:{sourceTag:string}[]}[]:[];
 const exactClaims=!result.envelope.warnings.length&&result.envelope.response.responseType==='AgentResponse'?entry?.claims.filter(claim=>statements.some(statement=>statement.text===claim.supportedStatement&&statement.citations.some(citation=>citation.sourceTag===claim.sourceId))).map(claim=>({variants:[{text:claim.supportedStatement,claimIds:[claim.claimId]}]}))??[]:[];
 const topics=freeze((offer?.findings??exactClaims).slice(0,6).map((finding,index)=>{const variant=finding.variants[0];return {id:'E'+(index+1),text:variant.text,claimIds:variant.claimIds,sourceNumbers:[...new Set(variant.claimIds.map(id=>{const claim=entry?.claims.find(claim=>claim.claimId===id),source=result.envelope.sources.find(source=>source.source.sourceId===claim?.sourceId);if(!source)throw new DialogueError();return source.number;}))]};}));
 TrustedTopics.set(topics,fixture.moduleId);return topics;
}
function screen(id:string):Gate {
 const turn=Corpus.turns.find(turn=>turn.id===id),fixture=episodes().find(episode=>episode.id===turn?.fixtureId);if(!fixture||!turn)throw new DialogueError();
 const base=validateCase(fixture.caseInput),results=[analyze(base,loadPackages()),analyze({...base,additionalNotes:base.additionalNotes+' '+turn.message},loadPackages())];
 for(const result of results){
  if(result.envelope.warnings.length)return 'urgent';
  if(result.envelope.response.message===CoverageMessage)return 'coverageUnavailable';
  if(result.envelope.response.responseType==='DataConflict')return 'conflict';
  if(result.envelope.response.responseType==='ClarificationRequired')return 'clarification';
 }
 return 'ordinary';
}

export function dialogueProjection(id:string){
 const turn=Corpus.turns.find(turn=>turn.id===id);if(!turn)throw new DialogueError();
 const base=projectFixture(turn.fixtureId);
 return freeze({...base,turns:[...base.turns,{id:'T'+(base.turns.length+1),text:turn.message}]});
}

export type Gate='ordinary'|'urgent'|'conflict'|'clarification'|'coverageUnavailable';
export interface AgentState {status:'active'|'paused'|'ended';history:ReadonlyArray<{role:'user'|'assistant';content:string}>;suggestions:ReadonlyArray<ValidatedProposal>;reviewRequested:boolean;provider:'disabled'|'mock'|'fallback';last:ValidatedDiscussion|null}
/** Synthetic-only rehearsal. The closure owns context; neither model nor UI can overwrite it.
 * It deliberately has no canonical setter, reanalysis callback, or deployed session store.
 */
export function createAgentSession(fixtureIds:readonly string[],topics:readonly EvidenceTopic[],agent:LanguageAgent=DisabledAgent,gate:(fixtureId:string)=>Gate=()=> 'coverageUnavailable'){
 if(!TrustedTopics.has(topics))throw new DialogueError();
 if(!fixtureIds.length||fixtureIds.length>6||new Set(fixtureIds).size!==fixtureIds.length)throw new DialogueError();
 const projections=fixtureIds.map(dialogueProjection),moduleId=projections[0].moduleId;
 if(TrustedTopics.get(topics)!==moduleId)throw new DialogueError();
 if(projections.some(projection=>projection.moduleId!==moduleId)||topics.length>6||new Set(topics.map(topic=>topic.id)).size!==topics.length||topics.some(topic=>!/^E[1-6]$/.test(topic.id)||!topic.text.trim()||topic.text.length>6000||!topic.claimIds.length||topic.claimIds.length>78||new Set(topic.claimIds).size!==topic.claimIds.length||topic.sourceNumbers.some(number=>!Number.isInteger(number)||number<1||number>8)))throw new DialogueError();
 const trustedTopics=topics;
 let state:AgentState=freeze({status:'active',history:[],suggestions:[],reviewRequested:false,provider:agent===DisabledAgent?'disabled':'mock',last:null}),index=0,busy=false;
 let active:AbortController|null=null;
 const snapshot=()=>state;
 async function next(signal:AbortSignal,timeout=1000):Promise<AgentState>{
  if(state.status!=='active'||busy||index>=projections.length||!Number.isInteger(timeout)||timeout<1||timeout>12000)throw new DialogueError();
  signal.throwIfAborted();busy=true;const controller=new AbortController();active=controller;
  const timer=setTimeout(()=>controller.abort(),timeout),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
  const before=state,projection=projections[index],fixtureId=fixtureIds[index];
  try{
   // Trusted deterministic safety screening precedes every optional inference.
   if(screen(fixtureId)!=='ordinary'||gate(fixtureId)!=='ordinary'){state=freeze({...state,status:'paused',last:null});return state;}
   const latest=projection.turns.at(-1)!;
   const history=[...state.history,{role:'user' as const,content:latest.text}];
   const input:DialogueInput=freeze({version:DialogueVersion,projection,history,topics:trustedTopics});
   if(agent===DisabledAgent){state=freeze({...state,history,provider:'disabled',last:null});index++;return state;}
   const raw=await new Promise<string>((resolve,reject)=>{
    const cancelled=()=>reject(new DialogueError());controller.signal.addEventListener('abort',cancelled,{once:true});
    Promise.resolve().then(()=>{controller.signal.throwIfAborted();return agent.respond(input,controller.signal);}).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',cancelled));
   });
   controller.signal.throwIfAborted();const last=validateDiscussion(raw,input);
   // New observations remain unverified; correction never chooses a winner.
   const suggestions=last.suggestion?.proposal.observations.length?[...state.suggestions,last.suggestion]:state.suggestions;
   const answer=last.paragraphs.map(paragraph=>paragraph.text).join('\n\n');
   state=freeze({...state,history:[...history,{role:'assistant',content:answer}],suggestions,last,provider:'mock'});index++;return state;
  }catch{
   if(signal.aborted||state.status==='ended'){if(state.status!=='ended')state=before;throw new DialogueError();}
   state=freeze({...before,provider:'fallback',last:null});return state;
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);if(active===controller)active=null;busy=false;}
 }
 function requestReview(){
  const observations=state.suggestions.flatMap(suggestion=>suggestion.proposal.observations).filter(observation=>observation.temporalContext==='current');
  // A review invitation is not a conflict resolver; opposing assertions stay intact.
  const conflict=observations.some(left=>observations.some(right=>left.conceptId===right.conceptId&&left.state!==right.state&&left.state!=='unknown'&&right.state!=='unknown'&&left.state!=='notReported'&&right.state!=='notReported'));
  if(state.status!=='active'||busy||!observations.length||conflict)throw new DialogueError();
  state=freeze({...state,reviewRequested:true});return state;
 }
 function end(){active?.abort();state=freeze({...state,status:'ended',history:[],suggestions:[],reviewRequested:false,last:null});}
 return Object.freeze({snapshot,next,requestReview,end});
}
