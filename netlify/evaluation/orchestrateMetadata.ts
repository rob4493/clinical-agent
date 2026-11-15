import {parseJson} from './input';
import {isOrchestrateApiUrl} from './orchestrateTarget';
import {ApprovedLiveOperations,LiveProbeAgent,LiveProbeVersion} from './orchestrateProbePolicy';
import type {Transport} from './watsonShadow';

type ObjectValue=Record<string,unknown>;
type Match='matches'|'different'|'notExposed';
export type MetadataStage='configuration'|'environmentList'|'liveEnvironment'|'releaseStatus'|'agentDefinition'|'toolInventory'|'moduleListingDefinition'|'clinicalAnalysisDefinition'|'moduleListingConnection'|'clinicalAnalysisConnection'|'metadataValidation';
export type MetadataCheck='unspecified'|'targetMismatch'|'objectExpected'|'invalidReference'|'contentType'|'bodyMissing'|'responseTooLarge'|'invalidJson'|'environmentEnvelope'|'liveEnvironmentSelection'|'agentIdentity'|'toolReferences'|'duplicateReferences'|'inventoryEnvelope'|'toolSelection'|'toolIdentity'|'connectionIdentity'|'requestLimit'|'routeNotAllowed';
const object=(v:unknown):ObjectValue=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new MetadataFailure('metadataInvalid','metadataValidation','objectExpected');return v as ObjectValue;};
const id=(v:unknown):string=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v))throw new MetadataFailure('metadataInvalid','metadataValidation','invalidReference');return v;};
const absent=(v:unknown)=>v===undefined||v===null;
const empty=(v:unknown)=>Array.isArray(v)&&v.length===0;
const match=(actual:unknown,expected:unknown):Match=>absent(actual)?'notExposed':JSON.stringify(actual)===JSON.stringify(expected)?'matches':'different';
export function validateMetadataTarget(settings:Record<string,string|undefined>){
 const base=settings.ORCHESTRATE_API_URL;
 if(!isOrchestrateApiUrl(base)||new URL(base!).hostname!=='api.eu-de.watson-orchestrate.cloud.ibm.com'||settings.ORCHESTRATE_AGENT_ID!==LiveProbeAgent||settings.ORCHESTRATE_ENVIRONMENT!=='live')throw new MetadataFailure('metadataConfiguration','configuration','targetMismatch');
}
function bounded<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(new MetadataFailure('metadataTimeout'));
  if(signal.aborted){void promise.catch(()=>{});abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
export class MetadataFailure extends Error{
 constructor(readonly reason:'metadataUnauthorized'|'metadataForbidden'|'metadataUnavailable'|'metadataInvalid'|'metadataNetwork'|'metadataTimeout'|'metadataConfiguration',readonly stage:MetadataStage='metadataValidation',readonly check:MetadataCheck='unspecified'){super('Metadata verification unavailable.');}
}

/** Bounded JSON reader. Provider text, IDs, headers and exceptions never escape. */
async function json(response:Response,signal:AbortSignal):Promise<unknown>{
 if(!response.ok){void response.body?.cancel().catch(()=>{});throw new MetadataFailure(response.status===401?'metadataUnauthorized':response.status===403?'metadataForbidden':'metadataUnavailable');}
 if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){void response.body?.cancel().catch(()=>{});throw new MetadataFailure('metadataInvalid','metadataValidation','contentType');}
 const reader=response.body?.getReader();if(!reader)throw new MetadataFailure('metadataInvalid','metadataValidation','bodyMissing');
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{
  const chunks:Uint8Array[]=[];let length=0;
  for(;;){signal.throwIfAborted();const next=await bounded(reader.read(),signal);if(next.done)break;length+=next.value.length;if(length>262144)throw new MetadataFailure('metadataInvalid','metadataValidation','responseTooLarge');chunks.push(next.value);}
  return parseJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
 }catch(error){if(error instanceof MetadataFailure)throw error;throw new MetadataFailure(signal.aborted?'metadataTimeout':'metadataInvalid','metadataValidation','invalidJson');}
 finally{signal.removeEventListener('abort',cancel);cancel();reader.releaseLock();}
}

/** Only metadata routes constructed here are reachable. No provider-supplied URL
 * is fetched, no SDK retries, credential endpoint, artifact or tool invocation.
 * Generic agent/tool metadata is deliberately never promoted to Live proof.
 */
export async function inspectOrchestrateMetadata(settings:Record<string,string|undefined>,bearer:string,transport:Transport,signal:AbortSignal,recheck:()=>void){
 const base=settings.ORCHESTRATE_API_URL;
 validateMetadataTarget(settings);
 const root=base+'/v1/orchestrate',agent='/agents/'+LiveProbeAgent;
 let calls=0,stage:MetadataStage='environmentList';
 try{
 async function get(path:string){
  recheck();signal.throwIfAborted();if(++calls>12)throw new MetadataFailure('metadataInvalid','metadataValidation','requestLimit');
  // Exact route grammar; connection configurations explicitly exclude credentials.
  if(!new RegExp('^(?:'+agent+'(?:/environment|/releases/status\\?environment_id=[A-Za-z0-9_-]{1,128})?|/tools(?:/[A-Za-z0-9_-]{1,128})?|/connections/applications(?:\\?connection_id=[A-Za-z0-9_-]{1,128}|/[A-Za-z0-9_-]{1,128}/configurations/live))$').test(path))throw new MetadataFailure('metadataInvalid','metadataValidation','routeNotAllowed');
  const operation=AbortSignal.any([signal,AbortSignal.timeout(2000)]);
  try{
   const response=await bounded(transport(root+path,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json',Authorization:'Bearer '+bearer},signal:operation}),operation);
   const payload=await json(response,operation);recheck();return payload;
  }catch(error){if(error instanceof MetadataFailure)throw error;throw new MetadataFailure(operation.aborted?'metadataTimeout':'metadataNetwork');}
 }
 const environments=await get(agent+'/environment');
 if(!Array.isArray(environments)||environments.length>20)throw new MetadataFailure('metadataInvalid','metadataValidation','environmentEnvelope');
 stage='liveEnvironment';
 const live=environments.map(object).filter(environment=>environment.name==='live');
 if(live.length!==1)throw new MetadataFailure('metadataInvalid','metadataValidation','liveEnvironmentSelection');
 stage='releaseStatus';
 const release=object(await get(agent+'/releases/status?environment_id='+id(live[0].id)));
 // SDK calls the generic agent getter get_draft_by_id. Its tool IDs are not a
 // deployed-version snapshot, even when the Live deployment exists.
 stage='agentDefinition';
 const draft=object(await get(agent));
 if(draft.id!==LiveProbeAgent)throw new MetadataFailure('metadataInvalid','metadataValidation','agentIdentity');
 if(!Array.isArray(draft.tools)||draft.tools.length!==2)throw new MetadataFailure('metadataInvalid','metadataValidation','toolReferences');
 const references=draft.tools.map(id);if(new Set(references).size!==2)throw new MetadataFailure('metadataInvalid','metadataValidation','duplicateReferences');
 stage='toolInventory';
 const inventory=await get('/tools');
 if(!Array.isArray(inventory)||inventory.length>200)throw new MetadataFailure('metadataInvalid','metadataValidation','inventoryEnvelope');
 const catalog=inventory.map(object),findings=[];
 for(const expected of ApprovedLiveOperations){
  stage=expected.operationId==='listModules'?'moduleListingDefinition':'clinicalAnalysisDefinition';
  const matches=catalog.filter(tool=>tool.name===expected.tool&&references.includes(String(tool.id)));
  if(matches.length!==1)throw new MetadataFailure('metadataInvalid','metadataValidation','toolSelection');
  const tool=object(await get('/tools/'+id(matches[0].id)));
  if(tool.id!==matches[0].id||tool.name!==expected.tool)throw new MetadataFailure('metadataInvalid','metadataValidation','toolIdentity');
  const binding=object(tool.binding),openapi=object(binding.openapi);
  const allowed=['http_method','http_path','success_status_code','security','servers','connection_id','callback','acknowledgement','plugin_hook','context_request_body_path','context_response_body_path'];
  const extraBinding=Object.entries(binding).some(([key,value])=>key!=='openapi'&&!absent(value));
  const extensions=Object.keys(openapi).some(key=>!allowed.includes(key));
  const indirect=extraBinding||extensions||tool.is_async===true||['callback','acknowledgement','plugin_hook','context_request_body_path','context_response_body_path'].some(key=>!absent(openapi[key]));
  let connection:'notConfigured'|'liveMetadataRead'='notConfigured',liveAuthentication:Match='notExposed',liveServer:Match='notExposed';
  if(!absent(openapi.connection_id)&&openapi.connection_id!==''){
   stage=expected.operationId==='listModules'?'moduleListingConnection':'clinicalAnalysisConnection';
   const application=object(await get('/connections/applications?connection_id='+id(openapi.connection_id)));
   const config=object(await get('/connections/applications/'+id(application.app_id)+'/configurations/live'));
   if(config.environment!=='live'||config.app_id!==application.app_id)throw new MetadataFailure('metadataInvalid','metadataValidation','connectionIdentity');
   connection='liveMetadataRead';liveAuthentication=match(config.security_scheme,'none');liveServer=match(config.server_url,'https://clinicalagent.netlify.app');
  }
  findings.push({tool:expected.operationId==='listModules'?'moduleListing':'clinicalAnalysis',scope:'sharedOrDraft',operationId:match(tool.operation_id,expected.operationId),method:match(openapi.http_method,expected.method),path:match(openapi.http_path,new URL(expected.url).pathname),servers:match(openapi.servers,['https://clinicalagent.netlify.app']),declaredAuthentication:empty(openapi.security)?'noneDeclared':absent(openapi.security)?'notExposed':'securityDeclared',connection,liveAuthentication,liveServer,indirectActions:indirect?'presentOrUnexplained':'notDeclared'});
 }
 recheck();
 return {status:'BLOCKED',reason:'liveSnapshotNotEstablished',authentication:'PASS',deployment:{liveEnvironment:'present',version:typeof live[0].current_version==='string'&&/^\d+\.\d+\.\d+$/.test(live[0].current_version)?match(live[0].current_version,LiveProbeVersion):'notExposed',release:match(release.deployment_status,'success')},liveAgentAssociation:'NOT_VERIFIED',genericAgentCollaborators:empty(draft.collaborators)?'noneDeclared':absent(draft.collaborators)?'notExposed':'present',tools:findings,indirectActions:'UNKNOWN'};
 }catch(error){
  if(error instanceof MetadataFailure)throw new MetadataFailure(error.reason,error.stage==='metadataValidation'?stage:error.stage,error.check);
  throw error;
 }
}
