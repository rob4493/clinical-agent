/** Fixed display vocabulary, not an independent clinical decision system. */
export const SafetyFindingLabels={suddenSevereAbdominalOrPelvicPain:'Sudden severe abdominal or pelvic pain',shoulderPain:'Shoulder pain',weakness:'Weakness',dizziness:'Dizziness',fainting:'Fainting / brief loss of consciousness',heavyBleeding:'Heavy bleeding',hemodynamicInstability:'Clinician-reported haemodynamic instability',significantConcernAboutPainOrBleeding:'Significant clinician concern about pain or bleeding',suddenAcutePelvicPain:'Sudden acute pelvic pain',severeAcutePelvicPain:'Severe acute pelvic pain',worseningPelvicPain:'Worsening pelvic or abdominal pain'} as const;
export type SafetyFindingCode=keyof typeof SafetyFindingLabels;
export type FindingReport={code:SafetyFindingCode;reported:'latest'|'earlier'};
export const SafetySourceTags=['ACOG-ECTOPIC','ACOG-ECTOPIC-FAQ155','ACOG-CPP','CDC-PID','NICE-NG126-2026'] as const;
export type SafetyExplanation={version:'1';priority:'emergency'|'assessment'|'clarification';triggers:FindingReport[];supporting:FindingReport[];pregnancy:'unknown'|'reportedPossibleOrKnown'|'reportedNegative'|'conflicting';measurements:{bloodPressure?:{systolic:number;diastolic:number};heartRate?:number};sourceRules:{moduleId:'module_01_endo'|'module_02_early_pregnancy';ruleId:'U1'|'U2'|'U3';sourceTags:string[]}[]};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).every(key=>keys.includes(key));
// Three-digit transport shape only; not physiological plausibility or triage.
const integer=(value:unknown)=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=999;
export function isSafetyExplanation(value:unknown):value is SafetyExplanation{
 if(!record(value)||!exact(value,['version','priority','triggers','supporting','pregnancy','measurements','sourceRules'])||value.version!=='1'||!['emergency','assessment','clarification'].includes(String(value.priority))||!['unknown','reportedPossibleOrKnown','reportedNegative','conflicting'].includes(String(value.pregnancy)))return false;
 for(const key of ['triggers','supporting']){const findings=value[key];if(!Array.isArray(findings)||findings.length>22||!findings.every(item=>record(item)&&exact(item,['code','reported'])&&typeof item.code==='string'&&Object.hasOwn(SafetyFindingLabels,item.code)&&['latest','earlier'].includes(String(item.reported))))return false;}
 const measurements=value.measurements;if(!record(measurements)||!exact(measurements,['bloodPressure','heartRate']))return false;
 if(measurements.heartRate!==undefined&&!integer(measurements.heartRate))return false;
 if(measurements.bloodPressure!==undefined&&(!record(measurements.bloodPressure)||!exact(measurements.bloodPressure,['systolic','diastolic'])||!integer(measurements.bloodPressure.systolic)||!integer(measurements.bloodPressure.diastolic)))return false;
 return Array.isArray(value.sourceRules)&&value.sourceRules.length<=6&&value.sourceRules.every(rule=>record(rule)&&exact(rule,['moduleId','ruleId','sourceTags'])&&['module_01_endo','module_02_early_pregnancy'].includes(String(rule.moduleId))&&['U1','U2','U3'].includes(String(rule.ruleId))&&Array.isArray(rule.sourceTags)&&rule.sourceTags.length<=5&&rule.sourceTags.every(tag=>typeof tag==='string'&&(SafetySourceTags as readonly string[]).includes(tag)));
}
