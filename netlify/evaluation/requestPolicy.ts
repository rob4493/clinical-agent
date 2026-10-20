import { CaseInput, context, RecordFields } from './input';

export const PrescribingNotice='Medication selection, dosing and patient-specific prescribing are outside this system’s scope.';
const Prescribing=/\b(?:prescrib\w*|prescription|dos(?:e|es|ing|age)|how (?:much|many)[^.!?]{0,45}(?:take|give|tablet|pill)|(?:select|choose|best|which|recommend)[^.!?]{0,45}(?:medication|drug|treatment)|(?:start|stop|replace|switch|change|increase|decrease)[^.!?]{0,35}(?:medication|drug|treatment|therapy)|(?:treatment|medication|therapy)[^.!?]{0,25}duration|how long[^.!?]{0,40}(?:take|treat|therapy))\b/i;
const General=/\b(?:guideline|policy|publication|source)\b.*\b(?:discuss|cover|say|address)|\b(?:discuss|cover|say|address)\b.*\b(?:guideline|policy|publication|source)\b/i;
const Personal=/\b(?:patient|this case|for me|for her|for him|select|choose|write|give|start|stop|replace|switch|increase|decrease|exact|best)\b/i;
export function prescribingIntent(notes:string|null):boolean {
 const text=(notes||'').replace(/\b(?:do not|don't)\s+(?:(?:provide|give)\s+)?(?:select\s+treatment|prescribe|recommend\s+medication|provide\s+dosing|dosing)\b/gi,'');
 return text.split(/(?<=[.!?;])\s+/).some(sentence=>Prescribing.test(sentence)&&!(General.test(sentence)&&!Personal.test(sentence)));
}
// Prescribing tasks must not select unrelated evidence by keyword overlap.
export function evidenceNotes(notes:string|null):string {return (notes||'').split(/(?<=[.!?;])\s+/).filter(sentence=>!prescribingIntent(sentence)).join(' ').trim();}
export function indeterminateContext(ctx:RecordFields):boolean {
 return ctx.pregnancyTestType==='serum'&&ctx.pregnancyTestResult==='positive'&&ctx.careSetting==='emergencyDepartment'&&ctx.clinicallyStable===true&&ctx.previousIntrauterinePregnancyConfirmed===false&&ctx.assistedReproduction===false&&ctx.abdominalTrauma===false&&ctx.ultrasoundRoute==='transvaginal'&&['indeterminate','noPregnancyVisualized'].includes(ctx.ultrasoundFinding as string);
}
export function hcgClarification(caseInput:CaseInput):string|null {
 const ctx=context(caseInput),notes=caseInput.additionalNotes||'';
 if(!/\bhcg\b|serum/i.test(notes)||!['indeterminate','noPregnancyVisualized'].includes(ctx.ultrasoundFinding as string)||!(/exclude|rule out|single|one result/i.test(notes)||ctx.careSetting==='emergencyDepartment'&&/serial|schedule/i.test(notes)))return null;
 const groups:[string[],string][]=[
  [['careSetting','clinicallyStable'],'Please confirm the care setting and whether the presentation is clinically stable.'],
  [['pregnancyTestType','pregnancyTestResult','ultrasoundRoute'],'Please confirm the pregnancy test type and result, and the ultrasound route.'],
  [['previousIntrauterinePregnancyConfirmed','assistedReproduction','abdominalTrauma'],'Please clarify whether there was a previously confirmed intrauterine pregnancy, fertility treatment, or abdominal trauma.'],
 ];
 return groups.find(([names])=>names.some(name=>ctx[name]==null))?.[1]||null;
}
