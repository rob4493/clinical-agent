// @vitest-environment node
import {expect,it} from 'vitest';
import {screenProtectedSafety} from '../../netlify/evaluation/protectedSafety';
import {evaluateSafety} from '../../netlify/evaluation/safety';
import {validateCase} from '../../netlify/evaluation/input';
import {Module1,Module2} from '../../netlify/evaluation/packages';
import {isSafetyExplanation} from '../../shared/protectedSafetyContract';

const mild='Mild lower-abdominal pain. BP 118/76; HR 78. Pregnancy status unknown.';
const urgent='Now the patient suddenly developed severe lower-abdominal pain with heavy vaginal bleeding and briefly lost consciousness. BP 86/52; HR 124. Pregnancy status unknown.';
it('reproduces the old nonspecific early-pregnancy wording and missing symptom aliases',()=>{
 const old=evaluateSafety(validateCase({moduleHint:Module2,caseType:'detailed',pregnancyPossible:null,pidDiagnosedOrPresumed:null,additionalNotes:urgent}));expect(old.warnings[0].text).toContain('Immediate independent emergency assessment is recommended for heavy bleeding. This follows the UK early-pregnancy pathway');expect(old.findings.fainting).toBeNull();expect(old.findings.suddenSevereAbdominalOrPelvicPain).toBeNull();
});
it('keeps mild symptoms nonurgent and explains the subsequent halt with only reported facts',()=>{
 expect(screenProtectedSafety([mild])).toMatchObject({warnings:[],conflict:false});
 const result=screenProtectedSafety([mild,urgent]);expect(result.warnings.length).toBeGreaterThan(0);expect(result.explanation).toMatchObject({priority:'emergency',pregnancy:'unknown',triggers:[{code:'heavyBleeding',reported:'latest'}],measurements:{bloodPressure:{systolic:86,diastolic:52},heartRate:124}});expect(result.explanation.supporting).toEqual(expect.arrayContaining([{code:'suddenSevereAbdominalOrPelvicPain',reported:'latest'},{code:'fainting',reported:'latest'}]));expect(result.explanation.supporting.map(item=>item.code)).not.toContain('shoulderPain');expect(isSafetyExplanation(result.explanation)).toBe(true);
});
it.each(['fainted','briefly lost consciousness','passed out'])('recognizes ordinary loss-of-consciousness wording through the existing pregnancy gate: %s',phrase=>{
 const result=screenProtectedSafety(['Pregnancy is possible. The patient '+phrase+'.']);expect(result.warnings.some(warning=>warning.startsWith('Immediate emergency assessment'))).toBe(true);expect(result.explanation.triggers).toContainEqual({code:'fainting',reported:'latest'});
});
it.each([
 'Pregnancy is possible. No dizziness, fainted, or shoulder pain reported.',
 'Pregnancy is possible. The patient has not fainted.',
 "Pregnancy is possible. The patient hasn't fainted.",
 'Pregnancy is possible. If the patient fainted, this would be hypothetical.',
 'Pregnancy is possible. Previously the patient fainted.',
 'Pregnancy is possible. The patient fainted yesterday.',
 'Pregnancy is possible. The patient briefly lost consciousness years ago.',
 'Pregnancy is possible. Fainting is resolved.',
 'Pregnancy is possible. The patient may have fainted.',
 'Pregnancy is possible. Fainting is not confirmed.',
 'Pregnancy is possible. "The patient fainted" is quoted text.',
 'Pregnancy is possible. Mild discomfort only.'
])('never presents denied, uncertain, historical, quoted or unreported red flags as current %#',text=>{
 const result=screenProtectedSafety([text]);expect(result.warnings).toEqual([]);expect([...result.explanation.triggers,...result.explanation.supporting]).not.toContainEqual({code:'fainting',reported:'latest'});
});
it('does not let denial of one feature suppress a separately reported true warning',()=>{
 const result=screenProtectedSafety(['Pregnancy is possible. No dizziness or fainting, but shoulder pain is present.']);expect(result.warnings.length).toBeGreaterThan(0);expect(result.explanation.triggers).toContainEqual({code:'shoulderPain',reported:'latest'});expect(result.explanation.triggers.map(item=>item.code)).not.toContain('fainting');
});
it('does not classify numerical values or let them independently trigger or clear a warning',()=>{
 const result=screenProtectedSafety(['BP 86/52; HR 124. Pregnancy status unknown.']);expect(result.warnings).toEqual([]);expect(result.conflict).toBe(false);expect(result.explanation.measurements).toEqual({bloodPressure:{systolic:86,diastolic:52},heartRate:124});
 expect(screenProtectedSafety(['Heavy vaginal bleeding. BP 118/76; HR 78.']).warnings.length).toBeGreaterThan(0);
});
it.each(['Previously BP 86/52; previously HR 124.','If BP 86/52; if HR 124.','BP unknown; HR not measured.','BP 86/52.5; HR 124.5.','BP 86/52 and BP 100/70; HR 124 and HR 80.'])('omits unsupported, noncurrent or ambiguous measurements %#',text=>{expect(screenProtectedSafety([text]).explanation.measurements).toEqual({});});
it('labels a preserved earlier warning separately from current denial',()=>{
 const result=screenProtectedSafety(['Pregnancy is possible. The patient fainted.','No fainting now. Heavy bleeding is present.']);expect(result.explanation.triggers).toContainEqual({code:'fainting',reported:'earlier'});expect(result.explanation.triggers).not.toContainEqual({code:'fainting',reported:'latest'});
});
it('keeps unknown pregnancy on its own bullet from masking independently reported warning signs',()=>{
 const result=screenProtectedSafety(['- Sudden severe lower-abdominal pain\n- Heavy vaginal bleeding\n- Fainted\n- BP 86/52\n- HR 124\n- Pregnancy status unknown']);expect(result.explanation).toMatchObject({priority:'emergency',pregnancy:'unknown',triggers:[{code:'heavyBleeding',reported:'latest'}]});expect(result.explanation.supporting).toContainEqual({code:'fainting',reported:'latest'});
});
it('retains a negative introduction across an explicit bullet list',()=>{
 const result=screenProtectedSafety(['Pregnancy is possible. No reported warning signs:\n- dizziness\n- fainted\n- shoulder pain']);expect(result.warnings).toEqual([]);expect(result.explanation.triggers).toEqual([]);expect(result.explanation.supporting).toEqual([]);
});
it('rejects forged clinical explanation fields and executable values',()=>{
 const explanation=screenProtectedSafety([urgent]).explanation;for(const change of [{triggers:[{code:'<img onerror=alert(1)>',reported:'latest'}]},{measurements:{heartRate:'<script>unsafe</script>'}},{reason:'The patient is safe'},{sourceRules:[{moduleId:'untrusted',ruleId:'U2',sourceTags:['untrusted']}]}])expect(isSafetyExplanation({...explanation,...change})).toBe(false);
});
it.each([
 'Pregnancy is possible. Sudden severe abdominal pain.',
 'Pregnancy is possible. Fainting and shoulder pain.',
 'Pregnancy is confirmed after a test last night. Current shoulder pain.',
 'Heavy bleeding is present.',
 'Hemodynamic instability is reported.',
 'Severe acute pelvic pain.'
])('never drops an original rule warning when the alias pass is added %#',text=>{
 const revised=screenProtectedSafety([text]);for(const moduleHint of [Module1,Module2]){const checked=validateCase({moduleHint,caseType:'detailed',pregnancyPossible:/Pregnancy/.test(text)?true:null,pidDiagnosedOrPresumed:null,additionalNotes:text}),baseline=evaluateSafety(checked);for(const warning of baseline.warnings)expect(revised.warnings).toContain(warning.text);}
});
