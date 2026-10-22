import type { Candidate, IdentifierWarning, ParsedDocument } from './types';
import { DocumentError, UploadLimits } from './types';

/** Warning locations only: never duplicate a possible identifier into a warning. */
export function screenIdentifiers(text: string): IdentifierWarning[] {
  const patterns: [string, RegExp][] = [
    ['Email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
    ['Phone number', /(?:\+?\d[\d ()-]{7,}\d)/g],
    ['Record or account identifier', /\b(?:MRN|medical record|insurance|account)\s*(?:number|no\.?|id|#|:)?\s*[:#]?\s*[A-Z0-9-]{4,}/gi],
    ['Possible birth date', /\b(?:DOB|date of birth|born)\s*:?\s*[^\n]{1,30}/gi],
    ['Postal address', /\b\d{1,6}\s+[A-Za-z][A-Za-z .]{1,40}\s(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr)\b/gi],
    ['Labeled person name', /\b(?:patient name|name of patient)\s*:\s*[^\n]{1,60}/gi],
  ];
  const warnings: IdentifierWarning[] = [];
  for (const [category, expression] of patterns) for (const match of text.matchAll(expression)) {
    warnings.push({ category, start: [...text.slice(0, match.index)].length, end: [...text.slice(0, match.index! + match[0].length)].length });
    if (warnings.length >= 32) return warnings;
  }
  return warnings;
}

/** Preserve complete reported wording; no clinical inference or confidence scoring. */
export function extractCandidates(parsed: ParsedDocument, documentId: string): Candidate[] {
  if (parsed.parts.length > UploadLimits.candidates || parsed.parts.some(part => [...part.text].length > 2000)) throw new DocumentError('The extracted text exceeds the review limits. Use a shorter de-identified document.');
  return parsed.parts.map((part, index) => ({ id: `${documentId}Observation${index + 1}`, documentId, text: part.text, excerpt: [...part.text].slice(0, 240).join(''), start: part.start, end: part.end,
    ...(part.page ? { page: part.page } : {}), ...(part.paragraph ? { paragraph: part.paragraph } : {}), verification: 'unverified', confidence: null }));
}
