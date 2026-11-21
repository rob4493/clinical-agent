import Policy from './policy.json';
import {currentClauses,reportedStates} from './assertions';
import {validateCase} from './input';
import {evaluateSafety,type Safety,type Warning} from './safety';
import {Module1,Module2} from './packages';
import {SafetyFindingLabels,type SafetyFindingCode,type FindingReport,type SafetyExplanation} from '../../shared/protectedSafetyContract';

/** Assertion-check copy only. Never changes stored/sent clinician text, global
 * rules, clinical case data, numerical thresholds or provider instructions. */
function screeningText(text:string){
 const contractions:Record<string,string>={"hasn't":'has not',"haven't":'have not',"didn't":'did not',"doesn't":'does not',"isn't":'is not',"wasn't":'was not',"weren't":'were not',"don't":'do not',"can't":'cannot',"couldn't":'could not'};
 return text.replace(/[\u2018\u2019]/g,"'").replace(/(?:^|\r?\n)[ \t]*[-*•][ \t]+/g,' and ').replace(/\b(?:hasn't|haven't|didn't|doesn't|isn't|wasn't|weren't|don't|can't|couldn't)\b/gi,word=>contractions[word.toLowerCase()])
  .replace(/\b(?:briefly\s+)?lost consciousness\b|\bfainted\b|\bpassed out\b/gi,(word:string,offset:number,whole:string)=>{
   const before=(whole.slice(0,offset).split(/[.;!,]|\b(?:now|currently)\b/i).at(-1)??''),after=whole.slice(offset+word.length);
   return /\b(?:yesterday|last night|last admission)\b/i.test(before)||/^\s+(?:yesterday|last night|last admission)\b/i.test(after)?word:'fainting';
  })
  .replace(/\bsuddenly (?:developed|experienced) severe (?:lower[ -]abdominal|abdominal) pain\b|\bsudden severe lower[ -]abdominal pain\b/gi,'sudden severe abdominal pain')
  .replace(/\bsuddenly (?:developed|experienced) severe pelvic pain\b/gi,'sudden severe pelvic pain');
}
const expressions={...Policy.findingPatterns,...Policy.pregnancyPatterns};
type Evaluated={moduleId:string;safety:Safety};
function triggered({moduleId,safety}:Evaluated):SafetyFindingCode[]{
 const codes=new Set<SafetyFindingCode>();
 for(const warning of safety.warnings){
  const names=warning.ruleId==='U1'?['suddenSevereAbdominalOrPelvicPain','shoulderPain','weakness','dizziness','fainting',...(moduleId===Module2?['heavyBleeding','hemodynamicInstability','significantConcernAboutPainOrBleeding']:[])]:warning.ruleId==='U2'?(moduleId===Module2?['heavyBleeding','hemodynamicInstability','significantConcernAboutPainOrBleeding']:['suddenAcutePelvicPain','severeAcutePelvicPain']):moduleId===Module2?['suddenAcutePelvicPain','severeAcutePelvicPain','worseningPelvicPain']:[];
  for(const name of names)if(safety.findings[name]===true)codes.add(name as SafetyFindingCode);
 }
 return [...codes];
}
function measurements(text:string):SafetyExplanation['measurements']{
 const pressures=new Map<string,{systolic:number;diastolic:number}>(),rates=new Set<number>();
 for(const clause of currentClauses(text)){
  for(const match of clause.matchAll(/\b(?:bp|blood pressure)\s*(?:is\s+|of\s+|:\s*)?(\d{1,3})\s*\/\s*(\d{1,3})(?!\d|[./]\d)(?:\s*mmhg)?\b/g))if(reportedStates(clause,match[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).has(true))pressures.set(match[1]+'/'+match[2],{systolic:Number(match[1]),diastolic:Number(match[2])});
  for(const match of clause.matchAll(/\b(?:hr|heart rate)\s*(?:is\s+|of\s+|:\s*)?(\d{1,3})(?!\d|[./]\d)(?:\s*(?:bpm|beats per minute))?\b/g))if(reportedStates(clause,match[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).has(true))rates.add(Number(match[1]));
 }
 return {...(pressures.size===1?{bloodPressure:[...pressures.values()][0]}:{}),...(rates.size===1?{heartRate:[...rates][0]}:{})};
}
/** Existing deterministic rules, confined to the already protected chat route.
 * No inference, logging or persistent clinical data. Numerical values do NOT
 * enter evaluateSafety and can never activate or resolve a warning. */
export function screenProtectedSafety(messages:readonly string[]){
 const checked=messages.map(additionalNotes=>validateCase({moduleHint:Module1,caseType:'detailed',pregnancyPossible:null,pidDiagnosedOrPresumed:null,additionalNotes}));
 const texts=messages.map(screeningText),evaluated:Evaluated[]=[],warnings=new Map<string,Warning>();let conflict=false;
 for(const narrative of [...texts,texts.join('\n')]){
  const check={...checked[0],additionalNotes:narrative},positive=reportedStates(narrative,Policy.statusPatterns.pregnancyPossible[0]).has(true),negative=reportedStates(narrative,Policy.statusPatterns.pregnancyPossible[1]).has(true);
  check.pregnancyPossible=positive&&!negative?true:negative&&!positive?false:null;
  for(const moduleId of [Module1,Module2]){const safety=evaluateSafety({...check,moduleHint:moduleId});evaluated.push({moduleId,safety});for(const warning of safety.warnings)warnings.set(warning.ruleId+'|'+warning.text,warning);if(safety.halt)conflict=true;}
 }
 // Additional historical markers only limit displayed observations; they do
 // not remove existing canonical rule warnings or change pregnancy status.
 const observationTexts=texts.map(text=>text.replace(/\b(?:yesterday|last night|last admission)\b/gi,'previously'));
 const last=observationTexts.at(-1)??'',states=observationTexts.map(text=>Object.fromEntries(Object.keys(SafetyFindingLabels).map(code=>[code,reportedStates(text,expressions[code as keyof typeof expressions])])));
 const report=(code:SafetyFindingCode):FindingReport|undefined=>states.at(-1)?.[code]?.has(true)&&states.at(-1)![code].size===1?{code,reported:'latest'}:states.slice(0,-1).some(state=>state[code]?.has(true)&&state[code].size===1)?{code,reported:'earlier'}:undefined;
 const triggerCodes=new Set(evaluated.flatMap(triggered)),triggers=[...triggerCodes].flatMap(code=>{const found=report(code);return found?[found]:[];}),supporting=(Object.keys(SafetyFindingLabels) as SafetyFindingCode[]).filter(code=>!triggerCodes.has(code)).flatMap(code=>{const found=report(code);return found?[found]:[];});
 let pregnancy:SafetyExplanation['pregnancy']='unknown';
 for(const text of messages){
  const positive=reportedStates(text,Policy.statusPatterns.pregnancyPossible[0]).has(true),negative=reportedStates(text,Policy.statusPatterns.pregnancyPossible[1]).has(true);
  if(positive||negative)pregnancy=positive&&negative?'conflicting':positive?'reportedPossibleOrKnown':'reportedNegative';
  if(currentClauses(text).some(clause=>/\bpregnancy (?:status (?:is |remains |has not been assessed and is )?)?(?:unknown|unconfirmed|not assessed|not known)\b/.test(clause)))pregnancy='unknown';
 }
 const sourceRules:SafetyExplanation['sourceRules']=[];
 for(const {moduleId,safety} of evaluated)for(const warning of safety.warnings){const rule={moduleId:moduleId as 'module_01_endo'|'module_02_early_pregnancy',ruleId:warning.ruleId as 'U1'|'U2'|'U3',sourceTags:warning.sourceTags};if(!sourceRules.some(existing=>JSON.stringify(existing)===JSON.stringify(rule)))sourceRules.push(rule);}
 const explanation:SafetyExplanation={version:'1',priority:[...warnings.values()].some(warning=>/^Immediate\b/.test(warning.text))?'emergency':warnings.size?'assessment':'clarification',triggers,supporting,pregnancy,measurements:measurements(last),sourceRules};
 return {warnings:[...warnings.values()].map(warning=>warning.text),conflict,explanation};
}
