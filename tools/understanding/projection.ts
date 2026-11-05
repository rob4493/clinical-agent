import Corpus from '../../evaluation/understanding/corpus.json';
import Schema from '../../evaluation/understanding/observations.schema.json';
import {validateCase} from '../../netlify/evaluation/input';
import {EvaluationError,freeze,type Projection,type ProposedOutput} from './contract';

export interface Episode {id:string;syntheticOnly:boolean;moduleId:string;tags:string[];questionId:string;turns:{id:string;text:string}[];caseInput:unknown;expectedProjection:string;expectedSafety:string;expected:ProposedOutput}
export function episodes():readonly Episode[]{return freeze(structuredClone(Corpus.cases) as unknown as Episode[]);}
/** Only repository-registered fictional episodes are projectable. This is not authorization or de-identification. */
export function projectFixture(episodeId:string):Projection {
 try{
  const episode=Corpus.cases.find(episode=>episode.id===episodeId);
  if(!episode||!episode.syntheticOnly||!Corpus.syntheticOnly||!['module_01_endo','module_02_early_pregnancy'].includes(episode.moduleId)||episode.turns.length>6||!episode.turns.length||new Set(episode.turns.map(turn=>turn.id)).size!==episode.turns.length)throw new EvaluationError();
  let characters=0;
  for(const turn of episode.turns){if(!/^T[1-6]$/.test(turn.id)||!turn.text.trim()||turn.text.length>512||/[\u0000-\u001f]|\b\d{4}-\d{2}-\d{2}\b|\b\d+(?:\.\d+)?\s*(?:cm|mm|mg|mcg|ml|iu)\b/i.test(turn.text))throw new EvaluationError();characters+=turn.text.length;validateCase({moduleHint:episode.moduleId,additionalNotes:turn.text});}
  if(characters>2048||episode.questionId!=='none'&&!Object.hasOwn(Schema['x-bindings'],episode.questionId))throw new EvaluationError();
  // Reconstruct rather than strip forbidden fields from an arbitrary case object.
  return freeze({projectionVersion:'1.0.0',moduleId:episode.moduleId,questionId:episode.questionId,turns:episode.turns.map(turn=>({id:turn.id,text:turn.text}))});
 }catch{throw new EvaluationError();}
}
export const ProjectionPolicy=freeze({version:'1.0.0',providerAccess:false,source:'registeredSyntheticFixturesOnly',maximumTurns:6,maximumTurnCharacters:512,maximumTotalCharacters:2048,maximumResponseBytes:16384});
