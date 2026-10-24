import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runOnce} from './run-once.mjs';
export async function skill8Checks(root){
 fs.mkdirSync(root,{recursive:true});const clone=path.join(root,'clone'),temp=path.join(root,'temp');fs.mkdirSync(clone);fs.mkdirSync(temp);
 const put=(n,s)=>fs.writeFileSync(path.join(clone,n),s,'utf8');
 put('entry.mjs',[
 "import fs from 'node:fs';import {execFile,spawn} from 'node:child_process';import {createInterface} from 'node:readline';import assert from 'node:assert/strict';",
 "process.env.TRACE_WRITE_CLASS='seed';fs.writeFileSync('state.json',JSON.stringify({phase:'SEED',items:[{status:'seed'}]}));",
 "process.env.TRACE_WRITE_CLASS='business';fs.writeFileSync('state.json',JSON.stringify({phase:'MIDDLE',items:[{status:'a'},{status:'b'}]}));fs.writeFileSync('state.json',JSON.stringify({phase:'FINAL',items:[]}));fs.writeFileSync('state.json',JSON.stringify({phase:'FINAL',items:[]}));",
 "await new Promise((resolve,reject)=>execFile('no-input',[],{},(e,out)=>e?reject(e):(assert.equal(out.trim(),'true'),resolve())));",
 "const waiting=spawn('wait-input',[],{stdio:['pipe','pipe','pipe']});let ready=false;const cfg=JSON.parse(fs.readFileSync(process.env.INSTRUMENT_CONFIG));for(let n=0;n<500;n++){if(fs.existsSync(cfg.eventsDirectory+'/boundary-'+waiting.pid+'.jsonl')){ready=true;break;}await new Promise(r=>setTimeout(r,10));}assert(ready);const closed=new Promise(r=>waiting.once('close',r));waiting.kill('SIGKILL');await closed;",
 "const ids=[];for(let k=0;k<2;k++){const p=spawn('session',[],{stdio:['pipe','pipe','pipe']});const rl=createInterface({input:p.stdout});const lines=rl[Symbol.asyncIterator]();const ask=async msg=>{p.stdin.write(JSON.stringify(msg)+'\\n');return JSON.parse((await lines.next()).value);};const a=await ask({id:1,method:'thread/start'});const b=await ask({id:2,method:'turn/start'});const c=await ask({id:3,method:'turn/start'});assert.notEqual(b.result.id,c.result.id);assert.equal(p.exitCode,null);ids.push(a.result.id);const closed=new Promise(r=>p.once('close',r));p.stdin.end();await closed;}assert.notEqual(ids[0],ids[1]);",
 "console.log('FEATURES_OK');"
 ].join('\n'));
 const c={clone,tempRoot:temp,isolationRoot:path.join(temp,'home'),outputDirectory:path.join(temp,'trace'),resolvedWriteRoots:[clone],command:[process.execPath,path.join(clone,'entry.mjs')],timeoutMs:30000,valueReceipts:[{targetPattern:'/state\\.json$',fields:['phase','items[].status']}],boundaries:[
 {id:'ignore',executable:'no-input',stdinMode:'ignore',schema:{const:true}},
 {id:'waiting',executable:'wait-input',schema:{const:true}},
 {id:'session',executable:'session',protocol:'jsonl',sessionMode:'caller',methods:{'thread/start':{schema:{const:{}},result:{id:'${threadId}'}},'turn/start':{schema:{const:{}},result:{id:'${turnId}'}}}}
 ]};
 const r=await runOnce(c,{enable:true});assert.equal(r.status,'UNKNOWN');assert.equal(r.processStatus,'PASS',r.target.stderr);const checks=[];
 const v=r.target.summary.valueReceipts.filter(e=>e.receipt.path.endsWith('state.json')&&e.completeContent).map(e=>e.receipt);
 assert(v.some(e=>e.writeClass==='seed'&&e.fields.some(f=>f.value==='SEED')));const middle=v.find(e=>e.fields.some(f=>f.value==='MIDDLE'));assert(middle.changed&&middle.writeClass==='business'&&middle.sha256);assert.deepEqual(middle.fields.filter(f=>f.field==='items[].status').map(f=>f.selector),['items[0].status','items[1].status']);assert(v.some(e=>!e.changed&&e.fields.some(f=>f.value==='FINAL')));checks.push('SF-03 intermediate successful write receipts array selectors hashes and seed business distinction');
 const ignore=r.target.boundaries.find(b=>b.id==='ignore'),waiting=r.target.boundaries.find(b=>b.id==='waiting');assert.equal(ignore.state,'RESPONDED');assert.equal(waiting.observedState,'WAITING_INPUT');assert.equal(waiting.state,'FORCED_TERMINATION');assert.equal(waiting.productFailure,false);checks.push('SF-01 receipt precedes stdin and distinguishes responded waiting and forced termination');
 const sessions=r.target.boundaries.filter(b=>b.id==='session');assert.equal(sessions.length,2);assert.notEqual(sessions[0].sessionId,sessions[1].sessionId);assert(sessions.every(b=>b.responses.filter(r=>r.method==='turn/start').length===2&&b.terminationStatus==='CALLER_ENDED'&&!b.prematureExit));checks.push('SF-02 caller-owned JSONL sessions support multiple turns and unique session ids');
 const sample=JSON.parse(fs.readFileSync(fileURLToPath(new URL('../assets/run-once-isolation.json',import.meta.url)),'utf8'));assert.equal(sample.executables.length,1);assert(sample.boundaries.every(b=>b.failure&&!b.replay));assert(sample.resolvedWriteRoots.every(p=>p.startsWith('${RUN_TEMP}')));checks.push('SF-04 reviewable isolation example declares prerequisites without forged success or grants');
 return checks;
}
