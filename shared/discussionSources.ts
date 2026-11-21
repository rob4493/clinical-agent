import {sources as EndoSources} from '../evaluation/modules/module1/claims.json';
import {sources as PregnancySources} from '../evaluation/modules/module2/claims.json';

/** Public metadata from the existing reviewed registry; never provider-supplied URLs. */
export const DiscussionSourceRegistry=[...EndoSources,...PregnancySources];
export function discussionSource(id:string){
 const source=DiscussionSourceRegistry.find(source=>source.sourceId===id);
 if(!source||source.urlVerificationStatus!=='verifiedOfficialRetrieval')return undefined;
 try{const url=new URL(source.officialUrl);if(url.protocol!=='https:'||url.username||url.password||url.hash||/[\s\\\u0000-\u001f]/.test(source.officialUrl))return undefined;}catch{return undefined;}
 return source;
}
export function readDiscussionSourceIds(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>4||value.some(id=>typeof id!=='string'||!discussionSource(id))||new Set(value).size!==value.length)return [];
 return value;
}
