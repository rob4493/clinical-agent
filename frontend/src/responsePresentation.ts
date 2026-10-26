import CompactWording from '../../shared/summaryPresentation.json';
import Wording from '../../shared/responsePresentation.json';
import type { Review, Statement } from './api';

interface Term { term: string; explanation: string }
interface Presented { statement: Statement; claimIds: string[]; terms: Term[]; reviewed: boolean; points?: Statement[]; keyPoints?: Statement[]; next?: Statement }

/** Exact reviewed wording only. Never infer claims from keywords or shorten unknown text. */
export function presentStatement(statement: Statement, review: Review): Presented {
  const sourceIds = statement.numbers.map(number => review.sources.find(source => source.number === number)?.sourceId);
  const candidates = Wording.entries.filter(entry => entry.moduleId === review.moduleId && entry.sourceIds.every(sourceId => sourceIds.includes(sourceId)));
  function cover(position: number, selected: typeof candidates): typeof candidates | null {
    if (position === statement.text.length) return selected;
    if (selected.length >= 8) return null;
    for (const entry of candidates) {
      if (selected.includes(entry) || !statement.text.startsWith(entry.original, position)) continue;
      const end = position + entry.original.length;
      if (end !== statement.text.length && statement.text[end] !== ' ') continue;
      const result = cover(end === statement.text.length ? end : end + 1, [...selected, entry]);
      if (result) return result;
    }
    return null;
  }
  const matched = cover(0, []);
  // Require complete text and source coverage; mixed or changed wording falls back intact.
  if (!matched || sourceIds.some(sourceId => !matched.some(entry => entry.sourceIds.includes(sourceId!)))) return { statement, claimIds: [], terms: [], reviewed: false };
  function cite(entry: typeof candidates[number], text: string): Statement {
    return { text, numbers: entry.sourceIds.map(sourceId => review.sources.find(source => source.sourceId === sourceId)!.number) };
  }
  const first = matched[0];
  // The primary conclusion is separate from secondary claims; each retains its own sources.
  return { statement: cite(first, first.summary), points: matched.slice(1).flatMap(entry => entry.keyPoints.map(text => cite(entry, text))), keyPoints: matched.flatMap(entry => entry.keyPoints.map(text => cite(entry, text))),
    ...(first.nextConsideration ? { next: cite(first, first.nextConsideration) } : {}),
    claimIds: [...new Set(matched.flatMap(entry => entry.claimIds))], terms: matched.flatMap(entry => entry.terms), reviewed: true };
}

export function summarizeReview(review: Review) {
  const presented = review.considerations.map(statement => presentStatement(statement, review));
  // Limits are targets, never permission to remove a qualifier or truncate a sentence.
  const first = presented[0];
  const summary = first && first.statement.text.split(/\s+/).length <= 40 && (first.statement.text.match(/[.!?](?:\s|$)/g)?.length ?? 1) <= 2 ? first.statement : review.considerations[0];
  const points = [...(first?.points ?? []), ...presented.slice(1).flatMap(entry => entry.keyPoints ?? [entry.statement])].slice(0, 3);
  const terms = [...new Map(presented.flatMap(entry => entry.terms).map(term => [term.term, term])).values()];
  return { summary, points, next: first?.next, terms };
}

/** Only exact reviewed paragraph fingerprints permit a new display summary. */
export async function compactSummary(review: Review): Promise<Statement | undefined> {
  const first = review.considerations[0];
  if (!first || review.messages.length || review.warnings.length || !globalThis.crypto?.subtle) return;
  try {
    const sourceIds = first.numbers.map(number => review.sources.find(source => source.number === number)?.sourceId);
    if (sourceIds.some(sourceId => !sourceId) || new Set(sourceIds).size !== sourceIds.length) return;
    const candidates = CompactWording.entries.filter(entry => entry.moduleId === review.moduleId && entry.sourceIds.length === sourceIds.length && entry.sourceIds.every(sourceId => sourceIds.includes(sourceId)));
    if (!candidates.length) return;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(first.text));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const entry = candidates.find(entry => entry.statementHash === hash);
    if (entry) return { text: entry.summary, numbers: entry.sourceIds.map(sourceId => review.sources.find(source => source.sourceId === sourceId)!.number).sort((a, b) => a - b) };
  } catch { /* Retain complete original wording if native hashing is unavailable. */ }
}

/** Translate only complete, exact source-bound result atoms; never read case text here. */
export async function explainFindings(findings: import('./findingRules').FindingCard[], review: Review): Promise<import('./findingRules').FindingCard[]> {
  if (review.moduleId !== 'module_01_endo' || review.warnings.length || review.messages.length || !globalThis.crypto?.subtle) return findings;
  if (new Set(review.sources.map(source => source.sourceId)).size !== review.sources.length || new Set(review.sources.map(source => source.number)).size !== review.sources.length) return findings;
  try {
    const matched: typeof CompactWording.visualEntries = [];
    for (const statement of review.considerations) {
      const sourceIds = statement.numbers.map(number => review.sources.find(source => source.number === number)?.sourceId);
      if (sourceIds.some(sourceId => !sourceId) || new Set(sourceIds).size !== sourceIds.length) continue;
      const sentences = statement.text.split(/(?<=[.!?])\s+/);
      const spans = new Map<number, { end: number; entry: typeof matched[number] }[]>();
      for (let start = 0; start < sentences.length; start++) {
        for (let end = start + 1; end <= Math.min(sentences.length, start + 8); end++) {
          const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sentences.slice(start, end).join(' ')));
          const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
          const entry = CompactWording.visualEntries.find(entry => entry.statementHash === hash && entry.sourceIds.every(sourceId => sourceIds.includes(sourceId)));
          if (entry) spans.set(start, [...(spans.get(start) ?? []), { end, entry }]);
        }
      }
      function cover(start: number): typeof matched | undefined {
        if (start === sentences.length) return [];
        for (const span of spans.get(start) ?? []) {
          const remaining = cover(span.end);
          if (remaining) return [span.entry, ...remaining];
        }
      }
      const covered = cover(0);
      // An altered qualifier or unknown addition prevents replacement of the whole paragraph.
      if (covered && sourceIds.every(sourceId => covered.some(entry => entry.sourceIds.includes(sourceId!)))) matched.push(...covered);
    }
    return findings.map(finding => {
      if (finding.kind !== 'reported') return finding;
      const entries = [...new Map(matched.filter(entry => entry.findings.includes(finding.id)).map(entry => [entry.statementHash, entry])).values()];
      const order = ['CppPattern', 'C05', 'C01', 'C11', 'N01', 'N02', 'WhoImpact', 'CppHistory', 'N12', 'N13'];
      entries.sort((first, second) => order.indexOf(first.claimIds[0]) - order.indexOf(second.claimIds[0]));
      const paragraphs = entries.map(entry => ({ text: entry.text, numbers: entry.sourceIds.map(sourceId => review.sources.find(source => source.sourceId === sourceId)!.number).sort((a, b) => a - b) }));
      return paragraphs.length ? { ...finding, paragraphs } : finding;
    });
  } catch { return findings; }
}
