// UI-button trial: when the question's capability (PDF / PPTX export …) lives only behind a UI control,
// start the app's dev server in an isolated copy with loopback-only networking, drive it headlessly,
// click the control, keep the produced file and check what it is. Never touches the original repo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {copyRepo,snapshot,snapOther,subPackages,netIsolation,trialStats} from './usage-route.mjs';
import {isMain} from './is-main.mjs';
const readJson=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const HERE=path.dirname(new URL(import.meta.url).pathname);
// formats a question can ask for, and how each shows up on a button
export const UI_FORMATS={pdf:'\\bpdf\\b',pptx:'\\bpptx\\b|powerpoint',html:'\\bhtml\\b',png:'\\bpng\\b',svg:'\\bsvg\\b',docx:'\\bdocx\\b|\\bword\\b',xlsx:'\\bxlsx\\b|excel',csv:'\\bcsv\\b',zip:'\\bzip\\b'};
export function uiTargets(m){
 const q=(m.question??'').toLowerCase(),want=Object.keys(UI_FORMATS).filter(k=>new RegExp(UI_FORMATS[k],'i').test(q));
 const caps=(m.capabilities??[]).filter(c=>c.ui&&!c.onRoute);const out=[];
 for(const f of want){const c=caps.find(c=>c.term===f)??caps.find(c=>new RegExp(UI_FORMATS[f],'i').test(path.basename(c.file)));if(c)out.push({term:f,re:UI_FORMATS[f],file:c.file,via:c.via??[]});}
 return out;}
// the package that holds a file
function pkgOf(root,file){let d=path.dirname(path.join(root,file));while(d.startsWith(root)){if(fs.existsSync(path.join(d,'package.json')))return path.relative(root,d);if(d===root)break;d=path.dirname(d);}return '';}
// which workspace package serves the UI: one with a dev/start script that is (or depends on) the package holding the UI file; apps/examples first
export function findServe(root,file){
 const owner=pkgOf(root,file),ownerName=readJson(path.join(root,owner,'package.json'))?.name;const dirs=['',...subPackages(root)];
 const cands=[];for(const d of dirs){const p=readJson(path.join(root,d,'package.json'));if(!p?.scripts)continue;const s=['dev','start','serve','preview'].find(k=>p.scripts[k]);if(!s)continue;
  const deps={...p.dependencies,...p.devDependencies};const uses=d===owner||(ownerName&&deps[ownerName]);if(!uses)continue;
  if(/\b(turbo|nx|lerna|concurrently|npm-run-all|pnpm\s+-r|--filter)\b/.test(p.scripts[s]))continue;
  cands.push({dir:d,script:s,line:p.scripts[s],score:(/^(apps|examples?|demo|sites?)\//.test(d)?3:0)+(d===owner?1:0)+(s==='dev'?1:0)});}
 cands.sort((a,b)=>b.score-a.score);const c=cands[0];if(!c)return null;
 // resolve the script's program: local .bin, root .bin, or a workspace package's bin
 const toks=c.line.split('&&').pop().trim().split(/\s+/),prog=toks[0];const bins=new Map();
 for(const d of dirs){const p=readJson(path.join(root,d,'package.json'));const b=typeof p?.bin==='string'?{[p.name?.split('/').pop()]:p.bin}:p?.bin??{};for(const [k,v] of Object.entries(b))bins.set(k,path.join(d,v));}
 let file2=bins.get(prog)??null;if(!file2)for(const b of [path.join(c.dir,'node_modules/.bin',prog),path.join('node_modules/.bin',prog)])if(fs.existsSync(path.join(root,b))){file2=b;break;}
 return {...c,owner,prog,args:toks.slice(1),bin:file2,why:'用 '+(c.dir||'根目錄')+' 的 '+c.script+' 指令（'+c.line+'）開介面'+(c.dir===owner?'':'；它依賴放按鈕的套件 '+(ownerName??owner))};}
// copy with node_modules linked one level deep: new folders the server writes (.vite, caches) land in the copy, not the original
export function linkModulesShallow(root,copy){const walk=(rel,depth)=>{let es;try{es=fs.readdirSync(path.join(root,rel),{withFileTypes:true});}catch{return;}
 for(const x of es){if(!x.isDirectory())continue;const r=rel?rel+'/'+x.name:x.name;
  if(x.name==='node_modules'){if(!fs.existsSync(path.join(copy,rel)))continue;fs.mkdirSync(path.join(copy,r),{recursive:true});
   for(const e of fs.readdirSync(path.join(root,r))){const src=path.join(root,r,e),dst=path.join(copy,r,e);if(fs.existsSync(dst))continue;let t=null;try{t=fs.readlinkSync(src);}catch{}
    // a relative link to a workspace package stays relative (points into the copy); everything else links to the original, read-through
    const real=t&&!path.isAbsolute(t)?path.resolve(path.join(root,r),t):null;
    if(real&&real.startsWith(root+path.sep)&&!real.includes(path.sep+'node_modules'+path.sep))fs.symlinkSync(t,dst);else if(e.startsWith('@')&&!t){fs.mkdirSync(dst);for(const s of fs.readdirSync(src)){const t2=(()=>{try{return fs.readlinkSync(path.join(src,s));}catch{return null;}})(),r2=t2&&!path.isAbsolute(t2)?path.resolve(src,t2):null;
      if(r2&&r2.startsWith(root+path.sep)&&!r2.includes(path.sep+'node_modules'+path.sep))fs.symlinkSync(t2,path.join(dst,s));else fs.symlinkSync(path.join(src,s),path.join(dst,s));}}
    else fs.symlinkSync(src,dst);}}
  else if(depth<4&&!/^(\.git|\.venv|venv|__pycache__|dist|build)$/.test(x.name)&&!x.name.startsWith('.'))walk(r,depth+1);}};walk('',0);}
export function findDriver(){const py=[process.env.TCL_PLAYWRIGHT_PYTHON,'python3'].filter(Boolean).find(p=>spawnSync(p,['-c','import playwright'],{encoding:'utf8'}).status===0)??null;
 const chrome=[process.env.TCL_CHROME,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(p=>fs.existsSync(p))??null;return {python:py,chrome};}
// what the produced file is: PDF pages, PPTX slides (zip parts), or just its first bytes
export function inspectOutput(file){const b=fs.readFileSync(file);const head=b.subarray(0,8).toString('latin1');
 if(head.startsWith('%PDF-')){const t=b.toString('latin1');let pages=(t.match(/\/Type\s*\/Page(?!s)/g)??[]).length,size=null,textChars=null;
  // poppler, when the box has it: page count from the trailer, page size, and whether the pages carry selectable text
  const info=spawnSync('pdfinfo',[file],{encoding:'utf8'});if(info.status===0){pages=+(info.stdout.match(/Pages:\s+(\d+)/)?.[1]??pages);size=info.stdout.match(/Page size:\s+([^\n]+)/)?.[1]?.trim()??null;}
  const tx=spawnSync('pdftotext',['-l','3',file,'-'],{encoding:'utf8',maxBuffer:8*1024*1024});if(tx.status===0)textChars=tx.stdout.replace(/\s+/g,'').replace(/^\d+$/,'').length;
  return {kind:'pdf',ok:pages>0,pages,version:head.slice(5,8),size,textChars,note:(pages?pages+' 頁':'看不到頁面物件')+(size?'，'+size:'')+(textChars===null?'':textChars>20?'，有可選取文字':'，前 3 頁幾乎沒有可選取文字（字可能畫成圖形）')};}
 if(head.startsWith('PK')){const t=b.toString('latin1');const parts=[...new Set(t.match(/ppt\/slides\/slide\d+\.xml|word\/document\.xml|xl\/workbook\.xml|\[Content_Types\]\.xml/g)??[])];const slides=parts.filter(p=>/ppt\/slides\//.test(p)).length;
  const kind=parts.some(p=>p.startsWith('ppt/'))?'pptx':parts.some(p=>p.startsWith('word/'))?'docx':parts.some(p=>p.startsWith('xl/'))?'xlsx':'zip';
  // first slide's text runs (editable text, not a picture), when unzip is on the box
  let sample=null;if(kind==='pptx'){const z=spawnSync('unzip',['-p',file,'ppt/slides/slide1.xml'],{encoding:'utf8',maxBuffer:8*1024*1024});if(z.status===0)sample=[...z.stdout.matchAll(/<a:t>([^<]*)/g)].map(x=>x[1]).filter(Boolean);}
  return {kind,ok:kind!=='zip'?parts.includes('[Content_Types].xml'):true,slides:kind==='pptx'?slides:undefined,textRuns:sample?.length,textSample:sample?.slice(0,3).join(' / ').slice(0,120),note:kind==='pptx'?slides+' 張投影片'+(sample?sample.length?'，第 1 張有 '+sample.length+' 段可編輯文字':'，第 1 張沒有可編輯文字（可能整張是圖）':''):kind};}
 if(/^\s*<(!doctype|html)/i.test(b.subarray(0,200).toString('utf8')))return {kind:'html',ok:true,note:'HTML'};
 return {kind:'unknown',ok:b.length>0,note:'前幾個位元組 '+JSON.stringify(head)};}
export function runUiTrial(root,m,{budgetS=300,keepDir=null}={}){
 root=path.resolve(root);const targets=uiTargets(m);if(!targets.length)return null;
 const t0=Date.now(),serve=findServe(root,targets[0].file),drv=findDriver(),unshare=netIsolation();
 const base={ran:false,targets:targets.map(t=>({term:t.term,file:t.file})),serve:serve&&{dir:serve.dir,script:serve.script,line:serve.line,why:serve.why}};
 if(!serve)return {...base,skipped:'找不到會開這個介面的 dev／start 指令'};
 if(!serve.bin)return {...base,skipped:'dev 指令的程式 '+serve.prog+' 在副本裡找不到（沒裝依賴？）'};
 if(!drv.python)return {...base,skipped:'這台沒有可用的瀏覽器驅動（Python playwright）；設 TCL_PLAYWRIGHT_PYTHON 指到裝了 playwright 的 python 再跑'};
 if(process.platform==='win32')return {...base,skipped:'Windows 不做介面試跑（要 Linux 的只開本機回環）；在 Linux 上再試'};
 if(!unshare)return {...base,skipped:'沒有 unshare，無法只開本機回環；為了不連外，介面試跑略過'};
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tcl-ui-')),copy=path.join(tmp,'repo'),dl=path.join(tmp,'downloads');fs.mkdirSync(dl);
 try{copyRepo(root,copy);linkModulesShallow(root,copy);
  const before=snapshot(copy),beforeH=snapOther(tmp);const binAbs=path.join(copy,serve.bin);const isJs=/\.[cm]?js$/.test(binAbs)||/^#!.*node/.test(fs.readFileSync(fs.realpathSync(binAbs),'utf8').slice(0,60));
  const cmd=isJs?[process.execPath,binAbs,...serve.args]:[binAbs,...serve.args];
  const env={PATH:process.env.PATH,HOME:tmp,TMPDIR:tmp,LANG:'C.UTF-8',NO_COLOR:'1',TCL_UI_PROBE:JSON.stringify({cmd,cwd:path.join(copy,serve.dir),waitMs:90000,driver:{python:drv.python,cfg:{targets:targets.map(t=>({term:t.term,re:t.re,file:t.file})),downloadDir:dl,chrome:drv.chrome,budgetS}}})};
  if(process.env.PLAYWRIGHT_BROWSERS_PATH)env.PLAYWRIGHT_BROWSERS_PATH=process.env.PLAYWRIGHT_BROWSERS_PATH;
  trialStats.spawned++;
  const r=spawnSync('unshare',['-rn','--','sh','-c','ip link set lo up 2>/dev/null; exec "$0" "$1"',process.execPath,path.join(HERE,'ui-probe.mjs')],{env,encoding:'utf8',timeout:(budgetS+180)*1000,maxBuffer:32*1024*1024});
  const line=(r.stdout??'').split('\n').find(l=>l.startsWith('@@TCL_UI@@'));const probe=line?JSON.parse(line.slice(line.indexOf('{'))):{error:((r.stderr??'')+(r.error?String(r.error):'')).slice(-800)};
  const after=snapshot(copy),afterH=snapOther(tmp);const squash=ks=>{const g=new Map();for(const k of ks){const top=k.split('/').slice(0,k.startsWith('node_modules')||/^\./.test(k)?2:3).join('/');g.set(top,(g.get(top)??0)+1);}return [...g].map(([k,n])=>n>1?k+'/…（'+n+' 個）':k);};
  const changed=[...after.keys()].filter(k=>before.get(k)!==after.get(k));const home=[...afterH.keys()].filter(k=>beforeH.get(k)!==afterH.get(k)&&!k.startsWith('downloads/'));
  const res=(probe.driver?.targets??[]).map(t=>{const o=t.download&&fs.existsSync(t.download.path)?inspectOutput(t.download.path):null;
   if(o&&keepDir){fs.mkdirSync(keepDir,{recursive:true});fs.copyFileSync(t.download.path,path.join(keepDir,path.basename(t.download.path)));}
   return {term:t.term,file:t.file,ms:t.ms,clicked:t.clicked,via:t.via,pagesTried:t.pagesTried?.map(u=>u.replace(probe.base,'')),download:t.download&&{name:t.download.name,bytes:t.download.bytes,failure:t.download.failure,...(t.download.viaPrint?{viaPrint:true}:{})},output:o,ok:!!(o?.ok&&!t.download?.failure),error:t.error};});
  return {...base,ran:true,network:'off',isolation:'獨立網路命名空間（只有本機回環），在 repo 副本裡開 dev 伺服器，用無頭瀏覽器點按鈕',listened:!!probe.listened,startedMs:probe.startedMs,base:probe.base,
   results:res,outsideRequests:probe.driver?.requests?.outside??[],outsideHosts:[...new Set((probe.driver?.requests?.outside??[]).map(u=>{try{return new URL(u).host;}catch{return u.slice(0,40);}}))],loopbackRequests:probe.driver?.requests?.loopback??0,console:probe.driver?.console??[],driverError:probe.driver?.error??probe.error??null,
   changed:squash(changed),changedCount:changed.length,homeWrites:squash(home),serverTail:(probe.stderr||probe.stdout||'').split('\n').filter(Boolean).slice(-6).join('\n'),ms:Date.now()-t0,at:new Date().toISOString()};}
 finally{fs.rmSync(tmp,{recursive:true,force:true});}}

// one sentence for 怎麼接, and the HTML block for the route / 試跑 sections
const labelOf=r=>[...(r.via??[]),r.clicked?.label].filter(Boolean).join(' → ');
export function uiTrialSentence(u){if(!u)return '';if(!u.ran)return '介面試跑沒跑：'+u.skipped;
 if(!u.listened)return '介面試跑：'+(u.serve?.line??'dev 指令')+' 在隔離副本裡沒有開起來（'+(u.serverTail||'沒有輸出').split('\n').pop().slice(0,80)+'）';
 const rs=u.results.map(r=>r.ok?'按「'+labelOf(r)+'」拿到 '+r.output.kind.toUpperCase()+'（'+r.output.note+(r.download?.viaPrint?'；按鈕是叫瀏覽器列印，由無頭瀏覽器代替列印對話框存檔':'')+'）':(r.clicked?'按「'+labelOf(r)+'」後沒拿到檔（'+(r.error??'')+'）':'找不到 '+r.term.toUpperCase()+' 的按鈕'));
 return '介面試跑（隔離副本開 '+(u.serve.dir||'根目錄')+' 的 '+u.serve.script+'，只開本機回環，無頭瀏覽器操作）：'+rs.join('；')+(u.outsideHosts?.length?'；頁面想連外 '+u.outsideHosts.join('、')+'（已擋，沒影響產出）':'')+(u.changedCount?'；副本裡改了 '+u.changedCount+' 個檔':'；repo 副本沒有被改');}
export function uiTrialHtml(u,esc){if(!u)return '';
 const head='<h2>介面試跑（隔離副本＋無頭瀏覽器）</h2>';if(!u.ran)return head+'<p class="muted">沒跑：'+esc(u.skipped)+'</p>';
 const rows=(u.results??[]).map(r=>'<tr><td data-k="要的">'+esc(r.term.toUpperCase())+'<br><code class="small">'+esc(r.file)+'</code></td><td data-k="按了">'+(r.clicked?esc(labelOf(r)):'<span class="chip red">找不到按鈕</span>')+'<br><span class="muted small">頁面 '+esc((r.pagesTried??[]).join('、'))+'</span></td><td data-k="結果">'+(r.ok?'<span class="chip green">拿到檔案</span> ':'<span class="chip red">沒拿到</span> ')+esc(r.output?r.output.kind.toUpperCase()+'：'+r.output.note+(r.download?' · '+Math.round(r.download.bytes/1024)+' KB':''):r.error??'')+(r.download?.viaPrint?'<br><span class="muted small">按鈕呼叫 window.print()；無頭瀏覽器代替列印對話框「存成 PDF」</span>':'')+(r.output?.textSample?'<br><span class="muted small">第 1 張文字：'+esc(r.output.textSample)+'</span>':'')+'</td></tr>').join('');
 return head+'<p class="muted">'+esc(u.isolation)+'；'+esc(u.serve?.why??'')+'；伺服器 '+(u.listened?'在 '+esc(u.base)+' 起來（'+esc(Math.round((u.startedMs??0)/100)/10)+' 秒）':'<b>沒起來</b>')+'；全程 '+esc(Math.round(u.ms/1000))+' 秒</p>'+
  (rows?'<table><thead><tr><th>要的</th><th>按了</th><th>結果</th></tr></thead><tbody>'+rows+'</tbody></table>':'')+
  '<ul class="small"><li>連外：'+(u.outsideHosts?.length?'頁面想連 '+esc(u.outsideHosts.join('、'))+'（命名空間沒有網路，全被擋）':'沒有')+'；本機請求 '+esc(u.loopbackRequests)+' 個</li><li>改檔：'+(u.changedCount?esc(u.changed.join('、')):'repo 副本沒有被改')+'；家目錄／暫存：'+(u.homeWrites?.length?esc(u.homeWrites.join('、')):'沒有')+'</li>'+(u.console?.length?'<li>瀏覽器錯誤 '+u.console.length+' 則，例如：'+esc(u.console[0])+'</li>':'')+(u.driverError?'<li>驅動錯誤：'+esc(u.driverError)+'</li>':'')+'</ul>';}
// child-process mode, so the UI trial runs while the command-line trial runs: node ui-trial.mjs <model.json> <result.json> [keepDir]
if(isMain(import.meta.url)){const [mf,out,keep]=process.argv.slice(2);const m=JSON.parse(fs.readFileSync(mf,'utf8'));
 let r;try{r=runUiTrial(m.root,m,{keepDir:keep||null});}catch(e){r={ran:false,skipped:'介面試跑出錯：'+String(e.message??e).slice(0,200)};}fs.writeFileSync(out,JSON.stringify(r));}
