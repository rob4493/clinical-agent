// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {checkEmbedEnvironment,RequiredEmbedNames} from '../../tools/checkEmbedEnvironment';
import {readFileSync} from 'node:fs';
it('checks only preview Functions configuration and emits names/presence without values',()=>{
 const contents=Object.fromEntries(RequiredEmbedNames.map(name=>[name,'SyntheticSecretNotForOutput']));
 const run=vi.fn(()=>({status:0,stdout:JSON.stringify(contents)}));const result=checkEmbedEnvironment(run);
 expect(result.ok).toBe(true);expect(JSON.stringify(result)).not.toContain('SyntheticSecretNotForOutput');
 const [command,args,options]=run.mock.calls[0] as unknown as [string,string[],Record<string,unknown>];expect(command).toBe(process.execPath);expect(args.slice(1)).toEqual(['env:list','--site','clinicalagent','--context','deploy-preview','--scope','functions','--json']);expect(options.windowsHide).toBe(true);expect(args).not.toContain('--auth');
});
it('reports missing names and sanitizes failed CLI responses',()=>{
 const missing=checkEmbedEnvironment(()=>({status:0,stdout:'{}'}));expect(missing.ok).toBe(false);
 for(const output of [{status:1,stdout:'SyntheticSecretNotForOutput',stderr:'SyntheticSecretNotForOutput'},{status:0,stdout:'not json SyntheticSecretNotForOutput'}])expect(checkEmbedEnvironment(()=>output)).toEqual({ok:false,code:'metadataUnavailable'});
});
it('routes bootstrap before generic API and retains the same PR preview instructions',()=>{
 const configuration=readFileSync('../netlify.toml','utf8');expect(configuration.indexOf('from = "/api/v1/embed-session"')).toBeLessThan(configuration.indexOf('from = "/api/*"'));
 expect(configuration).toContain('to = "/.netlify/functions/embedSession"');
});
