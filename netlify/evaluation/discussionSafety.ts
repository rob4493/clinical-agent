import {QuotaError} from './demoQuota';
export class ChatError extends Error {constructor(readonly code:'unavailable'|'inputRejected'|'outputRejected'){super('Conversation is unavailable. The case is unchanged.');}}
/** Rejection screen only, never a semantic evidence-grounding verifier. */
export function validateDiscussion(text:unknown):string{
 if(typeof text!=='string'||!text.trim()||text.length>4000||/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|https?:|www\.|\[\d|```|\d+(?:\.\d+)?\s*%|&(?:#\d+|[a-z]+);/i.test(text)||/\b(?:system prompt|bearer|api.?key|tool_calls|function_call|diagnos(?:e|ed|is) (?:is|confirmed)|confirms? (?:endometriosis|ectopic)|you (?:have|do not have)|patient has|ruled out|stage [1-4iv]+|\d+(?:\.\d+)?\s*(?:mg|mcg|ml|tablets?)|(?:start|stop|increase|decrease|take|prescribe) (?:\w+\s+){0,3}(?:medication|dose|ibuprofen|paracetamol|antibiotics?|hormones?))\b/i.test(text))throw new ChatError('outputRejected');
 return text;
}
export function chatFailure(error:unknown){return error instanceof QuotaError?{status:error.category==='unavailable'?503:error.category==='replayed'?409:429,code:error.category==='replayed'?'invalidSession':error.category==='unavailable'?'unavailable':'quotaExceeded'}:error instanceof ChatError?{status:error.code==='inputRejected'?422:503,code:error.code}:{status:503,code:'unavailable'};}
