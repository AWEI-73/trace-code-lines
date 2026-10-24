import fs from 'node:fs';
import {resolvePython} from './python-path.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {plan,run,collect,remove,passiveLauncher,finalize,digest,verifyCleanup} from './instrument.mjs';
import {reconcile} from './coverage-reconcile.mjs';
export async function instrumentChecks(root){
 fs.mkdirSync(root,{recursive:true});
 const put=(name,data)=>{const p=path.join(root,name);fs.writeFileSync(p,typeof data==='string'?data:JSON.stringify(data,null,2)+'\n','utf8');return p;};
 const python=resolvePython();
 const allowed=path.join(root,'allowed');fs.mkdirSync(allowed);
 const py=put('child.py',[
 'import sys, os, json, threading, socket',
 'assert sys.flags.isolated == 1',
 'assert sys._xoptions.get("utf8") is True',
 'assert sys.argv[1:] == ["sentinel"]',
 'with open("allowed/python.txt","w",encoding="utf-8") as f: f.write("ok")',
 'try:',
 '    open("forbidden-python.txt","w")',
 'except PermissionError as e: assert e.code == "INSTRUMENT_DENIED"',
 'else: raise AssertionError("write not denied")',
 'try:',
 '    socket.socket().connect(("127.0.0.1", 1))',
 'except PermissionError as e: assert e.code == "INSTRUMENT_DENIED"',
 'else: raise AssertionError("network not denied")',
 'def worker():',
 '    with open("allowed/thread.txt","w") as f: f.write("thread")',
 't=threading.Thread(target=worker);t.start();t.join()',
 "print(\"PYTHON_OK\")",
 "os.write(1, b\"PY_STDOUT\")",
 "os.write(2, b\"PY_STDERR\")",
 "fd=os.open(\"allowed/python-fd.txt\",os.O_WRONLY|os.O_CREAT)",
 "os.write(fd,b\"checked\")",
 "os.close(fd)",
 "with open(\"allowed/python-proxy.txt\",\"w\") as f: f.write(\"proxy\")",
"import tempfile",
 "with tempfile.NamedTemporaryFile(dir=\"allowed\",prefix=\"named-temp-\",delete=False) as f:",
 "    f.write(b\"temporary\")",
 "    f.flush()",
 "    os.fsync(f.fileno())",
 "f.close()",
 "fd=os.open(\"allowed/closefd-false.txt\",os.O_WRONLY|os.O_CREAT)",
 "with open(fd,\"w\",closefd=False) as f: f.write(\"kept\")",
 "os.write(fd,b\"still-open\")",
 "os.close(fd)",
 "import shutil, subprocess",
 "shutil.copy("+JSON.stringify(process.execPath)+", \"allowed/from-python-node.exe\")",
 "subprocess.run([\"allowed/from-python-node.exe\",\"-e\",\"process.stdout.write(\\\"OWNED_OK\\\")\"],check=True)",
 "try:",
 "    subprocess.run([\"allowed/preexisting.exe\",\"-e\",\"0\"])",
 "except PermissionError as e: assert e.code == \"INSTRUMENT_DENIED\"",
 "else: raise AssertionError(\"preexisting executable allowed\")",''].join('\n'));
 const preexisting=path.join(allowed,'preexisting.exe');fs.copyFileSync(process.execPath,preexisting);
 const child=put('child.mjs',[
 "import {writeFileSync} from 'node:fs';",
 "writeFileSync('allowed/child.txt','child');",
 "try{writeFileSync('child-denied.txt','no');throw Error('allowed');}catch(e){if(e.code!=='INSTRUMENT_DENIED')throw e;}",
 "console.log('CHILD_OK');",
 "if(process.env.EXTRA_FD){const fs=await import('node:fs');fs.writeSync(3,'inherited-extra');}",''].join('\n'));
 const entry=put('entry.mjs',[
 "import fs,{writeFileSync} from 'node:fs';",
 "import {writeFile,rename,copyFile,mkdir,unlink,rm,open} from 'node:fs/promises';",
 "import {spawnSync,execFileSync,spawn,execFile,fork} from 'node:child_process';",
 "import net from 'node:net';import tls from 'node:tls';",
 "import assert from 'node:assert/strict';",
 "writeFileSync('allowed/named.txt','named');",
 "await writeFile('allowed/promise.txt','promise');",
 "await copyFile('allowed/promise.txt','allowed/copy.txt');await rename('allowed/copy.txt','allowed/renamed.txt');",
 "await mkdir('allowed/dir');await rm('allowed/dir',{recursive:true});",
 "await writeFile('allowed/delete.txt','x');await unlink('allowed/delete.txt');",
 "const h=await open('allowed/handle.txt','w');await h.writeFile('handle');await h.close();",
 "await new Promise((r,j)=>{const s=fs.createWriteStream('allowed/stream.txt');s.on('finish',r).on('error',j);s.end('stream');});",
 "assert.throws(()=>writeFileSync('forbidden.txt','no'),{code:'INSTRUMENT_DENIED'});",
 "assert.throws(()=>net.connect({host:'127.0.0.1',port:1}),{code:'INSTRUMENT_DENIED'});",
 "assert.throws(()=>tls.connect({host:'127.0.0.1',port:1}),{code:'INSTRUMENT_DENIED'});",
 "assert.throws(()=>spawnSync('not-allowlisted',[]),{code:'INSTRUMENT_DENIED'});",
 "const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP};",
 "const child="+JSON.stringify(child)+";",
 "let r=spawnSync(process.execPath,[child],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/CHILD_OK/);",
 "assert.match(execFileSync(process.execPath,[child],{env,encoding:'utf8'}),/CHILD_OK/);",
 "await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[child],{env,stdio:'ignore'});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('spawn '+code)));});",
 "await new Promise((resolve,reject)=>execFile(process.execPath,[child],{env},(e,out)=>e?reject(e):resolve(out)));",
 "await new Promise((resolve,reject)=>{const p=fork(child,[],{env,stdio:'ignore'});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('fork '+code)));});",
 "r=spawnSync("+JSON.stringify(python)+",['-I','-B','-X','utf8',"+JSON.stringify(py)+",'sentinel'],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PYTHON_OK/);assert.match(r.stdout,/PY_STDOUT/);assert.match(r.stderr,/PY_STDERR/);fs.writeFileSync('allowed/python-captured.json',JSON.stringify({status:r.status,stdout:r.stdout,stderr:r.stderr}));",
 "fs.writeSync(1,'STDOUT_FD');fs.writeSync(2,'STDERR_FD');",
 "const fd=fs.openSync('allowed/fd.txt','w');fs.writeSync(fd,'sync');await new Promise((r,j)=>fs.write(fd,'async',e=>e?j(e):r()));fs.closeSync(fd);",
 "const h2=await open('allowed/handle-write.txt','w');await h2.write('handle');await h2.close();",
 "const extra=fs.openSync('allowed/inherited.txt','w');r=spawnSync(process.execPath,[child],{env:{...env,EXTRA_FD:'1'},stdio:['ignore','pipe','pipe',extra],encoding:'utf8'});fs.closeSync(extra);assert.equal(r.status,0,r.stderr);",
 "for(const make of [()=>fs.mkdtempSync('allowed/sync-'),()=>new Promise((r,j)=>fs.mkdtemp('allowed/callback-',(e,p)=>e?j(e):r(p))),()=>import('node:fs/promises').then(m=>m.mkdtemp('allowed/promise-'))]){const p=await make();assert(fs.statSync(p).isDirectory());}",
 "assert.throws(()=>spawnSync('allowed/preexisting.exe',['-e','0']),{code:'INSTRUMENT_DENIED'});",
 "fs.copyFileSync(process.execPath,'allowed/created-node.exe');r=spawnSync('allowed/created-node.exe',['-e','0']);assert.equal(r.status,0);",
 "assert.throws(()=>fs.openSync('forbidden-fd.txt','w'),{code:'INSTRUMENT_DENIED'});",
 "const {promisify}=await import('node:util');const {ChildProcess}=await import('node:child_process');const pending=promisify(execFile)(process.execPath,[child],{env});assert(pending.child instanceof ChildProcess);assert.equal(Object.getPrototypeOf(pending.child),ChildProcess.prototype);assert.equal(pending.child.spawn,ChildProcess.prototype.spawn);const promised=await pending;assert.match(promised.stdout,/CHILD_OK/);assert.equal(typeof promised.stderr,'string');",
 "const nativeHandle=await open('allowed/native.txt','w');assert.equal(nativeHandle.write,Object.getPrototypeOf(nativeHandle).write);assert.equal(Object.hasOwn(nativeHandle,'write'),false);await nativeHandle.close();",
 "const untouched=await open('allowed/unchanged.txt','r+');await untouched.close();fs.writeFileSync('allowed/same.txt','same');",
 "console.log('ACTIVE_OK');",''].join('\n'));
 const c={mode:'active',isolated:true,cwd:root,outputDirectory:path.join(root,'output'),writeRoots:[allowed],executables:['node',python],allowCreatedExecutables:true,pythonExecutables:[python],wrapPythonChildren:true,network:'deny'};
 fs.writeFileSync(path.join(allowed,'unchanged.txt'),'unchanged');fs.writeFileSync(path.join(allowed,'same.txt'),'same');
 const cfg=put('config.json',c),checks=cleanupChecks();
 const before=fs.readdirSync(root);plan(cfg);assert.deepEqual(fs.readdirSync(root),before);
 assert.equal((await run(cfg,[process.execPath,entry])).executed,false);assert(!fs.existsSync(c.outputDirectory));checks.push('instrument plan and disabled run write nothing');
 const r=await run(cfg,[process.execPath,entry],{enable:true});
 assert.equal(r.exitCode,0,fs.readFileSync(path.join(c.outputDirectory,'stderr.log'),'utf8'));
 const summary=collect(r.manifest);
 assert(summary.subprocesses.some(e=>e.api==='ChildProcess.prototype.spawn'&&e.phase==='started'));
 assert(!summary.writes.some(e=>e.paths?.some(p=>p?.endsWith('unchanged.txt')||p?.endsWith('same.txt'))));
 assert(summary.writeEvents.some(e=>e.paths?.some(p=>p?.endsWith('unchanged.txt'))));
 checks.push('promisify execFile observed with native ChildProcess and FileHandle contracts','snapshot requires actual change despite write-mode open or same-byte write');
 assert(summary.writes.some(e=>e.api==='fs.writeFileSync'&&e.paths.some(p=>p.endsWith('named.txt'))));
 assert(summary.writes.some(e=>e.api==='fs.promises.writeFile'));
 assert(summary.denied.some(e=>e.kind==='write'));assert(!fs.existsSync(path.join(root,'forbidden.txt')));
 assert(summary.denied.some(e=>e.kind==='process'));assert(summary.denied.some(e=>e.api==='net.Socket.connect'));
 assert(summary.denied.some(e=>e.api==='tls.connect'));
 assert(summary.subprocesses.some(e=>e.effectiveArgv?.includes('-I')&&e.effectiveArgv.includes('-X')&&e.effectiveArgv.includes('utf8')&&e.effectiveArgv.some(a=>a.endsWith('py-trace-run.py'))));
 const traces=fs.readdirSync(path.join(c.outputDirectory,'coverage')).filter(n=>n.startsWith('python-')).map(n=>JSON.parse(fs.readFileSync(path.join(c.outputDirectory,'coverage',n),'utf8')));
 assert(traces.some(t=>t.schema==='python-settrace-v1'&&t.files.some(f=>path.resolve(f.path)===path.resolve(py)&&f.lines.some(l=>l.line===14&&l.count>0))));
 checks.push('instrument allowed writes and denied writes return INSTRUMENT_DENIED','instrument named ESM fs and fs/promises interception','instrument child Node spawn execFile fork inherits custom env','instrument net and tls denied before connection','instrument Python -I -B -X utf8 preserved, argv and threaded settrace JSON','instrument Python write and socket policy');
 assert.match(fs.readFileSync(path.join(c.outputDirectory,'stdout.log'),'utf8'),/STDOUT_FD/);
 assert.match(fs.readFileSync(path.join(c.outputDirectory,'stderr.log'),'utf8'),/STDERR_FD/);
 assert.equal(fs.readFileSync(path.join(allowed,'inherited.txt'),'utf8'),'inherited-extra');
 assert(summary.writes.some(e=>e.api==='fs.openSync'&&e.paths[0]?.endsWith('fd.txt')&&e.snapshotEvidence.length));
 assert.equal(fs.readFileSync(path.join(allowed,'fd.txt'),'utf8'),'syncasync');
 assert(summary.writes.some(e=>e.api==='fs.promises.open'&&e.paths[0]?.endsWith('handle-write.txt')&&e.snapshotEvidence.length));assert.equal(fs.readFileSync(path.join(allowed,'handle-write.txt'),'utf8'),'handle');
 const pythonCapturedPath=path.join(allowed,'python-captured.json'),pythonCaptured=JSON.parse(fs.readFileSync(pythonCapturedPath,'utf8'));
 if(process.env.TRACE_SELF_TEST_EVIDENCE)fs.copyFileSync(pythonCapturedPath,process.env.TRACE_SELF_TEST_EVIDENCE);
 assert.match(pythonCaptured.stdout,/PY_STDOUT/);
 assert.match(pythonCaptured.stderr,/PY_STDERR/);
 assert(summary.writes.some(e=>e.api==='audit.open'&&e.paths[0]?.endsWith('python-fd.txt')&&e.snapshotEvidence.length));assert.equal(fs.readFileSync(path.join(allowed,'python-fd.txt'),'utf8'),'checked');
 assert(summary.writes.some(e=>e.api==='audit.open'&&e.paths[0]?.endsWith('python-proxy.txt')&&e.snapshotEvidence.length));assert.equal(fs.readFileSync(path.join(allowed,'python-proxy.txt'),'utf8'),'proxy');
 for(const api of ['fs.mkdtempSync','fs.mkdtemp','fs.promises.mkdtemp']){
  const e=summary.writes.find(e=>e.api===api);assert(e);assert.notEqual(e.paths[0],e.prefix);assert(fs.statSync(e.paths[0]).isDirectory());
 }
 assert(summary.subprocesses.some(e=>e.createdExecutable&&e.decision==='ALLOW'&&e.api==='subprocess.Popen'));
 assert(summary.subprocesses.some(e=>e.createdExecutable&&e.decision==='ALLOW'&&e.api==='child_process.spawnSync'));
 assert(summary.denied.some(e=>e.kind==='process'&&e.resolvedExecutable?.endsWith('preexisting.exe')));
 assert(summary.writes.some(e=>e.api==='audit.open'&&e.paths[0]?.includes('named-temp-')&&e.snapshotEvidence.length));
 assert(summary.writes.some(e=>e.api==='audit.open'&&e.paths[0]?.endsWith('closefd-false.txt')&&e.snapshotEvidence.length));assert.equal(fs.readFileSync(path.join(allowed,'closefd-false.txt'),'utf8'),'keptstill-open');
 checks.push('instrument Python NamedTemporaryFile double close and custom opener real path; closefd false mapping');
 checks.push('instrument stdout stderr and inherited fd allowed and logged','instrument checked fd write writeSync FileHandle paths preserved','instrument Python stdout stderr fd and File writes allowed and logged','instrument mkdtemp sync callback promises record actual directory','instrument configurable executable names and run-created executables across Node and Python; preexisting denied');
 const staticMap=put('static.json',{closures:[{files:['entry.mjs','child.mjs','child.py']}]});
 const endpointTable=put('endpoints.json',{endpoints:[
 {id:'observed',writers:[{file:'entry.mjs',line:6}],observedPaths:[path.join(allowed,'named.txt')]},
 {id:'range',writers:[{file:'entry.mjs',line:6}],observedPaths:[path.join(allowed,'never.txt')]}
 ]});
 const rec=reconcile({coverageDirectory:path.join(c.outputDirectory,'coverage'),staticMap,endpointTable,roots:[{root,scope:'source'}],excludeRoots:[c.outputDirectory],
 instrumentCollect:path.join(c.outputDirectory,'instrument-collect.json')});
 assert.equal(rec.endpoints[0].status,'WRITTEN_OBSERVED',JSON.stringify(rec.endpoints[0]));
 assert.equal(rec.endpoints[1].status,'RANGE_ONLY');assert(rec.instrumentLogOnly.length>0);
 checks.push('instrument reconcile WRITTEN_OBSERVED RANGE_ONLY LOG_ONLY');
 const coverageCopy=path.join(root,'reconcile-coverage');fs.cpSync(path.join(c.outputDirectory,'coverage'),coverageCopy,{recursive:true});
  fs.writeFileSync(path.join(coverageCopy,'unmapped.json'),JSON.stringify({result:[{url:pathToFileURL(path.join(root,'..','outside.mjs')).href,functions:[{functionName:'outside',ranges:[{startOffset:0,endOffset:1,count:1}]}]}]})+'\n');
  const auto=reconcile({coverageDirectory:coverageCopy,staticMap,endpointTable,roots:[{root,scope:'source'}],instrumentCollect:path.join(c.outputDirectory,'instrument-collect.json')});
  assert.equal(auto.status,'PARTIAL');assert(auto.gaps.some(g=>g.kind==='UNMAPPED'));assert(auto.excluded.some(e=>e.reason==='INSTRUMENT_EXCLUDED'));assert(!auto.files.some(f=>f.physicalPaths.some(p=>p.replaceAll('\\','/').startsWith(c.outputDirectory.replaceAll('\\','/')+'/'))));
  checks.push('G01 manifest exclusion and executed UNMAPPED gap');
  const retainedNames=['stdout.log','stderr.log','coverage','events'];
  const evidenceHashes=new Map(JSON.parse(fs.readFileSync(r.manifest,'utf8')).files.filter(f=>retainedNames.some(n=>f.path===path.join(c.outputDirectory,n)||f.path.startsWith(path.join(c.outputDirectory,n)+path.sep))).map(f=>[f.path,f.sha256]));
  const receipt=remove(r.manifest);assert.equal(receipt.status,'PASS');assert.equal(receipt.outputDirectoryRemoved,false);assert(fs.existsSync(path.join(allowed,'named.txt')));
  assert(retainedNames.every(n=>fs.existsSync(path.join(c.outputDirectory,n))));assert([...evidenceHashes].every(([p,h])=>digest(fs.readFileSync(p))===h));
  assert(!fs.existsSync(path.join(c.outputDirectory,'instrument-recorder.mjs')));assert.equal(summary.logs.stdout.sha256,digest(fs.readFileSync(path.join(c.outputDirectory,'stdout.log'))));assert.match(summary.logs.stdout.tail,/ACTIVE_OK/);assert.match(summary.logs.stderr.tail,/STDERR_FD/);
  checks.push('G03 collect log tails and hashes; remove preserves measured evidence');
 checks.push('instrument remove exactly owned listed files, preserves target writes');
 const passiveEntry=put('passive.mjs',[
 "import fs from 'node:fs';import net from 'node:net';import {spawnSync} from 'node:child_process';",
 "fs.writeFileSync('passive-outside-root.txt','allowed');",
 "try{net.connect({port:-1});}catch(e){if(e.code==='INSTRUMENT_DENIED')throw e;}",
 "const r=spawnSync('synthetic-nonexistent-executable',[]);if(r.error?.code==='INSTRUMENT_DENIED')throw r.error;",
 "console.log('PASSIVE_OK');",''].join('\n'));
 c.outputDirectory=path.join(root,'passive-output');put('config.json',c);
 const original=digest(fs.readFileSync(passiveEntry)),p=passiveLauncher(cfg,passiveEntry);
 assert(/^[\x00-\x7f]*$/.test(fs.readFileSync(p.wrapper,'utf8')));
 const pr=spawnSync(process.execPath,[p.wrapper],{cwd:root,encoding:'utf8',windowsHide:true});
 assert.equal(pr.status,0,pr.stderr);assert.match(pr.stdout,/PASSIVE_OK/);assert.equal(digest(fs.readFileSync(passiveEntry)),original);
 finalize(p.manifest);const ps=collect(p.manifest);assert.equal(ps.denied.length,0);assert(ps.network.length);assert(fs.existsSync(path.join(root,'passive-outside-root.txt')));
 fs.appendFileSync(p.wrapper,'// changed\n');fs.writeFileSync(path.join(c.outputDirectory,'unlisted.txt'),'unlisted');
 const removal=remove(p.manifest);assert.equal(removal.status,'PARTIAL');assert(fs.existsSync(p.wrapper));assert(fs.existsSync(path.join(c.outputDirectory,'unlisted.txt')));assert(removal.preserved.some(f=>f.path===p.wrapper));
 checks.push('instrument passive never DENY, ASCII wrapper, original unchanged','instrument remove preserves changed hashes and unlisted files');

 const compat=put('native-compat.py',[
 'import os, tempfile, json, builtins, io',
 'with tempfile.NamedTemporaryFile(dir="allowed",delete=True) as f:',
 '    f.write(b"native"); f.flush(); name=f.name; native_type=type(f.file).__name__',
 'f.close()',
 'def opener(p, flags): return os.open("allowed/opener-actual.txt", flags, 0o600)',
 'with open("allowed/opener-nominal.txt","w",opener=opener) as stream: stream.write("actual"); file_type=type(stream).__name__',
 'assert not os.path.exists("allowed/opener-nominal.txt")',
 'assert open("allowed/opener-actual.txt").read() == "actual"',
 'print(json.dumps(dict(tempDeleted=not os.path.exists(name),nativeType=native_type,fileType=file_type,openIdentity=builtins.open is io.open)))'
 ].join('\n'));
 const plain=spawnSync(python,['-B',compat],{cwd:root,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},windowsHide:true});assert.equal(plain.status,0,plain.stderr);
 const compatEntry=put('native-compat.mjs',"import {spawnSync} from 'node:child_process';const r=spawnSync("+JSON.stringify(python)+",['-B',"+JSON.stringify(compat)+"],{encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status;\n");
 const compatCfg=put('native-compat.json',{...c,outputDirectory:path.join(root,'compat-output')});
 const observed=await run(compatCfg,[process.execPath,compatEntry],{enable:true});assert.equal(observed.exitCode,0,fs.readFileSync(path.join(root,'compat-output/stderr.log'),'utf8'));
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'compat-output/stdout.log'),'utf8')),JSON.parse(plain.stdout));
 const compatSummary=collect(observed.manifest);assert(compatSummary.writeEvents.some(e=>e.api==='audit.open'&&e.paths?.[0]?.endsWith('opener-actual.txt')));
 assert.equal(remove(observed.manifest).status,'PASS');
 checks.push('NamedTemporaryFile double close and custom opener native behavior match uninstrumented Python');

 return checks;
}

function cleanupChecks(){
 const checks=[],check=(name,fn)=>{fn();checks.push('G161 '+name);};
 const err=code=>Object.assign(Error(code),{code});
 const gone=()=>{throw err('ESRCH');};
 const header='  sl  local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n';
 const row=(state,inode,address='0100007F:1F90')=>' 0: '+address+' 00000000:0000 '+state+' 00000000:00000000 00:00000000 00000000 1000 0 '+inode+' 1\n';
 const base={platform:'linux',kill:gone,readFile:()=>header,readdir:()=>{throw err('ENOENT');},readlink:()=>{throw Error('Unexpected readlink');}};
 check('Linux absent process and empty TCP tables verify PASS',()=>{const r=verifyCleanup([42],base);assert.equal(r.status,'PASS');assert.deepEqual(r.remaining,[]);assert.deepEqual(r.listeners,[]);});
 check('kill zero detects live and EPERM processes; verified leftovers dominate missing evidence',()=>{
  for(const kill of [()=>{},()=>{throw err('EPERM');}]){const r=verifyCleanup([42],{...base,kill,readFile:()=>{throw err('EACCES');}});assert.equal(r.status,'FAIL');assert.deepEqual(r.remaining,[42]);assert(r.verificationErrors.length);}
 });
 check('unexpected process errors and inaccessible TCP tables remain UNKNOWN with reasons',()=>{
  for(const extra of [{kill:()=>{throw err('EINVAL');}},{readFile:()=>{throw err('EACCES');}},{readFile:()=>''},{readFile:()=>header+'bad row\n'}]){const r=verifyCleanup([42],{...base,...extra});assert.equal(r.status,'UNKNOWN');assert(r.reason);}
 });
 check('Linux IPv4 and IPv6 LISTEN inodes join only owned descriptors',()=>{
  const readFile=p=>header+(p.endsWith('tcp6')?row('0A','888','00000000000000000000000001000000:1F91'):row('0A','777')+row('01','999')+row('0A','123'));
  const r=verifyCleanup([42],{...base,readFile,readdir:()=>['3','4','5','6'],readlink:p=>({'3':'socket:[777]','4':'socket:[888]','5':'socket:[999]','6':'/tmp/file'})[p.split('/').at(-1)]});
  assert.equal(r.status,'FAIL');assert.deepEqual(r.listeners.map(x=>x.inode),['777','888']);assert(r.listeners.every(x=>x.pid===42));assert.deepEqual(r.remaining,[]);
 });
 check('Linux unrelated listeners and established sockets do not fail cleanup',()=>{
  const r=verifyCleanup([42],{...base,readFile:()=>header+row('0A','777')+row('01','999'),readdir:()=>['3'],readlink:()=> 'socket:[999]'});assert.equal(r.status,'PASS');assert.equal(r.listeners.length,0);
 });
 check('Linux disappearing fd is allowed; unreadable fd and live missing directory are not certified',()=>{
  assert.equal(verifyCleanup([42],{...base,readdir:()=>['3'],readlink:()=>{throw err('ENOENT');}}).status,'PASS');
  for(const extra of [{readdir:()=>{throw err('EACCES');}},{readdir:()=>['3'],readlink:()=>{throw err('EACCES');}}])assert.equal(verifyCleanup([42],{...base,...extra}).status,'UNKNOWN');
  let probes=0;const r=verifyCleanup([42],{...base,kill:()=>{if(++probes===1)throw err('ESRCH');}});assert.equal(r.status,'UNKNOWN');assert(r.reason.includes('/proc/42/fd'));
 });
 check('macOS lsof uses PID intersection and empty exit one means no listeners',()=>{
  let called=false;const r=verifyCleanup([42,43],{...base,platform:'darwin',command:(exe,args)=>{called=true;assert.equal(exe,'lsof');assert.deepEqual(args,['-nP','-iTCP','-sTCP:LISTEN','-a','-p','42,43']);return {status:1,stdout:'',stderr:''};}});assert(called);assert.equal(r.status,'PASS');
 });
 check('macOS lsof listener stays FAIL and missing or invalid lsof stays UNKNOWN',()=>{
  const mac={...base,platform:'darwin'};
  assert.equal(verifyCleanup([42],{...mac,command:()=>({status:0,stdout:'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 42 user 3u IPv4 1 0t0 TCP 127.0.0.1:8080 (LISTEN)\n',stderr:''})}).status,'FAIL');
  for(const output of [{status:null,error:err('ENOENT')},{status:1,stderr:'permission denied'},{status:2},{status:0,stdout:''},{status:0,stdout:'unexpected output'}]){const r=verifyCleanup([42],{...mac,command:()=>output});assert.equal(r.status,'UNKNOWN');assert(r.reason);}
 });
 check('unsupported platforms remain UNKNOWN while actual current process is detected',()=>{
  assert.equal(verifyCleanup([],{...base,platform:'unsupported'}).status,'UNKNOWN');
  const r=verifyCleanup([process.pid],{...base,kill:process.kill});assert.equal(r.status,'FAIL');assert.deepEqual(r.remaining,[process.pid]);
 });
 return checks;
}
