import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {runOnce} from './run-once.mjs';
import {inside,noLinks} from './instrument.mjs';
import {hash,preflight,commandPolicy} from './cassette.mjs';
import {coverageFiles,judgeScenario,commandStatuses,classifyTests,jsonPointer} from './observations.mjs';
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
export function resolveExecutables(entries,{clone,home}){
 const tok=v=>String(v).replaceAll('@CLONE',clone).replaceAll('@HOME',home),rows=[],paths=[];
 for(const e of entries){
  if(typeof e==='string'){paths.push(e);rows.push({path:e,source:'literal'});continue;}
  let file=e.path?tok(e.path):null,expected=e.sha256??null,source='literal';
  if(e.configFile){source=tok(e.configFile);let doc;try{doc=JSON.parse(fs.readFileSync(source,'utf8'));}catch(x){return {rows,paths,error:'EXECUTABLE_CONFIG_UNREADABLE: '+source};}
   const at=jsonPointer(doc,e.pointer??'');if(!at.found||typeof at.value!=='string')return {rows,paths,error:'EXECUTABLE_POINTER_UNRESOLVED: '+(e.pointer??'')};
   file=path.isAbsolute(at.value)?at.value:path.resolve(path.dirname(source),at.value);
   if(e.sha256Pointer){const h=jsonPointer(doc,e.sha256Pointer);if(!h.found)return {rows,paths,error:'EXECUTABLE_HASH_POINTER_UNRESOLVED: '+e.sha256Pointer};expected=h.value;}}
  if(!file)return {rows,paths,error:'EXECUTABLE_ENTRY_INVALID'};
  let actual=null;try{actual=hash(fs.readFileSync(file));}catch{return {rows,paths,error:'EXECUTABLE_MISSING: '+file};}
  const row={path:file,source,sha256:actual,expectedSha256:expected,status:expected&&String(expected).toLowerCase().replace(/^sha256:/,'')!==actual?'HASH_MISMATCH':'PASS'};rows.push(row);
  if(row.status!=='PASS')return {rows,paths,error:'EXECUTABLE_HASH_MISMATCH: '+file};
  paths.push(file);
 }
 return {rows,paths};
}
export function scenarioStatus(verdict,complete,cleanup){
 if(verdict.status!=='PASS'||!complete||cleanup?.status==='FAIL')return 'FAIL';
 return cleanup?.status==='PASS'?'PASS':'UNKNOWN';
}
export function waterStatus(results){
 return results.every(r=>r.status==='PASS')?'PASS':results.some(r=>['FAIL','STALE'].includes(r.status))?'FAIL':'UNKNOWN';
}
export async function waterSource(c,{enable=false}={}){
 if(!['existing','test-recording','agent-api'].includes(c.source))throw Error('WATER_SOURCE_REQUIRED');
 if(c.source==='existing'&&!c.scenarios?.length){
  if(!c.records?.length)throw Error('EXISTING_RECORDS_REQUIRED');
  const records=c.records.map(r=>{const b=fs.readFileSync(r.file);if(hash(b)!==r.sha256)throw Error('RECORD_INTEGRITY');return {...r,verified:true};});
  return {schema:'water-source-v1',source:c.source,records,status:'UNKNOWN',evidenceLevel:'STATIC_ONLY',limitation:'Hash verifies retained bytes only; classify real use and reconcile supplied traces separately.'};
 }
 if(!path.isAbsolute(c.clone)||!path.isAbsolute(c.outputRoot)||!path.isAbsolute(c.allowedRoot)||!inside(c.allowedRoot,c.clone)||!inside(c.allowedRoot,c.outputRoot)||inside(c.clone,c.outputRoot)||inside(c.outputRoot,c.clone))throw Error('ISOLATED_COPY_AND_DISJOINT_OUTPUT_REQUIRED');
 for(const p of [c.clone,c.outputRoot])noLinks(p);
 if(!c.scenarios?.length||new Set(c.scenarios.map(s=>s.id)).size!==c.scenarios.length)throw Error('UNIQUE_SCENARIOS_REQUIRED');
 if(!enable)return {schema:'water-source-v1',executed:false,source:c.source,scenarios:c.scenarios.map(s=>s.id)};
 fs.mkdirSync(c.outputRoot,{recursive:true});
 const results=[];
 for(const s of c.scenarios){
  if(!/^[a-z0-9_-]+$/i.test(s.id)||!s.request||!Array.isArray(s.prerequisites)||!s.expected?.length)throw Error('SCENARIO_SCHEMA');
  const dir=path.join(c.outputRoot,s.id);fs.mkdirSync(dir,{recursive:true});
  const prior=fs.readdirSync(dir).filter(f=>/^attempt-\d+\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));
  if(prior.length>=3&&!prior.some(p=>p.status==='PASS')){results.push({id:s.id,status:prior.every(p=>p.status==='UNKNOWN')?'UNKNOWN':'FAIL',reason:'ATTEMPT_LIMIT',attempts:attemptSummaries(prior,dir,true)});continue;}
  if(prior.some(p=>p.status==='PASS')){const passed=prior.find(p=>p.status==='PASS');let fresh=passed.planSha256===hash(JSON.stringify(s))&&!!passed.sourceAnchors?.length;for(const a of passed.sourceAnchors??[])try{fresh&&=hash(fs.readFileSync(path.resolve(c.clone,a.file)))===a.observedSha256;}catch{fresh=false;}results.push(fresh?{id:s.id,status:'PASS',attempts:attemptSummaries(prior,dir),observation:passed.observation}:{id:s.id,status:'STALE',reason:'PREVIOUS_PASS_INPUT_CHANGED_OR_UNBOUND',attempts:attemptSummaries(prior,dir),executed:false});continue;}
  const unmet=s.prerequisites.filter(id=>!results.some(r=>r.id===id&&r.status==='PASS'));
  const n=prior.length+1,attemptFile=path.join(dir,'attempt-'+n+'.json');
  const inferred=[...new Set([...(s.command??[]).filter(v=>v.startsWith('@CLONE/')).map(v=>v.slice(7)),...s.expected.filter(e=>['coverage','anchor'].includes(e.kind)).map(e=>e.file)])].filter(f=>f&&fs.existsSync(path.resolve(c.clone,f))&&fs.statSync(path.resolve(c.clone,f)).isFile()).map(file=>{const body=fs.readFileSync(path.resolve(c.clone,file),'utf8'),lines=body.split(/\r?\n/),line=lines.findIndex(l=>l.trim());return {file,line:line+1,expect:lines[line]?.trim().slice(0,240)??'',sha256:hash(body)};});
  const sourceAnchors=(s.anchors??s.cassette?.anchors??inferred).map(a=>({...a,observedSha256:hash(fs.readFileSync(path.resolve(c.clone,a.file)))}));
  const r={id:s.id,attempt:n,request:s.request,planSha256:hash(JSON.stringify(s)),sourceAnchors,status:'FAIL',startedAt:new Date().toISOString()};
  if(unmet.length){const unknown=unmet.every(id=>results.some(r=>r.id===id&&r.status==='UNKNOWN'));Object.assign(r,{status:unknown?'UNKNOWN':'FAIL',reason:unknown?'PREREQUISITE_UNKNOWN':'PREREQUISITE_FAILED',unmet});save(attemptFile,r);results.push(r);continue;}
  const policy=commandPolicy(s.command??[]);if(policy.status!=='PASS'){Object.assign(r,{reason:policy.reason,executed:false});save(attemptFile,r);results.push(r);continue;}
  const pre=s.cassette?preflight(s.cassette,s.callOrder,c.clone):{status:'PASS',calls:0};
  r.preflight=pre;if(pre.status!=='PASS'){Object.assign(r,{status:pre.status,executed:false});save(attemptFile,r);results.push(r);continue;}
  const trial=path.join(dir,'run-'+n),temp=path.join(trial,'temp');fs.mkdirSync(temp,{recursive:true});
  try{
   const home=path.join(temp,'home'),command=s.command.map(x=>x==='@NODE'?process.execPath:x.replaceAll('@CLONE',c.clone).replaceAll('@HOME',home));
   if(command[0]!==process.execPath)throw Error('NODE_LAUNCHER_REQUIRED');
   const allowed=resolveExecutables(c.executables??[],{clone:c.clone,home});r.executables=allowed.rows;if(allowed.error)throw Error(allowed.error);
   const result=await runOnce({clone:c.clone,tempRoot:temp,isolationRoot:path.join(temp,'home'),outputDirectory:path.join(temp,'observation'),command,cwd:c.clone,
    resolvedWriteRoots:[c.clone,temp],executables:[process.execPath,...allowed.paths],pythonExecutables:c.pythonExecutables??[],environment:c.environment??{},
    timeoutMs:Math.min(s.timeoutMs??60000,300000),boundaries:s.boundaries??[],cassette:s.cassette,strictBoundaries:true},{enable:true});
   const out=path.join(temp,'observation'),tokx=v=>String(v).replaceAll('@CLONE',c.clone).replaceAll('@HOME',home).replaceAll('@TEMP',temp),
    writtenHashes=new Map((result.target.summary.writes??[]).flatMap(w=>w.snapshotEvidence??[]).filter(x=>x.after?.sha256).map(x=>[path.resolve(x.path),x.after.sha256])),
    coverage=coverageFiles(path.join(out,'coverage'),c.clone,{writtenHashes,pathMaps:(c.pathMaps??[]).map(m=>({...m,...(m.installedRoot?{installedRoot:path.resolve(tokx(m.installedRoot))}:{})})),repos:(c.repos??[]).map(r=>({name:r.name,root:path.resolve(tokx(r.root))}))});
   if(c.sourceFiles){coverage.adapterFiles=coverage.files.filter(f=>!c.sourceFiles.includes(f));coverage.files=coverage.files.filter(f=>c.sourceFiles.includes(f));}
   if(c.pruneRaw===true||c.pruneRawCoverage===true)coverage.pruned=pruneRaw(path.join(out,'coverage'),coverage.evidence);
   const events=fs.readdirSync(path.join(out,'events')).filter(f=>f.endsWith('.jsonl')).flatMap(f=>fs.readFileSync(path.join(out,'events',f),'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)));
   const observation={coverage,writes:result.target.summary.writes,events,statuses:commandStatuses(result.target.stdout),exitCode:result.target.exitCode};
   const expectations=s.expected.map(e=>({...e,...(e.file?{file:e.file.replaceAll('@HOME',home)}:{}),...(e.source&&!['stdout','stderr'].includes(e.source)?{source:e.source.replaceAll('@HOME',home).replaceAll('@CLONE',c.clone)}:{})}));
   const streams={stdout:result.target.stdout??'',stderr:result.target.stderr??''};
   observation.output={exitCode:result.target.exitCode,stdout:streamEvidence(path.join(out,'stdout.log'),streams.stdout),stderr:streamEvidence(path.join(out,'stderr.log'),streams.stderr)};
   const verdict=judgeScenario(expectations,observation,c.clone,streams);
   const calls=events.filter(e=>e.kind==='cassette'&&e.phase==='success').sort((a,b)=>a.index-b.index).map((e,i)=>({sequence:i,kind:e.requestKind,request:e.request,key:e.key,response:e.response,source:e.source,paid:e.paid,live:false}));
   const complete=!s.cassette||calls.length===s.cassette.calls.length;
   Object.assign(r,{status:scenarioStatus(verdict,complete,result.target.summary.cleanup),executed:true,verdict,cassetteComplete:complete,observation,evidence:out+'.result.json',
    tests:classifyTests(result.target.stdout,result.target.stderr,result.target.summary.denied),cleanup:result.target.summary.cleanup??null});
   if(c.pruneRaw===true)r.prunedRaw=pruneRunFiles([path.join(out,'events'),path.join(out,'instrument-collect.json'),out+'.result.json',out+'.packed']);
   save(path.join(dir,'cassette-'+n+'.json'),{schema:'boundary-cassette-v1',anchors:sourceAnchors.map(({observedSha256,...a})=>a),calls});
  }catch(e){Object.assign(r,{status:'FAIL',reason:e.message,executed:true});}
  r.endedAt=new Date().toISOString();save(attemptFile,r);results.push({...r,attempts:attemptSummaries([...prior,r],dir)});
 }
 const covered=[...new Set(results.flatMap(r=>r.observation?.coverage.files??[]))].sort();
 const report={schema:'water-source-v1',source:c.source,status:waterStatus(results),evidenceLevel:covered.length?(c.source==='agent-api'?'AGENT_DRIVEN_STUBBED':'TEST_EXECUTED'):'STATIC_ONLY',coveredFiles:covered,additionalFlowFiles:covered.length,results,
  boundary:'API hooks, not an OS sandbox. Unknown native escapes are not certified. Python audit cannot rewrite subprocess argv. Model adapters and HTTP responses are stand-ins.'};
 save(path.join(c.outputRoot,'water-source.json'),report);return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.length===3&&process.argv[2]==='--help'){console.log('Usage: node water-source.mjs --config file [--enable]');process.exit(0);}

 try{const a=process.argv.slice(2),p=a[a.indexOf('--config')+1],r=await waterSource(JSON.parse(fs.readFileSync(p,'utf8')),{enable:a.includes('--enable')});console.log(JSON.stringify(r,null,2));if(r.status==='FAIL')process.exitCode=1;}catch(e){console.error(e.stack);process.exitCode=1;}
}
