import type { CanonicalCase, LegacyCase } from '../../../shared/clinicalData';
import { canonicalToLegacy, legacyToCanonical } from '../../../shared/caseBridge';
import { prescribingIntent } from '../../../shared/requestIntent';
import { DocumentError } from './types';
import type { Candidate } from './types';

export interface ConfirmedDocument { id: string; format: 'pdf' | 'docx' | 'txt' }
export interface UploadSession { blocked: boolean; documents: ConfirmedDocument[]; candidates: Candidate[] }
export const EmptySession: UploadSession = { blocked: false, documents: [], candidates: [] };
export function analysisRequest(legacy: LegacyCase, session: UploadSession): LegacyCase | CanonicalCase {
  if (session.blocked) throw new DocumentError('Review and confirm uploaded information before analysis.');
  if (!session.documents.length) return legacy;
  if (!session.candidates.length || session.candidates.some(candidate => candidate.verification !== 'clinicianVerified')) throw new DocumentError();
  const canonical = legacyToCanonical(legacy);
  canonical.sourceDocuments = session.documents.map(document => ({ id: document.id, label: document.id, verification: 'clinicianVerified', ...(document.format === 'docx' ? {} : { mediaType: document.format === 'pdf' ? 'application/pdf' as const : 'text/plain' as const }) }));
  canonical.clinicianInterpretations = session.candidates.map(candidate => ({ id: candidate.id, text: { state: 'present', value: candidate.text }, interpretationSource: 'documentExtracted', verification: candidate.verification,
    sourceSpans: [{ id: `${candidate.id}Span`, documentId: candidate.documentId, start: candidate.start, end: candidate.end, ...(candidate.page ? { page: candidate.page } : {}) }] }));
  const combined = [legacy.additionalNotes, ...session.candidates.map(candidate => candidate.text)].filter(Boolean).join('\n');
  canonical.userIntent = prescribingIntent(combined) ? { state: 'reported', requests: ['prescribingOrDosing'], origin: 'legacyBoundaryDetection' } : { state: 'notReported' };
  // The same bounded projection runs on both servers. Never truncate uploaded observations.
  try { canonicalToLegacy(canonical); } catch { throw new DocumentError('Confirmed information exceeds analysis limits or contains unsupported fields. Shorten it or discard the upload session.'); }
  return canonical;
}
