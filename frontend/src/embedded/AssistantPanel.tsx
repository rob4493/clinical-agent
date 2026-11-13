import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {LiveAgent} from './liveConfiguration';
import './panel.css';

/** No case props or SDK loading: tenant security gates must pass before activation. */
export default function AssistantPanel({onClose}:{onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const surface=dialog.current;surface?.showModal();return()=>{surface?.close();previous?.focus();};},[]);
 return createPortal(<dialog ref={dialog} className="embeddedAssistant" aria-labelledby="embeddedHeading" onCancel={event=>{event.preventDefault();onClose();}}>
  <header><h2 id="embeddedHeading">AI Assistant</h2><button type="button" onClick={onClose} autoFocus>Close AI Assistant</button></header>
  <p>{LiveAgent.name} · Live {LiveAgent.version}</p>
  <p role="status">IBM chat is awaiting security authorization. No message has been sent.</p>
  <p>Your case, uploads and evidence review remain separate and unchanged.</p>
  <p>Activation requires verified anonymous-session security, connected-tool restrictions, retention/privacy approval and enforceable IBM usage limits.</p>
  <div id="endoEmbeddedAgentMount" aria-label="Reserved IBM assistant mount" />
  <p>Continue using Endo analysis and the existing clinician-confirmed follow-up independently.</p>
 </dialog>,document.body);
}
