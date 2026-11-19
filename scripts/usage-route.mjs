// 1.38 usage-route: start from "how I want to use this repo", trace that one route station by station.
// 使用說明 → 入口 → 讀取輸入 → 轉換 → 輸出 (+ 錯誤). Only touches this route reaches count as 接入條件;
// the rest are listed as "repo 有、這條路沒走到". Read-only unless --trial (isolated copy, network off).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pyEntries} from './ast-python.mjs';
import {spawnSync} from 'node:child_process';
import {loadAst,buildGraph,reach,touches,pathTo,findUnit,externalCalls,stats,exportRoots,CAP_LABEL,JS_FILE} from './ast-graph.mjs';
import {TEST_PATH,scanTarget} from './preflight.mjs';
const sha256=s=>crypto.createHash('sha256').update(s).digest('hex');
const readJson=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const git=(root,args)=>{const r=spawnSync('git',['--no-pager','-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}});return r.status===0?r.stdout.trim():null;};
const lineOf=(body,needle)=>{const i=body.indexOf(needle);return i<0?null:body.slice(0,i).split('\n').length;};
const OTHER_PROGRAM=new Set(['subprocess','network','listen','paid','real-account','worker','mcp-tools']);
// Entries a stranger would use: package.json bin / main / exports, plus README usage lines.
export function findEntries(root){
 root=path.resolve(root);const pkgBody=fs.existsSync(path.join(root,'package.json'))?fs.readFileSync(path.join(root,'package.json'),'utf8'):'';const pkg=pkgBody?readJson(path.join(root,'package.json')):null;
 const out=[],norm=p=>path.posix.normalize(String(p).replace(/^\.\//,''));
 const bins=typeof pkg?.bin==='string'?{[pkg.name?.split('/').pop()??'cli']:pkg.bin}:pkg?.bin??{};
 for(const [name,file] of Object.entries(bins))out.push({kind:'bin',name,file:norm(file),declared:{file:'package.json',line:lineOf(pkgBody,JSON.stringify(file))??lineOf(pkgBody,'"bin"')}});
 // Library: every string target in exports['.'] (types skipped) + main/module; first one that exists in the repo wins.
 const targets=[],walk=(x,k='')=>{if(typeof x==='string'){if(!/\.d\.[cm]?ts$/.test(x)&&k!=='types')targets.push(x);}else if(Array.isArray(x))x.forEach(y=>walk(y,k));else if(x&&typeof x==='object')for(const [kk,v] of Object.entries(x))if(kk!=='types'&&!kk.startsWith('./')||kk==='.')walk(v,kk);};
 const exp=pkg?.exports;if(exp)walk(typeof exp==='object'&&!Array.isArray(exp)&&Object.keys(exp).some(k=>k.startsWith('.'))?exp['.']:exp);
 for(const x of [pkg?.main,pkg?.module])if(typeof x==='string')targets.push(x);targets.push('index.js','index.ts','src/index.ts');
 const exists=f=>{f=norm(f);if(fs.existsSync(path.join(root,f))&&fs.statSync(path.join(root,f)).isFile())return f;const ts=f.replace(/\.(m?js|cjs)$/,'.ts');if(ts!==f&&fs.existsSync(path.join(root,ts)))return ts;return null;};
 const lib=targets.map(t=>[t,exists(t)]).find(([,f])=>f);
 const missing=[...new Set(targets.filter(t=>!exists(t)&&!/^(index\.(js|ts)|src\/index\.ts)$/.test(t)))];
 if(lib)out.push({kind:'library',name:pkg?.name??path.basename(root),file:lib[1],declared:{file:pkg?'package.json':'(預設)',line:pkg?lineOf(pkgBody,JSON.stringify(lib[0])):null},...(missing.length?{notBuilt:missing.slice(0,4)}:{})});
 // Python: console_scripts / [project.scripts] → module file; package/__main__.py → `python -m pkg`; package/__init__.py → import API.
 const pyMeta=pyProjectMeta(root);const pyFile=mod=>{for(const r of ['','src/'])for(const c of [r+mod.split('.').join('/')+'.py',r+mod.split('.').join('/')+'/__init__.py'])if(fs.existsSync(path.join(root,c)))return c;return null;};
 for(const e of pyEntries(root)){const file=pyFile(e.module);if(file)out.push({...e,file});}
 for(const r of ['','src/'])for(const d of (()=>{try{return fs.readdirSync(path.join(root,r||'.'),{withFileTypes:true}).filter(x=>x.isDirectory()&&/^[A-Za-z_]\w*$/.test(x.name)&&!/^(tests?|docs?|examples?|scripts?|build|dist)$/.test(x.name)).map(x=>x.name);}catch{return [];}})()){
  if(fs.existsSync(path.join(root,r,d,'__main__.py')))out.push({kind:'bin',name:'python -m '+d,module:d,lang:'python',file:r+d+'/__main__.py',declared:{file:r+d+'/__main__.py',line:1}});
  if(!lib&&fs.existsSync(path.join(root,r,d,'__init__.py'))&&(pyMeta.name?.replace(/-/g,'_')===d||out.some(e=>e.module?.split('.')[0]===d)))out.push({kind:'library',name:d,lang:'python',file:r+d+'/__init__.py',declared:{file:r+d+'/__init__.py',line:1}});}
 const readme=['README.md','readme.md','Readme.md','README.rst','README'].find(f=>fs.existsSync(path.join(root,f)));
 const usage=[];
 if(readme){const lines=fs.readFileSync(path.join(root,readme),'utf8').split(/\r?\n/);let fence=false;
  lines.forEach((l,i)=>{if(/^\s*```/.test(l)){fence=!fence;return;}if(!fence)return;
   for(const e of out){const n=e.kind==='bin'||e.lang==='python'?e.name:pkg?.name;if(!n)continue;const esc=n.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&');
    const re=e.kind==='bin'?new RegExp('(^|[\\s$|>])'+esc+'(\\s|$)'):e.lang==='python'?new RegExp('^(>>>\\s*)?(import\\s+'+esc+'\\b|from\\s+'+esc+'(\\.|\\s))'):new RegExp('(require\\(|from\\s+)[\'"]'+esc+'[\'"]');
    if(re.test(l)&&!/npm\s+(i|install)|yarn\s+add|pnpm\s+add/.test(l))usage.push({entry:e.kind+':'+e.name,file:readme,line:i+1,text:l.trim().slice(0,120)});}});}
 return {pkg:pkg?{name:pkg.name,version:pkg.version}:pyMeta.name?pyMeta:null,entries:out,usage};
}
function pyProjectMeta(root){const r=f=>{try{return fs.readFileSync(path.join(root,f),'utf8');}catch{return '';}};const t=r('pyproject.toml')+'\n'+r('setup.cfg')+'\n'+r('setup.py');
 const name=t.match(/^\s*name\s*=\s*['"]([\w.-]+)['"]/m)?.[1]??null,version=t.match(/^\s*version\s*=\s*['"]([\w.+-]+)['"]/m)?.[1]??null;return {name,version};
}
// Which entry fits the one-sentence usage. Hint wins: bin:<name>, library, or a file path.
export function chooseEntry(found,question='',hint=null){
 const {entries}=found;
 if(hint){if(/^bin(:|$)/.test(hint)){const n=hint.split(':')[1];return entries.find(e=>e.kind==='bin'&&(!n||e.name===n))??null;}
  if(/^(lib|library|main|api)$/.test(hint))return entries.find(e=>e.kind==='library')??null;
  return {kind:/(^|\/)(bin|cli)\//.test(hint)?'bin':'file',name:path.posix.basename(hint),file:path.posix.normalize(hint),declared:{file:'(指定)',line:null}};}
 const wantsApi=/函式|API|api|require|import|程式庫|library|模組|呼叫它的函式/.test(question);
 const wantsCli=/命令列|指令|CLI|cli|終端|command|檔案|一份|這份檔|stdout|標準輸出/.test(question);
 if(wantsApi&&!wantsCli)return entries.find(e=>e.kind==='library')??entries[0]??null;
 return entries.find(e=>e.kind==='bin')??entries[0]??null;
}
const KEYWORDS=q=>{const k=new Set(['convert','transform','parse','process','render','compile','format','handle']);for(const w of (q.toLowerCase().match(/[a-z]{3,}/g)??[]))k.add(w);
 if(/轉/.test(q))k.add('convert').add('transform');if(/解析|讀/.test(q))k.add('parse');if(/匯出|輸出/.test(q))k.add('export');return [...k];};
function codeAt(g,root,file,line){const f=g?.files.get(file);let l=f?.lines[line-1];if(l==null)try{l=fs.readFileSync(path.join(root,file),'utf8').split(/\r?\n/)[line-1];}catch{l='';}return {code:(l??'').trim().slice(0,140),lineSha256:sha256(l??'')};}
const isHelpUnit=u=>/help|usage|version/i.test(u??'');
const errCtx=t=>(t.ctx??[]).some(c=>/事件 error|catch|出錯/.test(c));
// Build the route. Returns the full model (no I/O besides reading the repo).
export async function traceRoute(root,{question='',entry:hint=null,fn=null,ast=null}={}){
 root=path.resolve(root);ast=ast??await loadAst();
 const found=findEntries(root),entry=chooseEntry(found,question,hint);
 const commit=git(root,['rev-parse','HEAD']),dirty=commit?!!git(root,['status','--porcelain','--untracked-files=no']):null;
 const model={schema:'trace-usage-route-v1',question,root,generatedAt:new Date().toISOString(),
  repo:{name:found.pkg?.name??path.basename(root),version:found.pkg?.version??null,commit,dirty},
  engine:ast.ok?{name:'tree-sitter',version:ast.version}:{name:'regex-fallback',reason:ast.reason},
  entry,candidates:found.entries,usage:found.usage,stations:[],touches:{route:[],elsewhere:[]},unknowns:[],trial:null,answer:null};
 if(!entry){model.unknowns.push({kind:'no-entry',text:'package.json 沒有 bin、main 或 exports，也沒有 index.js；請用 --entry 指定入口檔。'});model.answer=draftAnswer(model);return model;}
 if(!ast.ok){model.unknowns.push({kind:'no-ast',text:ast.reason});
  // Regex fallback: whole-repo hints, not split by route (says so in the report).
  try{model.touches.elsewhere=scanTarget(root).findings.filter(f=>f.line&&!f.test&&!f.typesOnly&&['subprocess','network','listen','paid','real-account'].includes(f.kind)).map(f=>({cap:f.kind,label:f.label,file:f.file,line:f.line,ctx:['文字比對，沒分這條路']}));}catch{}
  model.answer=draftAnswer(model);return model;}
 const g=buildGraph(ast,root);model.stats=stats(g);
 const entryFile=g.files.has(entry.file)?entry.file:[...g.files.keys()].find(f=>f===entry.file.replace(/\.(m?js|cjs)$/,'.ts'))??null;
 if(!entryFile){model.unknowns.push({kind:'entry-missing',text:'入口檔 '+entry.file+' 不在 repo 裡（可能要先建置才會產生）；這條路無法追。'});model.answer=draftAnswer(model);return model;}
 // Library entry: every export is API surface, so all exported units are roots.
 let roots=entry.kind==='bin'?[entryFile+'::<top>']:exportRoots(g,entryFile);
 // Python console script `mod:func` runs func after import; `python -m pkg` / a script runs its __main__ block.
 if(entry.lang==='python'&&entry.kind==='bin'){if(entry.fn&&g.files.get(entryFile).units.has(entryFile+'::'+entry.fn))roots.push(entryFile+'::'+entry.fn);if(!entry.fn&&g.files.get(entryFile).units.has(entryFile+'::<main>'))roots.push(entryFile+'::<main>');}
 if(entry.kind!=='bin'){
  // Narrow a library route to the function the usage sentence names: status(), `get`, GET …
  const names=[...new Set([...question.matchAll(/([A-Za-z_$][\w$]*)\s*\(\s*\)/g)].map(m=>m[1]).concat([...question.matchAll(/`([A-Za-z_$][\w$.]*)`/g)].map(m=>m[1].split('.').pop()),[...question.matchAll(/\b(GET|POST|PUT|DELETE|PATCH|HEAD)\b/g)].map(m=>m[1].toLowerCase())))];
  if(fn){const [ff,nn]=fn.includes(':')?[fn.slice(0,fn.lastIndexOf(':')),fn.slice(fn.lastIndexOf(':')+1)]:[null,fn];names.splice(0,names.length,nn.split('.').pop());if(ff)model.fnFile=ff;}
  if(names.length){const api=reach(g,roots),pkgTok=String(found.pkg?.name??'').toLowerCase().replace(/^@[^/]+\//,'').replace(/[^a-z0-9]/g,'');
   const cand=[];for(const f of g.files.values()){if(TEST_PATH.test(f.rel)||model.fnFile&&f.rel!==model.fnFile)continue;for(const u of f.units.values())if(names.includes(u.name.split('.').pop())&&u.name!=='<top>')cand.push({id:u.id,u,reached:api.has(u.id),primary:!u.cls||!!pkgTok&&new RegExp('^'+pkgTok+'(api|client|core|impl)?$').test(u.cls.toLowerCase().replace(/[^a-z0-9]/g,''))});}
   const groups=new Set(cand.map(c=>c.u.cls??c.u.file));
   const pick=fn?cand:cand.filter(c=>c.primary);
   pick.sort((x,y)=>y.reached-x.reached);
   if(pick.length){model.target={names,units:pick.slice(0,4).map(c=>c.id),how:fn?'指定':'依問句'};roots=pick.slice(0,4).map(c=>c.id);
    if(!fn&&cand.length>pick.length)model.unknowns.push({kind:'target',text:'問句的 '+names.join('、')+' 也對到 '+cand.filter(c=>!pick.includes(c)).slice(0,3).map(c=>c.u.name).join('、')+'；這次選 '+pick.slice(0,2).map(c=>c.u.name).join('、')+'，不對就用 --fn 檔:函式 指定。'});
    // safety net: what the whole API touches but this narrow route does not
    const wide=touches(g,api).filter(t=>t.reached&&OTHER_PROGRAM.has(t.cap)),narrow=touches(g,reach(g,roots,{classes:api.classes})).filter(t=>t.reached);model.apiClasses=api.classes;
    const miss=[...new Set(wide.filter(t=>!narrow.some(n=>n.cap===t.cap)).map(t=>t.label))];
    if(miss.length)model.unknowns.push({kind:'narrow',text:'整個 API 還會'+miss.join('、')+'，但從 '+names.join('、')+' 追不到；若中間有動態呼叫，實際可能會走到，待試跑確認。'});}
   else model.unknowns.push({kind:'target',text:'問句的 '+names.join('、')+(cand.length?' 對到多個不相關的函式（'+cand.slice(0,3).map(c=>c.u.name).join('、')+'），無法確定':' 在原碼找不到同名函式（可能是動態產生的方法）')+'；這次從全部匯出追，範圍會比較大。可用 --fn 檔:函式 指定。'});}
 }
 const parent=reach(g,roots,{classes:model.apiClasses??null,hints:KEYWORDS(question)});if(parent.dynPicked)model.dynPicked=parent.dynPicked;model.reachedUnits=parent.size;delete model.apiClasses;
 const all=touches(g,parent).filter(t=>!(t.file===entryFile&&t.cap==='dynamic'&&false));
 const test=t=>TEST_PATH.test(t.file);
 // A touch with no condition of its own may still sit in a function only called under a condition (if magic: run()).
 const callerCtx=t=>{if(t.ctx?.length)return [];const p=pathTo(parent,t.unit);for(const s of p.slice(-3).reverse())if(s.ctx?.length)return ['呼叫處 '+s.file+':'+s.line+' '+s.ctx[0]];return [];};
 model.touches.route=all.filter(t=>t.reached).map(t=>{const cc=callerCtx(t);return {...t,ownCtx:t.ctx??[],ctx:[...(t.ctx??[]),...cc],via:pathTo(parent,t.unit).map(s=>s.file?s.file+':'+s.line:null).filter(Boolean).slice(-6)};});
 model.touches.elsewhere=all.filter(t=>!t.reached&&!test(t));
 const st=[],add=(label,role,x,extra={})=>{if(!x)return;const c=codeAt(g,root,x.file,x.line);st.push({label,role,file:x.file,line:x.line,...c,unit:x.unit??null,ctx:x.ctx??[],via:x.via??[],status:x.status??'原碼已核對',...extra});};
 const kw0=KEYWORDS(question).filter(k=>!['convert','transform','parse','process','render','compile','format','handle'].includes(k)),mine=found.usage.filter(u=>u.entry===entry.kind+':'+entry.name);
 const u0=mine.find(u=>kw0.some(k=>u.text.toLowerCase().includes(k)))??mine.find(u=>/\bFILE\b|<\s*\S|\bcat\b/.test(u.text))??mine[0]??found.usage[0];
 if(u0)add('使用說明','usage',{...u0,status:'文件'});
 if(entry.declared?.line)add(entry.kind==='bin'?'命令列入口（宣告）':'函式入口（宣告）','entry-decl',{file:entry.declared.file,line:entry.declared.line});
 add(entry.kind==='bin'?'命令列入口':'函式入口','entry',{file:entryFile,line:firstCodeLine(g.files.get(entryFile)),unit:entryFile+'::<top>'});
 for(const id of model.target?.units?.slice(0,2)??[]){const u=findUnit(g,id);add('呼叫的函式 '+u.name,'entry',{file:u.file,line:u.line,unit:id});}
 const R=model.touches.route,pick=(...caps)=>R.filter(t=>caps.includes(t.cap));
 const inputs=pick('read-file').filter(t=>!/exists|stat|access|listdir|scandir|walk|glob|readdir/.test(t.canon??'')).sort((a,b)=>(a.ownCtx?.length?1:0)-(b.ownCtx?.length?1:0));const stdin=pick('stdin'),args=pick('args');
 if(args[0])add('讀命令列參數','args',args[0]);
 const stdinMain=stdin.find(t=>/pipe|setEncoding|on\(|\.read\(|buffer/.test(t.text)&&!/isatty/.test(t.text))??stdin.find(t=>!/isatty/.test(t.text))??stdin[0];
 const fileFirst=inputs.length&&!(inputs[0].ownCtx?.length&&stdinMain&&!/檔/.test(question));
 if(!fileFirst&&stdinMain)add('讀取輸入（標準輸入）','input',stdinMain);
 for(const t of inputs.slice(0,3))add(t.ownCtx?.length?'讀取輸入（檔案，有條件）':'讀取輸入（檔案）','input',t);
 if(fileFirst&&stdinMain)add('讀取輸入（標準輸入）','input',stdinMain);
 // Transform. CLI: reached unit outside the entry folder whose name matches the usage words.
 // Library: the actual call chain from the named function toward the first risky touch (or output).
 if(entry.kind!=='bin'){const goal=R.find(t=>OTHER_PROGRAM.has(t.cap))??R.find(t=>['write-file','stdout','read-file'].includes(t.cap));
  if(goal&&model.target){const p=pathTo(parent,goal.unit).slice(1);for(const s0 of p.slice(-5)){const u=findUnit(g,s0.unit);if(!u)continue;add('經過 '+u.name,'transform',{file:s0.file??u.file,line:s0.line??u.line,unit:s0.unit,status:s0.inferred?'推論（'+s0.why+'）':'原碼已核對'},{why:s0.why});}}}
 else{
 const kw=KEYWORDS(question),cand=[];
 for(const id of parent.keys()){const u=findUnit(g,id);if(!u||u.name==='<top>'||u.file===entryFile||path.posix.dirname(u.file)===path.posix.dirname(entryFile)&&entry.kind==='bin'||TEST_PATH.test(u.file))continue;const toks=u.name.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),last=toks.at(-1),score=kw.filter(k=>toks.includes(k)||k.length>=3&&toks.some(t=>t.startsWith(k))).length+(kw.includes(last)?2:0);if(score)cand.push({u,score,depth:pathTo(parent,id).length});}
 cand.sort((a,b)=>b.score-a.score||a.depth-b.depth);
 const picked=new Set((model.dynPicked??[]).map(d=>d.file));
 for(const {u} of cand.filter(c=>!picked.has(c.u.file)).slice(0,2)){const p=pathTo(parent,u.id),edge=p.at(-1);add('轉換','transform',{file:u.file,line:u.line,unit:u.id,via:p.map(s=>s.file?s.file+':'+s.line:null).filter(Boolean).slice(-6),status:edge?.inferred?'推論（'+edge.why+'）':'原碼已核對'},{why:edge?.why??null});}
 }
 for(const d of (model.dynPicked??[]).slice(0,2)){const u=[...g.files.get(d.file).units.values()].find(u=>/^(parse|main|run|convert|process)$/.test(u.name))??findUnit(g,d.file+'::<top>');
  add('轉換（動態載入的 '+path.posix.basename(d.file)+'）','transform',{file:u.file,line:u.line,unit:u.id,via:[d.from+':'+d.line],status:'推論（動態載入 '+d.prefix+'*，依問句挑 '+path.posix.basename(d.file,'.py')+'）'},{why:'動態載入（依問句推論）'});}
 const outs=[...pick('write-file'),...pick('stdout').filter(t=>!isHelpUnit(t.unit)&&!errCtx(t))];
 const outMain=outs.filter(t=>t.cap==='write-file'||/stdout\.write/.test(t.canon)&&!/self\.\w+\.write/.test(t.text)||(t.ctx??[]).some(c=>/事件 (data|done|end|finish)/.test(c))||t.canon==='global.print'&&/json|out|result|data/i.test(t.text));
 const near=t=>(t.file===entryFile?0:1)+(t.ctx?.some(c=>/^呼叫處/.test(c))?1:0);
 for(const t of (outMain.length?outMain:outs).sort((a,b)=>near(a)-near(b)).slice(0,3))add(t.cap==='write-file'?'輸出（寫檔）':'輸出（標準輸出）','output',t);
 for(const t of R.filter(t=>OTHER_PROGRAM.has(t.cap)).slice(0,4))add(t.ownCtx?.length?t.label+'（有條件）':t.label,'touch',t);
 const errs=R.filter(t=>(t.cap==='stderr'||t.cap==='exit')&&errCtx(t));
 for(const t of errs.slice(0,3))add(t.cap==='exit'?'錯誤（結束碼）':'錯誤（錯誤輸出）','error',t);
 model.stations=st;
 // Unknowns: dynamic calls, packages not followed, inferred hops, unresolved imports, parse gaps on the route.
 const outsideRepo=t=>{const pre=t.text.match(/（前綴 ([^）]+)）/)?.[1];return !!pre&&pre.split(' / ').every(p=>![...g.files.keys()].some(f=>f.startsWith(p.replace(/\.$/,'').split('.').join('/')+'/')));};
 for(const t of R.filter(t=>t.cap==='dynamic')){const d=(model.dynPicked??[]).filter(d=>d.from===t.file&&d.line===t.line);model.unknowns.push({kind:'dynamic',file:t.file,line:t.line,text:t.text+(d.length?'；依問句接到 '+d.map(x=>x.file).join('、')+'（推論），其他模組不在這條路':outsideRepo(t)?'；前綴對不到 repo 裡的資料夾，會載入 repo 以外的程式碼（例如使用者自己放的外掛），要確認那個路徑有沒有東西':'；讀碼看不出會載入或執行什麼，待試跑')+'。'});}
 const dc=R.filter(t=>t.cap==='dynamic-call');if(dc.length)model.unknowns.push({kind:'dynamic-call',file:dc[0].file,line:dc[0].line,text:dc.length+' 處用算出來的名稱呼叫（例：'+dc[0].text.replace(/^用算出來的名稱呼叫：/,'').slice(0,50)+'），讀碼看不出呼叫誰。',items:dc.map(t=>({file:t.file,line:t.line}))});
 const ext=externalCalls(g,parent);if(ext.length)model.unknowns.push({kind:'package',file:ext[0].file,line:ext[0].line,text:'沒追進 '+ext.length+' 個外部套件（'+ext.map(e=>e.name).join('、')+'）；它們會不會連網或寫檔，要看套件本身。',items:ext});
 const inferred=[...parent.entries()].filter(([,p])=>p.inferred);if(inferred.length)model.unknowns.push({kind:'inferred',text:'有 '+inferred.length+' 個函式是推論接上的（'+[...new Set(inferred.map(([,p])=>p.why))].join('、')+'）；例：'+inferred.slice(0,3).map(([id])=>id.split('::')[1]).join('、')+'。',items:inferred.map(([id,p])=>({unit:id,file:p.file,line:p.line,why:p.why}))});
 const unresolved=new Map();for(const id of parent.keys()){const f=g.files.get(id.split('::')[0]);if(!f)continue;for(const im of f.imports)if((im.unit===id||!im.unit&&id.endsWith('::<top>'))&&im.target?.type==='unresolved')unresolved.set(f.rel+':'+im.line,im.src);}
 for(const [at,src] of unresolved)model.unknowns.push({kind:'unresolved-import',file:at.split(':')[0],line:+at.split(':')[1],text:'載入 '+src+' 對不到 repo 裡的檔（可能要先建置）。'});
 for(const f of g.failed.filter(x=>!x.minified))model.unknowns.push({kind:'parse',file:f.file,text:'沒解析：'+f.error});
 model.conditional=R.filter(t=>t.ctx?.length&&!isHelpUnit(t.unit)&&['read-file','write-file','stdin',...OTHER_PROGRAM].includes(t.cap)).map(t=>({cap:t.cap,label:t.label,file:t.file,line:t.line,when:t.ctx}));
 model.answer=draftAnswer(model);return model;
}
function firstCodeLine(f){if(!f)return 1;const i=f.lines.findIndex(l=>l.trim()&&!/^\s*(#!|\/\/|\/\*|\*|['"]use strict)/.test(l));return i<0?1:i+1;}
const short=c=>String(c??'').replace(/^global\.|^node:|^py:/,'');
// The one-paragraph "怎麼接" answer, built only from stations, touches and trial facts.
export function draftAnswer(m){
 const e=m.entry,R=m.touches?.route??[],has=c=>R.some(t=>t.cap===c),parts={};
 if(!e)return {text:'還找不到入口；請用 --entry 指定。',parts};
 if(m.engine?.name!=='tree-sitter')return {text:'沒有語法解析，這次無法自動追路線。入口看起來是'+(e.kind==='bin'?'命令列 `'+e.name+'`（'+e.file+'）':'函式庫 `'+e.name+'`（'+e.file+'）')+'。請先在 skill 資料夾執行 `npm install --ignore-scripts`，或改用 preflight＋start 的讀碼流程；下面列的是文字比對看到的線索，沒分是不是這條路會走到。',parts:{caveats:[]},draft:true};
 parts.entry=e.kind==='bin'?'可以先接命令列入口 `'+e.name+' <檔案>`':'可以先接函式入口 `require(\''+e.name+'\')`'+(m.target?.names?.length?' 的 `'+m.target.names.join('`、`')+'`':'');
 if(e.kind!=='bin'&&!m.target&&(m.unknowns??[]).some(u=>u.kind==='target'))parts.entry+='（問句點名的函式找不到，以下以整個 API 為範圍，可用 --fn 指定）';
 const reads=R.filter(t=>t.cap==='read-file'&&!/exists|stat|access/.test(t.canon??''));
 parts.input=reads.length?'它讀你給的檔（'+[...new Set(reads.map(t=>short(t.canon)))].join('、')+'）'+(has('stdin')?'，沒給檔時改讀標準輸入':''):has('stdin')?'它從標準輸入讀資料':'輸入從參數傳入';
 const writes=R.filter(t=>t.cap==='write-file');
 parts.output=writes.length?'會寫檔（'+[...new Set(writes.map(t=>short(t.canon)))].join('、')+'），要給它專用資料夾':has('stdout')?'結果印到標準輸出，這條路不寫檔':'結果由回傳值交回';
 const other=[...new Set(R.filter(t=>OTHER_PROGRAM.has(t.cap)).map(t=>t.label))];
 const pend=(m.unknowns??[]).filter(u=>['dynamic','dynamic-call','package','unresolved-import'].includes(u.kind)).length;
 const narrow=(m.unknowns??[]).find(u=>u.kind==='narrow');
 const onlyIf=x=>(x.ownCtx??x.ctx??[]).some(c=>/^當 /.test(c)&&!/不成立/.test(c));
 const allCond=other.length&&R.filter(t=>OTHER_PROGRAM.has(t.cap)).every(onlyIf);
 const firstRisk=c=>{const ts=R.filter(x=>x.label===c),t=ts[0];if(!t)return c;const cond=allCond&&ts.every(onlyIf);return cond?c+'只在特定情況（'+ts.slice(0,2).map(x=>short(x.canon)+' '+x.file+':'+x.line+' 只在「'+x.ctx[0].replace(/^呼叫處 \S+ /,'').slice(0,40)+'」時').join('；')+'）':c+'（'+short(t.canon)+'，'+t.file+':'+t.line+'）';};
 parts.touches=allCond?other.map(firstRisk).join('、')+'；接之前確認你的用法不會觸發'+(pend?'（另有 '+pend+' 個未知待查）':''):other.length?'這條路會'+other.map(firstRisk).join('、')+'，接之前要先准':narrow?'從這個函式原碼追不到連網或跑其他程式，但'+narrow.text.split('，')[0]+'，要當成可能會':'這條路原碼沒看到連網、跑其他程式或開連線埠'+(pend?'（另有 '+pend+' 個未知待查）':'');
 const ext=(m.unknowns??[]).find(u=>u.kind==='dynamic'&&/repo 以外/.test(u.text));if(ext)parts.touches+='；另外 '+ext.file+':'+ext.line+' 會從 repo 以外的路徑載入程式碼（外掛），隔離環境要確認那裡是空的';
 const errs=R.filter(t=>(t.cap==='stderr'||t.cap==='exit')&&errCtx(t));
 const leak=R.filter(t=>t.cap==='stdout'&&errCtx(t));
 parts.error=errs.length?'出錯時'+(errs.some(t=>t.cap==='stderr')?'把錯誤印到錯誤輸出':'')+(errs.some(t=>t.cap==='exit')?(errs.some(t=>t.cap==='stderr')?'並':'')+'以非 0 結束':'')+(leak.length?'，但有錯誤訊息印到標準輸出（'+leak.slice(0,2).map(t=>t.file+':'+t.line).join('、')+'），別把標準輸出整段當 JSON':''):(e.kind==='bin'?'錯誤處理讀碼看不出來':'出錯時是拋例外還是回傳錯誤，讀碼沒確認')+'，待試跑';
 const t=m.trial,caveats=[];
 if(t?.ran){const good=t.cases.find(c=>c.id==='good'),bad=t.cases.find(c=>c.id==='bad'),miss=t.cases.find(c=>c.id==='missing'),again=t.cases.find(c=>c.id==='good-again');
  if(good?.json?.ok&&!writes.length)parts.output='結果是標準輸出的 JSON（試跑：'+good.json.shape+'），這條路不寫檔';
  if(good&&good.exit!==0)caveats.push('正常輸入卻回結束碼 '+good.exit+'，先看試跑紀錄');
  if(good?.changed.length)caveats.push('試跑時改了 '+good.changed.length+' 個檔（'+good.changed.slice(0,3).join('、')+'）');
  if(again&&again.sameStdout===false)caveats.push('同一份重跑輸出不同');
  if(bad){if(bad.exit!==0)caveats.push('格式錯時結束碼 '+bad.exit+(bad.stderr.trim()?'、錯誤在錯誤輸出':'')+(bad.stdout.trim()&&!bad.json.ok?'，但標準輸出已印出半截內容，要用結束碼判斷成功，不要只看輸出':''));
   else caveats.push('格式錯時仍回結束碼 0'+(bad.json.ok?'，並輸出 JSON（'+bad.json.shape+'）':'')+'，要自己檢查內容');}
  const empty=t.cases.find(c=>c.id==='empty');
  if(empty){if(empty.exit===0)caveats.push('空輸入時結束碼 0'+(empty.json.ok?'，輸出 '+empty.json.shape:empty.stdout.trim()?'，標準輸出有非 JSON 內容':'、沒有輸出')+'，空資料要自己判斷');else caveats.push('空輸入時結束碼 '+empty.exit+(empty.stderr.trim()?'、錯誤在錯誤輸出':''));}
  const deps=[...new Set(t.cases.map(c=>c.missingDep).filter(Boolean))];if(deps.length)caveats.push('試跑缺套件 '+deps.join('、')+'（沒裝，沒替你安裝），相關結果不算數');
  if(miss){if(miss.exit===0)caveats.push('檔案不存在時不報錯（結束碼 0）'+(miss.json.ok?'，輸出 '+miss.json.shape:miss.stdout.trim()?'，標準輸出混進提示文字':'')+'，呼叫前要先確認檔案存在');
   else if(miss.timedOut)caveats.push('檔案不存在時卡住（等標準輸入），呼叫時要關掉標準輸入或先確認檔案存在');
   else caveats.push('檔案不存在時結束碼 '+miss.exit);}
  if(t.viaStdin){const cmd='`'+t.run.replace(/\{input\}/,'<檔案>')+'`';parts.entry='可以先接命令列 '+cmd+(e.lang==='python'&&/-m\s/.test(t.run)&&!/^python -m/.test(e.name)?'（裝好後就是 `'+e.name+'`）':'');
   const reads2=R.filter(x=>x.cap==='read-file'&&!/exists|stat|access|listdir|scandir|walk|glob/.test(x.canon??''));parts.input='它從標準輸入讀資料'+(reads2.length?'（原碼另有 '+reads2.slice(0,2).map(x=>short(x.canon)+' '+x.file+':'+x.line).join('、')+' 會讀檔，這次用法沒給檔名）':'');}
  parts.verified='原碼 '+m.stations.length+' 站已核對，已在隔離副本（'+(t.network==='off'?'無網路':'網路未隔離')+'）用假檔試跑 '+t.cases.length+' 種情況確認。';}
 else parts.verified='原碼 '+(m.stations?.length??0)+' 站已核對，實際輸出格式待試跑確認。';
 if(m.dynPicked?.length)parts.input+='，再交給 '+m.dynPicked.slice(0,2).map(d=>d.file).join('、')+' 解析（原碼是動態載入，依問句挑的）';
 parts.caveats=caveats;
 const text=[parts.entry+'。'+parts.input+'；'+parts.output+'。',parts.touches+'。',caveats.length?caveats.join('；')+'。':parts.error+'。',parts.verified].join('');
 return {text,parts,draft:true};
}
// ---- isolated trial ----
const DEFAULT_CSV='name,age,city\nAmy,30,Taipei\nBob,25,"Kaohsiung, TW"\n';
const BAD_CSV='name,age\n"Amy,30\nBob,25,extra,,\n';
function copyRepo(root,dest){const skip=/(^|\/)(\.git|node_modules)$/;const walk=(s,d)=>{fs.mkdirSync(d,{recursive:true});for(const e of fs.readdirSync(s,{withFileTypes:true})){if(skip.test(e.name)||e.isSymbolicLink())continue;const a=path.join(s,e.name),b=path.join(d,e.name);if(e.isDirectory())walk(a,b);else if(e.isFile())fs.copyFileSync(a,b);}};walk(root,dest);}
function snapshot(dir){const m=new Map();const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==='node_modules')continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.isFile()){const st=fs.statSync(p);m.set(path.relative(dir,p),st.size+':'+st.mtimeMs);}}};walk(dir);return m;}
const diff=(a,b)=>[...b.keys()].filter(k=>a.get(k)!==b.get(k)).concat([...a.keys()].filter(k=>!b.has(k)).map(k=>k+'（被刪）'));
function jsonShape(s){try{const v=JSON.parse(s);return {ok:true,shape:Array.isArray(v)?'陣列 '+v.length+' 筆'+(v[0]&&typeof v[0]==='object'?'，欄位 '+Object.keys(v[0]).slice(0,6).join('/'):''):typeof v==='object'&&v?'物件，欄位 '+Object.keys(v).slice(0,6).join('/'):typeof v,sample:JSON.stringify(Array.isArray(v)?v.slice(0,2):v).slice(0,300)};}catch(e){return {ok:false,error:String(e.message).slice(0,120)};}}
export function runTrial(root,{run,input,badInput,timeoutMs=15000,question=''}={}){
 root=path.resolve(root);if(!run)throw Error('試跑要給 --run，例如 --run "node bin/cli.js {input}"');
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'tcl-trial-')),copy=path.join(base,'repo'),inDir=path.join(base,'inputs');copyRepo(root,copy);fs.mkdirSync(inDir);
 if(fs.existsSync(path.join(root,'node_modules')))fs.symlinkSync(path.join(root,'node_modules'),path.join(copy,'node_modules'),'dir');
 const csv=/csv/i.test(question)||/\.csv$/i.test(input??'');
 const good=path.join(inDir,'good'+(csv?'.csv':path.extname(input??'')||'.txt'));fs.writeFileSync(good,input?fs.readFileSync(input):csv?DEFAULT_CSV:'');
 const bad=path.join(inDir,'bad'+path.extname(good));fs.writeFileSync(bad,badInput?fs.readFileSync(badInput):csv?BAD_CSV:'\u0000\u0001not valid\n');
 const unshare=spawnSync('unshare',['-rn','true']).status===0;
 const argv=s=>s.match(/"[^"]*"|'[^']*'|\S+/g).map(x=>x.replace(/^["']|["']$/g,''));
 const env={PATH:process.env.PATH,HOME:base,TMPDIR:base,LANG:'C.UTF-8',NO_COLOR:'1'};
 // Python: import from the copy, never write .pyc into it, no user site-packages; deps are whatever the box already has (no install).
 const py=/(^|\/)python[\d.]*$|^uv$|^pipx$/.test(argv(run)[0]);
 if(py)Object.assign(env,{PYTHONPATH:[copy,fs.existsSync(path.join(copy,'src'))?path.join(copy,'src'):null].filter(Boolean).join(':'),PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',PYTHONIOENCODING:'utf-8'});
 // `< {input}` feeds the file on standard input instead of a path argument.
 const viaStdin=/<\s*\{input\}/.test(run);
 const cases=[],runOne=(id,label,file)=>{
  const before=snapshot(copy),cmd=viaStdin?argv(run.replace(/<\s*\{input\}/,'')):argv(run).map(x=>x.replace('{input}',file));
  const full=unshare?['unshare','-rn','--',...cmd]:cmd;
  const r=spawnSync(full[0],full.slice(1),{cwd:copy,env,encoding:'utf8',timeout:timeoutMs,input:viaStdin?fs.readFileSync(file):undefined,stdio:[viaStdin?'pipe':'ignore','pipe','pipe'],maxBuffer:4*1024*1024});
  const stdout=r.stdout??'',stderr=r.stderr??'';
  const dep=stderr.match(/(?:ModuleNotFoundError|ImportError): No module named '([\w.]+)'/)?.[1]??stderr.match(/Cannot find (?:module|package) '([^']+)'/)?.[1]??null;
  cases.push({id,label,command:(cmd.join(' ')+(viaStdin?' < '+file:'')).replaceAll(base,'<隔離>'),missingDep:dep,exit:r.status??(r.signal?'被中止 '+r.signal:'?'),timedOut:r.error?.code==='ETIMEDOUT',stdout:stdout.replaceAll(base,'<隔離>').slice(0,3000),stderr:stderr.replaceAll(base,'<隔離>').slice(0,1500),json:jsonShape(stdout),changed:diff(before,snapshot(copy)).slice(0,20)});};
 runOne('good','正常輸入',good);runOne('good-again','同一份重跑',good);runOne('bad','格式錯的輸入',bad);if(viaStdin){const empty=path.join(inDir,'empty'+path.extname(good));fs.writeFileSync(empty,'');runOne('empty','空輸入',empty);}else runOne('missing','檔案不存在',path.join(inDir,'no-such-file'+path.extname(good)));
 const a=cases.find(c=>c.id==='good'),b=cases.find(c=>c.id==='good-again');if(a&&b)b.sameStdout=a.stdout===b.stdout;
 const out={ran:true,viaStdin,python:py,network:unshare?'off':'guarded',isolation:unshare?'獨立網路命名空間（完全沒有網路），在 repo 副本裡跑':'沒有 unshare，網路沒隔離',run,inputs:{good:fs.readFileSync(good,'utf8').slice(0,400),bad:fs.readFileSync(bad,'utf8').slice(0,400)},cases,at:new Date().toISOString()};
 fs.rmSync(base,{recursive:true,force:true});return out;
}
// ---- short mode: "is feature X wired?" A → … → B, plus whether a test reaches B. ----
function unitsFor(g,spec){
 const [file,name]=spec.includes(':')&&!/^[A-Za-z]:[\\/]/.test(spec)?[spec.slice(0,spec.lastIndexOf(':')),spec.slice(spec.lastIndexOf(':')+1)]:g.files.has(spec)?[spec,null]:[null,spec];
 const out=[];for(const f of g.files.values()){if(file&&f.rel!==file)continue;for(const u of f.units.values()){if(name?u.name===name||u.name.endsWith('.'+name)||u.name.toLowerCase().includes(name.toLowerCase())&&name.length>3:true)out.push(u.id);}}
 return out;
}
export async function traceWired(root,{from,to,question='',ast=null}={}){
 root=path.resolve(root);ast=ast??await loadAst();
 const commit=git(root,['rev-parse','HEAD']),found=findEntries(root);
 const m={schema:'trace-usage-route-v1',kind:'wired',question:question||('「'+from+'」有沒有接到「'+to+'」？'),root,generatedAt:new Date().toISOString(),repo:{name:found.pkg?.name??path.basename(root),version:found.pkg?.version??null,commit,dirty:commit?!!git(root,['status','--porcelain','--untracked-files=no']):null},
  engine:ast.ok?{name:'tree-sitter',version:ast.version}:{name:'regex-fallback',reason:ast.reason},entry:{kind:'file',name:from,file:from.split(':')[0]},candidates:[],usage:[],stations:[],touches:{route:[],elsewhere:[]},unknowns:[],trial:null};
 if(!ast.ok){m.unknowns.push({kind:'no-ast',text:ast.reason});m.answer={text:'沒有語法解析，無法自動確認接線。',parts:{}};return m;}
 const g=buildGraph(ast,root);m.stats=stats(g);
 const starts=unitsFor(g,from),targets=new Set(unitsFor(g,to));
 if(!starts.length){m.unknowns.push({kind:'no-entry',text:'找不到起點 '+from});m.answer={text:'找不到起點「'+from+'」；請寫成 檔案:函式名。',parts:{}};return m;}
 // dynamic imports (import_module(f'pkg.parsers.{x}')) may be how A reaches B: let the target's module name pick the candidate.
 const hints=[...KEYWORDS(question),...[...targets].map(id=>path.posix.basename(id.split('::')[0]).replace(/\.\w+$/,''))];
 const named=reach(g,starts,{hints}),parent=[...targets].some(id=>named.has(id))?named:reach(g,starts,{hints:true});m.reachedUnits=parent.size;if(parent.dynPicked)m.dynPicked=parent.dynPicked;
 const hit=[...targets].filter(id=>parent.has(id)).sort((a,b)=>pathTo(parent,a).length-pathTo(parent,b).length)[0];
 const all=touches(g,parent);m.touches.route=all.filter(t=>t.reached);m.touches.elsewhere=[];
 const parts={};
 if(hit){const p=pathTo(parent,hit);
  m.stations=p.map((s,i)=>{const u=findUnit(g,s.unit);const at=i===0?{file:u.file,line:u.line}:{file:s.file,line:s.line};const c=codeAt(g,root,at.file,at.line);return {label:i===0?'起點 '+u.name:(s.why??'呼叫')+' → '+u.name,role:i===p.length-1?'output':'transform',...at,...c,unit:s.unit,ctx:[],via:[],status:s.inferred?'推論（執行環境自動呼叫）':'原碼已核對'};});
  const tu=findUnit(g,hit);if(m.stations.length>1){m.stations.at(-1).label=m.stations.at(-1).label.replace(/→ .*$/,'→ 終點 '+tu.name);}m.stations.push({label:'終點定義 '+tu.name,role:'output',file:tu.file,line:tu.line,...codeAt(g,root,tu.file,tu.line),unit:hit,ctx:[],via:[],status:'原碼已核對'});
  const inferred=p.some(s=>s.inferred);
  // Tests that reach the target: the line has a test; whether it ran is only known from a run record.
  const testRoots=[...g.files.values()].filter(f=>TEST_PATH.test(f.rel)).flatMap(f=>[...f.units.keys()]);
  const tp=testRoots.length?reach(g,testRoots):new Map();const covering=tp.has(hit)?pathTo(tp,hit)[0]?.unit.split('::')[0]:null;
  parts.wired=(inferred?'原碼接線完整（其中有推論的一站）':'原碼接線完整')+'：'+p.map(s=>findUnit(g,s.unit)?.name).join(' → ')+'（'+p.length+' 站）';
  parts.ran=covering?'有測試會走到這條線（'+covering+'）；這次沒有執行，要看測試紀錄才算「確實跑過」':'沒有測試走到這條線，也沒有實跑紀錄；只能說原碼接上了';
  m.answer={text:parts.wired+'。'+parts.ran+'。',parts:{...parts,verified:parts.ran,caveats:[]}};}
 else{const exists=[...targets].map(id=>findUnit(g,id)).filter(Boolean);
  parts.wired=exists.length?'原碼沒接上：「'+to+'」存在（'+exists.slice(0,3).map(u=>u.file+':'+u.line).join('、')+'），但從「'+from+'」走不到':'找不到「'+to+'」';
  m.unknowns.push({kind:'not-wired',text:parts.wired+'；可能是動態呼叫或框架自動接線，待試跑。'});
  m.answer={text:parts.wired+'。',parts:{...parts,caveats:[parts.wired]}};}
 return m;
}
// ---- preflight hook: AST capability findings, split by whether a real entry reaches them. ----
export async function astPreflight(root,{entry=null}={}){
 root=path.resolve(root);const ast=await loadAst();if(!ast.ok)return {engine:{name:'regex-fallback',reason:ast.reason},files:new Set(),findings:null,entries:null};
 const g=buildGraph(ast,root),found=findEntries(root);
 const chosen=entry?[chooseEntry(found,'',entry)].filter(Boolean):found.entries;
 const roots=[];for(const e of chosen){const f=g.files.get(e.file);if(!f)continue;if(e.kind==='bin'){roots.push(e.file+'::<top>');for(const u of [e.fn,e.fn?null:'<main>'])if(u&&f.units.has(e.file+'::'+u))roots.push(e.file+'::'+u);}else roots.push(...exportRoots(g,e.file));}
 // safety scan: anything a dynamic import prefix can load counts as reachable (inferred)
 const parent=roots.length?reach(g,roots,{hints:true}):null;
 const findings=touches(g,parent).filter(t=>['subprocess','network','listen','paid','real-account','mcp-tools'].includes(t.cap)).map(t=>({kind:t.cap,label:t.label,file:t.file,line:t.line,lineSha256:t.lineSha256,reached:parent?t.reached:null,ctx:t.ctx,canon:t.canon}));
 return {engine:{name:'tree-sitter',version:ast.version,files:g.files.size},files:new Set(g.files.keys()),findings,entries:chosen.map(e=>({kind:e.kind,name:e.name,file:e.file,found:g.files.has(e.file)}))};
}
