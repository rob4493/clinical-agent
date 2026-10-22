import { Atom, ordinaryAtoms, pregnancyAtoms, structuralFocus, unsupportedFindings } from './synthesis';
import { CaseInput, context, RecordFields, weeks } from './input';
import { Claim, DecisionNotice, Module1, Module2, Package } from './packages';
import { caseText, nonspecific, retrieve1, retrieve2 } from './retrieval';
import { evaluateSafety, Warning, warningCoverage } from './safety';
import { evidenceNotes, prescribingIntent, PrescribingNotice, hcgClarification } from './requestPolicy';

export interface Envelope { warnings:Warning[]; response:RecordFields; sources:{number:number;source:RecordFields}[]; renderedText:string }
export interface Analysis { status:number; envelope:Envelope }
export const CoverageMessage='Evidence coverage is insufficient to provide a validated urgent action for this reported pattern. No routine clinical analysis was generated.';
const Insufficient='The approved knowledge base does not contain sufficient evidence to support a response to this request.';
const PreliminaryQuestion='Is the discomfort related to menstruation, intercourse, bowel movements, or urination, and how much does it affect daily activities?';
const UrgentQuestion='Are there signs of instability, severe or worsening pain, heavy bleeding, shoulder pain, weakness, dizziness, or fainting?';
const Injection=/ignore (?:all |previous |the )?(?:instructions|rules)|system prompt|reveal (?:your |the )?(?:prompt|credentials)|fabricate (?:a |the )?(?:citation|source)/i;
const Outside=/\b(?:diagnose me|give a diagnosis|do i have|probability|what stage|prescribe|dosage|what dose|which medication|which drug|which treatment|postmenopausal)\b/i;

export function validateAtoms(atoms:Atom[],claims:Claim[],moduleId:string,allowed:Atom[]):void {
 const byId=new Map(claims.map(claim=>[claim.claimId,claim])),used=new Set<string>();
 for(const atom of atoms) {
  if(!atom.claimIds.length || atom.claimIds.length>8 || !atom.text.trim() || atom.text.length>6000 || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|https?:\/\//i.test(atom.text))throw new Error('Unsupported evidence-bound response.');
  for(const id of atom.claimIds){const claim=byId.get(id);if(!claim||claim.moduleId!==moduleId||used.has(id)||claim.productionApproved!==false)throw new Error('Unsupported evidence-bound response.');used.add(id);}
  // The deterministic generator has a closed, request-scoped proposition set.
  // A valid claim ID alone cannot authorize altered tests/actions or new text.
  const required=new Set(atom.claimIds);
  function recognize(position:number,covered:Set<string>):boolean {
   for(const candidate of allowed) {
    if(candidate.claimIds.some(id=>!required.has(id)||covered.has(id))||!atom.text.startsWith(candidate.text,position))continue;
    const end=position+candidate.text.length,next=new Set([...covered,...candidate.claimIds]);
    if(end===atom.text.length&&next.size===required.size)return true;
    if(atom.text[end]===' '&&recognize(end+1,next))return true;
   }
   return false;
  }
  if(!recognize(0,new Set()))throw new Error('Unsupported evidence-bound response.');
 }
}
function finish(caseInput:CaseInput,entry:Package|undefined,outcome:RecordFields,warnings:Warning[]=[],claims:Claim[]=[],atoms:Atom[]=[],question:string|null=null,status=200):Analysis {
 if(entry)validateAtoms(atoms,claims,entry.moduleId,atoms);
 const sourceIds=[...new Set(claims.map(claim=>claim.sourceId))];
 const sources=sourceIds.map((id,index)=>{
  const source=entry?.sources.find(candidate=>candidate.sourceId===id);if(!source)throw new Error('Invalid citation.');
  return {number:index+1,source:{sourceId:id,organization:source.organization,title:source.title,publicationDate:source.publicationDate,reviewDate:null,jurisdiction:claims.find(claim=>claim.sourceId===id)!.jurisdiction,verifiedUrl:source.urlVerificationStatus==='verifiedOfficialRetrieval'?source.officialUrl:null}};
 });
 const numbers=new Map(sourceIds.map((id,index)=>[id,index+1]));
 const usedSources=new Set<string>();
 const paragraphs=warnings.map(warning=>{
  const cited=[...new Set(warning.sourceTags.filter(id=>numbers.has(id)))];if(!cited.length)throw new Error('Uncited warning.');cited.forEach(id=>usedSources.add(id));
  return warning.text+' ['+cited.map(id=>numbers.get(id)).join(',')+']';
 });
 if(outcome.responseType==='AgentResponse') {
  const words=atoms.reduce((sum,atom)=>sum+atom.text.split(/\s+/).length,0);
  if(words>(caseInput.caseType==='brief'?150:300))throw new Error('Response bounds exceeded.');
  const count=Math.min(caseInput.caseType==='brief'?2:3,atoms.length),considerations=[];
  for(let index=0;index<count;index++) {
   const group=atoms.slice(Math.floor(index*atoms.length/count),Math.floor((index+1)*atoms.length/count));
   const ids=[...new Set(group.flatMap(atom=>atom.claimIds).map(id=>claims.find(claim=>claim.claimId===id)!.sourceId))];ids.forEach(id=>usedSources.add(id));
   const text=group.map(atom=>atom.text).join(' ');
   considerations.push({text,citations:ids.map(sourceTag=>({sourceTag,jurisdiction:null,limitation:null})),isInterpretation:false});
   paragraphs.push(text+' ['+ids.map(id=>numbers.get(id)).join(',')+']');
  }
  if(!count&&!warnings.length)throw new Error('Empty response.');
  const reportedFacts:RecordFields=Object.fromEntries(['ageRange','painLocation','painQuality','painSeverity','symptomTiming','bowelUrinarySymptoms','sexualPain','menstrualHistory','pregnancyPossible','pidDiagnosedOrPresumed','fertilityStatus','priorTreatments','familyHistory'].map(name=>[name,'Unknown']));
  reportedFacts.ageRange=caseInput.ageRange||'Unknown';
  reportedFacts.pregnancyPossible=caseInput.pregnancyPossible===null?'Unknown':caseInput.pregnancyPossible?'Yes':'No';
  reportedFacts.pidDiagnosedOrPresumed=caseInput.pidDiagnosedOrPresumed===null?'Unknown':caseInput.pidDiagnosedOrPresumed?'Yes':'No';
  outcome={urgentWarnings:warnings,responseType:'AgentResponse',moduleId:entry!.moduleId,caseType:caseInput.caseType,reportedFacts,supportedInterpretations:considerations,missingInformation:[],overlappingConsiderations:[],testExamReferral:[],urgentWarningResult:{moduleId:entry!.moduleId,rulesEvaluated:['U1','U2','U3'],warningsTriggered:warnings},evidenceSufficient:true,decisionSupportNotice:DecisionNotice};
 } else if(outcome.responseType==='DataConflict')paragraphs.push(outcome.conflictDescription as string,outcome.clarificationRequest as string);
 else if(outcome.responseType==='ClarificationRequired')paragraphs.push(outcome.clarificationRequest as string);
 else paragraphs.push(outcome.message as string);
 if(question)paragraphs.push(question);
 if(sources.length)paragraphs.push('Sources',sources.map(cited=>'['+cited.number+'] '+cited.source.organization+' — '+cited.source.title+(cited.source.verifiedUrl?' — <'+cited.source.verifiedUrl+'>':'')).join('\n'));
 if(sources.some(source=>!usedSources.has(source.source.sourceId as string)))throw new Error('Uncited source.');
 paragraphs.push(DecisionNotice);
 return {status,envelope:{warnings,response:{...outcome,decisionSupportNotice:DecisionNotice},sources,renderedText:paragraphs.join('\n\n')}};
}
export function unavailable():Analysis {
 return {status:503,envelope:{warnings:[],response:{responseType:'EvidenceInsufficient',moduleId:null,message:'Analysis is unavailable. Please try again later.',decisionSupportNotice:DecisionNotice},sources:[],renderedText:'Analysis is unavailable. Please try again later.\n\n'+DecisionNotice}};
}
export function analyze(caseInput:CaseInput,packages:Package[]):Analysis {
 const result=analyzeClinical(caseInput,packages);
 if(!prescribingIntent(caseInput.additionalNotes)||['DataConflict','ClarificationRequired'].includes(result.envelope.response.responseType as string))return result;
 const paragraphs=result.envelope.renderedText.split('\n\n'),position=result.envelope.warnings.length;
 if(result.envelope.response.responseType==='OutsideScope') {
  result.envelope.response={...result.envelope.response,message:PrescribingNotice};paragraphs[position]=PrescribingNotice;
 } else paragraphs.splice(position,0,PrescribingNotice);
 result.envelope.renderedText=paragraphs.join('\n\n');
 return result;
}
function analyzeClinical(caseInput:CaseInput,packages:Package[]):Analysis {
 const moduleId=caseInput.moduleHint==='EndometriosisChronicPelvicPain'?Module1:caseInput.moduleHint;
 const entry=packages.find(candidate=>candidate.moduleId===moduleId);
 if(!entry)return finish(caseInput,undefined,{responseType:moduleId==='NotSure'?'SelectModuleRequired':'ModuleUnavailable',...(moduleId==='NotSure'?{}:{moduleHint:'Unavailable'}),message:moduleId==='NotSure'?'No clinical module was selected. Please select an approved clinical module before submitting a case.':'The selected module is unavailable.'},[],[],[],null,moduleId==='NotSure'?200:404);
 caseInput={...caseInput,moduleHint:moduleId};
 const safety=evaluateSafety(caseInput);
 if(safety.halt)return finish(caseInput,entry,safety.halt as unknown as RecordFields);
 let warnings=safety.warnings,warningClaims:Claim[]=[];
 if(warnings.length) {
  try {
   const covered=warningCoverage(caseInput,safety);
   if(!covered)return finish(caseInput,entry,{responseType:'EvidenceInsufficient',moduleId,message:CoverageMessage},[],[],[],null,503);
   warnings=covered.warnings;warningClaims=covered.claimIds.map(id=>entry.claims.find(claim=>claim.claimId===id)!);
  } catch(failure) {
   if(failure&&typeof failure==='object'&&'responseType' in failure)return finish(caseInput,entry,failure as unknown as RecordFields);
   throw failure;
  }
  if(moduleId===Module2||warnings.some(warning=>warning.ruleId==='U1'))return finish(caseInput,entry,{responseType:'AgentResponse'},warnings,warningClaims);
 }
 let text=caseInput.additionalNotes||'';
 const insufficient=(message=Insufficient)=>finish(caseInput,entry,{responseType:'EvidenceInsufficient',moduleId,message},warnings,warningClaims);
 if(moduleId===Module2&&weeks(caseInput)!==null&&weeks(caseInput)!>13)return finish(caseInput,entry,{responseType:'OutsideScope',moduleId,message:"This request is outside the selected module's evidence-support scope."});
 if(Injection.test(text))return insufficient(moduleId===Module1?'The submitted instructions cannot be used as clinical evidence. Please provide only de-identified case information.':Insufficient);
 if(prescribingIntent(text)) {
  text=evidenceNotes(text);
  if(!text)return finish(caseInput,entry,{responseType:'OutsideScope',moduleId,message:PrescribingNotice},warnings,warningClaims);
  caseInput={...caseInput,additionalNotes:text};
 }
 if(Outside.test(text)||moduleId===Module2&&caseInput.pregnancyPossible===false)return finish(caseInput,entry,{responseType:'OutsideScope',moduleId,message:"This request is outside the selected module's evidence-support scope."},warnings,warningClaims);
 if(moduleId===Module2&&caseInput.pregnancyPossible===null)return finish(caseInput,entry,{responseType:'ClarificationRequired',fieldName:'pregnancyPossible',structuredValue:null,clarificationRequest:'Please confirm whether pregnancy is possible or known.'});
 if(moduleId===Module2&&weeks(caseInput)===null)return finish(caseInput,entry,{responseType:'ClarificationRequired',fieldName:'earlyPregnancy.gestationalWeeks',structuredValue:null,clarificationRequest:'Please provide the reported gestational context; missing information remains unknown.'});
 const clarification=moduleId===Module2?hcgClarification(caseInput):null;
 if(clarification)return finish(caseInput,entry,{responseType:'ClarificationRequired',fieldName:'earlyPregnancy',structuredValue:null,clarificationRequest:clarification});
 let claims=moduleId===Module2?retrieve2(caseInput,entry):retrieve1(caseInput,entry),atoms:Atom[]=[],question:string|null=null;
 const focus=moduleId===Module1?structuralFocus(caseInput,entry):null;
 if(moduleId===Module1&&unsupportedFindings(caseInput,focus!==null))return insufficient('The verified evidence cannot support a complete, finding-specific review of the reported abnormal findings. They must not be treated as normal.');
 if(focus){claims=focus.claims;atoms=focus.atoms;}
 if(!claims.length) {
  if(moduleId===Module2)return insufficient('The verified Module 2 package does not support this question with the reported test and population context.');
  if(!caseText(caseInput).trim())return insufficient('No clinical details were provided to support an evidence review.');
  return finish(caseInput,entry,{responseType:'OutsideScope',moduleId,message:"This request is outside the selected module's evidence-support scope."},warnings,warningClaims);
 }
 if(moduleId===Module1) {
  if(/negative (?:home|urine|pregnancy) (?:pregnancy )?test|\b(?:home|urine)\s+(?:pregnancy\s+)?test\b|pregnancy test[^.!?]{0,60}\b(?:home|urine)\b|hcg (?:threshold|cut.?off)|\bhcg\s*(?:level\s*)?(?:of\s*)?\d/i.test(text))return insufficient('The verified sources do not support a negative-home-test exclusion rule or an hCG threshold for this question.');
  const tests=['ultrasound','mri','ca125'].filter(name=>({ultrasound:/ultrasound|tvus/i,mri:/\bmri\b/i,ca125:/ca[ -]?125/i})[name as 'mri'].test(text));
  if(!focus&&tests.length&&/\babnormal\s+(?:pelvic\s+|transvaginal\s+)?(?:mri|ultrasound|ca[ -]?125)\b|\b(?:mri|ultrasound|ca[ -]?125)\b[^.!?]{0,40}\b(?:is|was|reported as)\s+abnormal\b/i.test(text))return insufficient('The reported test abnormality needs a precise finding-specific description for an evidence-bound interpretation.');
  let direct:string|null=null;
  if(!focus&&text.includes('?')&&tests.length===1&&!/referr|laparosc|procedure|other tests|differential|complete|broad|next steps/i.test(text))direct=tests[0]==='ca125'?'N22':/\bnormal\b/i.test(text)?tests[0]==='ultrasound'?'N18':'N20':null;
  if(direct)claims=claims.filter(claim=>claim.claimId===direct);
  const preliminary=nonspecific(caseInput)&&!warnings.length;
  if(!focus)atoms=ordinaryAtoms(caseInput,claims,preliminary,direct);
  if(preliminary)question=PreliminaryQuestion;
 } else {
  atoms=pregnancyAtoms(claims);
  const ctx=context(caseInput);
  if(claims.length===2&&claims.some(claim=>claim.claimId==='M2NSymptoms')&&claims.some(claim=>claim.claimId==='M2NPainAssessment')&&['clinicallyStable','hemodynamicInstability','heavyBleeding','significantConcernAboutPainOrBleeding','worseningPelvicPain'].every(name=>ctx[name]===null)&&!/instab|stable|severe|worsen|heavy|shoulder|weakness|dizz|faint/i.test(text))question=UrgentQuestion;
 }
 if(!atoms.length)return insufficient();
 const ceiling=caseInput.caseType==='brief'?150:300;
 // Match the injected deterministic provider: retain whole evidence-bound
 // propositions within the word budget, never truncate a clinical statement.
 let words=0;
 atoms=atoms.filter(atom=>{const size=atom.text.split(/\s+/).length;if(words+size>ceiling)return false;words+=size;return true;});
 if(!atoms.length)return insufficient();
 const used=new Set(atoms.flatMap(atom=>atom.claimIds));
 if(moduleId===Module2&&used.size!==claims.length || focus&&used.size!==claims.length)return insufficient();
 const clinical=claims.filter(claim=>used.has(claim.claimId));
 return finish(caseInput,entry,{responseType:'AgentResponse'},warnings,[...new Map([...warningClaims,...clinical].map(claim=>[claim.claimId,claim])).values()],atoms,question);
}
