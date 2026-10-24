import {installCassette} from './cassette-runtime.mjs';
import {commandPolicy} from './cassette.mjs';
import dgram from 'node:dgram';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import cp from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readValueFile,valueReceipt} from './value-receipts.mjs';

const cfgFile=process.env.INSTRUMENT_CONFIG;
if(!cfgFile)throw Error('INSTRUMENT_CONFIG required');
const c=JSON.parse(fs.readFileSync(cfgFile,'utf8')),active=c.mode==='active';
const original={write:fs.writeFileSync.bind(fs),append:fs.appendFileSync.bind(fs),real:fs.realpathSync.bind(fs),exists:fs.existsSync.bind(fs),stat:fs.lstatSync.bind(fs)};
const logfile=path.join(c.eventsDirectory,process.pid+'.jsonl'),fds=new Map();let sequence=0;
const logfd=fs.openSync(logfile,'a'),rawWrite=fs.writeSync.bind(fs);
const key=p=>path.resolve(p).toLowerCase();
const generic=c.strictBoundaries||c.cassette?installCassette(c,emit):null;
const within=(root,p)=>{const r=path.relative(key(root),key(p));return !r||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
function resolvePath(p){
 if(typeof p==='number')return fds.get(p)??null;
 if(p instanceof URL)p=fileURLToPath(p);
 if(Buffer.isBuffer(p))p=p.toString();if(typeof p!=='string')return null;
 return path.resolve(p);
}
function safe(p){
 if(!p)return false;
 if(![...c.writeRoots,c.outputDirectory].some(r=>within(r,p)))return false;
 // Reject existing links anywhere on the path. This is conservative, not race-proof.
 for(let q=p;;q=path.dirname(q)){if(original.exists(q)&&original.stat(q).isSymbolicLink())return false;if(path.dirname(q)===q)break;}return true;
}
function emit(e){
 const row={at:new Date().toISOString(),pid:process.pid,cwd:process.cwd(),...e};
 try{rawWrite(logfd,JSON.stringify(row)+'\n',null,'utf8');}catch(error){if(active)throw error;}
}
function start(kind,api,detail,allowed=true){
 const e={id:process.pid+':'+(++sequence),kind,api,...detail,decision:active&&!allowed?'DENY':'ALLOW',phase:'attempt',
 stack:new Error().stack.split('\n').slice(2).filter(s=>!s.includes('instrument-recorder.mjs'))};
 emit(e);if(e.decision==='DENY'){if((e.paths??[]).some(p=>p&&(c.stopOnDeniedRoots??[]).some(r=>within(r,p))))original.write(path.join(c.eventsDirectory,'STOP_PROTECTED_DENY.json'),JSON.stringify(e));const err=Error('Instrumentation denied '+api);err.code='INSTRUMENT_DENIED';throw err;}return e;
}
const done=(e,err)=>emit({...e,phase:err?'error':'success',error:err?{code:err.code??null,message:err.message}:null});
const fdDetail=fd=>({fd,paths:[fds.get(fd)??null],inherited:fd<=2||!fds.has(fd)});
 function completed(e,value,base,before){
 if(base==='mkdtemp'){e.prefix=e.paths[0];e.paths=[resolvePath(value)];}
 e.createdPaths=e.paths.filter(p=>p&&!before.has(key(p))&&original.exists(p));done(e);
}
function ownExecutable(p){
 if(!c.allowCreatedExecutables||!safe(p)||!original.exists(p))return false;
 for(const name of fs.readdirSync(c.eventsDirectory)){
  if(!name.endsWith('.jsonl'))continue;
  for(const line of fs.readFileSync(path.join(c.eventsDirectory,name),'utf8').split('\n')){
   let e;try{e=JSON.parse(line);}catch{continue;}
   if(e.phase==='success'&&e.decision==='ALLOW'&&e.createdPaths?.some(q=>key(q)===key(p)))return true;
  }
 }return false;
}
const writing=flags=>typeof flags==='number'?!!(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_TRUNC)): /[wax+]/.test(flags??'r');
function pathsFor(name,args){
 const base=name.replace(/Sync$/,'');
 if(base==='rename')return [resolvePath(args[0]),resolvePath(args[1])];
 if(base==='link')return [resolvePath(args[1])];
 if(['copyFile','cp'].includes(base))return [resolvePath(args[1])];
 if(base==='symlink')return [resolvePath(args[1]),null]; // No link creation in active mode.
 return [resolvePath(args[0])];
}
const writes=['writeFile','appendFile','rename','copyFile','cp','mkdir','mkdtemp','rm','rmdir','unlink','truncate','chmod','chown','utimes','link','symlink'];
function wrap(obj,name,promise=false){
 const orig=obj[name];if(typeof orig!=='function')return;
 obj[name]=new Proxy(orig,{apply(target,self,args){
  const base=name.replace(/Sync$/,'');
  if(base==='open'&&!writing(args[1]))return Reflect.apply(target,self,args);
  const paths=pathsFor(name,args),fd=typeof args[0]==='number'?args[0]:null;
  const before=new Set(paths.filter(p=>p&&original.exists(p)).map(key));
   const priorValues=new Map(paths.filter(Boolean).map(p=>[p,readValueFile(p)]));
  const e=start('write',(promise?'fs.promises.':'fs.')+name,fd===null?{paths}:fdDetail(fd),fd!==null||paths.every(safe));
  // High-level write calls imply write-mode open; fd operations themselves are untouched.
  e.writeIntent=['open','writeFile','appendFile','rename','mkdir','mkdtemp','copyFile','cp'].includes(base);
  const success=value=>{if(base==='open'){const n=promise?value.fd:value;fds.set(n,paths[0]);e.fd=n;}completed(e,value,base,before);
   for(const p of e.paths.filter(Boolean)){const receipt=valueReceipt(p,priorValues.get(p)??{sha256:null},readValueFile(p),c.valueReceipts,process.env.TRACE_WRITE_CLASS??c.writeClass??'unknown');
   emit({...e,kind:'value-receipt',phase:'success',receipt,completeContent:['writeFile','appendFile','rename','copyFile'].includes(base)});}};
  if(promise){const result=Reflect.apply(target,self,args);result.then(success,error=>done(e,error));return result;}
  if(!name.endsWith('Sync')&&typeof args.at(-1)==='function'){
   const callback=args.at(-1);args=[...args];args[args.length-1]=function(error,...rest){if(error)done(e,error);else success(rest[0]);return Reflect.apply(callback,this,[error,...rest]);};
   try{return Reflect.apply(target,self,args);}catch(error){done(e,error);throw error;}
  }
  try{const value=Reflect.apply(target,self,args);success(value);return value;}catch(error){done(e,error);throw error;}
 }});
}
for(const name of [...writes,'open']){wrap(fs,name);wrap(fs,name+'Sync');wrap(fsp,name,true);}
// Streams and FileHandles keep their native objects and methods. Streams use fs.open.
function resolveExe(exe,options){
 if(path.isAbsolute(exe))return path.resolve(exe);
 if(exe.includes('/')||exe.includes('\\'))return path.resolve(options.cwd??process.cwd(),exe);
 const env=options.env??process.env;
 for(const dir of (env.PATH??env.Path??process.env.PATH??'').split(path.delimiter))for(const ext of process.platform==='win32'?['','.exe','.cmd','.bat']:['']){
  const p=path.resolve(dir,exe+ext);if(original.exists(p))return p;
 }return exe;
}
function pythonArgs(argv){
 let i=0;while(i<argv.length){
  const a=argv[i];if(a==='-m'||a==='-c'||a==='-'||!a.startsWith('-'))break;
  if(a==='--'){i++;break;}
  if(['--version','-V','--help','-h'].includes(a))return argv;
  if(['-X','-W','--check-hash-based-pycs'].includes(a))i+=2;else i++;
 }
 if(i>=argv.length)return argv;
 return [...argv.slice(0,i),c.pythonWrapper,'--out',c.coverageDirectory,'--config',cfgFile,'--',...argv.slice(i)];
}
function child(exe,argv,options,api){
 options={...options};const resolved=resolveExe(exe,options);
 if(generic?.hasSubprocess(exe,argv)){
  const response=generic.consume('subprocess',{executable:exe,argv});
  const event=start('process',api,{argv:[exe,...argv],stubbed:true},true);
  const env={...(options.env??process.env),TRACE_CASSETTE_RESPONSE:Buffer.from(JSON.stringify(response)).toString('base64')};
  delete env.NODE_OPTIONS;delete env.NODE_V8_COVERAGE;
  return {exe:c.nodeExecutable,argv:[c.cassetteProcess],options:{...options,env},event};
 }
 if(c.strictBoundaries&&commandPolicy([resolved,...argv]).status!=='PASS')start('process',api,{argv:[exe,...argv],reason:'HARD_BOUNDARY'},false);
 const boundary=active&&!options.shell&&(c.boundaries??[]).find(b=>b.executable&&(key(b.executable)===key(resolved)||!path.isAbsolute(b.executable)&&path.basename(resolved).toLowerCase()===b.executable.toLowerCase())&&(!b.argvPattern||new RegExp(b.argvPattern).test(argv.join(' '))));
 if(boundary){
  const env={...(options.env??process.env)},event=start('process',api,{argv:[exe,...argv],resolvedExecutable:resolved,childCwd:options.cwd??process.cwd(),boundaryId:boundary.id,stubbed:true},true);
  env.TRACE_BOUNDARY_CALL=Buffer.from(JSON.stringify({boundaryId:boundary.id,argv:[exe,...argv],cwd:options.cwd??process.cwd(),envNames:Object.keys(env).sort()})).toString('base64');
  env.INSTRUMENT_CONFIG=cfgFile;env.NODE_OPTIONS='--import='+pathToFileURL(c.recorder).href;delete env.NODE_V8_COVERAGE;
  return {exe:c.nodeExecutable,argv:[c.boundaryStub],options:{...options,env},event};
 }
 const created=ownExecutable(resolved);
 const allowed=(c.executables.some(x=>key(x)===key(resolved))||created)&&!options.shell&&!(c.denyCommandPatterns??[]).some(p=>new RegExp(p,'i').test([resolved,...argv].join(' ')));
 const event=start('process',api,{argv:[exe,...argv],resolvedExecutable:resolved,createdExecutable:created,childCwd:options.cwd??process.cwd()},allowed);
 const isNode=key(resolved)===key(c.nodeExecutable),isPython=c.pythonExecutables.some(p=>key(p)===key(resolved))||(created&&/^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i.test(path.basename(resolved)));
 if(isNode||isPython){
 const env={...(options.env??process.env)},option='--import='+pathToFileURL(c.recorder).href;
 env.INSTRUMENT_CONFIG=cfgFile;env.NODE_V8_COVERAGE=c.coverageDirectory;
 env.NODE_OPTIONS=((env.NODE_OPTIONS??'').includes(option)?env.NODE_OPTIONS:((env.NODE_OPTIONS??'')+' '+option).trim());
 env.PYTHONDONTWRITEBYTECODE='1';options.env=env;
 if(isPython&&c.wrapPythonChildren)argv=pythonArgs(argv);
 }
 emit({...event,phase:'prepared',effectiveArgv:[resolved,...argv],instrumented:isNode||(isPython&&argv.includes(c.pythonWrapper))});
 return {exe:resolved,argv,options,event};
}
const nativeSpawn=cp.ChildProcess.prototype.spawn;
cp.ChildProcess.prototype.spawn=new Proxy(nativeSpawn,{apply(target,self,args){
 const o=args[0],env=Object.fromEntries((o.envPairs??[]).map(v=>{const i=v.indexOf('=',1);return [v.slice(0,i),v.slice(i+1)];}));
 const r=child(o.file,o.args.slice(1),{cwd:o.cwd??process.cwd(),env,shell:o.shell},'ChildProcess.prototype.spawn');
 const options={...o,file:r.exe,args:[r.exe,...r.argv],envPairs:Object.entries(r.options.env??env).map(([k,v])=>k+'='+v)};
 try{const result=Reflect.apply(target,self,[options]);emit({...r.event,phase:'started',childPid:self.pid??null});self.once('exit',(code,signal)=>emit({...r.event,phase:'exited',childPid:self.pid??null,exitCode:code,signal,termination:signal?'FORCED_TERMINATION':'EXITED'}));return result;}catch(error){done(r.event,error);throw error;}
}});
for(const name of ['spawnSync','execFileSync']){
 const orig=cp[name];cp[name]=new Proxy(orig,{apply(target,self,args){
  const [exe,...rest]=args,argv=Array.isArray(rest[0])?rest.shift():[],options=rest[0]??{};
  const r=child(exe,argv,options,'child_process.'+name);
  try{const result=Reflect.apply(target,self,[r.exe,r.argv,r.options]);emit({...r.event,phase:'started',childPid:result?.pid??null});return result;}catch(error){done(r.event,error);throw error;}
 }});
}
cp.execSync=new Proxy(cp.execSync,{apply(target,self,args){start('process','child_process.execSync',{argv:[args[0]],shell:true},false);return Reflect.apply(target,self,args);}});
function destination(args){
 let a=args[0];if(Array.isArray(a))a=a[0];
 if(a&&typeof a==='object')return {host:a.host??'localhost',port:a.port??null,path:a.path??null};
 if(typeof a==='string'&&!/^\d+$/.test(a))return {host:null,path:a,port:null};
 return {host:typeof args[1]==='string'?args[1]:'localhost',port:a,path:null};
}
const loopback=h=>['localhost','127.0.0.1','::1','[::1]'].includes(String(h).toLowerCase());
for(const [obj,name,label] of [[net.Socket.prototype,'connect','net.Socket.connect'],[tls,'connect','tls.connect']]){
 const orig=obj[name];obj[name]=new Proxy(orig,{apply(target,self,args){const d=destination(args);start('network',label,d,c.network==='loopback'&&!d.path&&loopback(d.host));return Reflect.apply(target,self,args);}});
}
if(c.strictBoundaries){
 const originalListen=net.Server.prototype.listen;
 net.Server.prototype.listen=function(...args){start('network','net.Server.listen',{arguments:args.map(x=>typeof x)},false);return originalListen.apply(this,args);};
 for(const name of ['send','connect','bind']){const orig=dgram.Socket.prototype[name];dgram.Socket.prototype[name]=function(...args){start('network','dgram.'+name,{},false);return orig.apply(this,args);};}
}
syncBuiltinESMExports();
emit({kind:'lifecycle',api:'recorder.ready',decision:'ALLOW',phase:'success',mode:c.mode});
