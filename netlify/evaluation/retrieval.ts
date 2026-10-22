import Policy from './policy.json';
import { indeterminateContext } from './requestPolicy';
import { currentClauses, phraseState, reportedStates } from './assertions';
import { CaseInput, context, pattern, weeks } from './input';
import { Claim, Package } from './packages';

export function caseText(caseInput:CaseInput):string { return Object.entries(caseInput).filter(([name,field])=>field!==null&&!['moduleHint','caseType','ageRange','pregnancyPossible','pidDiagnosedOrPresumed','urgentFindings','earlyPregnancy'].includes(name)).map(([,field])=>String(field)).join(' ').toLowerCase(); }
function topics(text:string):Set<string> { return new Set(Object.entries(Policy.topicPatterns).filter(([,expression])=>pattern(expression).test(text)).map(([topic])=>topic)); }
export function nonspecific(caseInput:CaseInput):boolean {
 const text=caseText(caseInput),selected=topics(text);
 return selected.has('pelvic')&&[...selected].every(topic=>['pelvic','pattern','history','recurrence','impact'].includes(topic))&&caseInput.pidDiagnosedOrPresumed!==true&&!Object.values(caseInput.urgentFindings||{}).includes(true)&&!/referr|treatment|procedure|laparosc|examin|test|diagnos|definition|define|how long|six months|6 months|diary|journal|comprehensive|complete review|full review|differential/.test(text);
}
export function retrieve1(caseInput:CaseInput,entry:Package):Claim[] {
 const byId=new Map(entry.claims.map(claim=>[claim.claimId,claim]));
 if(nonspecific(caseInput)) {
  const ids=['N01','C01','C11'];
  const recurrence=(caseInput.additionalNotes||'').replace(/\b(?:previous|prior)\s+surgery\b/gi,'surgery');
  if(phraseState(recurrence,'recurr\\w*|returned|returning')===true&&/surgery|treatment/i.test(recurrence))ids.push('WhoRecurrence');
  return ids.map(id=>byId.get(id)!);
 }
 let text=caseText(caseInput);
 const findings:Record<string,string>={suddenSevereAbdominalOrPelvicPain:'sudden severe pelvic pain',suddenAcutePelvicPain:'sudden acute pelvic pain',severeAcutePelvicPain:'severe acute pelvic pain',shoulderPain:'shoulder pain',weakness:'weakness',dizziness:'dizziness',fainting:'fainting'};
 const positive=Object.entries(findings).filter(([name])=>caseInput.urgentFindings?.[name]===true).map(([,phrase])=>phrase);text+=' '+positive.join(' ');
 if(!text.trim()&&caseInput.pidDiagnosedOrPresumed!==true)return [];
 const question=(caseInput.additionalNotes||'').includes('?')?(caseInput.additionalNotes||'').toLowerCase().split('?')[0]:'';
 const selected=topics(text);if(['Under 18','Under18'].includes(caseInput.ageRange||''))selected.add('adolescent');if(caseInput.pidDiagnosedOrPresumed===true)selected.add('pid');
 if(selected.has('acute')&&!positive.length&&!pattern(Policy.topicPatterns.acute).test(currentClauses(caseInput.additionalNotes).join(' ')))selected.delete('acute');
 if([...selected].every(topic=>['recurrence','impact','diary'].includes(topic)))return [];
 if(/\b(?:headache|migraine|chest pain|cough|seizure)\b/.test(text)&&!selected.has('pelvic')&&!['ultrasound','mri','ca125'].some(topic=>selected.has(topic)))return [];
 const questionTopics=topics(question),tests=['ultrasound','mri','ca125'].filter(topic=>selected.has(topic));
 const queryTokens=new Set(text.match(/[a-z]{3,}/g)||[]),ranked:{score:number;claim:Claim}[]=[];
 const topicClaims=Policy.topicClaims as Record<string,string[]>;
 const symptoms=Policy.symptomConditions as Record<string,string>;
 for(const claim of entry.claims) {
  const id=claim.claimId;
  if(['N19','N20','N21'].includes(id)&&!/\bmri\b|deep endometriosis.*(?:assess|extent)|laparosc|procedure/.test(text))continue;
  if(id==='N21'&&!/laparosc|operative|procedure/.test(text))continue;
  if(id==='N20'&&!/\bnormal (?:pelvic )?mri|\bnormal (?:transvaginal )?ultrasound|laparosc/.test(text))continue;
  if(['N25','N26','N27'].includes(id)&&!/referr|specialist|ineffective|intolerable|contraindicated/.test(text))continue;
  if(id==='N14'&&!/\bnormal (?:abdominal |pelvic )?(?:exam|examination)/.test(text))continue;
  if(id==='N18'&&!/\bnormal (?:transvaginal )?ultrasound|ultrasound.*(?:exclude|rule out)/.test(text))continue;
  if(['N02','C04'].includes(id)&&!selected.has('cycle'))continue;
  if(id==='N17'&&!/\bnormal (?:pelvic |abdominal |internal pelvic )?(?:exam|examination)/.test(text))continue;
  if(id==='N07'&&phraseState(caseInput.additionalNotes,'family history|first.degree family history')===false)continue;
  if(symptoms[id]&&phraseState(caseInput.additionalNotes,symptoms[id])===false)continue;
  if(['C08','C14'].includes(id)&&!positive.some(phrase=>phrase.includes('pain'))&&phraseState(caseInput.additionalNotes,'(?:sudden |severe )?acute pelvic pain|sudden severe pelvic pain')!==true)continue;
  if(id.startsWith('Cdc')&&caseInput.pidDiagnosedOrPresumed!==true)continue;
  if(['E01','E02'].includes(id)&&caseInput.pregnancyPossible!==true)continue;
  if(id==='N06'&&(!selected.has('fertility')||!['pelvic','cycle','bowel','urinary','intercourse'].some(topic=>selected.has(topic))))continue;
  if(id==='N16'&&!/declined|unsuitable|not suitable/.test(text))continue;
  if(['N19','N20','N21'].includes(id)&&!['ultrasound','mri'].some(topic=>selected.has(topic)))continue;
  if(tests.length) {
   const own=tests.some(topic=>topicClaims[topic].includes(id));
   if(!own&&['ultrasound','mri','ca125'].some(topic=>!tests.includes(topic)&&topicClaims[topic].includes(id)))continue;
  }
  const matched=[...selected].filter(topic=>topicClaims[topic]?.includes(id));if(!matched.length)continue;
  let score=matched.reduce((sum,topic)=>sum+(['ultrasound','mri','ca125'].includes(topic)?20:5)+(questionTopics.has(topic)?10:0),0);
  score+=Math.min(4,new Set((claim.retrievalText.toLowerCase().match(/[a-z]{3,}/g)||[]).filter(token=>queryTokens.has(token))).size);
  if(question&&(id==='N18'&&question.includes('ultrasound')&&question.includes('normal')||id==='N20'&&question.includes('mri')&&question.includes('normal')||id==='N22'&&tests.includes('ca125')))score+=100;
  ranked.push({score,claim});
 }
 return ranked.sort((left,right)=>right.score-left.score||(left.claim.claimId<right.claim.claimId?-1:1)).slice(0,8).map(result=>result.claim);
}
export function retrieve2(caseInput:CaseInput,entry:Package):Claim[] {
 const ctx=context(caseInput),text=(caseInput.additionalNotes||'').toLowerCase();
 if(weeks(caseInput)===null||weeks(caseInput)!>13||caseInput.pregnancyPossible!==true)return [];
 if(ctx.pregnancyTestResult==='negative'||/rh\b|anti.d|urine|medication|dose|threshold|cut.?off|\bcrl\b|\bmsd\b/.test(text))return [];
 const location=ctx.pregnancyTestResult==='positive'&&ctx.ultrasoundRoute==='transvaginal'&&ctx.ultrasoundFinding==='noPregnancyVisualized'&&ctx.previousIntrauterinePregnancyConfirmed===false;
 const acep=indeterminateContext(ctx)&&reportedStates(caseInput.additionalNotes,'(?:pelvic|abdominal) (?:pain|discomfort)|spotting|(?:light |vaginal )?bleeding').has(true);
 let selected:string[]=[];
 if(/\bhcg\b|serum|pregnancy location|where.*pregnancy/.test(text)) {
  const acepQuestion=/exclude|rule out|single|one result|schedule/.test(text);
  if(acepQuestion&&!acep)return [];
  if(acep&&acepQuestion)return ['M2AIndeterminateHcg','M2ASerialScope'].map(id=>entry.claims.find(claim=>claim.claimId===id)!);
  selected=location?[/serial|trend|repeat/.test(text)?'M2NSerialLimits':'M2NHcgLocation']:acep&&text.includes('serial')?['M2AIndeterminateHcg','M2ASerialScope']:acep?['M2AIndeterminateHcg']:[];
  if(location&&/new|chang|worsen|reassur|trend/.test(text))selected.push('M2NSymptomsOverHcg');
  if(location&&/ultrasound|scan/.test(text))selected.push('M2NEmptyUterus');
 } else if(/unknown location|\bpul\b/.test(text)&&location)selected=['M2NPulDefinition','M2NPulPossibility'];
 else if(/ultrasound|scan/.test(text)&&ctx.ultrasoundRoute==='transvaginal')selected=ctx.ultrasoundFinding==='noPregnancyVisualized'?['M2NEmptyUterus']:ctx.ultrasoundFinding==='indeterminate'&&/loss|miscarriage|viab/.test(text)?['M2NSingleScan']:[];
 else if(reportedStates(caseInput.additionalNotes,'(?:pelvic|abdominal) pain|spotting|(?:heavy |vaginal )?bleeding').has(true)) {
  selected=reportedStates(caseInput.additionalNotes,'(?:pelvic|abdominal) pain').has(true)?['M2NSymptoms','M2NPainAssessment']:['M2NSymptoms'];
  if(location)selected.push(...(caseInput.caseType==='detailed'?['M2NEmptyUterus','M2NHcgLocation']:['M2NPulPossibility']));
 }
 return selected.map(id=>entry.claims.find(claim=>claim.claimId===id)!);
}
