import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {competitionWindow,createCompetitionQuota,validateChatLock,type CompetitionTicket} from './orchestrateCompetition';
import {QuotaError,waitQuota,type QuotaStore} from './demoQuota';
import {createOrchestrateTransport,OrchestrateResponseError} from './orchestrateTransport';
import {ChatError,validateProtectedDiscussion} from './orchestrateChat';
import {ownThread} from './threadOwner';
import {screenProtectedSafety} from './protectedSafety';
import type {OrchestrateEnvironment} from './orchestrateTarget';
import type {Transport} from './watsonShadow';

import {protectedDiscussionAllowed,type OperatorContext} from './protectedDiscussionPolicy';
export type {OperatorContext} from './protectedDiscussionPolicy';
type Session={id:string;owner:string;ordinal:number;thread?:string;history:string;started:number;until:number};
export function createProtectedConversation(options:{store:(signal:AbortSignal)=>Promise<QuotaStore>;environment?:OrchestrateEnvironment;clock?:()=>number;transport?:Transport}){
 const env=options.environment??process.env,clock=options.clock??Date.now;
 const allowed=(context:OperatorContext)=>protectedDiscussionAllowed(env,context,clock());
 function digest(value:string){return createHmac('sha256',env.WATSONX_AI_APIKEY!).update('Endo editable discussion v2\0'+value).digest('hex');}
 function seal(session:Session){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(digest('receipt encryption'),'hex'),iv);const body=Buffer.concat([cipher.update(JSON.stringify(session),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');}
 function read(receipt:unknown,context:OperatorContext):Session{
  try{
   if(typeof receipt!=='string'||receipt.length>2048||!/^[A-Za-z0-9_-]+$/.test(receipt))throw 0;
   const bytes=Buffer.from(receipt,'base64url'),cipher=createDecipheriv('aes-256-gcm',Buffer.from(digest('receipt encryption'),'hex'),bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));
   const session=JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8')) as Session;
   if(session.owner!==digest(context.user!.id)||session.until<=clock()||session.started!==competitionWindow(env,clock())!.startedAt||session.ordinal>=12)throw 0;
   return session;
  }catch{throw new ChatError('inputRejected');}
 }
 return Object.freeze({
  capability:(context:OperatorContext)=>({version:'2',status:allowed(context)?'available':'blocked',mode:'protectedSyntheticDiscussion'}),
  async handle(payload:unknown,context:OperatorContext,signal:AbortSignal){
   if(!allowed(context))throw new ChatError('unavailable');
   const window=competitionWindow(env,clock())!,quota=createCompetitionQuota(options.store,window,clock);
   const targetPin=digest(JSON.stringify([env.ORCHESTRATE_API_URL,env.ORCHESTRATE_AGENT_ID,env.WATSONX_AI_AUTH_TYPE,env.WATSONX_AI_TIMEOUT_MS,window]));
   const guard=()=>{signal.throwIfAborted();if(!allowed(context)||digest(JSON.stringify([env.ORCHESTRATE_API_URL,env.ORCHESTRATE_AGENT_ID,env.WATSONX_AI_AUTH_TYPE,env.WATSONX_AI_TIMEOUT_MS,competitionWindow(env,clock())]))!==targetPin)throw new ChatError('unavailable');};
   if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new ChatError('inputRejected');
   const input=payload as Record<string,unknown>,keys=Object.keys(input).sort().join('|');
   if(input.version!=='2')throw new ChatError('inputRejected');
   if(input.action==='start'&&keys==='action|syntheticOnly|version'&&input.syntheticOnly===true){
    guard();const ticket=await quota.reserveSession(signal);await quota.record(ticket,{status:'passed',reason:'completed',invoked:false},signal);guard();
    return {version:'2',state:'started',receipt:seal({id:ticket.reservationId,owner:digest(context.user!.id),ordinal:0,history:digest('[]'),started:window.startedAt,until:Math.min(window.until,context.user!.expiresAt.getTime())})};
   }
   if(input.action!=='turn'||keys!=='action|history|message|receipt|version'||typeof input.message!=='string'||!input.message.trim()||input.message.length>1600||!Array.isArray(input.history)||input.history.some(text=>typeof text!=='string'||!text.trim()||text.length>1600))throw new ChatError('inputRejected');
   const session=read(input.receipt,context),history=input.history as string[];
   if(history.length!==session.ordinal||digest(JSON.stringify(history))!==session.history)throw new ChatError('inputRejected');
   const messages=[...history,input.message];
   // Existing privacy validation and approved safety rules; no canonical case is
   // created or modified. Screen latest and cumulative text before provider access.
   const {warnings,conflict,explanation}=screenProtectedSafety(messages);
   // Consume the receipt once across workers, even on failure or cancellation.
   const operation=AbortSignal.any([signal,AbortSignal.timeout(2000)]),store=await waitQuota(options.store(operation),operation),key=`chat/lock/${session.id}/${session.ordinal}`,content='{"consumed":true}';
   validateChatLock(key,content);const written=await waitQuota(store.set(key,content,{onlyIfNew:true}),operation);if(!written.modified||!written.etag)throw new QuotaError('replayed');
   const observed=await waitQuota(store.getWithMetadata(key),operation);if(!observed||observed.etag!==written.etag||JSON.stringify(observed.data)!==content)throw new QuotaError('unavailable');
   guard();
   if(warnings.length||conflict)return {version:'2',state:'safetyHalt',warnings,safetyExplanation:explanation,detail:conflict?'Reported information requires clarification in the structured safety workflow. The case is unchanged.':'Routine AI discussion is paused. The case is unchanged.'};
   if(/\b(?:structured (?:case |evidence )?(?:review|analysis)|analy[sz]e (?:this|the|my) case)\b/i.test(input.message))return {version:'2',state:'structuredRequired',detail:'Use the existing structured case form and explicitly review its fields. Chat has not submitted or changed a case.'};
   let ticket:CompetitionTicket|undefined,invoked=false,reservationFailure:unknown;
   const providerEnv={...env,ORCHESTRATE_ENABLED:'true'};
   const transport:Transport=async(address,init)=>{guard();if(!address.includes('/identity/token'))invoked=true;return (options.transport??fetch)(address,init);};
   const turn={messages:[{role:'user' as const,content:input.message}],...(session.thread?{threadId:session.thread}:{})};
   const provider=createOrchestrateTransport({authorize:async supplied=>{guard();return JSON.stringify(supplied)===JSON.stringify(turn);},reserve:async operation=>{guard();try{if(session.thread)await ownThread(options.store,session.id,session.thread,operation);ticket=await quota.reserveCall(operation);}catch(error){reservationFailure=error;throw error;}}},transport,providerEnv);
   let passed=false;
   try{
    const reply=await provider.complete(turn,signal);guard();await ownThread(options.store,session.id,reply.threadId,signal);
    const screened=validateProtectedDiscussion(reply.text,env,context,clock());guard();passed=true;
    return {version:'2',state:'replied',text:screened.text,clinicalWarnings:screened.warnings,label:'AI-generated discussion — not independently verified clinical evidence',receipt:seal({...session,ordinal:session.ordinal+1,thread:reply.threadId,history:digest(JSON.stringify(messages))})};
   }catch(error){if(reservationFailure instanceof QuotaError)throw reservationFailure;if(error instanceof OrchestrateResponseError&&error.rejection==='providerRefusal')return {version:'2',state:'refused',detail:'The agent declined this request. No case changes were made.'};throw error;}
   finally{
    // Accounting must complete before a reply becomes visible. No retries/refunds.
    if(ticket)await quota.record(ticket,{status:passed?'passed':'failed',reason:passed?'completed':'providerResponse',invoked},AbortSignal.timeout(1500));
   }
  }
 });
}
