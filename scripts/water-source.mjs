import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {runOnce} from './run-once.mjs';
import {inside,noLinks} from './instrument.mjs';
import {hash,preflight,commandPolicy} from './cassette.mjs';
import {coverageFiles,judgeScenario,commandStatuses,classifyTests} from './observations.mjs';
const save=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n','utf8');};
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
  if(prior.length>=3&&!prior.some(p=>p.status==='PASS')){results.push({id:s.id,status:prior.every(p=>p.status==='UNKNOWN')?'UNKNOWN':'FAIL',reason:'ATTEMPT_LIMIT',attempts:prior});continue;}
  if(prior.some(p=>p.status==='PASS')){const passed=prior.find(p=>p.status==='PASS');let fresh=passed.planSha256===hash(JSON.stringify(s))&&!!passed.sourceAnchors?.length;for(const a of passed.sourceAnchors??[])try{fresh&&=hash(fs.readFileSync(path.resolve(c.clone,a.file)))===a.observedSha256;}catch{fresh=false;}results.push(fresh?{id:s.id,status:'PASS',attempts:prior,observation:passed.observation}:{id:s.id,status:'STALE',reason:'PREVIOUS_PASS_INPUT_CHANGED_OR_UNBOUND',attempts:prior,executed:false});continue;}
  const unmet=s.prerequisites.filter(id=>!results.some(r=>r.id===id&&r.status==='PASS'));
  const n=prior.length+1,attemptFile=path.join(dir,'attempt-'+n+'.json');
  const inferred=[...new Set([...(s.command??[]).filter(v=>v.startsWith('@CLONE/')).map(v=>v.slice(7)),...s.expected.filter(e=>['coverage','anchor'].includes(e.kind)).map(e=>e.file)])].filter(f=>f&&fs.existsSync(path.resolve(c.clone,f))).map(file=>{const body=fs.readFileSync(path.resolve(c.clone,file),'utf8'),lines=body.split(/\r?\n/),line=lines.findIndex(l=>l.trim());return {file,line:line+1,expect:lines[line]?.trim().slice(0,240)??'',sha256:hash(body)};});
  const sourceAnchors=(s.anchors??s.cassette?.anchors??inferred).map(a=>({...a,observedSha256:hash(fs.readFileSync(path.resolve(c.clone,a.file)))}));
  const r={id:s.id,attempt:n,request:s.request,planSha256:hash(JSON.stringify(s)),sourceAnchors,status:'FAIL',startedAt:new Date().toISOString()};
  if(unmet.length){const unknown=unmet.every(id=>results.some(r=>r.id===id&&r.status==='UNKNOWN'));Object.assign(r,{status:unknown?'UNKNOWN':'FAIL',reason:unknown?'PREREQUISITE_UNKNOWN':'PREREQUISITE_FAILED',unmet});save(attemptFile,r);results.push(r);continue;}
  const policy=commandPolicy(s.command??[]);if(policy.status!=='PASS'){Object.assign(r,{reason:policy.reason,executed:false});save(attemptFile,r);results.push(r);continue;}
  const pre=s.cassette?preflight(s.cassette,s.callOrder,c.clone):{status:'PASS',calls:0};
  r.preflight=pre;if(pre.status!=='PASS'){Object.assign(r,{status:pre.status,executed:false});save(attemptFile,r);results.push(r);continue;}
  const trial=path.join(dir,'run-'+n),temp=path.join(trial,'temp');fs.mkdirSync(temp,{recursive:true});
  try{
   const command=s.command.map(x=>x==='@NODE'?process.execPath:x.replaceAll('@CLONE',c.clone));
   if(command[0]!==process.execPath)throw Error('NODE_LAUNCHER_REQUIRED');
   const result=await runOnce({clone:c.clone,tempRoot:temp,isolationRoot:path.join(temp,'home'),outputDirectory:path.join(temp,'observation'),command,cwd:c.clone,
    resolvedWriteRoots:[c.clone,temp],executables:[process.execPath,...(c.executables??[])],pythonExecutables:c.pythonExecutables??[],environment:c.environment??{},
    timeoutMs:Math.min(s.timeoutMs??60000,300000),boundaries:s.boundaries??[],cassette:s.cassette,strictBoundaries:true},{enable:true});
   const out=path.join(temp,'observation'),coverage=coverageFiles(path.join(out,'coverage'),c.clone);
   if(c.sourceFiles){coverage.adapterFiles=coverage.files.filter(f=>!c.sourceFiles.includes(f));coverage.files=coverage.files.filter(f=>c.sourceFiles.includes(f));}
   const events=fs.readdirSync(path.join(out,'events')).filter(f=>f.endsWith('.jsonl')).flatMap(f=>fs.readFileSync(path.join(out,'events',f),'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)));
   const observation={coverage,writes:result.target.summary.writes,events,statuses:commandStatuses(result.target.stdout),exitCode:result.target.exitCode};
   const expectations=s.expected.map(e=>({...e,...(e.file?{file:e.file.replaceAll('@HOME',path.join(temp,'home'))}:{})}));
   const verdict=judgeScenario(expectations,observation,c.clone);
   const calls=events.filter(e=>e.kind==='cassette'&&e.phase==='success').sort((a,b)=>a.index-b.index).map((e,i)=>({sequence:i,kind:e.requestKind,request:e.request,key:e.key,response:e.response,source:e.source,paid:e.paid,live:false}));
   const complete=!s.cassette||calls.length===s.cassette.calls.length;
   Object.assign(r,{status:scenarioStatus(verdict,complete,result.target.summary.cleanup),executed:true,verdict,cassetteComplete:complete,observation,evidence:out+'.result.json',
    tests:classifyTests(result.target.stdout,result.target.stderr,result.target.summary.denied),cleanup:result.target.summary.cleanup??null});
   save(path.join(dir,'cassette-'+n+'.json'),{schema:'boundary-cassette-v1',anchors:sourceAnchors.map(({observedSha256,...a})=>a),calls});
  }catch(e){Object.assign(r,{status:'FAIL',reason:e.message,executed:true});}
  r.endedAt=new Date().toISOString();save(attemptFile,r);results.push({...r,attempts:[...prior,r]});
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
