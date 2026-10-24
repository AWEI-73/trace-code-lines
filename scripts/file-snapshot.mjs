import {gapList} from './gap-shape.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const key=p=>path.resolve(p).toLowerCase();
const under=(root,p)=>key(p)===key(root)||key(p).startsWith(key(root)+path.sep);
export function fileSnapshot(roots,exclude=[]){
 const entries={},gaps=gapList();
 function visit(p){
  if(exclude.some(r=>under(r,p))||entries[key(p)])return;
  try{const st=fs.lstatSync(p);if(st.isSymbolicLink()){gaps.push({path:p,kind:'SNAPSHOT_LINK_SKIPPED'});return;}
   if(st.isDirectory()){const names=fs.readdirSync(p).sort();entries[key(p)]={path:p,type:'directory',sha256:crypto.createHash('sha256').update(JSON.stringify(names)).digest('hex')};for(const n of names)visit(path.join(p,n));}
   else if(st.isFile())entries[key(p)]={path:p,type:'file',bytes:st.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')};
  }catch(e){if(e.code!=='ENOENT')gaps.push({path:p,kind:'SNAPSHOT_READ_FAILED',detail:e.message});}
 }
 for(const r of roots)visit(r);return {entries,gaps};
}
export function changedPaths(before,after){
 return Object.keys(after.entries).filter(k=>!before.entries[k]||before.entries[k].sha256!==after.entries[k].sha256).map(k=>({path:after.entries[k].path,before:before.entries[k]??null,after:after.entries[k]}));
}
