// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {OrchestrateError,readOrchestrateTarget} from '../../netlify/evaluation/orchestrateTarget';
const Settings={ORCHESTRATE_ENABLED:'true',ORCHESTRATE_API_URL:'https://api.dl.watson-orchestrate.ibm.com/instances/SyntheticTenant',ORCHESTRATE_AGENT_ID:'11111111-1111-4111-8111-111111111111',ORCHESTRATE_ENVIRONMENT:'live',WATSONX_AI_AUTH_TYPE:'iam',WATSONX_AI_TIMEOUT_MS:'12000'};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('prepares the existing-agent Live target without a model ID, project or new credential',()=>{const transport=vi.fn();vi.stubGlobal('fetch',transport);const target=readOrchestrateTarget(Settings)!;expect(target.agentId()).toBe(Settings.ORCHESTRATE_AGENT_ID);expect(target.apiBase()).toBe(Settings.ORCHESTRATE_API_URL);expect(target.environment()).toBe('live');expect(target.timeout()).toBe(12000);expect(transport).not.toHaveBeenCalled();});
it.each([{}, {ORCHESTRATE_ENABLED:'false'}])('defaults disabled without initializing IBM %#',settings=>{const transport=vi.fn();vi.stubGlobal('fetch',transport);expect(readOrchestrateTarget(settings)).toBeUndefined();expect(transport).not.toHaveBeenCalled();});
it.each([
 {ORCHESTRATE_ENABLED:'TRUE'},{ORCHESTRATE_ENVIRONMENT:'draft'},{ORCHESTRATE_ENVIRONMENT:undefined},
 {ORCHESTRATE_AGENT_ID:undefined},{ORCHESTRATE_AGENT_ID:'not-an-agent'},
 {ORCHESTRATE_API_URL:'https://dl.watson-orchestrate.ibm.com'},
 {ORCHESTRATE_API_URL:'https://api.dl.watson-orchestrate.ibm.com'},
 {ORCHESTRATE_API_URL:'https://us-south.ml.cloud.ibm.com/instances/SyntheticTenant'},
 {ORCHESTRATE_API_URL:'http://api.dl.watson-orchestrate.ibm.com/instances/SyntheticTenant'},
 {ORCHESTRATE_API_URL:'https://api.dl.watson-orchestrate.ibm.com.evil.invalid/instances/SyntheticTenant'},
 {ORCHESTRATE_API_URL:'https://SyntheticCredential@api.dl.watson-orchestrate.ibm.com/instances/SyntheticTenant'},
 {ORCHESTRATE_API_URL:Settings.ORCHESTRATE_API_URL+'?token=SyntheticSecret'},
 {ORCHESTRATE_API_URL:Settings.ORCHESTRATE_API_URL+'#fragment'},
 {ORCHESTRATE_API_URL:'https://api.dl.watson-orchestrate.ibm.com/instances/../SyntheticTenant'},
 {ORCHESTRATE_API_URL:Settings.ORCHESTRATE_API_URL+'/extra'},
 {ORCHESTRATE_API_URL:Settings.ORCHESTRATE_API_URL+'/'},
 {ORCHESTRATE_API_URL:'https://api.dl.watson-orchestrate.ibm.com/instances/%53yntheticTenant'},
 {WATSONX_AI_AUTH_TYPE:'password'},{WATSONX_AI_TIMEOUT_MS:'12001'},{WATSONX_AI_TIMEOUT_MS:'1.5'},{WATSONX_AI_TIMEOUT_MS:'99'}
])('rejects unsafe or incomplete configuration without a request %#',change=>{const transport=vi.fn(),logs=[vi.spyOn(console,'log'),vi.spyOn(console,'error'),vi.spyOn(console,'warn')];vi.stubGlobal('fetch',transport);expect(()=>readOrchestrateTarget({...Settings,...change})).toThrow(new OrchestrateError());expect(transport).not.toHaveBeenCalled();for(const log of logs)expect(log).not.toHaveBeenCalled();});
it('does not serialize endpoint, tenant or agent identity',()=>{const serialized=JSON.stringify(readOrchestrateTarget(Settings));expect(serialized).toBe('{"provider":"orchestrate","configuration":"prepared","connection":"notVerified"}');for(const secret of [Settings.ORCHESTRATE_API_URL,Settings.ORCHESTRATE_AGENT_ID,'SyntheticTenant'])expect(serialized).not.toContain(secret);});
