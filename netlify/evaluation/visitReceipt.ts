import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {parseJson} from './input';

export class SessionError extends Error {constructor(){super('The conversation session is unavailable. Start a new session.');}}
export interface Visit {version:'1';visitId:string;ordinal:number;issuedAt:number;expiresAt:number;threadId:string|null;promptIds:string[];policyHash:string}
const Uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const Lifetime=600000;
/** Anonymous capability receipts contain operational IDs only, never a transcript.
 * Domain separation permits existing server-key reuse without exposing the key.
 */
export function createReceipts(secret:string,clock:()=>number=Date.now){
 if(typeof secret!=='string'||!secret||secret.length>512||/\s|[\u0000-\u001f]/.test(secret))throw new SessionError();
 const key=createHmac('sha256',secret).update('Endo:Orchestrate:Visit:v1').digest();
 function sign(visit:Visit){const encoded=Buffer.from(JSON.stringify(visit)).toString('base64url');return encoded+'.'+createHmac('sha256',key).update(encoded).digest('base64url');}
 function read(receipt:unknown):Visit{
  try{
   if(typeof receipt!=='string'||receipt.length>4096||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(receipt))throw new SessionError();
   const [encoded,signature]=receipt.split('.'),expected=createHmac('sha256',key).update(encoded).digest(),supplied=Buffer.from(signature,'base64url');
   if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new SessionError();
   const visit=parseJson(Buffer.from(encoded,'base64url').toString('utf8')) as Visit;
   if(!visit||Object.keys(visit).sort().join('|')!=='expiresAt|issuedAt|ordinal|policyHash|promptIds|threadId|version|visitId'||visit.version!=='1'||typeof visit.policyHash!=='string'||!/^[a-f0-9]{64}$/.test(visit.policyHash)||!Uuid.test(visit.visitId)||!Number.isInteger(visit.ordinal)||visit.ordinal<0||visit.ordinal>6||!Number.isSafeInteger(visit.issuedAt)||!Number.isSafeInteger(visit.expiresAt)||visit.expiresAt-visit.issuedAt!==Lifetime||visit.issuedAt>clock()||visit.expiresAt<=clock()||visit.threadId!==null&&!Uuid.test(visit.threadId)||!Array.isArray(visit.promptIds)||visit.promptIds.length!==visit.ordinal||visit.promptIds.some(id=>typeof id!=='string'||!/^[A-Za-z]{1,24}$/.test(id)))throw new SessionError();
   return visit;
  }catch{throw new SessionError();}
 }
 return Object.freeze({read,start(policyHash='0'.repeat(64)){const issuedAt=clock();return sign({version:'1',visitId:randomUUID(),ordinal:0,issuedAt,expiresAt:issuedAt+Lifetime,threadId:null,promptIds:[],policyHash});},advance(visit:Visit,threadId:string,promptId:string){if(visit.ordinal>=6||!Uuid.test(threadId)||!/^[A-Za-z]{1,24}$/.test(promptId))throw new SessionError();return sign({...visit,ordinal:visit.ordinal+1,threadId,promptIds:[...visit.promptIds,promptId]});}});
}
