import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecisionNotice, SyntheticNotice, readModules, readReview, safeUrl, requestJson } from '../src/api';
import { analysisResult } from './fixtures';

afterEach(() => { vi.unstubAllGlobals(); });

describe('same-origin preview authentication', () => {
  it.each(['/v1/modules', '/ready', '/v1/runtime', '/v1/competition/sources/NICE-NG73'])('uses browser-managed credentials only on its own API path: %s', async path => {
    const transport = vi.fn(async () => new Response('{}', { headers: { 'X-Clinical-Mode': 'competition' } }));
    vi.stubGlobal('fetch', transport);
    const controller = new AbortController();
    await requestJson(path, controller.signal);
    const [url, init] = (transport.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('/api' + path);
    const target = new URL(url, 'https://preview.example.invalid');
    expect(target.origin).toBe('https://preview.example.invalid');
    expect(target.pathname.startsWith('/api/')).toBe(true);
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal });
    expect(init.credentials).not.toBe('include');
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(init.body).toBeUndefined();
  });
  it('preserves structured POST validation and cancellation without credential-bearing headers', async () => {
    const transport = vi.fn(async () => new Response('{}', { headers: { 'X-Clinical-Mode': 'competition' } }));
    vi.stubGlobal('fetch', transport);
    const controller = new AbortController();
    const caseInput = { moduleHint: 'module_01_endo', caseType: 'brief' as const, pregnancyPossible: null, pidDiagnosedOrPresumed: null, additionalNotes: 'Synthetic pelvic discomfort.' };
    await requestJson('/v1/analyze', controller.signal, caseInput);
    const [url, init] = (transport.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('/api/v1/analyze');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal });
    expect(init.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' });
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(new Headers(init.headers).has('Cookie')).toBe(false);
    expect(JSON.parse(init.body as string)).toEqual(caseInput);
  });
  it('does not fetch after cancellation', async () => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    const controller = new AbortController(); controller.abort();
    await expect(requestJson('/ready', controller.signal)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('public response projection', () => {
  it.each(['ProviderUnavailable', 'OutsideScope'])('renders the distinct %s outcome', outcome => {
    const result = readReview(analysisResult(outcome));
    expect(result.heading).toBe(outcome === 'ProviderUnavailable' ? 'Provider unavailable' : 'Outside selected module scope');
    expect(result.considerations).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.notice).toBe(DecisionNotice);
  });
  it('accepts a server-selected synthetic notice only in authoritative synthetic mode', () => {
    const result = analysisResult();
    result.response.decisionSupportNotice = SyntheticNotice;
    result.renderedText = result.renderedText.replace(DecisionNotice, SyntheticNotice);
    expect(readReview(result, true).notice).toBe(SyntheticNotice);
    expect(() => readReview(result, false)).toThrow();
  });
  it.each(['javascript:alert(1)', 'data:text/html,<svg>', '//fictional.invalid', 'https:fictional.invalid', 'https:///fictional.invalid', 'https://name:secret@fictional.invalid', 'https://fictional.invalid/#fragment', 'https://fictional.invalid/ bad'])('rejects unsafe source link %s', link => { expect(safeUrl(link)).toBe(false); });
  it('permits exact absolute HTTP/HTTPS metadata links', () => { expect(safeUrl('https://fictional.invalid/Evidence%2FAlpha')).toBe(true); expect(safeUrl('http://fictional.invalid/source')).toBe(true); });
  it('excludes uncited sources and rejects ambiguous numbering', () => {
    const result = analysisResult(); result.sources.push({ number: 2, source: { sourceId: 'UnusedSource', title: 'Unused reference', verifiedUrl: null as unknown as string, knowledgeFile: 'private' } });
    expect(readReview(result).sources).toHaveLength(1);
    result.sources[1].number = 1; expect(() => readReview(result)).toThrow();
  });
  it('rejects HTML text and unsupported citation references without injecting HTML', () => {
    const result = analysisResult(); result.response.supportedInterpretations[0].text = '<img src=x onerror=alert(1)>';
    expect(() => readReview(result)).toThrow();
    const fabricated = analysisResult(); fabricated.response.supportedInterpretations[0].citations[0].sourceTag = 'Unknown';
    expect(() => readReview(fabricated)).toThrow();
  });
  it('requires the server-controlled fixed notice', () => {
    const result = analysisResult(); result.response.decisionSupportNotice = 'Invented notice'; expect(() => readReview(result)).toThrow();
    expect(readReview(analysisResult()).notice).toBe(DecisionNotice);
  });
  it('preserves a single bounded server question and rejects unknown rendered paragraphs', () => {
    const result = analysisResult(); result.renderedText = result.renderedText.replace('\n\nSources', '\n\nIs additional context available?\n\nSources');
    expect(readReview(result).question).toBe('Is additional context available?');
    result.renderedText = result.renderedText.replace('Is additional context available?', 'private provider instruction');
    expect(() => readReview(result)).toThrow();
  });
  it('rejects duplicate module identifiers', () => { expect(() => readModules({ modules: [{ moduleId: 'Module', displayName: 'Module', supportedCaseTypes: [] }, { moduleId: 'Module', displayName: 'Module', supportedCaseTypes: [] }] })).toThrow(); });
  it('projects bounded structured context without exposing arbitrary age text', () => {
    const original = analysisResult();
    const result = { ...original, response: { ...original.response, caseType: 'brief', reportedFacts: { ageRange: 'private internal age text', pregnancyPossible: 'Unknown', pidDiagnosedOrPresumed: 'No' } } };
    expect(readReview(result, true).context).toBe('Reported context: age range Unknown; brief case; pregnancy Unknown; PID No.');
    expect(readReview(result, true).context).not.toContain('private internal');
  });
  it('distinguishes outside scope from an evidence limitation using the existing outcome', () => {
    const result = analysisResult('EvidenceInsufficient'); result.response.message = 'Outside scope: headache cannot be reviewed by the selected module.';
    expect(readReview(result, true).heading).toBe('Outside selected module scope');
    result.response.message = 'Evidence insufficient: pelvic symptoms need applicable evidence.';
    expect(readReview(result, true).heading).toBe('Evidence insufficient or unavailable');
  });
});
