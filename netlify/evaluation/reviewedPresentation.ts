import { projectPresentation, PresentationError } from './presentationProjector';
import { hashBytes, type Package } from './packages';
import { PrescribingNotice } from './requestPolicy';
import type { Analysis } from './analysis';

interface Variant { variantId:string; claimIds:string[]; text:string }
interface Finding { presentationId:string; variants:Variant[] }
export interface ReviewedOffer { presentationVersion:'1'; findings:Finding[]; outputSchema:typeof OutputSchema }
export interface ReviewedOutput { presentationVersion:'1'; paragraphs:{selections:{presentationId:string;variantId:string}[]}[] }
export interface PublicPresentation { presentationVersion:'1'; paragraphs:{text:string;numbers:number[]}[] }
const OutputSchema={type:'object',additionalProperties:false,required:['presentationVersion','paragraphs'],properties:{presentationVersion:{const:'1'},paragraphs:{type:'array',minItems:1,maxItems:2,items:{type:'object',additionalProperties:false,required:['selections'],properties:{selections:{type:'array',minItems:1,maxItems:10,items:{type:'object',additionalProperties:false,required:['presentationId','variantId'],properties:{presentationId:{type:'string',maxLength:65},variantId:{type:'string',maxLength:65}}}}}}}}};

/** Only complete public mappings leave this boundary; even mixed prescribing requests skip it. */
export function offerPresentation(result:Analysis,packages:Package[]):ReviewedOffer|null {
 if(result.envelope.renderedText.includes(PrescribingNotice))return null;
 const supplied=projectPresentation(result,packages,true);
 if(!supplied)return null;
 const findings=supplied.findings.map(fact=>{
  const claimIds=[...new Set(fact.claimIds)].sort();
  const identity=hashBytes(JSON.stringify([supplied.moduleId,claimIds,fact.wording]));
  return {presentationId:'P'+identity,variants:[{variantId:'V'+identity,claimIds,text:fact.wording}]};
 });
 if(new Set(findings.map(finding=>finding.presentationId)).size!==findings.length)return null;
 return {presentationVersion:'1',findings,outputSchema:OutputSchema};
}
function fields(content:unknown,names:string[]):Record<string,unknown> {
 if(!content||typeof content!=='object'||Array.isArray(content)||Object.keys(content).sort().join('|')!==[...names].sort().join('|'))throw new PresentationError();
 return content as Record<string,unknown>;
}

/** Opaque selections are closed and exhaustive; provider wording and claim fields are forbidden. */
export function validateReviewed(payload:unknown,offer:ReviewedOffer):ReviewedOutput {
 const output=fields(payload,['presentationVersion','paragraphs']);
 if(output.presentationVersion!=='1'||!Array.isArray(output.paragraphs)||output.paragraphs.length<1||output.paragraphs.length>2)throw new PresentationError();
 const used=new Set<string>();let total=0;
 for(const paragraph of output.paragraphs) {
  const part=fields(paragraph,['selections']);
  if(!Array.isArray(part.selections)||part.selections.length<1||part.selections.length>10)throw new PresentationError();
  const variants=part.selections.map(selection=>{
   const chosen=fields(selection,['presentationId','variantId']);
   if(typeof chosen.presentationId!=='string'||chosen.presentationId.length>65||typeof chosen.variantId!=='string'||chosen.variantId.length>65)throw new PresentationError();
   const finding=offer.findings.find(finding=>finding.presentationId===chosen.presentationId);
   const variant=finding?.variants.find(variant=>variant.variantId===chosen.variantId);
   if(!finding||!variant||used.has(finding.presentationId))throw new PresentationError();
   used.add(finding.presentationId);return variant;
  });
  // Retain the display-size bound using trusted text, never provider-supplied prose.
  if(new Set(variants.flatMap(variant=>variant.claimIds)).size>78)throw new PresentationError();
  const wording=variants.map(variant=>variant.text).join(' ');
  if(!wording.length||wording.length>16000)throw new PresentationError();
  total+=wording.length;
 }
 if(used.size!==offer.findings.length||total>16000)throw new PresentationError();
 return payload as ReviewedOutput;
}

/** Reconstruct from repository wording, not provider prose; citation numbers come only from the result. */
export function publicPresentation(output:ReviewedOutput,offer:ReviewedOffer,result:Analysis,packages:Package[]):PublicPresentation {
 validateReviewed(output,offer);
 const entry=packages.find(entry=>entry.moduleId===result.envelope.response.moduleId);
 if(!entry)throw new PresentationError();
 return {presentationVersion:'1',paragraphs:output.paragraphs.map(paragraph=>{
  const variants=paragraph.selections.map(selection=>offer.findings.find(finding=>finding.presentationId===selection.presentationId)!.variants.find(variant=>variant.variantId===selection.variantId)!);
  const claimIds=[...new Set(variants.flatMap(variant=>variant.claimIds))].sort();
  const numbers=[...new Set(claimIds.map(id=>{
   const claim=entry.claims.find(claim=>claim.claimId===id),source=result.envelope.sources.find(source=>source.source.sourceId===claim?.sourceId);
   if(!claim||!source)throw new PresentationError();return source.number;
  }))].sort((left,right)=>left-right);
  return {text:variants.map(variant=>variant.text).join(' '),numbers};
 })};
}
