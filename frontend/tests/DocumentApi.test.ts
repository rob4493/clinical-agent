// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { strToU8 } from 'fflate';
import evaluate from '../../netlify/functions/evaluate';
import { analysisRequest } from '../src/documents/session';
import { parseSimple } from '../src/documents/parser';
import { extractCandidates } from '../src/documents/review';
import { canonicalToLegacy } from '../../shared/caseBridge';

function confirmed(moduleHint: string, text: string) {
  return analysisRequest({ moduleHint, additionalNotes: '', pregnancyPossible: true }, { blocked: false, documents: [{ id: 'DocumentA', format: 'txt' }], candidates: extractCandidates(parseSimple(strToU8(text), 'txt'), 'DocumentA').map(candidate => ({ ...candidate, verification: 'clinicianVerified' })) });
}
function analyze(payload: unknown) { return evaluate(new Request('http://localhost/api/v1/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })); }
for (const moduleId of ['module_01_endo', 'module_02_early_pregnancy']) it('confirmed document preserves urgent and prescribing boundaries ' + moduleId, async () => {
  const payload = confirmed(moduleId, 'Shoulder pain and weakness. Give the exact dose.');
  const uploaded = await analyze(payload), legacy = await analyze(canonicalToLegacy(payload));
  expect(uploaded.status).toBe(200); const result = await uploaded.json(); expect(result).toEqual(await legacy.json());
  expect(result.warnings.length).toBeGreaterThan(0); expect(result.renderedText.startsWith(result.warnings[0].text)).toBe(true);
});
it('rejects unconfirmed and privacy-bearing candidates without logging or network', async () => {
  const fetch = vi.fn(() => { throw new Error('No external transport permitted'); }); vi.stubGlobal('fetch', fetch);
  const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
  const payload = confirmed('module_01_endo', 'Email: synthetic@example.test');
  let response = await analyze(payload); expect(response.status).toBe(422); expect(await response.text()).not.toContain('synthetic@example.test');
  if ('clinicianInterpretations' in payload) payload.clinicianInterpretations![0].verification = 'unverified';
  response = await analyze(payload); expect(response.status).toBe(422);
  if ('clinicianInterpretations' in payload) { payload.clinicianInterpretations![0].verification = 'clinicianVerified'; payload.sourceDocuments![0].mediaType = 'image/png'; }
  response = await analyze(payload); expect(response.status).toBe(422);
  expect(fetch).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
});
it('isolates concurrent confirmed cases and cancellation without retaining data', async () => {
  const [first, second] = await Promise.all([analyze(confirmed('module_01_endo', 'Normal MRI. Does this exclude endometriosis?')), analyze(confirmed('module_01_endo', 'Give the exact dose and medication.'))]);
  expect((await first.json()).renderedText).toContain('does not establish'); expect((await second.json()).renderedText).toMatch(/^Medication selection/);
  const controller = new AbortController(); controller.abort();
  const cancelled = await evaluate(new Request('http://localhost/api/v1/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(confirmed('module_01_endo', 'Normal MRI.')), signal: controller.signal }));
  expect(cancelled.status).toBe(499); expect(await cancelled.text()).toBe('');
});
