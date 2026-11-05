// Real local Function route; synthetic inputs only, reports contain counts rather than case content.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DEMO_PLAYWRIGHT_MODULE);
const Origin = process.env.EVALUATION_ORIGIN || 'http://127.0.0.1:8894';
assert.equal(new URL(Origin).hostname, '127.0.0.1');
const report = { checks: 0, viewports: 0, externalRequests: 0, pageErrors: 0 };
async function run() {
 const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
 try {
  for (const viewport of [{ name: 'Desktop', width: 1680, height: 1100 }, { name: 'Tablet', width: 820, height: 1180 }, { name: 'Mobile', width: 390, height: 1000 }]) {
   const context = await browser.newContext({ viewport, hasTouch: viewport.width <= 820, serviceWorkers: 'block', reducedMotion: 'reduce' });
   await context.route('**/*', route => { if (new URL(route.request().url()).origin !== Origin) { report.externalRequests++; return route.abort(); } return route.continue(); });
   await context.routeWebSocket('**/*', route => { if (new URL(route.url()).host === new URL(Origin).host) route.connectToServer(); else { report.externalRequests++; route.close(); } });
   const page = await context.newPage(); page.on('pageerror', () => report.pageErrors++);
   await page.goto(Origin); await page.getByLabel('Try a demonstration case').waitFor();
   for (const option of ['firstAssertion', 'secondAssertion', 'unresolved', 'requestVerification']) {
    await page.getByRole('button', { name: 'Clear case', exact: true }).click();
    await page.getByLabel('Try a demonstration case').selectOption('conflict');
    assert.equal(await page.locator('input[name=clinicalModule]:checked').inputValue(), 'module_01_endo');
    assert.equal(await page.getByLabel('Case narrative').inputValue(), 'pregnancy confirmed');
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/v1/analyze'));
    await page.getByRole('button', { name: 'Analyze case', exact: true }).click();
    const response = await responsePromise;
    assert.equal((await response.json()).response.responseType, 'DataConflict');
    assert.equal(response.headers()['x-endo-watson'], 'skipped');
    assert.equal(response.headers()['x-endo-watson-conflict'], 'skipped');
    const submitted = JSON.parse(response.request().postData());
    assert.equal(submitted.pregnancyPossible, false); assert.equal(submitted.additionalNotes, 'pregnancy confirmed');
    assert.ok(!JSON.stringify(submitted).includes('Synthetic report'));
    const dialog = page.getByRole('dialog', { name: 'Conflicting information requires review' });
    assert.equal(await dialog.count(),0);await page.getByRole('button',{name:'Review conflict',exact:true}).click();await dialog.waitFor();
    assert.equal(await dialog.getByRole('heading', { name: 'Watson-assisted verification questions' }).count(), 0);
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'dialog');
    assert.equal(await dialog.locator('input:checked').count(), 0);
    assert.equal(await dialog.locator('input[type=radio]').count(), 4);
    assert.equal(await dialog.getByText('Normalized value', { exact: true }).count(), 0);
    await dialog.getByText('Your selection will not alter or delete the original reports.', { exact: true }).waitFor();
    const sticky = await dialog.evaluate(panel => { const head = panel.querySelector('.conflictHeader'), foot = panel.querySelector('.conflictFooter'), body = panel.querySelector('.conflictBody'); const before = [head.getBoundingClientRect().top, foot.getBoundingClientRect().bottom]; body.scrollTop = body.scrollHeight; const after = [head.getBoundingClientRect().top, foot.getBoundingClientRect().bottom]; body.scrollTop = 0; return before.every((position, index) => position === after[index]) && getComputedStyle(head).position === 'sticky' && getComputedStyle(foot).position === 'sticky'; });
    assert.equal(sticky, true);
    assert.equal(await dialog.getByRole('button', { name: 'Continue to confirmation' }).isDisabled(), true);
    const boxes = await dialog.locator('article').evaluateAll(cards => cards.map(card => ({ x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().y })));
    assert.equal(boxes[0].y === boxes[1].y, viewport.width > 640);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.keyboard.press('Shift+Tab'); assert.equal(await dialog.locator('input').last().evaluate(control => control === document.activeElement), true);
    await page.keyboard.press('Tab'); assert.equal(await dialog.getByRole('button', { name: 'Close conflict review' }).evaluate(control => control === document.activeElement), true);
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Review conflict' }).waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent === 'Review conflict');
    if (viewport.name === 'Desktop') await page.getByRole('button', { name: 'Review conflict' }).click();
    else await page.getByRole('button', { name: 'Review conflict' }).tap();
    await dialog.locator('input[value="' + option + '"]').check();
    await dialog.getByRole('button', { name: 'Continue to confirmation' }).click();
    await dialog.getByText('Confirm local handling', { exact: true }).waitFor();
    assert.equal(await page.locator('.conflictBanner').innerText().then(text => text.includes('Recorded for this session')), false);
    if (option === 'firstAssertion') await page.screenshot({ path: path.join(__dirname, '../screenshots/ConflictReview' + viewport.name + '.png') });
    await dialog.getByRole('button', { name: 'Confirm local resolution' }).click();
    await page.getByText(/Recorded for this session:/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Analyze case', exact: true }).isDisabled(), true);
    assert.equal(await page.getByLabel('Case narrative').inputValue(), 'pregnancy confirmed');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    report.checks++;
   }
   await page.reload(); assert.equal(await page.getByLabel('Case narrative').inputValue(), '');
   assert.equal(await page.getByRole('button', { name: 'Review conflict' }).count(), 0);
   report.viewports++; await context.close();
  }
  assert.equal(report.externalRequests, 0); assert.equal(report.pageErrors, 0);
  fs.writeFileSync(path.join(__dirname, '../screenshots/conflictReviewResults.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report) + '\n');
 } finally { await browser.close(); }
}
run().catch(() => { process.stderr.write('Conflict browser validation failed; no clinical content recorded.\n'); process.exitCode = 1; });
