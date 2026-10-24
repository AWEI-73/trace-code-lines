// Failure summaries use observed diagnostics, never repository-specific fault lists.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './walker.mjs';
export function projectSite(value,repo){
 const text=String(value??'').replaceAll('\\\\','\\');
 for(const m of text.matchAll(/(file:\/\/\/[^\s)"']+?|[A-Za-z]:[\\/][^\n)"']+?|(?:[\w.@-]+\/)+[\w.@-]+):([0-9]+)(?::[0-9]+)?(?=[\s)"']|$)/g)){
  if(m.index>0&&/[A-Za-z0-9_:/\\]/.test(text[m.index-1]))continue;
  let p=m[1].replace(/:\d+$/,'');try{if(p.startsWith('file:'))p=fileURLToPath(p);}catch{continue;}
  const rel=path.relative(repo,path.resolve(repo,p)).replaceAll('\\','/');if(rel&&!rel.startsWith('../')&&!path.isAbsolute(rel)&&!rel.includes(':'))return {file:rel,line:Number(m[2])};
 }return null;
}
const scalar=s=>{s=String(s??'').trim();if(s.startsWith('"')){try{return JSON.parse(s);}catch{}}return s.replace(/^'|'$/g,'').replaceAll("''","'");};
export function failureRows(stdout='',stderr='',repo='.'){
 const text=stdout+'\n'+stderr,lines=text.split(/\r?\n/),rows=[];
 // Stop at the diagnostic terminator / next TAP result. Never borrow a later failure.
 for(let i=0;i<lines.length;i++){
  const m=lines[i].match(/^\s*not ok \d+(?: - )?(.*)$/);if(!m||/# (?:SKIP|TODO)\b/.test(m[1]))continue;
  const block=[lines[i]];for(let j=i+1;j<lines.length;j++){if(/^\s*(?:not )?ok \d+/.test(lines[j])||/^\s*# Subtest:/.test(lines[j]))break;block.push(lines[j]);if(/^\s*\.\.\.\s*$/.test(lines[j]))break;}
  const body=block.join('\n');if(/failureType:\s*['"]?subtestsFailed/.test(body))continue;
  const field=k=>body.match(new RegExp('^\\s*'+k+': (.*)$','m'))?.[1];
  let message=scalar(field('error'));if(/^[|>][+-]?$/.test(message)){const a=block.findIndex(l=>/^\s*error:/.test(l)),indent=block[a].search(/\S/);const v=[];for(let j=a+1;j<block.length&&(!block[j].trim()||block[j].search(/\S/)>indent);j++)v.push(block[j].trim());message=v.join('\n').trim();}
  const stackAt=block.findIndex(l=>/^\s*stack:/.test(l)),stack=stackAt>=0?block.slice(stackAt+1).join('\n'):'';
  const location=projectSite(scalar(field('location')),repo),first=projectSite(stack,repo)??location;
  rows.push({name:m[1].trim(),classification:/INSTRUMENT_DEN(?:Y|IED)|Instrumentation denied|PermissionError|Operation not permitted|\b(?:EACCES|EPERM)\b/i.test(message)?'ENVIRONMENT_DENIED':'PRODUCT_FAILURE',message:message||m[1].trim(),code:scalar(field('code')),first,location,stackSites:stack.split('\n').map(s=>projectSite(s,repo)).filter(Boolean)});
 }
 return rows;
}
export function clusterFailures(runs,repo){
 const failures=[];
 for(const run of runs){
  let rows=run.failures??[];
  if(!rows.length&&run.tests?.productFailures>0)rows=(run.tests.rows??[]).filter(r=>r.classification==='PRODUCT_FAILURE').map(r=>({name:r.name,message:(r.basis??[]).join('\n'),classification:r.classification,first:projectSite((r.basis??[]).join('\n'),repo)}));
  if(!rows.length&&run.tests?.productFailures>0)rows=[{name:run.scenarioId??run.id,message:'Recorded product failures; diagnostic unavailable',classification:'PRODUCT_FAILURE',count:run.tests.productFailures}];
  for(const row of rows.filter(r=>r.classification==='PRODUCT_FAILURE'))failures.push({...row,source:run.source,runId:run.id,evidenceId:run.evidenceId,command:run.command,prerequisites:run.prerequisites??[]});
 }
 const clusters=[];
 for(const f of failures){
  const action=f.action??f.message.match(/(?:unknown|unsupported|rejected|denied|invalid)[ _-]*action\s*[:=]?\s*["']?([\w.-]+)/i)?.[1];
  const keys=[...(action?['action:'+action]:[]),...(f.first?['site:'+f.first.file+':'+f.first.line]:[]),...(f.code&&!/^(ERR_TEST_FAILURE|ERR_ASSERTION|AssertionError)$/.test(f.code)?['code:'+f.code]:[]),...(f.message&&!/^(?:test failed|failure|Expected values to be strictly equal:?|AssertionError)$/i.test(f.message)?['message:'+f.message]:[])];
  if(!keys.length)keys.push('unattributed:'+f.runId+':'+f.name);
  const matches=clusters.filter(g=>g.keys.some(k=>keys.includes(k))),g=matches.shift()??{keys:[],failures:[]};
  if(!clusters.includes(g))clusters.push(g);for(const other of matches){g.keys.push(...other.keys);g.failures.push(...other.failures);clusters.splice(clusters.indexOf(other),1);}
  g.keys=[...new Set([...g.keys,...keys])];g.failures.push(f);
 }
 return clusters.map(g=>({...g,id:'failure-'+sha256(JSON.stringify([...g.keys].sort())).slice(0,16),count:g.failures.reduce((n,f)=>n+(f.count??1),0)}));
}
export function relativeCommand(argv,repo){
 if(!Array.isArray(argv)||!argv.length)return null;
 const out=argv.map((a,i)=>{a=String(a).replaceAll('@CLONE',repo);if(i===0&&/^(?:@NODE|node|.*[\\/]node(?:\.exe)?)$/i.test(a))return 'node';if(path.isAbsolute(a)){const rel=path.relative(repo,a).replaceAll('\\','/');return rel&&!rel.startsWith('../')&&!path.isAbsolute(rel)?rel:null;}return a;});
 return out.some(x=>x===null)?null:out;
}
