import Policy from './policy.json';
import { pattern } from './input';

const Terms=Policy.assertions;
// Share assertion scope only across a bounded list of already supported findings.
// A fresh predicate ("shoulder pain is present") starts a separate assertion.
const ListFindings=new Set(['suddenSevereAbdominalOrPelvicPain','shoulderPain','weakness','dizziness','fainting','heavyBleeding','hemodynamicInstability','worseningPelvicPain','suddenAcutePelvicPain','severeAcutePelvicPain']);
// Keep full predicates (such as "no clinical response to oral therapy") out of
// noun-list scope; their internal negation must not affect another finding.
const Finding='(?:'+[...new Set([...Object.entries(Policy.findingPatterns),...Object.entries(Policy.pregnancyPatterns)].filter(([name])=>ListFindings.has(name)).map(([,expression])=>expression))].join('|')+')';
const Separator='(?:\\s*,\\s*(?:(?:and|or)\\s+)?|\\s+(?:and|or)\\s+)';
function coordinatedLists(text:string):string {
 return text.replace(pattern('\\b'+Finding+'(?:'+Separator+Finding+')+\\b','gi'),(list:string,offset:number,whole:string)=>{
  const tail=whole.slice(offset+list.length);
  if(/^\s+(?:is|was|has|develops|began)\b/i.test(tail)||/^\s+(?:present|reported|noted|observed)\b/i.test(tail)&&! /\b(?:and|or)\b/i.test(list))return list;
  return list.replace(/,\s*(?:(?:and|or)\s+)?/g,' and ');
 });
}
function sharedSuffix(suffix:string):string {
 // Skip only the other noun phrases in the same coordinated list, so its
 // terminal assertion (e.g. "not reported") applies to every listed finding.
 return suffix.replace(pattern('^(?:\\s+(?:and|or)\\s+'+Finding+'\\b)+','i'),'').replace(/^\s*(are|were)\s+/i,(_match,verb)=>verb.toLowerCase()==='are'?' is ':' was ');
}
export function currentClauses(text:string|null|undefined):string[] {
 if(!text) return [];
 const masked=coordinatedLists(text.toLowerCase().replace(/"[^"]*"|“[^”]*”|‘[^’]*’|(?<!\w)'[^']*'/g,' ').replace(/\s+/g,' '));
 const current:string[]=[];
 for(const sentence of masked.split(/(?<!\d)\.(?!\d)|[;!]|\bbut\b|\bhowever\b/)) {
  if(pattern(Terms.InstructionContext).test(sentence)) continue;
  let excluded=false;
  for(let clause of sentence.split(/,|\band (?=(?:patient|pregnancy|pid|currently|now|no|not)\b)/)) {
   clause=clause.trim();if(/^(?:currently|now|current|patient|the patient)\b/.test(clause)) excluded=false;
   if(pattern(Terms.ExcludedContext).test(clause)) excluded=true;
   if(!excluded && !clause.includes('?') && !/["“”‘’]|(?<!\w)'/.test(clause)) current.push(clause);
  }
 }
 return current;
}
export function phraseStates(text:string|null|undefined,expression:string):Set<boolean> {
 const states=new Set<boolean>();
 for(const clause of currentClauses(text)) for(const match of clause.matchAll(pattern('\\b(?:'+expression+')\\b','gi'))) {
  const prefix=clause.slice(0,match.index),suffix=sharedSuffix(clause.slice(match.index!+match[0].length));
  if(pattern(Terms.Uncertainty).test(prefix) || pattern(Terms.UncertainSuffix).test(suffix) || /\bnot (?:absent|denied|excluded|impossible)\b/.test(suffix)) continue;
  states.add(!(pattern(Terms.Negation).test(prefix)||pattern(Terms.DeniedSuffix).test(suffix)));
 }
 return states;
}
export function phraseState(text:string|null|undefined,expression:string):boolean|null { const states=phraseStates(text,expression);return states.size===1?[...states][0]:null; }
export function reportedStates(text:string|null|undefined,expression:string):Set<boolean> {
 return phraseStates(currentClauses(text).filter(clause=>! /\b(?:uncertain|unsure|unclear|uncertainty|possibly|potential|maybe)\b/.test(clause)).join('. '),expression);
}
