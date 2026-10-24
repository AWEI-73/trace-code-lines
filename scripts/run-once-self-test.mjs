import fs from 'node:fs';
import {resolvePython} from './python-path.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {runOnce,verifyWriteRoots,discoverDryRun} from './run-once.mjs';
import {removalTrial} from './removal-trial.mjs';
import {minimal,valid,snapshot} from './boundary-stub.mjs';
export async function runOnceChecks(root){
 fs.mkdirSync(root,{recursive:true});const clone=path.join(root,'clone'),temp=path.join(root,'temp');fs.mkdirSync(clone);fs.mkdirSync(temp);
 const put=(p,v)=>fs.writeFileSync(path.join(clone,p),typeof v==='string'?v:JSON.stringify(v)+'\n','utf8'),checks=[];
 put('input.txt','full prompt input\n');fs.mkdirSync(path.join(clone,'package'));put('package/work.json',{task:'observe only'});
 put('entry.mjs',[
 "import fs from 'node:fs';import assert from 'node:assert/strict';import {spawnSync,execFileSync} from 'node:child_process';",
 "if(process.argv.includes('--dry-run')){console.log('DRY');process.exit(0);}",
 "let r=spawnSync('fixture-replay',['input.txt','package'],{encoding:'utf8',input:'prompt-stream',env:{...process.env,SECRET_MARKER:'must-not-appear-in-receipt'}});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'recorded\\n');",
 "r=spawnSync('fixture-schema',[],{encoding:'utf8',input:'schema prompt'});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{ok:false,name:'xx',items:[]});",
 "r=spawnSync('fixture-failed',[],{encoding:'utf8',input:'failure prompt'});assert.equal(r.status,73);assert.match(r.stderr,/DECLARED_FAILURE/);fs.writeFileSync('continued.txt','failure path observed');",
 "fs.writeFileSync('boundary-proof.json',JSON.stringify({continued:true}));",
 ].join('\n'));
 const boundaries=[
 {id:'replay',executable:'fixture-replay',replay:{stdout:'recorded\n',exitCode:0}},
 {id:'schema',executable:'fixture-schema',schema:{type:'object',required:['ok','name','items'],additionalProperties:false,properties:{ok:{type:'boolean'},name:{type:'string',minLength:2},items:{type:'array',items:{type:'string'}}}}},
 {id:'failed',executable:'fixture-failed',failure:{exitCode:73,message:'DECLARED_FAILURE'}}
 ];
 const c={clone,tempRoot:temp,isolationRoot:path.join(temp,'home'),outputDirectory:path.join(temp,'out'),resolvedWriteRoots:[clone],command:[process.execPath,path.join(clone,'entry.mjs')],discoveryFiles:[path.join(clone,'entry.mjs')],boundaries};
 const before=fs.readdirSync(temp);assert.equal((await runOnce(c)).executed,false);assert.deepEqual(fs.readdirSync(temp),before);
 assert.throws(()=>verifyWriteRoots([path.dirname(root)],[clone,temp]),/ISOLATION_ROOT_ESCAPE/);checks.push('run-once rejects external resolved write roots before launch');
 const r=await runOnce(c,{enable:true});assert.equal(r.status,'UNKNOWN');assert.equal(r.processStatus,'PASS',r.target.stderr);assert.equal(r.preflight.exitCode,0);assert.match(r.preflight.stdout,/DRY/);
 assert.equal(r.contract.schema,'trace-evidence-contract-v1');assert.equal(r.contract.layer,'EXECUTION');assert.equal(r.contract.mode,'RUN_ONCE_STUBBED');assert.equal(r.realUse,false);assert.equal(r.businessAcceptance,false);checks.push('run-once evidence RUN_ONCE_STUBBED never real use or business acceptance');
 assert.deepEqual(r.target.boundaries.map(b=>b.responses[0].source).sort(),['BOUNDARY_STUB_FAILED','REPLAY','SCHEMA_MINIMAL']);checks.push('boundary replay schema minimum and declared failure continue observed path');
 const b=r.target.boundaries.find(b=>b.id==='replay');assert.equal(b.stdin,'prompt-stream');assert(b.argv.includes('input.txt'));assert.equal(b.cwd,clone);
 assert.equal(b.before.files[0].sha256,snapshot(path.join(clone,'input.txt')).files[0].sha256);assert.equal(Buffer.from(b.before.files[0].contentBase64,'base64').toString(),'full prompt input\n');
 assert.equal(b.before.directories[0].sha256,b.after[0].sha256);assert(b.envNames.includes('SECRET_MARKER'));assert(!JSON.stringify(b).includes('must-not-appear'));assert.equal(b.exitCode,0);assert(b.elapsedMs>=0);checks.push('boundary full argv stdin file bytes SHA directory before after env names exit elapsed');
 assert.equal(r.target.remove.status,'PASS');assert(fs.existsSync(path.join(c.outputDirectory,'stdout.log')));assert(!fs.existsSync(path.join(c.outputDirectory,'instrument-recorder.mjs')));assert(r.target.archive.every(a=>a.archive.endsWith('.gz')));checks.push('run-once individually compressed evidence readback and exact instrument removal');
 assert.equal(discoverDryRun([path.join(clone,'entry.mjs')],c.command).command.at(-1),'--dry-run');checks.push('target literal dry-run discovered and executed before target');
 assert.equal(valid(minimal({type:'integer',minimum:3}),{type:'integer',minimum:3}),true);
 assert.throws(()=>minimal({type:'string',pattern:'^z+$'}),/Unsupported/);checks.push('unsupported schema becomes declared failure rather than false valid output');
 const python=resolvePython();
 put('python-relay.mjs',"import fs from 'node:fs';import {spawnSync} from 'node:child_process';const r=spawnSync('fixture-schema',[],{input:fs.readFileSync(0),encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status;\n");
 put('worker.py',"import subprocess\nr=subprocess.run(["+JSON.stringify(process.execPath)+",'python-relay.mjs'],input='python prompt',text=True,capture_output=True)\nassert r.returncode == 0, r.stderr\nassert 'false' in r.stdout\n");
 put('python-entry.mjs',"import {spawnSync} from 'node:child_process';const r=spawnSync("+JSON.stringify(python)+",['worker.py'],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});if(r.status!==0)throw Error(r.stderr);\n");
 const py=await runOnce({...c,isolationRoot:path.join(temp,'py-home'),outputDirectory:path.join(temp,'py-out'),command:[process.execPath,path.join(clone,'python-entry.mjs')],discoveryFiles:[],executables:[process.execPath,python],pythonExecutables:[python]},{enable:true});
 assert.equal(py.status,'UNKNOWN');assert.equal(py.processStatus,'PASS',py.target.stderr);assert(py.target.boundaries.some(b=>b.stdin==='python prompt'));checks.push('Python native Popen via explicit Node boundary preserves full stdin');
 const repo=path.join(root,'removal-source');fs.mkdirSync(repo);
 fs.writeFileSync(path.join(repo,'used.txt'),'required');fs.writeFileSync(path.join(repo,'orphan.txt'),'unused');
 fs.writeFileSync(path.join(repo,'list.json'),'["used.txt"]\n');
 fs.writeFileSync(path.join(repo,'validate.mjs'),"import fs from 'node:fs';for(const name of JSON.parse(fs.readFileSync('list.json','utf8')))fs.readFileSync(name,'utf8');\n");
 const trials=await removalTrial({sourceClone:repo,trialsRoot:path.join(root,'trials'),output:path.join(root,'removal.json'),candidates:['used.txt','orphan.txt'],validations:[{id:'list-string-reference',runOnce:{command:[process.execPath,'${CLONE}/validate.mjs'],boundaries:[],resolvedWriteRoots:['${CLONE}'],discoveryFiles:['${CLONE}/validate.mjs']}}]},{enable:true});
 assert.equal(trials.candidates[0].status,'REMOVAL_TRIAL_BREAKS',JSON.stringify(trials));assert(trials.candidates[0].location?.line>0);
 assert.equal(trials.candidates[1].status,'REMOVAL_TRIAL_PASS');assert(trials.attempts.length===4);assert(fs.existsSync(path.join(repo,'used.txt')));
 checks.push('removal trial baseline group bisect string-only false orphan BREAKS with file line and true orphan PASS');
 const gapTrial=await removalTrial({sourceClone:repo,trialsRoot:path.join(root,'gap-trials'),output:path.join(root,'gap-removal.json'),candidates:['orphan.txt'],validations:[{id:'gap'}]},{enable:true,evaluate:async({group})=>({status:'PASS',gaps:group.length?[{kind:'NEW_GAP'}]:[],firstLocation:{file:'validate.mjs',line:1}})});
 assert.equal(gapTrial.candidates[0].status,'REMOVAL_TRIAL_BREAKS');checks.push('removal trial rejects new gaps despite zero exit');
 return checks;
}
