// Local real-route checks; reports contain counts only, never submitted content.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DEMO_PLAYWRIGHT_MODULE);
const Origin = process.env.EVALUATION_ORIGIN || 'http://127.0.0.1:8892';
assert.equal(new URL(Origin).hostname, '127.0.0.1');
let stage = 'startup';
async function run() {
 const report = { viewports: 0, externalRequests: 0, pageErrors: 0 };
 const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
 try {
  for (const width of [1680, 820, 390]) {
   const context = await browser.newContext({ viewport: { width, height: 1100 }, serviceWorkers: 'block' });
   await context.route('**/*', route => { if (new URL(route.request().url()).origin !== Origin) { report.externalRequests++; return route.abort(); } return route.continue(); });
   const page = await context.newPage(); page.on('pageerror', () => report.pageErrors++);
   await page.goto(Origin); await page.getByText('Ready for evidence review.', { exact: true }).waitFor();
   await page.locator('#module').selectOption('module_01_endo');
   await page.locator('#narrative').fill('Normal transvaginal ultrasound. Does this exclude endometriosis?');
   await page.getByRole('button', { name: 'Analyze', exact: true }).click();
   const summary = page.locator('.directAnswer'); await summary.waitFor();
   const text = await summary.innerText(); assert.ok(text.includes('internal pelvic ultrasound')); assert.ok(text.includes('cannot rule out'));
   assert.ok(text.split(/\s+/).length <= 40); assert.ok((text.match(/[.!?](?:\s|$)/g) || []).length <= 2);
   const details = page.getByRole('button', { name: 'View clinical and educational details' });
   assert.equal(await details.getAttribute('aria-expanded'), 'false'); await details.focus(); await page.keyboard.press('Space');
   assert.equal(await details.getAttribute('aria-expanded'), 'true');
   await page.getByRole('heading', { name: 'Medical terms explained' }).waitFor();
   await page.keyboard.press('Enter'); assert.equal(await details.getAttribute('aria-expanded'), 'false');
   const sources = page.getByRole('button', { name: /^Sources \(/ });
   assert.equal(await sources.getAttribute('aria-expanded'), 'false');
   await page.getByRole('button', { name: 'View cited sources 1', exact: true }).click();
   assert.equal(await sources.getAttribute('aria-expanded'), 'true');
   await sources.click();
   assert.equal(await page.locator('.decisionNotice').count(), 1);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
   await page.locator('.responseCard').screenshot({ path: path.join(__dirname, '../screenshots', `Presentation${width}.png`) });
   for (const presetId of ['pregBrief', 'secondaryPoints']) {
    stage = width + ':' + presetId + ':submit';
    await page.getByRole('button', { name: 'Clear case', exact: true }).click();
    if (presetId === 'pregBrief') {
     await page.locator('#module').selectOption('module_02_early_pregnancy');
     await page.getByLabel('Try a demonstration case').selectOption(presetId);
    } else {
     await page.locator('#module').selectOption('module_01_endo');
     await page.locator('#caseType').selectOption('detailed');
     await page.locator('#pregnancy').selectOption('no');
     await page.locator('#pid').selectOption('no');
     await page.locator('#narrative').fill('Pelvic pain worsens with menstruation and pain during sex. Urinary and bowel symptoms are reported. Please review possible overlapping contributors.');
    }
    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    await page.locator('.directAnswer').waitFor();
    stage = width + ':' + presetId + ':presentation';
    if (presetId === 'pregBrief') await page.getByRole('heading', { name: 'Next consideration' }).waitFor();
    else {
     const points = page.getByRole('button', { name: /^Key points \(/ }); await points.waitFor();
     assert.equal(await points.getAttribute('aria-expanded'), 'false');
     assert.equal(await page.locator('.keyPoints li').count(), 0);
     await points.focus(); await page.keyboard.press('Space');
     assert.ok(await page.locator('.keyPoints li').count() <= 3); assert.ok(await page.locator('.keyPoints li').count() > 0);
     await page.keyboard.press('Enter'); assert.equal(await points.getAttribute('aria-expanded'), 'false');
    }
   }
   report.viewports++; await context.close();
  }
 } finally { await browser.close(); }
 assert.equal(report.externalRequests, 0); assert.equal(report.pageErrors, 0);
 fs.writeFileSync(path.join(__dirname, '../screenshots/PresentationBrowser.json'), JSON.stringify(report));
 console.log(JSON.stringify(report));
}
run().catch(() => { console.error('Presentation browser check failed at ' + stage + '; no clinical content recorded.'); process.exitCode = 1; });
