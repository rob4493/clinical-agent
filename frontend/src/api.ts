export const DecisionNotice = 'Decision-support notice: This clinician-facing response is based solely on the approved knowledge base. It does not establish a diagnosis, replace independent clinical judgment, or provide patient-specific treatment or prescribing advice.';
export const UnexpectedMessage = 'Unable to complete this request. Please try again.';
export const DemoNotice = 'Synthetic demonstration — uses fictional test evidence and must not be used for clinical care.';
export const SyntheticNotice = 'Synthetic demonstration only; not a diagnosis, treatment selection, or substitute for clinical judgment.';
export const CompetitionNotice = 'Decision-support notice: Evidence support only; not a diagnosis, treatment selection, or substitute for clinical judgment.';
export const CompetitionBanner = 'Competition evaluation mode — clinician-facing evidence support; not for direct patient care.';
export type RuntimeMode = 'standard' | 'synthetic' | 'competition' | 'production';

export interface ClinicalModule { moduleId: string; displayName: string; supportedCaseTypes: string[] }
export interface PregnancyContext {
  gestationalWeeks?: number | null;
  careSetting?: 'emergencyDepartment' | 'earlyPregnancyService' | 'other' | null;
  pregnancyTestType?: 'urine' | 'serum' | null;
  pregnancyTestResult?: 'positive' | 'negative' | 'indeterminate' | null;
  ultrasoundRoute?: 'transvaginal' | 'transabdominal' | null;
  ultrasoundFinding?: 'noPregnancyVisualized' | 'indeterminate' | 'intrauterineReported' | 'other' | null;
  previousIntrauterinePregnancyConfirmed?: boolean | null;
  clinicallyStable?: boolean | null;
  assistedReproduction?: boolean | null;
  abdominalTrauma?: boolean | null;
}
export interface CaseInput {
  moduleHint: string; ageRange: string | null; caseType: 'brief' | 'detailed';
  pregnancyPossible: boolean | null; pidDiagnosedOrPresumed: boolean | null; additionalNotes: string;
  earlyPregnancy?: PregnancyContext;
}
export interface Source { number: number; sourceId: string; title: string; verifiedUrl: string | null; organization?: string; date?: string }
export interface Statement { text: string; numbers: number[] }
export interface Review { heading: string; warnings: Statement[]; considerations: Statement[]; messages: string[]; question: string | null; sources: Source[]; notice: string; context?: string }

function record(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(UnexpectedMessage);
  return payload as Record<string, unknown>;
}
export function plainText(payload: unknown, limit = 6000): string {
  if (typeof payload !== 'string' || !payload.trim() || payload.length > limit || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(payload)) throw new Error(UnexpectedMessage);
  return payload;
}
function array(payload: unknown, limit: number): unknown[] {
  if (!Array.isArray(payload) || payload.length > limit) throw new Error(UnexpectedMessage);
  return payload;
}
export function safeUrl(sourceUrl: string | null): boolean {
  if (!sourceUrl || !/^https?:\/\/[^/]/i.test(sourceUrl) || /\s|\\|#|[\u0000-\u001f]/.test(sourceUrl)) return false;
  try {
    const parsed = new URL(sourceUrl);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

export async function requestJson(path: string, signal: AbortSignal, caseInput?: CaseInput): Promise<{ status: number; payload: unknown; runtimeMode: RuntimeMode }> {
  signal.throwIfAborted();
  const response = await fetch('/api' + path, {
    method: caseInput ? 'POST' : 'GET', signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
    headers: caseInput ? { Accept: 'application/json', 'Content-Type': 'application/json' } : { Accept: 'application/json' },
    ...(caseInput ? { body: JSON.stringify(caseInput) } : {}),
  });
  signal.throwIfAborted();
  const runtimeMode = response.headers.get('X-Clinical-Mode') || 'standard';
  if (!['standard', 'synthetic', 'competition', 'production'].includes(runtimeMode)) throw new Error(UnexpectedMessage);
  const payload = await response.json() as unknown;
  signal.throwIfAborted();
  return { status: response.status, payload, runtimeMode: runtimeMode as RuntimeMode };
}

export function readModules(payload: unknown): ClinicalModule[] {
  const modules = array(record(payload).modules, 100);
  const identifiers = new Set<string>();
  return modules.map(entry => {
    const fields = record(entry);
    const moduleId = plainText(fields.moduleId, 64);
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(moduleId) || identifiers.has(moduleId)) throw new Error(UnexpectedMessage);
    identifiers.add(moduleId);
    return { moduleId, displayName: plainText(fields.displayName, 200),
      supportedCaseTypes: array(fields.supportedCaseTypes, 2).map(caseType => {
        if (caseType !== 'brief' && caseType !== 'detailed') throw new Error(UnexpectedMessage);
        return caseType;
      }) };
  });
}

export function isReady(payload: unknown): boolean { return record(payload).status === 'ready' && record(payload).reasonCode === 'ready'; }
export function readError(payload: unknown): string { return plainText(record(payload).detail, 500); }

/** Project public presentation fields only; never display a raw response object. */
export function readReview(payload: unknown, synthetic = false, runtimeMode: RuntimeMode = synthetic ? 'synthetic' : 'standard'): Review {
  const envelope = record(payload);
  const outcome = record(envelope.response);
  const notice = plainText(outcome.decisionSupportNotice, 1000);
  if (runtimeMode === 'competition' ? notice !== CompetitionNotice : notice !== DecisionNotice && !(synthetic && notice === SyntheticNotice)) throw new Error(UnexpectedMessage);
  const sourceNumbers = new Set<number>();
  const sourceIds = new Set<string>();
  const sources = array(envelope.sources, 32).map(entry => {
    const cited = record(entry);
    const metadata = record(cited.source);
    const number = cited.number;
    const sourceId = plainText(metadata.sourceId, 64);
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 32 || sourceNumbers.has(number) || sourceIds.has(sourceId)) throw new Error(UnexpectedMessage);
    sourceNumbers.add(number); sourceIds.add(sourceId);
    if (metadata.verifiedUrl !== null && typeof metadata.verifiedUrl !== 'string') throw new Error(UnexpectedMessage);
    const organization = metadata.organization == null ? undefined : plainText(metadata.organization, 500);
    const date = metadata.publicationDate ?? metadata.reviewDate;
    return { number, sourceId, title: plainText(metadata.title, 500), verifiedUrl: metadata.verifiedUrl as string | null,
      ...(organization ? { organization } : {}), ...(date == null ? {} : { date: plainText(date, 200) }) };
  });
  const citedIds = new Set<string>();
  function citationNumbers(tags: string[], required: boolean): number[] {
    return [...new Set(tags)].flatMap(tag => {
      const source = sources.find(candidate => candidate.sourceId === tag);
      if (!source) { if (required) throw new Error(UnexpectedMessage); return []; }
      citedIds.add(tag);
      return [source.number];
    });
  }
  const warnings = array(envelope.warnings, 3).map(entry => {
    const warning = record(entry);
    return { text: plainText(warning.text, 2000), numbers: citationNumbers(array(warning.sourceTags, 32).map(tag => plainText(tag, 64)), false) };
  });
  const considerations: Statement[] = [];
  const messages: string[] = [];
  let question: string | null = null;
  let heading: string;
  let context: string | undefined;
  switch (outcome.responseType) {
    case 'AgentResponse': {
      heading = synthetic ? warnings.length ? 'Essential uncertainty' : 'Clinical considerations' : 'Evidence-supported considerations';
      if (synthetic && outcome.reportedFacts) {
        const facts = record(outcome.reportedFacts);
        const ageText = plainText(facts.ageRange, 200);
        const age = ['Under 18', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'Unknown'].includes(ageText) ? ageText : 'Unknown';
        const pregnancy = plainText(facts.pregnancyPossible, 10);
        const pid = plainText(facts.pidDiagnosedOrPresumed, 10);
        if (!['Yes', 'No', 'Unknown'].includes(pregnancy) || !['Yes', 'No', 'Unknown'].includes(pid) || !['brief', 'detailed'].includes(outcome.caseType as string)) throw new Error(UnexpectedMessage);
        context = `Reported context: age range ${age}; ${outcome.caseType} case; pregnancy ${pregnancy}; PID ${pid}.`;
      }
      for (const entry of array(outcome.supportedInterpretations, 3)) {
        const consideration = record(entry);
        const tags = array(consideration.citations, 32).map(citation => plainText(record(citation).sourceTag, 64));
        if (!tags.length) throw new Error(UnexpectedMessage);
        considerations.push({ text: plainText(consideration.text), numbers: citationNumbers(tags, true) });
      }
      if (!considerations.length && !warnings.length) throw new Error(UnexpectedMessage);
      // The existing envelope carries its optional trusted question only in renderedText.
      // Recognize the exact known body first; never display arbitrary leftover paragraphs.
      if (typeof envelope.renderedText !== 'string' || !envelope.renderedText.endsWith(notice)) throw new Error(UnexpectedMessage);
      const paragraphs = envelope.renderedText.split('\n\n');
      const body = paragraphs.slice(0, paragraphs.includes('Sources') ? paragraphs.indexOf('Sources') : paragraphs.length - 1);
      const expected = [...warnings, ...considerations].map(statement => statement.text + (statement.numbers.length ? ' [' + statement.numbers.join(',') + ']' : ''));
      if (body.slice(0, expected.length).some((paragraph, index) => paragraph !== expected[index]) || body.length < expected.length) throw new Error(UnexpectedMessage);
      const remaining = body.slice(expected.length);
      if (remaining.length > 1) throw new Error(UnexpectedMessage);
      if (remaining.length) {
        question = plainText(remaining[0], 200);
        if (!question.endsWith('?') || question.split('?').length !== 2) throw new Error(UnexpectedMessage);
      }
      break;
    }
    case 'DataConflict': heading = 'Resolve conflicting information'; messages.push(plainText(outcome.conflictDescription), plainText(outcome.clarificationRequest)); break;
    case 'ClarificationRequired': heading = 'Clarification required'; messages.push(plainText(outcome.clarificationRequest)); break;
    case 'EvidenceInsufficient': heading = synthetic && plainText(outcome.message).startsWith('Outside scope:') ? 'Outside selected module scope' : 'Evidence insufficient or unavailable'; messages.push(synthetic && plainText(outcome.message).includes('approved knowledge base') ? 'Evidence is insufficient for this request.' : plainText(outcome.message)); break;
    case 'ModuleUnavailable': heading = 'Module unavailable'; messages.push(plainText(outcome.message)); break;
    case 'ProviderUnavailable': heading = 'Provider unavailable'; messages.push(plainText(outcome.message)); break;
    case 'OutsideScope': heading = 'Outside selected module scope'; messages.push(plainText(outcome.message)); break;
    case 'SelectModuleRequired': heading = 'Select a clinical module'; messages.push(plainText(outcome.message)); break;
    default: throw new Error(UnexpectedMessage);
  }
  // Validate the wire notice first; the authoritative response mode controls this display-only notice.
  return { heading, warnings, considerations, messages, question, sources: sources.filter(source => citedIds.has(source.sourceId)), notice: synthetic ? SyntheticNotice : notice, ...(context ? { context } : {}) };
}
