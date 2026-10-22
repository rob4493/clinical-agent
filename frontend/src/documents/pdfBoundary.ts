import { Unzlib } from 'fflate';
import { DocumentError, UploadLimits } from './types';

/** Conservative PDF subset: bound decoded stream bytes before invoking PDF.js.
 * Indirect lengths, object streams and unsupported filters fail closed rather
 * than relying on a browser worker as a hard heap quota (which it is not).
 */
export function checkPdf(bytes: Uint8Array): void {
  if (!bytes.length || bytes.length > UploadLimits.fileBytes) throw new DocumentError();
  const text = new TextDecoder('latin1').decode(bytes);
  if (!text.startsWith('%PDF-') || !text.trimEnd().endsWith('%%EOF') || /\/[A-Za-z]*#[0-9a-f]{2}/i.test(text) || /\/(?:Encrypt|JavaScript|JS|Launch|EmbeddedFiles|EmbeddedFile|OpenAction|AA|RichMedia|XFA|ObjStm|XRef)\b/.test(text)) throw new DocumentError();
  let cursor = 0, total = 0, streams = 0;
  // Direct stream lengths let us skip opaque bytes without interpreting them as PDF syntax.
  while (cursor < text.length) {
    const marker = /\bstream(?:\r\n|\n|\r)/g; marker.lastIndex = cursor; const match = marker.exec(text); if (!match) break;
    if (++streams > 128) throw new DocumentError();
    const start = match.index + match[0].length, dictionaryEnd = text.lastIndexOf('>>', match.index), dictionaryStart = text.lastIndexOf('<<', dictionaryEnd);
    if (dictionaryStart < cursor || dictionaryEnd < dictionaryStart || dictionaryEnd + 2 > match.index || text.slice(dictionaryEnd + 2, match.index).trim()) throw new DocumentError();
    const dictionary = text.slice(dictionaryStart, dictionaryEnd + 2), lengthMatch = /\/Length\s+(\d+)\s*(?!\d)/.exec(dictionary);
    if (!lengthMatch || dictionary.includes('%') || (dictionary.match(/\/Length\b/g) ?? []).length !== 1 || (dictionary.match(/\/Filter\b/g) ?? []).length > 1 || /\/Length\s+\d+\s+\d+\s+R/.test(dictionary)) throw new DocumentError();
    const length = Number(lengthMatch[1]); if (!Number.isSafeInteger(length) || start + length > bytes.length || !/^\s*endstream\b/.test(text.slice(start + length, start + length + 30))) throw new DocumentError();
    const content = bytes.subarray(start, start + length); let expanded = 0;
    if (/\/Filter\b/.test(dictionary)) {
      if (!/\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])\s*(?:\/|>>)/.test(dictionary) || /\/DecodeParms\b/.test(dictionary)) throw new DocumentError();
      const inflater = new Unzlib(chunk => { expanded += chunk.length; if (expanded > UploadLimits.entryBytes || expanded > Math.max(length, 1) * UploadLimits.ratio || total + expanded > UploadLimits.expandedBytes) throw new DocumentError(); });
      for (let offset = 0; offset < content.length; offset += 32) inflater.push(content.subarray(offset, offset + 32), offset + 32 >= content.length);
    } else expanded = length;
    total += expanded; if (total > UploadLimits.expandedBytes) throw new DocumentError();
    cursor = start + length + /^\s*endstream\b/.exec(text.slice(start + length, start + length + 30))![0].length;
  }
}
