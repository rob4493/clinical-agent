import {Activity,BookOpen,CalendarDays,ChevronDown,ClipboardList,FileText,ListTree,MessagesSquare,NotebookPen,Search,Shield,type LucideIcon} from 'lucide-react';
import type {ComponentPropsWithoutRef,KeyboardEvent,ReactNode} from 'react';

// Exact presentation labels only: never use diagnoses, symptoms or risk words in
// body text to classify a patient or designate an emergency.
const categories:Record<string,{icon:LucideIcon;labels:readonly string[]}>= {
 history:{icon:ClipboardList,labels:['patient history','patient history (as reported)','clinical history','history','history of presenting complaint']},
 symptoms:{icon:Activity,labels:['symptoms','symptoms and clinical features','reported symptoms','presenting symptoms','symptom history']},
 gynecologic:{icon:CalendarDays,labels:['gynecologic history','gynecological history','gynaecologic history','gynaecological history','menstrual history','reproductive history']},
 differential:{icon:ListTree,labels:['differential considerations','differential diagnosis','differential diagnoses','educational differential discussion','possible explanations']},
 investigations:{icon:Search,labels:['investigations','relevant investigations','investigation considerations','tests and investigations']},
 treatment:{icon:BookOpen,labels:['treatment considerations','management considerations','treatment options']},
 documentation:{icon:NotebookPen,labels:['documentation','documentation considerations','record keeping']},
 followup:{icon:MessagesSquare,labels:['follow-up questions','follow-up questions and uncertainties','follow up questions','follow-up','follow up','clarifying questions','questions to clarify']},
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
type Node={type:string;depth?:number;value?:string;ordered?:boolean;start?:number;position?:{start:{offset?:number};end:{offset?:number}};children?:Node[];data?:{hName:string;hProperties?:Record<string,string|boolean>}};
function headingText(node:Node):string{return node.type==='text'||node.type==='inlineCode'?node.value??'':node.children?.map(headingText).join('')??'';}
function titleInline(node:Node):boolean{return node.type==='text'||node.type==='strong'&&!!node.children?.every(titleInline);}
function boldTitle(node:Node){return node.type==='paragraph'&&!!node.children?.length&&node.children.every(child=>child.type==='strong'||child.type==='text'&&!child.value?.trim())&&node.children.every(titleInline);}
function shortTitle(label:string){return label.trim().length>0&&label.length<=160&&label.trim().split(/\s+/).length<=20&&!/[.!?;\r\n]/.test(label.replace(/:\s*$/,''));}
function listMarker(node:Node,paragraph:Node,source:string){const start=node.position?.start.offset,end=paragraph.position?.start.offset;const marker=typeof start==='number'&&typeof end==='number'?source.slice(start,end):'';return /^\s*\d+[.)][ \t]+$/.test(marker)?marker:null;}
/** Structural recognition precedes icon classification. Do not traverse quotes,
 * table cells or nested lists. Ordinary ordered lists remain list nodes. */
function sectionHeadings(nodes:Node[],source:string){
 // An indented, multi-item list is a section outline only when every item owns
 // a standalone bold title and body, with a table providing a structural cue.
 const blocks=nodes.flatMap(node=>{
  const items=node.children??[];
  if(node.type!=='list'||!node.ordered||items.length<2||!items.some(item=>item.children?.some(child=>child.type==='table'))||!items.every(item=>item.type==='listItem'&&(item.children?.length??0)>1&&boldTitle(item.children![0])&&shortTitle(headingText(item.children![0]))))return [node];
  return items.flatMap((item,index)=>[{...item.children![0],type:'heading',depth:2,children:[{type:'text',value:String((node.start??1)+index)+'. '},...(item.children![0].children??[])]},...item.children!.slice(1)]);
 });
 type Candidate={index:number;heading:Node;number?:number;bold:boolean;explicit:boolean};
 const candidates:Candidate[]=[];
 for(const [index,node] of blocks.entries()){
  let heading=node,bold=false,explicit=node.type==='heading';
  if(node.type==='paragraph'&&node.children?.every(titleInline))bold=boldTitle(node);
  else if(node.type==='list'&&node.ordered&&node.children?.length===1){
   const item=node.children[0],paragraph=item.children?.[0];if(item.children?.length!==1||paragraph?.type!=='paragraph'||!paragraph.children?.every(titleInline))continue;
   const marker=listMarker(node,paragraph,source);if(!marker)continue;bold=boldTitle(paragraph);heading={...paragraph,type:'heading',depth:2,children:[{type:'text',value:marker},...(paragraph.children??[])]};
  }else if(!explicit)continue;
  const label=headingText(heading),numbered=/^\s*(\d+)[.)]\s+(.+)$/.exec(label);
  if(!explicit&&(!shortTitle(numbered?.[2]??label)||!bold&&!numbered))continue;
  candidates.push({index,heading:{...heading,type:'heading',depth:explicit?heading.depth:2},number:numbered?Number(numbered[1]):undefined,bold,explicit});
 }
 const promoted=new Set<number>();
 const body=(candidate:Candidate)=>blocks.slice(candidate.index+1,candidates.find(next=>next.index>candidate.index&&(next.heading.depth??2)<=(candidate.heading.depth??2))?.index??blocks.length);
 const hasBody=(candidate:Candidate)=>body(candidate).some(node=>node.type!=='heading');
 const numbered=candidates.filter(candidate=>candidate.number!==undefined&&(candidate.heading.depth??2)<=2);
 for(let i=0;i<numbered.length;){
  let end=i+1;while(end<numbered.length&&numbered[end].number===numbered[end-1].number!+1&&(numbered[end].heading.depth??2)===(numbered[i].heading.depth??2))end++;
  const run=numbered.slice(i,end);
  const tables=run.filter(candidate=>body(candidate).some(node=>node.type==='table'));
  const clearOutline=run.some(candidate=>candidate.bold||candidate.explicit)||tables.length>=2||tables.some(candidate=>discussionSectionCategory(headingText(candidate.heading))!=='neutral');
  if(run.length>=2&&run.every(hasBody)&&clearOutline)run.forEach(candidate=>promoted.add(candidate.index));
  i=end;
 }
 const boldPeers=candidates.filter(candidate=>candidate.bold&&candidate.number===undefined&&hasBody(candidate));
 if(boldPeers.length>=2)boldPeers.forEach(candidate=>promoted.add(candidate.index));
 for(const candidate of candidates){
  if(candidate.explicit||hasBody(candidate)&&discussionSectionCategory(headingText(candidate.heading))!=='neutral'&&(candidate.bold||blocks[candidate.index+1]?.type==='table'))promoted.add(candidate.index);
 }
 const byIndex=new Map(candidates.map(candidate=>[candidate.index,candidate.heading]));
 return blocks.map((node,index)=>promoted.has(index)?byIndex.get(index)!:node);
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
