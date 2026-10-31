#!/usr/bin/env node
// Bounded orchestration of existing tools. Never imports inspected code.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {discoverEntries} from './discover-entries.mjs';
import {versionChain} from './version-chain.mjs';
import {census} from './record-census.mjs';
import {deletionImpact} from './deletion-impact.mjs';
import {runOnce} from './run-once.mjs';
import {inside,noLinks,digest} from './instrument.mjs';
import {tokens} from './language-static.mjs';
import {classifyTests} from './observations.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const defaults={maxFiles:20000,maxEntries:100000,maxFileBytes:2097152,maxTotalBytes:268435456,maxRecords:100000,maxQuestions:50,maxTests:20,maxMapRoots:8,timeoutMs:120000,minFreeBytes:6442450944};
const testName=p=>/(?:^|\/)(?:tests?|__tests__)\/.*\.(?:[cm]?js|py)$|\.(?:test|spec)\.[cm]?js$/.test(p);
const rel=p=>typeof p==='string'&&p!=='.'&&p.length>0&&!path.isAbsolute(p)&&!/[\\:\0]/.test(p)&&!p.split('/').includes('..');
const safeName=p=>{if(!rel(p))throw Error('REPO_RELATIVE_PATH_REQUIRED: '+p);return p;};
const fmt=o=>JSON.stringify(o,null,2)+'\n';
function save(p,v){noLinks(p);fs.mkdirSync(path.dirname(p),{recursive:true});const s=typeof v==='string'?v:fmt(v);fs.writeFileSync(p,s,'utf8');const b=fs.readFileSync(p,'utf8');if(s!==b||b.includes('\ufffd'))throw Error('UTF8_READBACK_FAILED');return {path:p,sha256:digest(b),cjk:(b.match(/[\u3400-\u9fff]/g)||[]).length,questionMarks:(b.match(/\?/g)||[]).length,replacementCharacters:(b.match(/\ufffd/g)||[]).length,cr:(b.match(/\r/g)||[]).length};}
function limitsOf(value={}){for(const [k,v] of Object.entries(value))if(!Object.hasOwn(defaults,k)||!Number.isSafeInteger(v)||v<=0)throw Error('INVALID_LIMIT: '+k);return {...defaults,...value};}
function space(root,limits,receipts,step){while(!fs.existsSync(root)){const parent=path.dirname(root);if(parent===root)throw Error('NO_EXISTING_OUTPUT_ANCESTOR');root=parent;}const s=fs.statfsSync(root),bytes=Number(s.bavail)*Number(s.bsize);receipts.push({step,at:new Date().toISOString(),freeBytes:bytes});if(bytes<limits.minFreeBytes)throw Error('LOW_SPACE_PAUSE');}
function git(repo,args){const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});if(r.status!==0)throw Error('GIT_READ_FAILED: '+r.stderr);return r.stdout;}
function budget(limits){return {files:0,bytes:0,entries:0,skipped:[],limits};}
function boundedFiles(root,b,{exclude=['.git','node_modules','.venv','__pycache__']}={}){
 const files=[];
 const skip=(file,reason,detail={})=>b.skipped.push({root,file,reason,...detail});
 function visit(dir){
  noLinks(dir);const entries=fs.readdirSync(dir,{withFileTypes:true}).sort((a,z)=>a.name.localeCompare(z.name));
  for(let i=0;i<entries.length;i++){
   const e=entries[i],p=path.join(dir,e.name),r=path.relative(root,p).replaceAll('\\','/');
   if(++b.entries>b.limits.maxEntries){skip(r,'MAX_ENTRIES: unvisited remainder of '+path.relative(root,dir),{limit:b.limits.maxEntries,observed:b.entries});return;}
   if(e.isSymbolicLink()){skip(r,'SYMLINK_NOT_FOLLOWED');continue;}
   if(e.isDirectory()){if(exclude.includes(e.name))skip(r,'EXCLUDED_DIRECTORY');else visit(p);}
   else if(e.isFile()){
    const s=fs.statSync(p);
    if(b.files>=b.limits.maxFiles){skip(r,'MAX_FILES',{limit:b.limits.maxFiles,observed:b.files+1});continue;}
    if(s.size>b.limits.maxFileBytes){skip(r,'MAX_FILE_BYTES',{limit:b.limits.maxFileBytes,observed:s.size});continue;}
    if(b.bytes+s.size>b.limits.maxTotalBytes){skip(r,'MAX_TOTAL_BYTES',{limit:b.limits.maxTotalBytes,observed:b.bytes+s.size});continue;}
    b.files++;b.bytes+=s.size;files.push({file:r,path:p,size:s.size});
   }
  }
 }
 visit(root);return files;
}
function snapshot(repo,limits){
 const head=git(repo,['rev-parse','HEAD']).trim(),status=git(repo,['status','--porcelain']),names=git(repo,['ls-files','-z']).split('\0').filter(Boolean).sort();
 const files=[],skipped=[];let total=0;
 for(const name of names){
  safeName(name);const p=path.join(repo,name);noLinks(p);const s=fs.statSync(p);
  const exceeded=[['maxFiles',files.length+1],['maxFileBytes',s.size],['maxTotalBytes',total+s.size]].filter(([key,observed])=>observed>limits[key]).map(([key,observed])=>({name:key,limit:limits[key],observed}));
  if(exceeded.length){skipped.push({file:name,reason:'SOURCE_BUDGET',bytes:s.size,limits:exceeded});continue;}
  const b=fs.readFileSync(p);total+=b.length;files.push({file:name,sha256:digest(b),bytes:b.length});
 }
 return {repo,head,status,files,skipped,bytes:total,sha256:digest(fmt(files))};
}
function select(obj,key){if(key==null||key==='$')return obj;for(const k of String(key).replace(/^\$\./,'').split('.')){if(obj==null||!Object.hasOwn(obj,k))return undefined;obj=obj[k];}return obj;}
function checkOutput(p,roots,inputs=[]){noLinks(p);if(roots.some(r=>inside(r,p)||inside(p,r))||inputs.some(f=>path.resolve(f)===path.resolve(p)))throw Error('OUTPUT_OVERLAPS_READ_ONLY_INPUT');}
function candidates(repo,inventory){
 const files=inventory.files.map(f=>f.file),tests=files.filter(testName),versions=files.filter(f=>/(?:^|\/)(?:package\.json|SKILL\.md|pyproject\.toml|VERSION|current\.json|.*(?:version|pointer|release).*\.json)$/i.test(f));
 const entries=inventory.entries.filter(e=>e.kind!=='exported-function'&&!testName(e.anchor.file));
 const chosen=entries.length?entries:inventory.entries.filter(e=>!testName(e.anchor.file));
 const mapRoots=[...new Map(chosen.map(e=>[e.anchor.file,{path:e.anchor.file,reason:e.kind+' candidate',anchor:e.anchor}])).values()];
 const recordRootCandidates=[],seen=new Set();
 const add=(p,basis)=>{const key=path.resolve(p);if(!seen.has(key)){seen.add(key);recordRootCandidates.push({path:key,label:'candidate-'+recordRootCandidates.length,basis,authorized:false});}};
 for(const f of files){if(/(?:^|\/)(?:records?|learning|events?|journals?|logs?|data)(?:\/|$)/i.test(f))add(path.dirname(path.join(repo,f)),{file:f,kind:'REPO_DIRECTORY'});
  if(/\.json$/i.test(f)&&/(?:config|settings|current|package)/i.test(path.basename(f)))try{
   const data=JSON.parse(fs.readFileSync(path.join(repo,f),'utf8'));
   const walk=(x,key='$')=>{if(x&&typeof x==='object')for(const [k,v] of Object.entries(x)){if(typeof v==='string'&&path.isAbsolute(v)&&/root|directory|path/i.test(k))add(v,{file:f,key:key+'.'+k,kind:'EXPLICIT_CONFIG_VALUE_NOT_FOLLOWED'});else if(v&&typeof v==='object')walk(v,key+'.'+k);}};walk(data);
  }catch{}
 }
 return {entries:inventory.entries,versionPointers:versions,mapRoots,tests,recordRootCandidates};
}
export function initAudit(repo,out,{limits:given={}}={}){
 repo=path.resolve(repo);out=path.resolve(out);noLinks(repo);checkOutput(out,[repo]);if(fs.existsSync(out))throw Error('CONFIG_EXISTS');
 const limits=limitsOf(given),freeSpace=[];space(path.dirname(out),limits,freeSpace,'init discovery');const b=budget(limits);boundedFiles(repo,b);
 // discover-entries has its own size bound, but no aggregate bound; do not call it on an incomplete population.
 const blocking=b.skipped.filter(s=>!['EXCLUDED_DIRECTORY','SYMLINK_NOT_FOLLOWED'].includes(s.reason));
 const inventory=blocking.length?{entries:[],files:[],skipped:blocking}:discoverEntries(repo);
 const found=candidates(repo,inventory);let head=null;try{head=git(repo,['rev-parse','HEAD']).trim();}catch{}
 const discovery={...found,status:blocking.length?'SKIPPED':'COMPLETED',reason:blocking.length?'INCOMPLETE_DISCOVERY_POPULATION':null,blockedBy:blocking,skipped:[...b.skipped,...inventory.skipped],freeSpace,nextStep:blocking.length?'Discovery was not run because the bounded population is incomplete; empty entries do not establish unsupported registration syntax. Review blockedBy, update limits and fill explicit question anchors/mapRoots before running; or call initAudit(repo,newConfig,{limits}) to repeat discovery with sufficient bounds.':'Review discovered candidates, fill questions and authorize recordRoots before running the audit.'};
 const c={schema:'trace-audit-config-v1',repo,pins:head?{head}:undefined,questions:[],recordRoots:[],writeRoot:path.join(path.dirname(out),'audit-output'),limits,discovery,mapRoots:found.mapRoots};
 const receipt=save(out,c);return {status:'PASS',outputs:[receipt],questionsToFill:true,recordRootsRequireAuthorization:true,discoveryStatus:discovery.status,discoveryReason:discovery.reason,discoveryNextStep:discovery.nextStep};
}
function anchorsFor(question,repo,source,limits){
 const result=[];
 for(const spec of question.anchors??[]){
  const a=typeof spec==='string'?(spec.includes('#')?{file:spec.split('#')[0],symbol:spec.split('#').slice(1).join('#')}:{file:spec}):spec;
  const candidates=a.file?[safeName(a.file)]:source.files.filter(f=>/\.[cm]?[jt]sx?$|\.py$/.test(f.file)).map(f=>f.file);
  let found=false;
  for(const file of candidates){const s=source.files.find(f=>f.file===file);if(!s){result.push({file,symbol:a.symbol,status:'UNKNOWN',reason:'NOT_IN_BOUNDED_SOURCE'});continue;}
   const text=fs.readFileSync(path.join(repo,file),'utf8'),lines=text.split(/\r?\n/);
   const indexes=a.line?[a.line-1]:a.symbol?lines.flatMap((line,i)=>line.includes(a.symbol)?[i]:[]):[0];
   for(const i of indexes){if(i<0||i>=lines.length||a.expect&&!lines[i].includes(a.expect))continue;found=true;result.push({file,line:i+1,symbol:a.symbol??null,status:'PASS',scope:'LITERAL_ANCHOR_ONLY',sha256:s.sha256,expect:lines[i].slice(0,240)});if(result.length>=limits.maxEntries)return result;}
  }
  if(!found)result.push({file:a.file??null,symbol:a.symbol??null,status:'UNKNOWN',reason:'ANCHOR_NOT_FOUND_IN_DISCLOSED_POPULATION'});
 }
 return result;
}
function metrics(data,spec,file){
 return (spec.metrics??[]).filter(m=>!m.file||m.file===file).map(m=>{
  const v=select(data,m.selector);let value=null,reason=null;
  if(m.op==='value'&&['number','string','boolean'].includes(typeof v))value=v;
  else if(m.op==='length'&&Array.isArray(v))value=v.length;
  else if(['sum','distinct'].includes(m.op)&&Array.isArray(v)){
   const xs=v.map(x=>select(x,m.field));
   if(xs.some(x=>x===undefined||x===null))reason='METRIC_FIELD_MISSING';
   else if(m.op==='sum'&&xs.every(x=>typeof x==='number'))value=xs.reduce((n,x)=>n+x,0);
   else if(m.op==='distinct')value=[...new Set(xs.map(x=>JSON.stringify(x)))].map(x=>JSON.parse(x));
   else reason='METRIC_TYPE_MISMATCH';
  }else reason='METRIC_SELECTOR_OR_OPERATION_UNKNOWN';
  return {name:m.name,file,selector:m.selector,op:m.op,field:m.field??null,value,status:reason?'UNKNOWN':'PASS',reason};
 });
}
function recordsFor(spec,roots,out,limits,sourceReads,commands){
 const root=roots.find(r=>r.label===(spec.root??spec.label));if(!root)return {status:'UNKNOWN',gaps:[{code:'UNAUTHORIZED_RECORD_ROOT',label:spec.root??spec.label}],metrics:[]};
 if(!fs.existsSync(root.path))return {status:'UNKNOWN',root,gaps:[{code:'RECORD_ROOT_MISSING',path:root.path}],metrics:[]};
 space(out,limits,commands.freeSpace,'record inventory');const b=budget(limits),files=boundedFiles(root.path,b),gaps=[...b.skipped],measurements=[],parsed=[];let unitCount=0;
 const patterns=spec.files??null;
 const selected=files.filter(f=>/\.jsonl?$/i.test(f.file)&&(!patterns||patterns.includes(f.file)));
 if(patterns)for(const file of patterns){safeName(file);if(!selected.some(f=>f.file===file))gaps.push({code:'RECORD_FILE_MISSING_OR_SKIPPED',file});}
 for(const f of selected){
  const before=fs.statSync(f.path),bytes=fs.readFileSync(f.path),text=bytes.toString('utf8').replace(/^\ufeff/,'');sourceReads.set(f.path,{path:f.path,sha256:digest(bytes)});
  const units=[];let format;
  try{const d=JSON.parse(text);format='JSON';measurements.push(...metrics(d,spec,f.file));const v=spec.items?select(d,spec.items):d;if(Array.isArray(v))v.forEach((value,index)=>units.push({value,locator:'$['+index+']'}));else units.push({value:v,locator:'$'});}
  catch(e){format='JSONL';for(const [i,line] of text.split(/\r?\n/).entries())if(line.trim())try{units.push({value:JSON.parse(line),locator:'line '+(i+1)});}catch(error){gaps.push({code:'RECORD_PARSE',file:f.file,line:i+1,message:error.message});}}
  const after=fs.statSync(f.path);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('RECORD_CHANGED_DURING_READ');
  const values=[];
  for(const u of units){if(unitCount>=limits.maxRecords){gaps.push({code:'MAX_RECORDS',file:f.file,locator:u.locator});continue;}unitCount++;if(!u.value||typeof u.value!=='object'||Array.isArray(u.value)){gaps.push({code:'NON_OBJECT_RECORD',file:f.file,locator:u.locator});continue;}values.push(u.value);}
  const dir=path.join(out,'records','r'+parsed.length);fs.mkdirSync(dir,{recursive:true});save(path.join(dir,'marker.json'),{source:f.path,sha256:digest(bytes),format});save(path.join(dir,'events.jsonl'),values.map(v=>JSON.stringify(v)).join('\n')+'\n');
  parsed.push({file:f.file,path:f.path,format,sha256:digest(bytes),units:values.length,locators:units.slice(0,values.length).map(u=>u.locator)});
 }
 if(!selected.length)gaps.push({code:'NO_SELECTED_RECORD_FILES'});
 const cfg={root:path.join(out,'records'),recordPattern:'(?:^|/)marker[.]json$',eventsDirectory:'.',eventFilePattern:'^events[.]jsonl$',mode:'jsonl',typeKey:spec.kindField??'kind',crossFields:spec.fields,trigger:spec.trigger??(spec.kind?{[spec.kindField??'kind']:spec.kind}:undefined),retainEvents:false};
 fs.mkdirSync(cfg.root,{recursive:true});const c=census(cfg);save(path.join(out,'census-config.json'),cfg);save(path.join(out,'census.json'),c);
 commands.push({step:'record-census',command:[process.execPath,path.join(here,'record-census.mjs'),'--config',path.join(out,'census-config.json')],exitCode:null,invocation:'IMPORTED_FUNCTION',resultStatus:c.status});
 return {status:gaps.length||c.gaps.length?'UNKNOWN':'PASS',root,files:parsed,metrics:measurements,totals:c.totals,kindCounts:c.typeCounts,crossCounts:c.crossCounts,gaps:[...gaps,...c.gaps],census:path.join(out,'census.json'),population:'Retained parsed objects, not unique executions; labels and historical code binding are unverified.'};
}

const importEdge=e=>['STATIC_IMPORT','DYNAMIC_IMPORT'].includes(e.kind)&&!e.resolutionOnly;
const importKey=e=>JSON.stringify([e.kind,e.path,e.line,e.specifier,e.targets]);
function mergeDeletionImports(result,map,mapSource,question,source){
 const edges=[...new Map([...(map?.closures??[]).flatMap(c=>c.edges??[]),...(map?.incomingImports?.edges??[])].filter(importEdge).map(e=>[importKey(e),e])).values()];
 const allImports=new Set(),allTests=new Set((question.tests??[]).filter(f=>source.files.some(s=>s.file===f))),retained=new Set();let strings=0;
 for(const item of result.items){
  item.imports=edges.filter(e=>e.targets?.includes(item.path)).map(e=>({...e,isTest:testName(e.path)})).sort((a,b)=>a.path.localeCompare(b.path)||a.line-b.line);
  const spans=[];
  for(const e of item.imports){
   if(!/\.(?:[cm]?[jt]sx?|mts|cts|gs)$/.test(e.path))continue;
   const body=fs.readFileSync(path.join(result.repo,e.path),'utf8'),t=tokens(body,false,{regexLiterals:true});
   const starts=t.flatMap((a,i)=>a.line===e.line&&a.kind==='name'&&['import','export','require','module'].includes(a.v)?[i]:[]);
   let found=false;for(const start of starts){for(let k=start;k<t.length&&t[k].v!==';';k++)if(t[k].kind==='string'&&t[k].v===e.specifier){
    const a=t[k],lineStart=body.lastIndexOf('\n',a.start-1)+1,column=body.slice(lineStart,a.start).replace(/\\+/g,'/').length+1;
    spans.push({file:e.path,line:a.line,start:column,end:column+body.slice(a.start,a.end).replace(/\\+/g,'/').length});found=true;break;
   }if(found)break;}
  }
  item.stringReferences=Object.fromEntries(Object.entries(item.repo).map(([kind,refs])=>[kind,refs.map(ref=>{const locations=ref.locations.filter(a=>!spans.some(s=>s.file===a.file&&s.line===a.line&&a.column>=s.start&&a.column<s.end));return {...ref,count:locations.length,locations,anchors:locations.slice(0,3)};}).filter(ref=>ref.count)]));
  item.importEvidence={status:!map?'MAP_UNAVAILABLE':item.imports.length?'FOUND':'NO_MAP_EDGE',map:mapSource,scope:map?.incomingImports?.scope??'Selected map closures only; callers outside those closures are not measured.',scannedFiles:map?.incomingImports?.scannedFiles.length??null,gapCount:map?.incomingImports?.gaps.length??null,...(!map?{reason:'No same-run map is available; literal references alone cannot measure importers.'}:!item.imports.length?{reason:'No import or require edge to this target was found in the same-run map; absence is not deletion evidence.'}:{})};
  const programs=new Set(item.imports.filter(e=>!e.isTest).map(e=>e.path)),tests=new Set(item.imports.filter(e=>e.isTest).map(e=>e.path));
  let occurrences=0;for(const refs of Object.values(item.stringReferences))for(const ref of refs){occurrences+=ref.count;if(testName(ref.file))tests.add(ref.file);}
  const files=new Set();for(const group of item.retained)for(const f of group.files){const key=group.root+'\0'+f.file;files.add(key);retained.add(key);}
  item.summary={programImports:programs.size,stringReferences:occurrences,tests:tests.size,retainedFiles:files.size};
  for(const f of programs)allImports.add(f);for(const f of tests)allTests.add(f);strings+=occurrences;
 }
 // Literal occurrences are counted once per target; file counts deduplicate across targets.
 result.summary={programImports:allImports.size,stringReferences:strings,tests:allTests.size,retainedFiles:retained.size};
}
function deletionSummary(s){return '被 '+s.programImports+' 個程式 import、'+s.stringReferences+' 處字串引用、'+s.tests+' 個測試、留存物 '+s.retainedFiles+' 檔';}

export function auditVerdict(q){
 const runs=q.tests??[],failed=runs.filter(r=>r.classification?.productFailures>0||r.classification?.rows?.length>0);
 if(failed.length)return {verdict:'FAIL',basis:'OBSERVED_TEST_FAILURE',scope:'Specified existing tests only; environment denials are reported separately.'};
 const gaps=q.gaps??[];
 if(runs.length&&runs.every(r=>r.exitCode===0&&r.classification?.passed>0&&!r.classification.cancelled&&!r.classification.denialEvents&&r.summaryFail===0)&&!gaps.length&&(q.anchors??[]).every(a=>a.status==='PASS')&&(q.records??[]).every(r=>r.status==='PASS')&&!q.deletion)return {verdict:'PASS',basis:'EXECUTED_TEST_ASSERTIONS',scope:'Specified test assertions only; does not certify the natural-language claim or real use.'};
 if(!runs.length&&(q.anchors??[]).length&&(q.anchors??[]).every(a=>a.status==='PASS')&&(q.records??[]).length&&(q.records??[]).every(r=>r.totals?.triggerEvents===0&&r.gaps.every(g=>['CODE_BINDING_UNKNOWN','RECORDED_VERSION_UNKNOWN'].includes(g.kind??g.code)))&&!gaps.length)return {verdict:'\u53ea\u5b58\u5728\u6c92\u89f8\u767c',basis:'ZERO_DECLARED_TRIGGER_IN_DISCLOSED_POPULATION',scope:'Not observed in the disclosed retained population; not proof of global non-use.'};
 return {verdict:'UNKNOWN',basis:'INSUFFICIENT_MACHINE_EXECUTION_EVIDENCE',scope:'Counts, static maps, anchors, exit zero and hashes alone do not establish operation.'};
}
const md=s=>String(s??'').replaceAll('|','\\|').replace(/\r?\n/g,' ');
export function renderAudit(card){
 let s='# \u6574\u8f2a\u67e5\u7dda\u5361\n\n'+`repo: ${md(card.repo)}\n\nHEAD: ${card.head}\n\n`+'\u8b49\u64da\u7b49\u7d1a\uff1a\u771f\u5be6\u4f7f\u7528 > AGENT_DRIVEN_STUBBED > \u6e2c\u8a66\u8dd1\u904e > \u53ea\u6709\u975c\u614b\u3002\u7559\u5b58\u8a08\u6578\u4e0d\u8b49\u660e\u73fe\u7248\u6b63\u5728\u904b\u4f5c\u3002\n\n';
 if(card.mapDiagnostics){const d=card.mapDiagnostics;s+='## 依賴圖診斷\n\n'+md(d.status)+': '+md(d.basis)+'\n\n';
  s+='來源：'+md(JSON.stringify(d.source))+'\n\n上限：'+md(JSON.stringify(d.limits))+'\n\n已選根：'+md(d.selectedRoots.join('; ')||'NONE')+'\n\n';
  s+=d.artifact?'map：'+md(d.artifact.path)+'; SHA-256='+md(d.artifact.sha256)+'; readOnly='+md(d.readOnly?.status)+'\n\n':'map：未產生或未通過讀回驗證。\n\n';
  for(const g of d.gaps.slice(0,20))s+='- '+md(JSON.stringify(g))+'\n';
  if(d.gaps.length>20)s+='- omitted map gaps: '+(d.gaps.length-20)+'; see audit.json mapDiagnostics.gaps\n';
  s+='\n下一步：'+md(d.nextStep)+'\n\n'+md(d.scope)+'\n\n';
 }
 s+='| id | \u554f\u984c | \u5224\u5b9a | \u8b49\u64da |\n|---|---|---|---|\n'+card.questions.map(q=>`| ${md(q.id)} | ${md(q.ask)} | ${q.verdict} | ${md(q.evidenceLevel)} |`).join('\n')+'\n';
 for(const q of card.questions){s+=`\n## ${md(q.id)}: ${md(q.ask)}\n\n${q.deletion?deletionSummary(q.deletion.summary)+(q.deletion.summaryStatus?' ('+q.deletion.summaryStatus+': observed counts only)':'')+'\n\n':''}${q.verdict}: ${md(q.basis)}\n\n${md(q.scope)}\n\n`;
  s+='\u9328\u9ede\uff1a'+(q.anchors.slice(0,20).map(a=>`${a.file??a.symbol}:${a.line??'UNKNOWN'} ${a.status}`).join('; ')||'UNKNOWN')+(q.anchors.length>20?'; omitted='+(q.anchors.length-20):'')+'\n\n';
  for(const t of q.tests)s+=`- test ${md(t.file)}: exit=${t.exitCode}; pass=${t.classification?.passed}; fail=${t.summaryFail}; denied=${t.classification?.denialEvents}; evidence=${md(t.resultFile)}\n`;
  for(const r of q.records)s+=`\n- records ${md(r.root?.label)}: ${md(JSON.stringify(r.totals??null))}; kinds=${md(JSON.stringify(r.kindCounts??null))}; gaps=${r.gaps.length}\n`+r.metrics.map(m=>`- ${md(m.name)}: ${md(JSON.stringify(m.value))} (${m.status}); ${md(m.file)}#${md(m.selector)}\n`).join('');
  if(q.deletion){s+=`\n- deletion: ${md(q.deletion.status)}; ${md(JSON.stringify(q.deletion.stats))}; ${md(q.deletion.artifact)}\n`;
   s+='- source paths: '+md(JSON.stringify(q.deletion.targets))+'\n';
   for(const item of q.deletion.items??[]){
    s+='- '+md(item.path)+' import evidence: '+md(item.importEvidence?.status)+'; '+md(item.importEvidence?.reason??item.importEvidence?.scope)+'\n';
    for(const ref of item.imports??[])s+='- '+(ref.isTest?'\u6e2c\u8a66 import':'\u7a0b\u5f0f import')+' '+md(ref.path)+':'+ref.line+' ('+md(ref.operation??ref.kind)+', '+md(ref.specifier)+')\n';
    for(const [kind,refs] of Object.entries(item.stringReferences??item.repo??{})){for(const ref of refs.slice(0,20))s+=`- ${md(kind)} ${md(ref.file)} (${ref.count}): ${md((ref.anchors??[]).slice(0,3).map(a=>a.file+':'+a.line).join('; '))}\n`;if(refs.length>20)s+='- omitted '+kind+' groups: '+(refs.length-20)+'\n';}
    for(const r of item.retained??[])s+=`- retained ${md(r.label)}: ${r.fileCount} files; ${md(r.files.slice(0,3).map(f=>f.file+':'+(f.anchors?.[0]?.line??'UNKNOWN')).join('; '))}; omitted files=${Math.max(0,r.fileCount-3)}\n`;
   }
  }
  s+='\n\u6bcd\u9ad4\u8207\u7f3a\u53e3\uff1a'+md(JSON.stringify({population:q.population,gaps:q.gaps.slice(0,20),omittedGaps:Math.max(0,q.gaps.length-20),recordGaps:q.records.map(r=>({label:r.root?.label,gaps:r.gaps.slice(0,20),omittedGaps:Math.max(0,r.gaps.length-20)}))}))+'\n\n';
  s+='\u4e0b\u4e00\u6b65\uff1a'+md(q.nextStep)+'\n';
 }
 s+='\n## \u6307\u4ee4\u8207\u7565\u904e\n\n'+card.commands.map(c=>'- '+md(JSON.stringify(c))).join('\n')+'\n\n'+md(JSON.stringify(card.skipped))+'\n\n[\u5b8c\u6574\u8b49\u64da](audit.json)\n';return s;
}
export async function runAudit(configFile){
 const started=Date.now(),absolute=path.resolve(configFile),raw=fs.readFileSync(absolute),c=JSON.parse(raw),repo=path.resolve(c.repo??''),writeRoot=path.resolve(c.writeRoot??'');
 if(!path.isAbsolute(c.repo??'')||!path.isAbsolute(c.writeRoot??''))throw Error('ABSOLUTE_REPO_AND_WRITE_ROOT_REQUIRED');
 const limits=limitsOf(c.limits),roots=(c.recordRoots??[]).map(r=>{if(!r.label||!path.isAbsolute(r.path??''))throw Error('LABELED_ABSOLUTE_RECORD_ROOT_REQUIRED');return {...r,path:path.resolve(r.path)};});
 if(new Set(roots.map(r=>r.label)).size!==roots.length)throw Error('DUPLICATE_RECORD_ROOT_LABEL');
 noLinks(repo);for(const r of roots)noLinks(r.path);checkOutput(writeRoot,[repo,...roots.map(r=>r.path)],[absolute]);if(inside(writeRoot,absolute))throw Error('CONFIG_INSIDE_OUTPUT');
 if(!Array.isArray(c.questions)||!c.questions.length)throw Error('QUESTIONS_REQUIRED');
 const ids=new Set();for(const q of c.questions){if(!/^[A-Za-z0-9_-]+$/.test(q.id??'')||ids.has(q.id)||typeof q.ask!=='string'||!q.ask.trim())throw Error('UNIQUE_ID_AND_ASK_REQUIRED');ids.add(q.id);for(const f of q.tests??[])safeName(f);for(const f of q.deletePaths??[])safeName(f);}
 for(const f of ['audit.json','audit.md'])if(fs.existsSync(path.join(writeRoot,f)))throw Error('OUTPUT_EXISTS: '+f);
 const freeSpace=[];space(path.dirname(writeRoot),limits,freeSpace,'source snapshot');const source=snapshot(repo,limits);
 if(c.pins?.head&&source.head!==c.pins.head)throw Error('SOURCE_PIN_MISMATCH');
 for(const p of c.pins?.files??[]){safeName(p.path);if(source.files.find(f=>f.file===p.path)?.sha256!==p.sha256)throw Error('SOURCE_FILE_PIN_MISMATCH');}
 fs.mkdirSync(writeRoot,{recursive:true});const runRoot=fs.mkdtempSync(path.join(writeRoot,'run-')),commands=[];commands.freeSpace=freeSpace;
 const card={schema:'trace-audit-v1',repo,head:source.head,configurationSha256:digest(raw),startedAt:new Date(started).toISOString(),questions:[],commands,skipped:[...source.skipped],freeSpace,readOnly:null,limitations:['API hooks are not an OS sandbox; native code, worker threads and detached processes are not fully covered.','Retained counts are not unique events, historical code binding, semantic correctness or business acceptance.','No dependencies installed. Only explicitly named existing Node test files are executable in this orchestrator.']};
 const sourceReads=new Map(),testRuns=[];const before=save(path.join(runRoot,'source-before.json'),source);
 const versionFiles=c.discovery?.versionPointers??source.files.filter(f=>/(?:^|\/)(?:package\.json|SKILL\.md|current\.json)$/.test(f.file)).map(f=>f.file);
 const hops=versionFiles.filter(f=>f.endsWith('package.json')||f.endsWith('SKILL.md')).slice(0,limits.maxMapRoots).map((f,i)=>({id:'version-'+i,file:path.join(repo,safeName(f)),...(f.endsWith('SKILL.md')?{format:'text',regex:'^version:\\s*(.+)$'}:{key:'version'})}));
 card.version=versionChain({allowedRoots:[repo,...roots.map(r=>r.path)],hops,...c.versionChain});save(path.join(runRoot,'version-chain.json'),card.version);commands.push({step:'version-chain',invocation:'IMPORTED_FUNCTION',exitCode:null,resultStatus:card.version.status});
 let mapFile=null,map=null,mapSource=null;
 const questionAnchors=new Map(c.questions.map(q=>[q.id,anchorsFor(q,repo,source,limits)]));
 const questionCandidates=c.questions.flatMap(q=>[...questionAnchors.get(q.id).filter(a=>a.status==='PASS'&&a.file).map(a=>({path:a.file,reason:'resolved question anchor'})),...(q.deletePaths??[]).map(path=>({path,reason:'deletion candidate'})),...(q.anchors??[]).map(a=>({path:typeof a==='string'?a.split('#')[0]:a.file,reason:'question anchor'})),...(q.tests??[]).map(path=>({path,reason:'specified existing test'}))]);
  const configuredRoots=(c.mapRoots??[]).map(r=>typeof r==='string'?{path:r}:r);
  const selectRoots=values=>[...new Map(values.filter(r=>r?.path&&rel(r.path)&&source.files.some(f=>f.file===r.path)).map(r=>[r.path,{...r,reason:r.reason??'caller-selected root'}])).values()];
  const questionRoots=selectRoots(questionCandidates),required=new Set(questionRoots.map(r=>r.path)),otherRoots=selectRoots(configuredRoots).filter(r=>!required.has(r.path));
 const remaining=Math.max(0,limits.maxMapRoots-questionRoots.length),selectedRoots=[...questionRoots,...otherRoots.slice(0,remaining)];
 card.mapSelection={questionRoots,selectedRoots,omittedRoots:otherRoots.slice(remaining),maxMapRoots:limits.maxMapRoots,policy:'All available question roots first; only remaining entry roots are limited.'};
 card.skipped.push(...otherRoots.slice(remaining).map(r=>({...r,reason:'MAX_MAP_ROOTS'})));
 card.skipped.push(...questionCandidates.filter(r=>r.path&&!required.has(r.path)).map(r=>({...r,reason:'QUESTION_ROOT_NOT_IN_BOUNDED_SOURCE'})));
  const unavailableRoots=[...new Map([...questionCandidates,...configuredRoots].filter(r=>!r?.path||!rel(r.path)||!source.files.some(f=>f.file===r.path)).map(r=>[JSON.stringify(r?.path??null),{code:!r?.path||!rel(r.path)?'REPO_RELATIVE_MAP_ROOT_REQUIRED':'MAP_ROOT_NOT_IN_BOUNDED_SOURCE',path:r?.path??null}])).values()];
  const mapGaps=[...source.skipped.map(g=>({code:'SOURCE_BUDGET',...g})),...(source.status?[{code:'DIRTY_SOURCE',porcelain:source.status}]:[]),...unavailableRoots,...(!selectedRoots.length?[{code:'NO_SELECTED_MAP_ROOTS'}]:[])];
  const remedies=[...(source.skipped.length?['Restore the complete Git-tracked population by raising the required limits listed with skipped files; mapping and tests stay disabled until the population is complete.']:[]),...(source.status?['Use an authorized clean checkout of the pinned commit after reviewing and preserving local changes.']:[]),...(!selectedRoots.length?['Provide mapRoots as repository-relative strings or {path,reason} objects, or valid question anchors/tests/deletePaths present in the Git-tracked source.']:[])];
  card.mapDiagnostics={status:'UNKNOWN',basis:source.skipped.length?'INCOMPLETE_SOURCE':source.status?'DIRTY_SOURCE':selectedRoots.length?'MAP_NOT_RUN':'NO_SELECTED_MAP_ROOTS',artifact:null,readOnly:null,source:{files:source.files.length,bytes:source.bytes,skippedFiles:source.skipped.length,dirty:!!source.status},limits:{maxFiles:limits.maxFiles,maxFileBytes:limits.maxFileBytes,maxTotalBytes:limits.maxTotalBytes,maxMapRoots:limits.maxMapRoots,timeoutMs:limits.timeoutMs},selectedRoots:selectedRoots.map(r=>r.path),gaps:mapGaps,nextStep:remedies.length?remedies.join(' ')+' Rerun with a new writeRoot.':'Inspect the same-run derive-map result.',scope:'Map artifact integrity and read-only checks only; static maps do not establish runtime operation.'};
  if(source.skipped.length||source.status)card.skipped.push({step:'derive-map',reason:'INCOMPLETE_OR_DIRTY_SOURCE'});
 else if(selectedRoots.length){
  const temp=path.join(runRoot,'map-temp');fs.mkdirSync(path.join(temp,'scratch'),{recursive:true});
  const cfg={repo,temp,scratch:path.join(temp,'scratch'),protectedRoots:roots.map(r=>r.path),roots:selectedRoots,importTargets:[...new Set(c.questions.flatMap(q=>q.deletePaths??[]))],classification:{rules:[{name:'tests',pattern:'(?:^|/)tests?/|[.]test[.]'},{name:'docs',pattern:'[.]md$'}],fallback:'source'}};
  const cfgFile=path.join(runRoot,'map-config.json');save(cfgFile,cfg);mapFile=path.join(runRoot,'map.json');space(writeRoot,limits,freeSpace,'derive-map');
  const r=spawnSync(process.execPath,[path.join(here,'derive-map.mjs'),'--config',cfgFile,'--out',mapFile],{encoding:'utf8',windowsHide:true,timeout:limits.timeoutMs,maxBuffer:32*1024*1024,env:{...process.env,TEMP:temp,TMP:temp,GIT_OPTIONAL_LOCKS:'0'}});
   const invocation={step:'derive-map',command:[process.execPath,path.join(here,'derive-map.mjs'),'--config',cfgFile,'--out',mapFile],exitCode:r.status,stderr:r.stderr,error:r.error?.message};commands.push(invocation);if(r.status!==0){card.skipped.push({step:'derive-map',reason:r.error?.message??r.stderr});card.mapDiagnostics.basis='DERIVE_MAP_FAILED';card.mapDiagnostics.gaps.push({code:'DERIVE_MAP_FAILED',...invocation});card.mapDiagnostics.nextStep='Inspect the recorded derive-map command, exit code, stderr and error; repair the disclosed cause and rerun with a new writeRoot. No map was accepted.';mapFile=null;}
 }
  if(mapFile){const bytes=fs.readFileSync(mapFile);map=JSON.parse(bytes);if(path.resolve(map.repo)!==repo||map.head!==source.head||map.readOnly?.status!=='PASS')throw Error('MAP_INTEGRITY_FAILURE_STOP');mapSource={path:mapFile,sha256:digest(bytes)};Object.assign(card.mapDiagnostics,{status:'PASS',basis:'SAME_RUN_MAP_READBACK',artifact:mapSource,readOnly:map.readOnly,nextStep:'Inspect the disclosed static map, then bind operation questions to explicit tests or runtime receipts; map integrity alone does not change question verdicts.'});}
 for(const q of c.questions.slice(0,limits.maxQuestions)){
  const qRoot=path.join(runRoot,q.id);fs.mkdirSync(qRoot);const row={id:q.id,ask:q.ask,anchors:questionAnchors.get(q.id),tests:[],records:[],gaps:[],population:{sourceFiles:source.files.length,sourceSkipped:source.skipped.length,recordRoots:roots.map(r=>({path:r.path,label:r.label}))}};
  for(const [i,spec] of (q.records??[]).entries()){const out=path.join(qRoot,'record-'+i);fs.mkdirSync(out);try{row.records.push(recordsFor(spec,roots,out,limits,sourceReads,commands));}catch(e){if(/CHANGED|LOW_SPACE/.test(e.message))throw e;row.records.push({status:'UNKNOWN',metrics:[],gaps:[{code:'RECORD_OPERATION_FAILED',message:e.message}]});}}
  if(q.deletePaths?.length){space(writeRoot,limits,freeSpace,'deletion-impact');const cfg={repo,paths:q.deletePaths,retainedRoots:roots,limits:{maxFileBytes:limits.maxFileBytes,maxTotalBytes:limits.maxTotalBytes,maxFiles:limits.maxFiles,maxEntries:limits.maxEntries,maxMatches:limits.maxRecords}};const r=deletionImpact(cfg);mergeDeletionImports(r,map,mapSource,q,source);const artifact=path.join(qRoot,'deletion-impact.json');save(artifact,r);row.deletion={status:r.status,stats:r.stats,items:r.items,summary:r.summary,mapSource,artifact,targets:q.deletePaths.map(file=>({file,presentInSourceSnapshot:source.files.some(f=>f.file===file),populationComplete:source.skipped.length===0}))};commands.push({step:'deletion-impact',invocation:'IMPORTED_FUNCTION',exitCode:null,resultStatus:r.status,config:cfg});}
  if((q.tests??[]).length&&(source.skipped.length||source.status))row.gaps.push({code:'TESTS_NOT_RUN_INCOMPLETE_OR_DIRTY_SOURCE'});
  else for(const [i,file] of (q.tests??[]).slice(0,limits.maxTests).entries()){
   if(!source.files.some(f=>f.file===file)||!testName(file)||! /\.[cm]?js$/.test(file)){row.gaps.push({code:'EXISTING_NODE_TEST_REQUIRED',file});continue;}
   space(writeRoot,limits,freeSpace,'isolated test copy');const area=path.join(qRoot,'test-'+i),clone=path.join(area,'clone'),temp=path.join(area,'temp');fs.mkdirSync(clone,{recursive:true});fs.mkdirSync(temp);
   try{
    for(const f of source.files){const to=path.join(clone,f.file);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(repo,f.file),to);if(digest(fs.readFileSync(to))!==f.sha256)throw Error('COPY_INTEGRITY_FAILURE');}
    const output=path.join(temp,'execution');space(writeRoot,limits,freeSpace,'isolated test execution');
    const command=[process.execPath,'--test','--test-reporter=tap',path.join(clone,file)],cfg={clone,cwd:clone,tempRoot:temp,isolationRoot:path.join(temp,'home'),outputDirectory:output,resolvedWriteRoots:[clone,temp],command,boundaries:[],executables:[process.execPath],stopOnDeniedRoots:[repo,...roots.map(r=>r.path)],timeoutMs:limits.timeoutMs};
    save(path.join(area,'test-config.json'),cfg);const r=await runOnce(cfg,{enable:true});
    const classification=classifyTests(r.target.stdout,r.target.stderr,r.target.summary.denied),summaryFail=Number(r.target.stdout.match(/^# fail (\d+)/m)?.[1]??NaN);
    const item={file,source:{repo,head:source.head,snapshotSha256:source.sha256},command,exitCode:r.target.exitCode,classification,summaryFail:Number.isNaN(summaryFail)?null:summaryFail,stdout:r.target.stdout,stderr:r.target.stderr,cleanup:r.target.summary.cleanup,manifest:r.target.archive,denied:r.target.summary.denied,resultFile:path.join(area,'test-result.json')};
    save(item.resultFile,item);row.tests.push(item);testRuns.push(item);commands.push({step:'existing-test',command,exitCode:item.exitCode,resultFile:item.resultFile});
    if(r.target.summary.denied.some(d=>(d.paths??[]).some(p=>p&&[repo,...roots.map(r=>r.path)].some(root=>inside(root,p)))))throw Error('PROTECTED_WRITE_ATTEMPT_STOP');
   }finally{noLinks(clone);if(!inside(area,clone))throw Error('CLEANUP_ESCAPE');fs.rmSync(clone,{recursive:true,force:true});}
  }
  row.gaps.push(...(q.tests??[]).slice(limits.maxTests).map(file=>({code:'MAX_TESTS',file})));
  Object.assign(row,auditVerdict(row));row.evidenceLevel=row.tests.length?'\u6e2c\u8a66\u8dd1\u904e':row.records.some(r=>r.files?.length)?'\u7559\u5b58\u7d00\u9304\uff08\u6b77\u53f2\u7d81\u5b9a UNKNOWN\uff09':'\u53ea\u6709\u975c\u614b';
   row.nextStep=row.verdict==='FAIL'?'Inspect the observed failing assertions and environment denials; do not change expectations to force PASS.':'Bind the question to explicit tests or runtime receipts; confirm populations, historical versions and domain semantics.';if(row.verdict==='UNKNOWN'&&card.mapDiagnostics.status!=='PASS')row.nextStep=card.mapDiagnostics.nextStep+' '+row.nextStep;card.questions.push(row);
 }
 for(const q of c.questions.slice(limits.maxQuestions))card.questions.push({id:q.id,ask:q.ask,verdict:'UNKNOWN',basis:'MAX_QUESTIONS',scope:'Not run',evidenceLevel:'\u53ea\u6709\u975c\u614b',anchors:[],tests:[],records:[],gaps:[{code:'MAX_QUESTIONS'}],...(q.deletePaths?.length?{deletion:{status:'UNKNOWN',summaryStatus:'NOT_RUN',summary:{programImports:0,stringReferences:0,tests:0,retainedFiles:0},items:[],stats:{},targets:q.deletePaths.map(file=>({file}))}}:{}),nextStep:'Raise the authorized limit and rerun.'});
 const bundle=path.join(runRoot,'test-evidence.json');const bundleReceipt=save(bundle,{schema:'trace-audit-tests-v1',source:{repo,head:source.head,snapshotSha256:source.sha256},runs:testRuns});
 if(mapFile){space(writeRoot,limits,freeSpace,'report with observed tests');const cfg=path.join(runRoot,'report-config.json');save(cfg,{maps:[{path:mapFile,role:'production'}],outDir:path.join(runRoot,'report'),testEvidence:{path:bundle,sha256:bundleReceipt.sha256}});const r=spawnSync(process.execPath,[path.join(here,'report.mjs'),'--config',cfg],{encoding:'utf8',windowsHide:true,timeout:limits.timeoutMs,maxBuffer:32*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});commands.push({step:'report',command:[process.execPath,path.join(here,'report.mjs'),'--config',cfg],exitCode:r.status,stderr:r.stderr});card.report=r.status===0?path.join(runRoot,'report','health.json'):null;}
 space(writeRoot,limits,freeSpace,'source and record integrity readback');const after=snapshot(repo,limits);save(path.join(runRoot,'source-after.json'),after);
 if(source.head!==after.head||source.status!==after.status||source.sha256!==after.sha256)throw Error('SOURCE_INTEGRITY_FAILURE_STOP');
 for(const r of sourceReads.values())if(digest(fs.readFileSync(r.path))!==r.sha256)throw Error('RECORD_INTEGRITY_FAILURE_STOP');
 card.readOnly={status:source.skipped.length?'UNKNOWN':'PASS',before:before.path,after:path.join(runRoot,'source-after.json'),sourceFiles:source.files.length,recordFiles:sourceReads.size,sourceSha256:source.sha256};card.sourceReads=[...sourceReads.values()];card.elapsedMs=Date.now()-started;card.callCount=1;
 card.outputs=[save(path.join(writeRoot,'audit.json'),card),save(path.join(writeRoot,'audit.md'),renderAudit(card))];return card;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const a=process.argv.slice(2);if(a.length===1&&a[0]==='--help')console.log('Usage: node audit.mjs --init <repo> --out <config> | --config <file>');
 else if(a.length===4&&a[0]==='--init'&&a[2]==='--out')console.log(JSON.stringify(initAudit(a[1],a[3])));
 else if(a.length===2&&a[0]==='--config'){const r=await runAudit(a[1]);console.log(JSON.stringify({status:'COMPLETED',questions:r.questions.map(q=>({id:q.id,verdict:q.verdict})),outputs:r.outputs,elapsedMs:r.elapsedMs}));}
 else throw Error('Usage: node audit.mjs --init <repo> --out <config> | --config <file>');
 }catch(e){console.error(JSON.stringify({status:'ERROR',message:e.message}));process.exitCode=1;}
}
