import {StrictMode} from 'react';
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import GuidedFollowup from '../src/GuidedFollowup';
import {selectFollowup} from '../../netlify/evaluation/structuredFollowup';
import {analyze} from '../../netlify/evaluation/analysis';
import {validateCase} from '../../netlify/evaluation/input';
import {loadPackages} from '../../netlify/evaluation/packages';
it('attempts only an operational bootstrap in StrictMode and never sends the case to IBM',async()=>{
 const packages=loadPackages(),caseInput={moduleHint:'module_01_endo',caseType:'brief' as const,pregnancyPossible:false,additionalNotes:'Pelvic pain over several months. Please review the reported pattern.'},base=validateCase(caseInput);
 const transport=vi.fn(async()=>new Response('{"code":"embedDisabled"}',{status:404}));vi.stubGlobal('fetch',transport);
 const confirm=vi.fn();const view=render(<StrictMode><GuidedFollowup mode={selectFollowup(base,analyze(base,packages),packages)} caseInput={caseInput} onConfirm={confirm} onConflict={vi.fn()} onReturn={vi.fn()}/></StrictMode>);
 expect(transport).not.toHaveBeenCalled();await userEvent.click(screen.getByRole('button',{name:'Start AI conversation'}));
 await waitFor(()=>expect(screen.getByRole('note')).toHaveTextContent('preview activation is disabled'));
 expect(transport).toHaveBeenCalledOnce();const [url,options]=transport.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('/api/v1/embed-session');expect(JSON.parse(String(options.body))).toEqual({action:'start'});expect(options.credentials).toBe('same-origin');expect(options.headers).not.toHaveProperty('Authorization');
 expect(document.querySelector('script[src*="wxoLoader"]')).toBeNull();expect(screen.queryByRole('dialog')).toBeNull();expect(confirm).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole('button',{name:'Use local fallback'}));expect(screen.getByRole('note')).toHaveTextContent('Local fallback');await userEvent.click(screen.getByRole('button',{name:'End session'}));expect(confirm).not.toHaveBeenCalled();view.unmount();
});
