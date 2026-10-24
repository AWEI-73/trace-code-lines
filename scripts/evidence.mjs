import {normalizeGap} from './gap-shape.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
export const get=(v,k)=> (Array.isArray(k)?k:String(k).split('.')).reduce((x,p)=>x!=null&&Object.hasOwn(x,p)?x[p]:undefined,v);
export const within=(root,file)=>{const r=path.relative(path.resolve(root),path.resolve(file));return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
export function safe(file,roots){
  file=path.resolve(file);
  if(!roots.some(r=>within(r,file)))throw Error('OUTSIDE_ALLOWED_ROOTS: '+file);
  let at=path.parse(file).root;
  for(const part of file.slice(at.length).split(path.sep).filter(Boolean)){
    at=path.join(at,part);if(fs.lstatSync(at).isSymbolicLink())throw Error('SYMLINK_REFUSED: '+at);
  }
  if(!fs.statSync(file).isFile())throw Error('NOT_REGULAR_FILE: '+file);
  return file;
}
export function reader(roots,gaps=[]){
  const sources=new Map();
  const read=file=>{const p=safe(file,roots),bytes=fs.readFileSync(p);sources.set(p,{path:p,sha256:sha256(bytes)});return bytes;};
  const json=file=>JSON.parse(read(file).toString('utf8').replace(/^\uFEFF/,''));
  return {read,json,sources};
}
export function discover(root,pattern,gaps){
  const out=[];root=path.resolve(root);
  function visit(dir){
    try{
      // Check ancestors even when the configured root itself is linked.
      let at=dir;while(true){if(fs.lstatSync(at).isSymbolicLink())throw Error('SYMLINK_REFUSED');const up=path.dirname(at);if(up===at)break;at=up;}
      for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
        const p=path.join(dir,e.name);
        if(e.isSymbolicLink())gaps.push(normalizeGap({code:'SYMLINK_SKIPPED',path:p}));
        else if(e.isDirectory())visit(p);
        else if(e.isFile()&&new RegExp(pattern).test(path.relative(root,p).replaceAll('\\','/')))out.push(p);
      }
    }catch(e){gaps.push(normalizeGap({code:'DISCOVERY_UNKNOWN',path:dir,detail:e.message}));}
  }
  visit(root);return out;
}
