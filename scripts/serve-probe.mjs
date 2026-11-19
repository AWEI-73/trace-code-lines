// Trial helper for servers: runs inside the no-network namespace (loopback only), starts the
// command, waits for it to listen, sends a few GETs to localhost, then stops it.
// Config comes from TCL_PROBE (JSON {cmd, paths, waitMs}); prints one result line prefixed @@TCL_PROBE@@.
import {spawn} from 'node:child_process';
const cfg=JSON.parse(process.env.TCL_PROBE??'{}'),waitMs=cfg.waitMs??8000;
const child=spawn(cfg.cmd[0],cfg.cmd.slice(1),{stdio:['ignore','pipe','pipe'],env:process.env});
let out='',err='',exit=null;child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
const done=new Promise(r=>child.on('exit',(c,s)=>{exit=c??('被中止 '+s);r();}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const urlsIn=t=>[...new Set((t.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?[^\s'"<>)]*/g)??[]))];
const ports=()=>{const p=new Set(urlsIn(out+err).map(u=>new URL(u.replace('0.0.0.0','127.0.0.1')).port).filter(Boolean));for(const d of cfg.ports??[3000,8000,8080,5000])p.add(String(d));return [...p];};
async function get(u){try{const r=await fetch(u,{signal:AbortSignal.timeout(2000)});const t=await r.text();let shape=null;try{const j=JSON.parse(t);shape=Array.isArray(j)?'陣列 '+j.length+' 筆':typeof j==='object'&&j?'物件（'+Object.keys(j).slice(0,6).join('、')+'）':typeof j;}catch{}return {url:u,status:r.status,bytes:t.length,shape,body:t.slice(0,300)};}catch(e){return {url:u,error:String(e.cause?.code??e.name)};}}
const t0=Date.now();let base=null;
while(Date.now()-t0<waitMs&&exit===null&&!base){await sleep(300);for(const p of ports()){for(const h of ['127.0.0.1','[::1]']){const r=await get('http://'+h+':'+p+'/');if(!r.error){base='http://'+h+':'+p;break;}}if(base)break;}}
const gets=[];
if(base){const seen=new Set(['/',...(cfg.paths??[]),...urlsIn(out).map(u=>{try{return new URL(u.replace('0.0.0.0','127.0.0.1')).pathname;}catch{return null;}}).filter(Boolean)]);
 for(const p of [...seen].slice(0,8))gets.push(await get(base+p));}
const alive=exit===null;if(alive){child.kill('SIGTERM');await Promise.race([done,sleep(1500)]);if(exit===null)child.kill('SIGKILL');await Promise.race([done,sleep(500)]);}
process.stdout.write('@@TCL_PROBE@@'+JSON.stringify({listened:!!base,base,gets,stoppedByProbe:alive,exit:alive?null:exit,stdout:out.slice(0,3000),stderr:err.slice(0,1500)})+'\n');
