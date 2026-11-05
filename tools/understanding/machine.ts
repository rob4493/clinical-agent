import Schema from '../../evaluation/understanding/observations.schema.json';
import {EvaluationError,freeze,isValidated,type ValidatedProposal,type ProposedObservation,type ConceptId} from './contract';

export type Phase='idle'|'question'|'clarification'|'proposal'|'conflict'|'urgentPaused'|'review'|'confirmed'|'reanalysisRequested'|'ended';
export interface Session {version:'1.0.0';moduleId:string;question:{conceptId:ConceptId|'unspecified';intent:'collect'|'clarify';sourceTurnIds:string[]}|null;phase:Phase;proposal:ValidatedProposal|null;reviewedIds:string[];selectedIds:string[];clarificationSkipped:boolean;trace:string[]}
type Event={actor:'clinician';type:'activate'|'answer'|'skipClarification'|'requestVerification'|'keepUnresolved'|'confirm'|'reanalyze'|'end'}|{actor:'clinician';type:'review';ids:string[]}|{actor:'adapter';type:'suggest';proposal:ValidatedProposal}|{actor:'deterministic';type:'urgent'|'sourceCoverageUnavailable'};
const Sessions=new WeakSet<object>();
function seal(session:Session):Session{const frozen=freeze(session);Sessions.add(frozen);return frozen;}
export function createSession(moduleId:string,questionId:ConceptId|'none'='none'):Session{
 if(!['module_01_endo','module_02_early_pregnancy'].includes(moduleId)||questionId!=='none'&&!(Schema['x-bindings'][questionId]?.modules as string[]|undefined)?.includes(moduleId))throw new EvaluationError();
 return seal({version:'1.0.0',moduleId,question:{conceptId:questionId==='none'?'unspecified':questionId,intent:'collect',sourceTurnIds:[]},phase:'idle',proposal:null,reviewedIds:[],selectedIds:[],clarificationSkipped:false,trace:[]});
}
function assertionKey(observation:ProposedObservation){return JSON.stringify([observation.id,observation.conceptId,observation.fieldPath,observation.state,observation.temporalContext,observation.sourceSpans.map(span=>[span.turnId,span.start,span.end]).sort(),observation.relation,[...observation.relatedIds].sort()]);}
export function hasConflict(proposal:ValidatedProposal):boolean {const observations=proposal.proposal.observations;return observations.some(left=>observations.some(right=>left.id!==right.id&&left.conceptId===right.conceptId&&left.temporalContext==='current'&&right.temporalContext==='current'&&['present','absent','notApplicable'].includes(left.state)&&['present','absent','notApplicable'].includes(right.state)&&left.state!==right.state));}
/** Offline workflow intentions only: no canonical setter, evidence API, provider or analysis dispatcher exists. */
export function transition(session:Session,event:Event):Session {
 if(!event||typeof event!=='object'||Array.isArray(event))throw new EvaluationError();
 if(!Sessions.has(session)||session.phase==='ended'||session.trace.length>=64)throw new EvaluationError();
 const allowed=event.type==='suggest'?['actor','type','proposal']:event.type==='review'?['actor','type','ids']:['actor','type'];
 if(Object.keys(event).sort().join(',')!==allowed.sort().join(','))throw new EvaluationError();
 const next:Session={...session,reviewedIds:[...session.reviewedIds],selectedIds:[...session.selectedIds],trace:[...session.trace,event.type]};
 if(event.actor==='deterministic'){
  if(!['urgent','sourceCoverageUnavailable'].includes(event.type))throw new EvaluationError();
  next.phase='urgentPaused';next.question=null;next.reviewedIds=[];next.selectedIds=[];return seal(next);
 }
 if(event.actor==='adapter'){
  if(event.type!=='suggest'||!['question','clarification','proposal'].includes(session.phase)||!isValidated(event.proposal)||event.proposal.moduleId!==session.moduleId)throw new EvaluationError();
  for(const previous of session.proposal?.proposal.observations??[])if(!event.proposal.proposal.observations.some(candidate=>assertionKey(candidate)===assertionKey(previous)))throw new EvaluationError();
  next.proposal=event.proposal;next.reviewedIds=[];next.selectedIds=[];next.clarificationSkipped=false;
  const clarification=event.proposal.proposal.clarification;next.question=clarification?{conceptId:clarification.conceptId,intent:'clarify',sourceTurnIds:[...clarification.sourceTurnIds]}:event.proposal.proposal.observations.length?null:session.question;
  next.phase=hasConflict(event.proposal)?'conflict':event.proposal.proposal.clarification?'clarification':event.proposal.proposal.observations.length?'proposal':'question';return seal(next);
 }
 if(event.actor!=='clinician')throw new EvaluationError();
 if(event.type==='end'){next.phase='ended';next.question=null;next.proposal=null;next.reviewedIds=[];next.selectedIds=[];return seal(next);}
 if(session.phase==='urgentPaused')throw new EvaluationError();
 if(event.type==='activate'&&session.phase==='idle')next.phase='question';
 else if(event.type==='answer'&&['question','clarification','proposal'].includes(session.phase))next.phase='question';
 else if(event.type==='skipClarification'&&session.phase==='clarification'){next.phase=session.proposal?.proposal.observations.length?'proposal':'question';next.clarificationSkipped=true;next.question=null;}
 else if(['requestVerification','keepUnresolved'].includes(event.type)&&session.phase==='conflict')next.phase='conflict';
 else if(event.type==='review'&&['proposal','review'].includes(session.phase)&&session.proposal){
  if(!event.ids.length||event.ids.length>8||new Set(event.ids).size!==event.ids.length||event.ids.some(id=>!session.proposal!.proposal.observations.some(observation=>observation.id===id&&observation.temporalContext==='current')))throw new EvaluationError();
  next.reviewedIds=[...new Set([...session.reviewedIds,...event.ids])];next.selectedIds=[...next.reviewedIds];next.phase='review';
 }
 else if(event.type==='confirm'&&session.phase==='review'&&session.selectedIds.length&&(!session.proposal?.proposal.clarification||session.clarificationSkipped))next.phase='confirmed';
 else if(event.type==='reanalyze'&&session.phase==='confirmed')next.phase='reanalysisRequested';
 else throw new EvaluationError();
 return seal(next);
}
