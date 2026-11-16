import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import EditableConversation from '../src/EditableConversation';
import ResponsePanel from '../src/ResponsePanel';

const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
async function open(){await userEvent.click(screen.getByRole('button',{name:'Continue with Endo AI'}));await userEvent.click(screen.getByRole('checkbox'));}
it('supports editable messages, follow-ups, collapse/reopen and explicit isolated reset without storage',async()=>{
 const storage=vi.spyOn(Storage.prototype,'setItem'),fetch=vi.fn(async(_url:string,init:RequestInit)=>{
  const body=JSON.parse(String(init.body));return json(body.action==='start'?{version:'2',state:'started',receipt:'opaqueStart'}:{version:'2',state:'replied',receipt:'opaqueNext',text:'Educational response '+body.message});
 });vi.stubGlobal('fetch',fetch);render(<EditableConversation/>);await open();
 await userEvent.type(screen.getByRole('textbox',{name:'Ask Endo'}),'what is endometriosis?');await userEvent.click(screen.getByRole('button',{name:'Send to Endo'}));await screen.findByText('Educational response what is endometriosis?');
 await userEvent.type(screen.getByRole('textbox',{name:'Ask Endo'}),'please explain more');await userEvent.click(screen.getByRole('button',{name:'Send to Endo'}));await screen.findByText('Educational response please explain more');
 expect(JSON.parse(String(fetch.mock.calls[2][1].body))).toEqual({version:'2',action:'turn',receipt:'opaqueNext',history:['what is endometriosis?'],message:'please explain more'});
 await userEvent.click(screen.getByRole('button',{name:'Collapse Endo AI'}));await userEvent.click(screen.getByRole('button',{name:'Continue with Endo AI'}));expect(screen.getByText('Educational response please explain more')).toBeVisible();
 await userEvent.click(screen.getByRole('button',{name:'New conversation'}));expect(screen.queryByText('Educational response please explain more')).not.toBeInTheDocument();expect(storage).not.toHaveBeenCalled();
});
it('preserves draft and history after failure, requires explicit reset and never retries automatically',async()=>{
 const fetch=vi.fn(async(_url:string,init:RequestInit)=>json(JSON.parse(String(init.body)).action==='start'?{version:'2',state:'started',receipt:'opaque'}:{code:'unavailable'},JSON.parse(String(init.body)).action==='start'?200:503));vi.stubGlobal('fetch',fetch);
 render(<EditableConversation/>);await open();const box=screen.getByRole('textbox',{name:'Ask Endo'});await userEvent.type(box,'unanswered education question');await userEvent.click(screen.getByRole('button',{name:'Send to Endo'}));await screen.findByText(/Your draft is preserved/);expect(box).toHaveValue('unanswered education question');expect(fetch).toHaveBeenCalledTimes(2);expect(screen.getByRole('button',{name:'Send to Endo'})).toBeDisabled();
});
it('prevents duplicate submissions and aborts on unmount',async()=>{
 let signal:AbortSignal|undefined;const fetch=vi.fn(async(_url:string,init:RequestInit)=>{if(JSON.parse(String(init.body)).action==='start')return json({version:'2',state:'started',receipt:'opaque'});signal=init.signal as AbortSignal;return new Promise<Response>(()=>{});});vi.stubGlobal('fetch',fetch);
 const view=render(<EditableConversation/>);await open();await userEvent.type(screen.getByRole('textbox',{name:'Ask Endo'}),'education');const button=screen.getByRole('button',{name:'Send to Endo'});fireEvent.click(button);fireEvent.click(button);await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));expect(button).toBeDisabled();view.unmount();expect(signal?.aborted).toBe(true);
});
it.each(['safetyHalt','refused','structuredRequired'])('renders %s separately without modifying the structured case',async state=>{
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>json(JSON.parse(String(init.body)).action==='start'?{version:'2',state:'started',receipt:'opaque'}:{version:'2',state,warnings:['Approved warning fixture']})));
 render(<EditableConversation/>);await open();await userEvent.type(screen.getByRole('textbox',{name:'Ask Endo'}),'fictional question');await userEvent.click(screen.getByRole('button',{name:'Send to Endo'}));await waitFor(()=>expect(screen.getByRole('status').textContent).not.toContain('Waiting'));
 if(state==='safetyHalt')expect(screen.getByRole('alert')).toHaveTextContent('Approved warning fixture');expect(screen.getByRole('textbox',{name:'Ask Endo'})).toHaveValue('fictional question');
});
it('offers independent conversation without requiring a structured analysis',()=>{
 render(<ResponsePanel review={null} conversation={<EditableConversation/>}/>);expect(screen.getByRole('button',{name:'Continue with Endo AI'})).toBeVisible();expect(screen.getByText('Ready for your case')).toBeVisible();
});
it('preserves the conversation when analysis is displayed, cleared or rerendered',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>json(JSON.parse(String(init.body)).action==='start'?{version:'2',state:'started',receipt:'opaque'}:{version:'2',state:'replied',receipt:'next',text:'Retained educational response'})));
 const view=render(<ResponsePanel review={null} conversation={<EditableConversation/>}/>);await open();await userEvent.type(screen.getByRole('textbox',{name:'Ask Endo'}),'education');await userEvent.click(screen.getByRole('button',{name:'Send to Endo'}));await screen.findByText('Retained educational response');
 view.rerender(<ResponsePanel review={{moduleId:'module_01_endo',heading:'Review limitation',warnings:[],considerations:[],messages:[],question:null,notice:'Decision support',sources:[]}} conversation={<EditableConversation/>}/>);
 expect(screen.getByText('Retained educational response')).toBeVisible();view.rerender(<ResponsePanel review={null} conversation={<EditableConversation/>}/>);expect(screen.getByText('Retained educational response')).toBeVisible();
});
