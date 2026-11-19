import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {discussionSections,reportedPelvicDiscussionTopic,DiscussionSummary,DiscussionStaticTitle} from './DiscussionSections';
import {useEffect,useId,useRef,useState} from 'react';

// Convert only a standalone, attribute-free literal <br> AST node. Never parse
// raw HTML, rewrite clinical text, or change code spans/blocks or stored history.
function literalBreaks(){
 return (tree:unknown)=>{
  function visit(value:unknown){
   if(!value||typeof value!=='object')return;
   const node=value as {type?:string;value?:unknown;children?:unknown[]};
   if(node.type==='html'&&typeof node.value==='string'&&/^<br\s*\/?\s*>$/i.test(node.value.trim())){node.type='break';delete node.value;}
   if(Array.isArray(node.children))node.children.forEach(visit);
  }
  visit(tree);
 };
}
const elements=['p','br','h1','h2','h3','h4','h5','h6','strong','em','del','ul','ol','li','blockquote','hr','pre','code','table','thead','tbody','tr','th','td','a','img','details','summary','section','div'];
/** Presentation only. No HTML parser, URL navigation, media fetch or clinical authority. */
export default function DiscussionMarkdown({text,clinicianMessage}:{text:string;clinicianMessage?:string}){
 const content=useRef<HTMLDivElement>(null),contentId=useId(),[multiple,setMultiple]=useState(false);
 useEffect(()=>{setMultiple((content.current?.querySelectorAll('details.discussionSection').length??0)>1);},[text]);
 function all(open:boolean){content.current?.querySelectorAll<HTMLDetailsElement>('details.discussionSection').forEach(section=>{section.open=open;});}
 return <div className="discussionMarkdown">{multiple&&<div className="discussionSectionControls" role="group" aria-label="Response section controls"><button type="button" aria-controls={contentId} onClick={()=>all(true)}>Expand all</button><button type="button" aria-controls={contentId} onClick={()=>all(false)}>Collapse all</button></div>}<div id={contentId} ref={content}><Markdown remarkPlugins={[remarkGfm,literalBreaks,[discussionSections,{fallbackTopic:reportedPelvicDiscussionTopic(clinicianMessage)?'pelvicPain':undefined}]]} allowedElements={elements} urlTransform={()=>''} components={{
  summary:DiscussionSummary,div:DiscussionStaticTitle,
  a:({children})=><span className="discussionReference" title="Unverified AI reference; navigation disabled">{children}</span>,
  img:({alt})=><span className="discussionReference">{alt?`[Image omitted: ${alt}]`:'[Image omitted]'}</span>,
  table:({children})=><div className="discussionTable" role="region" aria-label="AI discussion table" tabIndex={0}><table>{children}</table></div>,
  h1:({children})=><h4>{children}</h4>,h2:({children})=><h4>{children}</h4>,h3:({children})=><h5>{children}</h5>,h4:({children})=><h5>{children}</h5>,h5:({children})=><h6>{children}</h6>,h6:({children})=><h6>{children}</h6>,
 }}>{text}</Markdown></div></div>;
}
