// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {hashBytes} from '../../netlify/evaluation/packages';
import {createReceipts,SessionError} from '../../netlify/evaluation/visitReceipt';
import {createChat,chatAvailable,chatCapability,validateDiscussion,DiscussionError,ChatError,chatFailure} from '../../netlify/evaluation/orchestrateChat';
import {createAdmission} from '../../netlify/evaluation/demoAdmission';
import {ownThread} from '../../netlify/evaluation/threadOwner';
import {QuotaError,type QuotaStore} from '../../netlify/evaluation/demoQuota';
import {createConverse,config} from '../../netlify/functions/converse';
import Prompts from '../../shared/orchestratePrompts.json';
import * as Analysis from '../../netlify/evaluation/analysis';
import {loadPackages,Module1} from '../../netlify/evaluation/packages';
import {validateCase} from '../../netlify/evaluation/input';
import type {Transport} from '../../netlify/evaluation/watsonShadow';
const Settings={ORCHESTRATE_SYNTHETIC_POLICY_HASH:hashBytes(JSON.stringify(Prompts)),ORCHESTRATE_ENABLED:'true',ORCHESTRATE_API_URL:'https://api.dl.watson-orchestrate.ibm.com/instances/SyntheticTenant',ORCHESTRATE_AGENT_ID:'11111111-1111-4111-8111-111111111111',ORCHESTRATE_ENVIRONMENT:'live',WATSONX_AI_AUTH_TYPE:'iam',WATSONX_AI_APIKEY:'SyntheticExistingServerKey',WATSONX_AI_TIMEOUT_MS:'1000',ORCHESTRATE_SYNTHETIC_AUTHORIZED:'true',ORCHESTRATE_DISCUSSION_AUTHORIZED:'true',ORCHESTRATE_HOSTED_CONTROLS_VERIFIED:'true',ENDO_DEMO_INFERENCE_ENABLED:'true',ENDO_DEMO_KILL_SWITCH:'false',ENDO_DEMO_DAILY_LIMIT:'3',OTEL_SDK_DISABLED:'true'};
const Thread='22222222-2222-4222-8222-222222222222';
const signal=()=>new AbortController().signal;
function atomicStore(){const records=new Map<string,{data:unknown;etag:string}>();const store:QuotaStore={async set(key,content){if(records.has(key))return {modified:false};const etag=String(records.size+1);records.set(key,{data:JSON.parse(content),etag});return {modified:true,etag};},async getWithMetadata(key){return records.get(key)??null;}};return {store,records};}
function fixture(change?:Partial<typeof Settings>,reply='Which symptoms vary with menstruation, intercourse or bowel activity, and what remains uncertain?'){
 const environment={...Settings,...change},storage=atomicStore(),admission=createAdmission(async()=>storage.store,()=>environment);
 const transport=vi.fn<Transport>(async(address,init)=>new Response(JSON.stringify(address.includes('/identity/token')?{access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}:{thread_id:new Headers(init.headers).get('X-IBM-THREAD-ID')||crypto.randomUUID(),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:reply}}]}),{headers:{'content-type':'application/json'}}));
 const service=createChat({environment,admission,transport,ownThread:(visitId,threadId,signal)=>ownThread(async()=>storage.store,visitId,threadId,signal)});return {service,transport,...storage,environment,handler:createConverse(service)};
}
async function start(service:ReturnType<typeof createChat>){return await service.handle({version:'1',action:'start'},signal()) as {receipt:string};}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it('signs operational-only receipts and rejects tampering, expiry and key rotation',()=>{let now=0;const codec=createReceipts('SyntheticKey',()=>now),receipt=codec.start();expect(codec.read(receipt).threadId).toBeNull();expect(codec.read(receipt).promptIds).toEqual([]);expect(()=>codec.read(receipt.slice(0,-3)+'AAA')).toThrow(SessionError);expect(()=>createReceipts('OtherSyntheticKey',()=>now).read(receipt)).toThrow(SessionError);now=600001;expect(()=>codec.read(receipt)).toThrow(SessionError);const contents=Buffer.from(receipt.split('.')[0],'base64url').toString();for(const forbidden of ['SyntheticKey','narrative','caseInput','messages','filename'])expect(contents).not.toContain(forbidden);});
it('defaults closed and never treats GET capability as IAM/model verification',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);expect(chatAvailable({})).toBe(false);expect(chatCapability({})).toMatchObject({status:'blocked',prompts:[]});expect(chatCapability(Settings)).toMatchObject({status:'available',mode:'controlledSynthetic'});expect(fetch).not.toHaveBeenCalled();});
it.each(['ORCHESTRATE_SYNTHETIC_AUTHORIZED','ORCHESTRATE_DISCUSSION_AUTHORIZED','ORCHESTRATE_HOSTED_CONTROLS_VERIFIED','ENDO_DEMO_INFERENCE_ENABLED','OTEL_SDK_DISABLED'])('requires explicit server gate %s',async gate=>{const {service,transport}=fixture({[gate]:'false'});await expect(start(service)).rejects.toThrow();expect(transport).not.toHaveBeenCalled();});
it('uses all three registered turns with retained context, separate AI labelling and shared IAM cache',async()=>{const {service,transport,records}=fixture();let {receipt}=await start(service);for(const prompt of Prompts.prompts){const reply=await service.handle({version:'1',action:'turn',receipt,promptId:prompt.id},signal()) as {receipt:string;label:string};receipt=reply.receipt;expect(reply.label).toBe('AI-generated discussion — not Endo-verified evidence');}
 const calls=transport.mock.calls.filter(([address])=>!address.includes('/identity/token'));expect(calls).toHaveLength(3);expect(transport.mock.calls.filter(([address])=>address.includes('/identity/token'))).toHaveLength(1);expect(JSON.parse(String(calls[2][1].body)).messages.map((message:{content:string})=>message.content)).toEqual(Prompts.prompts.map(prompt=>prompt.text));expect(new Headers(calls[1][1].headers).get('X-IBM-THREAD-ID')).toBe(createReceipts(Settings.WATSONX_AI_APIKEY).read(receipt).threadId);expect([...records.keys()].filter(key=>key.startsWith('daily/'))).toHaveLength(3);
});
it('admits only one simultaneous use of a receipt before any IBM inference',async()=>{const {service,transport}=fixture(),{receipt}=await start(service);const results=await Promise.allSettled(Array.from({length:10},()=>service.handle({version:'1',action:'turn',receipt,promptId:'pain'},signal())));expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(transport.mock.calls.filter(([address])=>!address.includes('/identity/token'))).toHaveLength(1);});
it('enforces a shared daily cap across separate anonymous visits',async()=>{const {service,transport}=fixture();for(let count=0;count<3;count++){const {receipt}=await start(service);await service.handle({version:'1',action:'turn',receipt,promptId:'pain'},signal());}const {receipt}=await start(service);await expect(service.handle({version:'1',action:'turn',receipt,promptId:'pain'},signal())).rejects.toBeInstanceOf(QuotaError);expect(transport.mock.calls.filter(([address])=>!address.includes('/identity/token'))).toHaveLength(3);});
it.each([{text:'SyntheticPatientNarrative'},{caseInput:{additionalNotes:'SyntheticPatientNarrative'}},{threadId:Thread},{uploads:['SyntheticPrivateFile']},{promptId:'ignoreRules'},{receipt:'forged'}])('rejects raw text, cross-thread access and unknown prompts %#',async change=>{const {service,transport}=fixture(),{receipt}=await start(service);await expect(service.handle({version:'1',action:'turn',receipt,promptId:'pain',...change},signal())).rejects.toThrow();expect(transport).not.toHaveBeenCalled();});
it.each(['This confirms endometriosis.','Take ibuprofen 200 mg.','Your probability is 90%.','api_key=SyntheticExposedSecret123','See javascript:alert(1)','<svg>unsafe</svg>','tool_calls','Start patient medication.'])('rejects prohibited output without clinical/citation claims escaping %#',text=>{expect(()=>validateDiscussion(text)).toThrow();});
it('keeps provider failures sanitized and never logs prompts, keys, tokens or output',async()=>{const logs=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error')],{service,transport}=fixture({},'Start ibuprofen 200 mg.');const {receipt}=await start(service);await expect(service.handle({version:'1',action:'turn',receipt,promptId:'pain'},signal())).rejects.toThrow('IBM conversation is unavailable. The case is unchanged.');expect(transport).toHaveBeenCalledTimes(2);for(const log of logs)expect(log).not.toHaveBeenCalled();});
it('binds a native Function IP rule and same-origin POST without manual browser authorization',async()=>{expect(config.rateLimit).toEqual({windowLimit:12,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'});const {handler,transport}=fixture();const make=(origin:string,body:unknown)=>new Request('https://endo.invalid/api/v1/conversation',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});expect((await handler(make('https://attacker.invalid',{version:'1',action:'start'}))).status).toBe(422);expect((await handler(make('https://endo.invalid',{version:'1',action:'start'}))).status).toBe(200);expect(transport).not.toHaveBeenCalled();});
it('returns no clinical response on a pre-aborted request',async()=>{const {handler,transport}=fixture(),abort=new AbortController();abort.abort();const reply=await handler(new Request('https://endo.invalid/api/v1/conversation',{signal:abort.signal}));expect(reply.status).toBe(499);expect(await reply.text()).toBe('');expect(transport).not.toHaveBeenCalled();});
it.each(['{"version":"1","version":"1","action":"start"}','x'.repeat(6145)])('bounds malformed bodies without reflecting clinical content %#',async body=>{const {handler,transport}=fixture();const reply=await handler(new Request('https://endo.invalid/api/v1/conversation',{method:'POST',headers:{Origin:'https://endo.invalid','Content-Type':'application/json'},body}));expect(reply.status).toBe(422);expect(await reply.text()).not.toContain(body);expect(transport).not.toHaveBeenCalled();});
it('invalidates availability when reviewed synthetic prompts are not deliberately hash-pinned',()=>{expect(chatAvailable({...Settings,ORCHESTRATE_SYNTHETIC_POLICY_HASH:'stale'})).toBe(false);});
it('prevents reassignment of an existing provider thread to a different visit',async()=>{const {store}=atomicStore();await ownThread(async()=>store,'11111111-1111-4111-8111-111111111111',Thread,signal());await expect(ownThread(async()=>store,'33333333-3333-4333-8333-333333333333',Thread,signal())).rejects.toBeInstanceOf(QuotaError);});
it('rejects another visit tampering with signed thread ownership',async()=>{const codec=createReceipts(Settings.WATSONX_AI_APIKEY),original=codec.start(),payload=JSON.parse(Buffer.from(original.split('.')[0],'base64url').toString());payload.threadId=Thread;const forged=Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+original.split('.')[1];expect(()=>codec.read(forged)).toThrow(SessionError);});
it('stops before the provider when the server kill switch is changed after starting a visit',async()=>{const {service,environment,transport}=fixture(),{receipt}=await start(service);environment.ENDO_DEMO_KILL_SWITCH='true';await expect(service.handle({version:'1',action:'turn',receipt,promptId:'pain'},signal())).rejects.toThrow();expect(transport).not.toHaveBeenCalled();});
it('does not let an urgent source-coverage failure continue into routine AI discussion',async()=>{const checked=Analysis.analyze(validateCase({moduleHint:Module1,caseType:'brief',additionalNotes:'Pelvic pain is reported.'}),loadPackages());checked.envelope.warnings=[];checked.envelope.response={...checked.envelope.response,responseType:'EvidenceInsufficient',message:Analysis.CoverageMessage};vi.spyOn(Analysis,'analyze').mockReturnValueOnce(checked);const {service,transport}=fixture(),{receipt}=await start(service);const reply=await service.handle({version:'1',action:'turn',receipt,promptId:'pain'},signal());expect(reply).toMatchObject({state:'safetyHalt',analysis:{response:{message:Analysis.CoverageMessage}}});expect(transport).not.toHaveBeenCalled();});

it.each(['This confirms endometriosis.','Take ibuprofen 200 mg.','api_key=SyntheticExposedSecret123','<script>unsafe</script>'])('provider normalization never bypasses downstream output checks: %s',async text=>{
 const {service,transport}=fixture();
 transport.mockImplementation(async address=>new Response(JSON.stringify(address.includes('/identity/token')?{access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}:{thread_id:Thread,unknown_metadata:{validated:true,claim:'Synthetic invented claim'},choices:[{index:0,finish_reason:'stop',provider_metadata:{score:1},message:{role:'assistant',content:[{type:'text',text}],annotations:[{label:'Not evidence'}]}}]}),{headers:{'content-type':'application/json'}}));
 const {receipt}=await start(service);await expect(service.handle({version:'1',action:'turn',receipt,promptId:'pain'},signal())).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(2);
});
it('keeps supported clarification questions separately labelled and never copies metadata into output',async()=>{
 const {service,transport}=fixture();
 transport.mockImplementation(async address=>new Response(JSON.stringify(address.includes('/identity/token')?{access_token:'SyntheticBearer',token_type:'Bearer',expires_in:3600}:{thread_id:Thread,unknown_metadata:{text:'SyntheticPrivateMetadata'},choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:[{type:'text',text:'Which earlier finding remains uncertain?'}]}}]}),{headers:{'content-type':'application/json'}}));
 const {receipt}=await start(service),reply=await service.handle({version:'1',action:'turn',receipt,promptId:'pain'},signal());expect(reply).toMatchObject({text:'Which earlier finding remains uncertain?',label:'AI-generated discussion — not Endo-verified evidence'});expect(JSON.stringify(reply)).not.toContain('SyntheticPrivateMetadata');
});

it.each([
 'Possible explanations include several conditions; no definitive diagnosis is possible from this discussion.',
 'A differential diagnosis is a list of possibilities, not a diagnosis for this patient.',
 'The differential diagnosis is broad; it cannot establish a diagnosis for this person.',
 'One possible diagnosis is endometriosis; this remains an educational possibility.',
 'You have described recurring pelvic pain and painful periods. What is the timing?',
 'The patient has reported discomfort during intercourse. What remains unknown?',
 'Do you have a record of when symptoms occur?',
 'If you have these symptoms, discussion alone does not establish their cause.',
 'Other conditions cannot be ruled out from the information provided.',
 'Pregnancy has not been ruled out.',
 'Nothing in this description confirms endometriosis.',
 'Do you take any medication?',
 'A definitive diagnosis is not established here.',
 'The diagnosis is uncertain; assessment would be needed.',
 'This discussion does not confirm ectopic pregnancy.',
 'Could this be endometriosis?',
 'Follow-up questions: 1) Do you have a symptom diary? 2) Do you take any medication?'
])('accepts educational differential and clarification language without rewriting it %#',text=>{expect(validateDiscussion(text)).toBe(text);});
it.each([
 'This confirms endometriosis.', 'You have endometriosis.', 'You definitely have endometriosis.',
 'The patient has endometriosis.', 'Your diagnosis is endometriosis.',
 'One possible diagnosis is confirmed endometriosis.', 'The diagnosis is not uncertain: it is endometriosis.',
 'Endometriosis has been ruled out.', 'You do not have endometriosis.',
 'Other conditions cannot be ruled out. You have endometriosis.',
 'Do you have any questions? The patient has an ectopic pregnancy.',
 'Nothing here confirms endometriosis; this confirms ectopic pregnancy.',
 'If you have symptoms, you have endometriosis.',
 'A differential diagnosis is a list; the diagnosis is endometriosis.',
 'Do you take medication? Start ibuprofen.', 'Do you take medication? You should take 200 mg.',
 'Do you take medication? You should take medication.', 'Start patient medication.', 'Prescribe antibiotics.',
 'You **have** endometriosis.', 'Nothing contradicts that this confirms endometriosis.',
 'If you have these symptoms, this is your definitive diagnosis.', 'Take 200 **mg** medication.'
])('rejects definitive claims and prescribing even beside safe educational language %#',text=>{expect(()=>validateDiscussion(text)).toThrow();});

it.each([
 [null,'invalidText'],['   ','emptyText'],['x'.repeat(16001),'responseTooLong'],['text\u0000','invalidCharacters'],
 ['<script>alert(1)</script>','executableMarkup'],['&lt;svg onload=alert(1)&gt;','executableMarkup'],['[Reference](javascript:alert(1))','unsafeReference'],
 ['https://user:password@unapproved.invalid/reference','unsafeReference'],['api_key=SyntheticExposedSecret123','secretExposure'],['Bearer SyntheticExposedBearer123','secretExposure'],
 ['system prompt','internalInstruction'],['tool_calls','actionDirective'],['A dose of 200 mg','medicationDose'],['Your findings indicate stage IV disease.','unsupportedStaging'],
 ['Your probability is 90%.','patientSpecificRisk'],['Your diagnosis is endometriosis.','diagnosisAssertion'],['This confirms endometriosis.','diagnosisConfirmation'],
 ['The patient has endometriosis.','patientAssertion'],['Pregnancy has been ruled out.','diagnosticExclusion'],['Start ibuprofen.','prescribingInstruction']
])('reports only a fixed sanitized validation category %#',(text,category)=>{
 let failure:unknown;try{validateDiscussion(text);}catch(error){failure=error;}expect(failure).toBeInstanceOf(DiscussionError);expect(chatFailure(failure)).toMatchObject({status:503,code:'outputRejected',outputStage:'discussion',outputRejection:category});expect((failure as Error).message).toBe('IBM conversation is unavailable. The case is unchanged.');
});
it('never reflects an unclassified rejection or arbitrary diagnostic field',()=>{expect(chatFailure(new ChatError('outputRejected'))).toMatchObject({outputRejection:'unclassifiedOutput'});expect(JSON.stringify(chatFailure(new DiscussionError('SyntheticPrivateValue' as never)))).not.toContain('SyntheticPrivateValue');});
it('accepts a bounded extended multi-paragraph discussion with references, percentages, terminology and questions as unverified text',()=>{
 const paragraph='Possible explanations are discussed as educational possibilities rather than a definitive diagnosis. Dysmenorrhea and dyspareunia are clinical terms. Estimates quoted in a publication, such as 5–10%, describe populations and are not a personal probability. No definitive diagnosis is possible here.\n\n';
 const text=paragraph.repeat(18)+'References (unverified): [1] https://www.example.invalid/education [2] https://reference.invalid/article\n\nFollow-up questions: Do you have a record of timing? Do you take any medication?\n\nRoutine terminology can include stage I or stage IV classifications; no stage is assigned. General discussion of bowel function (including symptoms) is not an individual assessment.';
 expect(text.length).toBeGreaterThan(4000);expect(text.length).toBeLessThanOrEqual(16000);expect(validateDiscussion(text)).toBe(text);
});
it('does not truncate unsafe content from the end of a long explanation',()=>{const text='Educational discussion remains uncertain. '.repeat(150)+'You have endometriosis.';expect(text.length).toBeGreaterThan(4000);expect(()=>validateDiscussion(text)).toThrow(DiscussionError);});
it.each([
 'Ectopic pregnancy cannot be ruled out.',
 'Ectopic pregnancy cannot yet be ruled out.',
 'Ectopic pregnancy cannot be safely ruled out.',
 'Ectopic pregnancy cannot be completely ruled out.',
 'Ectopic pregnancy cannot reliably be ruled out.',
 'Ectopic pregnancy can not be fully ruled out.',
 'Ectopic pregnancy could not be conclusively ruled out.',
 "Ectopic pregnancy can't yet be ruled out.",
 'Ectopic pregnancy has not been definitively ruled out.',
 'Ectopic pregnancy has not yet been ruled out.',
 'Ectopic pregnancy hasn’t been reliably ruled out.',
 'Ectopic pregnancy is not ruled out.',
 'Ectopic pregnancy cannot be\nruled out from this discussion.',
 'Ectopic pregnancy cannot be **fully** ruled out.',
 'Ectopic pregnancy has not been excluded.',
 'Ectopic pregnancy has not yet been definitively excluded.',
 'There is insufficient information to rule out ectopic pregnancy.',
 'There is not enough evidence to reliably rule out ectopic pregnancy.',
 'We cannot rule out ectopic pregnancy.',
 'We are unable to rule out ectopic pregnancy.',
 'Has ectopic pregnancy been ruled out?',
 'Can ectopic pregnancy be safely ruled out?',
 '## Remaining uncertainty\n\nHas ectopic pregnancy been ruled out?',
 'Ectopic pregnancy cannot be ruled out. Other explanations have not been excluded.'
])('preserves cautious exclusion wording and attached uncertainty verbatim %#',text=>{expect(validateDiscussion(text)).toBe(text);});
it.each([
 'Ectopic pregnancy has been ruled out.',
 'Ectopic pregnancy is fully ruled out.',
 'Ectopic pregnancy has been definitively excluded.',
 'We can rule out ectopic pregnancy.',
 'We rule out ectopic pregnancy.',
 'There is sufficient information to rule out ectopic pregnancy.',
 'There is not insufficient information to rule out ectopic pregnancy.',
 'We are not unable to rule out ectopic pregnancy.',
 'There is insufficient information. Ectopic pregnancy has been ruled out.',
 'Ectopic pregnancy cannot be ruled out. Endometriosis has been ruled out.',
 'Ectopic pregnancy cannot be ruled out, but other causes have been excluded.',
 'Ectopic pregnancy cannot be ruled out and endometriosis has been ruled out.',
 'Has ectopic pregnancy been ruled out? It has been ruled out.',
 'Has ectopic pregnancy been ruled out and endometriosis has been ruled out?',
 'This is not a diagnosis. Ectopic pregnancy has been ruled out.',
 'Ectopic pregnancy cannot be\n\nruled out.',
 'Ectopic pregnancy has not been ruled out; however, other causes have been excluded.'
])('rejects definitive exclusions even beside unrelated uncertainty or a question %#',text=>{
 let failure:unknown;try{validateDiscussion(text);}catch(error){failure=error;}expect(chatFailure(failure)).toMatchObject({code:'outputRejected',outputRejection:'diagnosticExclusion'});
});
it('accepts realistic fictional differential discussion without converting it into reviewed evidence',()=>{
 const text=`## Educational discussion, not a diagnosis

For this fictional scenario, endometriosis is one possibility to discuss alongside other gynecological, urinary, bowel and musculoskeletal possibilities. Recurring pelvic discomfort, dysmenorrhea and dyspareunia do not establish a definitive diagnosis in this discussion. The description alone cannot confirm endometriosis, and other conditions cannot be ruled out here.

### Uncertainty and follow-up
The patient has reported recurring symptoms; the location, menstrual relationship and accompanying symptoms remain important context. Do you have a record of when the discomfort occurs? Does it vary with menstruation, bowel activity or intercourse? Which associated symptoms are reported, denied or still unknown? These are questions about the fictional history, not instructions to diagnose or prescribe.

### References and numerical context
An AI answer might quote a population estimate of 5–10% or include a reference marker [1]. Neither establishes an individual's risk, and references require independent checking. Example citation supplied for this offline formatting test only: https://www.example.invalid/clinical-education [1]. No source verification is claimed.

What further information has already been clarified, and what remains uncertain?`;
 expect(validateDiscussion(text)).toBe(text);
});
it('accepts superficial presentation as inert plain text and detects configured secrets',()=>{for(const text of ['Reference [1]. See https://reference.invalid and www.example.invalid.','General frequency estimates vary between 5% and 10%.','Example comparison: < 5 or > 10; onset = unknown.','```text\nEducational discussion only.\n```','<strong>Possible explanations</strong> &amp; questions.'])expect(validateDiscussion(text)).toBe(text);expect(chatFailure((()=>{try{validateDiscussion('SyntheticConfiguredSecretValue123',['SyntheticConfiguredSecretValue123']);}catch(error){return error;}})())).toMatchObject({outputRejection:'secretExposure'});});
