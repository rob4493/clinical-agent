import DiscussionMarkdown from './DiscussionMarkdown';
import ProtectedSafetyNotice from './ProtectedSafetyNotice';
import {isSafetyExplanation,type SafetyExplanation} from '../../shared/protectedSafetyContract';
import {DiscussionTextLimit,hasExecutableMarkup,isDiscussionRejection,isProviderRejection,ClinicalLanguageWarnings,isClinicalLanguageWarning,type ClinicalLanguageWarning} from '../../shared/discussionContract';
import {useEffect,useRef,useState} from 'react';

/** Session-only UI. No case data, uploads, provider thread IDs or credentials. */
export default function EditableConversation({primary=false}:{primary?:boolean}){
 const [open,setOpen]=useState(primary),[halted,setHalted]=useState(false),[receipt,setReceipt]=useState(''),[draft,setDraft]=useState(''),[pending,setPending]=useState(false);
 const [messages,setMessages]=useState<{role:'user'|'assistant';text:string;clinicalWarnings?:ClinicalLanguageWarning[];safety?:{warnings:string[];explanation:SafetyExplanation|null}}[]>([]),[history,setHistory]=useState<string[]>([]),[warnings,setWarnings]=useState<string[]>([]),[status,setStatus]=useState('');
 const [safetyExplanation,setSafetyExplanation]=useState<SafetyExplanation|null>(null);
 const busy=useRef(false),controller=useRef<AbortController|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
 async function request(payload:unknown){
  const abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),30000);
  try{
   const response=await fetch('/api/v1/conversation',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal:abort.signal,headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});
   const reply=await response.json();if(!alive.current||abort.signal.aborted)throw new Error();
   if(!response.ok&&reply?.code==='outputRejected')throw new Error('output:'+(isDiscussionRejection(reply.outputRejection)?reply.outputRejection:'unclassifiedOutput'));
   if(!response.ok&&reply?.code==='providerResponse')throw new Error('protocol:'+(isProviderRejection(reply.responseRejection)?reply.responseRejection:'unclassifiedProtocol'));
   if(!response.ok)throw new Error(reply?.code==='quotaExceeded'?'quota':reply?.code==='inputRejected'?'privacy':'unavailable');
   if(reply?.version!=='2'||!['started','replied','safetyHalt','structuredRequired','refused'].includes(reply.state))throw new Error();
   if(['started','replied'].includes(reply.state)&&(typeof reply.receipt!=='string'||!reply.receipt||reply.receipt.length>2048))throw new Error();
   if(reply.state==='replied'&&(typeof reply.text!=='string'||!reply.text.trim()||reply.text.length>DiscussionTextLimit||hasExecutableMarkup(reply.text)))throw new Error();
   if(reply.clinicalWarnings!==undefined&&(!Array.isArray(reply.clinicalWarnings)||reply.clinicalWarnings.length>ClinicalLanguageWarnings.length||reply.clinicalWarnings.some((code:unknown)=>!isClinicalLanguageWarning(code))||new Set(reply.clinicalWarnings).size!==reply.clinicalWarnings.length))throw new Error();
   if(reply.state==='safetyHalt'&&(!Array.isArray(reply.warnings)||reply.warnings.some((text:unknown)=>typeof text!=='string'||text.length>2000)))throw new Error();
   return reply.state==='safetyHalt'?{...reply,safetyExplanation:isSafetyExplanation(reply.safetyExplanation)?reply.safetyExplanation:null}:reply;
  }finally{clearTimeout(timeout);controller.current=null;}
 }
 async function send(){
  if(busy.current||halted||!draft.trim())return;busy.current=true;setPending(true);setStatus('Waiting for IBM…');
  const message=draft;
  try{
   let current=receipt;
   if(!current){const start=await request({version:'2',action:'start',syntheticOnly:true});if(start.state!=='started')throw new Error();current=start.receipt;}
   const reply=await request({version:'2',action:'turn',receipt:current,history,message});if(!alive.current)return;
   if(reply.state==='replied'){
    setMessages(previous=>[...previous,{role:'user',text:message},{role:'assistant',text:reply.text,clinicalWarnings:reply.clinicalWarnings}]);setHistory(previous=>[...previous,message]);setReceipt(reply.receipt);setDraft('');setStatus('AI-generated discussion. Not independently verified clinical evidence.');
   }else{
    setReceipt('');setWarnings(reply.state==='safetyHalt'?reply.warnings:[]);
    setSafetyExplanation(reply.state==='safetyHalt'?reply.safetyExplanation:null);
    if(reply.state==='safetyHalt')setMessages(previous=>[...previous,{role:'user',text:message,safety:{warnings:reply.warnings,explanation:reply.safetyExplanation}}]);
    setStatus(reply.state==='refused'?'The agent declined this request.':reply.state==='structuredRequired'?'Use Build the case for structured review. No case has been submitted or changed.':'Discussion is paused for safety clarification.');
    // Keep the submitted draft and transcript; an explicit reset is required.
    setHalted(true);
   }
  }catch(error){if(alive.current){setReceipt('');setHalted(true);setStatus(error instanceof Error&&error.message.startsWith('output:')?'Response withheld by the discussion screen ('+error.message.slice(7)+'). Your draft is preserved; no automatic retry was made.':error instanceof Error&&error.message.startsWith('protocol:')?'IBM response failed protocol validation ('+error.message.slice(9)+'). Your draft is preserved; no automatic retry was made.':error instanceof Error&&error.message==='quota'?'The demonstration usage limit has been reached.':error instanceof Error&&error.message==='privacy'?'Request rejected. Check privacy, permitted content and session validity. Your draft is preserved.':'Conversation unavailable or timed out. Your draft is preserved. No automatic retry was made.');}}
  finally{busy.current=false;if(alive.current)setPending(false);}
 }
 function reset(){if(busy.current)return;setReceipt('');setMessages([]);setHistory([]);setWarnings([]);setSafetyExplanation(null);setHalted(false);setStatus('New conversation. No previous context will be sent.');}
 const stopped=halted;
 return <section className="guidedSuggestion unifiedAssistant ibmDiscussion" aria-label="IBM conversational discussion">
  <button type="button" aria-expanded={open} aria-controls="editableEndoConversation" onClick={()=>setOpen(value=>!value)}>{open?'Collapse Endo Agent':'Open Endo Agent'}</button>
  {!open&&(warnings.length>0||safetyExplanation)&&<ProtectedSafetyNotice warnings={warnings} explanation={safetyExplanation}/>}
  <div id="editableEndoConversation" hidden={!open}>
   <h2>Endo Agent</h2><p className="agentSubtitle">Conversational clinical support</p>
   {!messages.length&&!pending&&<div className="agentWelcome"><h3>Hi, I'm Endo. Ready to assist.</h3><p>What's on your mind today? We can explore clinical questions, consider different possibilities, and work through uncertainty together.</p><div className="agentSuggestions"><button type="button" disabled={pending||stopped} onClick={()=>setDraft("Help me explore a fictional presentation and possible explanations.")}><strong>Clinical reasoning</strong><span>Explore a presentation and possible explanations.</span></button><button type="button" disabled={pending||stopped} onClick={()=>setDraft("What information could help clarify uncertainty in a fictional presentation?")}><strong>Explore uncertainty</strong><span>Discuss what information might change an assessment.</span></button></div></div>}
   <p role="note">AI-generated discussion, not independently verified clinical evidence. Synthetic/de-identified examples only. Not a diagnosis or prescription. Case details and documents are not automatically shared. AI references and statistics are unverified; reference links are inactive.</p>
   <div className="conversationHistory" role="log" aria-label="IBM conversation" aria-busy={pending}>{messages.map((message,index)=><div key={index}><article className={'conversationMessage '+(message.role==='user'?'clinician':'endo')}><strong>{message.role==='user'?'Clinician':'Endo Agent · AI-generated'}</strong>{message.role==='assistant'?<DiscussionMarkdown text={message.text}/>:<p style={{whiteSpace:'pre-wrap'}}>{message.text}</p>}{!!message.clinicalWarnings?.length&&<p role="note" aria-label="Clinical-language cautions">Clinical-language cautions: {message.clinicalWarnings.join(', ')}. Review independently; synthetic preview only. These flags are not verified findings.</p>}</article>{message.safety&&<ProtectedSafetyNotice warnings={message.safety.warnings} explanation={message.safety.explanation}/>}</div>)}{pending&&<article className="conversationMessage clinician"><strong>Clinician</strong><p style={{whiteSpace:'pre-wrap'}}>{draft}</p></article>}</div>
   <p className="agentPrivacy">Use authorized, de-identified information only. Messages are screened for privacy and safety.</p>
   <form className="conversationComposer" onSubmit={event=>{event.preventDefault();void send();}}><label htmlFor="editableEndoMessage">Ask Endo</label><textarea id="editableEndoMessage" placeholder="Type your clinical question or describe a patient presentation…" rows={3} maxLength={1600} value={draft} disabled={pending||stopped} onChange={event=>setDraft(event.target.value)}/><button type="submit" disabled={pending||!draft.trim()||stopped}>{pending?'Waiting…':'Send to Endo'}</button></form>
   <p role="status">{status}</p>{warnings.length>0&&<p>Starting a new conversation does not resolve the reported emergency.</p>}<button type="button" disabled={pending} onClick={reset}>New conversation</button><button type="button" onClick={()=>document.getElementById('narrative')?.focus()}>Use structured case review</button>
  </div>
 </section>;
}
