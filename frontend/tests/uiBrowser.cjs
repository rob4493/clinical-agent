// Real local UI review. Only fictional walkthrough inputs; never open external source links.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DEMO_PLAYWRIGHT_MODULE || 'playwright');
const DemoNotice = 'Synthetic demonstration — uses fictional test evidence and must not be used for clinical care.';
const scenarios = [
  { name: 'supported', notes: 'fictional demonstration context', pregnancy: 'unknown', heading: 'Clinical considerations', urgent: false },
  { name: 'urgent', notes: 'sudden acute pelvic pain', pregnancy: 'unknown', heading: 'Clinical considerations', urgent: true },
  { name: 'conflict', notes: 'pregnancy confirmed', pregnancy: 'no', heading: 'Resolve conflicting information', urgent: false },
  { name: 'clarification', notes: 'pregnancy confirmed', pregnancy: 'unknown', heading: 'Clarification required', urgent: false },
  { name: 'insufficient', notes: 'demo evidence unavailable', pregnancy: 'unknown', heading: 'Evidence insufficient or unavailable', urgent: false },
];
let stage = 'startup';

async function enterCase(page, scenario) {
  await page.locator('#module').selectOption('SyntheticDemo');
  await page.locator('#ageRange').selectOption('25-34');
  await page.locator('#caseType').selectOption('brief');
  await page.locator('#pregnancy').selectOption(scenario.pregnancy);
  await page.locator('#pid').selectOption('unknown');
  await page.locator('#narrative').fill(scenario.notes);
}

async function checkContrast(page) {
  return page.evaluate(() => {
    function channels(color) { return color.match(/[\d.]+/g)?.map(Number) || []; }
    function luminance(color) {
      const rgb = channels(color).slice(0, 3).map(channel => {
        const normalized = channel / 255;
        return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
      });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    }
    const failures = [];
    let minimum = Infinity;
    let checked = 0;
    for (const element of document.querySelectorAll('main *, header *')) {
      if (!Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) || !element.getClientRects().length || element.closest(':disabled, [aria-hidden="true"]') || element.tagName === 'OPTION') continue;
      const style = getComputedStyle(element);
      let ancestor = element;
      let background = 'rgb(243, 246, 247)';
      while (ancestor) {
        const candidate = getComputedStyle(ancestor).backgroundColor;
        if (channels(candidate)[3] !== 0) { background = candidate; break; }
        ancestor = ancestor.parentElement;
      }
      const light = luminance(style.color);
      const dark = luminance(background);
      const ratio = (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05);
      const size = parseFloat(style.fontSize);
      const required = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight) >= 700) ? 3 : 4.5;
      checked += 1; minimum = Math.min(minimum, ratio);
      if (ratio < required) failures.push({ element: element.tagName, className: element.className, ratio, required });
    }
    let controlMinimum = Infinity;
    for (const control of document.querySelectorAll('select:not(:disabled), textarea:not(:disabled), .sourceButton, .clearButton')) {
      const style = getComputedStyle(control);
      const border = luminance(style.borderTopColor);
      const background = luminance(style.backgroundColor);
      const ratio = (Math.max(border, background) + .05) / (Math.min(border, background) + .05);
      controlMinimum = Math.min(controlMinimum, ratio);
      if (ratio < 3) failures.push({ element: control.tagName, className: control.className, ratio, required: 3 });
    }
    const narrative = document.querySelector('textarea');
    const placeholder = luminance(getComputedStyle(narrative, '::placeholder').color);
    const narrativeBackground = luminance(getComputedStyle(narrative).backgroundColor);
    const placeholderRatio = (Math.max(placeholder, narrativeBackground) + .05) / (Math.min(placeholder, narrativeBackground) + .05);
    if (placeholderRatio < 4.5) failures.push({ element: 'placeholder', ratio: placeholderRatio, required: 4.5 });
    return { checked, minimum: Math.round(minimum * 100) / 100, controlMinimum: Math.round(controlMinimum * 100) / 100, placeholderRatio: Math.round(placeholderRatio * 100) / 100, failures };
  });
}

async function runReview() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: [
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
  ] });
  const report = { scenarios: [], viewports: [], externalRequests: 0, browserErrors: 0, keyboard: false, zoomReflow: false, reducedMotion: false, stableLoading: false, contrast: [] };
  try {
    for (const viewport of [{ name: 'Desktop', width: 1440, height: 1100 }, { name: 'Tablet', width: 820, height: 1180 }, { name: 'Mobile', width: 390, height: 1000 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1' || !['5173', '8010'].includes(url.port)) { report.externalRequests += 1; return route.abort(); }
        return route.continue();
      });
      await context.routeWebSocket('**/*', route => {
        if (new URL(route.url()).hostname === '127.0.0.1') route.connectToServer();
        else { report.externalRequests += 1; route.close(); }
      });
      const page = await context.newPage();
      page.on('pageerror', () => { report.browserErrors += 1; });
      await page.goto('http://127.0.0.1:5173');
      await page.getByText(DemoNotice, { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Analyze', exact: true }).isDisabled(), true);
      for (const scenario of scenarios) {
        stage = viewport.name + ' ' + scenario.name;
        await enterCase(page, scenario);
        const responsePromise = page.waitForResponse(response => response.url().endsWith('/v1/analyze'));
        await page.getByRole('button', { name: 'Analyze', exact: true }).click();
        const response = await responsePromise;
        assert.equal(response.status(), 200);
        assert.deepEqual(response.request().postDataJSON(), { moduleHint: 'SyntheticDemo', ageRange: '25-34', caseType: 'brief', pregnancyPossible: scenario.pregnancy === 'no' ? false : null, pidDiagnosedOrPresumed: null, additionalNotes: scenario.notes });
        await page.getByRole('heading', { name: scenario.heading, exact: true }).waitFor();
        await page.waitForFunction(urgent => document.activeElement.id === (urgent ? 'urgentTitle' : 'reviewTitle'), scenario.urgent);
        assert.equal(await page.locator('#narrative').inputValue(), scenario.notes);
        assert.equal(await page.locator('.urgentPanel').count(), scenario.urgent ? 1 : 0);
        assert.equal(await page.locator('.responseCard').evaluate(panel => panel.lastElementChild.className), 'decisionNotice');
        assert.equal(await page.locator('.syntheticLabel').count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
        const contrast = await checkContrast(page);
        assert.deepEqual(contrast.failures, []);
        report.contrast.push({ viewport: viewport.name, scenario: scenario.name, checked: contrast.checked, minimum: contrast.minimum, controlMinimum: contrast.controlMinimum, placeholderRatio: contrast.placeholderRatio });
        if (scenario.urgent) {
          assert.equal(await page.locator('.responseCard').evaluate(panel => panel.firstElementChild.className), 'urgentPanel');
          assert.equal(await page.locator('.sourceButton').getAttribute('href'), 'https://fictional.invalid/demo/reference');
          assert.equal(await page.locator('.sourceButton').getAttribute('rel'), 'noopener noreferrer');
          const link = await page.locator('.sourceButton').boundingBox();
          assert.ok(link.height >= 44 && link.x + link.width <= viewport.width);
          await page.screenshot({ path: path.join(__dirname, '../screenshots/Review' + viewport.name + '.png'), fullPage: true });
          if (viewport.name === 'Mobile') await page.locator('.responseCard').screenshot({ path: path.join(__dirname, '../screenshots/ReviewMobileResponse.png') });
          report.viewports.push({ name: viewport.name, horizontalOverflow: false, sourceHeight: link.height });
        }
        report.scenarios.push({ viewport: viewport.name, scenario: scenario.name, status: 200, passed: true });
        await page.getByRole('button', { name: 'Clear case' }).click();
        await page.waitForFunction(() => document.activeElement.id === 'module');
        assert.equal(await page.locator('#narrative').inputValue(), '');
        assert.equal(await page.locator('.decisionNotice').count(), 0);
        assert.equal(await page.getByText(DemoNotice, { exact: true }).isVisible(), true);
      }
      if (viewport.name === 'Desktop') {
        stage = 'keyboard-only';
        await page.reload(); await page.getByText(DemoNotice, { exact: true }).waitFor();
        await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); });
        await page.keyboard.press('Tab');
        stage = 'keyboard skip link';
        assert.equal(await page.evaluate(() => document.activeElement.className), 'skipLink');
        await page.keyboard.press('Tab');
        stage = 'keyboard module';
        assert.equal(await page.evaluate(() => document.activeElement.id), 'module');
        await page.keyboard.press('ArrowDown');
        for (const identifier of ['ageRange', 'caseType', 'pregnancy', 'pid', 'narrative']) {
          stage = 'keyboard ' + identifier;
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement.id), identifier);
          if (identifier === 'narrative') await page.keyboard.type('fictional demonstration context');
        }
        await page.keyboard.press('Tab');
        stage = 'keyboard Analyze';
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Analyze');
        assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth), '3px');
        await page.keyboard.press('Enter');
        stage = 'keyboard result focus';
        await page.waitForFunction(() => document.activeElement.id === 'reviewTitle');
        await page.keyboard.press('Tab');
        stage = 'keyboard source';
        assert.equal(await page.evaluate(() => document.activeElement.className), 'sourceButton');
        report.keyboard = true;

        stage = 'stable loading';
        await page.getByRole('button', { name: 'Clear case' }).click();
        await enterCase(page, scenarios[1]);
        await page.getByRole('button', { name: 'Analyze', exact: true }).click();
        await page.waitForFunction(() => document.activeElement.id === 'urgentTitle');
        const before = await page.locator('.responseCard').boundingBox();
        let releaseRequest;
        const held = new Promise(resolve => { releaseRequest = resolve; });
        await page.route('**/api/v1/analyze', async route => { await held; await route.continue(); });
        await page.getByRole('button', { name: 'Analyze', exact: true }).click();
        await page.getByText('Analysis in progress', { exact: true }).waitFor();
        const pending = await page.locator('.responseCard').boundingBox();
        assert.ok(pending.height > 0);
        assert.equal(await page.locator('.responseCard').evaluate(panel => getComputedStyle(panel).minHeight), '0px');
        assert.equal(before.y, pending.y);
        assert.equal(await page.locator('.responseCard').getAttribute('aria-busy'), 'true');
        releaseRequest();
        await page.getByRole('heading', { name: scenarios[1].heading }).waitFor();
        await page.unroute('**/api/v1/analyze'); report.stableLoading = true;

        stage = '200% desktop zoom reflow';
        // Browser zoom halves the CSS viewport. Model that geometry at device scale 2.
        await context.close();
        const zoomContext = await browser.newContext({ viewport: { width: 720, height: 550 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
        await zoomContext.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        const zoomPage = await zoomContext.newPage();
        await zoomPage.goto('http://127.0.0.1:5173'); await zoomPage.getByText(DemoNotice, { exact: true }).waitFor();
        await enterCase(zoomPage, scenarios[1]);
        await zoomPage.getByRole('button', { name: 'Analyze', exact: true }).click();
        await zoomPage.getByRole('heading', { name: 'Urgent assessment' }).waitFor();
        assert.equal(await zoomPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await zoomPage.locator('.workspace').evaluate(panel => getComputedStyle(panel).gridTemplateColumns.split(' ').length), 1);
        await zoomPage.screenshot({ path: path.join(__dirname, '../screenshots/ReviewZoom.png'), fullPage: true });
        report.zoomReflow = true;

        stage = 'reduced motion';
        await zoomPage.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await zoomPage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
        assert.equal(await zoomPage.locator('.primaryButton').evaluate(button => getComputedStyle(button).animationName), 'none');
        assert.equal(await zoomPage.locator('.primaryButton').evaluate(button => getComputedStyle(button).transitionDuration), '0s');
        report.reducedMotion = true;
        await zoomPage.reload(); await zoomPage.getByText(DemoNotice, { exact: true }).waitFor();
        assert.equal(await zoomPage.locator('#narrative').inputValue(), '');
        assert.deepEqual(await zoomPage.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie })), { local: 0, session: 0, cookies: '' });
        await zoomContext.close();
      } else await context.close();
    }
    assert.equal(report.externalRequests, 0); assert.equal(report.browserErrors, 0);
    fs.writeFileSync(path.join(__dirname, '../screenshots/uiReviewResults.json'), JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report) + '\n');
  } finally { await browser.close(); }
}
runReview().catch(() => { process.stderr.write('UI browser review failed at ' + stage + '.\n'); process.exitCode = 1; });
