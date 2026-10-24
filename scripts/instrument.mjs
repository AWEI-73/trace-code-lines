import {gapList} from './gap-shape.mjs';
import {fileSnapshot,changedPaths} from './file-snapshot.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
export const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
export const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n','utf8');
export function inside(root,p){const r=path.relative(path.resolve(root),path.resolve(p));return !r||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
export function noLinks(p){for(let q=path.resolve(p);;q=path.dirname(q)){if(fs.existsSync(q)&&fs.lstatSync(q).isSymbolicLink())throw Error('Linked path refused: '+q);if(path.dirname(q)===q)break;}}
function executable(p){
 if(path.isAbsolute(p))return path.resolve(p);
 for(const d of (process.env.PATH??'').split(path.delimiter))for(const ext of process.platform==='win32'?['','.exe','.cmd','.bat']:['']){
  const q=path.resolve(d,p+ext);if(fs.existsSync(q)&&fs.statSync(q).isFile())return q;
 }throw Error('Executable not found: '+p);
}
export function config(file,overrides={}){
 const raw=fs.readFileSync(file),c={...JSON.parse(raw),...overrides};
 if(!['active','passive'].includes(c.mode??'active'))throw Error('mode must be active or passive');c.mode??='active';
 for(const k of ['cwd','outputDirectory'])if(!path.isAbsolute(c[k]??''))throw Error(k+' must be absolute');
 const temp=process.env.TEMP??process.env.TMP;
 if(!temp||!inside(temp,c.outputDirectory)||path.resolve(temp)===path.resolve(c.outputDirectory))throw Error('outputDirectory must be a child of TEMP');
 for(const p of [c.cwd,c.outputDirectory])noLinks(p);
 if(!fs.statSync(c.cwd).isDirectory())throw Error('cwd must exist');
 if(!Array.isArray(c.writeRoots)||!Array.isArray(c.executables)||!c.executables.length)throw Error('writeRoots and executables required');
 c.writeRoots=c.writeRoots.map(p=>{if(!path.isAbsolute(p))throw Error('Absolute write root required');noLinks(p);return path.resolve(p);});
 c.executables=c.executables.map(executable);c.pythonExecutables=(c.pythonExecutables??[]).map(executable);
 if(c.pythonExecutables.some(p=>!c.executables.includes(p)))throw Error('Python must be allowlisted');
 if(c.mode==='active'&&c.isolated!==true)throw Error('active requires isolated:true');
 if(c.network!==undefined&&!['deny','loopback'].includes(c.network))throw Error('network must be deny or loopback');
 if(c.allowCreatedExecutables!==undefined&&typeof c.allowCreatedExecutables!=='boolean')throw Error('allowCreatedExecutables must be boolean');
 c.allowCreatedExecutables??=false;
 c.network??='deny';c.cwd=path.resolve(c.cwd);c.outputDirectory=path.resolve(c.outputDirectory);c.configSha256=digest(raw);return c;
}
function environment(c){
 return {NODE_OPTIONS:((c.cleanEnvironment?'':process.env.NODE_OPTIONS??'')+' --import='+pathToFileURL(path.join(c.outputDirectory,'instrument-recorder.mjs')).href).trim(),
 NODE_V8_COVERAGE:path.join(c.outputDirectory,'coverage'),INSTRUMENT_CONFIG:path.join(c.outputDirectory,'runtime-config.json'),PYTHONDONTWRITEBYTECODE:'1'};
}
export function plan(file,overrides={}){
 const c=config(file,overrides),env=environment(c);
 return {schema:'instrument-plan-v1',config:c,environmentChanges:Object.entries(env).map(([name,after])=>({name,before:process.env[name]??null,after})),
 argvRewrite:c.wrapPythonChildren?'Keep interpreter flags; insert py-trace-run.py --out <coverage> --config <runtime-config> -- before script/-m/-c':'none',
 outputDirectory:c.outputDirectory,safety:{mode:c.mode,isolated:c.isolated===true,outputUnderTemp:true,noLinkedRoots:true,network:c.network,executables:c.executables},
 limitations:['Runtime API hooks are not an OS sandbox. Native code, direct syscalls, detached children, workers and uninstrumented executables are not fully observed.',
 'Only instrument-owned output files are removed. Target writes remain target-owned.','Coverage includes module evaluation and preparation; it does not certify business correctness.']};
}
function tree(root){
 const files=[],directories=[];function visit(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isSymbolicLink())throw Error('Link in instrument output: '+p);
 if(e.isDirectory()){directories.push(p);visit(p);}else if(e.isFile())files.push({path:p,sha256:digest(fs.readFileSync(p)),hashKind:'bytes'});}}visit(root);return {files,directories};
}
function manifestHash(m){const n=structuredClone(m);for(const f of n.files)if(f.hashKind==='manifest-without-self-sha256')f.sha256=null;return digest(JSON.stringify(n));}
function seal(m,manifest){m.files=m.files.filter(f=>f.path!==manifest);m.files.push({path:manifest,sha256:null,hashKind:'manifest-without-self-sha256'});m.files.at(-1).sha256=manifestHash(m);save(manifest,m);}
function setup(p){
 const c=p.config,out=c.outputDirectory;if(fs.existsSync(out))throw Error('Output must not exist: '+out);
 fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(out,'coverage'));fs.mkdirSync(path.join(out,'events'));
 const recorders=['instrument-recorder.mjs','py-trace-run.py','boundary-stub.mjs','value-receipts.mjs','cassette.mjs','cassette-runtime.mjs','cassette-process.mjs'];for(const name of recorders)fs.copyFileSync(path.join(here,name),path.join(out,name));
 save(path.join(out,'runtime-config.json'),{...c,nodeExecutable:process.execPath,recorder:path.join(out,'instrument-recorder.mjs'),pythonWrapper:path.join(out,'py-trace-run.py'),
 boundaryStub:path.join(out,'boundary-stub.mjs'),cassetteProcess:path.join(out,'cassette-process.mjs'),cassetteState:path.join(out,'cassette-state.json'),coverageDirectory:path.join(out,'coverage'),eventsDirectory:path.join(out,'events')});
 return {schema:'instrument-manifest-v1',configSha256:c.configSha256,config:c,command:null,cwd:c.cwd,environmentChanges:p.environmentChanges,
 recorders:recorders.map(n=>({path:path.join(out,n),sha256:digest(fs.readFileSync(path.join(out,n)))})),startedAt:new Date().toISOString(),endedAt:null,exitCode:null,files:[],directories:[],limitations:p.limitations};
}
export async function run(file,command,{enable=false}={}){
 const p=plan(file);if(!enable)return {...p,executed:false};
 if(!command?.length)throw Error('Command required after --');
 const c=p.config,exe=executable(command[0]);
 if(c.mode==='active'&&!c.executables.some(x=>x.toLowerCase()===exe.toLowerCase()))throw Error('Initial executable not allowlisted');
 if(path.resolve(exe).toLowerCase()!==path.resolve(process.execPath).toLowerCase())throw Error('Initial command must use this Node executable');
 const m=setup(p),out=c.outputDirectory,manifest=path.join(out,'instrument-manifest.json');m.beforeSnapshot=fileSnapshot(c.writeRoots,[out]);m.command=[exe,...command.slice(1)];save(manifest,m);
 const stdout=fs.openSync(path.join(out,'stdout.log'),'wx'),stderr=fs.openSync(path.join(out,'stderr.log'),'wx');
 try{
 const child=spawn(exe,command.slice(1),{cwd:c.cwd,env:{...(c.cleanEnvironment?Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT'].includes(k.toUpperCase()))):process.env),...c.environment,...environment(c)},stdio:['ignore',stdout,stderr],windowsHide:true});
 m.rootPid=child.pid;let stopped=false;const stop=reason=>{if(stopped)return;stopped=true;m.stoppedReason=reason;if(process.platform==='win32'&&child.pid){spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>child.kill());}else child.kill('SIGKILL');};
 const timer=c.timeoutMs?setTimeout(()=>stop('TIMEOUT'),c.timeoutMs):null;
 const watch=setInterval(()=>{if(fs.existsSync(path.join(out,'events','STOP_PROTECTED_DENY.json')))stop('PROTECTED_DENY');},50);
 const r=await new Promise(resolve=>{child.once('error',error=>resolve({code:null,error:error.message}));child.once('close',(code,signal)=>resolve({code,signal}));});clearInterval(watch);if(timer)clearTimeout(timer);
 m.exitCode=r.code;m.signal=r.signal??null;m.error=r.error??null;
 }finally{m.cleanup=await cleanupProcesses(out,m.rootPid);fs.closeSync(stdout);fs.closeSync(stderr);m.endedAt=new Date().toISOString();m.afterSnapshot=fileSnapshot(c.writeRoots,[out]);Object.assign(m,tree(out));seal(m,manifest);}
 return {manifest,exitCode:m.exitCode,outputDirectory:out,executed:true};
}
async function cleanupProcesses(out,rootPid){
 const pids=new Set(rootPid?[rootPid]:[]),attempts=[],errors=[];
 for(const f of fs.readdirSync(path.join(out,'events')).filter(n=>n.endsWith('.jsonl'))){
  for(const line of fs.readFileSync(path.join(out,'events',f),'utf8').split('\n').filter(Boolean)){
   try{const e=JSON.parse(line);if(e.childPid)pids.add(e.childPid);}catch{}
  }
 }
 if(process.platform==='win32'){
  for(const pid of pids){const r=spawnSync('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true});attempts.push({pid,exitCode:r.status,stderrBase64:r.stderr?.toString('base64')??'',encoding:'platform-bytes'});}
  const list=spawnSync('tasklist.exe',['/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true}),ports=spawnSync('netstat.exe',['-ano'],{encoding:'utf8',windowsHide:true});
  const remaining=(list.stdout??'').split(/\r?\n/).filter(l=>{const m=l.match(/^"[^"]+","(\d+)"/);return m&&pids.has(Number(m[1]));});
  const listeners=(ports.stdout??'').split(/\r?\n/).filter(l=>/LISTENING/.test(l)&&pids.has(Number(l.trim().split(/\s+/).at(-1))));
  return {status:remaining.length||listeners.length?'FAIL':list.status!==0||ports.status!==0?'UNKNOWN':'PASS',pids:[...pids],attempts,remaining,listeners,scope:'Instrumented process tree; no OS sandbox',verificationErrors:[list.error?.message,ports.error?.message].filter(Boolean)};
 }
 for(const pid of pids){try{process.kill(pid,'SIGKILL');attempts.push({pid,status:'KILLED'});}catch(e){if(e.code!=='ESRCH')errors.push(e.message);}}
 // SIGKILL delivery is asynchronous. Give the OS a bounded interval to reap children.
 const deadline=Date.now()+500;
 while(Date.now()<deadline&&[...pids].some(pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}))await new Promise(resolve=>setTimeout(resolve,25));
 return {...verifyCleanup([...pids]),pids:[...pids],attempts,errors};
}

// Read-only adapter; injected OS operations let every host exercise all branches.
export function verifyCleanup(pids,{platform=process.platform,kill=process.kill,readFile=fs.readFileSync,readdir=fs.readdirSync,readlink=fs.readlinkSync,command=spawnSync}={}){
 const remaining=[],listeners=[],verificationErrors=[];
 const error=(where,e)=>verificationErrors.push(where+': '+(e.code??e.message??e));
 const exists=pid=>{try{kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;if(e.code==='EPERM')return true;error('process '+pid,e);return null;}};
 for(const pid of pids)if(exists(pid)===true)remaining.push(pid);
 if(platform==='linux'){
  const sockets=new Map();
  for(const table of ['/proc/net/tcp','/proc/net/tcp6'])try{
   const lines=readFile(table,'utf8').trim().split(/\r?\n/);
   if(!/local_address/.test(lines.shift()??''))throw Error('Invalid TCP table header');
   for(const line of lines.filter(l=>l.trim())){
    const cells=line.trim().split(/\s+/);
    if(cells.length<10||!/^\d+:$/.test(cells[0])||! /^[0-9A-F]{2}$/i.test(cells[3])||!/^\d+$/.test(cells[9]))throw Error('Invalid TCP table row');
    if(cells[3]==='0A')sockets.set(cells[9],{table,inode:cells[9],localAddress:cells[1]});
   }
  }catch(e){error(table,e);}
  for(const pid of pids){
   const dir='/proc/'+pid+'/fd';let fds;
   try{fds=readdir(dir);}catch(e){if(e.code==='ENOENT'&&exists(pid)===false)continue;error(dir,e);continue;}
   for(const fd of fds)try{
    const link=readlink(dir+'/'+fd),inode=link.match(/^socket:\[(\d+)\]$/)?.[1];
    if(inode&&sockets.has(inode))listeners.push({pid,fd,...sockets.get(inode)});
   }catch(e){if(e.code!=='ENOENT')error(dir+'/'+fd,e);}
  }
 }else if(platform==='darwin'){
  if(pids.length){
   const r=command('lsof',['-nP','-iTCP','-sTCP:LISTEN','-a','-p',pids.join(',')],{encoding:'utf8',windowsHide:true,timeout:5000});
   const stdout=String(r.stdout??''),stderr=String(r.stderr??'').trim();
   if(r.error)error('lsof',r.error);
   if(r.status!==0&&!(r.status===1&&!stdout.trim()&&!stderr))error('lsof','exit '+r.status);
   if(stderr)error('lsof',stderr);
   if(r.status===0){
    const lines=stdout.trim().split(/\r?\n/),header=lines.shift()??'';
    if(!/^COMMAND\s+PID\s/.test(header)||!lines.length)error('lsof','Invalid listener output');
    for(const line of lines){const cells=line.trim().split(/\s+/),pid=Number(cells[1]);
     if(pids.includes(pid)&&/\(LISTEN\)\s*$/.test(line))listeners.push({pid,line});
     else error('lsof','Unrecognized listener row');
    }
   }
  }
 }else error('listeners','Unsupported platform: '+platform);
 const status=remaining.length||listeners.length?'FAIL':verificationErrors.length?'UNKNOWN':'PASS';
 return {status,remaining,listeners,verificationErrors,scope:'Instrumented process tree; no OS sandbox',...(verificationErrors.length?{reason:verificationErrors.join('; ')}:{})};
}
export function loadManifest(file){
 const m=read(file),out=m.config?.outputDirectory;
 if(m.schema!=='instrument-manifest-v1'||!out||path.resolve(file)!==path.join(path.resolve(out),'instrument-manifest.json'))throw Error('Invalid manifest location/schema');
 noLinks(out);const self=m.files.find(f=>f.path===path.resolve(file)&&f.hashKind==='manifest-without-self-sha256');
 if(!self||self.sha256!==manifestHash(m))throw Error('Manifest hash mismatch');
 for(const f of m.files){if(!inside(out,f.path)||path.resolve(f.path)===path.resolve(out))throw Error('Manifest file outside owned output');noLinks(f.path);}
 for(const p of m.directories){if(!inside(out,p)||path.resolve(p)===path.resolve(out))throw Error('Manifest directory outside output');noLinks(p);}return m;
}
export function collect(file){
 const m=loadManifest(path.resolve(file)),events=[],gaps=gapList();
 for(const f of m.files.filter(f=>f.path.endsWith('.jsonl'))){
 if(!fs.existsSync(f.path)||digest(fs.readFileSync(f.path))!==f.sha256){gaps.push({path:f.path,kind:'EVENT_HASH_MISMATCH'});continue;}
 fs.readFileSync(f.path,'utf8').split('\n').filter(Boolean).forEach((line,i)=>{try{events.push({...JSON.parse(line),evidence:{path:f.path,line:i+1,sha256:f.sha256}});}catch(e){gaps.push({path:f.path,line:i+1,kind:'INVALID_EVENT'});}});
 }
 const logs={};
  for(const name of ['stdout','stderr']){
    const target=path.join(m.config.outputDirectory,name+'.log'),listed=m.files.find(f=>f.path===target);
    try{
      const bytes=fs.readFileSync(target),sha256=digest(bytes),matched=listed?.sha256===sha256;
      if(!matched)gaps.push({kind:'LOG_HASH_MISMATCH',path:target});
      logs[name]={path:target,sha256,bytes:bytes.length,tail:bytes.toString('utf8').slice(-4096),tailCharacters:4096,status:matched?'PASS':'UNKNOWN'};
    }catch(e){logs[name]={path:target,status:'UNKNOWN',sha256:null,tail:null};gaps.push({kind:'LOG_UNKNOWN',path:target,detail:e.message});}
  }
  const changes=m.beforeSnapshot&&m.afterSnapshot?changedPaths(m.beforeSnapshot,m.afterSnapshot):[];
 const changed=new Map(changes.map(x=>[path.resolve(x.path).toLowerCase(),x]));
 if(!m.beforeSnapshot||!m.afterSnapshot)gaps.push({kind:'SNAPSHOT_MISSING'});
 gaps.push(...(m.beforeSnapshot?.gaps??[]),...(m.afterSnapshot?.gaps??[]));
 const writeEvents=events.filter(e=>e.kind==='write'&&e.decision==='ALLOW'&&(e.phase==='success'||e.audit));
 const writes=writeEvents.filter(e=>e.writeIntent&&e.paths?.some(p=>p&&changed.has(path.resolve(p).toLowerCase()))).map(e=>({...e,snapshotEvidence:e.paths.filter(p=>p&&changed.has(path.resolve(p).toLowerCase())).map(p=>changed.get(path.resolve(p).toLowerCase())),evidenceBasis:'Write-mode open or namespace write event AND before/after snapshot change'}));
 const valueReceipts=events.filter(e=>e.kind==='value-receipt'&&e.phase==='success'&&e.decision==='ALLOW');
  for(const e of valueReceipts)if(e.completeContent&&e.receipt.changed&&e.receipt.sha256)writes.push({...e,kind:'write',snapshotEvidence:[{path:e.receipt.path,before:{sha256:e.receipt.beforeSha256},after:{type:'file',sha256:e.receipt.sha256},receiptId:e.id}],evidenceBasis:'Successful write and immediate before/after content receipt'});
  const roots=[...m.config.writeRoots,m.config.outputDirectory].sort((a,b)=>b.length-a.length),byRoot={};
 for(const e of writes){const root=roots.find(r=>e.paths?.some(p=>p&&inside(r,p)))??'UNMAPPED';(byRoot[root]??=[]).push(e);}
 const result={schema:'instrument-collect-v1',manifest:path.resolve(file),manifestSha256:digest(fs.readFileSync(file)),mode:m.config.mode,
 startedAt:m.startedAt,endedAt:m.endedAt,exitCode:m.exitCode,logs,writes,writeEvents,valueReceipts,snapshotChanges:changes,byRoot,denied:events.filter(e=>e.decision==='DENY'),
 cleanup:m.cleanup??null,subprocesses:events.filter(e=>e.kind==='process'),network:events.filter(e=>e.kind==='network'),gaps,
 counts:{events:events.length,writes:writes.length,denied:events.filter(e=>e.decision==='DENY').length},limitations:m.limitations};
 const target=path.join(m.config.outputDirectory,'instrument-collect.json');if(fs.existsSync(target))throw Error('Collect output exists; preserve original evidence');
 save(target,result);m.files.push({path:target,sha256:digest(fs.readFileSync(target)),hashKind:'bytes'});seal(m,path.resolve(file));return result;
}
export function remove(file){
  const m=loadManifest(path.resolve(file)),deleted=[],preserved=[],out=m.config.outputDirectory;
  // Only installed instrumentation is disposable; measurements remain evidence.
  const owned=new Map(m.recorders.map(f=>[f.path,f]));
  for(const name of ['runtime-config.json',...(m.launcher?['launch.cjs']:[])]){
    const target=path.join(out,name),listed=m.files.find(f=>f.path===target&&f.hashKind==='bytes');
    if(listed)owned.set(target,listed);
  }
  for(const f of owned.values()){
    if(!inside(out,f.path)||path.resolve(f.path)===path.resolve(out))throw Error('Recorder outside owned output');
    noLinks(f.path);if(!fs.existsSync(f.path))continue;
    if(digest(fs.readFileSync(f.path))!==f.sha256){preserved.push({path:f.path,reason:'HASH_CHANGED'});continue;}
    fs.unlinkSync(f.path);deleted.push(f.path);
  }
  const remaining=tree(out),listed=new Map(m.files.map(f=>[f.path,f])),retained=[];
  for(const f of remaining.files){
    if(owned.has(f.path))continue;
    const original=listed.get(f.path);
    if(!original)preserved.push({path:f.path,reason:'UNLISTED'});
    else if(original.hashKind==='bytes'&&original.sha256!==f.sha256)preserved.push({path:f.path,reason:'HASH_CHANGED'});
    else retained.push({...f,reason:'EVIDENCE_RETAINED'});
  }
  const unexpectedDirectories=remaining.directories.filter(p=>!m.directories.includes(p));
  return {schema:'instrument-remove-v1',at:new Date().toISOString(),deleted,preserved,retained,remaining,unexpectedDirectories,outputDirectoryRemoved:false,
    status:preserved.length||unexpectedDirectories.length?'PARTIAL':'PASS'};
}
export function passiveLauncher(file,launcher){
 const p=plan(file,{mode:'passive'});launcher=path.resolve(launcher);noLinks(launcher);if(!fs.statSync(launcher).isFile())throw Error('Launcher must be a file');
 const m=setup(p),out=p.outputDirectory;m.beforeSnapshot=fileSnapshot(p.config.writeRoots,[out]);m.launcher={path:launcher,sha256:digest(fs.readFileSync(launcher))};
 const wrapper=path.join(out,'launch.cjs'),ascii=s=>JSON.stringify(s).replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 const body="const cp=require('node:child_process');\nconst r=cp.spawnSync(process.execPath,["+ascii(launcher)+",...process.argv.slice(2)],{cwd:"+ascii(p.config.cwd)+",env:{...process.env,..."+ascii(environment(p.config))+"},stdio:'inherit',windowsHide:true});\nprocess.exitCode=r.status===null?1:r.status;\n";
 fs.writeFileSync(wrapper,body,'utf8');m.endedAt=new Date().toISOString();m.command=[process.execPath,wrapper];Object.assign(m,tree(out));seal(m,path.join(out,'instrument-manifest.json'));
 return {wrapper,manifest:path.join(out,'instrument-manifest.json'),originalUnchanged:true,
 install:'Use node <wrapper> only after user authorization to change the launch command. Original launcher/config are untouched.',
 remove:'After use, finalize then collect then remove --manifest <manifest>.'};
}
export function finalize(file){
 const m=loadManifest(path.resolve(file));if(m.config.mode!=='passive')throw Error('finalize only for passive launcher');
 m.afterSnapshot=fileSnapshot(m.config.writeRoots,[m.config.outputDirectory]);const now=tree(m.config.outputDirectory),known=new Set(m.files.map(f=>f.path));for(const f of now.files)if(!known.has(f.path))m.files.push(f);
 m.directories=[...new Set([...m.directories,...now.directories])];m.endedAt=new Date().toISOString();seal(m,path.resolve(file));return {manifest:file,files:m.files.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node instrument.mjs plan|run|collect|remove|finalize --config file or --manifest file [--enable]");process.exit(0);}

 const a=process.argv.slice(2),cmd=a.shift(),get=k=>a[a.indexOf(k)+1];
 try{let r;
 if(cmd==='plan'&&get('--mode')==='passive'&&a.includes('--launcher'))r=passiveLauncher(get('--config'),get('--launcher'));
 else if(cmd==='plan')r=plan(get('--config'),a.includes('--mode')?{mode:get('--mode')}:{});
 else if(cmd==='run')r=await run(get('--config'),a.includes('--')?a.slice(a.indexOf('--')+1):[],{enable:a.includes('--enable')});
 else if(cmd==='collect')r=collect(get('--manifest'));
 else if(cmd==='remove')r=remove(get('--manifest'));
 else if(cmd==='finalize')r=finalize(get('--manifest'));
 else throw Error('Usage: instrument.mjs plan|run|collect|remove|finalize --config <file> or --manifest <file>');
 console.log(JSON.stringify(r,null,2));if(cmd==='run'&&r.executed&&r.exitCode!==0)process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
