async function selectModule(page, moduleId) {
 await page.locator(`input[name=clinicalModule][value="${moduleId}"]`).check();
 const context = page.locator('.additionalContext');
 if (!(await context.getAttribute('open') !== null)) await context.locator('summary').first().click();
}
// Actual local HTTP/browser checks. Reports contain outcomes/counts, never case text.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DEMO_PLAYWRIGHT_MODULE);
const Origin = process.env.EVALUATION_ORIGIN || 'http://127.0.0.1:5191';
assert.equal(new URL(Origin).hostname, '127.0.0.1');
const Banner = 'Evaluation system — clinician-facing decision support only. Use de-identified, minimum-necessary information.';
const PregnancyCases = require('../src/PregnancyCases.json');
const SchemaCases = require('../../tests/fixtures/clinicalDataCases.json');
const Expected = { pregBrief:[200,'AgentResponse'], pregDetailed:[200,'AgentResponse'], pregEmergency:[200,'AgentResponse'], pregDizziness:[200,'AgentResponse'], pregUnsupported:[503,'EvidenceInsufficient'], pregConflict:[200,'DataConflict'], pregTesting:[200,'EvidenceInsufficient'], pregSerial:[200,'AgentResponse'], pregOutside:[200,'OutsideScope'], pregInjection:[200,'EvidenceInsufficient'] };
const Module1Cases = [['Brief','AgentResponse'],['Mild/nonurgent','AgentResponse'],['Detailed','AgentResponse'],['Urgent warning','AgentResponse'],['Conflict','DataConflict'],['Clarification','ClarificationRequired'],['Outside scope','OutsideScope']];
const report = { checks:[], externalRequests:0, pageErrors:0, routes:[] };

async function run() {
 const browser = await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost']});
 try {
  for (const viewport of [{name:'Desktop',width:1680,height:1100},{name:'Tablet',width:820,height:1180},{name:'Mobile',width:390,height:1000}]) {
   const context = await browser.newContext({viewport,serviceWorkers:'block'});
   await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== Origin) { report.externalRequests++; return route.abort(); }
    return route.continue();
   });
   await context.routeWebSocket('**/*', route => {
    if (new URL(route.url()).host === new URL(Origin).host) route.connectToServer();
    else { report.externalRequests++; route.close(); }
   });
   const page = await context.newPage();
   page.on('pageerror',()=>report.pageErrors++);
   // A direct non-root URL must survive the production SPA fallback and refresh.
   await page.goto(Origin+'/review');
   await page.reload();
   await page.getByText(Banner,{exact:true}).waitFor();
   for (const scenario of [...Module1Cases.map(([label,outcome])=>({id:label,label,moduleId:'module_01_endo',status:200,outcome})),...PregnancyCases.map(preset=>({id:preset.id,label:preset.label,moduleId:preset.moduleId,status:Expected[preset.id][0],outcome:Expected[preset.id][1]}))]) {
    await page.getByRole('button',{name:'Clear case',exact:true}).click();
    assert.equal(await page.locator('input[name=clinicalModule]:checked').count(),0);
    await page.getByLabel('Try a demonstration case').selectOption({label:scenario.label});
    assert.equal(await page.locator('input[name=clinicalModule]:checked').inputValue(),scenario.moduleId);
    assert.equal(await page.locator('.additionalContext').getAttribute('open'),null);
    await page.getByText('Demonstration case loaded — verify the selected module and case information before analyzing',{exact:true}).waitFor();
    const received = page.waitForResponse(response=>response.url().endsWith('/api/v1/analyze') && response.request().method()==='POST');
    await page.getByRole('button',{name:'Analyze case',exact:true}).click();
    const response = await received;
    assert.equal(response.status(),scenario.status,scenario.id);
    const result = await response.json();
    assert.equal(result.response.responseType,scenario.outcome,scenario.id);
    await page.locator('.responseCard:not(.pendingResponse)').waitFor();
    if (result.warnings.length) assert.ok(result.renderedText.startsWith(result.warnings[0].text));
    assert.ok(result.renderedText.endsWith(result.response.decisionSupportNotice));
    await page.locator('.decisionNotice').waitFor();
    const sourceToggle = page.getByRole('button', { name: /^Sources \(/ });
    if (await sourceToggle.count()) await sourceToggle.click();
    for (const link of await page.locator('a.sourceButton').all()) {
     assert.equal(await link.getAttribute('target'),'_blank');
     assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
     assert.equal(await link.getAttribute('referrerpolicy'),'no-referrer');
     const href = await link.getAttribute('href');
     assert.ok(result.sources.some(source=>source.source.verifiedUrl===href));
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,scenario.id+' overflow');
    assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
    report.checks.push({viewport:viewport.name,id:scenario.id,status:response.status(),outcome:result.response.responseType});
   }
   for (const [id,narrative,phrase,outcome='AgentResponse'] of [
    ['manualTvus','Normal transvaginal ultrasound. Does this exclude endometriosis?','does not exclude'],
    ['manualMri','Normal MRI. Does this exclude endometriosis?','does not establish'],
    ['manualCa125','Can CA-125 diagnose endometriosis?','CA-125'],
    ['prescribingOnly','Select the best medication, provide the exact dose and duration, and write a prescription plan.','Medication selection, dosing and patient-specific prescribing are outside this system’s scope.','OutsideScope'],
    ['mixedPrescribing','Normal transvaginal ultrasound. Does this exclude endometriosis? Select the best medication.','does not exclude'],
   ]) {
    await page.getByRole('button',{name:'Clear case',exact:true}).click();
    await selectModule(page, 'module_01_endo');
    await page.locator('#narrative').fill(narrative);
    const received = page.waitForResponse(response=>response.url().endsWith('/api/v1/analyze') && response.request().method()==='POST');
    await page.getByRole('button',{name:'Analyze case',exact:true}).click();
    const response = await received; const result = await response.json();
    assert.equal(response.status(),200); assert.equal(result.response.responseType,outcome);
    assert.ok(result.renderedText.includes(phrase));
    await page.locator('.decisionNotice').waitFor();
    const sourceToggle = page.getByRole('button', { name: /^Sources \(/ });
    if (await sourceToggle.count()) await sourceToggle.click();
    const details = page.locator('button.sourceButton').first();
    if (await details.count()) { await details.click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); }
    report.checks.push({viewport:viewport.name,id,status:response.status(),outcome:result.response.responseType});
   }
   // Exercise the real form's structured mapping and actual function route.
   await page.getByRole('button',{name:'Clear case',exact:true}).click();
   await selectModule(page, 'module_02_early_pregnancy');
   await page.locator('#pregnancy').selectOption('yes');
   await page.locator('#gestationalWeeks').fill('6');
   for(const [field,selection] of Object.entries({careSetting:'emergencyDepartment',pregnancyTestType:'serum',pregnancyTestResult:'positive',ultrasoundRoute:'transvaginal',ultrasoundFinding:'noPregnancyVisualized',clinicallyStable:'yes',previousIntrauterinePregnancyConfirmed:'no',assistedReproduction:'no',abdominalTrauma:'no'}))await page.locator('#'+field).selectOption(selection);
   await page.locator('#narrative').fill('Mild pelvic discomfort and light spotting. One single serum hCG result is available. Can this exclude ectopic pregnancy after the ultrasound?');
   const receivedHcg=page.waitForResponse(response=>response.url().endsWith('/api/v1/analyze')&&response.request().method()==='POST');
   await page.getByRole('button',{name:'Analyze case',exact:true}).click();
   const responseHcg=await receivedHcg,resultHcg=await responseHcg.json();
   assert.equal(resultHcg.response.responseType,'AgentResponse');
   assert.deepEqual(resultHcg.sources.map(cited=>cited.source.sourceId),['ACEP-EARLYPREG-2017']);
   await page.locator('.directAnswer').filter({hasText:'One blood pregnancy-hormone result cannot rule out ectopic pregnancy'}).waitFor();
   report.checks.push({viewport:viewport.name,id:'manualSingleHcg',status:responseHcg.status(),outcome:resultHcg.response.responseType});
   const canonicalResult=await page.evaluate(async canonical=>{
    const response=await fetch('/api/v1/analyze',{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(canonical)});
    const result=await response.json();return {status:response.status,outcome:result.response?.responseType,sourceIds:result.sources?.map(cited=>cited.source.sourceId)};
   },SchemaCases.cases.find(example=>example.id==='module2').case);
   assert.equal(canonicalResult.status,200);assert.equal(canonicalResult.outcome,'AgentResponse');assert.deepEqual(canonicalResult.sourceIds,['ACEP-EARLYPREG-2017']);
   report.checks.push({viewport:viewport.name,id:'canonicalRequest',status:canonicalResult.status,outcome:canonicalResult.outcome});
   await page.getByRole('button',{name:'Clear case',exact:true}).click();
   await selectModule(page, 'module_01_endo');
   await page.locator('#narrative').fill('Normal MRI. Does this exclude endometriosis?');
   const pending=page.waitForRequest(request=>request.url().endsWith('/api/v1/analyze')&&request.method()==='POST');
   await page.getByRole('button',{name:'Analyze case',exact:true}).click();await pending;
   await page.getByRole('button',{name:'Clear case',exact:true}).click();
   await page.waitForTimeout(1200);
   await page.getByText('Your response will appear here after submission.',{exact:true}).waitFor();
   assert.equal(await page.locator('.decisionNotice').count(),0);
   assert.equal(await page.locator('#narrative').inputValue(),'');
   await page.reload(); await page.getByText(Banner,{exact:true}).waitFor();
   assert.equal(await page.locator('#narrative').inputValue(),'');
   assert.equal(await page.locator('input[name=clinicalModule]:checked').evaluateAll(radios => radios[0]?.value || ''),'');
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await page.locator('.primaryButton').evaluate(button=>getComputedStyle(button).animationName),'none');
   fs.mkdirSync(path.join(__dirname,'../screenshots'),{recursive:true});
   await page.screenshot({path:path.join(__dirname,'../screenshots/PublicEvaluation'+viewport.name+'.png'),fullPage:true});
   await context.close();
  }
  assert.equal(report.externalRequests,0); assert.equal(report.pageErrors,0);
  fs.writeFileSync(path.join(__dirname,'../screenshots/publicEvaluationBrowser.json'),JSON.stringify(report,null,2));
  console.log(report.checks.length+' actual-route evaluation browser scenarios passed; zero external requests and page errors.');
 } finally { await browser.close(); }
}
run().catch(error=>{ console.error('Evaluation browser validation failed at '+(error.stack?.split('\n').find(line=>line.includes('evaluationBrowser.cjs:'))?.trim()||'browser operation')+'; transport: '+(error.message?.match(/net::[A-Z_]+/)?.[0]||error.name)+'; completed checks: '+report.checks.length+'. No case payloads logged.'); process.exitCode=1; });
