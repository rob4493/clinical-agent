import {EvaluationError,type Projection} from './contract';

/** Future adapters may suggest a JSON proposal only. No case/evidence/tool/analysis capability is supplied. */
export interface LanguageUnderstanding {suggest(input:Readonly<Projection>,signal:AbortSignal):Promise<string>}
export class DisabledUnderstanding implements LanguageUnderstanding {
 async suggest(input:Readonly<Projection>,signal:AbortSignal):Promise<string>{signal.throwIfAborted();void input;throw new EvaluationError();}
}
export interface OfflineMock extends LanguageUnderstanding {readonly kind:'offlineMock'}
export function createMock(reply:(input:Readonly<Projection>,signal:AbortSignal)=>Promise<string>):OfflineMock {return Object.freeze({kind:'offlineMock' as const,suggest:reply});}
export const DefaultUnderstanding:LanguageUnderstanding=Object.freeze(new DisabledUnderstanding());
