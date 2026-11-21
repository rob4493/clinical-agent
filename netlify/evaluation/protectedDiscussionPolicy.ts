import {competitionWindow} from './orchestrateCompetition';
import type {OrchestrateEnvironment} from './orchestrateTarget';

export type OperatorContext={user?:{id:string;expiresAt:Date};deploy?:{id:string;context:string;published:boolean}};
const Origin='https://deploy-preview-4--clinicalagent.netlify.app';
/** Shared trusted-runtime gate, never derived from a request body or headers. */
export function protectedDiscussionAllowed(env:OrchestrateEnvironment,context:OperatorContext,now:number){
 const user=context.user;
 return !!competitionWindow(env,now)&&env.ORCHESTRATE_DISCUSSION_AUTHORIZED==='true'
  &&env.ORCHESTRATE_EMBED_PREVIEW_ID==='4'&&env.ORCHESTRATE_EMBED_PREVIEW_ORIGIN===Origin
  &&context.deploy?.context==='deploy-preview'&&context.deploy.published===false&&typeof context.deploy.id==='string'&&/^[A-Za-z0-9-]{1,128}$/.test(context.deploy.id)
  &&!!user&&typeof user.id==='string'&&!!user.id&&!!env.ORCHESTRATE_EMBED_OPERATOR_IDS?.split(',').includes(user.id)
  &&user.expiresAt instanceof Date&&Number.isFinite(user.expiresAt.getTime())&&user.expiresAt.getTime()>now
  &&env.WATSONX_AI_AUTH_TYPE==='iam'&&typeof env.WATSONX_AI_APIKEY==='string'&&env.WATSONX_AI_APIKEY.length>0&&env.WATSONX_AI_APIKEY.length<=512&&!/\s/.test(env.WATSONX_AI_APIKEY);
}
