import type { CanonicalCase, LegacyCase, ReportedContext } from '../../shared/clinicalData';
import { canonicalToLegacy, legacyToCanonical } from '../../shared/caseBridge';
import type { Review } from './api';
import { presentStatement } from './responsePresentation';
import Wording from '../../shared/responsePresentation.json';

export type FindingId = 'pelvicPain' | 'sexualPain' | 'generalReview';
export interface FindingCard { id: FindingId; label: string; reported: string; numbers: number[]; kind: 'reported' | 'discussion'; paragraphs?: import('./api').Statement[] }
interface VisualCoverage { claimIds: readonly string[]; sourceIds: readonly string[]; original: string }
interface FindingRule extends Omit<FindingCard, 'numbers' | 'kind'> { field: keyof ReportedContext; accepted: readonly string[]; claimIds: readonly string[]; sourceIds: readonly string[]; phrases: string; alternativeCoverage?: readonly VisualCoverage[] }
type TopicState = 'present' | 'excluded' | 'notReported';

/** These rules label reported discussion topics only, never clinical facts or safety decisions. */
export const FindingRules: readonly FindingRule[] = [
  { id: 'pelvicPain', label: 'Pelvic pain or discomfort', field: 'painLocation', accepted: ['pelvic pain', 'pelvic'], claimIds: ['N01', 'C05'], sourceIds: ['NICE-NG73', 'ACOG-CPP'], alternativeCoverage: [{ claimIds: ['N01', 'C01', 'C11'], sourceIds: ['NICE-NG73', 'ACOG-CPP'], original: 'The reported pelvic discomfort is nonspecific. Endometriosis and overlapping urinary, bowel or musculoskeletal contributors remain considerations; the available information does not identify the cause.' }], phrases: '(?:pelvic (?:pain|discomfort)|lower abdominal(?:[ /-]+pelvic| and pelvic) pain|(?:severe )?menstrual cramps|(?:severe )?period cramps|dysmenorrhea)', reported: 'Pelvic pain or discomfort was reported.' },
  { id: 'sexualPain', label: 'Pain during sex', field: 'sexualPain', accepted: ['pain during sex', 'dyspareunia'], claimIds: ['N01', 'C05'], sourceIds: ['NICE-NG73', 'ACOG-CPP'], phrases: '(?:pain during (?:sex|intercourse)|painful (?:sex|intercourse)|(?:deep )?dyspareunia|deep pain (?:with|during) (?:sex|intercourse))', reported: 'Pain during sex was reported.' },
];

const ExcludedContext = /\b(?:no|not|never|denies?|denied|without|absent|resolved|negative|uncertain|unclear|unsure|unknown|possible|possibly|potential|maybe|may|might|could|can|would|should|will|when|suspected|hypothetical|if|whether|previous|previously|prior|historical|history|formerly|past|ago|last year|used to|sister|mother|family|someone|example|sample|definition|define|term|word|keyword|glossary|chapter|topic|people|women|patients|generally|typically|common|literature|guideline|article|ignore|override|instruction|pretend|display|activate|icon)\b|free of|ruled out|\b(?:isn|wasn|doesn|didn|hasn|haven|don|can|wouldn)[’']t\b|[?"“”‘’]|(?<!\w)'/i;
const ReportStart = /^(?:(?:the )?(?:patient|person|individual|she|they|he)\s+(?:(?:currently|also)\s+)?(?:reports?|describes?|has|experiences?|presents with)|(?:reports?|reported|experiencing|having|presents with)|(?:current )?symptoms include|\d{1,3}[- ]year[- ]old(?: patient| person)? (?:with|reports?|has))\s+/i;
const Modifiers = /^(?:(?:current|currently|ongoing|recurrent|persistent|intermittent|cyclic|cyclical|cycle-related|period-related|severe|mild|moderate|chronic|sudden|acute|deep|worsening)\s+)*/i;

/** Bounded affirmative report grammar; one excluded occurrence suppresses that topic everywhere. */
export function narrativeTopic(narrative: string, rule: typeof FindingRules[number]): TopicState {
  let present = false;
  const phrase = new RegExp('\\b' + rule.phrases + '\\b', 'i');
  for (const sentence of narrative.replace(/[–—]/g, '-').split(/[.!;\n]/)) {
    for (const segment of sentence.split(/\bbut\b|\bhowever\b/i)) {
      let excludedList = false;
      for (const clause of segment.split(/,|\band\b/i)) {
        const trimmed = clause.trim();
        if (ReportStart.test(trimmed) || /^(?:currently|now|current)\b/i.test(trimmed)) excludedList = false;
        if (ExcludedContext.test(clause)) excludedList = true;
        if (!phrase.test(clause)) continue;
        if (excludedList) return 'excluded';
        const report = trimmed.replace(ReportStart, '').replace(Modifiers, '');
        const affirmative = new RegExp('^' + rule.phrases + '\\b', 'i').exec(report);
        if (!affirmative) return 'excluded';
        const remainder = report.slice(affirmative[0].length).trim();
        // Only reviewed report continuations are accepted; a glossary heading or
        // unanchored date is not evidence that a symptom is currently reported.
        if (remainder && !/^(?:over|for|since|during|with|throughout|lasting|affecting|associated with)\b|^is (?:present|reported|ongoing|persistent|recurrent|severe|mild|moderate|intermittent|constant|worse|worsening|cyclic|cyclical)\b|^\d{1,2}\s*\/\s*10\b/i.test(remainder)) return 'excluded';
        present = true;
      }
    }
  }
  return present ? 'present' : 'notReported';
}

export function successfulReview(review: Review): boolean {
  return !review.messages.length && (review.considerations.length > 0 || review.warnings.length > 0 && ['Evidence-supported considerations', 'Clinical considerations', 'Essential uncertainty'].includes(review.heading));
}

export function neutralFindings(review: Review): FindingCard[] {
  if (!successfulReview(review)) return [];
  return [{ id: 'generalReview', kind: 'discussion', label: review.warnings.length ? 'Urgent safety review' : 'General pelvic health review', reported: review.warnings.length ? 'Read the urgent warning above first.' : 'This case has been reviewed, but no specific visual symptom category has been identified.', numbers: [] }];
}

function compatibleNumbers(review: Review, rule: typeof FindingRules[number]): number[] | null {
  for (const statement of review.considerations) {
    if (new Set(statement.numbers).size !== statement.numbers.length || statement.numbers.some(number => !review.sources.some(source => source.number === number))) continue;
    if (!rule.sourceIds.every(sourceId => statement.numbers.some(number => review.sources.some(source => source.number === number && source.sourceId === sourceId)))) continue;
    const presented = presentStatement(statement, review);
    if (presented.reviewed && rule.claimIds.every(claimId => presented.claimIds.includes(claimId))) return [...statement.numbers].sort((a, b) => a - b);
    // Existing deterministic engines group complete reviewed atoms with other evidence.
    // Recognize the intact discussion sentence, not isolated symptom words or new claims.
    if (/\b(?:ignore|override|instructions|confirms a diagnosis|confirmed diagnosis|definitely|you have)\b/i.test(statement.text)) continue;
    const sentences = statement.text.split(/(?<=[.!?])\s+/);
    const atom = Wording.entries.find(entry => entry.moduleId === review.moduleId && rule.claimIds.every(claimId => entry.claimIds.includes(claimId)));
    if (atom && sentences.includes(atom.original)) return [...statement.numbers].sort((a, b) => a - b);
    if (rule.alternativeCoverage?.some(coverage => statement.text.startsWith(coverage.original) && coverage.sourceIds.every(sourceId => statement.numbers.some(number => review.sources.some(source => source.number === number && source.sourceId === sourceId))))) return [...statement.numbers].sort((a, b) => a - b);
  }
  return null;
}

export function visualFindings(caseInput: LegacyCase | CanonicalCase, review: Review): FindingCard[] {
  const fallback = neutralFindings(review);
  if (!successfulReview(review) || review.warnings.length) return fallback;
  try {
    const canonical = 'schemaVersion' in caseInput ? (canonicalToLegacy(caseInput), caseInput) : legacyToCanonical(caseInput);
    if (canonical.moduleId !== 'module_01_endo' || review.moduleId !== canonical.moduleId) return fallback;
    if (new Set(review.sources.map(source => source.sourceId)).size !== review.sources.length || new Set(review.sources.map(source => source.number)).size !== review.sources.length) return fallback;
    // Only the physician-entered narrative is classified. Upload candidates/spans are never read.
    const narrative = canonical.originalNarrative.state === 'present' ? canonical.originalNarrative.value ?? '' : '';
    const findings = FindingRules.flatMap(rule => {
      const state = narrativeTopic(narrative, rule);
      const report = canonical.reportedContext?.[rule.field];
      const structured = typeof report === 'string' && rule.accepted.includes(report);
      // An explicit incompatible structured report also vetoes narrative activation.
      if (state === 'excluded' || report != null && !structured || !structured && state !== 'present') return [];
      const numbers = compatibleNumbers(review, rule);
      if (!numbers) return [];
      return [{ id: rule.id, label: rule.label, reported: rule.reported, numbers, kind: 'reported' as const }];
    });
    return findings.length ? findings : fallback;
  } catch { return fallback; }
}

// Fingerprints bind unchanged project-authored claim sentences, never source documents.
export const VisualClaimCoverage = [
  {
    "findingId": "pelvicPain",
    "claimId": "N01",
    "sourceId": "NICE-NG73",
    "statementHash": "4cbdb13c41563bba702977b2bbf3479c92b468564b656a5cf418cf7294d536d8"
  },
  {
    "findingId": "pelvicPain",
    "claimId": "C05",
    "sourceId": "ACOG-CPP",
    "statementHash": "7aff5303a66fe48df07cede1ef134d08c6f318c44673d023edacb38378cb0a16"
  },
  {
    "findingId": "sexualPain",
    "claimId": "C05",
    "sourceId": "ACOG-CPP",
    "statementHash": "7aff5303a66fe48df07cede1ef134d08c6f318c44673d023edacb38378cb0a16"
  }
] as const;

/** Recognize source-bound direct claim sentences without shipping server evidence text. */
export async function resolveVisualFindings(caseInput: LegacyCase | CanonicalCase, review: Review): Promise<FindingCard[]> {
  const initial = visualFindings(caseInput, review);
  if (!successfulReview(review) || review.warnings.length) return initial;
  try {
    const canonical = 'schemaVersion' in caseInput ? (canonicalToLegacy(caseInput), caseInput) : legacyToCanonical(caseInput);
    if (canonical.moduleId !== 'module_01_endo' || review.moduleId !== canonical.moduleId || !globalThis.crypto?.subtle) return initial;
    if (new Set(review.sources.map(source => source.sourceId)).size !== review.sources.length || new Set(review.sources.map(source => source.number)).size !== review.sources.length) return initial;
    const narrative = canonical.originalNarrative.state === 'present' ? canonical.originalNarrative.value ?? '' : '';
    const found = initial.filter(finding => finding.kind === 'reported');
    const digests = new Map<string, Promise<string>>();
    function fingerprint(sentence: string): Promise<string> {
      let digest = digests.get(sentence);
      if (!digest) {
        digest = crypto.subtle.digest('SHA-256', new TextEncoder().encode(sentence)).then(buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
        digests.set(sentence, digest);
      }
      return digest;
    }
    for (const rule of FindingRules) {
      if (found.some(finding => finding.id === rule.id)) continue;
      const state = narrativeTopic(narrative, rule), report = canonical.reportedContext?.[rule.field];
      const structured = typeof report === 'string' && rule.accepted.includes(report);
      if (state === 'excluded' || report != null && !structured || !structured && state !== 'present') continue;
      for (const statement of review.considerations) {
        if (new Set(statement.numbers).size !== statement.numbers.length || statement.numbers.some(number => !review.sources.some(source => source.number === number))) continue;
        if (/\b(?:ignore|override|instructions|confirms a diagnosis|confirmed diagnosis|definitely|you have)\b/i.test(statement.text)) continue;
        const eligible = VisualClaimCoverage.filter(coverage => coverage.findingId === rule.id && statement.numbers.some(number => review.sources.some(source => source.number === number && source.sourceId === coverage.sourceId)));
        let covered = false;
        for (const sentence of statement.text.split(/(?<=[.!?])\s+/)) {
          const hash = await fingerprint(sentence);
          if (eligible.some(coverage => coverage.statementHash === hash)) { covered = true; break; }
        }
        if (covered) {
          found.push({ id: rule.id, label: rule.label, reported: rule.reported, numbers: [...statement.numbers].sort((a, b) => a - b), kind: 'reported' });
          break;
        }
      }
    }
    return found.length ? FindingRules.flatMap(rule => found.filter(finding => finding.id === rule.id)) : initial;
  } catch { return initial; }
}
