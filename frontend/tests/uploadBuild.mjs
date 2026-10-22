// Run after npm run build; budgets include only locally built static artifacts.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const root = new URL('../dist/assets/', import.meta.url);
const names = readdirSync(root);
const main = names.find(name => /^index-.*\.js$/.test(name));
const parser = names.find(name => /^parse\.worker-.*\.js$/.test(name));
const pdf = names.find(name => /^pdf\.worker-.*\.mjs$/.test(name));
assert.ok(main && parser && pdf);
const size = name => statSync(new URL(name, root)).size;
assert.ok(size(main) <= 350_000, 'Main bundle exceeded upload budget.');
assert.ok(gzipSync(readFileSync(new URL(main, root))).length <= 110_000);
assert.ok(size(parser) <= 550_000, 'Parser worker exceeded upload budget.');
assert.ok(size(pdf) <= 2_500_000, 'PDF worker exceeded upload budget.');
assert.ok(names.every(name => !name.endsWith('.map')));
const notice = readFileSync(new URL('../dist/THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8');
for (const dependency of ['PDF.js 6.4.299', 'fflate 0.8.3', 'saxes 6.0.0', 'xmlchars 2.2.0']) assert.ok(notice.includes(dependency));
console.log(JSON.stringify({ mainBytes: size(main), mainGzipBytes: gzipSync(readFileSync(new URL(main, root))).length, parserWorkerBytes: size(parser), pdfWorkerBytes: size(pdf), sourceMaps: 0, noticesPresent: true }));
