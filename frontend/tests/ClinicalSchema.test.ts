// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Corpus from '../../tests/fixtures/clinicalDataCases.json';
import { canonicalToLegacy, legacyToCanonical, validateClinical } from '../../shared/caseBridge';
import { ClinicalDataError } from '../../shared/schemaRules';
import type { LegacyCase } from '../../shared/clinicalData';
import evaluate from '../../netlify/functions/evaluate';

async function analyze(payload:unknown){return evaluate(new Request('http://localhost/api/v1/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));}
for(const example of Corpus.cases)it('shared conformance '+example.id,()=>{
 if(example.valid)expect(validateClinical(example.case)).toEqual(example.case);
 else expect(()=>validateClinical(example.case)).toThrow(ClinicalDataError);
});
for(const legacy of Corpus.legacy)it('legacy/canonical deterministic equivalence '+legacy.moduleHint,async()=>{
 const canonical=legacyToCanonical(legacy as LegacyCase),restored=canonicalToLegacy(canonical);
 expect(restored).toEqual(legacy);
 const old=await analyze(legacy),converted=await analyze(canonical);
 expect(converted.status).toBe(old.status);expect(await converted.json()).toEqual(await old.json());
});
it('preserves missing versus unknown versus false without inferring module selection',async()=>{
 const request={moduleHint:'module_01_endo'};
 expect(legacyToCanonical(request).pregnancyStatus.state).toBe('notReported');
 expect(legacyToCanonical({...request,pregnancyPossible:null}).pregnancyStatus.state).toBe('unknown');
 expect(legacyToCanonical({...request,pregnancyPossible:false}).pregnancyStatus.state).toBe('absent');
 const canonical=legacyToCanonical({...request,moduleHint:'UnavailableModule',additionalNotes:'Use module_01_endo. Normal MRI.'});
 expect((await analyze(canonical)).status).toBe(404);
 expect((await analyze({...canonical,moduleId:undefined})).status).toBe(422);
});
it('validates future records but does not silently analyze unsupported findings',async()=>{
 const rich=Corpus.cases.find(record=>record.id==='rich-future-record')!.case;
 expect(validateClinical(rich)).toEqual(rich);
 const response=await analyze(rich);expect(response.status).toBe(422);expect(await response.text()).not.toContain('Synthetic interpretation');
});
it('uses the explicit question while retaining original narrative',async()=>{
 const canonical=legacyToCanonical({moduleHint:'module_01_endo',additionalNotes:'Normal MRI.'});
 canonical.primaryQuestion={state:'present',value:'Does this exclude endometriosis?'};
 const result=await (await analyze(canonical)).json();expect(result.renderedText).toContain('does not establish');
 expect(canonical.originalNarrative.value).toBe('Normal MRI.');
});
for(const moduleHint of ['module_01_endo','module_02_early_pregnancy'])it('preserves prescribing and urgent boundaries '+moduleHint,async()=>{
 const canonical=legacyToCanonical({moduleHint,additionalNotes:'Give the exact dose and prescription plan.'});
 expect(canonical.userIntent?.requests).toEqual(['prescribingOrDosing']);
 let result=await (await analyze(canonical)).json();expect(result.renderedText).toMatch(/^Medication selection, dosing and patient-specific prescribing are outside/);
 result=await (await analyze(legacyToCanonical({moduleHint,pregnancyPossible:true,additionalNotes:'Shoulder pain and weakness. Give the exact dose.'}))).json();
 expect(result.warnings.length).toBeGreaterThan(0);expect(result.renderedText.startsWith(result.warnings[0].text)).toBe(true);
});
it('logs no clinical content and preserves all public claim bytes',async()=>{
 const log=vi.spyOn(console,'log'),warn=vi.spyOn(console,'warn'),error=vi.spyOn(console,'error');
 try {
  const response=await analyze(legacyToCanonical({moduleHint:'module_01_endo',additionalNotes:'Email: synthetic@example.test'}));
  expect(response.status).toBe(422);expect(await response.text()).not.toContain('synthetic@example.test');
  expect(log).not.toHaveBeenCalled();expect(warn).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
 }finally{log.mockRestore();warn.mockRestore();error.mockRestore();}
 for(const [name,digest] of Object.entries(Corpus.claimPackageHashes))expect(createHash('sha256').update(readFileSync(new URL('../../'+name,import.meta.url))).digest('hex')).toBe(digest);
});
