/** Reviewed collection prompts only; these do not introduce clinical claims or resolve conflicting reports. */
export const FollowupVersion = '1';
export const MaximumTurns = 5;
export const MaximumAnswer = 600;
export const FollowupNotice = 'Use de-identified information only. Guided follow-up helps collect and organize additional case details. It does not diagnose, prescribe or replace clinical judgment.';
export interface GuidedQuestion {
 questionId: string; moduleId: string; responseTypes: string[]; claimIds: string[]; conditions: string[];
 disqualifications: string[]; text: string; rationale: string; answerCategory: 'exactNote' | 'pregnancyStatus';
 nextQuestionIds: string[]; structuredMapping: boolean; reviewedVersion: '1';
}
const Exclusions = ['urgent', 'conflict', 'insufficientEvidence', 'outsideScope', 'injection', 'diagnosisOrTreatmentRequest'];
export const GuidedQuestions: readonly GuidedQuestion[] = [
 {questionId:'pelvic-pattern', moduleId:'module_01_endo', responseTypes:['AgentResponse'],claimIds:['N01','C01','C11'],conditions:['existingReviewedPelvicQuestion'],disqualifications:Exclusions,text:'Is the discomfort related to menstruation, intercourse, bowel movements, or urination, and how much does it affect daily activities?',rationale:'Clarify the symptom pattern and its effect on daily life.',answerCategory:'exactNote',nextQuestionIds:['pelvic-impact'],structuredMapping:false,reviewedVersion:'1'},
 {questionId:'pelvic-impact',moduleId:'module_01_endo',responseTypes:['AgentResponse'],claimIds:['CppHistory'],conditions:['completedPelvicPattern'],disqualifications:Exclusions,text:'How does the discomfort affect daily activities?',rationale:'Record the reported functional impact without inferring a cause.',answerCategory:'exactNote',nextQuestionIds:[],structuredMapping:false,reviewedVersion:'1'},
 ...['module_01_endo','module_02_early_pregnancy'].map((moduleId,index):GuidedQuestion=>({questionId:'pregnancy-status-'+(index+1),moduleId,responseTypes:['ClarificationRequired'],claimIds:[index===0?'E01':'M2EctopicEmergency'],conditions:['pregnancyStatusRequiresClarification'],disqualifications:Exclusions,text:'Is pregnancy possible or known, not possible, or unknown?',rationale:'Confirm the explicit pregnancy status before clinical analysis can continue.',answerCategory:'pregnancyStatus',nextQuestionIds:[],structuredMapping:true,reviewedVersion:'1'}))
];
export interface GuidedTurn { turnId: string; questionId: string; response: string }
export interface GuidedUpdate { fieldId: 'additionalNotes' | 'pregnancyPossible'; value: string | boolean | null; supportingTurnId: string }
export interface GuidedRequest {contractVersion:'1'; action:'start'|'respond'|'confirm'; sessionId:string; questionId:string; caseInput:unknown; turns:GuidedTurn[]; updates:GuidedUpdate[]; confirmed:boolean}
export interface GuidedSelection {contractVersion:'1';sessionId:string;currentQuestionId:string;acknowledgementVariantId:'recorded';action:'ask-next-question'|'propose-update'|'ready-to-reanalyze'|'end-guided-follow-up';nextQuestionId:string|null;proposedUpdates:GuidedUpdate[]}
export const Acknowledgements = {recorded:'Response recorded for this session. Case information has not changed.'};
export function questionById(questionId:string):GuidedQuestion {const question=GuidedQuestions.find(question=>question.questionId===questionId);if(!question)throw new Error('Guided follow-up is unavailable.');return question;}
export function exactKeys(payload:unknown,keys:string[]):Record<string,unknown> {
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).sort().join('|')!==[...keys].sort().join('|'))throw new Error('Guided follow-up is unavailable.');return payload as Record<string,unknown>;
}
export function readGuidedRequest(payload:unknown):GuidedRequest {
 const request=exactKeys(payload,['contractVersion','action','sessionId','questionId','caseInput','turns','updates','confirmed']);
 if(request.contractVersion!=='1'||!['start','respond','confirm'].includes(String(request.action))||typeof request.sessionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.sessionId)||typeof request.questionId!=='string'||typeof request.confirmed!=='boolean'||!Array.isArray(request.turns)||request.turns.length>MaximumTurns||!Array.isArray(request.updates)||request.updates.length>MaximumTurns)throw new Error('Guided follow-up is unavailable.');
 questionById(request.questionId);
 const ids=new Set<string>();
 for(const candidate of request.turns){const turn=exactKeys(candidate,['turnId','questionId','response']);if(typeof turn.turnId!=='string'||!/^T[1-5]$/.test(turn.turnId)||ids.has(turn.turnId)||typeof turn.questionId!=='string'||typeof turn.response!=='string'||!turn.response.trim()||turn.response.length>MaximumAnswer)throw new Error('Guided follow-up is unavailable.');ids.add(turn.turnId);questionById(turn.questionId);}
 const updateIds=new Set<string>();
 for(const candidate of request.updates){const update=exactKeys(candidate,['fieldId','value','supportingTurnId']);if(!['additionalNotes','pregnancyPossible'].includes(String(update.fieldId))||typeof update.supportingTurnId!=='string'||!ids.has(update.supportingTurnId)||updateIds.has(update.supportingTurnId)||(update.fieldId==='additionalNotes'?typeof update.value!=='string'||!update.value.trim()||update.value.length>MaximumAnswer:update.value!==null&&typeof update.value!=='boolean'))throw new Error('Guided follow-up is unavailable.');updateIds.add(update.supportingTurnId);}
 if(request.action==='start'&&(request.turns.length||request.updates.length||request.confirmed)||request.action==='respond'&&(!request.turns.length||request.updates.length||request.confirmed)||request.action==='confirm'&&(!request.turns.length||!request.updates.length||!request.confirmed))throw new Error('Guided follow-up is unavailable.');
 return request as unknown as GuidedRequest;
}
/** Anchored, explicit answers only, and only in the pregnancy-status question context. */
export function proposedUpdate(turn:GuidedTurn):GuidedUpdate {
 const question=questionById(turn.questionId),answer=turn.response.toLowerCase().trim();
 if(question.structuredMapping){
  if(/^(yes|possible|known|pregnancy (?:is )?(?:possible|confirmed)|patient is pregnant)[.!]?$/.test(answer))return {fieldId:'pregnancyPossible',value:true,supportingTurnId:turn.turnId};
  if(/^(no|not possible|pregnancy (?:is )?not possible|patient is not pregnant)[.!]?$/.test(answer))return {fieldId:'pregnancyPossible',value:false,supportingTurnId:turn.turnId};
  if(/^(unknown|not reported|not provided|unsure)[.!]?$/.test(answer))return {fieldId:'pregnancyPossible',value:null,supportingTurnId:turn.turnId};
 }
 return {fieldId:'additionalNotes',value:turn.response,supportingTurnId:turn.turnId};
}
export function validateSelection(payload:unknown,request:GuidedRequest,allowedNext:string[],allowedUpdates:GuidedUpdate[]):GuidedSelection {
 const selection=exactKeys(payload,['contractVersion','sessionId','currentQuestionId','acknowledgementVariantId','action','nextQuestionId','proposedUpdates']);
 if(selection.contractVersion!=='1'||selection.sessionId!==request.sessionId||selection.currentQuestionId!==request.questionId||selection.acknowledgementVariantId!=='recorded'||!['ask-next-question','propose-update','ready-to-reanalyze','end-guided-follow-up'].includes(String(selection.action))||!Array.isArray(selection.proposedUpdates)||selection.proposedUpdates.length>MaximumTurns)throw new Error('Guided follow-up is unavailable.');
 if(selection.action==='ask-next-question' ? typeof selection.nextQuestionId!=='string'||!allowedNext.includes(selection.nextQuestionId)||request.turns.length>=MaximumTurns : selection.nextQuestionId!==null)throw new Error('Guided follow-up is unavailable.');
 const used=new Set<string>();
 for(const candidate of selection.proposedUpdates){const update=exactKeys(candidate,['fieldId','value','supportingTurnId']);const match=allowedUpdates.find(allowed=>allowed.fieldId===update.fieldId&&allowed.supportingTurnId===update.supportingTurnId&&allowed.value===update.value);if(!match||used.has(match.supportingTurnId))throw new Error('Guided follow-up is unavailable.');used.add(match.supportingTurnId);}
 if(['propose-update','ready-to-reanalyze'].includes(String(selection.action))&&!selection.proposedUpdates.length)throw new Error('Guided follow-up is unavailable.');
 return selection as unknown as GuidedSelection;
}
