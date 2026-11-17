import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
const elements=['p','br','h1','h2','h3','h4','h5','h6','strong','em','del','ul','ol','li','blockquote','hr','pre','code','table','thead','tbody','tr','th','td','a','img'];
/** Presentation only. No HTML parser, URL navigation, media fetch or clinical authority. */
export default function DiscussionMarkdown({text}:{text:string}){
 return <div className="discussionMarkdown"><Markdown remarkPlugins={[remarkGfm,literalBreaks]} allowedElements={elements} urlTransform={()=>''} components={{
  a:({children})=><span className="discussionReference" title="Unverified AI reference; navigation disabled">{children}</span>,
  img:({alt})=><span className="discussionReference">{alt?`[Image omitted: ${alt}]`:'[Image omitted]'}</span>,
  table:({children})=><div className="discussionTable" role="region" aria-label="AI discussion table" tabIndex={0}><table>{children}</table></div>,
  h1:({children})=><h4>{children}</h4>,h2:({children})=><h4>{children}</h4>,h3:({children})=><h5>{children}</h5>,h4:({children})=><h5>{children}</h5>,h5:({children})=><h6>{children}</h6>,h6:({children})=><h6>{children}</h6>,
 }}>{text}</Markdown></div>;
}
