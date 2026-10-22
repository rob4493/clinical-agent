// Real local routes and synthetic cases only. Reports never contain submitted text.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DEMO_PLAYWRIGHT_MODULE);
const Origin = process.env.EVALUATION_ORIGIN || 'http://127.0.0.1:8892';
assert.equal(new URL(Origin).hostname, '127.0.0.1');
const report = { checks: [], externalRequests: 0, pageErrors: 0, contrastRatios: [], contrastAudits: [] };
const pictures = path.join(__dirname, '../screenshots');
function contrast(first, second) {
 const luminance = hex => { const channels = hex.replace('#', '').match(/../g).map(component => parseInt(component, 16) / 255).map(component => component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; };
 const a = luminance(first), b = luminance(second); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
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
    // Borderless text actions are covered by the text contrast audit above.
    let controlMinimum = Infinity;
    for (const control of document.querySelectorAll('select:not(:disabled), textarea:not(:disabled), .sourceButton')) {
      const style = getComputedStyle(control);
      const border = luminance(parseFloat(style.borderTopWidth) === 0 ? style.color : style.borderTopColor);
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

async function run() {
 const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
 try {
  for (const viewport of [{ name: 'Desktop', width: 1680, height: 1100 }, { name: 'Tablet', width: 820, height: 1180 }, { name: 'Mobile', width: 390, height: 1000 }]) {
   const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
   await context.route('**/*', route => { if (new URL(route.request().url()).origin !== Origin) { report.externalRequests++; return route.abort(); } return route.continue(); });
   const page = await context.newPage(); page.on('pageerror', () => report.pageErrors++);
   await page.goto(Origin + '/review'); await page.getByText('Ready for evidence review.', { exact: true }).waitFor();
   assert.equal(await page.title(), 'Endo | Clinical Evidence Assistant');
   assert.equal(await page.locator('.evidenceRail').count(), 0);
   assert.equal(await page.getByText('In-memory only', { exact: true }).isVisible(), true);
   const bounds = await page.locator('main').boundingBox();
   const shell = await page.locator('.applicationShell').boundingBox();
   assert.ok(bounds.width <= 1201);
   assert.ok(Math.abs((bounds.x + bounds.width / 2) - (shell.x + shell.width / 2)) < 2);
   await page.keyboard.press('Tab'); assert.equal(await page.getByRole('link', { name: 'Skip to case entry' }).evaluate(element => element === document.activeElement), true);
   await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => document.activeElement.id), 'caseForm');
   await page.getByRole('navigation', { name: 'Review sections' }).getByRole('link', { name: 'Documents' }).click();
   assert.equal(await page.evaluate(() => document.activeElement.id), 'uploadTitle');
   await page.locator('#module').selectOption('module_01_endo');
   await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
   await page.screenshot({ path: path.join(pictures, viewport.name === 'Tablet' ? 'EndoTabletLayout.png' : `Endo${viewport.name}CaseBuilder.png`), fullPage: true });
   await page.getByLabel('I confirm these documents are de-identified and minimum necessary.').check();
   await page.locator('#documentFiles').setInputFiles({ name: 'review.txt', mimeType: 'text/plain', buffer: Buffer.from('Normal MRI. Does this exclude endometriosis?') });
   await page.getByText('Ready for review', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Analyze', exact: true }).isDisabled(), true);
   const viewButton = page.getByRole('button', { name: 'View uploaded file', exact: true }); await viewButton.click();
   const dialog = page.getByRole('dialog'); await dialog.waitFor();
   if (viewport.name === 'Mobile') await page.screenshot({ path: path.join(pictures, 'EndoMobileUploadPreview.png') });
   await page.keyboard.press('Shift+Tab'); assert.equal(await page.getByRole('button', { name: 'Close preview' }).evaluate(element => element === document.activeElement), true);
   await page.keyboard.press('Escape'); assert.equal(await viewButton.evaluate(element => element === document.activeElement), true);
   await page.getByRole('button', { name: 'Review extracted information', exact: true }).click();
   if (viewport.name === 'Desktop') { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(pictures, 'EndoDesktopUploadReview.png'), fullPage: true }); }
   await page.getByLabel('I reviewed the uploaded document and verified the extracted information').check(); await page.getByRole('button', { name: 'Confirm reviewed information', exact: true }).click();
   const received = page.waitForResponse(response => response.url().endsWith('/api/v1/analyze')); await page.getByRole('button', { name: 'Analyze', exact: true }).click();
   const response = await received; assert.equal(response.status(), 200); const result = await response.json(); assert.equal(result.response.responseType, 'AgentResponse');
   await page.locator('.decisionNotice').waitFor();
   if (viewport.name !== 'Tablet') await page.locator('.responseCard').screenshot({ path: path.join(pictures, `Endo${viewport.name}EvidenceResponse.png`) });
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   await page.getByRole('button', { name: 'Clear case', exact: true }).click(); assert.equal(await page.locator('.uploadItem').count(), 0);
   await page.locator('#module').selectOption('module_01_endo'); await page.locator('#pregnancy').selectOption('yes'); await page.locator('#narrative').fill('Shoulder pain and weakness.');
   const urgent = page.waitForResponse(response => response.url().endsWith('/api/v1/analyze')); await page.getByRole('button', { name: 'Analyze', exact: true }).click(); const urgentResult = await (await urgent).json(); assert.ok(urgentResult.warnings.length);
   await page.locator('.urgentPanel').waitFor(); assert.equal(await page.locator('.responseCard').evaluate(element => element.firstElementChild.classList.contains('urgentPanel')), true);
   if (viewport.name === 'Desktop') await page.locator('.responseCard').screenshot({ path: path.join(pictures, 'EndoUrgentWarning.png') });
   assert.equal(await page.locator('.formActions').evaluate(element => getComputedStyle(element).position), 'static');
   await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await page.locator('.primaryButton').evaluate(element => getComputedStyle(element).animationName), 'none');
   await page.setViewportSize({ width: 320, height: 800 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   await page.setViewportSize({ width: 840, height: 550 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
   const contrastAudit = await checkContrast(page); assert.deepEqual(contrastAudit.failures, []); report.contrastAudits.push(contrastAudit);
   const palette = await page.evaluate(() => { const style = getComputedStyle(document.documentElement); return Object.fromEntries(['--ink', '--cream', '--muted', '--surface', '--plum', '--coralAction', '--urgentInk', '--urgentSurface'].map(name => [name, style.getPropertyValue(name).trim()])); });
   for (const [first, second] of [['--ink', '--cream'], ['--muted', '--surface'], ['--cream', '--plum'], ['#ffffff', '--coralAction'], ['--urgentInk', '--urgentSurface']]) { const ratio = contrast(palette[first] || first, palette[second]); assert.ok(ratio >= 4.5); report.contrastRatios.push(Number(ratio.toFixed(2))); }
   report.checks.push({ viewport: viewport.name, branding: true, navigation: true, confirmation: true, urgentFirst: true, narrowReflow: true, reducedMotion: true }); await context.close();
  }
 } finally { await browser.close(); }
 assert.equal(report.externalRequests, 0); assert.equal(report.pageErrors, 0); fs.writeFileSync(path.join(pictures, 'EndoBrowserResults.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
run().catch(() => { console.error('Endo browser verification failed; no case data recorded.'); process.exitCode = 1; });
