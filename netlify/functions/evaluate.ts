import { setImmediate } from 'node:timers/promises';
import { analyze, unavailable } from '../evaluation/analysis';
import { InputError, parseJson, validateCase } from '../evaluation/input';
import { DecisionNotice, EvaluationNotice, hashBytes, loadPackages, Module1 } from '../evaluation/packages';
import { runShadow, shadowHeaders, MaximumShadowTimeout, type ShadowStatus, type ShadowReason } from '../evaluation/watsonShadow';

const FunctionDeadline=10000;
const ResponseReserve=500;

const Headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Clinical-Mode':'competition','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function json(payload:unknown,status=200,shadow?:ShadowStatus,reason?:ShadowReason):Response { return new Response(JSON.stringify(payload),{status,headers:{...Headers,...(shadow?shadowHeaders(shadow,reason):{})}}); }
async function bodyText(request:Request,signal:AbortSignal):Promise<string> {
 const reader=request.body?.getReader();if(!reader)throw new InputError();
 const parts:Uint8Array[]=[];let size=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try {
  for(;;){signal.throwIfAborted();const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>65536)throw new InputError();parts.push(next.value);}
  signal.throwIfAborted();return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));
 } finally {signal.removeEventListener('abort',abort);reader.releaseLock();}
}
/** Deterministic evaluation is authoritative; optional server-only shadow calls never replace it. */
export default async function evaluate(request:Request):Promise<Response> {
 const started=Date.now();
 let shadow:ShadowStatus='skipped';
 let shadowReason:ShadowReason='internal';
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(FunctionDeadline)]);
 const address=new URL(request.url);
 const path=address.pathname.replace(/^\/\.netlify\/functions\/evaluate/,'').replace(/^\/api/,'')||'/';
 try {
  signal.throwIfAborted();
  if(address.search)throw new InputError();
  if(request.method==='GET'&&path==='/health')return json({status:'ok',version:'0.1.0'});
  const packages=loadPackages();
  const initialPin=hashBytes(JSON.stringify(packages));
  if(request.method==='GET'&&path==='/ready')return json({status:'ready',availableModuleCount:packages.length,reasonCode:'ready'});
  if(request.method==='GET'&&path==='/v1/runtime')return json({mode:'competition',synthetic:false,notice:EvaluationNotice,evaluation:{reviewStatus:'reviewedForEvaluation',competitionStatus:'competitionReady',notice:EvaluationNotice}});
  if(request.method==='GET'&&(path==='/v1/modules'||path.startsWith('/v1/modules/'))) {
   const modules=packages.map(entry=>({moduleId:entry.moduleId,displayName:entry.moduleId===Module1?'Endometriosis & Chronic Pelvic Pain':'Early Pregnancy Pain and Bleeding',version:entry.moduleId===Module1?'2.1':'1.0',description:'Project-authored summaries reviewedForEvaluation and competitionReady; not approved for patient care.',supportedCaseTypes:['brief','detailed']}));
   if(path==='/v1/modules')return json({modules});
   const selected=modules.find(module=>module.moduleId===path.slice('/v1/modules/'.length));
   return selected?json(selected):json({responseType:'ModuleUnavailable',moduleHint:'Unavailable',message:'The selected module is unavailable.',decisionSupportNotice:DecisionNotice},404);
  }
  if(request.method==='GET'&&path.startsWith('/v1/competition/sources/')) {
   const id=path.slice('/v1/competition/sources/'.length);
   const matched=packages.flatMap(entry=>entry.sources.filter(source=>source.sourceId===id).map(source=>({entry,source})));
   if(matched.length!==1)return json({detail:'Source details are unavailable.'},404);
   const {entry,source}=matched[0],claims=entry.claims.filter(claim=>claim.sourceId===id);
   const populations=[...new Set(claims.map(claim=>claim.intendedPopulation))],conditions=[...new Set(claims.flatMap(claim=>claim.conditions))],limitations=[...new Set(claims.flatMap(claim=>claim.limitations))];
   return json({organization:source.organization,title:source.title,date:source.publicationDate,sourceType:id.startsWith('CDC-MATERNAL-')?'Government public-health warning material':id.startsWith('ACOG-')?'Public educational FAQ':id.startsWith('NICE-')||id.startsWith('ACEP-')||id==='CDC-PID'?'Guideline':'Public information webpage',captureStatus:'Project-authored evaluation summary; underlying publication not distributed.',status:'Reviewed for evaluation; authentic sources remain pending review.',statements:claims.map(claim=>claim.supportedStatement),limitations:['Population: '+populations.join('; '),'Conditions: '+conditions.join('; '),...limitations].join(' ').slice(0,6000),jurisdiction:claims[0].jurisdiction,sections:claims.map(()=>'Project-authored evaluation summary')});
  }
  if(request.method!=='POST'||path!=='/v1/analyze')return json({detail:'Route is unavailable.'},404);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))throw new InputError();
  const caseInput=validateCase(parseJson(await bodyText(request,signal)));
  await setImmediate(undefined,{signal});signal.throwIfAborted();
  const result=analyze(caseInput,packages);
  await setImmediate(undefined,{signal});signal.throwIfAborted();
  // Re-read the complete reviewed boundary after synthesis; no stale or partial
  // result survives a package/citation/warning change during the operation.
  if(hashBytes(JSON.stringify(loadPackages()))!==initialPin)throw new Error('Stale evaluation state.');
  // Only the purpose-built public projector can feed IBM. The clinical response is immutable here.
  shadow=await runShadow(result,packages,signal,Math.min(MaximumShadowTimeout,FunctionDeadline-ResponseReserve-(Date.now()-started)),undefined,reason=>{shadowReason=reason;});
  signal.throwIfAborted();
  if(hashBytes(JSON.stringify(loadPackages()))!==initialPin)throw new Error('Stale evaluation state.');
  return json(result.envelope,result.status,shadow,shadowReason);
 } catch(failure) {
  if(request.signal.aborted)return new Response(null,{status:499,headers:{...Headers,...(path==='/v1/analyze'?shadowHeaders(shadow,shadowReason):{})}});
  if(failure instanceof InputError || failure instanceof SyntaxError)return json({detail:new InputError().message},422,path==='/v1/analyze'?shadow:undefined,shadowReason);
  if(path==='/v1/analyze'){const result=unavailable();return json(result.envelope,result.status,shadow,shadowReason);}
  if(path==='/ready')return json({status:'notReady',availableModuleCount:0,reasonCode:'analysisUnavailable'},503);
  return json({detail:'Evaluation services are unavailable.'},503);
 }
}
