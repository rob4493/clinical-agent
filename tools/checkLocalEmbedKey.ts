/** Operator-only local inspection: reads originals in memory, writes nothing. */
import {readFileSync,statSync} from 'node:fs';
import {createHash,createPublicKey} from 'node:crypto';
import {isAbsolute,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateEmbedKey} from '../netlify/functions/verifyEmbedKey.ts';
const Root=fileURLToPath(new URL('../',import.meta.url));

export function checkLocalEmbedKey(privatePath:string,publicPath:string){
 try{
  // Read no key from the repository and do not echo paths in errors.
  for(const path of [privatePath,publicPath]){
   if(!isAbsolute(path))throw new Error();
   const relation=relative(Root,resolve(path));if(!relation.startsWith('..')&&!isAbsolute(relation))throw new Error();
   if(!statSync(path).isFile()||statSync(path).size>12000)throw new Error();
  }
  const publicKey=createPublicKey(readFileSync(publicPath));
  const pin=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
  return validateEmbedKey(readFileSync(privatePath,'utf8'),pin);
 }catch{return {status:'FAIL',reason:'localFilesUnavailableOrInvalid'};}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==4){console.error('Provide absolute paths to the original private PEM and matching public PEM outside the repository. No files were read.');process.exitCode=2;}
 else{const report=checkLocalEmbedKey(process.argv[2],process.argv[3]);console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='PASS'?0:1;}
}
