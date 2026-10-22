import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import '../../shared/checkSchema.mjs';
import { fileURLToPath } from 'node:url';

// Copy only a reviewed public allowlist into the server bundle. Never scan the
// workspace or refresh review hashes as a side effect of a build.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const destination=resolve(root,'frontend/.evaluationBundle');
const seal=readFileSync(resolve(root,'netlify/evaluation/reviewSeal.ts'),'utf8').match(/ReviewHash = '([a-f0-9]{64})'/)?.[1];
const digest=contents=>createHash('sha256').update(contents).digest('hex');
const reviewBytes=readFileSync(resolve(root,'evaluation/review.json'));
if(!seal||digest(reviewBytes)!==seal)throw new Error('Public evaluation review is invalid.');
const review=JSON.parse(reviewBytes);
if(review.reviewStatus!=='reviewedForEvaluation'||review.competitionStatus!=='competitionReady'||review.productionApproved!==false)throw new Error('Public evaluation review is invalid.');
const names=['evaluation/review.json',...Object.keys(review.files)],allowed=new Set(['content.json',...names.map(name=>name+'.verified')]);
const files={};
function checkExisting(directory,relative='') {
 for(const entry of readdirSync(directory,{withFileTypes:true})) {
  const name=relative+entry.name,source=resolve(directory,entry.name);
  if(entry.isSymbolicLink())throw new Error('Unexpected file in public evaluation bundle.');
  if(entry.isDirectory())checkExisting(source,name+'/');
  else if(!entry.isFile()||!allowed.has(name))throw new Error('Unexpected file in public evaluation bundle.');
 }
}
if(existsSync(destination))checkExisting(destination);
for(const name of names) {
 if(!/^(shared|evaluation|backend|netlify|frontend\/(?:src|scripts))\//.test(name)||name.split('/').some(part=>part==='..'||part.startsWith('.'))||/[\\:]/.test(name)||(name!=='frontend/src/styles.css'&&!/\.(json|py|tsx?|mjs)$/.test(name))||/knowledge|candidatePolicies|sourceIntake|privateEvidence|backend\/competition\/(?:evidence|module02Evidence)\//.test(name))throw new Error('Public evaluation bundle contains an invalid path.');
 const source=resolve(root,name);
 for(let component=source;;component=dirname(component)) {if(lstatSync(component).isSymbolicLink())throw new Error('Public evaluation bundle contains a linked path.');if(component===dirname(component))break;}
 const contents=readFileSync(source);
 if(contents.length>1_000_000||name!=='evaluation/review.json'&&digest(contents)!==review.files[name])throw new Error('Public evaluation review is stale.');
 // Opaque verification copies cannot be mistaken for executable function files.
 const target=resolve(destination,name+'.verified');mkdirSync(dirname(target),{recursive:true});writeFileSync(target,contents);
 files[name]=contents.toString('base64');
}
writeFileSync(resolve(destination,'content.json'),JSON.stringify({files}));
console.log('Prepared reviewed public evaluation bundle; no protected documents or private evidence included.');
