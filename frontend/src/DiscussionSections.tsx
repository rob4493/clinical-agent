import {Activity,BookOpen,CalendarDays,ChevronDown,ClipboardList,FileText,ListTree,MessagesSquare,NotebookPen,Search,Shield,type LucideIcon} from 'lucide-react';
import type {ComponentPropsWithoutRef,KeyboardEvent,ReactNode} from 'react';

// Exact presentation labels only: never use diagnoses, symptoms or risk words in
// body text to classify a patient or designate an emergency.
const categories:Record<string,{icon:LucideIcon;labels:readonly string[]}>= {
 history:{icon:ClipboardList,labels:['patient history','clinical history','history','history of presenting complaint']},
 symptoms:{icon:Activity,labels:['symptoms','reported symptoms','presenting symptoms','symptom history']},
 gynecologic:{icon:CalendarDays,labels:['gynecologic history','gynecological history','gynaecologic history','gynaecological history','menstrual history','reproductive history']},
 differential:{icon:ListTree,labels:['differential considerations','differential diagnosis','differential diagnoses','educational differential discussion','possible explanations']},
 investigations:{icon:Search,labels:['investigations','investigation considerations','tests and investigations']},
 treatment:{icon:BookOpen,labels:['treatment considerations','management considerations','treatment options']},
 documentation:{icon:NotebookPen,labels:['documentation','documentation considerations','record keeping']},
 followup:{icon:MessagesSquare,labels:['follow-up questions','follow up questions','follow-up','follow up','clarifying questions','questions to clarify']},
 safety:{icon:Shield,labels:['safety','safety information','safety warnings','emergency warning','emergency warnings','urgent assessment']}
};
export function discussionSectionCategory(heading:string){
 const label=heading.toLowerCase().normalize('NFKC').replace(/^\s*\d+[.)]\s*/,'').replace(/[\s:]+$/,'').replace(/\s+/g,' ').trim();
 return Object.entries(categories).find(([,entry])=>entry.labels.includes(label))?.[0]??'neutral';
}
function Title({category,children,expandable}:{category:string;children:ReactNode;expandable:boolean}){
 const Icon=Object.hasOwn(categories,category)?categories[category].icon:FileText;
 return <><Icon className="discussionSectionIcon" size={16} strokeWidth={1.75} aria-hidden="true" focusable="false"/><span className="discussionSectionHeading">{children}</span>{expandable&&<ChevronDown className="discussionSectionChevron" size={16} strokeWidth={1.75} aria-hidden="true" focusable="false"/>}</>;
}
export function DiscussionSummary({children,node,...props}:ComponentPropsWithoutRef<'summary'>&{node?:unknown;'data-section-category'?:string}){
 function keyboard(event:KeyboardEvent<HTMLElement>){
  if(event.key!=='Enter'&&event.key!==' ')return;
  // Match native summary activation explicitly, including test/user agents
  // without its keyboard default. Prevent the native default double-toggle.
  const details=event.currentTarget.parentElement;
  if(details instanceof HTMLDetailsElement){event.preventDefault();details.open=!details.open;}
 }
 return <summary {...props} onKeyDown={keyboard}><Title category={props['data-section-category']??'neutral'} expandable>{children}</Title></summary>;
}
export function DiscussionStaticTitle({children,className,node,...props}:ComponentPropsWithoutRef<'div'>&{node?:unknown;'data-section-category'?:string}){
 return <div className={className} {...props}>{className==='discussionStaticTitle'?<Title category={props['data-section-category']??'neutral'} expandable={false}>{children}</Title>:children}</div>;
}
type Node={type:string;depth?:number;value?:string;ordered?:boolean;position?:{start:{offset?:number};end:{offset?:number}};children?:Node[];data?:{hName:string;hProperties?:Record<string,string|boolean>}};
function headingText(node:Node):string{return node.type==='text'||node.type==='inlineCode'?node.value??'':node.children?.map(headingText).join('')??'';}
function titleInline(node:Node):boolean{return node.type==='text'||node.type==='strong'&&!!node.children?.every(titleInline);}
/** Promote only exact registered labels at root-level section boundaries.
 * A singleton numbered title additionally needs an immediately following root
 * table; ordinary multi-item, nested or content-bearing lists stay lists. */
function sectionHeadings(nodes:Node[],source:string){
 return nodes.map((node,index)=>{
  if(node.type==='paragraph'&&node.children?.length&&node.children.every(titleInline)){
   const label=headingText(node),bold=node.children.every(child=>child.type==='strong'||child.type==='text'&&!child.value?.trim());
   if(discussionSectionCategory(label)!=='neutral'&&nodes[index+1]&&nodes[index+1].type!=='heading'
    &&(bold||/^\s*\d+[.)]\s+/.test(label)&&nodes[index+1].type==='table'))return {...node,type:'heading',depth:2};
  }
  if(node.type==='list'&&node.ordered&&node.children?.length===1&&nodes[index+1]?.type==='table'){
   const item=node.children[0],paragraph=item.children?.[0];
   if(item.type!=='listItem'||item.children?.length!==1||paragraph?.type!=='paragraph'||!paragraph.children?.every(titleInline))return node;
   const start=node.position?.start.offset,end=paragraph.position?.start.offset;
   const marker=typeof start==='number'&&typeof end==='number'?source.slice(start,end):'';
   if(!/^\s*\d+[.)][ \t]+$/.test(marker)||discussionSectionCategory(headingText(paragraph))==='neutral')return node;
   return {...paragraph,type:'heading',depth:2,children:[{type:'text',value:marker},...(paragraph.children??[])]};
  }
  return node;
 });
}
/** Group root-level Markdown headings and unambiguous presentation titles. Never wrap quotes, lists or tables,
 * and never alter source strings or collapse a recognized safety section. */
export function discussionSections(){return (tree:unknown,file:{value?:unknown})=>{
 const root=tree as Node;if(root.type!=='root'||!Array.isArray(root.children))return;
 function group(nodes:Node[]):Node[]{
  const result:Node[]=[];
  for(let i=0;i<nodes.length;){
   const heading=nodes[i];if(heading.type!=='heading'){result.push(heading);i++;continue;}
   let end=i+1;while(end<nodes.length&&(nodes[end].type!=='heading'||(nodes[end].depth??0)>(heading.depth??0)))end++;
   const category=discussionSectionCategory(headingText(heading)),safety=category==='safety',body=nodes.slice(i+1,end);
   const fixed=safety||body.some(node=>node.type==='heading'&&discussionSectionCategory(headingText(node))==='safety');
   result.push({type:'discussionSection',data:{hName:fixed?'section':'details',hProperties:{className:'discussionSection'+(safety?' discussionSafetySection':''),...(fixed?{}:{open:true})}},children:[{type:'discussionTitle',data:{hName:fixed?'div':'summary',hProperties:{className:fixed?'discussionStaticTitle':'discussionSummary','data-section-category':category}},children:[heading]},...(safety?body:group(body))]});i=end;
  }
  return result;
 }
 root.children=group(sectionHeadings(root.children,typeof file.value==='string'?file.value:''));
};}
