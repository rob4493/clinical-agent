// Test-only loopback harness; final reasoning is never embedded in application code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DEMO_PLAYWRIGHT_MODULE);
const Report = { checks: [], externalRequests: 0, pageErrors: 0 };
const Banner = 'Reviewed with healthcare professionals for evaluation and feedback. Not validated or approved for patient care.';
const Notice = 'Decision-support notice: Evidence support only; not a diagnosis, treatment selection, or substitute for clinical judgment.';
const Supported = 'Summary';
const Origin = process.env.EVALUATION_ORIGIN || 'http://127.0.0.1:8892';
assert.equal(new URL(Origin).hostname, '127.0.0.1');
const Originals = [
  ['Does a normal transvaginal ultrasound exclude endometriosis?', Supported, 'does not exclude'],
  ['Does a normal MRI end evaluation for pelvic pain?', Supported, 'normal MRI'],
  ['Can CA-125 diagnose endometriosis?', Supported, 'CA-125'],
  ['Pelvic discomfort with painful bowel movements during periods.', Supported, 'bowel'],
  ['Pelvic discomfort and painful urination during periods.', Supported, 'urinary'],
  ['Pelvic discomfort and pain during intercourse.', Supported, 'intercourse'],
  ['First-degree family history of endometriosis. What does this establish?', Supported, 'first-degree'],
  ['Recurring pelvic pain interferes with work and daily activities.', Supported, 'daily'],
  ['Pelvic pain has returned after previous surgery.', Supported, 'recurrence'],
  ['Does a negative home pregnancy test exclude ectopic pregnancy?', 'Evidence insufficient or unavailable', 'negative-home'],
];
let stage = 'startup';
async function runChecks() {
  const browser = await chromium.launch({ channel:'msedge', headless:true, args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
  try {
    for (const viewport of [{name:'Desktop',width:1680,height:1100},{name:'Tablet',width:820,height:1180},{name:'Mobile',width:390,height:1000}]) {
      const context = await browser.newContext({viewport,serviceWorkers:'block'});
      await context.route('**/*', route => {
        const address = new URL(route.request().url());
        if (address.origin !== Origin) { Report.externalRequests++; return route.abort(); }
        return route.continue();
      });
      await context.routeWebSocket('**/*', route => {
        const address = new URL(route.url());
        if (address.host === new URL(Origin).host) route.connectToServer();
        else { Report.externalRequests++; route.close(); }
      });
      const page = await context.newPage(); page.on('pageerror', () => Report.pageErrors++);
      await page.goto(Origin);
      await page.getByText(Banner,{exact:true}).waitFor();
      const scenarios = [
        {label:'Brief',heading:Supported}, {label:'Mild/nonurgent',heading:Supported}, {label:'Detailed',heading:Supported},
        {label:'Urgent warning',heading:'Urgent assessment',urgent:true}, {label:'Conflict',heading:'Resolve conflicting information'},
        {label:'Clarification',heading:'Clarification required'}, {label:'Outside scope',heading:'Outside selected module scope'}
      ];
      for (const scenario of scenarios) {
        stage = viewport.name + ':preset:' + scenario.label;
        await page.getByRole('button',{name:'Clear case',exact:true}).click();
        await page.getByRole('button',{name:new RegExp('^'+scenario.label)}).click();
        assert.equal(await page.locator('#module').inputValue(),'module_01_endo');
        assert.equal(await page.locator('.decisionNotice').count(),0);
        await page.getByRole('button',{name:'Analyze',exact:true}).click();
        await page.getByRole('heading',{name:scenario.heading,exact:true}).waitFor();
        await page.waitForFunction(urgent => document.activeElement.id === (urgent ? 'urgentTitle':'reviewTitle'),!!scenario.urgent);
        assert.equal(await page.locator('.urgentPanel').count(),scenario.urgent ? 1:0);
        assert.equal(await page.locator('.decisionNotice').textContent(),Notice);
        assert.equal(await page.locator('.responseCard').evaluate(panel=>panel.lastElementChild.className),'decisionNotice');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        Report.checks.push({viewport:viewport.name,scenario:scenario.label,passed:true});
        if (scenario.label === 'Detailed') {
          await page.screenshot({path:path.join(__dirname,'../screenshots/Competition'+viewport.name+'.png'),fullPage:true});
          await page.getByRole('button',{name:/^Sources \(/}).click();
          const source = page.locator('button.sourceButton').first();
          if (await source.count()) {
            await source.click(); await page.getByRole('dialog').waitFor();
            assert.equal(await page.getByRole('dialog').getByRole('link').count(),0);
            await page.keyboard.press('Escape'); assert.equal(await source.evaluate(control=>control===document.activeElement),true);
          }
        }
      }
      await page.getByRole('button',{name:'Clear case',exact:true}).click();
      await page.locator('#module').selectOption('module_01_endo');
      await page.locator('#pregnancy').selectOption('yes');
      stage = viewport.name + ':emergency';
      await page.locator('#narrative').fill('Shoulder pain and dizziness. Chronic pelvic pain affects work.');
      await page.getByRole('button',{name:'Analyze',exact:true}).click();
      await page.getByRole('heading',{name:'Urgent assessment',exact:true}).waitFor();
      assert.match(await page.locator('.urgentPanel').textContent(), /Immediate emergency assessment.*shoulder pain and dizziness requires urgent evaluation/);
      assert.equal(await page.locator('.considerations').count(),0);
      assert.equal(await page.locator('.outcomeLabel').count(),0);
      await page.getByRole('button',{name:'Sources (1)'}).click();
      assert.equal(await page.locator('.sourceButton').count(),1);
      assert.equal(await page.locator('.decisionNotice').textContent(),Notice);
      Report.checks.push({viewport:viewport.name,scenario:'Immediate emergency only',passed:true});
      await page.getByRole('button',{name:'Clear case',exact:true}).click();
      await page.locator('#module').selectOption('module_01_endo');
      await page.locator('#caseType').selectOption('detailed');
      await page.locator('#narrative').fill('Persistent pelvic pain with cycle-related worsening and deep dyspareunia. Heavy abnormal bleeding, pelvic pressure, urinary frequency and cyclical bowel symptoms affect work and daily activities. Future fertility is a priority. Her sister has endometriosis. Pelvic examination identifies an enlarged, mildly tender uterus. Transvaginal ultrasound shows a 4.5 cm intramural uterine fibroid, normal-appearing ovaries, and no reported endometrioma or deep endometriosis. Provide a concise review explaining what the fibroid may account for, whether endometriosis remains a consideration, what ultrasound does and does not establish, and factors guiding further review. Do not select treatment.');
      await page.getByRole('button',{name:'Analyze',exact:true}).click();
      await page.getByRole('heading',{name:Supported,exact:true}).waitFor();
      stage = viewport.name + ':structural';
      const structuralBody = await page.locator('.directAnswer, .considerations').innerText();
      for (const point of ['4.5 cm intramural','uterine enlargement','tenderness','urinary frequency','cycle-related','intercourse','cyclical bowel','first-degree','functional impact','fertility','did not report an endometrioma or deep endometriosis']) assert.ok(structuralBody.includes(point),'Structural review lacks a required point');
      for (const irrelevant of ['normal pelvic examination','A normal transvaginal ultrasound','MRI','laparoscopy','referral']) assert.ok(!structuralBody.includes(irrelevant),'Structural review contains unrelated or contradictory evidence');
      assert.equal(await page.locator('.decisionNotice').textContent(),Notice);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(__dirname,'../screenshots/CompetitionStructural'+viewport.name+'.png'),fullPage:true});
      Report.checks.push({viewport:viewport.name,scenario:'Detailed structural-finding synthesis',passed:true});
      for (const [originalIndex,[narrative,heading,fragment]] of Originals.entries()) {
        stage = viewport.name + ':original:' + originalIndex;
        await page.getByRole('button',{name:'Clear case',exact:true}).click();
        await page.locator('#module').selectOption('module_01_endo');
        await page.locator('#ageRange').selectOption('25-34');
        await page.locator('#caseType').selectOption('brief');
        await page.locator('#narrative').fill(narrative);
        await page.getByRole('button',{name:'Analyze',exact:true}).click();
        await page.getByRole('heading',{name:heading,exact:true}).waitFor();
        const clinicalDetails = page.getByRole('button',{name:'View clinical and educational details'});
        if(await clinicalDetails.count())await clinicalDetails.click();
        const sources = page.getByRole('button',{name:/^Sources \(/});
        if(await sources.count())await sources.click();
        assert.ok((await page.locator('.responseCard').innerText()).toLowerCase().includes(fragment.toLowerCase()), 'Original scenario '+(originalIndex+1)+' lacks its expected evidence point');
        if(originalIndex===6)assert.match(await page.locator('.responseCard').innerText(), /first.degree[\s\S]*relative/i);
        if(originalIndex===8)assert.match(await page.locator('.responseCard').innerText(), /recurr[\s\S]*(?:treatment|surgery)|(?:treatment|surgery)[\s\S]*recurr/i);
        assert.equal(await page.locator('.urgentPanel').count(),0);
        for (const link of await page.locator('a.sourceButton').all()) {
          assert.equal(await link.getAttribute('target'),'_blank'); assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
        }
        Report.checks.push({viewport:viewport.name,scenario:'Original '+(originalIndex+1),passed:true});
      }
      let releaseResponse;
      let responseReady;
      const heldResponse = new Promise(resolve=>{releaseResponse=resolve;});
      const receivedResponse = new Promise(resolve=>{responseReady=resolve;});
      await page.route('**/api/v1/analyze',async route=>{
        const response = await route.fetch(); responseReady(); await heldResponse;
        try { await route.fulfill({response}); } catch { /* Browser abort may close the held request. */ }
      });
      await page.getByRole('button',{name:'Clear case',exact:true}).click();
      await page.getByRole('button',{name:/^Brief/}).click();
      await page.getByRole('button',{name:'Analyze',exact:true}).click();
      await receivedResponse;
      await page.getByRole('button',{name:'Clear case',exact:true}).click(); releaseResponse();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#narrative').inputValue(),'');
      assert.equal(await page.locator('.decisionNotice').count(),0);
      await page.unroute('**/api/v1/analyze'); Report.clearLateResponse=true;
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.equal(await page.locator('.primaryButton').evaluate(button=>getComputedStyle(button).animationName),'none');
      if (viewport.name === 'Desktop') {
        await page.setViewportSize({width:840,height:550});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false); Report.zoomReflow=true;
      }
      await page.getByRole('button',{name:'Clear case',exact:true}).click();
      assert.equal(await page.locator('#narrative').inputValue(),'');
      assert.equal(await page.locator('#module').evaluate(control=>control===document.activeElement),true);
      await page.keyboard.press('Tab'); assert.equal(await page.locator('#ageRange').evaluate(control=>control===document.activeElement),true);
      await page.reload(); await page.getByText(Banner,{exact:true}).waitFor();
      assert.equal(await page.locator('#module').inputValue(),''); assert.equal(await page.locator('#narrative').inputValue(),'');
      assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
      await context.close();
    }
    assert.equal(Report.externalRequests,0); assert.equal(Report.pageErrors,0);
    fs.writeFileSync(path.join(__dirname,'../screenshots/competitionResults.json'),JSON.stringify(Report,null,2));
    console.log(Report.checks.length+' competition scenario checks passed; focus, source safety, clear, refresh, reduced motion and zoom reflow passed; zero external requests.');
  } finally { await browser.close(); }
}
runChecks().catch(()=>{console.error('Competition browser check failed at ' + stage + '; no case content recorded.');process.exitCode=1;});
