// Isolated headless regression harness: only local synthetic API requests are allowed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DEMO_PLAYWRIGHT_MODULE || 'playwright');
const Report = { checks: [], externalRequests: 0, pageErrors: 0 };
async function checkDesign() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
  try {
    for (const viewport of [{ name: 'Desktop', width: 1680, height: 1100 }, { name: 'Tablet', width: 820, height: 1180 }, { name: 'Mobile', width: 390, height: 1000 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const address = new URL(route.request().url());
        if (address.hostname !== '127.0.0.1' || address.port !== '5179') { Report.externalRequests++; return route.abort(); }
        return route.continue();
      });
      await context.routeWebSocket('**/*', route => {
        const address = new URL(route.url());
        if (address.hostname === '127.0.0.1' && address.port === '5179') route.connectToServer();
        else { Report.externalRequests++; route.close(); }
      });
      const page = await context.newPage(); page.on('pageerror', () => Report.pageErrors++);
      await page.goto('http://127.0.0.1:5179');
      await page.getByText('Synthetic demonstration — uses fictional test evidence and must not be used for clinical care.', { exact: true }).waitFor();
      for (const scenario of [
        { label: 'Brief', heading: 'Clinical considerations' },
        { label: 'Mild/nonurgent', heading: 'Clinical considerations' },
        { label: 'Detailed', heading: 'Clinical considerations' },
        { label: 'Urgent warning', heading: 'Urgent assessment' },
        { label: 'Conflict', heading: 'Resolve conflicting information' },
        { label: 'Clarification', heading: 'Clarification required' },
        { label: 'Outside scope', heading: 'Outside selected module scope' },
      ]) {
        await page.getByRole('button', { name: 'Clear case', exact: true }).click();
        await page.getByRole('button', { name: new RegExp('^' + scenario.label) }).click();
        assert.equal(await page.locator('#module').inputValue(), 'SyntheticDemo');
        assert.equal(await page.getByRole('button', { name: 'Analyze', exact: true }).isDisabled(), false);
        assert.equal(/fictional demonstration/i.test(await page.locator('#narrative').inputValue()), false);
        await page.getByRole('button', { name: 'Analyze', exact: true }).click();
        await page.getByRole('heading', { name: scenario.heading, exact: true }).waitFor();
        await page.waitForFunction(urgent => document.activeElement.id === (urgent ? 'urgentTitle' : 'reviewTitle'), scenario.label === 'Urgent warning');
        const facts = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, noticeLast: document.querySelector('.responseCard').lastElementChild.className === 'decisionNotice', urgentFirst: document.querySelector('.responseCard').firstElementChild.className === 'urgentPanel' }));
        assert.equal(facts.overflow, false); assert.equal(facts.noticeLast, true);
        assert.equal(facts.urgentFirst, scenario.label === 'Urgent warning');
        assert.equal(await page.getByText('Synthetic demonstration response', { exact: true }).count(), 1);
        assert.equal(await page.getByText('Synthetic demonstration — uses fictional test evidence and must not be used for clinical care.', { exact: true }).count(), 1);
        assert.equal(await page.locator('.decisionNotice').textContent(), 'Synthetic demonstration only; not a diagnosis, treatment selection, or substitute for clinical judgment.');
        assert.equal(/approved knowledge base|approved evidence|evidence-supported|clinically validated/i.test(await page.locator('.responseCard').innerText()), false);
        assert.equal(/fictional example|fictional demonstration/i.test(await page.locator('.responseCard').innerText()), false);
        assert.equal(await page.locator('.responseCard').evaluate(panel => getComputedStyle(panel).minHeight), '0px');
        Report.checks.push({ viewport: viewport.name, scenario: scenario.label, passed: true });
        if (scenario.label === 'Brief') {
          assert.equal(await page.locator('.considerations li').count(), 2);
          assert.ok((await page.locator('.considerations').innerText()).includes('Recurrent pelvic discomfort is the reported concern.'));
          assert.equal(await page.getByRole('heading', { name: 'One useful follow-up' }).count(), 1);
          assert.equal(await page.locator('.sourceButton').getAttribute('href'), null);
          assert.equal(await page.locator('.sourceButton').getAttribute('aria-label'), '[1] View source — opens source details');
          await page.locator('.sourceButton').click();
          await page.getByRole('dialog').getByText('Demonstration only; no clinical authority', { exact: true }).waitFor();
          assert.equal(await page.getByRole('dialog').getByRole('link').count(), 0);
          assert.equal(await page.getByRole('button', { name: 'Close source' }).evaluate(button => button === document.activeElement), true);
          if (viewport.name === 'Desktop') await page.screenshot({ path: path.join(__dirname, '../screenshots/CompetitionSourceDetails.png'), fullPage: true });
          await page.keyboard.press('Escape');
          assert.equal(await page.getByRole('dialog').count(), 0);
          assert.equal(await page.locator('.sourceButton').evaluate(button => button === document.activeElement), true);
          assert.ok((await page.locator('.sourceButton').boundingBox()).height >= 44);
          assert.equal(await page.locator('.demoCard small').evaluateAll(descriptions => descriptions.every(description => parseFloat(getComputedStyle(description).fontSize) >= 14)), true);
          const contrast = await page.evaluate(() => {
            function luminance(color) {
              const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
                const scaled = channel / 255;
                return scaled <= .04045 ? scaled / 12.92 : ((scaled + .055) / 1.055) ** 2.4;
              });
              return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
            }
            function ratio(first, second) { return (Math.max(first, second) + .05) / (Math.min(first, second) + .05); }
            const textRatios = Array.from(document.querySelectorAll('.fieldHint, .demoCard small, .sourceButton, .sourceAction, .decisionNotice, .syntheticLabel, .required, .futureModules small')).filter(element => element.getClientRects().length).map(element => {
              let parent = element;
              while (parent && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement;
              return ratio(luminance(getComputedStyle(element).color), luminance(getComputedStyle(parent || document.body).backgroundColor));
            });
            const borderRatios = Array.from(document.querySelectorAll('select, textarea')).filter(control => control.getClientRects().length).map(control => ratio(luminance(getComputedStyle(control).borderTopColor), luminance(getComputedStyle(control).backgroundColor)));
            return { text: Math.min(...textRatios), borders: Math.min(...borderRatios) };
          });
          assert.ok(contrast.text >= 4.5); assert.ok(contrast.borders >= 3);
          Report.checks[Report.checks.length - 1].contrast = contrast;
          await page.locator('.sourceButton').focus();
          assert.equal(await page.locator('.sourceButton').evaluate(source => source === document.activeElement), true);
          await page.screenshot({ path: path.join(__dirname, '../screenshots/Case' + viewport.name + '.png'), fullPage: true });
          const presetText = await page.locator('.considerations').innerText();
          const narrative = await page.locator('#narrative').inputValue();
          await page.getByRole('button', { name: 'Clear case', exact: true }).click();
          await page.locator('#module').selectOption('SyntheticDemo');
          await page.locator('#ageRange').selectOption('25-34');
          await page.locator('#caseType').selectOption('brief');
          await page.locator('#narrative').fill(narrative);
          await page.getByRole('button', { name: 'Analyze', exact: true }).click();
          await page.getByRole('heading', { name: 'Clinical considerations', exact: true }).waitFor();
          assert.equal(await page.locator('.considerations').innerText(), presetText);
          Report.checks[Report.checks.length - 1].manualEquivalent = true;
        }
      }
      for (const original of [
        { notes: 'Recurring pelvic pain.', heading: 'Clinical considerations', content: 'Recurrent pelvic discomfort' },
        { notes: 'Mild intermittent pelvic pain for several months.', heading: 'Clinical considerations', content: 'mild, intermittent' },
        { notes: 'Does a normal transvaginal ultrasound rule out endometriosis?', heading: 'Clinical considerations', content: 'A normal transvaginal ultrasound does not rule out endometriosis' },
        { notes: 'Headache after exercise.', heading: 'Outside selected module scope', content: 'headache' },
        { notes: 'Pelvic pain after activity with unexplained findings.', heading: 'Evidence insufficient or unavailable', content: 'pelvic symptoms' },
      ]) {
        await page.getByRole('button', { name: 'Clear case', exact: true }).click();
        await page.locator('#module').selectOption('SyntheticDemo');
        await page.locator('#ageRange').selectOption('35-44');
        await page.locator('#narrative').fill(original.notes);
        await page.getByRole('button', { name: 'Analyze', exact: true }).click();
        await page.getByRole('heading', { name: original.heading, exact: true }).waitFor();
        assert.ok((await page.locator('.responseCard').innerText()).includes(original.content));
        assert.ok((await page.locator('.responseCard').innerText()).includes('age range 35-44'));
        assert.equal(await page.locator('.urgentPanel').count(), 0);
        Report.checks.push({ viewport: viewport.name, scenario: 'Original ' + original.heading, passed: true });
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.primaryButton').evaluate(button => getComputedStyle(button).animationName), 'none');
      if (viewport.name === 'Desktop') {
        await page.setViewportSize({ width: 840, height: 550 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        Report.zoomReflow = true;
      }
      await page.getByRole('button', { name: 'Clear case', exact: true }).click();
      assert.equal(await page.locator('#narrative').inputValue(), '');
      assert.equal(await page.locator('.decisionNotice').count(), 0);
      assert.equal(await page.locator('#module').evaluate(module => module === document.activeElement), true);
      await page.reload();
      await page.getByText('Synthetic demonstration — uses fictional test evidence and must not be used for clinical care.', { exact: true }).waitFor();
      assert.equal(await page.locator('#module').inputValue(), '');
      assert.equal(await page.locator('#narrative').inputValue(), '');
      assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
      await context.close();
    }
    assert.equal(Report.externalRequests, 0); assert.equal(Report.pageErrors, 0);
    fs.writeFileSync(path.join(__dirname, '../screenshots/caseResults.json'), JSON.stringify(Report, null, 2));
    console.log('36 competition browser checks passed; local source dialogs, keyboard, zoom reflow and reduced motion verified; zero external requests or page errors.');
  } finally { await browser.close(); }
}
checkDesign().catch(() => { console.error('Reference design regression failed.'); process.exitCode = 1; });
