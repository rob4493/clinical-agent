async function selectModule(page, moduleId) {
 await page.locator(`input[name=clinicalModule][value="${moduleId}"]`).check();
 const context = page.locator('.additionalContext');
 if (!(await context.getAttribute('open') !== null)) await context.locator('summary').first().click();
}
// Actual normal-form integration: no injected symptom fields, mocked responses or client state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DEMO_PLAYWRIGHT_MODULE);
const Origin = process.env.EVALUATION_ORIGIN || 'http://127.0.0.1:8892';
assert.equal(new URL(Origin).hostname, '127.0.0.1');
let stage = 'startup';
async function run() {
 const report = { viewports: 0, scenarios: 0, externalRequests: 0, pageErrors: 0 };
 const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
 try {
  for (const width of [1680, 820, 390]) {
   const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block', hasTouch: width < 1000 });
   await context.route('**/*', route => { if (new URL(route.request().url()).origin !== Origin) { report.externalRequests++; return route.abort(); } return route.continue(); });
   const page = await context.newPage(); page.on('pageerror', () => report.pageErrors++);
   await page.goto(Origin); await page.getByText('Select a clinical module to begin', { exact: true }).waitFor();
   async function analyze(narrative, pregnancy = 'no') {
    await page.getByRole('button', { name: 'Clear case', exact: true }).click();
    await selectModule(page, 'module_01_endo'); await page.locator('#pregnancy').selectOption(pregnancy); await page.locator('#pid').selectOption('no'); await page.locator('#narrative').fill(narrative);
    const received = page.waitForResponse(response => response.url().endsWith('/api/v1/analyze'));
    await page.getByRole('button', { name: 'Analyze case', exact: true }).click();
    const response = await received; assert.equal(response.status(), 200);
    const result = await response.json(); await page.locator('.decisionNotice').waitFor(); report.scenarios++; return result;
   }
   const supported = await analyze('Cycle-related pelvic pain and pain during sex.'); assert.equal(supported.response.responseType, 'AgentResponse');
   const pelvic = page.locator('#findingpelvicPain'); await pelvic.waitFor();
   assert.equal(await page.locator('.summaryFindings li').count(), 2);
   assert.equal(await page.locator('.findingExplanation').first().isVisible(), true);
   assert.match(await pelvic.innerText(), /do not confirm it/);
   assert.equal(await page.locator('.findingCard, .findingDetails, .visualFindings').count(), 0);
   assert.equal(await page.getByRole('heading', { name: 'Reported symptoms and discussion areas' }).count(), 0);
   assert.equal(await page.getByRole('img').count(), 0);
   assert.equal(await page.locator('.summaryIcons').first().getAttribute('aria-hidden'), 'true');
   assert.equal((await pelvic.innerText()).includes('Reported symptom'), false);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   await page.locator('.responseCard').screenshot({ path: path.join(__dirname, `../screenshots/VisualFindings${width}.png`) });
   const citation = page.locator('.visualSummary .citationButton').first(); await citation.focus(); await page.keyboard.press('Enter');
   assert.equal(await page.locator('#sourcesTitle').getAttribute('aria-expanded'), 'true');
   const details = page.getByRole('button', { name: 'Clinical details and sources', exact: true });
   if (width < 1000) await details.tap(); else await details.click();
   assert.equal(await details.getAttribute('aria-expanded'), 'true');
   await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await page.locator('.summaryIcons').first().evaluate(element => getComputedStyle(element).animationName), 'none');
   await page.setViewportSize({ width: 320, height: 800 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   await page.setViewportSize({ width, height: 1000 });
   for (const narrative of ['Normal MRI. Does this exclude endometriosis?', 'No pelvic pain. No painful intercourse. Normal MRI. Does this exclude endometriosis?', 'Possible pelvic pain. Normal MRI. Does this exclude endometriosis?']) {
    const result = await analyze(narrative); assert.equal(result.response.responseType, 'AgentResponse');
    await page.locator('#findinggeneralReview').waitFor(); assert.equal(await page.locator('.summaryFindings li').count(), 1);
    assert.equal(await page.locator('#findinggeneralReview h3').isVisible(), true);
   }
   const urgent = await analyze('Shoulder pain and weakness.', 'yes'); assert.ok(urgent.warnings.length);
   assert.equal(await page.locator('.responseCard').evaluate(element => element.firstElementChild.classList.contains('urgentPanel')), true);
   await page.locator('#findinggeneralReview').waitFor(); assert.equal(await page.locator('#findinggeneralReview h3').isVisible(), true);
   for (const [narrative, outcome] of [['Persistent headache with light sensitivity.', 'OutsideScope'], ['pregnancy confirmed', 'DataConflict']]) {
    const result = await analyze(narrative); assert.equal(result.response.responseType, outcome); assert.equal(await page.locator('.visualSummary').count(), 0);
   }
   for (const label of ['Brief', 'Mild/nonurgent', 'Detailed']) {
    stage = `preset ${label} width ${width}`;
    await page.getByRole('button', { name: 'Clear case', exact: true }).click();
    await selectModule(page, 'module_01_endo');
    await page.locator('#demoCase').selectOption({ label });
    const received = page.waitForResponse(response => response.url().endsWith('/api/v1/analyze'));
    await page.getByRole('button', { name: 'Analyze case', exact: true }).click();
    const result = await (await received).json(); assert.equal(result.response.responseType, 'AgentResponse');
    await page.locator('#findingpelvicPain').waitFor();
    const summaryText = await page.locator('#findingpelvicPain').innerText();
    assert.ok(summaryText.length > 100);
    assert.equal(summaryText.includes('discussion area in the clinical review'), false);
    assert.ok(await page.locator('#findingpelvicPain .citationButton').count());
    if (label === 'Detailed') {
      assert.match(summaryText, /daily-life impact/); assert.match(summaryText, /examinations/);
      await page.locator('#reviewTitle').click();
      await page.locator('.responseCard').screenshot({ path: path.join(__dirname, `../screenshots/PatientSummary${width}.png`) });
    }
    report.scenarios++;
   }
   await page.getByRole('button', { name: 'Clear case', exact: true }).click(); assert.equal(await page.locator('.visualSummary').count(), 0);
   assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
   assert.equal(await page.locator('.demoShelf, .demoCards').count(), 0);
   report.viewports++; await context.close();
  }
 } finally { await browser.close(); }
 assert.equal(report.externalRequests, 0); assert.equal(report.pageErrors, 0);
 fs.writeFileSync(path.join(__dirname, '../screenshots/VisualFindingsResults.json'), JSON.stringify(report)); console.log(JSON.stringify(report));
}
run().catch(() => { console.error(`Visual findings normal-form browser check failed at ${stage}; no clinical contents recorded.`); process.exitCode = 1; });
