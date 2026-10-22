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
