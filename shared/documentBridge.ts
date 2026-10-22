import type { CanonicalCase } from './clinicalData';
import { ClinicalDataError } from './schemaRules';

/** Human-verified reported text only. This is not document authentication or evidence approval. */
export function confirmedText(record: CanonicalCase): string[] {
  const documents = record.sourceDocuments ?? [], observations = record.clinicianInterpretations ?? [];
  if (!documents.length && !observations.length) return [];
  if (!documents.length || !observations.length || documents.some(document => document.verification !== 'clinicianVerified' || document.label !== document.id || document.mediaType !== undefined && !['application/pdf', 'text/plain'].includes(document.mediaType))) throw new ClinicalDataError();
  const referenced = new Set<string>();
  for (const observation of observations) {
    if (observation.verification !== 'clinicianVerified' || observation.interpretationSource !== 'documentExtracted' || observation.date || observation.text.state !== 'present' || !observation.text.value?.trim() || !observation.sourceSpans?.length) throw new ClinicalDataError();
    for (const span of observation.sourceSpans) {
      if (!documents.some(document => document.id === span.documentId)) throw new ClinicalDataError();
      referenced.add(span.documentId);
    }
  }
  if (documents.some(document => !referenced.has(document.id))) throw new ClinicalDataError();
  return observations.map(observation => observation.text.value!);
}
