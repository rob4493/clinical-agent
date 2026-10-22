import { CaseInput, context, RecordFields } from './input';
import { prescribingIntent } from '../../shared/requestIntent';
export { prescribingIntent } from '../../shared/requestIntent';

export const PrescribingNotice='Medication selection, dosing and patient-specific prescribing are outside this system’s scope.';
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
