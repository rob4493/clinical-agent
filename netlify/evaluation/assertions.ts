import Policy from './policy.json';
import { pattern } from './input';

const Terms=Policy.assertions;
export function currentClauses(text:string|null|undefined):string[] {
 if(!text) return [];
 const masked=text.toLowerCase().replace(/"[^"]*"|“[^”]*”|‘[^’]*’|(?<!\w)'[^']*'/g,' ').replace(/\s+/g,' ');
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
  const prefix=clause.slice(0,match.index),suffix=clause.slice(match.index!+match[0].length);
  if(pattern(Terms.Uncertainty).test(prefix) || pattern(Terms.UncertainSuffix).test(suffix) || /\bnot (?:absent|denied|excluded|impossible)\b/.test(suffix)) continue;
  states.add(!(pattern(Terms.Negation).test(prefix)||pattern(Terms.DeniedSuffix).test(suffix)));
 }
 return states;
}
export function phraseState(text:string|null|undefined,expression:string):boolean|null { const states=phraseStates(text,expression);return states.size===1?[...states][0]:null; }
export function reportedStates(text:string|null|undefined,expression:string):Set<boolean> {
 const symptom='(?:shoulder(?: tip)? pain|weakness|dizziness|fainting|syncope)';
 const deniedList='\\b(?:no|denies|without)\\s+'+symptom+'(?:\\s*(?:,\\s*(?:(?:and|or)\\s+)?|(?:and|or)\\s+)'+symptom+')+(?=\\s*(?:[.;!?]|$))';
 const normalized=(text||'').replace(pattern(deniedList,'gi'),match=>match.replaceAll(',',' and '));
 return phraseStates(currentClauses(normalized).filter(clause=>! /\b(?:uncertain|unsure|unclear|uncertainty|possibly|potential|maybe)\b/.test(clause)).join('. '),expression);
}
