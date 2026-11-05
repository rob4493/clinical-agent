import {render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {it,expect,vi} from 'vitest';
import GuidedFollowup from '../src/GuidedFollowup';
import {runConversation} from '../../netlify/evaluation/conversation';
import {loadPackages,Module1} from '../../netlify/evaluation/packages';
import {validateCase} from '../../netlify/evaluation/input';
import {analyze} from '../../netlify/evaluation/analysis';
import {selectFollowup} from '../../netlify/evaluation/structuredFollowup';

it('labels local fallback honestly and provides a keyboard-accessible session-only recap',async()=>{
 const packages=loadPackages(),caseInput={moduleHint:Module1,caseType:'detailed' as const,pregnancyPossible:false,additionalNotes:'Intermittent pelvic discomfort over several months. Please review the reported pattern and uncertainty.'},checked=validateCase(caseInput),confirm=vi.fn();
 const storage=[vi.spyOn(Storage.prototype,'setItem')];
 const fetch=vi.fn(async(url:string,init:RequestInit)=>{expect(url).toBe('/api/v1/followup');expect(init.credentials).toBe('same-origin');expect(init.redirect).toBe('error');expect(init.headers).not.toHaveProperty('Authorization');return new Response(JSON.stringify(runConversation(JSON.parse(init.body as string),packages,new AbortController().signal)));});vi.stubGlobal('fetch',fetch);
 const view=render(<GuidedFollowup mode={selectFollowup(checked,analyze(checked,packages),packages)} caseInput={caseInput} onConfirm={confirm} onConflict={vi.fn()} onReturn={vi.fn()}/>);
 await userEvent.click(screen.getByRole('button',{name:'Start guided follow-up'}));await userEvent.click(screen.getByRole('button',{name:'Use local fallback'}));expect(screen.getByRole('note')).toHaveTextContent('IBM conversation is not enabled');expect(screen.queryByText('Review what you have said')).not.toBeInTheDocument();
 await userEvent.type(screen.getByRole('textbox',{name:'Follow-up message'}),'Possibly during intercourse');await userEvent.click(screen.getByRole('button',{name:'Send'}));await screen.findByRole('heading',{name:'Clarify reported information'});
 const summary=screen.getByText('Review what you have said'),details=summary.closest('details')!;expect(details.open).toBe(false);expect(summary.tagName).toBe('SUMMARY');await userEvent.click(summary);expect(details.open).toBe(true);expect(within(details).getByRole('listitem')).toHaveTextContent('Possibly during intercourse');expect(within(details).getByText(/not verified findings/)).toBeVisible();expect(confirm).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole('button',{name:'End session'}));await userEvent.click(screen.getByRole('button',{name:'Start guided follow-up'}));await userEvent.click(screen.getByRole('button',{name:'Use local fallback'}));expect(screen.queryByText('Review what you have said')).not.toBeInTheDocument();storage.forEach(write=>expect(write).not.toHaveBeenCalled());expect(fetch).toHaveBeenCalledOnce();view.unmount();
});
