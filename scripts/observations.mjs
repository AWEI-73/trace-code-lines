import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,anchor} from './cassette.mjs';
// options.pathMaps: [{id?,installedRoot|pattern,to?:'',repo?,verify?:'sha256'|'none'}] map covered files under an installed copy
//   (pattern: regex over the absolute '/'-separated path with a named group `rel`, for per-run temp install roots)
//   back to repo paths; with sha256 (default) the installed and repo bytes must match, otherwise the row is a mismatch, not coverage.
// options.repos: [{name,root}] additional repositories; their covered files are listed under coverage.repos[name].
// Without options the result is the same as before (files inside root only).
// options.lines: [{file,repo?,line}] asks whether V8 block coverage executed that source line (innermost range count>0);
// the answer is read from the raw run of the repo file or of a hash-verified mapped copy.
export function coverageFiles(directory,root,{pathMaps=[],repos=[],writtenHashes=new Map(),launchHashes=new Map(),lines=[]}={}){
 const lineRows=[];
 const files=new Set(),evidence=[],mapped=[],mismatches=[],extra=Object.fromEntries(repos.map(r=>[r.name,new Set()]));
 const within=(base,p)=>{const rel=path.relative(base,p);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)?rel.replaceAll('\\','/'):null;};
 // Installed copies are often deleted with their temp root before mapping; the run's own write snapshot (after-SHA-256) then stands in.
 const installedHash=a=>{try{return {sha256:hash(fs.readFileSync(a)),verifiedBy:'installed-file'};}catch{}const l=launchHashes.get(path.resolve(a));if(l)return {sha256:l,verifiedBy:'launch-snapshot'};const w=writtenHashes.get(path.resolve(a));return w?{sha256:w,verifiedBy:'write-snapshot'}:null;};
 const seenMap=new Set();
 for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.json'))){
  const p=path.join(directory,name),b=fs.readFileSync(p),d=JSON.parse(b);evidence.push({file:p,sha256:hash(b)});
  const rows=d.schema==='python-settrace-v1'?d.files.map(f=>({path:f.path,positive:f.lines.some(l=>l.count>0),pyLines:f.lines})):(d.result??[]).filter(s=>s.url.startsWith('file:')).map(s=>({path:fileURLToPath(s.url),positive:s.functions.some(f=>f.ranges.some(r=>r.count>0)),functions:s.functions}));
  for(const r of rows){if(!r.positive)continue;const rel=within(root,r.path);if(rel){files.add(rel);if(lines.length)lineRows.push({repo:null,file:rel,row:r});continue;}
   let done=false;
   for(const r2 of repos){const x=within(r2.root,r.path);if(x){extra[r2.name].add(x);if(lines.length)lineRows.push({repo:r2.name,file:x,row:r});done=true;break;}}
   if(done)continue;
   for(const [i,m] of pathMaps.entries()){const groups=m.pattern?new RegExp(m.pattern,m.flags??'').exec(r.path.replaceAll('\\','/'))?.groups??{}:{},x=m.pattern?groups.rel:m.installedRoot&&within(m.installedRoot,r.path);if(!x)continue;
    // "to" may reuse other named groups of the pattern as $<name>.
    const target=path.posix.join((m.to??'').replace(/\$<(\w+)>/g,(_,g)=>groups[g]??''),x),repoRoot=m.repo?repos.find(q=>q.name===m.repo)?.root:root;if(!repoRoot)continue;
    const key=r.path+'\0'+i;if(seenMap.has(key))break;seenMap.add(key);
    const row={map:m.id??i,installed:r.path,file:target,...(m.repo?{repo:m.repo}:{})};
    if(m.verify==='none'){(m.repo?extra[m.repo]:files).add(target);if(lines.length)lineRows.push({repo:m.repo??null,file:target,row:r,mappedFrom:r.path,unverified:true});mapped.push({...row,verified:false});}
    else{const i2=installedHash(r.path);let repoHash=null;try{repoHash=hash(fs.readFileSync(path.join(repoRoot,target)));}catch{}
     if(!i2)mismatches.push({...row,status:'INSTALLED_FILE_GONE'});else if(!repoHash)mismatches.push({...row,status:'REPO_FILE_MISSING'});
     else if(i2.sha256===repoHash){(m.repo?extra[m.repo]:files).add(target);if(lines.length)lineRows.push({repo:m.repo??null,file:target,row:r,mappedFrom:r.path});mapped.push({...row,verified:true,verifiedBy:i2.verifiedBy,sha256:repoHash});}
     else mismatches.push({...row,status:'HASH_MISMATCH',installedSha256:i2.sha256,repoSha256:repoHash});}
    break;}
  }
 }
 const out={files:[...files].sort(),evidence};
 if(pathMaps.length)Object.assign(out,{mapped:mapped.sort((a,b)=>a.file.localeCompare(b.file)),mapMismatches:mismatches});
 if(repos.length)out.repos=Object.fromEntries(Object.entries(extra).map(([k,v])=>[k,[...v].sort()]));
 if(lines.length)out.lines=lines.map(q=>{
  const repoRoot=q.repo?repos.find(x=>x.name===q.repo)?.root:root;let text=null;try{text=fs.readFileSync(path.join(repoRoot,q.file),'utf8');}catch{}
  const hits=lineRows.filter(x=>(x.repo??null)===(q.repo??null)&&x.file===q.file);
  if(text===null)return {...q,hit:false,status:'UNKNOWN',reason:'REPO_FILE_UNREADABLE'};
  if(!hits.length)return {...q,hit:false,status:'NOT_EXECUTED',reason:'FILE_NOT_IN_COVERAGE'};
  const ls=text.split('\n');if(q.line<1||q.line>ls.length)return {...q,hit:false,status:'UNKNOWN',reason:'LINE_OUT_OF_RANGE'};
  const lead=ls[q.line-1].match(/^\s*/)[0].length,offset=Buffer.byteLength(ls.slice(0,q.line-1).join('\n')+(q.line>1?'\n':''),'utf8')+lead;
  let best=null,count=0;
  for(const h of hits){
   if(h.row.pyLines){const l=h.row.pyLines.find(l=>l.line===q.line);if(l&&l.count>count){count=l.count;best={source:h.mappedFrom??'repo'};}continue;}
   // V8 offsets count UTF-16 units; use a char offset for non-ASCII prefixes.
   const off=/^[\x00-\x7f]*$/.test(ls.slice(0,q.line).join('\n'))?offset:ls.slice(0,q.line-1).join('\n').length+(q.line>1?1:0)+lead;
   let inner=null;for(const f of h.row.functions)for(const r of f.ranges)if(r.startOffset<=off&&off<r.endOffset&&(!inner||r.endOffset-r.startOffset<inner.endOffset-inner.startOffset))inner=r;
   if(inner&&inner.count>count){count=inner.count;best={source:h.mappedFrom??'repo',range:[inner.startOffset,inner.endOffset]};}}
  return {...q,text:ls[q.line-1].trim().slice(0,240),hit:count>0,count,status:count>0?'EXECUTED':'NOT_EXECUTED',...(best??{})};
 });
 return out;
}
export function commandStatuses(stdout){
 const results=[];const inspect=(x,p='$')=>{if(!x||typeof x!=='object')return;for(const [k,v] of Object.entries(x)){if(/^(?:status|state|ready|ok|success)$/i.test(k)&&['string','boolean'].includes(typeof v))results.push({path:p+'.'+k,value:v});else if(v&&typeof v==='object')inspect(v,p+'.'+k);}};
 try{inspect(JSON.parse(stdout));}catch{for(const line of stdout.split(/\r?\n/)){try{inspect(JSON.parse(line));}catch{}}}
 return results;
}
export function classifyTests(stdout,stderr,denied=[]){
 const rows=[],text=stdout+'\n'+stderr;
 const env=/\b(?:EACCES|EPERM|spawn .* denied|INSTRUMENT_DEN(?:Y|IED)|Instrumentation denied|PermissionError|Operation not permitted|pipe.*denied)\b/i;
 for(const block of text.split(/(?=^not ok )/m).filter(b=>/^not ok /.test(b))){
  const name=block.split('\n')[0],basis=block.split('\n').filter(l=>env.test(l)).slice(0,8);
  rows.push({name,classification:basis.length?'ENVIRONMENT_DENIED':'PRODUCT_FAILURE',basis:basis.length?basis:[block.slice(0,1600)]});
 }
 for(const block of text.split(/(?=^(?:FAIL|ERROR): )/m).filter(b=>/^(?:FAIL|ERROR): /.test(b))){const basis=block.split('\n').filter(l=>env.test(l)).slice(0,8);rows.push({name:block.split('\n')[0],classification:basis.length?'ENVIRONMENT_DENIED':'PRODUCT_FAILURE',basis:basis.length?basis:[block.slice(0,1600)]});}
 if(!rows.length&&/FAILED|Traceback|ERR_TEST_FAILURE/.test(text))rows.push({name:'suite',classification:env.test(text)?'ENVIRONMENT_DENIED':'PRODUCT_FAILURE',basis:[text.slice(-4000)]});
 const python=text.match(/Ran (\d+) tests? in /),tap=text.match(/# pass (\d+)/),pythonOk=!!python&&/^OK(?:\s|$)/m.test(text),skipped=Number(text.match(/skipped=(\d+)/)?.[1]??0);
 return {framework:tap?'TAP':python?'unittest':'UNKNOWN',environmentDenied:rows.filter(r=>r.classification==='ENVIRONMENT_DENIED').length,productFailures:rows.filter(r=>r.classification==='PRODUCT_FAILURE').length,cancelled:Number(text.match(/# cancelled (\d+)/)?.[1]??0),passed:tap?Number(tap[1]):pythonOk?Number(python[1])-skipped:null,denialEvents:denied.length,rows};
}
// RFC 6901 JSON pointer; returns {found,value}.
export function jsonPointer(doc,pointer=''){if(pointer==='')return {found:true,value:doc};let v=doc;for(const raw of pointer.replace(/^\//,'').split('/')){const k=raw.replaceAll('~1','/').replaceAll('~0','~');if(v===null||typeof v!=='object'||!Object.hasOwn(v,k))return {found:false};v=v[k];}return {found:true,value:v};}
// Whole text as JSON, else the last line that parses.
export function parseJsonText(text){try{return {ok:true,value:JSON.parse(text)};}catch{}for(const line of String(text).split(/\r?\n/).reverse()){if(!line.trim())continue;try{return {ok:true,value:JSON.parse(line)};}catch{}}return {ok:false};}
const deepEqual=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function judgeScenario(expect,observation,root,streams={}){
 const checks=[];
 if(!Array.isArray(expect)||!expect.length)return {status:'FAIL',checks:[],reason:'MACHINE_EXPECTATIONS_REQUIRED'};
 for(const e of expect){
  let ok=false,actual=null;
  if(e.kind==='coverage'){actual=e.repo?observation.coverage.repos?.[e.repo]??[]:observation.coverage.files;ok=actual.includes(e.file);}
  else if(e.kind==='write'){actual=observation.writes.filter(w=>(w.paths??[]).some(p=>path.resolve(p)===path.resolve(root,e.file))&&w.snapshotEvidence?.length);ok=actual.length>0&&(!e.sha256||actual.some(w=>w.snapshotEvidence.some(s=>s.after?.sha256===e.sha256)));}
  else if(e.kind==='boundary'){actual=observation.events.filter(x=>x.kind==='cassette'&&x.phase==='success'&&x.key===e.key);ok=actual.length===(e.count??1);}
  else if(e.kind==='anchor'){actual=anchor(root,e);ok=actual.status==='PASS'&&observation.coverage.files.includes(e.file);}
  else if(e.kind==='status'){actual=observation.statuses.filter(s=>s.path===e.path);ok=actual.some(s=>s.value===e.value);}
  else if(e.kind==='output'){const text=streams[e.stream??'stdout'];if(typeof text!=='string'){actual={reason:'STREAM_UNAVAILABLE'};}else{const hit=e.pattern!==undefined?new RegExp(e.pattern,e.flags??'').test(text):text.includes(e.contains??'');actual={stream:e.stream??'stdout',matched:hit,bytes:Buffer.byteLength(text)};ok=e.absent===true?!hit:hit;}}
  else if(e.kind==='json'){const src=e.source??'stdout';let text;if(src==='stdout'||src==='stderr')text=streams[src];else{try{text=fs.readFileSync(path.resolve(root,src),'utf8');}catch{}}
   const doc=typeof text==='string'?parseJsonText(text):{ok:false};if(!doc.ok)actual={reason:'JSON_UNAVAILABLE',source:src};else{const at=jsonPointer(doc.value,e.pointer??'');actual={source:src,pointer:e.pointer??'',found:at.found,value:at.value};ok=Object.hasOwn(e,'value')?at.found&&deepEqual(at.value,e.value):e.exists===false?!at.found:at.found;}}
  else if(e.kind==='line'){actual=(observation.coverage.lines??[]).find(l=>l.file===e.file&&l.line===e.line&&(l.repo??null)===(e.repo??null))??{reason:'LINE_NOT_REQUESTED'};ok=actual.hit===true&&(!e.expect||String(actual.text??'').includes(e.expect));}
  else if(e.kind==='exit'){actual=observation.exitCode;ok=actual===e.code;}
  checks.push({expected:e,status:ok?'PASS':'FAIL',actual});
 }
 const witness=expect.some(e=>['coverage','write','boundary','anchor','line'].includes(e.kind));
 const exitOk=expect.some(e=>e.kind==='exit')?true:observation.exitCode===0;
 return {status:checks.every(c=>c.status==='PASS')&&witness&&exitOk?'PASS':'FAIL',checks,exitCode:observation.exitCode,witness};
}
