import {useEffect,useRef,useState} from 'react';

/** Session-only UI. No case data, uploads, provider thread IDs or credentials. */
export default function EditableConversation(){
 const [open,setOpen]=useState(false),[consent,setConsent]=useState(false),[receipt,setReceipt]=useState(''),[draft,setDraft]=useState(''),[pending,setPending]=useState(false);
 const [messages,setMessages]=useState<{role:'user'|'assistant';text:string}[]>([]),[history,setHistory]=useState<string[]>([]),[warnings,setWarnings]=useState<string[]>([]),[status,setStatus]=useState('');
 const [available,setAvailable]=useState(false),[checked,setChecked]=useState(false),[accessCode,setAccessCode]=useState('');
 const busy=useRef(false),controller=useRef<AbortController|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
 useEffect(()=>{if(!open||checked)return;setChecked(true);void request(undefined).then(reply=>{if(alive.current){setAvailable(reply.status==='available');if(reply.status!=='available')setStatus('IBM AI discussion is currently disabled. Structured review remains available.');}}).catch(()=>{if(alive.current)setStatus('IBM AI discussion is unavailable. Structured review remains available.');});},[open,checked]);
 async function request(payload:unknown){
  const abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),30000);
  try{
   const response=await fetch('/api/v1/conversation',{method:payload===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal:abort.signal,headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});
   const reply=await response.json();if(!alive.current||abort.signal.aborted)throw new Error();
   if(payload===undefined){if(!response.ok||reply?.version!=='2'||!['available','blocked'].includes(reply.status))throw new Error();return reply;}
   if(!response.ok)throw new Error(reply?.code==='accessRequired'?'access':reply?.code==='disabled'?'disabled':reply?.code==='quotaExceeded'?'quota':reply?.code==='inputRejected'?'privacy':'unavailable');
   if(reply?.version!=='2'||!['started','replied','safetyHalt','structuredRequired','refused'].includes(reply.state))throw new Error();
   if(['started','replied'].includes(reply.state)&&(typeof reply.receipt!=='string'||!reply.receipt||reply.receipt.length>2048))throw new Error();
   if(reply.state==='replied'&&(typeof reply.text!=='string'||!reply.text.trim()||reply.text.length>4000||/[<>]/.test(reply.text)))throw new Error();
   if(reply.state==='safetyHalt'&&(!Array.isArray(reply.warnings)||reply.warnings.some((text:unknown)=>typeof text!=='string'||text.length>2000)))throw new Error();
   return reply;
  }finally{clearTimeout(timeout);controller.current=null;}
 }
 async function send(){
  if(busy.current||!available||!consent||!draft.trim())return;busy.current=true;setPending(true);setStatus('Waiting for IBM…');
  const message=draft;
  try{
   let current=receipt;
   if(!current){const start=await request({version:'2',action:'start',syntheticOnly:true,accessCode});if(start.state!=='started')throw new Error();current=start.receipt;setAccessCode('');}
   const reply=await request({version:'2',action:'turn',receipt:current,history,message});if(!alive.current)return;
   if(reply.state==='replied'){
    setMessages(previous=>[...previous,{role:'user',text:message},{role:'assistant',text:reply.text}]);setHistory(previous=>[...previous,message]);setReceipt(reply.receipt);setDraft('');setStatus('AI-generated discussion. Not independently verified clinical evidence.');
   }else{
    setReceipt('');setWarnings(reply.state==='safetyHalt'?reply.warnings:[]);
    setStatus(reply.state==='refused'?'The agent declined this request.':reply.state==='structuredRequired'?'Use Build the case for structured review. No case has been submitted or changed.':'Discussion is paused for safety clarification.');
    // Keep the submitted draft and transcript; an explicit reset is required.
    setConsent(false);
   }
  }catch(error){if(alive.current){setReceipt('');setConsent(false);setStatus(error instanceof Error&&error.message==='access'?'A valid competition access code is required. Select New conversation to try again.':error instanceof Error&&error.message==='disabled'?'IBM AI discussion is disabled. Structured review remains available.':error instanceof Error&&error.message==='quota'?'The demonstration usage limit has been reached.':error instanceof Error&&error.message==='privacy'?'Request rejected. Check privacy, permitted content and session validity. Your draft is preserved.':'Conversation unavailable or timed out. Your draft is preserved. No automatic retry was made.');}}
  finally{busy.current=false;if(alive.current)setPending(false);}
 }
 function reset(){if(busy.current)return;setReceipt('');setMessages([]);setHistory([]);setWarnings([]);setConsent(false);setStatus('New conversation. No previous context will be sent.');}
 const stopped=!receipt&&messages.length>0||warnings.length>0||!!status&&status!=='Waiting for IBM…'&&!consent&&!status.startsWith('New conversation');
 return <section className="guidedSuggestion unifiedAssistant" aria-label="IBM conversational discussion">
  <button type="button" aria-expanded={open} aria-controls="editableEndoConversation" onClick={()=>setOpen(value=>!value)}>{open?'Collapse Endo AI':'Continue with Endo AI'}</button>
  {warnings.length>0&&<div role="alert">{warnings.map(text=><p key={text}>{text}</p>)}</div>}
  <div id="editableEndoConversation" hidden={!open}>
   <h3>Endo AI discussion</h3><p>Explore the findings, ask follow-up questions, or discuss general clinical education. Structured review remains separate.</p>
   <p role="note">AI-generated discussion, not independently verified clinical evidence. Synthetic/de-identified examples only. Not a diagnosis or prescription. Case details and documents are not automatically shared.</p>
   <div className="conversationHistory" role="log" aria-label="IBM conversation">{messages.map((message,index)=><article key={index} className={'conversationMessage '+(message.role==='user'?'clinician':'endo')}><strong>{message.role==='user'?'Clinician':'Endo · AI-generated'}</strong><p style={{whiteSpace:'pre-wrap'}}>{message.text}</p></article>)}</div>
   <label htmlFor="endoAccessCode">Competition access code</label><input id="endoAccessCode" type="password" autoComplete="off" maxLength={128} value={accessCode} disabled={!available||pending||stopped} onChange={event=>setAccessCode(event.target.value)}/><p>No IBM account is required. Use the code supplied by the demonstration operator.</p>
   <label><input type="checkbox" checked={consent} disabled={!available||pending||stopped} onChange={event=>setConsent(event.target.checked)}/>This conversation contains fictional, de-identified information only.</label>
   <form className="conversationComposer" onSubmit={event=>{event.preventDefault();void send();}}><label htmlFor="editableEndoMessage">Ask Endo</label><textarea id="editableEndoMessage" rows={3} maxLength={1600} value={draft} disabled={!available||pending||stopped} onChange={event=>setDraft(event.target.value)}/><button type="submit" disabled={!available||pending||!consent||!draft.trim()||stopped}>{pending?'Waiting…':'Send to Endo'}</button></form>
   <p role="status">{status}</p><button type="button" disabled={pending} onClick={reset}>New conversation</button><button type="button" onClick={()=>document.getElementById('narrative')?.focus()}>Use structured case review</button>
  </div>
 </section>;
}
