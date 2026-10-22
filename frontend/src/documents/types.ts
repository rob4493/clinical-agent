export const UploadLimits = Object.freeze({ fileBytes: 1_000_000, totalBytes: 2_000_000, files: 3, pages: 20, text: 16_000, entries: 128, expandedBytes: 4_000_000, entryBytes: 1_000_000, ratio: 100, milliseconds: 10_000, candidates: 16 });
export const ReadableMessage = 'This document does not contain readable text. Scanned or image-only documents are not supported yet.';
export const UploadMessage = 'Unable to read this document safely. Check the supported format and processing limits.';
export class DocumentError extends Error { constructor(message = UploadMessage) { super(message); } }
export interface TextPart { text: string; start: number; end: number; page?: number; paragraph?: number }
export interface ParsedDocument { format: 'pdf' | 'docx' | 'txt'; text: string; parts: TextPart[]; pageCount?: number }
export interface IdentifierWarning { category: string; start: number; end: number }
export interface Candidate { id: string; documentId: string; text: string; excerpt: string; start: number; end: number; page?: number; paragraph?: number; verification: 'unverified' | 'clinicianVerified'; confidence: null }
export function checkUpload(name: string, mime: string, size: number): ParsedDocument['format'] {
  if (!size || size > UploadLimits.fileBytes || name.length > 120 || /[\\/\u0000-\u001f]/.test(name)) throw new DocumentError();
  const extension = name.split('.').pop()?.toLowerCase();
  const formats = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain' };
  if (!extension || !Object.hasOwn(formats, extension) || mime && mime !== formats[extension as keyof typeof formats]) throw new DocumentError();
  return extension as ParsedDocument['format'];
}
