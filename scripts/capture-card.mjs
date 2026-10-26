if(process.argv.length===3&&process.argv[2]==='--help'){console.log('Usage: node capture-card.mjs --browser executable --html health.html --out screenshots --temp scratch');process.exit(0);}
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {writeUTF8} from './report.mjs';
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
const browserPath=get('--browser'),html=path.resolve(get('--html')),out=path.resolve(get('--out')),temp=path.resolve(get('--temp'));
if(!browserPath||!get('--html')||!get('--out')||!get('--temp'))throw Error('Usage: capture-card.mjs --browser executable --html health.html --out screenshots --temp scratch');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(temp,{recursive:true});
const attempts=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function capture(attempt){
 const profile=fs.mkdtempSync(path.join(temp,'capture-')),wrapper=path.join(profile,'frame.html');
 writeUTF8(wrapper,'<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}iframe{display:block;border:0;width:390px;height:844px}</style><iframe src="'+pathToFileURL(html).href+'"></iframe>');
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(?:PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT)$/i.test(k)));
 for(const n of ['AppData/Local','AppData/Roaming'])fs.mkdirSync(path.join(profile,n),{recursive:true});Object.assign(env,{HOME:profile,USERPROFILE:profile,HOMEDRIVE:path.parse(profile).root.replace(/[\\/]$/,''),HOMEPATH:profile.slice(path.parse(profile).root.length-1),APPDATA:path.join(profile,'AppData/Roaming'),LOCALAPPDATA:path.join(profile,'AppData/Local'),TEMP:profile,TMP:profile,TMPDIR:profile});
 const child=spawn(browserPath,['--headless=new','--remote-debugging-pipe','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--no-default-browser-check','--host-resolver-rules=MAP * ~NOTFOUND','--user-data-dir='+path.join(profile,'browser'),'--allow-file-access-from-files'],{env,windowsHide:true,stdio:['ignore','pipe','pipe','pipe','pipe']});
 let seq=0,buf='',stderr='';const pending=new Map();
 child.stderr.on('data',b=>stderr+=b.toString());child.on('error',e=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(e);}pending.clear();});
 child.stdio[4].on('data',b=>{buf+=b;let at;while((at=buf.indexOf('\0'))>=0){const raw=buf.slice(0,at);buf=buf.slice(at+1);if(!raw)continue;const m=JSON.parse(raw),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}});
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT '+method));},15000);pending.set(id,{resolve,reject,timer});child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});
 const evaluate=async(sessionId,fn)=>{const r=await call('Runtime.evaluate',{expression:'('+fn.toString()+')()',awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 try{
  const version=await call('Browser.getVersion'),{targetId}=await call('Target.createTarget',{url:'about:blank'}),{sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  for(const domain of ['Page','Runtime','Network'])await call(domain+'.enable',{},sessionId);
  await call('Network.setBlockedURLs',{urls:['http://*','https://*','ws://*','wss://*']},sessionId);
  await call('Emulation.setDeviceMetricsOverride',{width:800,height:900,deviceScaleFactor:1,mobile:false},sessionId);
  const records=[];
  for(const theme of ['light','dark']){
   await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]},sessionId);
   await call('Page.navigate',{url:pathToFileURL(wrapper).href},sessionId);
   let ready=false;for(let i=0;i<100;i++){ready=await evaluate(sessionId,()=>{const f=document.querySelector('iframe');return !!f?.contentDocument?.querySelector('#check-card')&&f.contentDocument.readyState==='complete';});if(ready)break;await sleep(100);}if(!ready)throw Error('FRAME_LOAD_TIMEOUT');
   await evaluate(sessionId,async()=>{const f=document.querySelector('iframe'),d=f.contentDocument;await d.fonts.ready;await Promise.all([...d.images].map(i=>i.decode().catch(()=>{})));await Promise.all(d.getAnimations().map(a=>a.finished.catch(()=>{})));});
   await sleep(750);
   const m=await evaluate(sessionId,()=>{const f=document.querySelector('iframe'),d=f.contentDocument,c=d.querySelector('#check-card');f.style.height=Math.ceil(d.documentElement.scrollHeight)+'px';return {width:f.contentWindow.innerWidth,scrollWidth:d.documentElement.scrollWidth,height:d.documentElement.scrollHeight,cardTop:c.getBoundingClientRect().top,cardHeight:c.getBoundingClientRect().height,animations:d.getAnimations().filter(a=>a.playState==='running').length};});
   const png=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:m.cardTop,width:390,height:Math.min(Math.ceil(m.cardHeight),16000),scale:1}},sessionId);
   const file=path.join(out,'check-card-390-'+theme+'.png');fs.writeFileSync(file,Buffer.from(png.data,'base64'));
   const b=fs.readFileSync(file),valid=b.length>100&&b.readUInt32BE(16)===390;
   records.push({theme,file,status:valid&&m.width===390&&m.scrollWidth<=390&&!m.animations?'PASS':'FAIL',...m});
  }
  await call('Browser.close');return {status:records.every(r=>r.status==='PASS')?'PASS':'FAIL',version,records};
 }catch(e){return {status:'FAIL',reason:e.message,stderr:stderr.slice(-4000),attempt};}
 finally{
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CAPTURE_CLOSED'));}pending.clear();
  if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGKILL');
 }
}
for(let attempt=1;attempt<=2;attempt++){const r=await capture(attempt);attempts.push(r);if(r.status==='PASS')break;}
const result={status:attempts.at(-1).status,attempts};
writeUTF8(path.join(out,'capture.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=1;
