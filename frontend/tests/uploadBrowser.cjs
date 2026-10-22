// Local browser checks use only original synthetic bytes. Reports exclude file names and content.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const { chromium } = require(process.env.DEMO_PLAYWRIGHT_MODULE);
const Origin = process.env.EVALUATION_ORIGIN || 'http://127.0.0.1:8892';
assert.equal(new URL(Origin).hostname, '127.0.0.1');
const report = { checks: [], externalRequests: 0, pageErrors: 0, sensitiveConsoleMessages: 0, stage: 'initial' };
function pdf(text) {
 const stream = text === null ? 'q 1 0 0 1 40 700 cm /Im0 Do Q' : `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
 const resource = text === null ? '/XObject << /Im0 4 0 R >>' : '/Font << /F1 4 0 R >>';
 const visual = text === null ? '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\nX\nendstream' : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
 const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${resource} >> /Contents 5 0 R >>`, visual, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let content = '%PDF-1.4\n'; const offsets = [];
 objects.forEach((object, index) => { offsets.push(content.length); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
 const start = content.length;
 content += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
 return Buffer.from(content);
}
function docx(text) { return Buffer.from(zipSync({
 '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
 '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
 'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
 }, { level: 0 })); }
async function run() {
 const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
 try {
  for (const viewport of [{ name: 'Desktop', width: 1680, height: 1100 }, { name: 'Tablet', width: 820, height: 1180 }, { name: 'Mobile', width: 390, height: 1000 }]) {
   const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
   await context.route('**/*', route => { if (new URL(route.request().url()).origin !== Origin) { report.externalRequests++; return route.abort(); } return route.continue(); });
   const page = await context.newPage(); page.on('pageerror', () => report.pageErrors++);
   page.on('console', message => { if (message.text().includes('SyntheticSecretMarker')) report.sensitiveConsoleMessages++; });
   await page.goto(Origin);
   for (const [format, mime, buffer] of [
    ['txt', 'text/plain', Buffer.from('Normal MRI. Does this exclude endometriosis?')],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx('Normal MRI. Does this exclude endometriosis?')],
    ['pdf', 'application/pdf', pdf('Normal MRI. Does this exclude endometriosis?')],
   ]) {
    await page.getByRole('button', { name: 'Clear case', exact: true }).click();
    await page.locator('#module').selectOption('module_01_endo');
    await page.getByLabel('I confirm these documents are de-identified and minimum necessary.').check();
    report.stage = viewport.name + ':' + format + ':parse';
    await page.locator('#documentFiles').setInputFiles({ name: 'report.' + format, mimeType: mime, buffer });
    await page.getByText('Ready for review', { exact: true }).waitFor({ timeout: 15000 }); report.stage = viewport.name + ':' + format + ':review';
    assert.equal(await page.getByRole('button', { name: 'Analyze', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'View uploaded file', exact: true }).click();
    await page.getByRole('dialog').waitFor(); assert.ok((await page.getByRole('dialog').innerText()).includes('Normal MRI.'));
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Review extracted information', exact: true }).click();
    await page.getByLabel('I reviewed the uploaded document and verified the extracted information').check();
    await page.getByRole('button', { name: 'Confirm reviewed information', exact: true }).click();
    report.stage = viewport.name + ':' + format + ':analyze';
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/v1/analyze'));
    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    const response = await responsePromise; assert.equal(response.status(), 200); const result = await response.json(); assert.equal(result.response.responseType, 'AgentResponse'); assert.ok(result.renderedText.includes('does not establish'));
    const request = response.request().postDataJSON(); assert.equal(request.schemaVersion, '1.0.0'); assert.ok(!JSON.stringify(request).includes('report.' + format));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    report.checks.push({ viewport: viewport.name, format, status: response.status() });
   }
   await page.screenshot({ path: path.join(__dirname, '../screenshots', 'Upload' + viewport.name + '.png'), fullPage: true });
   for (const [id, buffer, expected] of [
    ['unreadable', pdf(null), 'This document does not contain readable text. Scanned or image-only documents are not supported yet.'],
    ['encrypted', Buffer.from('%PDF-1.7\n/Encrypt\n%%EOF'), 'Unable to read this document safely. Check the supported format and processing limits.'],
    ['malformed', Buffer.from('%PDF-1.7\nSyntheticSecretMarker\n%%EOF'), 'Unable to read this document safely. Check the supported format and processing limits.'],
   ]) {
    await page.getByRole('button', { name: 'Clear case', exact: true }).click();
    await page.getByLabel('I confirm these documents are de-identified and minimum necessary.').check();
    await page.locator('#documentFiles').setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer });
    await page.getByText(expected, { exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'View uploaded file', exact: true }).click();
    assert.ok((await page.getByRole('dialog').innerText()).includes('Preview unavailable.'));
    await page.keyboard.press('Escape'); report.checks.push({ viewport: viewport.name, negative: id });
   }
   await page.getByRole('button', { name: 'Clear case', exact: true }).click(); assert.equal(await page.locator('.uploadItem').count(), 0);
   await page.reload(); assert.equal(await page.locator('.uploadItem').count(), 0);
   await page.emulateMedia({ reducedMotion: 'reduce' });
   await context.close();
  }
 } finally { await browser.close(); }
 fs.writeFileSync(path.join(__dirname, '../screenshots', 'UploadBrowserResults.json'), JSON.stringify(report, null, 2));
 assert.equal(report.externalRequests, 0); assert.equal(report.pageErrors, 0); assert.equal(report.sensitiveConsoleMessages, 0); console.log(JSON.stringify(report));
}
run().catch(() => { console.log(JSON.stringify(report)); console.error('Local upload browser verification failed; no document content recorded.'); process.exitCode = 1; });
