import {render,screen,fireEvent} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {useState} from 'react';
import AssistantPanel from '../src/embedded/AssistantPanel';

it('opens an isolated in-page panel without IBM traffic and restores focus on close',()=>{
 const show=vi.fn(function(this:HTMLDialogElement){this.setAttribute('open','');});Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:show});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 const network=vi.fn();vi.stubGlobal('fetch',network);
 function Harness(){const [open,setOpen]=useState(false);return <><label>Case narrative<textarea defaultValue="Unchanged case"/></label><button onClick={()=>setOpen(true)}>Guided Follow-up AI Assistant</button>{open&&<AssistantPanel onClose={()=>setOpen(false)}/>}</>;}
 render(<Harness/>);const launch=screen.getByRole('button',{name:'Guided Follow-up AI Assistant'});launch.focus();fireEvent.click(launch);
 expect(show).toHaveBeenCalledTimes(1);expect(screen.getByRole('dialog')).toBeVisible();expect(screen.getByRole('status')).toHaveTextContent('awaiting security authorization');
 expect(document.getElementById('endoEmbeddedAgentMount')).not.toBeNull();expect(document.querySelector('script[src*="wxoLoader"]')).toBeNull();expect(network).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Close AI Assistant'}));expect(screen.queryByRole('dialog')).toBeNull();expect(launch).toHaveFocus();expect(screen.getByRole('textbox')).toHaveValue('Unchanged case');
});
