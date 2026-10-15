import type { PregnancyContext } from './api';

export default function PregnancyFields({ context, onChange }: { context: PregnancyContext; onChange: (context: PregnancyContext) => void }) {
  function selectField(key: keyof PregnancyContext, label: string, options: [string, string][]) {
    return <div key={key}><label htmlFor={key}>{label}</label><select id={key} value={String(context[key] ?? '')} onChange={event => onChange({ ...context, [key]: event.target.value || null })}><option value="">Unknown / not provided</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></div>;
  }
  function booleanField(key: keyof PregnancyContext, label: string) {
    return <div key={key}><label htmlFor={key}>{label}</label><select id={key} value={context[key] === true ? 'yes' : context[key] === false ? 'no' : ''} onChange={event => onChange({ ...context, [key]: event.target.value === '' ? null : event.target.value === 'yes' })}><option value="">Unknown / not provided</option><option value="yes">Yes</option><option value="no">No</option></select></div>;
  }
  return <details className="pregnancyContext" open><summary>Early-pregnancy test context</summary><p className="fieldHint">Record reported findings only. Missing results remain unknown.</p><div className="fieldGrid">
    <div><label htmlFor="gestationalWeeks">Reported gestation (weeks)</label><input id="gestationalWeeks" type="number" min="0" max="45" step="0.1" value={context.gestationalWeeks ?? ''} onChange={event => onChange({ ...context, gestationalWeeks: event.target.value === '' ? null : Number(event.target.value) })} /></div>
    {selectField('careSetting', 'Assessment setting', [['emergencyDepartment', 'Emergency department'], ['earlyPregnancyService', 'Early pregnancy service'], ['other', 'Other']])}
    {selectField('pregnancyTestType', 'Pregnancy test type', [['urine', 'Urine'], ['serum', 'Serum']])}
    {selectField('pregnancyTestResult', 'Pregnancy test result', [['positive', 'Positive'], ['negative', 'Negative'], ['indeterminate', 'Indeterminate']])}
    {selectField('ultrasoundRoute', 'Ultrasound route', [['transvaginal', 'Transvaginal'], ['transabdominal', 'Transabdominal']])}
    {selectField('ultrasoundFinding', 'Reported ultrasound finding', [['noPregnancyVisualized', 'No pregnancy visualized'], ['indeterminate', 'Indeterminate'], ['intrauterineReported', 'Intrauterine pregnancy reported'], ['other', 'Other finding']])}
    {booleanField('previousIntrauterinePregnancyConfirmed', 'Previously confirmed intrauterine pregnancy')}
    {booleanField('clinicallyStable', 'Clinician reports clinical stability')}
    {booleanField('assistedReproduction', 'Assisted reproduction reported')}
    {booleanField('abdominalTrauma', 'Abdominal trauma reported')}
  </div></details>;
}
