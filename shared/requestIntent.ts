import Patterns from './requestIntent.json';

const Prescribing=new RegExp(Patterns.prescribing,'i'),General=new RegExp(Patterns.general,'i'),Personal=new RegExp(Patterns.personal,'i');
/** Existing scope detector only; metadata can never suppress server safeguards. */
export function prescribingIntent(notes:string|null):boolean {
 const text=(notes||'').replace(new RegExp(Patterns.negative,'gi'),'');
 return text.split(/(?<=[.!?;])\s+/).some(sentence=>Prescribing.test(sentence)&&!(General.test(sentence)&&!Personal.test(sentence)));
}
