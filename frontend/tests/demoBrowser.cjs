async function selectModule(page, moduleId) {
 await page.locator(`input[name=clinicalModule][value="${moduleId}"]`).check();
 const context = page.locator('.additionalContext');
 if (!(await context.getAttribute('open') !== null)) await context.locator('summary').first().click();
}
// Real local HTTP smoke checks. No clinical fixtures are bundled into application code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DEMO_PLAYWRIGHT_MODULE || 'playwright');
const DemoNotice = 'Synthetic demonstration — uses fictional test evidence and must not be used for clinical care.';
let stage = 'startup';

async function runSmoke() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: [
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
  ] });
  const report = { externalBrowserRequests: 0, browserErrors: 0, viewports: [], scenarios: [], concurrentRequests: 0, disabledMode: false };
  let currentPage;
  try {
    for (const viewport of [{ name: 'Desktop', width: 1440, height: 1100 }, { name: 'Tablet', width: 820, height: 1180 }, { name: 'Mobile', width: 390, height: 1000 }]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1' || !['5173', '5174', '8000', '8001'].includes(url.port)) {
          report.externalBrowserRequests += 1; return route.abort();
        }
        return route.continue();
      });
      await context.routeWebSocket('**/*', route => {
        if (new URL(route.url()).hostname === '127.0.0.1') route.connectToServer();
        else { report.externalBrowserRequests += 1; route.close(); }
      });
      const page = await context.newPage();
      currentPage = page;
      page.on('pageerror', () => { report.browserErrors += 1; });
      await page.goto('http://127.0.0.1:5173');
      stage = viewport.name + ' availability';
      await page.getByText(DemoNotice, { exact: true }).waitFor();
      assert.equal(await page.locator('input[name=clinicalModule]:checked').evaluateAll(radios => radios[0]?.value || ''), '');
      assert.equal(await page.getByRole('button', { name: 'Analyze case' }).isDisabled(), true);
      const scenarios = [
        { name: 'ordinary', notes: 'Recurrent pelvic discomfort. Timing, examination and test findings are not provided. Please review the reported pattern and uncertainty.', pregnancy: 'unknown', heading: 'Evidence summary', urgent: false },
        { name: 'urgent', notes: 'sudden acute pelvic pain', pregnancy: 'unknown', heading: 'Evidence summary', urgent: true },
        { name: 'conflict', notes: 'pregnancy confirmed', pregnancy: 'no', heading: 'Resolve conflicting information', urgent: false },
        { name: 'clarification', notes: 'pregnancy confirmed', pregnancy: 'unknown', heading: 'Clarification required', urgent: false },
        { name: 'insufficient', notes: 'demo evidence unavailable', pregnancy: 'unknown', heading: 'Evidence insufficient or unavailable', urgent: false },
      ];
      for (const scenario of scenarios) {
        stage = viewport.name + ' ' + scenario.name;
        await selectModule(page, 'SyntheticDemo');
        await page.locator('#pregnancy').selectOption(scenario.pregnancy);
        await page.locator('#narrative').fill(scenario.notes);
        await page.getByRole('button', { name: 'Analyze case' }).click();
        stage = viewport.name + ' ' + scenario.name + ' response heading';
        await page.getByRole('heading', { name: scenario.heading, exact: true }).waitFor();
        stage = viewport.name + ' ' + scenario.name + ' response assertions';
        assert.equal(await page.getByText('Synthetic demonstration response', { exact: true }).isVisible(), true);
        assert.equal(await page.locator('.urgentPanel').count(), scenario.urgent ? 1 : 0);
        assert.equal(await page.locator('.decisionNotice').textContent(), 'Synthetic demonstration only; not a diagnosis, treatment selection, or substitute for clinical judgment.');
        assert.equal(await page.locator('.responseCard').evaluate(panel => panel.lastElementChild.className), 'decisionNotice');
        if (scenario.urgent) {
          assert.equal(await page.locator('.responseCard').evaluate(panel => panel.firstElementChild.className), 'urgentPanel');
          const sources = page.getByRole('button', { name: /^Sources \(/ });
          await sources.click();
          const link = page.locator('button.sourceButton');
          assert.equal(await link.getAttribute('href'), null);
          await link.click(); await page.getByRole('dialog').waitFor();
          await page.keyboard.press('Escape');
          const bounds = await link.boundingBox();
          assert.ok(bounds.height >= 44 && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
          await page.screenshot({ path: path.join(__dirname, '../screenshots/Demo' + viewport.name + '.png'), fullPage: true });
          report.viewports.push({ name: viewport.name, horizontalOverflow: false, sourceButtonHeight: bounds.height });
        }
        await page.getByRole('button', { name: 'Clear case' }).click();
        assert.equal(await page.locator('#narrative').inputValue(), '');
        assert.equal(await page.locator('input[name=clinicalModule]:checked').evaluateAll(radios => radios[0]?.value || ''), '');
        assert.equal(await page.locator('.decisionNotice').count(), 0);
        assert.equal(await page.getByText(DemoNotice, { exact: true }).isVisible(), true);
        report.scenarios.push({ viewport: viewport.name, scenario: scenario.name, passed: true });
      }
      await selectModule(page, 'SyntheticDemo');
      await page.locator('#narrative').fill('fictional refresh privacy marker');
      await page.reload();
      await page.getByText(DemoNotice, { exact: true }).waitFor();
      assert.equal(await page.locator('#narrative').inputValue(), '');
      assert.equal(await page.locator('input[name=clinicalModule]:checked').evaluateAll(radios => radios[0]?.value || ''), '');
      assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie })), { local: 0, session: 0, cookies: '' });
      if (viewport.name === 'Desktop') {
        await page.goto('http://127.0.0.1:5174');
        await page.getByText(/No approved clinical modules are available/).waitFor();
        assert.equal(await page.getByText(DemoNotice, { exact: true }).count(), 0);
        assert.equal(await page.locator('input[name=clinicalModule]').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Analyze case' }).isDisabled(), true);
        report.disabledMode = true;
      }
      await context.close();
    }
    const responses = await Promise.all(Array.from({ length: 12 }, async (ignored, index) => {
      const response = await fetch('http://127.0.0.1:8000/v1/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moduleHint: 'SyntheticDemo', caseType: 'brief', pregnancyPossible: Boolean(index % 2), additionalNotes: 'Recurrent pelvic discomfort. Timing, examination and test findings are not provided. Please review the reported pattern and uncertainty.' }) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('X-Clinical-Mode'), 'synthetic');
      const payload = await response.json();
      assert.equal(payload.response.responseType, 'AgentResponse');
      assert.equal(payload.response.reportedFacts.pregnancyPossible, index % 2 ? 'Yes' : 'No');
      assert.ok(!JSON.stringify(payload).includes('Recurrent pelvic discomfort. Timing, examination and test findings are not provided. Please review the reported pattern and uncertainty.'));
      return payload.renderedText;
    }));
    assert.equal(new Set(responses).size, 1);
    // Arbitrary markers are intentionally unsupported; verify fail-closed replies never echo them or cross case state.
    const markers = Array.from(Array(12).keys(), index => 'fictional concurrent browser marker ' + index);
    await Promise.all(markers.map(async (marker, index) => {
      const response = await fetch('http://127.0.0.1:8000/v1/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moduleHint: 'SyntheticDemo', caseType: 'brief', pregnancyPossible: Boolean(index % 2), additionalNotes: marker }) });
      assert.equal(response.status, 200); const payload = await response.json();
      assert.equal(payload.response.responseType, 'EvidenceInsufficient');
      assert.ok(markers.every(candidate => !JSON.stringify(payload).includes(candidate)));
      assert.ok(payload.renderedText.includes('pregnancy ' + (index % 2 ? 'Yes' : 'No')));
    }));
    report.concurrentRequests = responses.length + markers.length;
    assert.equal(report.externalBrowserRequests, 0);
    assert.equal(report.browserErrors, 0);
    fs.writeFileSync(path.join(__dirname, '../screenshots/demoBrowserResults.json'), JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report) + '\n');
  } catch (failure) {
    if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(__dirname, '../screenshots/DemoFailure.png'), fullPage: true });
    throw failure;
  } finally { await browser.close(); }
}
runSmoke().catch(() => { process.stderr.write('Local browser smoke check failed at ' + stage + '.\n'); process.exitCode = 1; });

