import {parseJson} from './input';
import {createHash} from 'node:crypto';
import {isOrchestrateApiUrl,type OrchestrateEnvironment} from './orchestrateTarget';

export const LiveProbeAgent='c6698d4e-a08d-4b77-bf05-139ff3b4c695';
export const LiveProbeVersion='2.0.0';
export const ExceptionRisks=Object.freeze(['unexpectedApprovedToolInvocation','inventedSyntheticCaseSubmission','downstreamProcessingAndPresentation','providerRetention','internalUsageAndBillingNotHardCapped','remoteWorkMayContinueAfterCancellation']);
export const ApprovedLiveOperations=Object.freeze([
 Object.freeze({tool:'list_available_clinical_modules',operationId:'listModules',method:'GET',url:'https://clinicalagent.netlify.app/api/v1/modules',authentication:'none'}),
 Object.freeze({tool:'submit_a_de_identified_clinical_case_for_evidence_grounded_review',operationId:'analyzeCase',method:'POST',url:'https://clinicalagent.netlify.app/api/v1/analyze',authentication:'none'}),
]);
function exact(value:unknown,keys:string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');}

/** Validates a server-only operator review record, NOT IBM's actual permissions.
 * An allowlist in this process cannot intercept tools executed inside IBM. The
 * operator must independently establish restrictions in ordinary mode, or review
 * actual Live bindings and obtain explicit risk acceptance in exception mode.
 * Exception mode must not acknowledge TOOLS_VERIFIED. Never accept it from
 * a browser request or infer approval from agent instructions or tool names.
 */
export function liveAccessReviewValid(environment:OrchestrateEnvironment,now:number,exception=false):boolean{
 try{
  const raw=environment.ORCHESTRATE_PROBE_ACCESS_REVIEW;
  if(!raw||raw.length>8192)return false;
  const review=parseJson(raw);
  if(!exact(review,['version','agentId','agentVersion','environment','apiUrl','operations','collaborators','delegatedAgents','workflows','otherActionPaths','evidence']))return false;
  if(review.version!=='1'||review.agentId!==LiveProbeAgent||environment.ORCHESTRATE_AGENT_ID!==LiveProbeAgent||review.agentVersion!==LiveProbeVersion||review.environment!=='live'||environment.ORCHESTRATE_ENVIRONMENT!=='live')return false;
  if(!isOrchestrateApiUrl(review.apiUrl)||new URL(review.apiUrl).hostname!=='api.eu-de.watson-orchestrate.cloud.ibm.com'||review.apiUrl!==environment.ORCHESTRATE_API_URL)return false;
  if(!Array.isArray(review.operations)||review.operations.length!==ApprovedLiveOperations.length)return false;
  for(const expected of ApprovedLiveOperations){
   const matches=review.operations.filter(item=>exact(item,Object.keys(expected))&&Object.entries(expected).every(([key,value])=>item[key]===value));
   if(matches.length!==1)return false;
  }
  for(const name of ['collaborators','delegatedAgents','workflows','otherActionPaths'])if(!Array.isArray(review[name])||review[name].length!==0)return false;
  const evidence=review.evidence;
  if(!exact(evidence,['reference','reviewedAt','validUntil','scope','caseSubmission','downstreamInference']))return false;
  if(typeof evidence.reference!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(evidence.reference))return false;
  if(exception?evidence.scope!=='independentlyReviewedLiveBindings'||evidence.caseSubmission!=='possibleUnderException'||evidence.downstreamInference!=='possibleUnderException':evidence.scope!=='effectiveRuntimePermissions'||evidence.caseSubmission!=='blockedForConnectionProbe'||evidence.downstreamInference!=='blockedForConnectionProbe')return false;
  if(typeof evidence.reviewedAt!=='string'||typeof evidence.validUntil!=='string')return false;
  const reviewed=Date.parse(evidence.reviewedAt),until=Date.parse(evidence.validUntil);
  return Number.isFinite(now)&&Number.isFinite(reviewed)&&Number.isFinite(until)&&reviewed<=now&&now-reviewed<=86400000&&until>now&&until-reviewed<=86400000;
 }catch{return false;}
}

/** Explicit risk acceptance is separate from technical verification. This is a
 * server-held approval reference, not evidence obtained from IBM or an agent.
 * Existing immutable ordinal-zero admission provides one attempt per UTC day;
 * therefore an exception window must not span UTC days. No new quota namespace
 * or refund/reset path is introduced. Old-version reviews/approvals are rejected.
 */
export function liveProbeAuthorizationValid(environment:OrchestrateEnvironment,now:number,operatorId:string):boolean{
 try{
  if(environment.ORCHESTRATE_PROBE_EXCEPTION_ENABLED!=='true')return [undefined,'false'].includes(environment.ORCHESTRATE_PROBE_EXCEPTION_ENABLED)&&liveAccessReviewValid(environment,now);
  if(environment.ORCHESTRATE_PROBE_TOOLS_VERIFIED!=='false'||environment.ORCHESTRATE_PROBE_USAGE_VERIFIED!=='false'||!liveAccessReviewValid(environment,now,true))return false;
  const raw=environment.ORCHESTRATE_PROBE_EXCEPTION_APPROVAL;
  if(!raw||raw.length>4096)return false;
  const approval=parseJson(raw);
  if(!exact(approval,['version','reference','test','agentId','agentVersion','apiUrl','previewId','previewOrigin','operatorId','reviewHash','approvedAt','expiresAt','maxAgentCalls','maxAttempts','automaticRetries','noRealPatientData','acceptedRisks']))return false;
  if(approval.version!=='1'||typeof approval.reference!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(approval.reference)||approval.test!=='blueLanternTwoTurn'||approval.agentId!==LiveProbeAgent||approval.agentVersion!==LiveProbeVersion||approval.apiUrl!==environment.ORCHESTRATE_API_URL)return false;
  if(approval.previewId!=='4'||approval.previewOrigin!=='https://deploy-preview-4--clinicalagent.netlify.app'||approval.operatorId!==operatorId||!operatorId)return false;
  const digest=createHash('sha256').update(environment.ORCHESTRATE_PROBE_ACCESS_REVIEW!).digest('hex');
  if(approval.reviewHash!==digest||approval.maxAgentCalls!==2||approval.maxAttempts!==1||approval.automaticRetries!==0||approval.noRealPatientData!==true)return false;
  if(!Array.isArray(approval.acceptedRisks)||approval.acceptedRisks.length!==ExceptionRisks.length||[...approval.acceptedRisks].sort().join('|')!==[...ExceptionRisks].sort().join('|'))return false;
  if(typeof approval.approvedAt!=='string'||typeof approval.expiresAt!=='string')return false;
  const issued=Date.parse(approval.approvedAt),expiry=Date.parse(approval.expiresAt);
  return Number.isFinite(issued)&&Number.isFinite(expiry)&&issued<=now&&expiry>now&&expiry-issued<=1800000&&expiry===Date.parse(environment.ORCHESTRATE_PROBE_TEST_UNTIL||'')&&new Date(issued).toISOString().slice(0,10)===new Date(expiry).toISOString().slice(0,10);
 }catch{return false;}
}
