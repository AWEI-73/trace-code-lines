// UI trial helper: runs inside the no-network namespace (loopback only). Starts the dev server,
// waits for it to answer, runs the browser driver (ui-driver.py) against it, then stops the server.
// Config from TCL_UI_PROBE (JSON {cmd, cwd, waitMs, driver:{python, cfg}}); prints one line prefixed @@TCL_UI@@.
import {spawn,spawnSync} from 'node:child_process';
import path from 'node:path';
const cfg=JSON.parse(process.env.TCL_UI_PROBE??'{}'),waitMs=cfg.waitMs??60000;
const child=spawn(cfg.cmd[0],cfg.cmd.slice(1),{cwd:cfg.cwd,stdio:['ignore','pipe','pipe'],env:{...process.env,BROWSER:'none',CI:'1'},detached:true});
let out='',err='',exit=null;child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
const done=new Promise(r=>child.on('exit',(c,s)=>{exit=c??('被中止 '+s);r();}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const strip=t=>t.replace(/\u001b\[[0-9;]*m/g,'');
const urlsIn=t=>[...new Set((strip(t).match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/g)??[]))];
async function ok(u){try{const r=await fetch(u,{signal:AbortSignal.timeout(3000)});await r.text();return r.status<500;}catch{return false;}}
const t0=Date.now();let base=null;
while(Date.now()-t0<waitMs&&exit===null&&!base){await sleep(400);const cs=[...urlsIn(out+err),...(cfg.ports??[5173,3000,4321,8080]).map(p=>'http://localhost:'+p)].flatMap(u=>{const x=u.replace('0.0.0.0','127.0.0.1');return /localhost/.test(x)?[x.replace('localhost','127.0.0.1'),x.replace('localhost','[::1]')]:[x];});for(const v of [...new Set(cs)]){if(await ok(v+'/')){base=v;break;}}}
const startedMs=Date.now()-t0;let driver=null;
if(base){const r=spawnSync(cfg.driver.python,[path.join(path.dirname(new URL(import.meta.url).pathname),'ui-driver.py')],{env:{...process.env,TCL_UI:JSON.stringify({...cfg.driver.cfg,base})},encoding:'utf8',timeout:(cfg.driver.cfg.budgetS??240)*1000+60000,maxBuffer:16*1024*1024});
 const line=(r.stdout??'').split('\n').find(l=>l.startsWith('@@TCL_UI_DRIVER@@'));driver=line?JSON.parse(line.slice(line.indexOf('{'))):{error:'driver-failed: '+((r.stderr??'')+(r.error?String(r.error):'')).slice(-600)};}
if(exit===null){try{process.kill(-child.pid,'SIGTERM');}catch{}await Promise.race([done,sleep(2000)]);if(exit===null){try{process.kill(-child.pid,'SIGKILL');}catch{}}await Promise.race([done,sleep(500)]);}
process.stdout.write('@@TCL_UI@@'+JSON.stringify({listened:!!base,base,startedMs,driver,serverExit:exit,stdout:strip(out).slice(-2000),stderr:strip(err).slice(-1500)})+'\n');
