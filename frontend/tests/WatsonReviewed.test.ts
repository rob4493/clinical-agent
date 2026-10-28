// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShadowAdapter, shadowHeaders, type ShadowReason } from '../../netlify/evaluation/watsonShadow';
import { offerPresentation, validateReviewed, publicPresentation, type ReviewedOffer, type ReviewedOutput } from '../../netlify/evaluation/reviewedPresentation';
import { analyze, type Analysis } from '../../netlify/evaluation/analysis';
import { loadPackages, Module1, Module2 } from '../../netlify/evaluation/packages';
import { validateCase } from '../../netlify/evaluation/input';
import { PrescribingNotice } from '../../netlify/evaluation/requestPolicy';
import evaluate from '../../netlify/functions/evaluate';
import Mappings from '../../shared/reviewedVariants.json';
import Cases from '../src/PregnancyCases.json';
import { DemoCases } from '../src/DemoCases';
import Content from '../.evaluationBundle/content.json';

const Environment={WATSONX_ENABLED:'true',WATSONX_PRESENTATION_MODE:'reviewed',WATSONX_AI_AUTH_TYPE:'iam',WATSONX_AI_APIKEY:'syntheticReviewedKey',WATSONX_AI_PROJECT_ID:'12345678-1234-4123-8123-123456789abc',WATSONX_AI_URL:'https://us-south.ml.cloud.ibm.com',WATSONX_AI_MODEL_ID:'example/synthetic-model',WATSONX_AI_API_VERSION:'2024-03-14'};
const Packages=loadPackages();
function json(payload:unknown,status=200){return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json'}});}
function output(offer:ReviewedOffer):ReviewedOutput {
 return {presentationVersion:'1',paragraphs:[{selections:offer.findings.map(finding=>({presentationId:finding.presentationId,variantId:finding.variants[0].variantId}))}]};
}
function transport(change?:(text:string)=>string){return vi.fn(async(url:string,init:RequestInit)=>{
 if(url.includes('/identity/token'))return json({access_token:'syntheticReviewedBearer',token_type:'Bearer',expires_in:3600});
 const body=JSON.parse(init.body as string),offer=JSON.parse(body.messages[1].content) as ReviewedOffer;
 const text=JSON.stringify(output(offer));
 return json({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:change?change(text):text}}]});
});}
function module1(){return analyze(validateCase({moduleHint:Module1,caseType:'brief',additionalNotes:'Normal transvaginal ultrasound. Does this exclude endometriosis?'}),Packages);}
function module2(notes:string,context:Record<string,unknown>={}) {
 return analyze(validateCase({moduleHint:Module2,caseType:'detailed',pregnancyPossible:true,additionalNotes:notes,earlyPregnancy:{gestationalWeeks:6,pregnancyTestType:'serum',pregnancyTestResult:'positive',...context}}),Packages);
}
const Location={ultrasoundRoute:'transvaginal',ultrasoundFinding:'noPregnancyVisualized',previousIntrauterinePregnancyConfirmed:false};
const Stable={careSetting:'emergencyDepartment',clinicallyStable:true,previousIntrauterinePregnancyConfirmed:false,assistedReproduction:false,abdominalTrauma:false,ultrasoundRoute:'transvaginal',ultrasoundFinding:'indeterminate'};
const Routes:[string,Record<string,unknown>][]=[
 ['Mild pelvic pain and spotting.',{}],['Vaginal bleeding.',{}],['Mild pelvic pain.',Location],
 ['Pregnancy of unknown location PUL.',Location],['How is serum hCG interpreted for pregnancy location?',Location],
 ['How is a serial hCG trend interpreted with this ultrasound scan?',Location],
 ['How is serum hCG interpreted with a changed scan context?',Location],
 ['How is serial hCG with a reassuring trend interpreted on ultrasound?',Location],
 ['How is this ultrasound scan interpreted?',Location],
 ['What does this ultrasound establish about pregnancy loss?',{ultrasoundRoute:'transvaginal',ultrasoundFinding:'indeterminate'}],
 ['Mild pelvic pain. How is serum hCG interpreted?',Stable],
 ['Mild pelvic pain. Can a single serum hCG result exclude ectopic pregnancy?',Stable],
 ['Mild pelvic pain. How should serial hCG be interpreted?',Stable],
];
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});

describe('closed reviewed presentation vocabulary',()=>{
 it('binds every new mapping to exact public claims and sources without modifying them',()=>{
  const entry=Packages.find(entry=>entry.moduleId===Module2)!;
  for(const mapping of Mappings.entries) {
   expect(mapping.moduleId).toBe(Module2);expect(mapping.claimIds.length).toBeGreaterThan(0);
   expect([...new Set(mapping.claimIds.map(id=>entry.claims.find(claim=>claim.claimId===id)!.sourceId))].sort()).toEqual([...mapping.sourceIds].sort());
   expect(mapping.wording).not.toMatch(/https?:|<|you have|definitely|take medication/i);
   const result:Analysis={status:200,envelope:{warnings:[],response:{responseType:'AgentResponse',moduleId:Module2,supportedInterpretations:[{text:mapping.original,citations:mapping.sourceIds.map(sourceTag=>({sourceTag}))}]},sources:mapping.sourceIds.map((sourceId,index)=>({number:index+1,source:{sourceId}})),renderedText:'Synthetic bounded result.'}};
   const offer=offerPresentation(result,Packages)!;expect(offer).not.toBeNull();expect(offer.findings.map(finding=>finding.variants[0].text).join(' ')).toBe(mapping.wording);
  }
 });
 it.each(Routes)('supports an ordinary Module 2 response without expanding clinical eligibility: %s',async(notes,context)=>{
  const result=module2(notes,context),before=JSON.stringify(result),callback=vi.fn();expect(result.envelope.response.responseType).toBe('AgentResponse');expect(result.envelope.warnings).toHaveLength(0);
  expect(await createShadowAdapter(transport())(result,Packages,new AbortController().signal,undefined,Environment,undefined,callback)).toBe('reviewed-success');expect(callback).toHaveBeenCalledOnce();expect(JSON.stringify(result)).toBe(before);
 });
 it('supports Module 1 and deterministic ordering/grouping of complete variants only',()=>{
  const offer=offerPresentation(module2('Mild pelvic pain.',Location),Packages)!,returned=output(offer);
  returned.paragraphs=offer.findings.slice().reverse().slice(0,2).map((finding,index)=>{
   const group=index===0?[finding]:offer.findings.slice().reverse().slice(1);
   return {selections:group.map(finding=>({presentationId:finding.presentationId,variantId:finding.variants[0].variantId}))};
  });
  expect(()=>validateReviewed(returned,offer)).not.toThrow();expect(offerPresentation(module1(),Packages)).not.toBeNull();
 });
 it('sends no clinical case fields, source links, metadata or reflected text',async()=>{
  const result=module1();Object.assign(result.envelope.response,{additionalNotes:'NarrativeSentinel',ageRange:'DemographicSentinel',measurements:'MeasurementSentinel',uploads:'UploadSentinel',filename:'FilenameSentinel'});
  result.envelope.renderedText+=' ReflectedCaseSentinel';const fetch=transport();expect(await createShadowAdapter(fetch)(result,Packages,new AbortController().signal,undefined,Environment)).toBe('reviewed-success');
  const body=JSON.parse(fetch.mock.calls[1][1].body as string),user=body.messages[1].content;
  expect(Object.keys(JSON.parse(user))).toEqual(['presentationVersion','findings','outputSchema']);
  expect(user).not.toMatch(/Sentinel|moduleId|sourceId|https?:|citation|additionalNotes|ageRange|uploads|filename|measurements|demographics/i);
  expect(body.response_format).toEqual({type:'json_object'});expect(body.max_tokens).toBe(1024);expect(body.temperature).toBe(0);
 });
 it.each(['text','qualification','unknownId','variant','claim','url','extra','missing','duplicate','version','key','markdown','empty'])('rejects %s with unchanged deterministic fallback and no display callback',async mode=>{
  const result=module1(),before=JSON.stringify(result),callback=vi.fn(),reason=vi.fn(),fetch=transport(text=>{
   const returned=JSON.parse(text),paragraph=returned.paragraphs[0];
   if(mode==='text')paragraph.text='Unsupported provider fact.';if(mode==='qualification')paragraph.text='An altered qualification.';
   if(mode==='unknownId')paragraph.selections[0].presentationId='Punknown';if(mode==='variant')paragraph.selections[0].variantId='Vunknown';
   if(mode==='claim')paragraph.claimIds=['Unknown'];if(mode==='url')paragraph.text='https://example.invalid';if(mode==='extra')paragraph.extra='PrivateProviderSentinel';
   if(mode==='missing')paragraph.selections=[];if(mode==='duplicate')paragraph.selections.push(paragraph.selections[0]);if(mode==='version')returned.presentationVersion='2';if(mode==='empty')returned.paragraphs=[];
   if(mode==='key')return '{"presentationVersion":"1","presentationVersion":"1","paragraphs":[]}';if(mode==='markdown')return '```json\n'+text+'\n```';return JSON.stringify(returned);
  });
  expect(await createShadowAdapter(fetch)(result,Packages,new AbortController().signal,undefined,Environment,reason,callback)).toBe('reviewed-fallback');expect(reason).toHaveBeenCalledExactlyOnceWith('presentation-validation');expect(callback).not.toHaveBeenCalled();expect(JSON.stringify(result)).toBe(before);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it.each(['configuration','iam-rejected','iam-response','model-rejected','model-response','internal'] as ShadowReason[])('preserves safe %s fallback with zero retries',async category=>{
  const base=transport(),reason=vi.fn(),display=vi.fn(),fetch=vi.fn(async(url:string,init:RequestInit)=>{
   const iam=url.includes('/identity/token');
   if(category==='internal')throw new Error('PrivateFailureSentinel');
   if(category===(iam?'iam-rejected':'model-rejected'))return json({error:'PrivateBodySentinel'},503);
   if(category===(iam?'iam-response':'model-response'))return json({private:'PrivateBodySentinel'});
   return base(url,init);
  });
  expect(await createShadowAdapter(fetch)(module1(),Packages,new AbortController().signal,undefined,{...Environment,...(category==='configuration'?{WATSONX_AI_AUTH_TYPE:'other'}:{})},reason,display)).toBe('reviewed-fallback');expect(reason).toHaveBeenCalledWith(category);expect(display).not.toHaveBeenCalled();expect(fetch.mock.calls.length).toBeLessThanOrEqual(2);
  expect(JSON.stringify(shadowHeaders('reviewed-fallback',category))).not.toMatch(/Sentinel|503|https|token|key/i);
 });
 it.each(['iam','model'] as const)('cancels transport and enforces a bounded %s deadline without retries',async phase=>{
  const timers:AbortController[]=[],nativeTimeout=AbortSignal.timeout.bind(AbortSignal);vi.spyOn(AbortSignal,'timeout').mockImplementation(()=>{const controller=new AbortController();timers.push(controller);return controller.signal;});
  const base=transport(),reason=vi.fn(),display=vi.fn();let active:AbortSignal|undefined;
  const fetch=vi.fn(async(url:string,init:RequestInit)=>{if((phase==='iam')===url.includes('/identity/token')){active=init.signal as AbortSignal;return new Promise<Response>(()=>{});}return base(url,init);});
  const pending=createShadowAdapter(fetch)(module1(),Packages,new AbortController().signal,undefined,Environment,reason,display);await vi.waitFor(()=>expect(active).toBeDefined());timers[0].abort();expect(await pending).toBe('reviewed-fallback');expect(reason).toHaveBeenCalledWith(phase+'-timeout');expect(active!.aborted).toBe(true);expect(display).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(phase==='iam'?1:2);
  vi.mocked(AbortSignal.timeout).mockImplementation(nativeTimeout);
 });
 it('preserves concurrent refresh waiters and isolates generation cancellation',async()=>{
  const base=transport(),waiting:{signal:AbortSignal;release:(response:Response)=>void;offer:ReviewedOffer}[]=[];
  const fetch=vi.fn((url:string,init:RequestInit)=>url.includes('/identity/token')?base(url,init):new Promise<Response>(release=>waiting.push({signal:init.signal as AbortSignal,release,offer:JSON.parse(JSON.parse(init.body as string).messages[1].content)})));
  const adapter=createShadowAdapter(fetch),one=new AbortController(),two=new AbortController(),display1=vi.fn(),display2=vi.fn();
  const first=adapter(module1(),Packages,one.signal,undefined,Environment,undefined,display1),second=adapter(module1(),Packages,two.signal,undefined,Environment,undefined,display2);
  await vi.waitFor(()=>expect(waiting).toHaveLength(2));one.abort();expect(await first).toBe('reviewed-fallback');expect(waiting[0].signal.aborted).toBe(true);expect(waiting[1].signal.aborted).toBe(false);
  waiting[1].release(json({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(output(waiting[1].offer))}}]}));expect(await second).toBe('reviewed-success');expect(display1).not.toHaveBeenCalled();expect(display2).toHaveBeenCalledOnce();expect(fetch.mock.calls.filter(([url])=>url.includes('/identity/token'))).toHaveLength(1);
 });
 it.each(['DataConflict','ClarificationRequired','EvidenceInsufficient','OutsideScope','ProviderUnavailable','ModuleUnavailable'])('skips %s without transport',async responseType=>{
  const result=module1();result.envelope.response.responseType=responseType;const fetch=transport();expect(await createShadowAdapter(fetch)(result,Packages,new AbortController().signal,undefined,Environment)).toBe('skipped');expect(fetch).not.toHaveBeenCalled();
 });
 it('skips urgent, prescribing, case-specific and disabled responses',async()=>{
  const urgent=module2('Sudden severe pelvic pain and shoulder pain.'),prescribing=module1(),unknown=module1();prescribing.envelope.renderedText=PrescribingNotice+prescribing.envelope.renderedText;(unknown.envelope.response.supportedInterpretations as {text:string}[])[0].text+=' Case-specific addition.';
  for(const result of [urgent,prescribing,unknown]){const fetch=transport();expect(await createShadowAdapter(fetch)(result,Packages,new AbortController().signal,undefined,Environment)).toBe('skipped');expect(fetch).not.toHaveBeenCalled();}
  const fetch=transport();expect(await createShadowAdapter(fetch)(module1(),Packages,new AbortController().signal,undefined,{...Environment,WATSONX_ENABLED:'false'})).toBe('skipped');expect(fetch).not.toHaveBeenCalled();
 });
 it('constructs source numbers locally and rejects missing bindings',()=>{
  const result=module1(),offer=offerPresentation(result,Packages)!,returned=output(offer),projected=publicPresentation(returned,offer,result,Packages);expect(projected.paragraphs[0].numbers).toEqual(result.envelope.sources.map(source=>source.number));expect(JSON.stringify(projected)).not.toMatch(/claimId|variantId|presentationId|sourceId|https?:/);
  result.envelope.sources=[];expect(()=>publicPresentation(returned,offer,result,Packages)).toThrow('Invalid presentation.');
 });
 it('returns only a separate optional presentation from the actual Function; every failure retains the complete original envelope',async()=>{
  const request=()=>new Request('http://localhost/api/v1/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({moduleHint:Module1,additionalNotes:'Normal transvaginal ultrasound. Does this exclude endometriosis?'})});
  vi.stubEnv('WATSONX_ENABLED','false');const baseline=await (await evaluate(request())).json();for(const [key,value] of Object.entries(Environment))vi.stubEnv(key,value);
  vi.stubGlobal('fetch',transport());const success=await evaluate(request()),payload=await success.json();expect(success.headers.get('X-Endo-Watson')).toBe('reviewed-success');const {reviewedPresentation,...deterministic}=payload;expect(deterministic).toEqual(baseline);expect(reviewedPresentation.paragraphs.length).toBe(1);
  vi.stubGlobal('fetch',transport(()=>'{'));const failed=await evaluate(request());expect(failed.headers.get('X-Endo-Watson')).toBe('reviewed-fallback');expect(await failed.json()).toEqual(baseline);
 });
 it('keeps all preset halts and urgent cases ineligible and emits nothing during discovery',async()=>{
  for(const example of Cases){const result=analyze(validateCase({moduleHint:example.moduleId,caseType:example.caseType,pregnancyPossible:example.pregnancy==='yes'?true:example.pregnancy==='no'?false:null,additionalNotes:example.narrative,earlyPregnancy:example.earlyPregnancy}),Packages);if(['pregBrief','pregDetailed','pregSerial'].includes(example.id))expect(offerPresentation(result,Packages)).not.toBeNull();else expect(offerPresentation(result,Packages)).toBeNull();}
  for(const [key,value] of Object.entries(Environment))vi.stubEnv(key,value);const fetch=transport();vi.stubGlobal('fetch',fetch);
  for(const path of ['/health','/ready','/v1/modules','/v1/runtime'])expect((await evaluate(new Request('http://localhost/api'+path))).status).toBe(200);expect(fetch).not.toHaveBeenCalled();
 });
 it('discards even accepted display content when final provenance becomes invalid',async()=>{
  for(const [key,value] of Object.entries(Environment))vi.stubEnv(key,value);
  const name='evaluation/review.json',files=Content.files as Record<string,string>,original=files[name],base=transport();
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{const response=await base(url,init);if(!url.includes('/identity/token'))files[name]=Buffer.from('invalid').toString('base64');return response;}));
  try {
   const response=await evaluate(new Request('http://localhost/api/v1/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({moduleHint:Module1,additionalNotes:'Normal transvaginal ultrasound. Does this exclude endometriosis?'})}));
   expect(response.status).toBe(503);expect((await response.json()).reviewedPresentation).toBeUndefined();
  } finally {files[name]=original;}
 });
 it('returns no clinical or display body to a disconnected client and cancels model transport',async()=>{
  for(const [key,value] of Object.entries(Environment))vi.stubEnv(key,value);
  let active:AbortSignal|undefined;const base=transport();vi.stubGlobal('fetch',vi.fn((url:string,init:RequestInit)=>{if(url.includes('/identity/token'))return base(url,init);active=init.signal as AbortSignal;return new Promise<Response>(()=>{});}));
  const owner=new AbortController(),pending=evaluate(new Request('http://localhost/api/v1/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({moduleHint:Module1,additionalNotes:'Normal transvaginal ultrasound. Does this exclude endometriosis?'}),signal:owner.signal}));
  await vi.waitFor(()=>expect(active).toBeDefined());owner.abort();const response=await pending;expect(response.status).toBe(499);expect(await response.text()).toBe('');expect(active!.aborted).toBe(true);
 });
 it('never logs rejected content or returns metadata/credentials in diagnostics',async()=>{
  const logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')],reason=vi.fn();await createShadowAdapter(transport(()=>'{"PrivateProviderSentinel":true}'))(module1(),Packages,new AbortController().signal,undefined,Environment,reason);for(const log of logs)expect(log).not.toHaveBeenCalled();expect(shadowHeaders('reviewed-success')).toEqual({'X-Endo-Watson':'reviewed-success'});expect(shadowHeaders('skipped')).toEqual({'X-Endo-Watson':'skipped'});
 });
});

describe('opaque reviewed selections and trusted reconstruction',()=>{
 function multiple1(){return analyze(validateCase({moduleHint:Module1,caseType:'brief',pregnancyPossible:false,pidDiagnosedOrPresumed:false,additionalNotes:DemoCases.find(example=>example.id==='brief')!.narrative}),Packages);}
 it.each([1,2])('accepts multi-finding Module 1 in %s paragraphs with no returned clinical fields',async count=>{
  const result=multiple1(),offer=offerPresentation(result,Packages)!;expect(offer.findings.length).toBeGreaterThan(1);const before=JSON.stringify(result),display=vi.fn();
  const fetch=transport(text=>{
   const returned=JSON.parse(text),selections=returned.paragraphs[0].selections.slice().reverse();
   returned.paragraphs=count===1?[{selections}]:[{selections:selections.slice(0,1)},{selections:selections.slice(1)}];
   expect(Object.keys(returned)).toEqual(['presentationVersion','paragraphs']);expect(returned.paragraphs.every((paragraph:{selections:unknown[]})=>Object.keys(paragraph).join('|')==='selections')).toBe(true);return JSON.stringify(returned);
  });
  expect(await createShadowAdapter(fetch)(result,Packages,new AbortController().signal,undefined,Environment,undefined,display)).toBe('reviewed-success');
  const projected=display.mock.calls[0][0],findings=offer.findings.slice().reverse(),groups=count===1?[findings]:[findings.slice(0,1),findings.slice(1)];
  expect(projected.paragraphs).toHaveLength(count);
  groups.forEach((group,index)=>{
   const variants=group.map(finding=>finding.variants[0]),claims=[...new Set(variants.flatMap(variant=>variant.claimIds))];
   const numbers=[...new Set(claims.map(id=>result.envelope.sources.find(source=>source.source.sourceId===Packages[0].claims.find(claim=>claim.claimId===id)!.sourceId)!.number))].sort((left,right)=>left-right);
   expect(Buffer.from(projected.paragraphs[index].text)).toEqual(Buffer.from(variants.map(variant=>variant.text).join(' ')));expect(projected.paragraphs[index].numbers).toEqual(numbers);expect(Object.keys(projected.paragraphs[index])).toEqual(['text','numbers']);
  });
  expect(JSON.stringify(result)).toBe(before);expect(projected).not.toHaveProperty('claimIds');
 });
 it('offers a strict selections-only output schema while retaining trusted input bindings',()=>{
  const offer=offerPresentation(multiple1(),Packages)!;
  const schema=offer.outputSchema;expect(schema.additionalProperties).toBe(false);expect(schema.required).toEqual(['presentationVersion','paragraphs']);
  expect(schema.properties.paragraphs.minItems).toBe(1);expect(schema.properties.paragraphs.maxItems).toBe(2);
  const paragraph=schema.properties.paragraphs.items;expect(paragraph.required).toEqual(['selections']);expect(Object.keys(paragraph.properties)).toEqual(['selections']);expect(paragraph.additionalProperties).toBe(false);expect(paragraph.properties.selections.minItems).toBe(1);expect(paragraph.properties.selections.maxItems).toBe(10);expect(paragraph.properties.selections.items.additionalProperties).toBe(false);
  expect(offer.findings.every(finding=>finding.variants.every(variant=>variant.text.length>0&&variant.claimIds.length>0))).toBe(true);
 });
 it.each([{label:'empty',wording:''},{label:'oversized',wording:'x'.repeat(16001)}])('retains $label trusted paragraph checks',({wording})=>{
  const offer=offerPresentation(module1(),Packages)!;offer.findings[0].variants[0].text=wording;
  expect(()=>validateReviewed(output(offer),offer)).toThrow('Invalid presentation.');
 });
 it.each(['exactText','exactClaims','rootText','rootClaims','rootExtra','selectionExtra','crossedVariant','alteredId','missingFinding','duplicateAcrossParagraphs','emptyParagraph','tooManyParagraphs','tooManySelections','wrongSelections','wrongIdType','nestedDuplicateKey'])('rejects %s and retains the complete deterministic Function response',async mode=>{
  const request=()=>new Request('http://localhost/api/v1/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({moduleHint:Module1,caseType:'brief',pregnancyPossible:false,pidDiagnosedOrPresumed:false,additionalNotes:DemoCases.find(example=>example.id==='brief')!.narrative})});
  vi.stubEnv('WATSONX_ENABLED','false');const baseline=await evaluate(request()),original=await baseline.text();for(const [key,value] of Object.entries(Environment))vi.stubEnv(key,value);
  const offer=offerPresentation(multiple1(),Packages)!,fetch=transport(text=>{
   const returned=JSON.parse(text),part=returned.paragraphs[0],selection=part.selections[0];
   if(mode==='exactText')part.text=offer.findings.map(finding=>finding.variants[0].text).join(' ');
   if(mode==='exactClaims')part.claimIds=[...new Set(offer.findings.flatMap(finding=>finding.variants[0].claimIds))].sort();
   if(mode==='rootText')returned.text='Untrusted provider prose';if(mode==='rootClaims')returned.claimIds=[];if(mode==='rootExtra')returned.extra=true;if(mode==='selectionExtra')selection.text='Untrusted provider prose';
   if(mode==='crossedVariant')selection.variantId=part.selections[1].variantId;if(mode==='alteredId')selection.presentationId+='x';if(mode==='missingFinding')part.selections.pop();
   if(mode==='duplicateAcrossParagraphs')returned.paragraphs.push({selections:[selection]});if(mode==='emptyParagraph')returned.paragraphs.push({selections:[]});if(mode==='tooManyParagraphs')returned.paragraphs=[part,part,part];if(mode==='tooManySelections')part.selections=Array.from({length:11},()=>selection);if(mode==='wrongSelections')part.selections={};if(mode==='wrongIdType')selection.presentationId=1;
   if(mode==='nestedDuplicateKey')return '{"presentationVersion":"1","paragraphs":[{"selections":[{"presentationId":"'+selection.presentationId+'","variantId":"'+selection.variantId+'","variantId":"'+selection.variantId+'"}]}]}';
   return JSON.stringify(returned);
  });vi.stubGlobal('fetch',fetch);
  const response=await evaluate(request());expect(response.status).toBe(baseline.status);expect(await response.text()).toBe(original);expect(response.headers.get('X-Endo-Watson')).toBe('reviewed-fallback');expect(response.headers.get('X-Endo-Watson-Reason')).toBe('presentation-validation');expect(fetch.mock.calls.length).toBeLessThanOrEqual(2);
 });
 it('keeps reviewed instructions selection-only and IBM JSON mode unchanged',async()=>{
  const fetch=transport();expect(await createShadowAdapter(fetch)(module1(),Packages,new AbortController().signal,undefined,Environment)).toBe('reviewed-success');const body=JSON.parse(fetch.mock.calls[1][1].body as string);
  expect(body.messages[0].content).toContain('opaque IDs only');expect(body.messages[0].content).toContain('Do not return text, claimIds');expect(body.messages[0].content).not.toContain('Each paragraph text must be');expect(body.response_format).toEqual({type:'json_object'});
 });
});

describe('twelve-second reviewed operation budget',()=>{
 const Extended={...Environment,WATSONX_AI_TIMEOUT_MS:'12000'};
 function fakeDeadlines(){
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});
  return vi.spyOn(AbortSignal,'timeout').mockImplementation(duration=>{const owner=new AbortController();setTimeout(()=>owner.abort(new DOMException('Controlled deadline.','TimeoutError')),duration);return owner.signal;});
 }
 function delayed(iamDelay:number,modelDelay:number){
  const base=transport();return vi.fn((url:string,init:RequestInit)=>new Promise<Response>((resolve,reject)=>{
   const signal=init.signal as AbortSignal;
   if(signal.aborted){reject(new Error('Synthetic cancellation.'));return;}
   const abort=()=>{clearTimeout(timer);reject(new Error('Synthetic cancellation.'));};
   const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);void base(url,init).then(resolve,reject);},url.includes('/identity/token')?iamDelay:modelDelay);
   signal.addEventListener('abort',abort,{once:true});
  }));
 }
 it.each(['8001','11999','12000'])('accepts reviewed timeout %s without changing approved output',async timeout=>{
  const fetch=transport(),display=vi.fn(),reason=vi.fn();expect(await createShadowAdapter(fetch)(module1(),Packages,new AbortController().signal,undefined,{...Extended,WATSONX_AI_TIMEOUT_MS:timeout},reason,display)).toBe('reviewed-success');expect(display).toHaveBeenCalledOnce();expect(reason).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('rejects 12001 before any provider activity',async()=>{
  const fetch=transport(),reason=vi.fn();expect(await createShadowAdapter(fetch)(module1(),Packages,new AbortController().signal,undefined,{...Extended,WATSONX_AI_TIMEOUT_MS:'12001'},reason)).toBe('reviewed-fallback');expect(reason).toHaveBeenCalledExactlyOnceWith('configuration');expect(fetch).not.toHaveBeenCalled();
 });
 it('accepts an exact reviewed response between eight and twelve seconds',async()=>{
  fakeDeadlines();const fetch=delayed(500,9000),display=vi.fn(),reason=vi.fn();let settled=false;
  const pending=createShadowAdapter(fetch)(module1(),Packages,new AbortController().signal,undefined,Extended,reason,display).then(status=>{settled=true;return status;});
  await vi.advanceTimersByTimeAsync(8999);expect(settled).toBe(false);await vi.advanceTimersByTimeAsync(502);expect(await pending).toBe('reviewed-success');expect(display).toHaveBeenCalledOnce();expect(reason).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(2);
 });
 it.each([{iam:0,model:12001,budget:12000,elapsed:12001},{iam:7000,model:6000,budget:12000,elapsed:12001},{iam:0,model:6000,budget:5000,elapsed:5001}])('caps IAM plus model by the smaller configured/remaining budget: $budget',async scenario=>{
  fakeDeadlines();const fetch=delayed(scenario.iam,scenario.model),reason=vi.fn(),display=vi.fn(),result=module1(),before=JSON.stringify(result);
  const pending=createShadowAdapter(fetch)(result,Packages,new AbortController().signal,scenario.budget,Extended,reason,display);await vi.advanceTimersByTimeAsync(scenario.elapsed);
  expect(await pending).toBe('reviewed-fallback');expect(reason).toHaveBeenCalledExactlyOnceWith('model-timeout');expect(display).not.toHaveBeenCalled();expect((fetch.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);expect(fetch).toHaveBeenCalledTimes(2);expect(JSON.stringify(result)).toBe(before);
 });
 it('cancels during the extended window and never retries or emits a late presentation',async()=>{
  fakeDeadlines();const fetch=delayed(0,20000),owner=new AbortController(),display=vi.fn();const pending=createShadowAdapter(fetch)(module1(),Packages,owner.signal,undefined,Extended,undefined,display);
  await vi.advanceTimersByTimeAsync(9000);owner.abort();expect(await pending).toBe('reviewed-fallback');expect((fetch.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);await vi.advanceTimersByTimeAsync(25000);expect(display).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('returns the unchanged deterministic Function response after a twelve-second model timeout',async()=>{
  const request=()=>new Request('http://localhost/api/v1/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({moduleHint:Module1,additionalNotes:'Normal transvaginal ultrasound. Does this exclude endometriosis?'})});
  vi.stubEnv('WATSONX_ENABLED','false');const baseline=await evaluate(request()),expected=await baseline.text();
  for(const [key,value] of Object.entries(Extended))vi.stubEnv(key,value);vi.stubEnv('WATSONX_AI_APIKEY','syntheticTwelveSecondFunctionKey');const timers=fakeDeadlines(),fetch=delayed(0,13000);vi.stubGlobal('fetch',fetch);
  const pending=evaluate(request());for(let turn=0;turn<4;turn++)await new Promise<void>(resolve=>setImmediate(resolve));
  expect(timers).toHaveBeenCalledWith(15000);expect(timers).toHaveBeenCalledWith(12000);
  await vi.advanceTimersByTimeAsync(12001);const response=await pending;expect(response.status).toBe(baseline.status);expect(await response.text()).toBe(expected);expect(response.headers.get('X-Endo-Watson')).toBe('reviewed-fallback');expect(response.headers.get('X-Endo-Watson-Reason')).toBe('model-timeout');expect(fetch).toHaveBeenCalledTimes(2);expect((fetch.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);expect(JSON.stringify([...response.headers])).not.toMatch(/synthetic|cloud\.ibm|Error:|503/);
 });
});
