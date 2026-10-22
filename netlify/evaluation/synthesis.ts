import Policy from './policy.json';
import { phraseState } from './assertions';
import { CaseInput } from './input';
import { Claim, Package } from './packages';
import { caseText } from './retrieval';

export interface Atom { text:string; claimIds:string[] }
export function unsupportedFindings(caseInput:CaseInput,fibroidCovered=false):boolean {
 const expression=fibroidCovered?'cyst\\w*|mass|endometrioma|tumou?r|adenomyosis':'cyst\\w*|mass|enlarged|tender|endometrioma|abnormal|fibroid\\w*|tumou?r|adenomyosis';
 return caseText(caseInput).split(/(?<!\d)[.!?](?!\d)/).some(sentence=>/ultrasound|\bmri\b|exam\w*/i.test(sentence)&&/shows?|showed|identif\w*|reveal\w*|found|demonstrat\w*/i.test(sentence)&&phraseState(sentence,expression)===true);
}
export function structuralFocus(caseInput:CaseInput,entry:Package):{claims:Claim[];atoms:Atom[]}|null {
 const text=caseText(caseInput);
 if(phraseState(text,'(?:intramural\\s+)?(?:uterine\\s+)?fibroid\\w*|leiomyoma\\w*')!==true)return null;
 const sentences=text.split(/(?<!\d)[.!?](?!\d)/),wording=new Map<string,string>();
 const size=/\b(\d{1,2}(?:\.\d{1,2})?)\s*cm\s+(intramural\s+)?(?:uterine\s+)?fibroid/i.exec(text);
 const description=size?size[1]+' cm '+(size[2]?'intramural ':''):'';
 const reported=[['tender','tenderness'],['urinary frequency|frequent urination','urinary frequency']].filter(([expression])=>phraseState(text,expression)===true).map(([,label])=>label);
 if(sentences.some(sentence=>/uterus|uterine/i.test(sentence)&&phraseState(sentence,'enlarged')===true))reported.unshift('uterine enlargement');
 wording.set('C07','Bleeding and pelvic pressure can be associated with fibroids; the reported '+description+'fibroid is therefore a relevant structural finding.');
 if(reported.length)wording.set('C07',wording.get('C07')+' Reported '+reported.join(', ')+' also need integrated review.');
 const associations=[['cycle.related (?:pelvic )?(?:pain|worsening)|cyclic(?:al)? (?:pelvic )?pain|period.related (?:pelvic )?pain|worse.*period|worse.*menstru','cycle-related worsening'],['deep dyspareunia|dyspareunia|pain.*intercourse','pain during intercourse']].filter(([expression])=>phraseState(text,expression)===true).map(([,label])=>label);
 if(associations.includes('pain during intercourse')&&phraseState(text,'deep dyspareunia|deep pain.*intercourse')===true)associations[associations.indexOf('pain during intercourse')]='deep pain during intercourse';
 if(associations.length)wording.set('C05','Reported '+associations.join(' and ')+(associations.length===1?' keeps':' keep')+' endometriosis as a separate consideration.');
 if(phraseState(text,'cyclic(?:al)? bowel|cycle.related bowel|bowel.*(?:period|menstr|cycle)')===true)wording.set('N04','The reported cyclical bowel pattern belongs in the same symptom review.');
 else if(phraseState(text,'bowel symptoms|bowel pain|painful bowel movements')===true)wording.set('C01','Reported bowel symptoms may have overlapping contributors.');
 const pedigree=text.replace(/family history|sister|mother/gi,'reported pedigree');
 if(phraseState(pedigree,'reported pedigree.*endometriosis')===true)wording.set('N07',/sister|mother|first.degree/i.test(text)?'The reported first-degree family history adds relevant context.':'Family history was reported, but its first-degree relationship needs clarification.');
 if(/ultrasound|tvus/i.test(text)) {
  const scans=sentences.filter(sentence=>/ultrasound|tvus/i.test(sentence));
  const finding=scans.some(sentence=>phraseState(sentence,'fibroid\\w*')===true&&!/planned|will|requested|awaiting/i.test(sentence));
  let scan=(finding?'The ultrasound detected a fibroid; that is not a normal ultrasound. ':'The reported ultrasound context needs precise interpretation. ')+'Ultrasound may miss smaller endometriosis lesions or adhesions.';
  if(finding&&scans.some(sentence=>/no (?:reported )?endometrioma or deep endometriosis/i.test(sentence)&&phraseState(sentence,'endometrioma|deep endometriosis')===false))scan='The ultrasound detected a fibroid but did not report an endometrioma or deep endometriosis. '+(scans.some(sentence=>/normal.appearing ovaries/i.test(sentence))?'Normal-appearing ovaries were reported. ':'')+'These partial negative findings do not make the ultrasound normal: ultrasound may miss smaller lesions or adhesions.';
  wording.set('NichdUltrasoundLimits',scan);
 }
 if(/fertil|future pregnancy|pregnancy goal/i.test(text))wording.set('WhoPriorities','Future fertility priorities and individual preferences should inform that review.');
 const points=[['bleeding|heavy.*period','bleeding pattern'],['pelvic pressure','pelvic pressure'],['persist\\w*|progress\\w*|worsen\\w*','symptom progression'],['exam\\w*|enlarged|tender','examination findings'],['bowel','bowel symptoms'],['urinary|urination','urinary symptoms'],['work|daily activities|functional impact','functional impact']].filter(([expression])=>phraseState(text,expression)===true).map(([,label])=>label);
 wording.set('CppHistory','Further review should integrate '+(points.length?'the reported '+points.join(', '):'the symptom history and missing clinical context')+'.');
 const uncertain=['C05','N04','N07'].some(id=>wording.has(id))?'These findings do not confirm endometriosis or establish the fibroid as the sole cause; ':'These findings do not establish the fibroid as the sole cause; ';
 const ids=[...wording.keys()];
 if(ids.length>8) return null;
 return {claims:ids.map(id=>entry.claims.find(claim=>claim.claimId===id)!),atoms:[{text:[...wording.values(),uncertain+'neither symptom attribution nor individual treatment can be determined from fibroid size or location alone.'].join(' '),claimIds:ids}]};
}
export function ordinaryAtoms(caseInput:CaseInput,claims:Claim[],preliminary:boolean,directClaim:string|null):Atom[] {
 const byId=new Map(claims.map(claim=>[claim.claimId,claim])),used=new Set<string>(),atoms:Atom[]=[];
 function add(ids:string[],text:string) {if(ids.every(id=>byId.has(id)&&!used.has(id))){atoms.push({text,claimIds:ids});ids.forEach(id=>used.add(id));}}
 if(preliminary)add(['N01','C01','C11'],'The reported pelvic discomfort is nonspecific. Endometriosis and overlapping urinary, bowel or musculoskeletal contributors remain considerations; the available information does not identify the cause.');
 else add(['N01','C05'],'Cycle-related pelvic pain and pain during sex keep endometriosis among the considerations, but do not confirm a diagnosis.');
 add(['C09','C10','C11'],'Urinary, bowel and musculoskeletal conditions are among the possible contributors to pelvic pain.');
 for(const claim of claims) {
  if(used.has(claim.claimId))continue;
  if(claim.claimId==='CppDefinition'&&!/\b(?:define|definition|meaning|how long|six months|6 months)\b/i.test(caseInput.additionalNotes||''))continue;
  let text=claim.supportedStatement;
  if(claim.claimId===directClaim) {
   text=(Policy.directAnswers as Record<string,string>)[directClaim];
   if(directClaim==='N22'&&/\bnormal\b/i.test(caseInput.additionalNotes||'')&&/exclude|rule out|absen/i.test(caseInput.additionalNotes||''))text='A normal CA-125 result must not be treated as proof that endometriosis is absent. CA-125 should not be used diagnostically.';
   if(directClaim==='N20'&&/exclude|rule out|absen/i.test(caseInput.additionalNotes||''))text='A normal MRI does not establish that endometriosis is absent.';
  }
  add([claim.claimId],text);
 }
 return atoms;
}
export function pregnancyAtoms(claims:Claim[]):Atom[] {
 const byId=new Map(claims.map(claim=>[claim.claimId,claim])),used=new Set<string>(),atoms:Atom[]=[];
 function add(ids:string[],text:string){if(ids.every(id=>byId.has(id)&&!used.has(id))){atoms.push({text,claimIds:ids});ids.forEach(id=>used.add(id));}}
 add(['M2NSerialLimits','M2NSymptomsOverHcg','M2NEmptyUterus'],'An empty uterus on transvaginal ultrasound does not establish ectopic pregnancy by itself. Serial serum hCG results do not locate the pregnancy; symptoms take priority over a reassuring trend, and a changed clinical picture needs review regardless of previous results. Viability must not be inferred from these results alone.');
 add(['M2NSymptoms','M2NPainAssessment'],'Pain or bleeding in early pregnancy may warrant early-pregnancy assessment, but these symptoms alone do not identify the cause or confirm ectopic pregnancy. The urgency of referral depends on the overall clinical presentation.');
 add(['M2AIndeterminateHcg','M2ASerialScope'],'A single serum hCG result does not exclude ectopic pregnancy after an indeterminate transvaginal ultrasound; the available evidence does not support generating an individualized serial-testing schedule.');
 add(['M2AIndeterminateHcg'],'A single serum hCG result does not exclude ectopic pregnancy after an indeterminate transvaginal ultrasound.');
 add(['M2NPulDefinition','M2NPulPossibility'],'With a positive pregnancy test and no intrauterine or extrauterine pregnancy seen on transvaginal ultrasound, location remains unresolved and ectopic pregnancy remains a consideration, not a confirmed diagnosis.');
 add(['M2NHcgLocation'],'A serum hCG result alone does not determine pregnancy location when it remains unresolved on the reported scan.');
 for(const claim of claims)if(!used.has(claim.claimId))add([claim.claimId],claim.supportedStatement);
 const order=new Map(claims.map((claim,index)=>[claim.claimId,index]));
 return atoms.sort((left,right)=>Math.min(...left.claimIds.map(id=>order.get(id)!))-Math.min(...right.claimIds.map(id=>order.get(id)!)));
}
