import {useEffect,useRef} from 'react';
import {startEmbedded} from './session';
/** No case properties: the only input to IBM is text typed inside its own widget. */
export default function EmbeddedChat({onStatus}:{onStatus:(status:string)=>void}){
 const mount=useRef<HTMLDivElement>(null);
 useEffect(()=>{let cancelled=false,stop:(()=>void)|undefined;
  // StrictMode's discarded first effect must not create a second vendor instance.
  queueMicrotask(()=>{if(cancelled||!mount.current)return;try{stop=startEmbedded(mount.current,onStatus);}catch{onStatus('An IBM session is already ending. Try again after it closes.');}});
  return()=>{cancelled=true;stop?.();};
 },[onStatus]);
 return <div ref={mount} id="endoEmbeddedAgentMount" aria-label="IBM conversation" className="embeddedChatMount"/>;
}
