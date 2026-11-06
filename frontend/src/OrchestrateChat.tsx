import {useEffect,useRef,useState} from 'react';
import PromptCatalog from '../../shared/orchestratePrompts.json';
import {CompetitionNotice,readReview,type Review} from './api';

interface Props {onFallback:()=>void;onEnd?:()=>void}
function wait<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{const cancel=()=>reject(new Error('Cancelled'));if(signal.aborted){void operation.catch(()=>{});cancel();return;}signal.addEventListener('abort',cancel,{once:true});operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));});}
/** Only registered prompt IDs leave this component. Typed case notes and uploads
 * cannot enter the provider path; receipts and replies remain in React memory.
 */
export default function OrchestrateChat({onFallback,onEnd}:Props){
 const [receipt,setReceipt]=useState(''),[draft,setDraft]=useState(''),[pending,setPending]=useState(true),[status,setStatus]=useState('Starting the controlled IBM conversation…');
 const [messages,setMessages]=useState<{role:'user'|'assistant';text:string}[]>([]);
 const [safety,setSafety]=useState<Review|null>(null);
 const controller=useRef<AbortController|null>(null),alive=useRef(true),busy=useRef(false),generation=useRef(0),composer=useRef<HTMLTextAreaElement>(null),history=useRef<HTMLDivElement>(null);
 useEffect(()=>{history.current?.lastElementChild?.scrollIntoView?.({block:'nearest'});},[messages]);
 async function request(payload:unknown){
  const abort=new AbortController(),current=++generation.current;controller.current=abort;const timer=setTimeout(()=>abort.abort(),18000);
  try{const response=await wait(fetch('/api/v1/conversation',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal:abort.signal,headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(payload)}),abort.signal);
   const reply=await wait(response.json(),abort.signal);if(!alive.current||abort.signal.aborted||generation.current!==current)return null;
   if(!response.ok)throw new Error(reply?.code==='quotaExceeded'?'limit':'unavailable');
   if(reply?.version!=='1'||!['started','replied','safetyHalt'].includes(reply.state))throw new Error('unavailable');
   if(reply.state==='safetyHalt'){setReceipt('');setSafety(readReview(reply.analysis,false,'competition'));setStatus('Deterministic safety screening paused this fictional conversation. The current case is unchanged.');return null;}
   if(reply.state==='started'&&JSON.stringify(reply.prompts)!==JSON.stringify(PromptCatalog.prompts))throw new Error('unavailable');
   if(typeof reply.receipt!=='string'||reply.receipt.length>4096||reply.state==='replied'&&(typeof reply.text!=='string'||!reply.text.trim()||reply.text.length>4000||/[<>]/.test(reply.text)))throw new Error('unavailable');
   return reply;
  }catch(failure){if(alive.current&&generation.current===current&&!abort.signal.aborted)setStatus(failure instanceof Error&&failure.message==='limit'?'The demonstration usage limit has been reached. No case changes were made.':'IBM conversation is unavailable or its response could not be accepted. The case is unchanged.');else if(alive.current&&generation.current===current)setStatus('The request was cancelled. No case changes were made.');return null;}
  finally{clearTimeout(timer);if(controller.current===abort)controller.current=null;}
 }
 useEffect(()=>{alive.current=true;void request({version:'1',action:'start'}).then(reply=>{if(!alive.current)return;if(reply?.state==='started'){setReceipt(reply.receipt);setStatus('Ready for an approved fictional prompt. No model response has been requested yet.');}setPending(false);requestAnimationFrame(()=>composer.current?.focus());});return()=>{alive.current=false;generation.current++;controller.current?.abort();};},[]);
 async function send(){
  if(busy.current||pending||!receipt)return;const prompt=PromptCatalog.prompts.find(prompt=>prompt.text===draft);
  if(!prompt){setStatus('Only the approved fictional prompts can be sent in this phase. Typed or edited clinical information has not been transmitted.');return;}
  busy.current=true;setPending(true);setMessages(current=>[...current,{role:'user',text:prompt.text}]);setDraft('');setStatus('Waiting for IBM…');
  try{const reply=await request({version:'1',action:'turn',receipt,promptId:prompt.id});if(!alive.current)return;if(reply?.state==='replied'){setReceipt(reply.receipt);setMessages(current=>[...current,{role:'assistant',text:reply.text}]);setStatus('IBM replied. Discussion is AI-generated and is not Endo-verified evidence.');}else setReceipt('');}
  finally{busy.current=false;if(alive.current)setPending(false);requestAnimationFrame(()=>composer.current?.focus());}
 }
 return <section aria-label="IBM Clinical AI Assistant">{safety&&<div role="alert">{safety.warnings.map((warning,index)=><p key={index}><strong>Urgent assessment: </strong>{warning.text}{warning.numbers.length?' ['+warning.numbers.join(',')+']':''}</p>)}{safety.messages.map((message,index)=><p key={index}>{message}</p>)}<p>{safety.notice}</p></div>}<h3>Endo Clinical AI Assistant</h3><p role="note">Controlled fictional conversation. Your current case, uploads and typed clinical information are not sent to IBM. AI discussion is separate from Endo-verified evidence.</p>
 <div className="conversationHistory" role="log" aria-label="IBM conversation" aria-live="polite" ref={history}>{messages.map((message,index)=><article key={index} className={'conversationMessage '+(message.role==='user'?'clinician':'endo')}><strong>{message.role==='user'?'Clinician':'IBM Clinical Assistant'}</strong><p>{message.text}</p></article>)}</div>
 <div aria-label="Approved fictional prompts">{PromptCatalog.prompts.map(prompt=><button key={prompt.id} type="button" disabled={pending||!receipt} onClick={()=>{setDraft(prompt.text);setStatus('Approved fictional prompt loaded; select Send to contact IBM.');composer.current?.focus();}}>{prompt.id==='pain'?'Pelvic-pain discussion':prompt.id==='bowel'?'Add bowel symptoms':'Summary and three questions'}</button>)}</div>
 <form className="conversationComposer" onSubmit={event=>{event.preventDefault();void send();}}><label htmlFor="ibmMessage">Message to IBM</label><textarea id="ibmMessage" ref={composer} rows={3} maxLength={1600} value={draft} disabled={pending||!receipt} onChange={event=>setDraft(event.target.value)}/><button type="submit" disabled={pending||!receipt||!draft.trim()}>Send to IBM</button></form>
 <p role="status">{pending?'Waiting for IBM conversation…':status}</p><p>Conversation cannot apply case changes or initiate reanalysis.</p><button type="button" onClick={()=>{generation.current++;controller.current?.abort();onFallback();}}>Use local fallback</button>{onEnd&&<button type="button" onClick={onEnd}>End IBM session</button>}<p className="decisionNotice">{CompetitionNotice}</p></section>;
}
