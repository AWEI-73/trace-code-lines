import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {runOnce} from './run-once.mjs';
import {inside,noLinks} from './instrument.mjs';
import {hash,preflight,commandPolicy,anchor} from './cassette.mjs';
import {coverageFiles,judgeScenario,commandStatuses,classifyTests,jsonPointer} from './observations.mjs';
import {isMain} from './is-main.mjs';
const save=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n','utf8');};
// Report rows keep each attempt's identity and file hash; full observations stay in attempt-N.json.
// Only an attempt-limited result that has no observation of its own keeps its last observed attempt inline.
export function attemptSummaries(attempts,dir,keepObservation=false){
 const rows=attempts.map(a=>{const {observation,attempts:_nested,...rest}=a;const file=path.join(dir,'attempt-'+a.attempt+'.json');let sha256=null;try{sha256=hash(fs.readFileSync(file));}catch{}
  return {attempt:a.attempt,status:a.status,reason:a.reason,executed:a.executed,planSha256:a.planSha256,startedAt:rest.startedAt,endedAt:rest.endedAt,file,sha256};});
 if(keepObservation){const last=[...attempts].reverse().find(a=>a.observation);if(last)rows.find(r=>r.attempt===last.attempt).observation=last.observation;}
 return rows;
}
// Optional disk bound: raw V8/settrace files are deleted only after their mapped files and SHA-256 are recorded.
export function pruneRaw(directory,evidence){let files=0,bytes=0;for(const e of evidence){if(!e.file.startsWith(directory+path.sep))continue;try{bytes+=fs.statSync(e.file).size;fs.rmSync(e.file);files++;e.pruned=true;}catch{}}return {files,bytes,kept:'mapped file list and raw SHA-256 only'};}
// pruneRaw also drops per-run raw trace files once the attempt file holds the judged observation (events are kept there).
export function pruneRunFiles(paths){const rows=[];for(const p of paths){if(!fs.existsSync(p))continue;const files=fs.statSync(p).isDirectory()?fs.readdirSync(p,{recursive:true}).map(f=>path.join(p,f)).filter(f=>fs.statSync(f).isFile()):[p];let bytes=0;const h=crypto.createHash('sha256');for(const f of files.sort()){const b=fs.readFileSync(f);bytes+=b.length;h.update(f.slice(p.length)+'\0').update(b);}fs.rmSync(p,{recursive:true,force:true});rows.push({path:p,files:files.length,bytes,sha256:h.digest('hex')});}return rows;}
// Stdout/stderr kept as evidence: the log path, SHA-256, byte count and a short tail.
export function streamEvidence(file,text,tail=4000){const b=Buffer.from(text??'','utf8');return {path:fs.existsSync(file)?file:null,sha256:hash(b),bytes:b.length,tail:b.length>tail?b.subarray(b.length-tail).toString('utf8'):b.toString('utf8')};}
// Allowlist entries: a path string (unchanged behaviour), {path,sha256}, or
// {configFile,pointer,sha256?,sha256Pointer?} read from a JSON config at run time. Tokens @CLONE and @HOME are expanded.
// Hashes are checked right before launch; a mismatch or an unresolved entry fails the attempt instead of widening the allowlist.
// Hash-only entries {sha256,root?} and scenario-manifest entries {manifest,pointer?,sha256Pointer?|sha256,root?} are not
// resolved here: their path is unknown until the scenario creates it, so the recorder checks bytes at spawn time.
export function resolveExecutables(entries,{clone,home,temp=''}){
 const tok=v=>String(v).replaceAll('@CLONE',clone).replaceAll('@HOME',home).replaceAll('@TEMP',temp),rows=[],paths=[],hashes=[];
 for(const e of entries){
  if(typeof e==='string'){paths.push(e);rows.push({path:e,source:'literal'});continue;}
  if(e&&!e.path&&!e.configFile&&(e.manifest||e.sha256)){
   if(!e.manifest&&!/^(?:sha256:)?[a-f0-9]{64}$/i.test(String(e.sha256)))return {rows,paths,hashes,error:'EXECUTABLE_HASH_INVALID'};
   if(e.manifest&&!e.sha256&&!e.sha256Pointer)return {rows,paths,hashes,error:'EXECUTABLE_MANIFEST_HASH_REQUIRED'};
   const h={...(e.sha256?{sha256:String(e.sha256).toLowerCase().replace(/^sha256:/,'')}:{}),...(e.root?{root:tok(e.root)}:{}),...(e.manifest?{manifest:tok(e.manifest),pointer:e.pointer??null,sha256Pointer:e.sha256Pointer??null}:{})};
   hashes.push(h);rows.push({...h,source:e.manifest?'scenario-manifest':'hash-only',status:'DEFERRED_TO_SPAWN'});continue;}
  let file=e.path?tok(e.path):null,expected=e.sha256??null,source='literal';
  if(e.configFile){source=tok(e.configFile);let doc;try{doc=JSON.parse(fs.readFileSync(source,'utf8'));}catch(x){return {rows,paths,hashes,error:'EXECUTABLE_CONFIG_UNREADABLE: '+source};}
   const at=jsonPointer(doc,e.pointer??'');if(!at.found||typeof at.value!=='string')return {rows,paths,hashes,error:'EXECUTABLE_POINTER_UNRESOLVED: '+(e.pointer??'')};
   file=path.isAbsolute(at.value)?at.value:path.resolve(path.dirname(source),at.value);
   if(e.sha256Pointer){const h=jsonPointer(doc,e.sha256Pointer);if(!h.found)return {rows,paths,hashes,error:'EXECUTABLE_HASH_POINTER_UNRESOLVED: '+e.sha256Pointer};expected=h.value;}}
  if(!file)return {rows,paths,hashes,error:'EXECUTABLE_ENTRY_INVALID'};
  let actual=null;try{actual=hash(fs.readFileSync(file));}catch{return {rows,paths,hashes,error:'EXECUTABLE_MISSING: '+file};}
  const row={path:file,source,sha256:actual,expectedSha256:expected,status:expected&&String(expected).toLowerCase().replace(/^sha256:/,'')!==actual?'HASH_MISMATCH':'PASS'};rows.push(row);
  if(row.status!=='PASS')return {rows,paths,hashes,error:'EXECUTABLE_HASH_MISMATCH: '+file};
  paths.push(file);
 }
 return {rows,paths,hashes};
}
export const DEV_LABEL='TOOL_DEV: attempt limit lifted; NOT counted toward any verdict';
export function scenarioStatus(verdict,complete,cleanup){
 if(verdict.status!=='PASS'||!complete||cleanup?.status==='FAIL')return 'FAIL';
 return cleanup?.status==='PASS'?'PASS':'UNKNOWN';
}
export function waterStatus(results){
 return results.every(r=>r.status==='PASS')?'PASS':results.some(r=>['FAIL','STALE'].includes(r.status))?'FAIL':'UNKNOWN';
}

// Verify explicit source positions before an attempt; generated targets require a stable source anchor.
function preflightAnchors(c,s){
 const rows=[],repoRoot=name=>{if(!name)return c.clone;const found=(c.repos??[]).filter(r=>r.name===name);if(found.length!==1||!path.isAbsolute(found[0].root??''))throw Error('ANCHOR_REPO_UNRESOLVED: '+name);return found[0].root;};
 function check(a,{expectRequired=false,label='anchor'}={}){
  const row={label,file:a?.file??null,line:a?.line??null,repo:a?.repo??null};
  try{if(!a||typeof a.file!=='string'||!a.file||path.isAbsolute(a.file)||/[\\:]/.test(a.file)||a.file.split('/').some(x=>!x||x==='.'||x==='..')||!Number.isSafeInteger(a.line)||a.line<1||expectRequired&&(typeof a.expect!=='string'||!a.expect)||a.expect!==undefined&&(typeof a.expect!=='string'||!a.expect))throw Error('INVALID_ANCHOR');
   const root=repoRoot(a.repo),file=path.resolve(root,a.file);noLinks(root);noLinks(file);if(!inside(root,file)||!fs.statSync(file).isFile())throw Error('ANCHOR_NOT_REGULAR_FILE');const b=fs.readFileSync(file),line=b.toString('utf8').split(/\r?\n/)[a.line-1];
   if(line===undefined)throw Error('LINE_OUT_OF_RANGE');if(a.expect!==undefined&&!line.includes(a.expect))throw Error('ANCHOR_TEXT_MISMATCH');const digest=hash(b);if(a.sha256&&a.sha256!==digest)throw Error('ANCHOR_HASH_MISMATCH');Object.assign(row,{status:'PASS',sha256:digest,...((a.expect??line.trim())?{expect:a.expect??line.trim()}: {})});
  }catch(e){Object.assign(row,{status:'FAIL',reason:e.code??e.message});}rows.push(row);return row;
 }
 for(const a of s.anchors??[])check(a,{expectRequired:true,label:'scenario-anchor'});
 for(const a of s.cassette?.anchors??[])check(a,{expectRequired:true,label:'cassette-anchor'});
 for(const e of s.expected??[])if(['line','anchor'].includes(e.kind)){
  if(e.sourceAnchor){const source=check(e.sourceAnchor,{expectRequired:true,label:'expected-source-anchor'}),target=check(e,{expectRequired:e.kind==='anchor',label:'expected-'+e.kind});if(source.status==='PASS'&&target.status==='FAIL'&&target.reason==='ENOENT'){target.status='DEFERRED';target.reason='GENERATED_TARGET_REQUIRES_POST_RUN_CHECK';}}
  else check(e,{expectRequired:e.kind==='anchor',label:'expected-'+e.kind});
 }
 return {status:rows.every(r=>['PASS','DEFERRED'].includes(r.status))?'PASS':'FAIL',rows};
}
function savePreflight(root,id,preflight){const dir=path.join(root,'preflight');noLinks(dir);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,id+'-'+Date.now()+'-'+crypto.randomBytes(6).toString('hex')+'.json');save(file,{schema:'water-source-preflight-v1',scenario:id,...preflight});return file;}

// toolDev lifts the three-attempt limit for tool development only. Its attempts are written as dev-attempt-N.json,
// never read as prior attempts, and every row and the report say countsTowardVerdict:false.
export async function waterSource(c,{enable=false,toolDev=false}={}){
 if(!['existing','test-recording','agent-api'].includes(c.source))throw Error('WATER_SOURCE_REQUIRED');
 if(c.source==='existing'&&!c.scenarios?.length){
  if(!c.records?.length)throw Error('EXISTING_RECORDS_REQUIRED');
  const records=c.records.map(r=>{const b=fs.readFileSync(r.file);if(hash(b)!==r.sha256)throw Error('RECORD_INTEGRITY');return {...r,verified:true};});
  return {schema:'water-source-v1',source:c.source,records,status:'UNKNOWN',evidenceLevel:'STATIC_ONLY',limitation:'Hash verifies retained bytes only; classify real use and reconcile supplied traces separately.'};
 }
 if(!path.isAbsolute(c.clone)||!path.isAbsolute(c.outputRoot)||!path.isAbsolute(c.allowedRoot)||!inside(c.allowedRoot,c.clone)||!inside(c.allowedRoot,c.outputRoot)||inside(c.clone,c.outputRoot)||inside(c.outputRoot,c.clone))throw Error('ISOLATED_COPY_AND_DISJOINT_OUTPUT_REQUIRED');
 for(const p of [c.clone,c.outputRoot])noLinks(p);
 if(c.runtimeRoot!==undefined){if(!path.isAbsolute(c.runtimeRoot)||path.resolve(c.runtimeRoot)===path.parse(path.resolve(c.runtimeRoot)).root)throw Error('RUNTIME_ROOT_INVALID');noLinks(c.runtimeRoot);if([c.clone,c.outputRoot].some(p=>inside(p,c.runtimeRoot)||inside(c.runtimeRoot,p)))throw Error('RUNTIME_ROOT_OVERLAP');}
 if(!c.scenarios?.length||new Set(c.scenarios.map(s=>s.id)).size!==c.scenarios.length)throw Error('UNIQUE_SCENARIOS_REQUIRED');
 if(!enable){const plans=c.scenarios.map(s=>{if(!/^[a-z0-9_-]+$/i.test(s.id)||!s.request||!Array.isArray(s.prerequisites)||!s.expected?.length)throw Error('SCENARIO_SCHEMA');const preflight=preflightAnchors(c,s);return {id:s.id,status:preflight.status==='PASS'?'NOT_EXECUTED':'FAIL',executed:false,preflight};});return {schema:'water-source-v1',executed:false,source:c.source,status:plans.some(p=>p.status==='FAIL')?'FAIL':'NOT_EXECUTED',scenarios:plans};}
 fs.mkdirSync(c.outputRoot,{recursive:true});
 const results=[];
 for(const s of c.scenarios){
  if(!/^[a-z0-9_-]+$/i.test(s.id)||!s.request||!Array.isArray(s.prerequisites)||!s.expected?.length)throw Error('SCENARIO_SCHEMA');
  const dir=path.join(c.outputRoot,s.id);fs.mkdirSync(dir,{recursive:true});
  const prefix=toolDev?'dev-attempt-':'attempt-',all=fs.readdirSync(dir).filter(f=>new RegExp('^'+prefix+'\\d+\\.json$').test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));
  const prior=toolDev?[]:all;
  if(!toolDev&&prior.length>=3&&!prior.some(p=>p.status==='PASS')){results.push({id:s.id,status:prior.every(p=>p.status==='UNKNOWN')?'UNKNOWN':'FAIL',reason:'ATTEMPT_LIMIT',attempts:attemptSummaries(prior,dir,true)});continue;}
  if(prior.some(p=>p.status==='PASS')){const passed=prior.find(p=>p.status==='PASS');let fresh=passed.planSha256===hash(JSON.stringify(s))&&!!passed.sourceAnchors?.length;for(const e of s.expected??[])if(e.sourceAnchor&&!passed.sourceAnchors?.some(a=>a.file===e.sourceAnchor.file&&(a.repo??null)===(e.sourceAnchor.repo??null)&&a.observedSha256))fresh=false;for(const a of passed.sourceAnchors??[])try{const root=a.repo?(c.repos??[]).find(r=>r.name===a.repo)?.root:c.clone;if(!root)throw Error('REPO_MISSING');noLinks(path.resolve(root,a.file));fresh&&=hash(fs.readFileSync(path.resolve(root,a.file)))===a.observedSha256;}catch{fresh=false;}results.push(fresh?{id:s.id,status:'PASS',attempts:attemptSummaries(prior,dir),observation:passed.observation}:{id:s.id,status:'STALE',reason:'PREVIOUS_PASS_INPUT_CHANGED_OR_UNBOUND',attempts:attemptSummaries(prior,dir),executed:false});continue;}
  const anchorPreflight=preflightAnchors(c,s),preflightFile=savePreflight(c.outputRoot,s.id,anchorPreflight);
  if(anchorPreflight.status!=='PASS'){results.push({id:s.id,status:'FAIL',executed:false,reason:'ANCHOR_PREFLIGHT_FAILED',preflight:anchorPreflight,preflightFile,attempts:attemptSummaries(prior,dir)});continue;}
  const unmet=s.prerequisites.filter(id=>!results.some(r=>r.id===id&&r.status==='PASS'));
  const n=(toolDev?all.length:prior.length)+1,attemptFile=path.join(dir,prefix+n+'.json');
  const inferred=[...new Set([...(s.command??[]).filter(v=>v.startsWith('@CLONE/')).map(v=>v.slice(7)),...s.expected.filter(e=>['coverage','anchor'].includes(e.kind)).map(e=>e.file)])].filter(f=>f&&fs.existsSync(path.resolve(c.clone,f))&&fs.statSync(path.resolve(c.clone,f)).isFile()).map(file=>{const body=fs.readFileSync(path.resolve(c.clone,file),'utf8'),lines=body.split(/\r?\n/),line=lines.findIndex(l=>l.trim());return {file,line:line+1,expect:lines[line]?.trim().slice(0,240)??'',sha256:hash(body)};});
  const sourceAnchors=(s.anchors??s.cassette?.anchors??inferred).map(a=>{const root=a.repo?(c.repos??[]).find(r=>r.name===a.repo)?.root:c.clone;return {...a,observedSha256:hash(fs.readFileSync(path.resolve(root,a.file)))};});
  for(const a of anchorPreflight.rows.filter(a=>a.status==='PASS'))if(!sourceAnchors.some(x=>x.file===a.file&&(x.repo??null)===(a.repo??null)))sourceAnchors.push({file:a.file,...(a.repo?{repo:a.repo}:{}),line:a.line,...(a.expect?{expect:a.expect}:{}),sha256:a.sha256,observedSha256:a.sha256});
  const r={id:s.id,attempt:n,...(toolDev?{toolDev:true,countsTowardVerdict:false,label:DEV_LABEL}:{}),request:s.request,planSha256:hash(JSON.stringify(s)),sourceAnchors,anchorPreflight,preflightFile,status:'FAIL',startedAt:new Date().toISOString()};
  if(unmet.length){const unknown=unmet.every(id=>results.some(r=>r.id===id&&r.status==='UNKNOWN'));Object.assign(r,{status:unknown?'UNKNOWN':'FAIL',reason:unknown?'PREREQUISITE_UNKNOWN':'PREREQUISITE_FAILED',unmet});save(attemptFile,r);results.push(r);continue;}
  const policy=commandPolicy(s.command??[]);if(policy.status!=='PASS'){Object.assign(r,{reason:policy.reason,executed:false});save(attemptFile,r);results.push(r);continue;}
  const pre=s.cassette?preflight(s.cassette,s.callOrder,c.clone):{status:'PASS',calls:0};
  r.preflight=pre;if(pre.status!=='PASS'){Object.assign(r,{status:pre.status,executed:false});save(attemptFile,r);results.push(r);continue;}
  let trial;if(c.runtimeRoot!==undefined){noLinks(c.runtimeRoot);fs.mkdirSync(c.runtimeRoot,{recursive:true});noLinks(c.runtimeRoot);trial=fs.mkdtempSync(path.join(c.runtimeRoot,'ws-'));noLinks(trial);}else trial=path.join(dir,(toolDev?'dev-run-':'run-')+n);const temp=path.join(trial,'temp');fs.mkdirSync(temp,{recursive:true});r.trialRoot=trial;
  try{
   const home=path.join(temp,'home'),command=s.command.map(x=>x==='@NODE'?process.execPath:x.replaceAll('@CLONE',c.clone).replaceAll('@HOME',home));
   if(command[0]!==process.execPath)throw Error('NODE_LAUNCHER_REQUIRED');
   const allowed=resolveExecutables(c.executables??[],{clone:c.clone,home,temp});r.executables=allowed.rows;if(allowed.error)throw Error(allowed.error);
   r.executed=null; // runOnce can throw before or after launch; retain UNKNOWN until it returns.
   const result=await runOnce({clone:c.clone,tempRoot:temp,isolationRoot:path.join(temp,'home'),outputDirectory:path.join(temp,'observation'),command,cwd:c.clone,
    resolvedWriteRoots:[c.clone,temp],executables:[process.execPath,...allowed.paths],executableHashes:allowed.hashes,pythonExecutables:c.pythonExecutables??[],environment:c.environment??{},
    timeoutMs:Math.min(s.timeoutMs??60000,300000),boundaries:s.boundaries??[],cassette:s.cassette,strictBoundaries:true},{enable:true});
   const out=path.join(temp,'observation'),tokx=v=>String(v).replaceAll('@CLONE',c.clone).replaceAll('@HOME',home).replaceAll('@TEMP',temp),
    writtenHashes=new Map((result.target.summary.writes??[]).flatMap(w=>w.snapshotEvidence??[]).filter(x=>x.after?.sha256).map(x=>[path.resolve(x.path),x.after.sha256])),
    launchHashes=new Map(fs.readdirSync(path.join(out,'events')).filter(f=>f.endsWith('.jsonl')).flatMap(f=>fs.readFileSync(path.join(out,'events',f),'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return null;}})).filter(e=>e?.kind==='process'&&e.phase==='prepared'&&e.scriptSha256).map(e=>[path.resolve(e.scriptPath),e.scriptSha256])),
    coverage=coverageFiles(path.join(out,'coverage'),c.clone,{writtenHashes,launchHashes,pathMaps:(c.pathMaps??[]).map(m=>({...m,...(m.installedRoot?{installedRoot:path.resolve(tokx(m.installedRoot))}:{})})),repos:(c.repos??[]).map(r=>({name:r.name,root:path.resolve(tokx(r.root))})),lines:s.expected.filter(e=>e.kind==='line').map(e=>({file:e.file,line:e.line,...(e.repo?{repo:e.repo}:{})}))});
   if(c.sourceFiles){coverage.adapterFiles=coverage.files.filter(f=>!c.sourceFiles.includes(f));coverage.files=coverage.files.filter(f=>c.sourceFiles.includes(f));}
   if(c.runtimeRoot===undefined&&(c.pruneRaw===true||c.pruneRawCoverage===true))coverage.pruned=pruneRaw(path.join(out,'coverage'),coverage.evidence);
   const events=fs.readdirSync(path.join(out,'events')).filter(f=>f.endsWith('.jsonl')).flatMap(f=>fs.readFileSync(path.join(out,'events',f),'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)));
   const observation={coverage,writes:result.target.summary.writes,events,statuses:commandStatuses(result.target.stdout),exitCode:result.target.exitCode};
   const expectations=s.expected.map(e=>({...e,...(e.file?{file:e.file.replaceAll('@HOME',home)}:{}),...(e.source&&!['stdout','stderr'].includes(e.source)?{source:e.source.replaceAll('@HOME',home).replaceAll('@CLONE',c.clone)}:{})}));
   const streams={stdout:result.target.stdout??'',stderr:result.target.stderr??''};
   observation.output={exitCode:result.target.exitCode,stdout:streamEvidence(path.join(out,'stdout.log'),streams.stdout),stderr:streamEvidence(path.join(out,'stderr.log'),streams.stderr)};
   const verdict=judgeScenario(expectations,observation,c.clone,streams);
   // Recheck anchor targets against their declared repo, including generated files, after execution.
   for(const check of verdict.checks.filter(x=>x.expected.kind==='anchor')){const e=check.expected,root=e.repo?(c.repos??[]).find(r=>r.name===e.repo)?.root:c.clone;let actual;try{if(!root)throw Error('ANCHOR_REPO_UNRESOLVED');const file=path.resolve(root,e.file);if(!inside(root,file))throw Error('ANCHOR_ESCAPE');noLinks(root);noLinks(file);actual=anchor(root,e);}catch(error){actual={status:'UNKNOWN',reason:error.message};}const covered=e.repo?coverage.repos?.[e.repo]??[]:coverage.files;check.actual=actual;check.status=actual.status==='PASS'&&covered.includes(e.file)?'PASS':'FAIL';}
   verdict.status=verdict.checks.every(x=>x.status==='PASS')&&verdict.witness&&(expectations.some(e=>e.kind==='exit')||observation.exitCode===0)?'PASS':'FAIL';
   const calls=events.filter(e=>e.kind==='cassette'&&e.phase==='success').sort((a,b)=>a.index-b.index).map((e,i)=>({sequence:i,kind:e.requestKind,request:e.request,key:e.key,response:e.response,source:e.source,paid:e.paid,live:false}));
   const complete=!s.cassette||calls.length===s.cassette.calls.length;
   Object.assign(r,{status:scenarioStatus(verdict,complete,result.target.summary.cleanup),executed:true,verdict,cassetteComplete:complete,observation,evidence:out+'.result.json',
    tests:classifyTests(result.target.stdout,result.target.stderr,result.target.summary.denied),cleanup:result.target.summary.cleanup??null});
   if(c.runtimeRoot===undefined&&c.pruneRaw===true)r.prunedRaw=pruneRunFiles([path.join(out,'events'),path.join(out,'instrument-collect.json'),out+'.result.json',out+'.packed']);
   save(path.join(dir,(toolDev?'dev-cassette-':'cassette-')+n+'.json'),{schema:'boundary-cassette-v1',anchors:(()=>{const valid=sourceAnchors.filter(a=>!a.repo&&a.expect&&a.sha256).map(({observedSha256,...a})=>a);return valid.length?valid:inferred.filter(a=>a.expect&&a.sha256);})(),calls});
  }catch(e){Object.assign(r,{status:'FAIL',reason:e.message,executed:r.executed===undefined?false:r.executed});}
  r.endedAt=new Date().toISOString();save(attemptFile,r);results.push({...r,attempts:toolDev?[]:attemptSummaries([...prior,r],dir)});
 }
 const covered=[...new Set(results.flatMap(r=>r.observation?.coverage.files??[]))].sort();
 const report={schema:'water-source-v1',source:c.source,executed:results.some(r=>r.executed===true)?true:results.some(r=>r.executed===null)?null:false,status:waterStatus(results),evidenceLevel:covered.length?(c.source==='agent-api'?'AGENT_DRIVEN_STUBBED':'TEST_EXECUTED'):'STATIC_ONLY',coveredFiles:covered,additionalFlowFiles:covered.length,results,
  boundary:'API hooks, not an OS sandbox. Unknown native escapes are not certified. Python audit cannot rewrite subprocess argv. Model adapters and HTTP responses are stand-ins.'};
 if(toolDev){Object.assign(report,{toolDev:true,countsTowardVerdict:false,label:DEV_LABEL,devStatus:report.status,status:'NOT_COUNTED'});save(path.join(c.outputRoot,'water-source.tool-dev.json'),report);return report;}
 save(path.join(c.outputRoot,'water-source.json'),report);return report;
}
if(isMain(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--help'){console.log('Usage: node water-source.mjs --config file [--enable] [--tool-dev] [--verbose]  (--tool-dev lifts the 3-attempt limit; results are labelled NOT counted)');process.exit(0);}

 try{const a=process.argv.slice(2),p=a[a.indexOf('--config')+1],c=JSON.parse(fs.readFileSync(p,'utf8')),r=await waterSource(c,{enable:a.includes('--enable'),toolDev:a.includes('--tool-dev')});const summary={schema:r.schema,status:r.status??'PLANNED',executed:Object.hasOwn(r,'executed')?r.executed:(r.results?.some(x=>x.executed===true)?true:r.results?.some(x=>x.executed===null)?null:false),scenarios:r.results?.map(x=>({id:x.id,status:x.status,failedExpectations:(x.verdict?.checks??[]).filter(v=>v.status==='FAIL').map(v=>v.expected),reason:x.reason??x.verdict?.reason??null,evidence:x.evidence??null}))??r.scenarios,evidenceFile:a.includes('--enable')&&r.results?path.resolve(c.outputRoot,a.includes('--tool-dev')?'water-source.tool-dev.json':'water-source.json'):null};console.log(JSON.stringify(a.includes('--verbose')?r:summary,null,2));if(r.status==='FAIL')process.exitCode=1;}catch(e){console.error(e.stack);process.exitCode=1;}
}
