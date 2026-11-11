export type OrchestrateEnvironment=Record<string,string|undefined>;
export class OrchestrateError extends Error {constructor(){super('IBM conversation is unavailable. The case is unchanged.');}}

// These IBM Cloud API hosts are documented by IBM. A console URL, arbitrary
// regional hostname or watsonx.ai model endpoint cannot substitute for a tenant.
const ApiHosts=new Set(['api.dl.watson-orchestrate.ibm.com','api.us-south.watson-orchestrate.cloud.ibm.com','api.eu-de.watson-orchestrate.cloud.ibm.com']);
const Uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Shared by target admission and probe diagnostics so endpoint policies cannot drift. */
export function isOrchestrateApiUrl(address:unknown):address is string{
 if(typeof address!=='string'||!address||address.length>512)return false;
 try{
  const url=new URL(address);
  return url.protocol==='https:'&&ApiHosts.has(url.hostname)&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash
   &&/^[\x21-\x7e]+$/.test(address)&&!address.includes('\\')&&!address.includes('%')
   &&/^\/instances\/[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(url.pathname)&&address===url.origin+url.pathname;
 }catch{return false;}
}

/** Server-only target preparation. This grants neither provider permission nor
 * clinical transmission and never initializes authentication or a network client.
 */
export class OrchestrateTarget {
 #apiBase:string;#agentId:string;#timeout:number;
 constructor(environment:OrchestrateEnvironment){
  const address=environment.ORCHESTRATE_API_URL,agent=environment.ORCHESTRATE_AGENT_ID,timeout=environment.WATSONX_AI_TIMEOUT_MS??'1500';
  if(environment.ORCHESTRATE_ENVIRONMENT!=='live'||environment.WATSONX_AI_AUTH_TYPE!=='iam'||!address||address.length>512||!agent||!Uuid.test(agent)||!/^\d+$/.test(timeout)||Number(timeout)<100||Number(timeout)>12000)throw new OrchestrateError();
  if(!isOrchestrateApiUrl(address))throw new OrchestrateError();
  this.#apiBase=address;this.#agentId=agent;this.#timeout=Number(timeout);
  Object.freeze(this);
 }
 apiBase(){return this.#apiBase;}
 agentId(){return this.#agentId;}
 environment(){return 'live' as const;}
 timeout(){return this.#timeout;}
 toJSON(){return {provider:'orchestrate',configuration:'prepared',connection:'notVerified'};}
}

/** An exact opt-in prepares a target only. Public route, privacy, quota and output
 * authorization remain separate gates; this flag cannot authorize inference.
 */
export function readOrchestrateTarget(environment:OrchestrateEnvironment=process.env):OrchestrateTarget|undefined{
 if(environment.ORCHESTRATE_ENABLED===undefined||environment.ORCHESTRATE_ENABLED==='false')return undefined;
 if(environment.ORCHESTRATE_ENABLED!=='true')throw new OrchestrateError();
 return new OrchestrateTarget(environment);
}
