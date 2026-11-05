import Catalog from './conflictAssistance.json';
import Fixture from './conflictFixture.json';

export interface ConflictSelection { contractVersion: '1'; conflictId: string; summaryVariantId: string; verificationQuestionIds: string[] }
export interface PublicConflictAssistance extends ConflictSelection { summary: string; questions: string[] }
export class ConflictAssistError extends Error { constructor() { super('Conflict assistance is unavailable.'); } }
function record(payload: unknown, keys: string[]): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== keys.length || Object.keys(payload).some(key => !keys.includes(key))) throw new ConflictAssistError();
  return payload as Record<string, unknown>;
}
/** Opaque selections cannot carry a source choice, resolution, clinical wording or new question. */
export function validateConflictSelection(payload: unknown): ConflictSelection {
  const fields = record(payload, ['contractVersion', 'conflictId', 'summaryVariantId', 'verificationQuestionIds']);
  if (fields.contractVersion !== '1' || fields.conflictId !== Fixture.id || typeof fields.summaryVariantId !== 'string' || !Object.hasOwn(Catalog.summaries, fields.summaryVariantId)) throw new ConflictAssistError();
  const questions = fields.verificationQuestionIds;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 2 || questions.some(question => typeof question !== 'string' || !Object.hasOwn(Catalog.questions, question)) || new Set(questions).size !== questions.length) throw new ConflictAssistError();
  return fields as unknown as ConflictSelection;
}
/** Server reconstruction uses repository wording only; provider strings are opaque IDs. */
export function reconstructAssistance(payload: unknown): PublicConflictAssistance {
  const selection = validateConflictSelection(payload);
  return { ...selection, summary: Catalog.summaries[selection.summaryVariantId as keyof typeof Catalog.summaries], questions: selection.verificationQuestionIds.map(id => Catalog.questions[id as keyof typeof Catalog.questions]) };
}
/** Browser verification accepts only the server's exact reconstructed public projection. */
export function readConflictAssistance(payload: unknown): PublicConflictAssistance {
  const fields = record(payload, ['contractVersion', 'conflictId', 'summaryVariantId', 'verificationQuestionIds', 'summary', 'questions']);
  const { contractVersion, conflictId, summaryVariantId, verificationQuestionIds } = fields;
  const expected = reconstructAssistance({ contractVersion, conflictId, summaryVariantId, verificationQuestionIds });
  if (fields.summary !== expected.summary || !Array.isArray(fields.questions) || JSON.stringify(fields.questions) !== JSON.stringify(expected.questions)) throw new ConflictAssistError();
  return fields as unknown as PublicConflictAssistance;
}
