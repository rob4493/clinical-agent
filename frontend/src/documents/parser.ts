import { unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import { DocumentError, ReadableMessage, UploadLimits } from './types';
import type { ParsedDocument, TextPart } from './types';

const Decoder = new TextDecoder('utf-8', { fatal: true });
function decode(bytes: Uint8Array): string { try { return Decoder.decode(bytes).replace(/^\uFEFF/, ''); } catch { throw new DocumentError(); } }
function usable(text: string): boolean { return !!text.trim() && !/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text); }
export function assemble(format: ParsedDocument['format'], paragraphs: {text: string; page?: number}[], pageCount?: number): ParsedDocument {
  const parts: TextPart[] = []; let text = '';
  for (const paragraph of paragraphs) {
    const content = paragraph.text.trim(); if (!content) continue;
    if (!usable(content)) throw new DocumentError();
    if (text) text += '\n';
    const start = [...text].length; text += content;
    if ([...text].length > UploadLimits.text || parts.length >= UploadLimits.candidates) throw new DocumentError();
    parts.push({ text: content, start, end: [...text].length, paragraph: parts.length + 1, ...(paragraph.page ? { page: paragraph.page } : {}) });
  }
  if (!text || !/[\p{L}\p{N}]/u.test(text)) throw new DocumentError(format === 'pdf' ? ReadableMessage : undefined);
  return { format, text, parts, ...(pageCount ? { pageCount } : {}) };
}
function crc32(bytes: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const octet of bytes) { checksum ^= octet; for (let bit = 0; bit < 8; bit++) checksum = checksum >>> 1 ^ (checksum & 1 ? 0xedb88320 : 0); }
  return (checksum ^ 0xffffffff) >>> 0;
}
/** Inspect central metadata before any decompression; reject unsupported ZIP features. */
export function readArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 20, true) || end + 22 !== bytes.length) throw new DocumentError();
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directoryStart = view.getUint32(end + 16, true);
  if (!count || count > UploadLimits.entries || count !== view.getUint16(end + 8, true) || directoryStart + directorySize !== end) throw new DocumentError();
  const entries = new Map<string, { size: number; crc: number }>(); let cursor = directoryStart, expanded = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new DocumentError();
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true), compressed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const nameSize = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true), local = view.getUint32(cursor + 42, true);
    if (cursor + 46 + nameSize + extra + comment > end || ![0, 8].includes(method) || flags & ~0x808 || size > UploadLimits.entryBytes || size > Math.max(compressed, 1) * UploadLimits.ratio || local + 30 > directoryStart) throw new DocumentError();
    const name = decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize));
    if (!name || name.startsWith('/') || /[\\:\u0000-\u001f]/.test(name) || name.split('/').some(part => part === '..' || part === '.') || entries.has(name) || (view.getUint32(cursor + 38, true) >>> 16 & 0xf000) === 0xa000) throw new DocumentError();
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) throw new DocumentError();
    const localName = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
    if (decode(bytes.subarray(local + 30, local + 30 + localName)) !== name || local + 30 + localName + localExtra + compressed > directoryStart) throw new DocumentError();
    expanded += size; if (expanded > UploadLimits.expandedBytes) throw new DocumentError();
    entries.set(name, { size, crc: view.getUint32(cursor + 16, true) }); cursor += 46 + nameSize + extra + comment;
  }
  if (cursor !== end) throw new DocumentError();
  const files = unzipSync(bytes, { filter: entry => { const declared = entries.get(entry.name); if (!declared || entry.originalSize !== declared.size) throw new DocumentError(); return true; } });
  if (Object.keys(files).length !== entries.size) throw new DocumentError();
  for (const [name, content] of Object.entries(files)) if (content.length !== entries.get(name)!.size || crc32(content) !== entries.get(name)!.crc) throw new DocumentError();
  return files;
}
function xmlText(xml: string, collect: boolean): string[] {
  // DTDs, entity declarations and processing instructions are unnecessary for this profile.
  if (/<!|<\?(?!xml\s)/i.test(xml)) throw new DocumentError();
  const parser = new SaxesParser({ xmlns: true }); const paragraphs: string[] = []; let content = '', depth = 0, inText = false;
  parser.on('error', () => { throw new DocumentError(); });
  parser.on('opentag', tag => {
    if (++depth > 32) throw new DocumentError();
    if (collect && depth === 1 && (tag.local !== 'document' || tag.uri !== 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')) throw new DocumentError();
    if (tag.local === 'Relationship' && Object.values(tag.attributes).some(attribute => attribute.local === 'TargetMode' && attribute.value.toLowerCase() === 'external')) throw new DocumentError();
    if (['object', 'oleObject', 'altChunk', 'control'].includes(tag.local)) throw new DocumentError();
    if (collect && tag.uri === 'http://schemas.openxmlformats.org/wordprocessingml/2006/main') {
      if (tag.local === 'p') content = '';
      if (tag.local === 't') inText = true;
      if (tag.local === 'tab') content += '\t';
      if (tag.local === 'br') content += ' ';
    }
  });
  parser.on('text', text => { if (inText) { content += text; if (content.length > UploadLimits.text) throw new DocumentError(); } });
  parser.on('closetag', tag => { depth--; if (tag.local === 't') inText = false; if (collect && tag.local === 'p') paragraphs.push(content); if (paragraphs.length > UploadLimits.candidates) throw new DocumentError(); });
  parser.write(xml).close(); return paragraphs;
}
export function parseSimple(bytes: Uint8Array, format: 'txt' | 'docx'): ParsedDocument {
  if (!bytes.length || bytes.length > UploadLimits.fileBytes) throw new DocumentError();
  if (format === 'txt') {
    const text = decode(bytes); if (!usable(text) || /^(?:%PDF-|PK\x03\x04|MZ)/.test(text)) throw new DocumentError();
    return assemble('txt', text.split(/\r?\n/).map(text => ({ text })));
  }
  if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4) throw new DocumentError();
  const files = readArchive(bytes);
  if (!files['[Content_Types].xml'] || !files['word/document.xml'] || !files['_rels/.rels']) throw new DocumentError();
  for (const [name, content] of Object.entries(files)) {
    if (!name.endsWith('/') && !name.endsWith('.xml') && !name.endsWith('.rels') || /(?:vba|embeddings|activeX|\.exe|\.bin)/i.test(name)) throw new DocumentError();
    if (!content.length) continue;
    const xml = decode(content);
    if (/macroEnabled|vbaProject|application\/vnd\.ms-/i.test(xml)) throw new DocumentError();
    xmlText(xml, false);
  }
  const types = decode(files['[Content_Types].xml']);
  if (!types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) throw new DocumentError();
  return assemble('docx', xmlText(decode(files['word/document.xml']), true).map(text => ({ text })));
}
