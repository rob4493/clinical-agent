import {fireEvent} from '@testing-library/react';
import {DemoCases,PregnancyCases} from '../src/DemoCases';
/** Test-only access to the full retained corpus through ordinary form controls. */
export function loadRetainedExample(id:string){
 const example=[...DemoCases,...PregnancyCases].find(item=>item.id===id);if(!example)throw new Error('Unknown fixture');
 const module=document.querySelector<HTMLInputElement>('input[value="SyntheticDemo"]')??document.querySelector<HTMLInputElement>('input[value="'+example.moduleId+'"]');if(!module)throw new Error('Fixture module unavailable');fireEvent.click(module);
 const change=(id:string,value:unknown)=>fireEvent.change(document.getElementById(id)!,{target:{value}});
 change('ageRange',example.ageRange);change('caseType',example.caseType);change('pregnancy',example.pregnancy);change('pid',example.pid);change('narrative',example.narrative);
 for(const [key,value] of Object.entries(example.earlyPregnancy??{}))change(key,typeof value==='boolean'?value?'yes':'no':value??'');
}
