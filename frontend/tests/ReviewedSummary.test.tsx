import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze } from '../../netlify/evaluation/analysis';
import { loadPackages, Module1 } from '../../netlify/evaluation/packages';
import { validateCase } from '../../netlify/evaluation/input';
import { readReview, PrescribingNotice } from '../src/api';
import ResponsePanel from '../src/ResponsePanel';
import type { FindingCard } from '../src/findingRules';

const Packages=loadPackages();
function envelope(){return analyze(validateCase({moduleHint:Module1,additionalNotes:'Normal transvaginal ultrasound. Does this exclude endometriosis?'}),Packages).envelope;}
const Summary='A normal internal pelvic ultrasound cannot rule out endometriosis.';
const Presentation={presentationVersion:'1',paragraphs:[{text:Summary,numbers:[1]}]};
const Findings:FindingCard[]=[{id:'generalReview',label:'General pelvic health review',reported:'Deterministic visual context.',kind:'discussion',numbers:[1],paragraphs:[{text:'Previous deterministic display explanation.',numbers:[1]}]}];
afterEach(cleanup);

describe('optional reviewed summary display',()=>{
 it('uses the existing Summary visual unit once and preserves technical details and source links',async()=>{
  const payload={...envelope(),reviewedPresentation:Presentation},review=readReview(payload,false,'competition');render(<ResponsePanel review={review} findings={Findings} competition />);
  expect(screen.getAllByRole('heading',{name:'Summary'})).toHaveLength(1);expect(screen.getAllByText(Summary,{exact:false})).toHaveLength(1);expect(document.querySelectorAll('.visualSummary')).toHaveLength(1);expect(screen.queryByText('Previous deterministic display explanation.')).not.toBeInTheDocument();
  const visual=document.querySelector('.visualSummary')! as HTMLElement;expect(within(visual).getByText(Summary,{exact:false})).toBeVisible();expect(within(visual).getByRole('heading',{name:'General pelvic health review'})).toBeVisible();
  const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'View clinical and educational details'}));expect(screen.getByText('A normal transvaginal ultrasound does not exclude endometriosis.',{exact:false})).toBeVisible();await user.click(within(visual).getByRole('button',{name:'View cited sources 1'}));const url=payload.sources[0].source.verifiedUrl;if(url){const link=screen.getByRole('link',{name:/opens in a new tab/});expect(link).toHaveAttribute('href',url);expect(link).toHaveAttribute('rel','noopener noreferrer');}else expect(screen.getByRole('button',{name:'[1] View source details'})).toBeVisible();
 });
 it.each([
  {presentationVersion:'2',paragraphs:Presentation.paragraphs},{...Presentation,extra:true},
  {presentationVersion:'1',paragraphs:[{text:Summary,numbers:[999]}]},
  {presentationVersion:'1',paragraphs:[{text:Summary,numbers:[1,1]}]},
  {presentationVersion:'1',paragraphs:[{text:'<script>unsafe</script>',numbers:[1]}]},
  {presentationVersion:'1',paragraphs:[{text:'https://example.invalid',numbers:[1]}]},
  {presentationVersion:'1',paragraphs:[]},
 ])('ignores malformed optional presentation without losing the deterministic response',reviewedPresentation=>{
  const baseline=readReview(envelope(),false,'competition'),review=readReview({...envelope(),reviewedPresentation},false,'competition');expect(review).toEqual(baseline);render(<ResponsePanel review={review} findings={Findings} />);expect(screen.getByText('Previous deterministic display explanation.',{exact:false})).toBeVisible();
 });
 it('does not apply optional presentation to prescribing, urgency, halts or noncompetition responses',()=>{
  const payload=envelope();payload.renderedText=PrescribingNotice+'\n\n'+payload.renderedText;
  const review=readReview({...payload,reviewedPresentation:Presentation},false,'competition');expect(review.reviewedSummary).toBeUndefined();
  render(<ResponsePanel review={{...review,warnings:[{text:'Urgent assessment first.',numbers:[1]}],reviewedSummary:[{text:'Synthetic reviewed sentinel.',numbers:[1]}]}} findings={Findings} />);
  expect(screen.getByRole('alert').textContent).toContain('Urgent assessment first.');expect(screen.queryByText('Synthetic reviewed sentinel.',{exact:false})).not.toBeInTheDocument();
 });
 it('keeps multiple visual cards but never duplicates reviewed prose',()=>{
  const review=readReview({...envelope(),reviewedPresentation:Presentation},false,'competition');render(<ResponsePanel review={review} findings={[...Findings,{id:'pelvicPain',label:'Pelvic pain or discomfort',reported:'Pelvic pain reported.',kind:'reported',numbers:[1]}]} />);expect(screen.getAllByText(Summary,{exact:false})).toHaveLength(1);expect(document.querySelectorAll('.summaryFindings > li')).toHaveLength(2);
 });
});
