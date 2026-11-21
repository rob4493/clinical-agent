import {loadPackages} from './packages';
import {discussionSource} from '../../shared/discussionSources';

// Relevance only, never evidence entailment or a patient/module classification.
// Require an explicit topic in this answer; history and prompts are not inputs.
const Topics:[string,RegExp][]=[
 ['WHO-2025',/\bendometriosis\b/i],
 ['NICHD-DX',/\bendometriosis\b/i],
 ['CDC-PID',/\bpelvic inflammatory disease\b/i],
 ['NICE-NG126-2026',/\b(?:ectopic pregnancy|miscarriage|early pregnancy)\b/i],
 ['CDC-MATERNAL-WARNINGS-2024',/\b(?:urgent maternal warning signs|maternal warning signs)\b/i]
];
export function selectDiscussionSources(answer:string):string[]{
 try{
  const records=loadPackages().flatMap(pkg=>pkg.sources);
  // URL/code text is not a clinical topic merely because its path contains one.
  const topicText=answer.replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/[^\s<>)]*/gi,' ');
  return Topics.filter(([id,topic])=>topic.test(topicText)&&(id!=='NICHD-DX'||/\bdiagnos(?:is|e|ed|ing|tic)\b/i.test(topicText))).map(([id])=>id).filter(id=>{
   const expected=discussionSource(id),record=records.find(source=>source.sourceId===id);
   return !!expected&&record?.urlVerificationStatus==='verifiedOfficialRetrieval'&&record.officialUrl===expected.officialUrl;
  }).slice(0,4);
 }catch{return [];}// Unavailable reading must not suppress an otherwise valid answer.
}
