import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,anchor} from './cassette.mjs';
export function coverageFiles(directory,root){
 const files=new Set(),evidence=[];
 for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.json'))){
  const p=path.join(directory,name),b=fs.readFileSync(p),d=JSON.parse(b);evidence.push({file:p,sha256:hash(b)});
  const rows=d.schema==='python-settrace-v1'?d.files.map(f=>({path:f.path,positive:f.lines.some(l=>l.count>0)})):(d.result??[]).filter(s=>s.url.startsWith('file:')).map(s=>({path:fileURLToPath(s.url),positive:s.functions.some(f=>f.ranges.some(r=>r.count>0))}));
  for(const r of rows){const rel=path.relative(root,r.path);if(r.positive&&rel&&!rel.startsWith('..')&&!path.isAbsolute(rel))files.add(rel.replaceAll('\\','/'));}
 }
 return {files:[...files].sort(),evidence};
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
export function judgeScenario(expect,observation,root){
 const checks=[];
 if(!Array.isArray(expect)||!expect.length)return {status:'FAIL',checks:[],reason:'MACHINE_EXPECTATIONS_REQUIRED'};
 for(const e of expect){
  let ok=false,actual=null;
  if(e.kind==='coverage'){actual=observation.coverage.files;ok=actual.includes(e.file);}
  else if(e.kind==='write'){actual=observation.writes.filter(w=>(w.paths??[]).some(p=>path.resolve(p)===path.resolve(root,e.file))&&w.snapshotEvidence?.length);ok=actual.length>0&&(!e.sha256||actual.some(w=>w.snapshotEvidence.some(s=>s.after?.sha256===e.sha256)));}
  else if(e.kind==='boundary'){actual=observation.events.filter(x=>x.kind==='cassette'&&x.phase==='success'&&x.key===e.key);ok=actual.length===(e.count??1);}
  else if(e.kind==='anchor'){actual=anchor(root,e);ok=actual.status==='PASS'&&observation.coverage.files.includes(e.file);}
  else if(e.kind==='status'){actual=observation.statuses.filter(s=>s.path===e.path);ok=actual.some(s=>s.value===e.value);}
  checks.push({expected:e,status:ok?'PASS':'FAIL',actual});
 }
 const witness=expect.some(e=>['coverage','write','boundary','anchor'].includes(e.kind));
 return {status:checks.every(c=>c.status==='PASS')&&witness&&observation.exitCode===0?'PASS':'FAIL',checks,exitCode:observation.exitCode,witness};
}
