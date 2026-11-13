/** Manual metadata-only inspection in the operator's already authenticated terminal.
 * CLI output is captured in memory; values and stderr are never printed or persisted.
 */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const Root=fileURLToPath(new URL('../',import.meta.url));
const Cli=resolve(Root,'frontend/.testNetlifyTools/node_modules/netlify-cli/bin/run.js');
export const RequiredEmbedNames=[
 'ORCHESTRATE_EMBED_PREVIEW_ENABLED','ORCHESTRATE_EMBED_KILL_SWITCH',
 'ORCHESTRATE_EMBED_PREVIEW_ID','ORCHESTRATE_EMBED_PREVIEW_ORIGIN','ORCHESTRATE_EMBED_OPERATOR_IDS',
 'ORCHESTRATE_EMBED_TEST_UNTIL','ORCHESTRATE_EMBED_PRIVATE_KEY','ORCHESTRATE_EMBED_PUBLIC_KEY_SHA256',
 'ORCHESTRATE_EMBED_SECURITY_VERIFIED','ORCHESTRATE_EMBED_TOOLS_DENIED',
 'ORCHESTRATE_EMBED_USAGE_VERIFIED','ORCHESTRATE_EMBED_PRIVACY_VERIFIED','OTEL_SDK_DISABLED'
];
type Runner=(command:string,args:string[],options:{cwd:string;encoding:'utf8';timeout:number;maxBuffer:number;windowsHide:boolean})=>{status:number|null;stdout:string;stderr?:string;error?:unknown};
export function checkEmbedEnvironment(run:Runner=spawnSync){
 try{
  const response=run(process.execPath,[Cli,'env:list','--site','clinicalagent','--context','deploy-preview','--scope','functions','--json'],{cwd:Root,encoding:'utf8',timeout:30000,maxBuffer:1048576,windowsHide:true});
  if(response.status!==0||response.error)return {ok:false,code:'metadataUnavailable'};
  const configured:unknown=JSON.parse(response.stdout);
  if(!configured||typeof configured!=='object'||Array.isArray(configured))return {ok:false,code:'metadataUnavailable'};
  const variables=Object.fromEntries(RequiredEmbedNames.map(name=>[name,{present:Object.hasOwn(configured,name)}]));
  return {ok:RequiredEmbedNames.every(name=>variables[name].present),context:'deploy-preview',scope:'functions',variables};
 }catch{return {ok:false,code:'metadataUnavailable'};}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2){console.error('Unsupported arguments. No configuration was read.');process.exitCode=2;}
 else{const report=checkEmbedEnvironment();console.log(JSON.stringify(report,null,2));process.exitCode=report.ok?0:1;}
}
