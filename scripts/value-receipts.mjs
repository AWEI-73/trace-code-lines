import fs from 'node:fs';
import crypto from 'node:crypto';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export function readValueFile(path){
 try{const s=fs.lstatSync(path);if(!s.isFile()||s.isSymbolicLink())return {exists:true,sha256:null,type:s.isDirectory()?'directory':'other'};
 const bytes=fs.readFileSync(path);return {exists:true,type:'file',sha256:sha(bytes),bytes:bytes.length,content:bytes};}
 catch(error){return {exists:false,sha256:null,error:error.code};}
}
export function expandSelector(value,selector){
 const tokens=selector.split('.').filter(Boolean),rows=[];
 function visit(v,i,parts){if(i===tokens.length){rows.push({selector:parts.join('.'),value:v});return;}
 const t=tokens[i];if(t.endsWith('[]')){const k=t.slice(0,-2);if(Array.isArray(v?.[k]))v[k].forEach((x,n)=>visit(x,i+1,[...parts,`${k}[${n}]`]));}
 else if(v!==null&&typeof v==='object'&&Object.hasOwn(v,t))visit(v[t],i+1,[...parts,t]);}
 visit(value,0,[]);return rows;
}
export function valueReceipt(path,before,after,declarations,writeClass){
 if(!['preparation','seed','business','unknown'].includes(writeClass))writeClass='unknown';
 const receipt={path,beforeSha256:before.sha256,sha256:after.sha256,changed:before.sha256!==after.sha256&&(before.sha256!==null||after.sha256!==null),writeClass,
 status:after.sha256?'READ_BACK':'NO_FILE_VALUE',fields:[]};
 let value;try{value=JSON.parse(after.content?.toString('utf8'));}catch{return receipt;}
 for(const d of declarations??[])if(!d.targetPattern||new RegExp(d.targetPattern,'i').test(path.replaceAll('\\','/')))
 for(const f of d.fields??[])for(const row of expandSelector(value,f.selector??f))receipt.fields.push({field:f.field??f.selector??f,...row});
 return receipt;
}
