import Policy from './policy.json';
import { currentClauses, phraseState, phraseStates, reportedStates } from './assertions';
import { CaseInput, context, pattern, textField, weeks } from './input';
import { Module1, Module2 } from './packages';

export interface Warning { ruleId:string; text:string; sourceTags:string[] }
export interface Halt { responseType:'DataConflict'|'ClarificationRequired'; fieldName:string; structuredValue?:string|null; conflictDescription?:string; clarificationRequest:string }
export interface Safety { warnings:Warning[]; findings:Record<string,boolean|null>; halt:Halt|null }
export function halt(fieldName:string,clarify=false):Halt {
 const question=fieldName==='pregnancyPossible'?'Please confirm or correct the structured pregnancy status.':fieldName==='pidDiagnosedOrPresumed'?'Please confirm or correct the structured PID diagnostic status.':'Please confirm or correct the conflicting reported information.';
 return clarify?{responseType:'ClarificationRequired',fieldName,structuredValue:null,clarificationRequest:question}:{responseType:'DataConflict',fieldName,structuredValue:'Reported context',conflictDescription:'Explicit current findings are inconsistent.',clarificationRequest:question};
}
function conflict1(caseInput:CaseInput):Halt|null {
 const conflicts:Halt[]=[],clarifications:Halt[]=[];
 const texts=['additionalNotes','fertilityStatus','painLocation','painQuality','painSeverity','symptomTiming','bowelUrinarySymptoms','sexualPain','menstrualHistory'].map(name=>textField(caseInput,name));
 for(const [name,[positive,negative]] of Object.entries(Policy.statusPatterns)) {
  const states=new Set<boolean>();
  for(const text of texts) for(const clause of currentClauses(text)) for(const [expression,status] of [[positive,true],[negative,false]] as [string,boolean][]) for(const match of clause.matchAll(pattern('\\b(?:'+expression+')\\b','gi'))) {
   const prefix=clause.slice(0,match.index),suffix=clause.slice(match.index!+match[0].length);
   if(!pattern(Policy.assertions.Negation).test(prefix)&&!pattern(Policy.assertions.Uncertainty).test(prefix)&&!pattern(Policy.assertions.DeniedSuffix).test(suffix)&&!pattern(Policy.assertions.UncertainSuffix).test(suffix)) states.add(status);
  }
  if(states.size && caseInput[name]===null) clarifications.push(halt(name,true));
  else if(states.size && (states.size>1 || !states.has(caseInput[name] as boolean))) conflicts.push(halt(name));
 }
 const scores=new Set<string>();
 for(const clause of currentClauses(caseInput.additionalNotes)) for(const match of clause.matchAll(/\b(?:current|same event) pelvic pain (?:score|severity) (?:is )?(\d+(?:\.\d+)?)\/10\b/g)) if(!pattern(Policy.assertions.Negation).test(clause.slice(0,match.index))&&!pattern(Policy.assertions.Uncertainty).test(clause.slice(0,match.index))) scores.add(String(Number(match[1])));
 if(scores.size>1) clarifications.push({responseType:'ClarificationRequired',fieldName:'painSeverity',structuredValue:null,clarificationRequest:'Please clarify whether the differing pain scores refer to the same current event.'});
 return conflicts[0]||clarifications[0]||null;
}
function conflict2(caseInput:CaseInput):Halt|null {
 const ctx=context(caseInput),text=caseInput.additionalNotes;
 const positive=reportedStates(text,'positive (?:urine |serum )?pregnancy test|pregnancy (?:is )?confirmed|patient is pregnant');
 const denied=reportedStates(text,'pregnancy (?:is )?ruled out|patient is not pregnant');
 const positiveStatus=positive.has(true)||ctx.pregnancyTestResult==='positive',negativeStatus=denied.has(true);
 if(positiveStatus&&negativeStatus) return halt('pregnancyPossible');
 if(positiveStatus||negativeStatus) { if(caseInput.pregnancyPossible===null) return halt('pregnancyPossible',true);if(caseInput.pregnancyPossible!==positiveStatus)return halt('pregnancyPossible'); }
 const testStates=reportedStates(text,'(?:urine |serum )?pregnancy test (?:is )?positive|positive (?:urine |serum )?pregnancy test');
 const negativeTest=reportedStates(text,'negative (?:urine |serum )?pregnancy test|pregnancy test (?:is )?negative').has(true);
 if(testStates.has(true)&&negativeTest || ctx.pregnancyTestResult==='negative'&&testStates.has(true)||ctx.pregnancyTestResult==='positive'&&negativeTest) return halt('earlyPregnancy.pregnancyTestResult');
 if(ctx.clinicallyStable===true&&ctx.hemodynamicInstability===true) return halt('earlyPregnancy.clinicallyStable');
 const routes=['transvaginal','transabdominal'].filter(route=>reportedStates(text,'current scan route is '+route).has(true));
 if(routes.length>1||routes.length&&ctx.ultrasoundRoute!==null&&!routes.includes(ctx.ultrasoundRoute as string)) return halt('earlyPregnancy.ultrasoundRoute');
 const pid=reportedStates(text,'pid (?:is |was )?diagnosed|diagnosed with pid|presumptive pid diagnosis');
 if(reportedStates(text,'pid (?:is |was )?not diagnosed|no presumptive pid diagnosis').has(true))pid.add(false);
 if(pid.size) {if(caseInput.pidDiagnosedOrPresumed===null)return halt('pidDiagnosedOrPresumed',true);if(pid.size>1||!pid.has(caseInput.pidDiagnosedOrPresumed))return halt('pidDiagnosedOrPresumed');}
 return null;
}
const Labels:Record<string,string>={suddenSevereAbdominalOrPelvicPain:'sudden severe abdominal or pelvic pain',shoulderPain:'shoulder pain',weakness:'weakness',dizziness:'dizziness',fainting:'fainting',heavyBleeding:'heavy bleeding',hemodynamicInstability:'clinician-reported hemodynamic instability',significantConcernAboutPainOrBleeding:'significant clinician concern about pain or bleeding'};
export function evaluateSafety(caseInput:CaseInput):Safety {
 const second=caseInput.moduleHint===Module2,ctx=context(caseInput),structured=caseInput.urgentFindings||{};
 const result:Safety={warnings:[],findings:{},halt:second?conflict2(caseInput):conflict1(caseInput)};
 if(result.halt)return result;
 const expressions:Record<string,string>=second?Policy.pregnancyPatterns:Policy.findingPatterns;
 for(const [name,expression] of Object.entries(expressions)) {
  const direct=second&&Object.hasOwn(ctx,name)?ctx[name]:structured[name];
  const observed=second?reportedStates(caseInput.additionalNotes,expression):phraseStates(caseInput.additionalNotes,expression);
  if(observed.size>1 || observed.size&&direct!==null&&direct!==undefined&&!observed.has(direct as boolean)) {result.halt=halt((second?'earlyPregnancy.':'urgentFindings.')+name,!second&&observed.size>1&&direct==null);return result;}
  result.findings[name]=typeof direct==='boolean'?direct:observed.size?[...observed][0]:null;
 }
 if(second&&ctx.clinicallyStable===true&&result.findings.hemodynamicInstability===true){result.halt=halt('earlyPregnancy.clinicallyStable');return result;}
 const compatible=['suddenSevereAbdominalOrPelvicPain','shoulderPain','weakness','dizziness','fainting'].filter(name=>result.findings[name]===true);
 if(caseInput.pregnancyPossible===true&&compatible.length) {
  const related=second?['heavyBleeding','hemodynamicInstability','significantConcernAboutPainOrBleeding'].filter(name=>result.findings[name]===true):[];
  const names=[...compatible,...related].map(name=>Labels[name]);
  const findings=names.length===1?names[0]:names.slice(0,-1).join(', ')+' and '+names.at(-1);
  result.warnings.push({ruleId:'U1',sourceTags:[second?'ACOG-ECTOPIC-FAQ155':'ACOG-ECTOPIC'],text:'Immediate emergency assessment is recommended. Possible or known pregnancy with '+findings+' requires urgent evaluation. These findings do not confirm ectopic pregnancy.'});
 }
 if(second) {
  const urgent=['heavyBleeding','hemodynamicInstability','significantConcernAboutPainOrBleeding'].filter(name=>result.findings[name]===true);
  if(urgent.length&&!result.warnings.length)result.warnings.push({ruleId:'U2',sourceTags:['NICE-NG126-2026'],text:'Immediate independent emergency assessment is recommended for '+urgent.map(name=>Labels[name]).join(', ')+'. This follows the UK early-pregnancy pathway; the cause is not established.'});
  const pain=['suddenAcutePelvicPain','severeAcutePelvicPain','worseningPelvicPain'].filter(name=>result.findings[name]===true);
  const painLabels:Record<string,string>={suddenAcutePelvicPain:'sudden pelvic pain',severeAcutePelvicPain:'severe pelvic pain',worseningPelvicPain:'worsening pelvic or abdominal pain'};
  if(!result.warnings.length&&caseInput.pregnancyPossible===true&&pain.length)result.warnings.push({ruleId:'U3',sourceTags:['NICE-NG126-2026'],text:'Prompt independent early-pregnancy assessment is recommended for '+pain.map(name=>painLabels[name]).join(', ')+'. In the UK pathway, referral urgency depends on the clinical situation. This does not establish a cause.'});
 } else {
  if(result.findings.suddenAcutePelvicPain===true||result.findings.severeAcutePelvicPain===true)result.warnings.push({ruleId:'U2',sourceTags:['ACOG-CPP'],text:Policy.warningText.U2});
  if(caseInput.pidDiagnosedOrPresumed===true) {
   const disposition=['surgicalEmergencyCannotBeExcluded','tuboOvarianAbscess','severeIllness','nauseaAndVomiting','cannotFollowOrTolerateOutpatientOralTherapy','noClinicalResponseToOralTherapy'];
   const pregnant=phraseState(caseInput.additionalNotes,'pregnancy (?:is )?confirmed|patient is pregnant');
   const temperatures:boolean[]=[];
   if(typeof structured.oralTemperatureCelsius==='number')temperatures.push(structured.oralTemperatureCelsius>38.5);
   if(typeof structured.oralTemperatureFahrenheit==='number')temperatures.push(structured.oralTemperatureFahrenheit>101);
   for(const clause of currentClauses(caseInput.additionalNotes))for(const match of clause.matchAll(/\boral temperature (?:is )?([+-]?\d+(?:\.\d+)?)\s*(?:°\s*)?(celsius|fahrenheit|c|f)\b/g)) {
    if(!pattern(Policy.assertions.Negation).test(clause.slice(0,match.index))&&!pattern(Policy.assertions.Uncertainty).test(clause.slice(0,match.index))&&!pattern(Policy.assertions.DeniedSuffix).test(clause.slice(match.index!+match[0].length))&&!pattern(Policy.assertions.UncertainSuffix).test(clause.slice(match.index!+match[0].length)))temperatures.push(Number(match[1])>(['c','celsius'].includes(match[2])?38.5:101));
   }
   if(disposition.some(name=>result.findings[name]===true)||pregnant===true||temperatures.length&&new Set(temperatures).size===1&&temperatures[0])result.warnings.push({ruleId:'U3',sourceTags:['CDC-PID'],text:Policy.warningText.U3});
  }
 }
 return result;
}
export function maternalMatches(caseInput:CaseInput):string[] {
 const text=caseInput.additionalNotes;
 if(pattern(Policy.assertions.InstructionContext).test(text||'')||caseInput.pregnancyPossible!==true)return [];
 const pregnant=reportedStates(text,'patient is pregnant|pregnancy is confirmed|current pregnancy is confirmed');
 if(pregnant.size!==1||!pregnant.has(true))return [];
 const symptoms:Record<string,boolean|null>={};
 for(const [name,expression] of Object.entries({dizziness:'dizziness|lightheadedness',fainting:'fainting|syncope|passes out|passed out'})) {
  const observed=reportedStates(text,expression),direct=caseInput.urgentFindings?.[name];
  if(observed.size>1||observed.size&&typeof direct==='boolean'&&!observed.has(direct))throw halt('additionalNotes');
  symptoms[name]=typeof direct==='boolean'?direct:observed.size?[...observed][0]:null;
 }
 const ongoing=reportedStates(text,'ongoing (?:dizziness|lightheadedness)|(?:dizziness|lightheadedness) (?:is |remains )?ongoing');
 const recurrent=reportedStates(text,'(?:dizziness|lightheadedness) (?:comes and goes|recurs) over many days');
 const transient=reportedStates(text,'(?:brief|transient) (?:dizziness|lightheadedness)');
 if(ongoing.size>1||recurrent.size>1||transient.has(true)&&(ongoing.has(true)||recurrent.has(true)))throw halt('additionalNotes');
 const matched:string[]=[];
 if(symptoms.fainting===true)matched.push('CDCFaintingCare');
 if(symptoms.dizziness===true&&(ongoing.size===1&&ongoing.has(true)||recurrent.size===1&&recurrent.has(true)))matched.push('CDCPersistentDizzinessCare');
 const unreachable=reportedStates(text,'healthcare provider cannot be reached|unable to reach a healthcare provider');
 if(matched.length&&unreachable.size===1&&unreachable.has(true))matched.push('CDCEmergencyAccess');
 return matched;
}
export function warningCoverage(caseInput:CaseInput,safety:Safety):{warnings:Warning[];claimIds:string[]}|null {
 const warnings:Warning[]=[],claimIds:string[]=[];
 for(const warning of safety.warnings) {
  if(warning.ruleId==='U1') {
   if(['suddenSevereAbdominalOrPelvicPain','shoulderPain','weakness'].some(name=>safety.findings[name]===true)) {warnings.push(warning);claimIds.push(caseInput.moduleHint===Module1?'E01':'M2EctopicEmergency');return {warnings,claimIds};}
   if(caseInput.moduleHint===Module1)return null;
   const matched=maternalMatches(caseInput);if(!matched.length)return null;
   const symptoms:string[]=[];
   if(matched.includes('CDCPersistentDizzinessCare'))symptoms.push(reportedStates(caseInput.additionalNotes,'ongoing (?:dizziness|lightheadedness)|(?:dizziness|lightheadedness) (?:is |remains )?ongoing').has(true)?'ongoing dizziness or lightheadedness':'dizziness or lightheadedness recurring over many days');
   if(matched.includes('CDCFaintingCare'))symptoms.push('current fainting');
   warnings.push({ruleId:'U1',sourceTags:matched.includes('CDCEmergencyAccess')?['CDC-MATERNAL-WARNINGS-2024','CDC-MATERNAL-WARNINGS-POSTER']:['CDC-MATERNAL-WARNINGS-2024'],text:'Seek medical care immediately. Reported current pregnancy with '+symptoms.join(' and ')+' warrants urgent assessment.'+(matched.includes('CDCEmergencyAccess')?' If a healthcare provider cannot be reached, go to the emergency department.':'')+' These findings do not establish a cause.'});
   claimIds.push(...matched);
  } else if(caseInput.moduleHint===Module2) {
   if(caseInput.pregnancyPossible!==true||weeks(caseInput)===null||weeks(caseInput)!>13)return null;
   if(warning.ruleId==='U2'&&!['hemodynamicInstability','significantConcernAboutPainOrBleeding'].some(name=>safety.findings[name]===true))return null;
   warnings.push(warning);claimIds.push(warning.ruleId==='U2'?'M2NUrgentReferral':'M2NPainAssessment');
  } else {warnings.push(warning);claimIds.push(...(warning.ruleId==='U2'?['C14']:['CdcSurgicalEmergency','CdcAbscess','CdcPregnancy','CdcSevereIllness','CdcTemperature','CdcTolerance','CdcResponse']));}
 }
 return {warnings,claimIds};
}
