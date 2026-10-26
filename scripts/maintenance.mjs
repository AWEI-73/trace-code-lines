import {displayGroups,renderGroups} from './display-groups.mjs';
import {stopMaintenanceItems,renderStopComparison} from './stop-sites.mjs';
import {failureRows,clusterFailures,relativeCommand,projectSite} from './maintenance-failures.mjs';
// Source-bound maintenance model. No target code is imported or executed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readBounded,noLinks,sha256} from './walker.mjs';
import {tokens,writerCandidates,localFunctions} from './language-static.mjs';

export const markNames={broken:'\u58de\u4e86',handling:'\u8981\u8655\u7406',unsure:'\u4e0d\u78ba\u5b9a',fine:'\u6c92\u554f\u984c'};
export const runNames={ran:'\u8dd1\u904e',tests:'\u53ea\u6709\u6e2c\u8a66\u8dd1\u904e',read:'\u53ea\u8b80\u904e\u7a0b\u5f0f',unknown:'\u4e0d\u77e5\u9053'};
const unique=xs=>[...new Set(xs)],dedup=(xs,key)=>[...new Map(xs.map(x=>[key(x),x])).values()];
const safe=p=>typeof p==='string'&&p!=='.'&&!path.posix.isAbsolute(p)&&!p.split('/').includes('..')&&!/[\\:\0]/.test(p);
const site=x=>[x.file,x.line];
const nonempty=x=>typeof x==='string'&&!!x.trim();
const relative=(root,p)=>{const r=path.relative(root,p).replaceAll('\\','/');return safe(r)?r:null;};
const testFile=p=>/(?:^|\/)(?:tests?|__tests__)\/.*\.(?:[cm]?js|tsx?|py)$|\.(?:test|spec)\.[cm]?[jt]s$/.test(p);

// Shared source location is exact reference line or exact common writer set.
// Never merge neighboring lines merely because their descriptions look alike.
export function groupMaintenance(r,read=file=>readBounded(r.repo,file).toString('utf8')){
 const groups=new Map();
 for(const f of r.issues??[]){
  const targetBlock=r.blocks?.find(b=>b.files.includes(f.target));
  const target=targetBlock?.id??('file:'+f.target);
  const origins=f.category==='generated'&&f.witnesses?.some(w=>Number.isInteger(w.line))?f.witnesses.filter(w=>Number.isInteger(w.line)):f.locations??[{file:f.file,line:f.line}];
  for(const origin of origins){
   const key=JSON.stringify([f.category,origin.file,origin.line??null,target]);
   if(!groups.has(key))groups.set(key,{id:'repair-'+sha256(key).slice(0,16),cause:{category:f.category,file:origin.file,line:origin.line??null,targetBlock:target},items:[],locations:[]});
   const g=groups.get(key);g.items.push(f);g.locations.push(...(f.category==='generated'?f.locations??[f]:[origin]).map(s=>({file:s.file,line:s.line,target:f.target})));
  }
 }
 // Bounded same-file assignment provenance: top-level JS statements only.
 // Union only reads reaching a common literal writer, within the same target
 // block and category. Unknown expressions/functions retain exact-site groups.
 const list=[...groups.values()],cache=new Map();
 function writersFor(file){
  if(cache.has(file))return cache.get(file);
  const result=new Map();cache.set(file,result);
  try{
   if(!/\.[cm]?js$/.test(file))return result;
   const body=String(read(file)),ts=tokens(body,false,{regexLiterals:true}),funcs=localFunctions(ts,body,false);
   const insideFunction=i=>funcs.some(f=>i>=f.start&&i<=f.end);
   const assignments=[];
   for(let i=0;i<ts.length-2;i++)if(ts[i].kind==='name'&&(ts[i+1]?.v==='='&&!['=','>'].includes(ts[i+2]?.v)||ts[i+1]?.v==='+'&&ts[i+2]?.v==='=')&&!insideFunction(i)&&!['.','['].includes(ts[i-1]?.v)){
    let end=i+2;while(end<ts.length&&ts[end].v!==';')end++;
    if(end>=ts.length)continue;
    assignments.push({name:ts[i].v,start:ts[i].line,end:ts[end].line,names:unique(ts.slice(i+2,end).filter(t=>t.kind==='name').map(t=>t.v))});i=end;
   }
   const origins=list.filter(g=>g.cause.file===file&&g.cause.category==='nonproduction').flatMap(g=>g.locations.map(x=>x.line));
   const deps=new Map();for(const a of assignments){if(!deps.has(a.name))deps.set(a.name,new Set());for(const n of origins)if(n>=a.start&&n<=a.end)deps.get(a.name).add(n);}
   for(let pass=0;pass<assignments.length;pass++){let changed=false;for(const a of assignments)for(const name of a.names)for(const n of deps.get(name)??[])if(!deps.get(a.name).has(n)){deps.get(a.name).add(n);changed=true;}if(!changed)break;}
   for(const w of writerCandidates(file,body).filter(w=>w.literalTarget)){
    const names=ts.filter(t=>t.line===w.line&&t.kind==='name').map(t=>t.v);
    for(const n of unique(names.flatMap(name=>[...(deps.get(name)??[])]))){if(!result.has(n))result.set(n,[]);result.get(n).push({file,line:w.line,target:w.literalTarget});}
   }
  }catch{}return result;
 }
 for(const g of list)g.mergeWriters=g.cause.category==='nonproduction'?dedup(g.locations.flatMap(x=>writersFor(x.file).get(x.line)??[]),x=>JSON.stringify(x)):[];
 for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
  const a=list[i],b=list[j];if(a.cause.category!==b.cause.category||a.cause.file!==b.cause.file||a.cause.targetBlock!==b.cause.targetBlock)continue;
  if(!a.mergeWriters.some(w=>b.mergeWriters.some(v=>JSON.stringify(v)===JSON.stringify(w))))continue;
  a.items.push(...b.items);a.locations.push(...b.locations);a.mergeWriters=dedup([...a.mergeWriters,...b.mergeWriters],x=>JSON.stringify(x));list.splice(j--,1);i=-1;break;
 }
 return list.map(g=>({...g,items:dedup(g.items,x=>x.id??JSON.stringify(x)),locations:dedup(g.locations,x=>JSON.stringify(x)),targets:unique(g.items.map(f=>f.target).filter(Boolean)),count:dedup(g.locations,x=>JSON.stringify(x)).length}));
}

export function verifyAnchor(a,read){
 const errors=[];let actual=null;
 if(!a||!safe(a.file)||!Number.isInteger(a.line)||a.line<1||!nonempty(a.expect))errors.push('INVALID_ANCHOR');
 else try{actual=String(read(a.file)).split(/\r?\n/)[a.line-1]??null;if(actual===null||!actual.includes(a.expect))errors.push('ANCHOR_MISMATCH');}catch{errors.push('ANCHOR_UNREADABLE');}
 const intent=errors.length===0&&a.purpose==='intent'&&(/\.(?:md|rst|txt)$/i.test(a.file)||/^\s*(?:\/\/|\/\*|\*|#|<!--)/.test(actual));
 return {...a,status:errors.length?'FAIL':'PASS',errors,actual,intent};
}

function readChecked(ref,base){
 if(!ref||!nonempty(ref.path)||!/^[a-f0-9]{64}$/.test(ref.sha256??''))throw Error('MAINTENANCE_INPUT_HASH_REQUIRED');
 const p=noLinks(path.resolve(base,ref.path)),b=fs.readFileSync(p);if(sha256(b)!==ref.sha256)throw Error('MAINTENANCE_INPUT_INTEGRITY');
 return {file:p,sha256:ref.sha256,value:JSON.parse(b)};
}

// Consume 1.16 water-source reports without changing their format. Recompute
// coverage from the retained raw files; preserve failed and denied test results.
export function loadMaintenanceWater(refs,base,repo){
 const runs=[],inputs=[],evidence=[];
 for(const ref of refs??[]){
  const record=readChecked(ref.report,base),config=readChecked(ref.config,base),snapshot=readChecked(ref.snapshot,base);
  inputs.push(...[record,config,snapshot].map(({file,sha256})=>({file,sha256})));
  const w=record.value,c=config.value;
  if(w.schema!=='water-source-v1'||w.source!==c.source||path.resolve(c.clone)!==path.resolve(repo)||path.resolve(snapshot.value.repo)!==path.resolve(repo))throw Error('WATER_SOURCE_SCOPE_MISMATCH');
  const bindings=new Map((snapshot.value.files??[]).map(f=>[f.path,f.sha256]));
  const bound=new Map();
  const isBound=file=>{if(!bound.has(file)){let ok=false;try{ok=safe(file)&&bindings.get(file)===sha256(readBounded(repo,file));}catch{}bound.set(file,ok);}return bound.get(file);};
  for(const result of w.results??[]){
   const s=c.scenarios?.find(s=>s.id===result.id),attempt=result.observation?result:(result.attempts??[]).find(a=>a.observation);
   if(!attempt?.observation)continue;
   if(!s||attempt.planSha256!==sha256(JSON.stringify(s)))throw Error('WATER_PLAN_MISMATCH');
   const o=attempt.observation,coverage=[],perTest=[],executedSites=[];
   let raw=null,rawBinding=null;
   if(attempt.evidence){const p=noLinks(path.resolve(attempt.evidence)),b=fs.readFileSync(p);raw=JSON.parse(b);rawBinding={file:p,sha256:sha256(b)};inputs.push(rawBinding);}
   const stdout=raw?.target?.stdout??'',stderr=raw?.target?.stderr??'';
   const payload={stdout,stderr,recordedRun:{command:raw?.target?.command??s.command,cwd:repo,source:record.file,rawBinding},observation:o,verdict:attempt.verdict,cleanup:attempt.cleanup};
   const evidenceId='run-'+sha256(JSON.stringify(payload));
   if(!evidence.some(e=>e.id===evidenceId))evidence.push({id:evidenceId,payload});
   let failures=raw?failureRows(stdout,stderr,repo):[];
   if(raw&&!failures.length&&o.exitCode!==0){const rawMessage=(stderr||stdout).trim(),lines=rawMessage.split(/\r?\n/),errorAt=lines.findIndex(l=>/\b(?:[A-Za-z]*Error|Exception)(?:\s*\[|:)/.test(l));const diagnostic=errorAt>=0?lines.slice(errorAt):lines;const stackAt=diagnostic.findIndex(l=>/^\s*at /.test(l));const message=(stackAt>=0?diagnostic.slice(0,stackAt):diagnostic).join('\n').trim();const denied=raw.target?.summary?.denied??[];failures=[{name:result.id,message:message.slice(0,2000)||'Nonzero process exit',first:projectSite(lines.filter(l=>/^\s*at /.test(l)).join('\n'),repo),classification:denied.length?'ENVIRONMENT_DENIED':'PRODUCT_FAILURE'}];}
   if(raw&&!failures.length&&o.exitCode===0)for(const check of attempt.verdict?.checks??[])if(check.status==='FAIL'&&check.expected?.kind==='status')failures.push({name:result.id,message:JSON.stringify({expected:check.expected,actual:check.actual}),classification:'PRODUCT_FAILURE'});
   for(const evidence of o.coverage?.evidence??[]){
    const p=noLinks(path.resolve(evidence.file)),bytes=fs.readFileSync(p);if(sha256(bytes)!==evidence.sha256)throw Error('WATER_COVERAGE_INTEGRITY');
    const raw=JSON.parse(bytes),rows=raw.schema==='python-settrace-v1'?raw.files.map(f=>({file:relative(repo,f.path),positive:f.lines.some(l=>l.count>0)})):(raw.result??[]).filter(x=>x.url?.startsWith('file:')).map(x=>({file:relative(repo,fileURLToPath(x.url)),positive:x.functions.some(f=>f.ranges.some(a=>a.count>0))}));
    const files=unique(rows.filter(x=>x.file&&x.positive&&isBound(x.file)).map(x=>x.file));coverage.push(...files);
    const functionCounts={};
    for(const script of raw.result??[]){
     if(!script.url?.startsWith('file:'))continue;const file=relative(repo,fileURLToPath(script.url));if(!file||!files.includes(file))continue;
     functionCounts[file]=script.functions.filter(f=>f.functionName&&f.ranges[0]?.count>0).length;
     const body=readBounded(repo,file).toString('utf8'),ranges=script.functions.flatMap(f=>f.ranges).sort((a,b)=>(a.endOffset-a.startOffset)-(b.endOffset-b.startOffset));let offset=0;
     for(const [index,line] of body.split('\n').entries()){const first=line.search(/\S/),at=offset+Math.max(0,first),range=ranges.find(r=>at>=r.startOffset&&at<r.endOffset);if(first>=0&&range?.count>0)executedSites.push({file,line:index+1});offset+=line.length+1;}
    }
    const tests=files.filter(testFile);
    const commandSources=[{argv:s.command,cwd:repo},...(o.events??[]).filter(e=>e.kind==='process'&&e.phase==='started'&&e.decision==='ALLOW').map(e=>({argv:e.argv,cwd:e.childCwd??e.cwd??repo}))];
    const normalizeArg=(arg,cwd)=>{if(typeof arg!=='string'||arg.startsWith('-'))return null;return relative(repo,path.resolve(cwd,arg.replaceAll('@CLONE',repo)));};
    const commandFor=test=>{
     const entry=commandSources.find(c=>Array.isArray(c.argv)&&/(?:^@NODE$|(?:^|[\\/])node(?:\.exe)?$)/i.test(c.argv[0])&&c.argv.includes('--test')&&c.argv.slice(1).some(a=>normalizeArg(a,c.cwd)===test));
     if(!entry||path.resolve(entry.cwd)!==path.resolve(repo))return null;
     const args=entry.argv.slice(1).filter(a=>{const p=normalizeArg(a,entry.cwd);return !p||!testFile(p)||p===test;}).map(a=>normalizeArg(a,entry.cwd)===test?test:a.replaceAll('@CLONE',repo));
     const command=relativeCommand(['node',...args],repo);return command?{command,originalCommand:entry.argv}:null;
    };
    // One test entry in a single V8 process is a bounded attribution. Suites
    // with multiple test entries remain unassigned instead of cross-joining.
    if(w.source==='test-recording'&&tests.length===1&&raw.result){
     const test=tests[0],command=commandFor(test);if(command)perTest.push({file:test,...command,coveredFiles:files,functionCounts,evidence:{file:p,sha256:evidence.sha256}});
    }
   }
   const coveredFiles=unique(coverage).sort();
   const writes=(o.writes??[]).filter(x=>x.phase==='success'&&x.snapshotEvidence?.some(s=>s.after?.sha256)).map(x=>({api:x.api,paths:(x.paths??[]).map(p=>relative(repo,p)).filter(Boolean),stack:x.stack??[],evidence:x.evidence,snapshotEvidence:x.snapshotEvidence}));
   runs.push({id:evidenceId+'#'+result.id,evidenceId,scenarioId:result.id,command:relativeCommand(s.command,repo),prerequisites:s.prerequisites??[],failures,source:w.source,status:result.status,exitCode:o.exitCode,cleanup:attempt.cleanup,tests:attempt.tests,coveredFiles,executedSites:dedup(executedSites,x=>JSON.stringify(x)),perTest,writes,coverageEvidence:o.coverage.evidence,sourceBound:coveredFiles.length>0,unboundFiles:(o.coverage.files??[]).filter(f=>!isBound(f))});
  }
 }
 return {provided:(refs??[]).length>0,runs:dedup(runs,r=>r.id),inputs:dedup(inputs,r=>r.file),evidence};
}

export function buildMaintenance(r,{decisions=[],water={provided:false,runs:[]},edges=[],routes=[],rerunPrerequisites=[],read=file=>readBounded(r.repo,file).toString('utf8')}={}){
 const failureGroups=clusterFailures(water.runs??[],r.repo);
 const groups=groupMaintenance(r,read),known=new Set(groups.map(g=>g.id)),seen=new Set();
 for(const d of decisions){if(!known.has(d.id)||seen.has(d.id))throw Error('MAINTENANCE_DECISION_ID');seen.add(d.id);}
 const items=groups.map(g=>{
  const d=decisions.find(x=>x.id===g.id),anchors=(d?.anchors??[]).map(a=>verifyAnchor(a,read));
  const files=unique([g.cause.file,...g.targets,...g.items.flatMap(x=>(x.witnesses??[]).map(w=>w.file))].filter(Boolean));
  const sourceFiles=unique(g.locations.map(x=>x.file));
  const observations=(water.runs??[]).filter(run=>run.sourceBound).flatMap(run=>{const matched=run.coveredFiles.filter(f=>files.includes(f));return matched.length?[{...run,matchedFiles:matched}]:[];});
  const ran=observations.some(x=>x.source==='agent-api'&&x.coveredFiles.includes(g.cause.file)),tested=observations.some(x=>x.source==='test-recording'&&x.coveredFiles.includes(g.cause.file));
  let readable=false;try{read(g.cause.file);readable=true;}catch{}
  const execution=ran?'ran':tested?'tests':readable?'read':'unknown';
  const successful=observations.filter(x=>x.status==='PASS'&&x.exitCode===0&&x.cleanup?.status==='PASS'&&g.locations.every(s=>(x.executedSites??[]).some(p=>p.file===s.file&&p.line===s.line)));
  const relatedFailures=failureGroups.filter(g=>g.failures.some(f=>[f.first,f.location,...(f.stackSites??[])].some(p=>p&&sourceFiles.includes(p.file))));
  const failed=relatedFailures;
  const reasons=[];let mark=d?.mark??'unsure';
  if(!Object.hasOwn(markNames,mark)){mark='unsure';reasons.push('INVALID_MARK');}
  if(!d)reasons.push('AGENT_REVIEW_MISSING');
  if(!anchors.length)reasons.push('ANCHORS_MISSING');else if(anchors.some(a=>a.status!=='PASS'))reasons.push('ANCHOR_CHECK_FAILED');
  if(!nonempty(d?.reason))reasons.push('REASON_MISSING');
  if(mark==='fine'&&!anchors.some(a=>a.intent)&&!successful.length)reasons.push('INTENT_OR_SUCCESSFUL_RUN_MISSING');
  if(mark==='handling'&&!nonempty(d?.risk))reasons.push('RISK_MISSING');
  if(mark==='broken'){
   const missing=g.items.some(x=>x.category==='broken'&&safe(x.target)&&anchors.some(a=>a.status==='PASS'&&(x.locations??[x]).some(s=>s.file===a.file&&s.line===a.line))&&(()=>{try{read(x.target);return false;}catch{return true;}})());
   if(!missing&&!failed.length)reasons.push('FAILURE_EVIDENCE_MISSING');
  }
  const fixes=(d?.fixes??[]).map(f=>({...f,check:verifyAnchor(f,read)}));
  if(['broken','handling'].includes(mark)&&(!fixes.length||fixes.some(f=>!nonempty(f.change)||f.check.status!=='PASS')))reasons.push('REPAIR_LOCATION_MISSING_OR_INVALID');
  if(reasons.length)mark='unsure';
  const confirmedMissing=g.items.filter(x=>x.category==='broken'&&safe(x.target)&&(x.locations??[x]).some(p=>{try{const line=String(read(p.file)).split(/\r?\n/)[p.line-1];return [...line.matchAll(/['"]([^'"\r\n]+)['"]/g)].some(m=>path.posix.normalize(m[1].startsWith('.')?path.posix.join(path.posix.dirname(p.file),m[1]):m[1])===x.target);}catch{return false;}})&&!r.blocks?.some(b=>b.files.includes(x.target)));
  if(confirmedMissing.length){mark='broken';reasons.length=0;for(const x of confirmedMissing)for(const p of x.locations??[x]){const expect=String(read(p.file)).split(/\r?\n/)[p.line-1];const a=verifyAnchor({...p,expect},read);anchors.push(a);if(!fixes.some(f=>f.file===p.file&&f.line===p.line))fixes.push({...p,expect,change:'\u6838\u5c0d\u7f3a\u5c11\u7684\u76ee\u6a19\u8207\u5f15\u7528\u8def\u5f91\uff0c\u4fee\u6b63\u5f15\u7528\u6216\u88dc\u56de\u76ee\u6a19\u3002',check:a});}}
  const affectedRoutes=routes.filter(c=>c.files.some(f=>sourceFiles.includes(f))).map(c=>c.root);
  const repairFiles=unique(fixes.map(f=>f.file));
  const tests=dedup(observations.filter(x=>x.source==='test-recording').flatMap(x=>x.perTest??[]).filter(t=>t.coveredFiles.some(f=>repairFiles.includes(f))),x=>JSON.stringify(x.command));
  tests.sort((a,b)=>repairFiles.reduce((n,f)=>n+(b.functionCounts?.[f]??0)-(a.functionCounts?.[f]??0),0)||a.file.localeCompare(b.file));
  const uncovered=repairFiles.filter(f=>!tests.some(t=>t.coveredFiles.includes(f)));
  const refs=dedup(edges.flatMap(e=>(e.targets??[]).filter(t=>repairFiles.includes(t)).map(target=>({file:e.path,line:e.line??null,target,kind:e.kind}))),x=>JSON.stringify(x));
  return {...g,relatedFailureIds:relatedFailures.map(f=>f.id),missingTargets:confirmedMissing.map(x=>x.target),affectedRoutes,verificationMethod:confirmedMissing.length?'\u4f9d\u4e0b\u5217\u5f15\u7528\u4f4d\u7f6e\u89e3\u6790\u76ee\u6a19\u8def\u5f91\uff0c\u78ba\u8a8d\u6a94\u6848\u5b58\u5728\uff1b\u4fee\u5fa9\u5f8c\u91cd\u8dd1\u53d7\u5f71\u97ff\u5165\u53e3\u7684\u6e2c\u8a66\u3002':'',mark,label:markNames[mark],proposedMark:d?.mark??null,title:confirmedMissing.length?'\u5f15\u7528\u7684\u76ee\u6a19\u7f3a\u5931':d?.title??'',reason:confirmedMissing.length?'\u539f\u78bc\u5f15\u7528\u7684\u76ee\u6a19\u4e0d\u5728\u5feb\u7167\u4e2d\uff0c\u67e5\u7dda\u672a\u627e\u5230\u7522\u751f\u6216\u8f49\u63a5\u4f9d\u64da\u3002':d?.reason??'',risk:d?.risk??'',anchors,anchorStatus:anchors.length&&anchors.every(a=>a.status==='PASS')?'PASS':'UNKNOWN',demotions:reasons,missing:confirmedMissing.length?'':d?.missing??'',execution,executionLabel:runNames[execution],observations:observations.map(o=>({id:o.id,evidenceId:o.evidenceId,source:o.source,matchedFiles:o.matchedFiles,coveredFiles:o.matchedFiles})),fixes,verification:tests.map(t=>({...t,prerequisites:rerunPrerequisites})),uncoveredFiles:uncovered,references:refs};
 });
 for(const g of failureGroups){
  const scenarioFailures=g.failures.filter(f=>f.source==='agent-api').reduce((n,f)=>n+(f.count??1),0),testFailures=g.count-scenarioFailures;
  const f=g.failures[0],first=f.first??f.location??{file:'.',line:null},test=f.location?.file;
  const command=test&&testFile(test)?['node','--test','--test-name-pattern', '^'+f.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',test]:f.command;
  items.push({id:g.id,kind:'execution-failure',mark:'broken',label:markNames.broken,count:g.count,failureCount:g.count,testFailures,scenarioFailures,title:'\u6e2c\u8a66\u6216\u60c5\u5883\u5931\u6557',reason:'\u4f9d\u6700\u65e9\u7684\u5931\u6557\u908a\u754c\u5408\u4f75\uff1b\u4ee5\u4e0b\u662f\u4ee3\u8868\u932f\u8aa4\uff0c\u4e0d\u4ee3\u8868\u5df2\u78ba\u8a8d\u6839\u56e0\u3002',representative:{message:f.message,code:f.code,first:f.first??null,name:f.name},cause:{category:'execution',...first},locations:dedup(g.failures.map(x=>x.first??x.location).filter(Boolean),x=>JSON.stringify(x)),targets:[],items:[],anchors:[],anchorStatus:'UNKNOWN',demotions:[],missing:first.file==='.'?'\u7f3a\u5c08\u6848\u5167\u7684\u5931\u6557\u4f4d\u7f6e\uff0c\u8acb\u4f9d\u8b49\u64da\u8b58\u5225\u78bc\u67e5\u770b\u539f\u59cb\u8a18\u9304\u3002':'',execution:scenarioFailures?'ran':'tests',executionLabel:scenarioFailures?runNames.ran:runNames.tests,observations:[],fixes:[],verification:command?[{file:test??first.file,command,prerequisites:rerunPrerequisites}]:[],uncoveredFiles:[],references:[],evidenceIds:unique(g.failures.map(x=>x.evidenceId).filter(Boolean)),relatedAnomalyIds:items.filter(i=>i.relatedFailureIds?.includes(g.id)).map(i=>i.id),failures:g.failures.map(({command,prerequisites,...x})=>x)});
 }
 items.push(...stopMaintenanceItems(r.stopSites));
 const rank={broken:0,handling:1,unsure:2,fine:3};items.sort((a,b)=>rank[a.mark]-rank[b.mark]||a.cause.file.localeCompare(b.cause.file)||(a.cause.line??0)-(b.cause.line??0));
 return {...(r.stopSites?{stopSites:r.stopSites}:{}),schema:'maintenance-sheet-v1',display:displayGroups(items,{limit:r.display?.maxGroupsPerCategory??20,productionFiles:r.blocks?.flatMap(b=>b.production)??[]}),rawAnomalies:r.issues.length,occurrences:items.reduce((n,g)=>n+g.count,0),count:items.length,waterProvided:water.provided,waterInputs:water.inputs??[],runs:(water.runs??[]).map(o=>({id:o.id,evidenceId:o.evidenceId,source:o.source,status:o.status,exitCode:o.exitCode,tests:o.tests?{framework:o.tests.framework,passed:o.tests.passed,environmentDenied:o.tests.environmentDenied,productFailures:o.tests.productFailures}:null,environmentDenied:(o.failures??[]).filter(f=>f.classification==='ENVIRONMENT_DENIED'),recordedCommand:o.command})),evidence:(water.evidence??[]).map(e=>({id:e.id,path:'evidence/'+e.id+'.json'})),counts:Object.fromEntries(Object.keys(markNames).map(k=>[k,items.filter(x=>x.mark===k).length])),items};
}

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const location=x=>x.file+(Number.isInteger(x.line)?':'+x.line:'');
const plain=s=>String(s??'').replace(/:UNKNOWN\b/g,'').replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g,'').replace(/\s+/g,' ').trim();
const generic={broken:'\u4f9d\u8cf4\u8def\u5f91\u9700\u6838\u5c0d',generated:'\u7522\u751f\u6a94\u7684\u4ea4\u63a5',redirect:'\u8f09\u5165\u8def\u5f91\u7684\u4ea4\u63a5',nonproduction:'\u8de8\u5340\u5171\u7528\u7684\u7a0b\u5f0f'};
const gaps={AGENT_REVIEW_MISSING:'\u7b49\u5f85\u8b80\u78bc\u5224\u65b7',ANCHORS_MISSING:'\u7f3a\u53ef\u6838\u5c0d\u7684\u539f\u78bc\u4f4d\u7f6e',ANCHOR_CHECK_FAILED:'\u4f4d\u7f6e\u6216\u5167\u5bb9\u6838\u5c0d\u4e0d\u7b26',REASON_MISSING:'\u7f3a\u5224\u65b7\u7406\u7531',INTENT_OR_SUCCESSFUL_RUN_MISSING:'\u7f3a\u8a2d\u8a08\u610f\u5716\u6216\u6210\u529f\u8a66\u8dd1\u8b49\u64da',RISK_MISSING:'\u7f3a\u5177\u9ad4\u98a8\u96aa',FAILURE_EVIDENCE_MISSING:'\u7f3a\u6545\u969c\u8b49\u64da',REPAIR_LOCATION_MISSING_OR_INVALID:'\u4fee\u6539\u4f4d\u7f6e\u6216\u4fee\u6cd5\u672a\u6838\u5c0d',INVALID_MARK:'\u6a19\u8a18\u683c\u5f0f\u4e0d\u7b26'};
const sentence=x=>escape(plain(x));
const commandEscape=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const code=x=>'<code data-repair-locator>'+escape(x)+'</code>';
const shellArg=x=>/^[A-Za-z0-9_./:-]+$/.test(x)?x:"'"+x.replaceAll("'","''")+"'";
export const verificationCommand=t=>t.command.map(shellArg).join(' ');
export function renderMaintenanceHTML(sheet){
 let body='<section id="maintenance-sheet"><div class="eyebrow">\u7a0b\u5f0f\u7dad\u8b77</div><h1>\u7dad\u4fee\u55ae</h1><p>\u5148\u770b\u6a19\u8a18\uff0c\u518d\u770b\u4fee\u6539\u4f4d\u7f6e\u8207\u9a57\u8b49\u65b9\u6cd5\u3002</p><p class="verdict">'+sheet.rawAnomalies+' \u500b\u539f\u59cb\u7570\u5e38\uff0c\u52a0\u4e0a\u7368\u7acb\u5217\u51fa\u7684\u57f7\u884c\u5931\u6557\uff0c\u5171 '+sheet.count+' \u4ef6\u3002\u540c\u4e00\u539f\u59cb\u7570\u5e38\u82e5\u6d89\u53ca\u4e0d\u540c\u4f4d\u7f6e\uff0c\u6703\u5206\u958b\u5217\u51fa\u3002</p><div class="repair-counts">'+Object.entries(markNames).map(([k,v])=>'<span>'+v+' <b>'+sheet.counts[k]+'</b></span>').join('')+'</div>';
 body+='<p class="muted">'+(sheet.waterProvided?'\u5df2\u63a5\u5165\u8986\u84cb\u3001\u5beb\u5165\u6536\u64da\u8207\u6e2c\u8a66\u7d50\u679c\u3002\u8dd1\u904e\u4e0d\u4ee3\u8868\u9019\u500b\u529f\u80fd\u5df2\u901a\u904e\u9a57\u6536\u3002':'\u672c\u6b21\u53ea\u6709\u975c\u614b\u67e5\u7dda\uff0c\u6c92\u6709\u63d0\u4f9b\u8a66\u8dd1\u7d50\u679c\u3002')+'</p>';
 if(!sheet.items.length)body+='<p>\u672c\u6b21\u67e5\u7dda\u6c92\u6709\u5217\u51fa\u7570\u5e38\uff1b\u4e0d\u4ee3\u8868\u5df2\u6392\u9664\u6240\u6709\u6545\u969c\u3002</p>';
 const display=sheet.display??displayGroups(sheet.items);
 body+=renderGroups({...display,categories:display.categories.map(c=>({...c,selected:[]}))},{labels:markNames});
 for(const g of display.categories.flatMap(c=>c.selected)){
  const original=sheet.items[g.indices[0]],i={...original,locations:g.anchors,count:g.occurrences};
  for(const key of ['fixes','verification','references','missingTargets','affectedRoutes','uncoveredFiles','observations','evidenceIds'])if(Array.isArray(i[key]))i[key]=i[key].slice(0,3);
  body+='<p class="group-summary">'+g.count+' 件合併；'+(g.need??'')+(g.production?'；在正式路線上':'')+'</p>';
  body+='<article class="repair card" data-mark="'+i.mark+'" id="'+i.id+'"><div class="card-content"><div class="repair-label">'+i.label+'<span>\u51fa\u73fe '+i.count+' \u8655</span></div><h2>'+sentence(i.title||generic[i.cause.category]||'\u5f85\u6838\u5c0d\u9805\u76ee')+'</h2><p>'+sentence(i.reason||'\u9700\u8981\u8b80\u78bc\u5224\u65b7\u4e26\u88dc\u4e0a\u4f9d\u64da\u3002')+'</p><p><b>\u4f4d\u7f6e\uff1a</b> '+code(location(i.cause))+'</p><p><b>\u5be6\u969b\u8dd1\u904e\u6c92\uff1a</b> '+i.executionLabel+(i.execution==='ran'?'\uff08\u9694\u96e2\u60c5\u5883\uff0c\u5916\u90e8\u670d\u52d9\u4f7f\u7528\u66ff\u8eab\uff09':'')+'</p><p class="muted">\u539f\u78bc\u4f4d\u7f6e\u6838\u5c0d\uff1a'+(i.kind==='execution-failure'?'\u6709\u57f7\u884c\u5931\u6557\u8a18\u9304\uff1b\u6839\u56e0\u4ecd\u5f85\u6838\u5c0d':i.anchorStatus==='PASS'?'\u901a\u904e':'\u672a\u901a\u904e\u6216\u7f3a\u8b49\u64da')+'</p>';
  const direct=[];
  for(const o of direct)if(o.tests?.framework&&o.tests.framework!=='UNKNOWN')body+='<p class="muted">\u540c\u6b21\u6e2c\u8a66\uff1a\u901a\u904e '+(o.tests.passed??0)+' \u9805\uff0c\u74b0\u5883\u62d2\u7d55 '+(o.tests.environmentDenied??0)+' \u9805\uff0c\u7522\u54c1\u5931\u6557 '+(o.tests.productFailures??0)+' \u9805\u3002\u9019\u662f\u6574\u6b21\u6e2c\u8a66\u7d50\u679c\uff0c\u4e0d\u662f\u672c\u4ef6\u529f\u80fd\u9a57\u6536\u3002</p>';
  if(i.representative)body+='<p><b>\u5931\u6557\u6e2c\u8a66\uff1a</b> '+i.testFailures+' \u9805\uff0c\u5931\u6557\u60c5\u5883 '+i.scenarioFailures+' \u9805</p><p><b>\u4ee3\u8868\u932f\u8aa4\uff1a</b></p><pre data-repair-diagnostic>'+commandEscape(i.representative.message)+'</pre><p><b>\u6700\u65e9\u4f4d\u7f6e\uff1a</b> '+code(location(i.representative.first??i.cause))+'</p>';
  if(i.missingTargets?.length)body+='<p><b>\u7f3a\u5c11\u7684\u76ee\u6a19\uff1a</b> '+i.missingTargets.map(code).join('\u3001')+'</p><p><b>\u5f15\u7528\u4f4d\u7f6e\uff1a</b> '+i.locations.map(x=>code(location(x))).join('\u3001')+'</p><p><b>\u53d7\u5f71\u97ff\u7684\u5165\u53e3\u6216\u8def\u7dda\uff1a</b> '+(i.affectedRoutes?.length?i.affectedRoutes.map(code).join('\u3001'):'\u7f3a\u5165\u53e3\u9589\u5305\u8b49\u64da')+'</p><p><b>\u9a57\u8b49\u65b9\u6cd5\uff1a</b> '+sentence(i.verificationMethod)+'</p>';
  if(i.risk)body+='<p><b>\u98a8\u96aa\uff1a</b> '+sentence(i.risk)+'</p>';
  if(i.demotions.length||i.missing)body+='<p class="advice"><b>\u9084\u7f3a\u4ec0\u9ebc\uff1a</b> '+sentence([i.missing,...i.demotions.map(k=>gaps[k]??'\u8b49\u64da\u4e0d\u8db3')].filter(Boolean).join('\u3001'))+'</p>';
  if(['broken','handling'].includes(i.mark)){
   body+=(i.fixes.length?'<h3>\u6539\u54ea\u88e1</h3>':'<h3>\u5f9e\u54ea\u88e1\u67e5\u8d77</h3><p>\u5148\u91cd\u8dd1\u4ee3\u8868\u6e2c\u8a66\u6216\u60c5\u5883\uff0c\u5f9e\u4e0a\u5217\u6700\u65e9\u4f4d\u7f6e\u8ffd\u67e5\uff1b\u6700\u65e9\u5931\u6557\u4e0d\u4e00\u5b9a\u662f\u6839\u56e0\u3002</p>')+i.fixes.map(f=>'<p>'+code(location(f))+'<br>'+escape(f.change?.trim()||'\u6838\u5c0d\u6b64\u8655\u7684\u8f38\u5165\u8207\u547c\u53eb\u7aef\u5408\u7d04\uff0c\u88dc\u9f4a\u8cc7\u6599\u5f8c\u91cd\u8a66\uff0c\u6216\u964d\u7d1a\u4ea4\u4ed8\u4e26\u8a18\u9304\u9650\u5236\u3002')+'</p>').join('')+'<h3>\u6539\u5b8c\u600e\u9ebc\u9a57</h3><p class="muted">\u5728\u540c\u4e00\u9694\u96e2\u526f\u672c\u7684\u6839\u76ee\u9304\u57f7\u884c\uff0c\u4fdd\u7559\u539f\u6e2c\u8a66\u7684\u524d\u7f6e\u6e96\u5099\u8207\u5c01\u9396\u5916\u90e8\u670d\u52d9\u7684\u74b0\u5883\u3002</p>';
   body+='<h3>\u5728\u4f60\u7684\u526f\u672c\u91cd\u8dd1</h3><p>\u524d\u7f6e\u689d\u4ef6\uff1a\u5728\u5c08\u6848\u6839\u76ee\u9304\uff0c\u4f7f\u7528\u539f\u9396\u5b9a\u6a94\u7684\u4f9d\u8cf4\uff0c\u7981\u7528\u5b89\u88dd\u8173\u672c\uff1b\u4fdd\u6301\u96e2\u7dda\u3001\u79fb\u9664\u91d1\u9470\u8207\u4ee3\u78bc\uff0c\u5916\u90e8\u670d\u52d9\u4f7f\u7528\u66ff\u8eab\u3002\u6307\u4ee4\u7684\u5f15\u865f\u4f7f\u7528\u547d\u4ee4\u6bbc\u7684\u55ae\u5f15\u865f\u898f\u5247\u3002</p>';
   body+=i.verification.slice(0,3).map(t=>(t.source==='comparison-rescan'?'<p>\u4ee5\u4e0b\u53ea\u91cd\u8dd1\u975c\u614b\u5c0d\u7167\uff0c\u4e0d\u8b49\u660e\u57f7\u884c\u884c\u70ba\u5df2\u4fee\u5fa9\u3002</p>':'')+(t.prerequisites??[]).map(p=>'<p>\u5148\u57f7\u884c\uff1a</p><pre data-repair-command>'+commandEscape(Array.isArray(p)?verificationCommand({command:p}):p)+'</pre>').join('')+'<pre data-repair-command>'+commandEscape(verificationCommand(t))+'</pre>').join('');
   if(i.uncoveredFiles.length||!i.verification.length)body+='<p>\u6c92\u6709\u6e2c\u8a66\u6db5\u84cb'+(i.uncoveredFiles.length?'\uff1a'+i.uncoveredFiles.map(code).join('\u3001'):'')+'\u3002</p>';
   body+='<h3>\u6703\u9023\u5e36\u5f71\u97ff\u8ab0</h3><p>'+(i.references.length?i.references.slice(0,8).map(x=>code(location(x))).join('\u3001'):'\u672c\u6b21\u67e5\u7dda\u672a\u627e\u5230\u5176\u4ed6\u5f15\u7528\uff0c\u4e0d\u4ee3\u8868\u6c92\u4eba\u4f7f\u7528\u3002')+'</p>';
  }
  body+='<p>\u8b49\u64da\uff1a '+unique([...(i.evidenceIds??[]),...i.observations.map(o=>o.evidenceId).filter(Boolean)]).map(id=>'<a href="evidence/'+escape(id)+'.json">'+code(id)+'</a>').join('\u3001')+'</p>';
  body+='</div><details class="technical"><summary>\u524d\u4e09\u500b\u9328\u9ede\u8207\u5b8c\u6574\u4f9d\u64da\u9023\u7d50</summary><div class="detail-body"><ul>'+i.locations.map(x=>'<li>'+code(location(x))+(x.target?' \u2192 '+code(x.target):'')+'</li>').join('')+'</ul><p><a href="health.json">'+code(i.id)+'</a></p></div></details></article>';
 }
 body+='<h2>\u539f\u59cb\u57f7\u884c\u8a18\u9304</h2><p>\u4ee5\u4e0b\u662f\u89c0\u6e2c\u7d00\u9304\uff0c\u4fdd\u7559\u7576\u6642\u8def\u5f91\uff1b\u4e0d\u662f\u91cd\u8dd1\u6307\u4ee4\u3002</p>';
 body+='<p>共 '+(sheet.runs??[]).length+' 筆執行記錄，顯示前 '+Math.min(20,(sheet.runs??[]).length)+' 筆；每筆環境拒絕最多列三個例子，完整記錄見依據連結。</p>';
 for(const run of (sheet.runs??[]).slice(0,20)){body+='<p>\u901a\u904e '+(run.tests?.passed??0)+' \u9805\uff0c\u74b0\u5883\u62d2\u7d55 '+(run.tests?.environmentDenied??run.environmentDenied?.length??0)+' \u9805\uff0c\u7522\u54c1\u5931\u6557 '+(run.tests?.productFailures??0)+' \u9805\u3002</p>';for(const d of (run.environmentDenied??[]).slice(0,3))body+='<p>\u74b0\u5883\u62d2\u7d55\uff08\u4e0d\u7b97\u58de\u4e86\uff09\uff1a</p><pre data-repair-diagnostic>'+commandEscape(d.message)+'</pre>';if(run.evidenceId)body+='<p><a href="evidence/'+escape(run.evidenceId)+'.json">'+code(run.evidenceId)+'</a></p>';}
 return body+(sheet.stopSites?'<p id="stop-site-comparison"><a href="health.json">\u963b\u64cb\u9ede\u5b8c\u6574\u6e05\u55ae\u8207\u5ba3\u544a\u5c0d\u7167\u4f9d\u64da</a></p>':'')+'</section>';
}

export function renderMaintenanceMarkdown(sheet){
 // Keep the same visible wording and ordering as HTML. Markdown supports the
 // retained details blocks, with the machine model in a fenced JSON section.
 const h=renderMaintenanceHTML(sheet);
 return h.replace(/<details class="technical"><summary>/g,'\n<details><summary>').replace(/<div class="detail-body"><ul>[\s\S]*?<\/ul><pre>([\s\S]*?)<\/pre><\/div><\/details>/g,(_,v)=>'\n\n```json\n'+v.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replaceAll('](',']\\u0028')+'\n```\n\n</details>\n').replace(/<h1>(.*?)<\/h1>/g,'# $1\n\n').replace(/<h2>(.*?)<\/h2>/g,'\n## $1\n\n').replace(/<h3>(.*?)<\/h3>/g,'\n### $1\n\n').replace(/<pre(?: data-repair-command| data-repair-diagnostic)?>(.*?)<\/pre>/gs,'\n```text\n$1\n```\n').replace(/<code(?: data-repair-locator)?>(.*?)<\/code>/gs,'`$1`').replace(/<b>(.*?)<\/b>/gs,'**$1**').replace(/<p[^>]*>(.*?)<\/p>/gs,'$1\n\n').replace(/<div class="repair-label">(.*?)<span>(.*?)<\/span><\/div>/g,'\n**$1** \u00b7 $2\n').replace(/<div class="repair-counts">(.*?)<\/div>/g,(_,v)=>v.replace(/<\/?span>/g,' ')+'\n\n').replace(/<br>/g,'\n').replace(/<\/?(?:section|article|div)[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim()+'\n';
}
