// @vitest-environment node
import {expect,it} from 'vitest';
import {selectDiscussionSources} from '../../netlify/evaluation/discussionSources';
import {discussionSource,readDiscussionSourceIds} from '../../shared/discussionSources';
it.each([
 ['Endometriosis may be discussed educationally.',['WHO-2025']],
 ['Diagnosis of endometriosis requires independent assessment.',['WHO-2025','NICHD-DX']],
 ['Pelvic inflammatory disease is the topic of this educational discussion.',['CDC-PID']],
 ['Early pregnancy and ectopic pregnancy are discussed here.',['NICE-NG126-2026']],
 ['Urgent maternal warning signs are discussed here.',['CDC-MATERNAL-WARNINGS-2024']],
 ['Pelvic discomfort has many possible explanations.',[]],
 ['Hello. How can I help?',[]]
])('selects reading only for the actual answer topic: %s',(answer,ids)=>expect(selectDiscussionSources(answer)).toEqual(ids));
it('never promotes model URLs, source identifiers, unresolved ACOG URLs or arbitrary strings',()=>{
 expect(selectDiscussionSources('Read https://evil.invalid/path or source WHO-2025')).toEqual([]);
 expect(discussionSource('ACOG-CPP')).toBeUndefined();expect(discussionSource('ACOG-ECTOPIC-FAQ155')).toBeUndefined();
 for(const value of [['https://evil.invalid'],['javascript:alert(1)'],['WHO-2025','WHO-2025'],['WHO-2025','unknown'],{url:'https://www.who.int'},null])expect(readDiscussionSourceIds(value)).toEqual([]);
 expect(readDiscussionSourceIds(['WHO-2025'])).toEqual(['WHO-2025']);
});

it('does not select topics from URL paths or code examples',()=>{expect(selectDiscussionSources('See https://evil.invalid/endometriosis')).toEqual([]);expect(selectDiscussionSources('An unrelated code example: `endometriosis`')).toEqual([]);});
