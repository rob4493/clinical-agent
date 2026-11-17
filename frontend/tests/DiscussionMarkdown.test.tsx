import {render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import DiscussionMarkdown from '../src/DiscussionMarkdown';
import {readFileSync} from 'node:fs';

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
