import type { CanonicalCase, FindingState, LegacyCase } from './clinicalData';
import { legacyToCanonical, validateClinical } from './caseBridge';

export const MessageLimit=1000;
export const TurnLimit=12;
const Topics={
 periodPain:{label:'Pain related to periods',field:'symptomTiming',affirmative:'Pain during periods is reported.',negative:'No pain during periods is reported.'},
 sexualPain:{label:'Pain during sex',field:'sexualPain',affirmative:'Pain during sex is reported.',negative:'No pain during sex is reported.'},
 bowelPain:{label:'Pain with bowel movements',field:'bowelUrinarySymptoms',affirmative:'Pain with bowel movements is reported.',negative:'No pain with bowel movements is reported.'},
 bladderPain:{label:'Pain with urination',field:'bowelUrinarySymptoms',affirmative:'Pain with urination is reported.',negative:'No pain with urination is reported.'},
 pelvicDiscomfort:{label:'Pelvic discomfort',field:'painLocation',affirmative:'Pelvic discomfort is reported.',negative:'No pelvic discomfort is reported.'},
 pelvicPain:{label:'Pelvic pain',field:'painLocation',affirmative:'Pelvic pain is reported.',negative:'No pelvic pain is reported.'},
 pregnancy:{label:'Pregnancy status',field:'pregnancyStatus',affirmative:'Possible or known pregnancy',negative:'Pregnancy is not possible'},
 pid:{label:'PID diagnostic status',field:'pidStatus',affirmative:'Diagnosed or presumptively diagnosed',negative:'Not diagnosed'},
 task:{label:'Clinical review question',field:'primaryQuestion',affirmative:'Please review the reported symptom pattern and uncertainty.',negative:''}
} as const;
export type TopicId=keyof typeof Topics;
export interface Observation {id:string;topic:TopicId;label:string;fieldId:string;state:FindingState;wording:string;original:string;disposition:'proposed'|'unchanged'|'conflict'|'clarification';}
export interface Interpretation {observations:Observation[];unrecognized:boolean;question:string;}
const Module1='module_01_endo';
/** This grammar recognizes complete bounded statements, not keywords or clinical implications. */
function parseStatement(statement:string,previous:string|null):{topic:TopicId;state:FindingState;carry:string|null}|null {
 let clause=statement.trim().toLowerCase().replace(/[.!]$/,'').replace(/^(?:the patient|patient|they|she|he)\s+/,'');
 let state:FindingState='present',explicitState=false;
 const markers:[RegExp,FindingState][]=[[/^(?:denies|does not have|doesn't have|no)\s+/,'absent'],[/^(?:unsure about|uncertain about|unknown whether|unknown)\s+/,'unknown'],[/^(?:not reported whether|not reported)\s+/,'notReported'],[/^(?:not applicable to|not applicable)\s+/,'notApplicable']];
 for(const [expression,finding] of markers)if(expression.test(clause)){state=finding;clause=clause.replace(expression,'');explicitState=true;break;}
 clause=clause.replace(/^(?:experiences|reports|has|has reported)\s+/,'');
 if(/\b(?:previously|historical|used to|might|could|maybe|if|unless|possibly|sometimes unclear)\b/.test(clause))return null;
 // Ellipsis is allowed only in a coordinated pain phrase, never from an isolated activity.
 if(/^(?:periods|menstruation|intercourse|sex|bowel movements|urination)$/.test(clause)){
  if(!previous?.startsWith('pain:'))return null;
  state=previous.slice(5) as FindingState;clause='pain during '+clause;
 }
 const phrases:[RegExp,TopicId][]=[
  [/^(?:pain (?:during|with|related to) (?:periods|menstruation)|menstrual pain|period-related pain)$/,'periodPain'],
  [/^(?:pain (?:during|with) (?:sex|intercourse)|painful intercourse|dyspareunia)$/,'sexualPain'],
  [/^pain (?:during|with) bowel movements$/,'bowelPain'],[/^pain (?:during|with) urination$/,'bladderPain'],
  [/^pelvic pain$/,'pelvicPain'],[/^pelvic discomfort$/,'pelvicDiscomfort']
 ];
 for(const [expression,topic] of phrases)if(expression.test(clause)){if(!explicitState&&previous?.startsWith('pain:'))state=previous.slice(5) as FindingState;return {topic,state,carry:'pain:'+state};}
 if(/^(?:pregnancy is not possible|pregnancy not possible)$/.test(clause))return {topic:'pregnancy',state:'absent',carry:null};
 if(state==='present'&&/^(?:pregnancy is (?:possible|known|confirmed)|pregnancy (?:possible|known|confirmed)|pregnant)$/.test(clause))return {topic:'pregnancy',state,carry:null};
 if(/^(?:pregnancy status|pregnancy)$/.test(clause)&&['unknown','notReported'].includes(state))return {topic:'pregnancy',state,carry:null};
 if(/^(?:pid is not diagnosed|pid not diagnosed)$/.test(clause))return {topic:'pid',state:'absent',carry:null};
 if(/^(?:pid is (?:diagnosed|presumptively diagnosed)|pid (?:diagnosed|presumptively diagnosed))$/.test(clause))return {topic:'pid',state,carry:null};
 if(clause==='pid status'&&['unknown','notReported'].includes(state))return {topic:'pid',state,carry:null};
 if(/^(?:review (?:the )?(?:reported )?symptom pattern|review symptoms)$/.test(clause))return {topic:'task',state:'present',carry:'symptoms'};
 if(/^(?:review (?:the )?(?:reported )?test findings|review tests)$/.test(clause))return {topic:'task',state:'present',carry:'tests'};
 return null;
}
function statements(message:string){let previous:string|null=null;const parsed:ReturnType<typeof parseStatement>[]=[];for(const part of message.split(/\s*([.;,]|\bbut\b|\band\b)\s*/i).filter(Boolean)){if(/^(?:[.;,]|but|and)$/i.test(part)){if(part.toLowerCase()!=='and')previous=null;continue;}const statement=parseStatement(part,previous);previous=statement?.carry??null;parsed.push(statement);}return parsed;}
export function canonicalCase(original:CanonicalCase|LegacyCase):CanonicalCase{return 'schemaVersion'in original?structuredClone(validateClinical(original)):legacyToCanonical(original);}
function word(topic:TopicId,state:FindingState,task?:string){const entry=Topics[topic];if(topic==='task')return task==='tests'?'Please review the reported test findings and their limitations.':entry.affirmative;if(state==='present')return entry.affirmative;if(state==='absent')return entry.negative;return `Unknown whether ${entry.label.toLowerCase()} is present. Recorded state: ${state==='notReported'?'not reported':state==='notApplicable'?'not applicable':'unknown'}.`;}
function existing(caseInput:CanonicalCase,topic:TopicId):{text:string;states:Set<FindingState>;unclear?:boolean} {
 const entry=Topics[topic];
 if(topic==='pregnancy'||topic==='pid'){const field=caseInput[topic==='pregnancy'?'pregnancyStatus':'pidStatus'];return {text:field.state,states:new Set([field.state])};}
 if(topic==='task'){const field=caseInput.primaryQuestion;return {text:field?.value??field?.state??'Not reported',states:new Set()};}
 const field=entry.field as keyof NonNullable<CanonicalCase['reportedContext']>,text=caseInput.reportedContext?.[field]??'';
 const narrative=caseInput.originalNarrative.state==='present'?caseInput.originalNarrative.value??'':'';
 const states=new Set<FindingState>();
 for(const statement of statements(narrative+';'+text))if(statement?.topic===topic)states.add(statement.state);
 for(const state of ['present','absent','unknown','notReported','notApplicable'] as FindingState[])if(text.includes(word(topic,state)))states.add(state);
 const mentioned:Partial<Record<TopicId,RegExp>>={periodPain:/period|menstrua/i,sexualPain:/intercourse|dyspareunia|pain during sex/i,bowelPain:/bowel movement/i,bladderPain:/urination|pain with bladder/i,pelvicPain:/pelvic pain/i,pelvicDiscomfort:/pelvic discomfort/i};
 const unclear=!states.size&&mentioned[topic]?.test(narrative+' '+text);
 return {text:unclear?[text,narrative].filter(Boolean).join(' '):text||([...states].join(', ')||'Not reported'),states,unclear};
}
export function interpretMessage(original:CanonicalCase|LegacyCase,message:string,questionId?:string):Interpretation {
 const caseInput=canonicalCase(original);
 if(typeof message!=='string'||!message.trim()||message.length>MessageLimit||/[<>\u0000-\u001f]/.test(message))throw new Error('Use a short de-identified statement.');
 const answer=message.trim().toLowerCase();
 const scoped=(questionId==='pregnancy-status'||questionId==='pid-status')&&['yes','no','unknown','not reported'].includes(answer)?questionId==='pregnancy-status'?({yes:'pregnancy is confirmed',no:'pregnancy is not possible',unknown:'unknown pregnancy status','not reported':'not reported pregnancy status'})[answer as 'yes']:({yes:'pid is diagnosed',no:'pid is not diagnosed',unknown:'unknown pid status','not reported':'not reported pid status'})[answer as 'yes']:message;
 const parsed=statements(scoped);let unrecognized=parsed.some(statement=>!statement);const observations:Observation[]=[];
 for(const statement of parsed){if(!statement)continue;const {topic,state}=statement;if(topic!=='pregnancy'&&topic!=='pid'&&topic!=='task'&&caseInput.moduleId!==Module1){unrecognized=true;continue;}
  if(observations.some(observation=>observation.topic===topic&&observation.state===state))continue;
  const prior=existing(caseInput,topic),wording=word(topic,state,statement.carry??undefined),identical=topic==='task'?prior.text===wording:prior.states.has(state)&&prior.states.size===1||state==='notReported'&&prior.text==='Not reported';
  const conflict=[...prior.states].some(priorState=>['present','absent','notApplicable'].includes(priorState)&&['present','absent','notApplicable'].includes(state)&&priorState!==state);
  observations.push({id:'O'+(observations.length+1),topic,label:Topics[topic].label,fieldId:Topics[topic].field,state,wording,original:prior.text,disposition:conflict?'conflict':'unclear'in prior&&prior.unclear?'clarification':identical?'unchanged':'proposed'});
 }
 for(const observation of observations)if(observations.some(other=>other.topic===observation.topic&&other.state!==observation.state)){observation.disposition='conflict';}
 if(observations.length>8)throw new Error('Use a short de-identified statement.');
 return {observations,unrecognized,question:nextQuestion(caseInput,observations)};
}
export function nextQuestion(caseInput:CanonicalCase,observations:Observation[]=[],excluded:TopicId[]=[]){
 const topic=nextTopic(caseInput,observations,excluded);
 return QuestionTopics.find(([candidate])=>candidate===topic)?.[1]??'Review the proposed information when ready. No additional supported question is needed here.';
}

/** Only server-reinterpreted, individually confirmed observations can modify existing canonical fields. */
export function applyObservations(original:CanonicalCase|LegacyCase,observations:Observation[],selected:string[]):CanonicalCase {
 const updated=canonicalCase(original);
 if(!selected.length||new Set(selected).size!==selected.length||selected.some(id=>!observations.some(observation=>observation.id===id&&observation.disposition==='proposed')))throw new Error('Invalid reviewed selection.');
 for(const observation of observations.filter(observation=>selected.includes(observation.id))){
  if(observation.topic==='pregnancy'||observation.topic==='pid')updated[observation.topic==='pregnancy'?'pregnancyStatus':'pidStatus']={state:observation.state};
  else if(observation.topic==='task')updated.primaryQuestion={state:'present',value:observation.wording};
  else {const field=Topics[observation.topic].field as keyof NonNullable<CanonicalCase['reportedContext']>;updated.reportedContext={...updated.reportedContext,[field]:[updated.reportedContext?.[field],`Clinician follow-up: ${observation.wording}`].filter(Boolean).join(' ')};}
 }
 return validateClinical(updated);
}


export interface ClarificationTopic {topic:TopicId|null;question:string;sourceTurn:number;uncertain:boolean}
export interface Dialogue extends Interpretation {pending:ClarificationTopic|null;reply:string;activeTopic:TopicId|null;correctionTarget:TopicId|null;}
const TopicWords:Partial<Record<TopicId,string[]>>={sexualPain:['intercourse','dyspareunia','during sex','painful sex'],periodPain:['periods','menstruation','menstrual'],bowelPain:['bowel movements'],bladderPain:['urination'],pelvicPain:['pelvic pain'],pelvicDiscomfort:['pelvic discomfort'],pregnancy:['pregnancy','pregnant'],pid:['pid']};
const AnswerStatements:Record<TopicId,string>={periodPain:'pain during periods',sexualPain:'pain during sex',bowelPain:'pain with bowel movements',bladderPain:'pain with urination',pelvicPain:'pelvic pain',pelvicDiscomfort:'pelvic discomfort',pregnancy:'pregnancy is confirmed',pid:'pid is diagnosed',task:'review symptoms'};
function topicMentions(message:string,moduleId:string):TopicId[]{const words=' '+message.toLowerCase().replace(/[^a-z]+/g,' ')+' ';return (Object.keys(TopicWords) as TopicId[]).filter(topic=>(moduleId==='module_01_endo'||['pregnancy','pid'].includes(topic))&&TopicWords[topic]?.some(term=>words.includes(' '+term+' ')));}
function clarificationQuestion(topic:TopicId|null){return topic?topic==='pregnancy'?'Is pregnancy possible or known, or does that remain uncertain?':topic==='pid'?'Has PID been diagnosed or presumptively diagnosed, or is that status still uncertain?':`Is ${Topics[topic].label.toLowerCase()} definitely reported? You can leave this uncertain or skip the topic.`:'Which reported symptom or missing field would you like to clarify? You can also use structured choices.';}
/** Repair only uniquely matched conversational qualifiers; never negation, uncertainty, clinical nouns or numbers. */
function normalizeReply(answer:string):string {
 const vocabulary=['definitely'];
 function distance(left:string,right:string){let previous=[...Array(right.length+1).keys()];for(let row=1;row<=left.length;row++){const current=[row];for(let column=1;column<=right.length;column++)current[column]=Math.min(current[column-1]+1,previous[column]+1,previous[column-1]+(left[row-1]===right[column-1]?0:1));previous=current;}return previous[right.length];}
 return answer.trim().toLowerCase().replace(/[.!]$/,'').split(/\s+/).map(token=>{if(!/^def[a-z]{1,7}ly$/.test(token)||vocabulary.includes(token))return token;const matches=vocabulary.filter(known=>Math.abs(known.length-token.length)<=2&&distance(token,known)<=2);return matches.length===1?matches[0]:token;}).join(' ');
}
function scopedAnswer(topic:TopicId,answer:string):string|null {
 const normalized=normalizeReply(answer);
 if(['yes','yes confirmed','yes, confirmed','definitely reported','it is reported','definitely confirmed','confirmed','yes definitely'].includes(normalized))return AnswerStatements[topic];
 if(['no','it is absent','definitely absent'].includes(normalized))return topic==='pregnancy'?'pregnancy is not possible':topic==='pid'?'pid is not diagnosed':'no '+AnswerStatements[topic];
 if(['record as unknown','unknown'].includes(normalized))return topic==='pregnancy'?'unknown pregnancy status':topic==='pid'?'unknown pid status':'unknown '+AnswerStatements[topic];
 if(['record as not reported','not reported'].includes(normalized))return topic==='pregnancy'?'not reported pregnancy status':topic==='pid'?'not reported pid status':'not reported '+AnswerStatements[topic];
 if(normalized==='not applicable'&&!['pregnancy','pid','task'].includes(topic))return 'not applicable '+AnswerStatements[topic];
 return null;
}
const QuestionTopics=[['periodPain','Is pain related to periods?'],['sexualPain','Is pain present during sex?'],['bowelPain','Is pain present with bowel movements?']] as const;
function nextTopic(caseInput:CanonicalCase,observations:Observation[],excluded:TopicId[]):TopicId|null {return caseInput.moduleId===Module1?QuestionTopics.find(([topic])=>!excluded.includes(topic)&&existing(caseInput,topic).text==='Not reported'&&!observations.some(observation=>observation.topic===topic))?.[0]??null:null;}
/** Resolve short dialogue acts and coordinated ellipsis only against the actual server-created question. */
function contextualReply(topic:TopicId|null,message:string):string|null {
 if(!topic)return null;
 const pieces=message.split(/,\s*|\s+(?:and|but)\s+/i).filter(Boolean),first=pieces[0]?.replace(/^(?:and |but )/i,'')??'';
 const answer=scopedAnswer(topic,first);if(!answer)return null;
 const affirmative=answer===AnswerStatements[topic],painTopic=!['pregnancy','pid','task'].includes(topic);
 const coordinated:Record<string,string>={'during intercourse':'pain during sex','during sex':'pain during sex','during periods':'pain during periods','during menstruation':'pain during periods','with bowel movements':'pain with bowel movements','during bowel movements':'pain with bowel movements','with urination':'pain with urination','during urination':'pain with urination'};
 return [answer,...pieces.slice(1).map(part=>{const clause=part.trim().toLowerCase().replace(/^(?:(?:and|but) )?(?:also )?/,'').replace(/[.!]$/,'');return affirmative&&painTopic&&Object.hasOwn(coordinated,clause)?coordinated[clause]:part;})].join('; ');
}
/** Topic routing asks a question only; it cannot turn a mention or uncertainty into a finding. */
export function interpretDialogue(original:CanonicalCase|LegacyCase,turns:string[],questionId?:string):Dialogue {
 if(!Array.isArray(turns)||!turns.length||turns.length>TurnLimit||turns.some(turn=>typeof turn!=='string'||!turn.trim()||turn.length>MessageLimit||/[<>\u0000-\u001f]/.test(turn)))throw new Error('Invalid conversation.');
 const caseInput=canonicalCase(original),observations:Observation[]=[];let pending:ClarificationTopic|null=null,unrecognized=false,reply='',queue:TopicId[]=[];const skipped=new Set<TopicId>();let changedTopic=false,lastReferents:TopicId[]=[],correctionTarget:TopicId|null=null;
 let activeTopic:TopicId|null=questionId==='pregnancy-status'?'pregnancy':questionId==='pid-status'?'pid':questionId==='pelvic-pattern'?nextTopic(caseInput,[],[]):null;
 if(activeTopic&&['pregnancy','pid'].includes(activeTopic))pending={topic:activeTopic,question:clarificationQuestion(activeTopic),sourceTurn:0,uncertain:false};
 for(const [index,message] of turns.entries()){
  const normalized=normalizeReply(message);
  if(normalized==='skip this topic'||normalized==='change topic'){const skippedTopic=pending?.topic??activeTopic;if(normalized==='skip this topic'&&skippedTopic)skipped.add(skippedTopic);changedTopic=normalized==='change topic';pending=null;queue=[];activeTopic=changedTopic?null:nextTopic(caseInput,observations,[...skipped]);reply=normalized==='skip this topic'?'This topic is left unresolved. No value has changed.':'Choose the next topic explicitly. No value has changed.';if(normalized==='skip this topic'&&!observations.length)reply+=' '+nextQuestion(caseInput,observations,[...skipped]);unrecognized=false;lastReferents=[];continue;}
  changedTopic=false;correctionTarget=null;
  const referenceTopic=pending?pending.topic:activeTopic;
  let contextual=contextualReply(referenceTopic,message);
  if(/^(?:actually[, ]+)?i meant the opposite$/.test(normalized)){
   const referent=lastReferents.length===1?observations.filter(observation=>observation.topic===lastReferents[0]).at(-1):null;
   if(referent&&['present','absent'].includes(referent.state)){correctionTarget=referent.topic;contextual=scopedAnswer(referent.topic,referent.state==='present'?'no':'yes');}
   else{pending={topic:null,question:'Which earlier statement should be corrected? Name the symptom or field and its intended value.',sourceTurn:index,uncertain:false};activeTopic=null;reply=pending.question;unrecognized=true;lastReferents=[];continue;}
  }
  const understood=interpretMessage(original,contextual??message,questionId),mentioned=topicMentions(message,caseInput.moduleId);
  // Uncertainty scope can span a coordinated phrase. No topic mention or spelling repair establishes a finding.
  const uncertainTopics=new Set<TopicId>();
  for(const clause of message.split(/[.;]|\bbut\b/i)){
   const topics=topicMentions(clause,caseInput.moduleId),qualifier=normalizeReply(clause);
   if(/\b(?:possible|possibly|maybe|perhaps|unsure|uncertain|might|could|unconfirmed)\b|not sure|not confirmed|not definitely|not certain/i.test(qualifier)){
    for(const topic of topics)uncertainTopics.add(topic);
    if(!topics.length&&referenceTopic)uncertainTopics.add(referenceTopic);
   }
  }
  // Unknown trailing wording with no named field can qualify the entire short answer, not a separate observation.
  if(referenceTopic&&contextual&&understood.unrecognized&&!mentioned.length)uncertainTopics.add(referenceTopic);
  // An unbound alternative or contradictory short answer cannot qualify an earlier yes as a finding.
  if(referenceTopic&&(/\bor\b/i.test(message)||/^yes\b/i.test(message)&&/\bbut\s+no[.!]?$/i.test(message)))uncertainTopics.add(referenceTopic);
  const accepted=understood.observations.filter(observation=>!uncertainTopics.has(observation.topic)&&(!!contextual||observation.state!=='unknown'));
  for(const observation of accepted){if(!observations.some(prior=>prior.topic===observation.topic&&prior.state===observation.state))observations.push({...observation,id:'O'+(observations.length+1)});}
  if(observations.length>8)throw new Error('Invalid conversation.');
  lastReferents=[...new Set(accepted.map(observation=>observation.topic))];
  queue=queue.filter(topic=>!accepted.some(observation=>observation.topic===topic));
  if(pending&&(!pending.topic&&accepted.length||accepted.some(observation=>observation.topic===pending!.topic)))pending=null;
  const needs=[...new Set([...mentioned,...uncertainTopics])].filter(topic=>!accepted.some(observation=>observation.topic===topic)&&!observations.some(observation=>observation.topic===topic&&observation.disposition==='proposed'));
  for(const topic of needs)if(!queue.includes(topic)&&topic!==pending?.topic)queue.push(topic);
  if(!pending&&queue.length){const topic=queue.shift()!;pending={topic,question:clarificationQuestion(topic),sourceTurn:index,uncertain:uncertainTopics.has(topic)};}
  if(!pending&&understood.unrecognized&&!accepted.length)pending={topic:activeTopic,question:clarificationQuestion(activeTopic),sourceTurn:index,uncertain:true};
  unrecognized=understood.unrecognized;
  activeTopic=pending?pending.topic:nextTopic(caseInput,observations,[...skipped]);
  if(pending){reply=pending.topic?`You are discussing ${Topics[pending.topic].label.toLowerCase()}. ${uncertainTopics.size||!contextual&&!accepted.length?'The meaning remains uncertain; no positive or negative finding has been proposed.':'That point still needs clarification.'} ${pending.question}`:pending.question;}
  else reply=accepted.length?'Review the interpreted information below. Nothing has been applied.':'No new update is proposed. The case is unchanged.';
 }
 for(const observation of observations)if(observations.some(other=>other.topic===observation.topic&&other.state!==observation.state))observation.disposition='conflict';
 return {observations,pending,unrecognized,reply,activeTopic,correctionTarget,question:pending?.question??(changedTopic?'Which supported topic would you like to discuss next?':nextQuestion(caseInput,observations,[...skipped]))};
}
