// Local browser-to-FastAPI verification; only input fixtures, never canned output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DEMO_PLAYWRIGHT_MODULE);
const presets = require('../src/PregnancyCases.json');
const expected = { pregBrief:[200,'AgentResponse'], pregDetailed:[200,'AgentResponse'], pregEmergency:[200,'AgentResponse'], pregDizziness:[200,'AgentResponse'], pregUnsupported:[503,'EvidenceInsufficient'], pregConflict:[200,'DataConflict'], pregTesting:[200,'EvidenceInsufficient'], pregSerial:[200,'AgentResponse'], pregOutside:[200,'OutsideScope'], pregInjection:[200,'EvidenceInsufficient'] };
const report = { checks: [], externalRequests:0, pageErrors:0 };
const notice = 'Decision-support notice: Evidence support only; not a diagnosis, treatment selection, or substitute for clinical judgment.';
async function run() {
 const browser = await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost']});
 try {
  for (const viewport of [{name:'Desktop',width:1680,height:1100},{name:'Tablet',width:820,height:1180},{name:'Mobile',width:390,height:1000}]) {
   const context = await browser.newContext({viewport,serviceWorkers:'block'});
   await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || url.port !== '5181') { report.externalRequests++; return route.abort(); }
    return route.continue();
   });
   await context.routeWebSocket('**/*', route => {
    const url = new URL(route.url());
    if (url.hostname === '127.0.0.1' && url.port === '5181') route.connectToServer();
    else {report.externalRequests++; route.close();}
   });
   const page = await context.newPage(); page.on('pageerror',()=>report.pageErrors++);
   await page.goto('http://127.0.0.1:5181');
   await page.getByRole('option',{name:'Early Pregnancy Pain and Bleeding',exact:true}).waitFor({state:'attached'});
   for (const preset of presets) {
    await page.getByRole('button',{name:'Clear case',exact:true}).click();
    await page.locator('#module').selectOption('module_02_early_pregnancy');
    await page.getByRole('button',{name:preset.label,exact:false}).click();
    assert.equal(await page.locator('#narrative').inputValue(),preset.narrative);
    assert.equal(await page.locator('#gestationalWeeks').inputValue(),String(preset.earlyPregnancy.gestationalWeeks));
    const received = page.waitForResponse(response=>response.url().endsWith('/api/v1/analyze') && response.request().method()==='POST');
    await page.getByRole('button',{name:'Analyze',exact:true}).click();
    const response = await received; const result = await response.json();
    assert.equal(response.status(),expected[preset.id][0],preset.id);
    assert.equal(result.response.responseType,expected[preset.id][1],preset.id);
    assert.deepEqual(response.request().postDataJSON().earlyPregnancy,preset.earlyPregnancy);
    await page.getByText('Response available for review.',{exact:true}).waitFor();
    const urgent = ['pregEmergency','pregDizziness'].includes(preset.id);
    assert.equal(await page.locator('.urgentPanel').count(),urgent?1:0);
    if (urgent) {
     assert.equal(await page.locator('.responseCard').evaluate(panel=>panel.firstElementChild.classList.contains('urgentPanel')),true);
     assert.equal(await page.locator('.considerations').count(),0);
    }
    assert.equal(await page.locator('.decisionNotice').textContent(),notice);
    assert.equal(await page.locator('.responseCard').evaluate(panel=>panel.lastElementChild.className),'decisionNotice');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,preset.id+' overflow');
    for (const link of await page.locator('a.sourceButton').all()) {
     assert.equal(await link.getAttribute('target'),'_blank'); assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
     assert.equal(await link.getAttribute('referrerpolicy'),'no-referrer');
     const href = await link.getAttribute('href'); assert.ok(result.sources.some(source=>source.source.verifiedUrl===href));
    }
    if (preset.id==='pregSerial') { assert.ok(result.renderedText.includes('An empty uterus on transvaginal ultrasound')); assert.ok(!result.renderedText.toLowerCase().includes('normal ultrasound')); }
    if (preset.id==='pregUnsupported') assert.ok((await page.locator('.responseCard').innerText()).includes('Evidence coverage is insufficient'));
    if (['pregDetailed','pregDizziness'].includes(preset.id)) await page.screenshot({path:path.join(__dirname,'../screenshots/Module02'+preset.id+viewport.name+'.png'),fullPage:true});
    const detail = page.locator('button.sourceButton').first();
    if (await detail.count()) { await detail.click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); }
    assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
    report.checks.push({viewport:viewport.name,preset:preset.id,status:response.status(),outcome:result.response.responseType,passed:true});
   }
   await page.getByRole('button',{name:'Clear case',exact:true}).click();
   assert.equal(await page.locator('#narrative').inputValue(),'');
   assert.equal(await page.locator('#gestationalWeeks').count(),0);
   await page.reload(); await page.locator('#module').waitFor();
   assert.equal(await page.locator('#module').inputValue(),'');
   await context.close();
  }
  assert.equal(report.externalRequests,0); assert.equal(report.pageErrors,0);
  fs.writeFileSync(path.join(__dirname,'../screenshots/module02BrowserResults.json'),JSON.stringify(report,null,2));
  console.log(report.checks.length+' Module 2 browser-to-API checks passed; zero external requests and page errors.');
 } finally { await browser.close(); }
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
