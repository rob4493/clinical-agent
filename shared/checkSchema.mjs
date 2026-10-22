// Build-time consistency only: never generate code or refresh evaluation seals.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pins=JSON.parse(readFileSync(resolve(root,'shared/schemaArtifacts.json'),'utf8'));
const digest=content=>createHash('sha256').update(content).digest('hex');
const schema=JSON.parse(readFileSync(resolve(root,'shared/clinicalData.schema.json'),'utf8'));
const supported=new Set(['$schema','$id','$ref','$defs','title','description','type','properties','required','additionalProperties','anyOf','enum','const','default','minimum','maximum','minLength','maxLength','pattern','items','minItems','maxItems','uniqueItems','x-uniqueId','x-stateValue','x-clinicalDate','x-sourceSpan','x-intent','x-caseIntegrity']);
function checkVocabulary(definition) {
 if(Object.keys(definition).some(key=>!supported.has(key))||definition.type==='object'&&definition.additionalProperties!==false)throw new Error('Unsupported clinical schema vocabulary.');
 if(definition.$ref&&(!definition.$ref.startsWith('#/$defs/')||!Object.hasOwn(schema.$defs,definition.$ref.split('/').pop())))throw new Error('Unsupported clinical schema reference.');
 for(const group of ['properties','$defs'])for(const nested of Object.values(definition[group]??{}))checkVocabulary(nested);
 for(const option of definition.anyOf??[])checkVocabulary(option);
 if(definition.items)checkVocabulary(definition.items);
}
checkVocabulary(schema);
if(digest(readFileSync(resolve(root,'shared/clinicalData.schema.json')))!==pins.schemaHash)throw new Error('Clinical schema representations are stale.');
for(const [name,hash] of Object.entries(pins.artifacts)) {
 if(!['shared/clinicalData.ts','backend/app/models/clinicalData.py'].includes(name)||digest(readFileSync(resolve(root,name)))!==hash)throw new Error('Clinical schema representations are stale.');
}
