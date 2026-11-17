import {render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import DiscussionMarkdown from '../src/DiscussionMarkdown';
import {readFileSync} from 'node:fs';
import userEvent from '@testing-library/user-event';
import {discussionSectionCategory} from '../src/DiscussionSections';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import IBMHeadingFixtures from './ibmHeadingFixtures.json';

it('renders educational headings, emphasis, lists, quotations and existing follow-up questions',()=>{
 const text='# Educational possibilities\n\n**Discussion**, not a *diagnosis*.\n\n1. Reported symptoms\n2. Remaining uncertainty\n\n- Timing\n- Context\n\n> Fictional history only\n\n### Follow-up questions\n\nWhat has already been clarified?';
 render(<DiscussionMarkdown text={text}/>);
 expect(screen.getByRole('heading',{name:'Educational possibilities'})).toBeVisible();expect(screen.getByText('Discussion').tagName).toBe('STRONG');expect(screen.getByText('diagnosis').tagName).toBe('EM');expect(screen.getAllByRole('list')).toHaveLength(2);expect(screen.getAllByRole('listitem')).toHaveLength(4);expect(screen.getByText('Fictional history only').closest('blockquote')).not.toBeNull();expect(screen.getByText('What has already been clarified?')).toBeVisible();
});
it('renders a long fictional differential discussion and a keyboard-accessible GFM table without changing its source',()=>{
 const text='## Educational differential discussion\n\nPossible explanations remain uncertain; this is not an individual diagnosis.\n\n| Possibility | Reported context | Uncertainty |\n| :--- | :---: | ---: |\n| Endometriosis | Recurring symptoms | Not established here |\n| Other causes | Incomplete history | Requires clarification |\n\n'+('Additional educational discussion remains unverified.\n\n').repeat(100)+'**Follow-up:** What information remains unknown?';
 const original=text;render(<DiscussionMarkdown text={text}/>);expect(screen.getByRole('table')).toBeVisible();expect(screen.getAllByRole('columnheader')).toHaveLength(3);expect(screen.getByRole('region',{name:'AI discussion table'})).toHaveAttribute('tabindex','0');expect(screen.getByText('Follow-up:').tagName).toBe('STRONG');expect(text).toBe(original);
});
it.each(['<script>alert(1)</script>','<img src="https://untrusted.invalid/x" onerror="alert(1)">','<iframe src="https://untrusted.invalid"></iframe>','<svg onload="alert(1)"></svg>','[unsafe](javascript:alert%281%29)','[data](data:text/html,unsafe)','![remote](https://untrusted.invalid/tracking.png)','[reference](https://untrusted.invalid/article)','https://untrusted.invalid/article'])('never executes HTML, navigates links or fetches media %#',text=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const {container}=render(<DiscussionMarkdown text={text}/>);expect(container.querySelector('script,img,iframe,svg,object,embed,a,[href],[src],[onerror],[onload]')).toBeNull();expect(fetch).not.toHaveBeenCalled();
});
it('converts only attribute-free literal breaks and keeps code examples literal',()=>{
 const {container}=render(<DiscussionMarkdown text={'First<br>Second<br />Third\n\n`<br>`\n\n```html\n<br>\n```\n\n<br onload="alert(1)">Not active'}/>);expect(container.querySelectorAll('br')).toHaveLength(2);expect(container.querySelectorAll('code')).toHaveLength(2);expect(container.querySelector('[onload]')).toBeNull();expect(container.textContent).toContain('<br onload="alert(1)">');
});
it.each(['**Unclosed emphasis\n\n| incomplete | table','## Heading\n\n1. Item\n  - unfinished nested item\n\n[unfinished link](','> Seek urgent assessment.\n\n**Emergency warning remains visible.**'])('handles malformed Markdown and warning text without inventing content %#',text=>{const {container}=render(<DiscussionMarkdown text={text}/>);expect(container.textContent?.length).toBeGreaterThan(0);expect(container.querySelector('script,a,img')).toBeNull();});
it('constrains table overflow and message width at mobile sizes without affecting structured review',()=>{
 const css=readFileSync('src/styles.css','utf8');expect(css).toMatch(/\.discussionTable\s*\{[^}]*max-width:100%;[^}]*overflow-x:auto/s);expect(css).toMatch(/@media\(max-width:640px\)\s*\{\s*\.ibmDiscussion \.conversationMessage[^}]*width:100%/s);
});
it.each([
 ['Patient history','history'],['Reported symptoms','symptoms'],['Gynaecological history','gynecologic'],
 ['Differential considerations','differential'],['Investigations','investigations'],['Treatment considerations','treatment'],
 ['Documentation','documentation'],['Follow-up questions','followup'],['2. Follow-up questions:','followup'],
 ['An unfamiliar heading','neutral'],['Severe pain with possible ectopic pregnancy','neutral'],['Safety information','safety']
])('maps explicit section labels without inferring diagnoses or urgency %#',(heading,category)=>{expect(discussionSectionCategory(heading)).toBe(category);});
it('keeps complete formatted titles accessible and icons decorative',()=>{
 const {container}=render(<DiscussionMarkdown text={'## **Patient history**\n\nReported information.\n\n## Unfamiliar heading\n\nNo category inferred.'}/>);
 expect(screen.getByRole('heading',{name:'Patient history'})).toBeVisible();expect(screen.getByRole('heading',{name:'Unfamiliar heading'})).toBeVisible();
 const summaries=container.querySelectorAll('summary');expect(summaries[0]).toHaveAttribute('data-section-category','history');expect(summaries[1]).toHaveAttribute('data-section-category','neutral');
 for(const icon of container.querySelectorAll('svg')){expect(icon).toHaveAttribute('aria-hidden','true');expect(icon).toHaveAttribute('focusable','false');expect(icon).toHaveAttribute('width','16');expect(icon).not.toHaveAttribute('aria-label');}
 expect(screen.queryByRole('img')).toBeNull();
});
it('supports Tab, Enter, Space and click activation without losing text or collapsed state on rerender',async()=>{
 const text='## Patient history\n\nHistory retained.\n\n## Follow-up questions\n\nWhat remains uncertain?',view=render(<DiscussionMarkdown text={text}/>),summary=screen.getByRole('heading',{name:'Patient history'}).closest('summary')!,details=summary.parentElement!;
 expect(details).toHaveAttribute('open');await userEvent.tab();expect(screen.getByRole('button',{name:'Expand all'})).toHaveFocus();await userEvent.tab();expect(screen.getByRole('button',{name:'Collapse all'})).toHaveFocus();await userEvent.tab();expect(summary).toHaveFocus();await userEvent.keyboard('{Enter}');expect(details).not.toHaveAttribute('open');expect(screen.getByText('History retained.')).not.toBeVisible();
 view.rerender(<DiscussionMarkdown text={text}/>);expect(details).not.toHaveAttribute('open');await userEvent.keyboard(' ');expect(details).toHaveAttribute('open');expect(screen.getByText('History retained.')).toBeVisible();await userEvent.click(summary);expect(details).not.toHaveAttribute('open');await userEvent.tab();expect(screen.getByRole('heading',{name:'Follow-up questions'}).closest('summary')).toHaveFocus();
});
it('never hides a safety section inside its own or an ancestor accordion',()=>{
 const {container}=render(<DiscussionMarkdown text={'# Review\n\n## Patient history\n\nReported history.\n\n## Emergency warning\n\nWarning text must remain visible.\n\n### Additional warning context\n\nMore warning text.'}/>);
 expect(screen.getByText('Warning text must remain visible.')).toBeVisible();expect(screen.getByText('Warning text must remain visible.').closest('details')).toBeNull();expect(screen.getByText('More warning text.').closest('details')).toBeNull();expect(screen.getByRole('heading',{name:'Emergency warning'}).closest('summary')).toBeNull();expect(container.querySelector('.discussionSafetySection')).not.toHaveAttribute('role','alert');
});
it('does not interpret headings inside quotations, code or provider HTML as controls',()=>{
 const {container}=render(<DiscussionMarkdown text={'> ## Quoted heading\n> Quoted text.\n\n```markdown\n## Code heading\n```\n\n<details><summary onclick="alert(1)">Injected</summary>Raw text</details>'}/>);expect(container.querySelector('details,summary,[onclick]')).toBeNull();expect(container.querySelectorAll('svg')).toHaveLength(0);
});
it('keeps subtle icon geometry and wrapped headings aligned at mobile widths',()=>{
 const css=readFileSync('src/styles.css','utf8');expect(css).toMatch(/grid-template-columns:1rem minmax\(0,1fr\) 1rem/);expect(css).toMatch(/\.discussionSectionHeading\s*\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere/s);expect(css).toMatch(/\.discussionSectionIcon[^}]*width:1rem; height:1rem/s);expect(css).toMatch(/\.discussionSummary[^}]*min-height:44px/s);
});
it.each(IBMHeadingFixtures.variants)('records the parser interpretation of the synthetic IBM-style $id fixture before section grouping',({title,astType})=>{
 let firstType:string|undefined;function observe(){return(tree:unknown)=>{firstType=(tree as {children:{type:string}[]}).children[0]?.type;};}
 render(<Markdown remarkPlugins={[remarkGfm,observe]}>{title+'\n\n'+IBMHeadingFixtures.table}</Markdown>);expect(firstType).toBe(astType);expect(screen.getByRole('table')).toBeVisible();
});
it.each(IBMHeadingFixtures.variants)('groups the synthetic $id title, differential table, icon and chevron together',async({title})=>{
 const text=title+'\n\n'+IBMHeadingFixtures.table+'\n\n## Follow-up questions\n\nWhat remains unknown?',original=text;render(<DiscussionMarkdown text={text}/>);
 const summary=screen.getByRole('heading',{name:/^1[.)] Differential considerations$/}).closest('summary')!;expect(summary).not.toBeNull();expect(summary).toHaveAttribute('data-section-category','differential');expect(summary.querySelector('.lucide-list-tree')).not.toBeNull();expect(summary.querySelector('.discussionSectionChevron')).not.toBeNull();expect(screen.getByRole('table').closest('details')).toBe(summary.parentElement);
 await userEvent.click(summary);expect(screen.getByRole('table',{hidden:true})).not.toBeVisible();expect(screen.getByText('What remains unknown?')).toBeVisible();summary.focus();await userEvent.keyboard('{Enter}');expect(screen.getByRole('table')).toBeVisible();expect(text).toBe(original);
});
it.each([
 '1. Differential considerations\n2. Review the table below.\n\n'+IBMHeadingFixtures.table,
 '- Differential considerations\n\n'+IBMHeadingFixtures.table,
 '1. Differential considerations\n\n   '+IBMHeadingFixtures.table.replace(/\n/g,'\n   '),
 '1. `Differential considerations`\n\n'+IBMHeadingFixtures.table,
 '1. Differential considerations include several possibilities.\n\n'+IBMHeadingFixtures.table,
 '1. Differential considerations\n\nOrdinary explanatory paragraph, not an explicit section/table boundary.',
 '**Differential considerations** are not established here.\n\n'+IBMHeadingFixtures.table,
 '| Label | Context |\n| --- | --- |\n| **1. Differential considerations** | Ordinary table cell |',
 '> **1. Differential considerations**\n> Quoted text.',
 '```markdown\n**1. Differential considerations**\n```',
 '**An unfamiliar standalone title**\n\n'+IBMHeadingFixtures.table,
 '**Differential considerations**'
])('does not promote ordinary or ambiguous list, paragraph, table, quoted or code content %#',text=>{const {container}=render(<DiscussionMarkdown text={text}/>);expect(container.querySelector('details,summary')).toBeNull();});
it('retains lists and Markdown numbering instead of swallowing them into an inferred section',()=>{
 const text='1. Differential considerations\n2. Follow-up questions\n\n'+IBMHeadingFixtures.table;render(<DiscussionMarkdown text={text}/>);expect(screen.getAllByRole('listitem')).toHaveLength(2);expect(screen.getByRole('list').tagName).toBe('OL');expect(screen.getByRole('table').closest('details')).toBeNull();
});
it('keeps recognized bold safety sections visible outside collapsible ancestors',()=>{
 render(<DiscussionMarkdown text={'# Review\n\n**1. Emergency warning**\n\nWarning remains visible.\n\n**2. Follow-up questions**\n\nWhat remains unknown?'}/>);expect(screen.getByText('Warning remains visible.').closest('details')).toBeNull();expect(screen.getByRole('heading',{name:'1. Emergency warning'})).toBeVisible();
});
it.each(['markdown','bold','numbered','numberedBold'])('creates five independent sibling sections from the reconstructed %s response',async format=>{
 const source=IBMHeadingFixtures.majorSections.map(({number,title,body})=>{const label=number+'. '+title;return (format==='markdown'?'## '+label:format==='bold'?'**'+label+'**':format==='numberedBold'?number+'. **'+title+'**':label)+'\n\n'+body;}).join('\n\n'),original=source;
 const {container}=render(<DiscussionMarkdown text={source}/>);const summaries=container.querySelectorAll('summary');expect(summaries).toHaveLength(5);
 const sections=[...summaries].map(summary=>summary.parentElement!);expect(new Set(sections.map(section=>section.parentElement)).size).toBe(1);
 for(const [index,summary] of [...summaries].entries()){expect(summary).toHaveTextContent(IBMHeadingFixtures.majorSections[index].title);expect(summary).toHaveAttribute('data-section-category',IBMHeadingFixtures.majorSections[index].category);expect(summary.querySelector('.discussionSectionIcon')).not.toBeNull();expect(summary.querySelector('.discussionSectionChevron')).not.toBeNull();expect(sections[index]).toHaveAttribute('open');}
 expect(screen.getAllByRole('table')[0].closest('details')).toBe(sections[0]);expect(screen.getAllByRole('table')[1].closest('details')).toBe(sections[3]);await userEvent.click(summaries[0]);expect(screen.getAllByRole('table',{hidden:true})[0]).not.toBeVisible();expect(summaries[1]).toBeVisible();expect(screen.getByText('Reported fictional history remains unverified.')).toBeVisible();await userEvent.click(summaries[1]);expect(screen.getByText('Reported fictional history remains unverified.')).not.toBeVisible();expect(summaries[2]).toBeVisible();expect(source).toBe(original);
});
it('recognizes an indented bold section outline while preserving its paragraph, table and list bodies',()=>{
 const text=IBMHeadingFixtures.majorSections.map(({number,title,body})=>number+'. **'+title+'**\n\n'+body.split('\n').map(line=>'   '+line).join('\n')).join('\n\n');const {container}=render(<DiscussionMarkdown text={text}/>);expect(container.querySelectorAll('summary')).toHaveLength(5);expect(screen.getAllByRole('table')).toHaveLength(2);expect(screen.getAllByRole('listitem')).toHaveLength(2);expect(screen.getByText('Reported fictional history remains unverified.').closest('details')).toHaveTextContent('2. Patient history (as reported)');
});
it('recognizes unknown major titles structurally with neutral icons rather than requiring clinical keywords',()=>{
 const titles=['Overview (fictional)','Additional context','Open observations','Supporting records','Remaining uncertainties'];const text=IBMHeadingFixtures.majorSections.map(({number,body},index)=>number+'. '+titles[index]+'\n\n'+body).join('\n\n');const {container}=render(<DiscussionMarkdown text={text}/>);expect(container.querySelectorAll('summary')).toHaveLength(5);for(const summary of container.querySelectorAll('summary')){expect(summary).toHaveAttribute('data-section-category','neutral');expect(summary.querySelector('.lucide-file-text')).not.toBeNull();}
});
it('preserves nested Markdown subsections and sibling boundaries across mixed heading formats',()=>{
 const text=IBMHeadingFixtures.majorSections.map(({number,title,body})=>(number===1?'## '+number+'. '+title:number===2?'**'+number+'. '+title+'**':number+'. '+title)+'\n\n'+body+(number===1?'\n\n### Context notes\n\nNested detail.':'')).join('\n\n');render(<DiscussionMarkdown text={text}/>);const first=screen.getByRole('heading',{name:'1. Differential considerations'}).closest('details')!,second=screen.getByRole('heading',{name:'2. Patient history (as reported)'}).closest('details')!,nested=screen.getByRole('heading',{name:'Context notes'}).closest('details')!;expect(second.parentElement).toBe(first.parentElement);expect(nested.parentElement?.closest('details')).toBe(first);expect(screen.getByText('Nested detail.').closest('details')).toBe(nested);
});
it('scopes bulk keyboard controls to one response and leaves safety sections visible',async()=>{
 const text='# Review\n\n'+IBMHeadingFixtures.majorSections.map(({number,title,body})=>'**'+number+'. '+title+'**\n\n'+body).join('\n\n')+'\n\n**6. Emergency warning**\n\nWarning remains visible.';
 const {container}=render(<><DiscussionMarkdown text={text}/><DiscussionMarkdown text={'## Elsewhere\n\nOther response retained.'}/></>);const first=container.querySelectorAll('.discussionMarkdown')[0],other=screen.getByRole('heading',{name:'Elsewhere'}).closest('details')!;
 const collapse=screen.getByRole('button',{name:'Collapse all'});collapse.focus();await userEvent.keyboard(' ');for(const details of first.querySelectorAll('details'))expect(details).not.toHaveAttribute('open');expect(other).toHaveAttribute('open');expect(screen.getByText('Warning remains visible.')).toBeVisible();expect(screen.getByText('Warning remains visible.').closest('details')).toBeNull();
 const expand=screen.getByRole('button',{name:'Expand all'});expand.focus();await userEvent.keyboard('{Enter}');for(const details of first.querySelectorAll('details'))expect(details).toHaveAttribute('open');expect(screen.getAllByRole('table')).toHaveLength(2);
});
it.each([
 '1. Check the displayed value.\n2. Record the fictional result.\n3. Review the notes.\n\n'+IBMHeadingFixtures.table,
 '1. **Check the value**\n\n   Record the fictional result.\n\n2. **Review the notes**\n\n   Keep the original record.',
 '1. Check the value\n\nRecord a fictional result.\n\n2. Review the notes\n\n'+IBMHeadingFixtures.table
])('keeps numbered instructions as lists rather than inferring major sections %#',text=>{const {container}=render(<DiscussionMarkdown text={text}/>);expect(container.querySelector('details,summary')).toBeNull();expect(screen.getAllByRole('list').length).toBeGreaterThan(0);expect(screen.queryByRole('button',{name:'Collapse all'})).toBeNull();});
