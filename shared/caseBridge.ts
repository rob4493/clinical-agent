import type { CanonicalCase, ClinicalFlag, ClinicalText, LegacyCase } from './clinicalData';
import Schema from './clinicalData.schema.json';
import { ClinicalDataError, validateNode } from './schemaRules';
import { prescribingIntent } from './requestIntent';
import { confirmedText } from './documentBridge';

const LegacyNames=['painLocation','painQuality','painSeverity','symptomTiming','bowelUrinarySymptoms','sexualPain','menstrualHistory','fertilityStatus','priorTreatments','familyHistory'];
const FutureCollections=['symptoms','investigations','previousProcedures','previousTreatments','conflictingInterpretations','importantMissingInformation'];
type Fields=Record<string,any>;
function reportState(payload:Fields,name:string,boolean=false):ClinicalText|ClinicalFlag {
 if(!Object.hasOwn(payload,name))return {state:'notReported'};
 if(payload[name]===null)return {state:'unknown'};
 if(boolean)return {state:payload[name]?'present':'absent'};
 return {state:'present',value:payload[name]};
}
export function validateClinical(payload:unknown):CanonicalCase {validateNode(payload);return payload as CanonicalCase;}
export function legacyToCanonical(payload:LegacyCase):CanonicalCase {
 validateNode(payload,Schema.$defs.LegacyCase);
 const fields=payload as Fields;
 const result:Fields={schemaVersion:'1.0.0',moduleId:payload.moduleHint,caseType:payload.caseType??'detailed',ageRange:reportState(fields,'ageRange'),pregnancyStatus:reportState(fields,'pregnancyPossible',true),pidStatus:reportState(fields,'pidDiagnosedOrPresumed',true),originalNarrative:reportState(fields,'additionalNotes'),userIntent:prescribingIntent(payload.additionalNotes??null)?{state:'reported',requests:['prescribingOrDosing'],origin:'legacyBoundaryDetection'}:{state:'notReported'}};
 if(Object.hasOwn(fields,'earlyPregnancy'))result.earlyPregnancy=payload.earlyPregnancy;
 const reported=Object.fromEntries(LegacyNames.filter(name=>Object.hasOwn(fields,name)).map(name=>[name,fields[name]]));
 if(Object.keys(reported).length)result.reportedContext=reported;
 if(payload.urgentFindings!=null)result.urgentIndicators=Object.fromEntries(Object.keys(payload.urgentFindings).map(name=>[name,reportState(payload.urgentFindings!,name,!name.startsWith('oralTemperature'))]));
 return validateClinical(result);
}
function restoreState(record:Fields,boolean=false):unknown {
 if(record.state==='unknown')return null;
 if(record.state==='present')return boolean?true:record.value;
 if(record.state==='absent'&&boolean)return false;
 throw new ClinicalDataError();
}
export function canonicalToLegacy(payload:unknown):LegacyCase {
 const record=validateClinical(payload) as unknown as Fields;
 if(FutureCollections.some(name=>record[name]?.length))throw new ClinicalDataError();
 const result:Fields={moduleHint:record.moduleId,caseType:record.caseType};
 for(const [name,field,boolean] of [['ageRange','ageRange',false],['pregnancyStatus','pregnancyPossible',true],['pidStatus','pidDiagnosedOrPresumed',true],['originalNarrative','additionalNotes',false]] as const)if(record[name]&&record[name].state!=='notReported')result[field]=restoreState(record[name],boolean);
 if(Object.hasOwn(record,'earlyPregnancy'))result.earlyPregnancy=record.earlyPregnancy;
 const question=record.primaryQuestion??{state:'notReported'};
 if(question.state==='present'&&question.value)result.additionalNotes=[result.additionalNotes,question.value].filter(Boolean).join(' ');
 else if(!['unknown','notReported','present'].includes(question.state))throw new ClinicalDataError();
 const observations=confirmedText(record as CanonicalCase);
 if(observations.length)result.additionalNotes=[result.additionalNotes,...observations].filter(Boolean).join('\n');
 Object.assign(result,record.reportedContext??{});
 if(record.urgentIndicators)result.urgentFindings=Object.fromEntries(Object.entries(record.urgentIndicators as Fields).filter(([,finding])=>finding.state!=='notReported').map(([name,finding])=>[name,restoreState(finding,!name.startsWith('oralTemperature'))]));
 const expected=legacyToCanonical(result as LegacyCase).userIntent;
 if(record.userIntent?.state==='reported'&&!(expected?.state==='reported'&&JSON.stringify(record.userIntent.requests)===JSON.stringify(expected.requests)))throw new ClinicalDataError();
 validateNode(result,Schema.$defs.LegacyCase);
 return result as LegacyCase;
}
