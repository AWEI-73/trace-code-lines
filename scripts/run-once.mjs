import {commandStatuses,classifyTests} from './observations.mjs';
import {gapList} from './gap-shape.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {run,collect,remove,inside,noLinks,digest} from './instrument.mjs';
import {contract} from './contract.mjs';
const save=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n','utf8');
export function verifyWriteRoots(paths,allowedRoots) {
 for(const p of paths){if(typeof p!=='string'||!path.isAbsolute(p)||!allowedRoots.some(r=>inside(r,p)))throw Error('ISOLATION_ROOT_ESCAPE: '+p);noLinks(p);}
 return {status:'PASS',paths,allowedRoots};
}
export function discoverDryRun(files,command) {
 const found=[];
 for(const file of files){const text=fs.readFileSync(file,'utf8');text.split('\n').forEach((line,i)=>{
  if(/(['"])--dry-run\1/.test(line)&&/(includes|has|option|argument|flag|dryRun|dry.run|add_argument)/i.test(line))found.push({file,line:i+1,kind:'flag',token:'--dry-run'});
  if(/(?:command|cmd|args\[0\]|argv\[.*?\])\s*===?\s*['"]plan['"]/.test(line))found.push({file,line:i+1,kind:'subcommand',token:'plan'});
 });}
 const selected=found.find(f=>f.kind==='flag')??found[0];
 return {candidates:found,command:selected?(selected.kind==='flag'?[...command,selected.token]:[...command.slice(0,2),selected.token,...command.slice(3)]):null,
 status:selected?'STATIC_CANDIDATE':'NOT_FOUND_IN_DISCLOSED_FILES',assumption:'Literal CLI branch only; static discovery is not proof of zero effects. Active instrument and stubs also apply to dry-run.'};
}
export function packDirectory(root,destination) {
 noLinks(root);noLinks(destination);if(fs.existsSync(destination))throw Error('Archive already exists');fs.mkdirSync(destination,{recursive:true});
 const index=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isSymbolicLink())throw Error('Linked evidence');if(e.isDirectory())walk(p);else if(e.isFile()){
 const b=fs.readFileSync(p),rel=path.relative(root,p),target=path.join(destination,rel+'.gz');fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.writeFileSync(target,zlib.gzipSync(b));if(digest(zlib.gunzipSync(fs.readFileSync(target)))!==digest(b))throw Error('Archive readback mismatch');
 index.push({path:rel.replaceAll('\\','/'),sha256:digest(b),bytes:b.length,packedBytes:fs.statSync(target).size,archive:target});}}}walk(root);save(path.join(destination,'index.json'),index);return index;
}
export async function sample(config,command,outputDirectory) {
 const cfg={...config,outputDirectory},file=outputDirectory+'.config.json';save(file,cfg);
 const r=await run(file,command,{enable:true});let summary,archive,receipt;
 try{summary=collect(r.manifest);archive=packDirectory(outputDirectory,outputDirectory+'.packed');}
 finally {if(archive)receipt=remove(r.manifest);}
 const events=[];
 for(const row of archive.filter(r=>r.path.startsWith('events/')&&r.path.endsWith('.jsonl')))for(const line of zlib.gunzipSync(fs.readFileSync(row.archive)).toString('utf8').split('\n').filter(Boolean))events.push(JSON.parse(line));
 const sessions=new Map();for(const e of events.filter(e=>e.kind==='boundary-lifecycle'||e.kind==='boundary'))if(e.receipt)sessions.set(e.receipt.sessionId,e.receipt);
  for(const b of sessions.values())if(b.exitCode===null){const end=summary.subprocesses.find(e=>e.phase==='exited'&&e.childPid===b.pid);b.observedState=b.state;b.state=end?.termination==='FORCED_TERMINATION'?'FORCED_TERMINATION':b.state;b.exitCode=end?.exitCode??null;b.terminationEvidence=end??null;b.terminationStatus=end?'PARENT_OBSERVED':'UNKNOWN_NO_FINAL_RECEIPT';b.productFailure=false;}
  return {command,exitCode:r.exitCode,summary,boundaries:[...sessions.values()],archive,remove:receipt,
 stdout:zlib.gunzipSync(fs.readFileSync(archive.find(e=>e.path==='stdout.log').archive)).toString('utf8'),
 stderr:zlib.gunzipSync(fs.readFileSync(archive.find(e=>e.path==='stderr.log').archive)).toString('utf8')};
}
export async function runOnce(c,{enable=false}={}) {
 for(const key of ['clone','tempRoot','isolationRoot','outputDirectory']){if(!path.isAbsolute(c[key]??''))throw Error(key+' must be absolute');noLinks(c[key]);}
 if(inside(c.clone,c.tempRoot)||inside(c.tempRoot,c.clone))throw Error('Clone and TEMP must be disjoint');
 if(!inside(c.tempRoot,c.outputDirectory)||!inside(c.tempRoot,c.isolationRoot))throw Error('Isolation and output must be under TEMP');
 if(inside(c.isolationRoot,c.outputDirectory)||inside(c.outputDirectory,c.isolationRoot))throw Error('Evidence and home/state must be disjoint');
 if(fs.existsSync(c.isolationRoot))throw Error('Fresh isolationRoot required');
 const allowed=[c.clone,c.isolationRoot,c.tempRoot];
 verifyWriteRoots(c.resolvedWriteRoots??[],allowed);
 if(!c.resolvedWriteRoots?.length)throw Error('Declare resolvedWriteRoots from actual target config before execution');
 if(!Array.isArray(c.command)||!c.command.length)throw Error('Target command required');
 if(!Array.isArray(c.boundaries))throw Error('Declare boundaries, including an empty list if none');
 if(c.boundaries.some(b=>b.sessionMode==='caller'&&Object.values(b.methods??{}).some(r=>r.finish)))throw Error('CALLER_SESSION_MUST_NOT_FINISH_EARLY');
  if(new Set(c.boundaries.map(b=>b.id)).size!==c.boundaries.length||c.boundaries.some(b=>!b.id||!b.executable))throw Error('Unique boundary IDs and executable selectors required');
 const dry=discoverDryRun(c.discoveryFiles??[],c.command);
 const plan={mode:'RUN_ONCE_STUBBED',allowedRoots:allowed,isolationRoot:c.isolationRoot,dryRun:dry,command:c.command,executed:false};
 if(!enable)return plan;
 fs.mkdirSync(c.isolationRoot,{recursive:true});fs.mkdirSync(path.dirname(c.outputDirectory),{recursive:true});
 const runtimeTemp=fs.mkdtempSync(path.join(c.tempRoot,'experiment-temp-'));
 const env={...Object.fromEntries(Object.entries(c.environment??{}).filter(([k])=>!/token|secret|key|credential|password|auth/i.test(k))),HOME:c.isolationRoot,USERPROFILE:c.isolationRoot,APPDATA:path.join(c.isolationRoot,'appdata'),LOCALAPPDATA:path.join(c.isolationRoot,'localappdata'),TEMP:runtimeTemp,TMP:runtimeTemp,TMPDIR:runtimeTemp,PYTHONDONTWRITEBYTECODE:'1'};
 for(const p of [env.APPDATA,env.LOCALAPPDATA])fs.mkdirSync(p,{recursive:true});
 const instrument={mode:'active',isolated:true,cwd:c.cwd??c.clone,writeRoots:allowed,executables:c.executables??[process.execPath],
 stopOnDeniedRoots:c.stopOnDeniedRoots??[],timeoutMs:c.timeoutMs,pythonExecutables:c.pythonExecutables??[],valueReceipts:c.valueReceipts??[],writeClass:c.writeClass??'unknown',wrapPythonChildren:true,network:'deny',allowCreatedExecutables:false,cleanEnvironment:true,environment:env,boundaries:c.boundaries,cassette:c.cassette,strictBoundaries:c.strictBoundaries};
 const priorTemp=process.env.TEMP,priorTmp=process.env.TMP;process.env.TEMP=c.tempRoot;process.env.TMP=c.tempRoot;
 let preflight=null,target;
 try{
 if(dry.command){preflight=await sample(instrument,dry.command,c.outputDirectory+'-dry');
 if(preflight.summary.denied.some(e=>(e.paths??[]).some(p=>p&&(c.stopOnDeniedRoots??[]).some(r=>inside(r,p)))))throw Error('STOP_ON_PROTECTED_DENY during dry-run');}
 target=await sample(instrument,c.command,c.outputDirectory);
 }finally{noLinks(runtimeTemp);if(!inside(c.tempRoot,runtimeTemp))throw Error('TEMP_ESCAPE');fs.rmSync(runtimeTemp,{recursive:true,force:true});if(priorTemp===undefined)delete process.env.TEMP;else process.env.TEMP=priorTemp;if(priorTmp===undefined)delete process.env.TMP;else process.env.TMP=priorTmp;}
 const gaps=gapList();gaps.push(...target.summary.gaps,...target.summary.denied.map(e=>({kind:'INSTRUMENT_DENIED',api:e.api,paths:e.paths??[],argv:e.argv??[]})));
 for(const b of target.boundaries)if(b.responses.some(r=>r.source==='BOUNDARY_STUB_FAILED'))gaps.push({kind:'BOUNDARY_STUB_FAILED',boundary:b.id});
 const protectedDeny=target.summary.denied.some(e=>(e.paths??[]).some(p=>p&&(c.stopOnDeniedRoots??[]).some(r=>inside(r,p))));
 const sources=[...c.discoveryFiles??[],...c.configSources??[]].map(p=>({path:p,sha256:digest(fs.readFileSync(p))}));
 const result={schema:'run-once-v1',contract:{...contract('EXECUTION',sources,[{name:'RUN_ONCE_STUBBED',semantics:'ISOLATED_STUBBED_EXECUTION_ONLY'}]),mode:'RUN_ONCE_STUBBED',realUse:false,businessAcceptance:false},
 status:protectedDeny||target.exitCode!==0?'FAIL':'UNKNOWN',processStatus:target.exitCode===0?'PASS':'FAIL',resultStatus:commandStatuses(target.stdout),resultJudgment:'UNKNOWN',testClassification:classifyTests(target.stdout,target.stderr,target.summary.denied),executed:true,realUse:false,businessAcceptance:false,
 isolation:{...plan,executed:true},preflight,target,gaps,stubbedBoundaries:target.boundaries.map(b=>b.id),
 limitation:'Exit status and boundary observations only. No real models, factory internals, real use or business acceptance established.'};
 save(c.outputDirectory+'.result.json',result);return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node run-once.mjs --config file [--enable]");process.exit(0);}

 const args=process.argv.slice(2);try{const p=args[args.indexOf('--config')+1],r=await runOnce(JSON.parse(fs.readFileSync(p,'utf8')),{enable:args.includes('--enable')});console.log(JSON.stringify(r,null,2));if(r.executed&&r.status!=='PASS')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}
}
