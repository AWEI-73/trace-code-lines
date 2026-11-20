// 1.38 usage-route: start from "how I want to use this repo", trace that one route station by station.
// 使用說明 → 入口 → 讀取輸入 → 轉換 → 輸出 (+ 錯誤). Only touches this route reaches count as 接入條件;
// the rest are listed as "repo 有、這條路沒走到". Read-only unless --trial (isolated copy, network off).
import {attachGuards} from './guards.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {uiTrialSentence} from './ui-trial.mjs';
import {toolTerms} from './target-has.mjs';
import {formatOf,fakeInput,MARKER} from './fake-inputs.mjs';
import {pyEntries} from './ast-python.mjs';
import {spawnSync} from 'node:child_process';
import {listFiles,ignoredBuild,pyRootsOf,loadAst,buildGraph,reach,touches,pathTo,findUnit,externalCalls,stats,exportRoots,CAP_LABEL,JS_FILE} from './ast-graph.mjs';
import {TEST_PATH,scanTarget} from './preflight.mjs';
const sha256=s=>crypto.createHash('sha256').update(s).digest('hex');
const readJson=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const git=(root,args)=>{const r=spawnSync('git',['--no-pager','-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}});return r.status===0?r.stdout.trim():null;};
const lineOf=(body,needle)=>{const i=body.indexOf(needle);return i<0?null:body.slice(0,i).split('\n').length;};
const BIG_REPO=+(process.env.TRACE_BIG_REPO??3000);
// big repos: files that are not the program itself (tests, stories, fixtures, examples, benchmarks) are not parsed
export const BIG_SKIP=/(^|\/)(tests?|__tests__|spec|__mocks__|fixtures?|__fixtures__|e2e|stories|\.storybook|examples?|benchmarks?|test-utils)(\/|$)|\.(test|spec|stories|bench)\.[cm]?[jt]sx?$/i;
// a workspace package plus the workspace packages it depends on (dependencies / peer / optional, not dev), by folder.
// With codeOnly, a dependency counts only when the program files (not tests / templates / assets) of a kept package import it.
function wsClosure(root,start,{codeOnly=false,files=null}={}){const byName=new Map();const dirs=subPackages(root);for(const d of dirs){const p=readJson(path.join(root,d,'package.json'));if(p?.name)byName.set(p.name,d);}
 const dropped=[];const imports=(d,name)=>{if(!codeOnly)return true;const esc=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),re=new RegExp('(?:from\\s*|require\\(\\s*|import\\(\\s*|import\\s+)[\'"`]'+esc+'(?:/[^\'"`]*)?[\'"`]');
  for(const f of files){if(!f.startsWith(d+'/')||BIG_SKIP.test(f.slice(d.length+1))||!JS_FILE.test(f))continue;let t;try{t=fs.readFileSync(path.join(root,f),'utf8');}catch{continue;}if(re.test(t))return true;}return false;};
 const seen=new Set([start]),q=[start];while(q.length){const d=q.shift(),p=readJson(path.join(root,d,'package.json'))??{};for(const n of Object.keys({...p.dependencies,...p.peerDependencies,...p.optionalDependencies})){const x=byName.get(n);if(x&&!seen.has(x)){if(imports(d,n)){seen.add(x);q.push(x);}else if(!dropped.includes(x))dropped.push(x);}}}
 return codeOnly?{keep:[...seen],dropped}:[...seen];}
const CMD_WORDS=[[/元件/,'component'],[/模板|範本|樣板/,'template'],[/查.{0,4}文件|參考文件/,'docs'],[/AGENTS\.md|CLAUDE\.md|初始化/,'init'],[/codemod|改原碼|升級/i,'upgrade'],[/主題/,'theme'],[/搜尋/,'search']];
const SCAFFOLD=/^(init|create|new|scaffold|generate|setup|bootstrap|upgrade|migrate|codemod|add)$/;
const OTHER_PROGRAM=new Set(['subprocess','network','listen','paid','real-account','worker','mcp-tools']);
// Entries a stranger would use: package.json bin / main / exports, plus README usage lines.
export function findEntries(root,{nested=false}={}){
 root=path.resolve(root);const pkgBody=fs.existsSync(path.join(root,'package.json'))?fs.readFileSync(path.join(root,'package.json'),'utf8'):'';const pkg=pkgBody?readJson(path.join(root,'package.json')):null;
 const out=[],norm=p=>path.posix.normalize(String(p).replace(/^\.\//,''));
 const bins=typeof pkg?.bin==='string'?{[pkg.name?.split('/').pop()??'cli']:pkg.bin}:pkg?.bin??{};
 for(const [name,file] of Object.entries(bins))out.push({kind:'bin',name,file:norm(file),declared:{file:'package.json',line:lineOf(pkgBody,JSON.stringify(file))??lineOf(pkgBody,'"bin"')}});
 // Library: every string target in exports['.'] (types skipped) + main/module; first one that exists in the repo wins.
 const targets=[],walk=(x,k='')=>{if(typeof x==='string'){if(!/\.d\.[cm]?ts$/.test(x)&&k!=='types')targets.push(x);}else if(Array.isArray(x))x.forEach(y=>walk(y,k));else if(x&&typeof x==='object')for(const [kk,v] of Object.entries(x))if(kk!=='types'&&!kk.startsWith('./')||kk==='.')walk(v,kk);};
 const exp=pkg?.exports;if(exp)walk(typeof exp==='object'&&!Array.isArray(exp)&&Object.keys(exp).some(k=>k.startsWith('.'))?exp['.']:exp);
 for(const x of [pkg?.main,pkg?.module])if(typeof x==='string')targets.push(x);targets.push('index.js','index.ts','src/index.ts');
 const ign=ignoredBuild(root);const exists=f=>{f=norm(f);if(fs.existsSync(path.join(root,f))&&fs.statSync(path.join(root,f)).isFile()&&!ign(f))return f;const ts=f.replace(/\.(m?js|cjs)$/,'.ts');if(ts!==f&&fs.existsSync(path.join(root,ts)))return ts;
  // built output not in the repo (lib/ dist/ build/): read the source it is built from
  const src=f.replace(/^(lib|dist|build)\//,'src/');if(src!==f)for(const c of [src,src.replace(/\.(m?js|cjs)$/,'.ts')])if(fs.existsSync(path.join(root,c)))return c;return null;};
 for(const e of out)if(e.kind==='bin'&&(!fs.existsSync(path.join(root,e.file))||ign(e.file))){const s=exists(e.file);if(s){e.builtFrom=e.file;e.file=s;}}
 const lib=targets.map(t=>[t,exists(t)]).find(([,f])=>f);
 const missing=[...new Set(targets.filter(t=>!exists(t)&&!/^(index\.(js|ts)|src\/index\.ts)$/.test(t)))];
 if(lib)out.push({kind:'library',name:pkg?.name??path.basename(root),file:lib[1],declared:{file:pkg?'package.json':'(預設)',line:pkg?lineOf(pkgBody,JSON.stringify(lib[0])):null},...(missing.length?{notBuilt:missing.slice(0,4)}:{})});
 // Python: console_scripts / [project.scripts] → module file; package/__main__.py → `python -m pkg`; package/__init__.py → import API.
 const pyMeta=pyProjectMeta(root);const pyFile=mod=>{for(const r of ['','src/'])for(const c of [r+mod.split('.').join('/')+'.py',r+mod.split('.').join('/')+'/__init__.py'])if(fs.existsSync(path.join(root,c)))return c;return null;};
 for(const e of pyEntries(root)){const file=pyFile(e.module);if(file)out.push({...e,file});}
 for(const r of ['','src/'])for(const d of (()=>{try{return fs.readdirSync(path.join(root,r||'.'),{withFileTypes:true}).filter(x=>x.isDirectory()&&/^[A-Za-z_]\w*$/.test(x.name)&&!/^(tests?|docs?|examples?|scripts?|build|dist)$/.test(x.name)).map(x=>x.name);}catch{return [];}})()){
  if(fs.existsSync(path.join(root,r,d,'__main__.py')))out.push({kind:'bin',name:'python -m '+d,module:d,lang:'python',file:r+d+'/__main__.py',declared:{file:r+d+'/__main__.py',line:1}});
  if(!lib&&fs.existsSync(path.join(root,r,d,'__init__.py'))&&(pyMeta.name?.replace(/-/g,'_')===d||out.some(e=>e.module?.split('.')[0]===d)))out.push({kind:'library',name:d,lang:'python',file:r+d+'/__init__.py',declared:{file:r+d+'/__init__.py',line:1}});}
 // Monorepo / workspaces: entries of packages/*, apps/* … (each with its own package.json or pyproject), files prefixed
 const subUsage=[];
 if(!nested&&(!out.length||pkg?.workspaces||['pnpm-workspace.yaml','lerna.json','nx.json','turbo.json'].some(f=>fs.existsSync(path.join(root,f)))||/\[tool\.uv\.workspace\]/.test((()=>{try{return fs.readFileSync(path.join(root,'pyproject.toml'),'utf8');}catch{return '';}})()))){
  for(const sub of subPackages(root)){const s=findEntries(path.join(root,sub),{nested:true});const pre=f=>f&&!/^\(/.test(f)?sub+'/'+f:f;
   for(const e of s.entries)out.push({...e,file:pre(e.file),...(e.builtFrom?{builtFrom:pre(e.builtFrom)}:{}),declared:{...e.declared,file:pre(e.declared?.file)},pkg:sub,pkgName:s.pkg?.name??path.basename(sub),...(s.pkg?.version?{version:s.pkg.version}:{})});
   subUsage.push(...s.usage.map(u=>({...u,file:pre(u.file)})));}}
 const readme=['README.md','readme.md','Readme.md','README.rst','README'].find(f=>fs.existsSync(path.join(root,f)));
 const usage=[...subUsage];
 if(readme){const lines=fs.readFileSync(path.join(root,readme),'utf8').split(/\r?\n/);let fence=false;
  lines.forEach((l,i)=>{if(/^\s*```/.test(l)){fence=!fence;return;}if(!fence)return;
   for(const e of out){const n=e.kind==='bin'||e.lang==='python'?e.name:pkg?.name;if(!n)continue;const esc=n.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&');
    const pn=e.kind==='bin'&&(e.pkgName??pkg?.name)?(e.pkgName??pkg?.name).replace(/[.*+?^${}()|[\]\\/]/g,'\\$&'):null;
    const re=e.kind==='bin'?new RegExp('(^|[\\s$|>])'+esc+'(\\s|$)'+(pn?'|(^|[\\s$|>])(npx|bunx|pnpx|pnpm\\s+dlx|yarn\\s+dlx|npm\\s+exec)\\s+(-y\\s+|--yes\\s+)?'+pn+'(@\\S+)?(\\s|$)':'')):e.lang==='python'?new RegExp('^(>>>\\s*)?(import\\s+'+esc+'\\b|from\\s+'+esc+'(\\.|\\s))'):new RegExp('(require\\(|from\\s+)[\'"]'+esc+'[\'"]');
    if(re.test(l)&&!/^\s*(-\s+)?[\w.-]+:\s/.test(l)&&!/npm\s+(i|install)|yarn\s+add|pnpm\s+add/.test(l)&&!/^\s*(\$\s*)?(cd|pip3?|pipx|uv|git|brew|conda|docker|apt(-get)?|sudo|python3? -m pip)\s/.test(l))usage.push({entry:e.kind+':'+e.name,file:readme,line:i+1,text:l.trim().slice(0,120)});}});}
 // docs/: `$ name …` lines in .md / .rst (sqlite-utils keeps its CLI examples there, not in the README)
 const docs=[];const walkD=(d,rel,depth)=>{let es;try{es=fs.readdirSync(d,{withFileTypes:true});}catch{return;}for(const x of es){if(docs.length>40)return;const r=rel+'/'+x.name;if(x.isDirectory()&&depth<2&&!/^[._]/.test(x.name))walkD(path.join(d,x.name),r,depth+1);else if(/\.(md|rst|txt)$/.test(x.name))docs.push(r.slice(1));}};walkD(path.join(root,'docs'),'/docs',0);
 for(const f of docs){let lines;try{lines=fs.readFileSync(path.join(root,f),'utf8').split(/\r?\n/);}catch{continue;}
  lines.forEach((l,i)=>{for(const e of out.filter(e=>e.kind==='bin')){const esc=e.name.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&');if(!/changelog|history|release/i.test(f)&&!/\\$/.test(l)&&new RegExp('^(\\s*\\$\\s+|\\s{2,}|>\\s*)(?:[^|]+\\|\\s*)?'+esc+'(\\s|$)').test(l)&&usage.filter(u=>u.file===f).length<80)usage.push({entry:'bin:'+e.name,file:f,line:i+1,text:l.trim().slice(0,120)});}});}
 return {pkg:pkg?{name:pkg.name,version:pkg.version}:pyMeta.name?pyMeta:null,entries:out,usage};
}
// Every package name this repo publishes (root + workspace packages, private ones skipped), for "the target already uses it".
export function packageNames(root){root=path.resolve(root);const out=new Set();for(const d of ['',...subPackages(root)]){const p=readJson(path.join(root,d,'package.json'));if(p?.name&&!p.private)out.add(p.name);}
 const py=pyProjectMeta(root);if(py.name)out.add(py.name);return [...out].slice(0,60);}
// Folders (depth ≤ 3) that are their own package; tests, examples, docs, vendored and installed code skipped.
const SUB_SKIP=/^(node_modules|\.git|\.venv|venv|\.tox|__pycache__|site-packages|vendor|third_party|dist|build|coverage|tests?|__tests__|e2e|examples?|samples?|docs?|fixtures|benchmarks?|\..*)$/;
export function subPackages(root){const out=[];const walk=(d,rel,depth)=>{if(out.length>=40)return;let es;try{es=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
  for(const x of es){if(!x.isDirectory()||SUB_SKIP.test(x.name))continue;const r=rel?rel+'/'+x.name:x.name,p=path.join(d,x.name);
   if(['package.json','pyproject.toml','setup.py'].some(f=>fs.existsSync(path.join(p,f))))out.push(r);else if(depth<3)walk(p,r,depth+1);}};
 walk(root,'',1);return out.sort();}
function pyProjectMeta(root){const r=f=>{try{return fs.readFileSync(path.join(root,f),'utf8');}catch{return '';}};const t=r('pyproject.toml')+'\n'+r('setup.cfg')+'\n'+r('setup.py');
 const name=t.match(/^\s*name\s*=\s*['"]([\w.-]+)['"]/m)?.[1]??null,version=t.match(/^\s*version\s*=\s*['"]([\w.+-]+)['"]/m)?.[1]??null;return {name,version};
}
// Which entry fits the one-sentence usage. Hint wins: bin:<name>, library, or a file path.
export function chooseEntry(found,question='',hint=null){
 const {entries}=found;
 if(hint){if(/^bin(:|$)/.test(hint)){const n=hint.split(':')[1];return entries.find(e=>e.kind==='bin'&&(!n||e.name===n))??null;}
  if(/^(lib|library|main|api)$/.test(hint))return entries.find(e=>e.kind==='library')??null;
  {const same=entries.find(e=>e.file===path.posix.normalize(hint));if(same)return same;}
  return {kind:/(^|\/)(bin|cli)\//.test(hint)?'bin':'file',name:path.posix.basename(hint),file:path.posix.normalize(hint),declared:{file:'(指定)',line:null}};}
 return rankEntries(found,question)[0]?.e??null;
}
// Score every entry against the sentence: its own name in the question, main package vs plugins/samples,
// how often the README/docs show it, and whether the sentence asks for a CLI or a function.
export function rankEntries(found,question='',root=null){
 const {entries,usage=[]}=found,q=question.toLowerCase(),words=new Set(q.match(/[a-z][\w-]*/g)??[]);
 const wantsApi=/函式|API|api|require|import|程式庫|library|模組|呼叫它的函式/.test(question);
 const wantsCli=/命令列|指令|CLI|cli|終端|command|檔案|一份|這份檔|stdout|標準輸出|步驟/.test(question);
 const names=entries.map(e=>e.name.toLowerCase());
 return entries.map((e,i)=>{const why=[];let s=0;const n=e.name.toLowerCase().replace(/^python -m /,''),parts=n.split(/[^a-z0-9]+/).filter(Boolean);
  const extra=parts.filter(p=>!names.every(m=>m.includes(p)));// words that tell this entry apart (mcp, ocr …)
  if(extra.length&&extra.every(p=>words.has(p)||q.includes(p))){s+=6;why.push('問句提到 '+extra.join('、'));}else if(extra.length&&!extra.some(p=>q.includes(p))&&entries.some(o=>o!==e&&o.kind===e.kind&&n.includes(o.name.toLowerCase()))){s-=3;why.push('問句沒提到 '+extra.join('、'));}
  if(/sample|example|demo|test|fixture|benchmark/.test((e.pkg??'')+' '+n)){s-=5;why.push('範例或外掛樣板');}
  const u=usage.filter(x=>x.entry===e.kind+':'+e.name).length;if(u){s+=Math.min(u,5);why.push('文件用法 '+u+' 行');}
  if(e.kind==='bin'&&wantsCli&&!wantsApi||e.kind==='library'&&wantsApi&&!wantsCli){s+=3;why.push(e.kind==='bin'?'問句像命令列用法':'問句要函式');}
  if(e.kind==='bin'&&!wantsApi)s+=1;
  if(e.pkg&&e.pkg.split('/').length>2)s-=1;
  return {e,score:s-i*0.01,why};}).sort((a,b)=>b.score-a.score);
}
const KEYWORDS=q=>{const k=new Set(['convert','transform','parse','process','render','compile','format','handle']);for(const w of (q.toLowerCase().match(/[a-z]{3,}/g)??[]))k.add(w);
 if(/轉/.test(q))k.add('convert').add('transform');if(/解析|讀/.test(q))k.add('parse');if(/匯出|輸出/.test(q))k.add('export');
 // common option words said in Chinese (so `--reindent --keywords upper` is not scored as unrelated flags); not output/in-place words: those flags take a path or overwrite
 for(const [re,ws] of [[/縮排/,['indent','reindent']],[/大寫/,['upper']],[/小寫/,['lower']],[/關鍵字/,['keywords']]])if(re.test(q))ws.forEach(w=>k.add(w));return [...k];};
function codeAt(g,root,file,line){const f=g?.files.get(file);let l=f?.lines[line-1];if(l==null)try{l=fs.readFileSync(path.join(root,file),'utf8').split(/\r?\n/)[line-1];}catch{l='';}return {code:(l??'').trim().slice(0,140),lineSha256:sha256(l??'')};}
const isHelpUnit=u=>/help|usage|version/i.test(u??'');
const errCtx=t=>(t.ctx??[]).some(c=>/事件 error|catch|出錯/.test(c));
// Build the route. Returns the full model (no I/O besides reading the repo).
export async function traceRoute(root,{question='',entry:hint=null,fn=null,ast=null}={}){
 root=path.resolve(root);ast=ast??await loadAst();
 const found=findEntries(root),entry=chooseEntry(found,question,hint);
 const commit=git(root,['rev-parse','HEAD']),dirty=commit?!!git(root,['status','--porcelain','--untracked-files=no']):null;
 const model={schema:'trace-usage-route-v1',question,root,generatedAt:new Date().toISOString(),
  repo:{name:found.pkg?.name??entry?.pkgName??path.basename(root),version:found.pkg?.version??entry?.version??null,commit,dirty,...(entry?.pkg?{package:entry.pkg}:{})},
  entryRank:hint?null:rankEntries(found,question).slice(0,8).map(r=>({kind:r.e.kind,name:r.e.name,file:r.e.file,pkg:r.e.pkg??null,score:Math.round(r.score*10)/10,why:r.why})),
  engine:ast.ok?{name:'tree-sitter',version:ast.version}:{name:'regex-fallback',reason:ast.reason},
  entry,candidates:found.entries,usage:found.usage,stations:[],touches:{route:[],elsewhere:[]},unknowns:[],trial:null,answer:null};
 if(model.entryRank?.length>1){const dup=n=>model.entryRank.filter(r=>r.name===n).length>1;model.choices=[{what:'入口',how:'問句字、文件用法、入口種類',ranked:model.entryRank.slice(0,4).map(r=>({name:(r.kind==='bin'?'命令列 ':'函式庫 ')+r.name+(dup(r.name)?'（'+(r.pkg||r.file)+'）':''),file:r.file,score:r.score,why:r.why??[],switch:'--entry '+(r.kind==='bin'&&!dup(r.name)?'bin:'+r.name:r.file)}))}];}
 if(!entry){model.unknowns.push({kind:'no-entry',text:'package.json 沒有 bin、main 或 exports，也沒有 index.js；請用 --entry 指定入口檔。'});model.answer=draftAnswer(model);return model;}
 if(!ast.ok){model.unknowns.push({kind:'no-ast',text:ast.reason});
  // Regex fallback: whole-repo hints, not split by route (says so in the report).
  try{model.touches.elsewhere=scanTarget(root).findings.filter(f=>f.line&&!f.test&&!f.typesOnly&&['subprocess','network','listen','paid','real-account'].includes(f.kind)).map(f=>({cap:f.kind,label:f.label,file:f.file,line:f.line,ctx:['文字比對，沒分這條路']}));}catch{}
  model.answer=draftAnswer(model);return model;}
 // Big monorepo: parse only the entry's package and the workspace packages it depends on (said in unknowns).
 let files=null;{const fl=listFiles(root);const code=fl.filter(f=>JS_FILE.test(f)).length;
  if(entry.pkg&&code>+(process.env.TRACE_BIG_REPO??BIG_REPO)){const {keep,dropped}=wsClosure(root,entry.pkg,{codeOnly:true,files:fl});const inPkg=f=>keep.some(d=>f.startsWith(d+'/'));
   // only the program: tests, stories, fixtures, examples and bundled templates/assets are skipped (the entry file always stays)
   const skipped=fl.filter(f=>inPkg(f)&&JS_FILE.test(f)&&f!==entry.file&&BIG_SKIP.test(f.slice(keep.find(d=>f.startsWith(d+'/')).length+1)));const sk=new Set(skipped);
   files=fl.filter(f=>(!f.includes('/')||inPkg(f))&&!sk.has(f));
   model.parseScope={packages:keep,dropped,skipped:skipped.length,files:files.length,of:fl.length};
   model.unknowns.push({kind:'scope',text:'repo 很大（'+code+' 個程式檔），只解析入口所在的 '+entry.pkg+(keep.length>1?' 和它的程式真的有 import 的 workspace 套件（'+keep.filter(d=>d!==entry.pkg).slice(0,5).join('、')+(keep.length>6?' 等':'')+'）':'')+'，共 '+files.length+' 檔'+(dropped.length?'；'+dropped.slice(0,3).join('、')+' 雖列在依賴裡，但只有測試／範本／素材在用，沒解析':'')+(skipped.length?'；測試、範例、範本、素材等 '+skipped.length+' 個檔沒解析':'')+'。其他套件裡的東西這次沒看。'});}}
 const g=buildGraph(ast,root,{files});model.stats=stats(g);model.toolTerms=toolTerms(g,question);
 const entryFile=g.files.has(entry.file)?entry.file:[...g.files.keys()].find(f=>f===entry.file.replace(/\.(m?js|cjs)$/,'.ts'))??null;
 if(!entryFile){model.unknowns.push({kind:'entry-missing',text:'入口檔 '+entry.file+' 不在 repo 裡（可能要先建置才會產生）；這條路無法追。'});model.answer=draftAnswer(model);return model;}
 // Library entry: every export is API surface, so all exported units are roots.
 let roots=entry.kind==='bin'?[entryFile+'::<top>']:exportRoots(g,entryFile);
 // Python console script `mod:func` runs func after import; `python -m pkg` / a script runs its __main__ block.
 if(entry.lang==='python'&&entry.kind==='bin'){if(entry.fn&&g.files.get(entryFile).units.has(entryFile+'::'+entry.fn))roots.push(entryFile+'::'+entry.fn);
  // `mod:main` where mod only does `from pkg.cli import main`: the function lives in the imported file
  else if(entry.fn){const im=g.files.get(entryFile).imports.find(i=>(i.member===entry.fn)&&i.target?.file);const tf=im?.target.file;if(tf&&g.files.get(tf)?.units.has(tf+'::'+entry.fn))roots.push(tf+'::'+entry.fn);}if(!entry.fn&&g.files.get(entryFile).units.has(entryFile+'::<main>'))roots.push(entryFile+'::<main>');}
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
 // Framework entries (click/typer/argparse commands, commander/yargs, Express/Flask routes): enter only the ones the sentence names.
 const fwAll=(g.framework??[]).filter(e=>!(e.kind==='group'||e.name==='(主指令)'||e.name==='(主程式)'));let fwSel='all';
 if(fwAll.length){const q=question.toLowerCase(),words=new Set(q.match(/[a-z][\w-]*/g)??[]),meth=(question.match(/\b(GET|POST|PUT|PATCH|DELETE)\b/)??[])[1];
  // a named command and a named route can both apply (`serve` that registers `GET /items`)
  const cmdHit=fwAll.filter(e=>e.kind==='command'&&words.has(e.name.toLowerCase()));
  let routeHit=fwAll.filter(e=>e.kind==='route'&&e.path.length>1&&q.includes(e.path.toLowerCase()));
  if(routeHit.length&&meth)routeHit=routeHit.filter(e=>e.method.split('|').includes(meth)||e.method==='ALL');
  if(!routeHit.length&&meth)routeHit=fwAll.filter(e=>e.kind==='route'&&(e.method.split('|').includes(meth)||e.method==='ALL'));
  // several routes match: keep the most relevant one, the rest are 其他候選
  let fwOthers=[];
  if(routeHit.length>1){const toks=new Set((question.toLowerCase().match(/[a-z][a-z0-9_]*/g)??[]).filter(w=>!['get','post','put','patch','delete','json','http','https'].includes(w)));
   const docs=found.usage.map(u=>u.text).join('\n');let testText='';try{testText=listTestText(root);}catch{}
   const sc=e=>{let s=0;const why=[];const segs=e.path.toLowerCase().split('/').filter(Boolean);
    const hitT=segs.filter(x=>!/^[:*{(]/.test(x)&&[...toks].some(w=>x===w||x.replace(/[^a-z0-9]/g,'')===w));if(hitT.length){s+=4*hitT.length;why.push('問句提到 '+hitT.join('、'));}
    const lit=segs.filter(x=>!/^[:*{(]/.test(x));if(!lit.length&&segs.length){s-=1;why.push('全是參數');}
    if(/^\/__/.test(e.path)){s-=3;why.push('內部路由');}
    if(e.path.length>1&&docs.includes(e.path)){s+=2;why.push('文件提到');}
    if(e.path.length>1&&testText.includes(e.path)){s+=1;why.push('測試有打');}
    s-=segs.filter(x=>/^[:*{(]/.test(x)).length*0.5;return {e,s,why};};
   const r=routeHit.map(sc).sort((a,b)=>b.s-a.s);routeHit=[r[0].e];fwOthers=r.slice(1).map(x=>({name:x.e.name,file:x.e.file,line:x.e.line,score:x.s,why:x.why}));routeHit.why=r[0].why;model.choices=[...(model.choices??[]),{what:'路由',how:'問句、文件、測試',ranked:r.slice(0,4).map(x=>({name:x.e.name,file:x.e.file,line:x.e.line,score:x.s,why:x.why}))}];}
  let hit=[...cmdHit,...routeHit];
  // not named: the command the documented usage lines for these words use most (csv → `insert … --csv`)
  let how='依問句';
  if(!hit.length){const VERB=[[/寫進|存進|匯入|插入|寫入|塞進|載入/,['insert','import','load','add','upsert']],[/查詢|搜尋/,['query','search','select','find']],[/刪/,['delete','remove','drop','rm']],[/列出/,['list','ls']],[/匯出|輸出成/,['export','dump']]];
   const vc=[];for(const [re,ws] of VERB)if(re.test(question))ws.forEach((w,i)=>{const e=fwAll.find(e=>e.kind==='command'&&e.name===w);if(e&&!vc.some(x=>x.e===e))vc.push({e,s:ws.length-i,why:['問句的動作對到 '+w+'（同義字第 '+(i+1)+' 順位）']});});
   if(vc.length){hit=[vc[0].e];how='依問句動詞推論（問句的動作對到 '+vc[0].e.name+'）';model.choices=[...(model.choices??[]),{what:'指令',how:'問句動詞',ranked:vc.slice(0,4).map(x=>({name:x.e.name,file:x.e.file,line:x.e.line,score:x.s,why:x.why}))}];}}
  if(!hit.length){const ks=KEYWORDS(question).filter(k=>!['convert','transform','parse','process','render','compile','format','handle','json'].includes(k)&&!entry.name.toLowerCase().includes(k));const cnt=new Map();
   for(const u of found.usage.filter(u=>ks.some(k=>u.text.toLowerCase().includes(k))))for(const e of fwAll.filter(e=>e.kind==='command'))if(new RegExp('\\s'+e.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(\\s|$)').test(u.text))cnt.set(e,(cnt.get(e)??0)+1);
   const ranked=[...cnt].sort((a,b)=>b[1]-a[1]),best=ranked[0];if(best){hit=[best[0]];how='依文件用法推論（'+best[1]+' 行用法對到問句的字）';model.choices=[...(model.choices??[]),{what:'指令',how:'文件用法',ranked:ranked.slice(0,4).map(([e,n])=>({name:e.name,file:e.file,line:e.line,score:n,why:[n+' 行用法對到問句的字']}))}];}}
  if(hit.length){fwSel=new Set([...hit,...(hit.every(e=>e.kind==='command')?fwAll.filter(e=>e.kind==='route'):[]),...(g.framework??[]).filter(e=>!fwAll.includes(e))].map(e=>e.unit));model.framework={total:fwAll.length,picked:hit.map(e=>({kind:e.kind,framework:e.framework,name:e.name,file:e.file,line:e.line,unit:e.unit})),how,...(fwOthers.length?{others:fwOthers.slice(0,12),pickedWhy:routeHit.why}:{})};if(how!=='依問句')model.unknowns.push({kind:'framework',text:'問句沒點名指令，'+how+'挑了 '+hit.map(e=>e.name).join('、')+'（共 '+fwAll.length+' 個指令）；不對就在問句寫指令名。'});}
  else{model.framework={total:fwAll.length,picked:[],how:'全部'};if(fwAll.length>1)model.unknowns.push({kind:'framework',text:'repo 用 '+[...new Set(fwAll.map(e=>e.framework))].join('、')+' 註冊了 '+fwAll.length+' 個'+(fwAll.some(e=>e.kind==='route')?'路由／':'')+'指令（例：'+fwAll.slice(0,4).map(e=>e.name).join('、')+'），問句沒點名，這次全部算進路線，範圍會偏大；在問句寫指令名或路徑即可縮小。'});}}
 const parent=reach(g,roots,{classes:model.apiClasses??null,hints:KEYWORDS(question),framework:fwSel});if(parent.dynPicked)model.dynPicked=parent.dynPicked;if(parent.methodPicked){model.methodPicked=parent.methodPicked;for(const p of parent.methodPicked)model.unknowns.push({kind:'inferred',text:'有 '+p.total+' 個類別都有 '+p.method+'()，依問句只接 '+p.picked.join('、')+'（推論）；其他格式的處理不算這條路。'});}model.reachedUnits=parent.size;delete model.apiClasses;
 model.capabilities=whereIs(g,parent,model.toolTerms??[]);
 const all=touches(g,parent).filter(t=>!(t.file===entryFile&&t.cap==='dynamic'&&false));
 const test=t=>TEST_PATH.test(t.file);
 // A touch with no condition of its own may still sit in a function only called under a condition (if magic: run()).
 const callerCtx=t=>{if(t.ctx?.length)return [];const p=pathTo(parent,t.unit);for(const s of p.slice(-3).reverse())if(s.ctx?.length)return ['呼叫處 '+s.file+':'+s.line+' '+s.ctx[0]];return [];};
 model.touches.route=all.filter(t=>t.reached).map(t=>{const cc=callerCtx(t);return {...t,ownCtx:t.ctx??[],ctx:[...(t.ctx??[]),...cc],via:pathTo(parent,t.unit).map(s=>s.file?s.file+':'+s.line:null).filter(Boolean).slice(-6)};});
 try{attachGuards(root,model.touches.route);}catch(e){model.unknowns.push({kind:'guard',text:'寫檔條件分析失敗：'+String(e.message).slice(0,80)});}
 model.touches.elsewhere=all.filter(t=>!t.reached&&!test(t));
 const st=[],add=(label,role,x,extra={})=>{if(!x)return;const c=codeAt(g,root,x.file,x.line);st.push({label,role,file:x.file,line:x.line,...c,unit:x.unit??null,ctx:x.ctx??[],via:x.via??[],status:x.status??'原碼已核對',...(x.guard?{guard:x.guard}:{}),...(x.blind?{blind:x.blind}:{}),...extra});};
 const kw0=KEYWORDS(question).filter(k=>!['convert','transform','parse','process','render','compile','format','handle'].includes(k)),mine=found.usage.filter(u=>u.entry===entry.kind+':'+entry.name);
 const u0=mine.find(u=>kw0.some(k=>u.text.toLowerCase().includes(k))&&(!model.framework?.picked?.[0]||u.text.includes(' '+model.framework.picked[0].name)))??mine.find(u=>kw0.some(k=>u.text.toLowerCase().includes(k)))??mine.find(u=>/\bFILE\b|<\s*\S|\bcat\b/.test(u.text))??mine[0]??(entry.kind==='bin'?null:found.usage[0]);
 if(u0)add('使用說明','usage',{...u0,status:'文件'});
 if(entry.declared?.line)add(entry.kind==='bin'?'命令列入口（宣告）':'函式入口（宣告）','entry-decl',{file:entry.declared.file,line:entry.declared.line});
 add(entry.kind==='bin'?'命令列入口':'函式入口','entry',{file:entryFile,line:firstCodeLine(g.files.get(entryFile)),unit:entryFile+'::<top>'});
 for(const id of model.target?.units?.slice(0,2)??[]){const u=findUnit(g,id);add('呼叫的函式 '+u.name,'entry',{file:u.file,line:u.line,unit:id});}
 for(const e of model.framework?.picked?.slice(0,3)??[]){const u=findUnit(g,e.unit);add('框架入口（'+e.framework+(e.kind==='route'?' 路由 ':' 指令 ')+e.name+'）','entry',{file:e.file,line:e.line,unit:e.unit,status:model.framework.how==='依問句'?'原碼已核對':'推論（'+model.framework.how+'）'},{why:'框架註冊'});}
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
 for(const id of parent.keys()){const u=findUnit(g,id);if(!u||u.name==='<top>'||u.file===entryFile||path.posix.dirname(u.file)===path.posix.dirname(entryFile)&&entry.kind==='bin'&&/(^|\/)(bin|cli)$/.test(path.posix.dirname(entryFile))||TEST_PATH.test(u.file))continue;const toks=u.name.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),last=toks.at(-1),score=kw.filter(k=>toks.includes(k)||k.length>=3&&toks.some(t=>t.startsWith(k))).length+(kw.includes(last)?2:0);if(score)cand.push({u,score,depth:pathTo(parent,id).length});}
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
// Where the question's capability (pdf, pptx, export, codemod …) lives in this repo, and whether this route reaches it.
// Off-route ones name who loads them (a .tsx/.jsx loader means a browser UI button, not a CLI/function step).
export function whereIs(g,parent,terms){const out=[];const reached=new Set([...parent.keys()].map(id=>id.split('::')[0]));
 const importers=rel=>{const r=[];for(const f of g.files.values()){if(TEST_PATH.test(f.rel))continue;for(const im of f.imports)if(im.target?.file===rel){r.push({file:f.rel,line:im.line});break;}}return r;};
 for(const term of terms){const re=new RegExp('(^|[-_/.])'+term+'([-_/.]|s?\\.)','i');
  const mods=[...g.files.keys()].filter(f=>!TEST_PATH.test(f)&&!/\.d\.ts$/.test(f)&&re.test(f.split('/').pop())).sort((a,b)=>a.length-b.length).slice(0,3);
  for(const file of mods){const on=reached.has(file);let via=on?[]:importers(file),hop=via;
   // one more hop when the direct loader is a helper (lib/…): show what the person actually clicks or runs
   if(!on&&via.length&&!via.some(v=>/\.(tsx|jsx|vue|svelte)$/.test(v.file)))hop=via.flatMap(v=>importers(v.file)).slice(0,3);
   const all=[...via,...hop.filter(h=>!via.some(v=>v.file===h.file))].slice(0,4);
   out.push({term,file,onRoute:on,via:all,ui:all.some(v=>/\.(tsx|jsx|vue|svelte)$/.test(v.file)||/(^|\/)(app|ui|components|routes|pages|renderer)\//.test(v.file))});}}
 return out;}
function firstCodeLine(f){if(!f)return 1;let doc=null;// skips comments (# in Python too) and a module docstring
 const i=f.lines.findIndex(l=>{const t=l.trim();if(doc){if(t.includes(doc))doc=null;return false;}const q=t.match(/^[rRuU]?("""|''')/);if(q){if(!t.slice(q.index+q[0].length).includes(q[1]))doc=q[1];return false;}return t&&!/^\s*(#|\/\/|\/\*|\*|['"]use strict)/.test(l);});return i<0?1:i+1;}
const short=c=>String(c??'').replace(/^global\.|^node:|^py:|^pkg:/,'').replace(/^(local|file):[^:|]*(::|\|\.?)/,'');
// The one-paragraph "怎麼接" answer, built only from stations, touches and trial facts.
// what the extra trial runs with the output flags did (written file, original input changed or not)
function trigText(t){const cs=(t?.cases??[]).filter(c=>c.trigger);if(!cs.length)return '';
 return '；另外加旗標各跑一次：'+cs.map(c=>{const x=c.trigger;return '`'+x.flag+(x.value?' <新檔>':'')+'` '+(c.exit!==0?'結束碼 '+c.exit+(c.stderr?'（'+c.stderr.split('\n').filter(Boolean).pop().slice(0,60)+'）':''):(x.outWritten?'寫出新檔（'+x.outBytes+' 位元組）':'沒寫出新檔')+'，'+(x.inputChanged?'原檔被覆蓋了':'原檔沒變')+(c.changed.filter(f=>!/^<輸入資料夾>|out\./.test(f)).length?'，另外動到 '+c.changed.filter(f=>!/^<輸入資料夾>|out\./.test(f)).slice(0,2).join('、'):''));}).join('；');}
// flags that make a guarded write happen, for the trial (value flags get a new file path; at most three)
export function guardTriggers(m){const out=[];for(const t of m.touches?.route??[])if(t.cap==='write-file')for(const x of t.guard?.triggers??[])if(!out.some(o=>o.flag===x.flag))out.push({flag:x.flag,value:x.value,file:x.file,line:x.line});return out.slice(0,3);}
export function draftAnswer(m){
 const e=m.entry,R=m.touches?.route??[],has=c=>R.some(t=>t.cap===c),parts={};
 if(!e)return {text:'還找不到入口；請用 --entry 指定。',parts};
 if(m.engine?.name!=='tree-sitter')return {text:'沒有語法解析，這次無法自動追路線。入口看起來是'+(e.kind==='bin'?'命令列 `'+e.name+'`（'+e.file+'）':'函式庫 `'+e.name+'`（'+e.file+'）')+'。請先在 skill 資料夾執行 `npm install --ignore-scripts`，或改用 preflight＋start 的讀碼流程；下面列的是文字比對看到的線索，沒分是不是這條路會走到。',parts:{caveats:[]},draft:true};
 const cmd0=m.framework?.picked?.find(x=>x.kind==='command')?.name;
 parts.entry=e.kind==='bin'?'可以先接命令列入口 `'+e.name+(cmd0?' '+cmd0:'')+' <檔案>`'+(m.framework?.picked?.some(x=>x.kind==='route')?'，這條路走 '+m.framework.picked.filter(x=>x.kind==='route').slice(0,3).map(x=>'`'+x.name+'`').join('、')+' 路由':''):'可以先接函式入口 `require(\''+e.name+'\')`'+(m.target?.names?.length?' 的 `'+m.target.names.join('`、`')+'`':'');
 if(e.kind!=='bin'&&!m.target&&(m.unknowns??[]).some(u=>u.kind==='target'))parts.entry+='（問句點名的函式找不到，以下以整個 API 為範圍，可用 --fn 指定）';
 const reads=R.filter(t=>t.cap==='read-file'&&!/exists|stat|access/.test(t.canon??''));
 parts.input=reads.length?'它讀你給的檔（'+[...new Set(reads.map(t=>short(t.canon)))].join('、')+'）'+(has('stdin')?(()=>{const t=R.find(t=>t.cap==='stdin'),c=(t?.ownCtx??t?.ctx??[]).find(x=>/^當 /.test(x));return c?'，'+c.replace(/^當 /,'')+' 時改讀標準輸入（'+t.file+':'+t.line+'）':'，也會讀標準輸入（'+t.file+':'+t.line+'）';})():''):has('stdin')?'它從標準輸入讀資料':'輸入從參數傳入';
 const writes=R.filter(t=>t.cap==='write-file');
 // never say 「不寫檔」 when something on the route was not followed (external packages, dynamic calls) or a write sits behind a pattern we cannot read
 const unseen=(m.unknowns??[]).filter(u=>['dynamic','dynamic-call','package','unresolved-import'].includes(u.kind));const KIND={dynamic:'動態載入','dynamic-call':'動態呼叫',package:'外部套件','unresolved-import':'找不到的 import'};
 const noWrite=unseen.length?'沒看到寫檔，但有 '+unseen.length+' 處（'+[...new Set(unseen.map(u=>KIND[u.kind]))].join('、')+'）沒追進去，不保證':'這條路沒有寫檔的站';parts.noWrite=noWrite;
 const blindW=R.filter(t=>t.blind?.length);parts.blind=blindW.map(t=>t.file+':'+t.line+' '+t.blind[0]);
 const onlyIfW=x=>!!x.guard||(x.ownCtx??x.ctx??[]).some(c=>/^當 /.test(c)&&!/不成立/.test(c));
 const gWhy=t=>t.guard?t.guard.text+'（'+t.file+':'+t.line+'；條件 '+t.guard.lines.join('、')+' 行）':short(t.canon)+' '+t.file+':'+t.line+' 只在「'+(t.ownCtx??t.ctx)[0].slice(0,40)+'」時';
 parts.output=writes.length&&writes.every(onlyIfW)?'只在特定情況寫檔：'+[...new Set(writes.slice(0,2).map(gWhy))].join('；')+'；其餘'+(has('stdout')?'結果印到標準輸出':'結果由回傳值交回'):writes.length?'會寫檔（'+[...new Set(writes.map(t=>short(t.canon)))].join('、')+'），要給它專用資料夾':has('stdout')?'結果印到標準輸出；'+noWrite:'結果由回傳值交回；'+noWrite;
 const other=[...new Set(R.filter(t=>OTHER_PROGRAM.has(t.cap)).map(t=>t.label))];
 const pend=(m.unknowns??[]).filter(u=>['dynamic','dynamic-call','package','unresolved-import'].includes(u.kind)).length;
 const narrow=(m.unknowns??[]).find(u=>u.kind==='narrow');
 const onlyIf=x=>(x.ownCtx??x.ctx??[]).some(c=>/^當 /.test(c)&&!/不成立/.test(c));
 const allCond=other.length&&R.filter(t=>OTHER_PROGRAM.has(t.cap)).every(onlyIf);
 const firstRisk=c=>{const ts=R.filter(x=>x.label===c),t=ts[0];if(!t)return c;const cond=ts.every(onlyIf);return cond?c+'只在特定情況（'+ts.slice(0,2).map(x=>short(x.canon)+' '+x.file+':'+x.line+' 只在「'+x.ctx[0].replace(/^呼叫處 \S+ /,'').slice(0,40)+'」時').join('；')+'）':c+'（'+short(t.canon)+'，'+t.file+':'+t.line+'）';};
 parts.touches=allCond?other.map(firstRisk).join('、')+'；接之前確認你的用法不會觸發'+(pend?'（另有 '+pend+' 個未知待查）':''):other.length?'這條路會'+other.map(firstRisk).join('、')+'，接之前要先准':narrow?'從這個函式原碼追不到連網或跑其他程式，但'+narrow.text.split('，')[0]+'，要當成可能會':'這條路原碼沒看到連網、跑其他程式或開連線埠'+(pend?'（另有 '+pend+' 個未知待查）':'');
 // thin route (entry hands off to an outside package right away): the real reading/writing happens there
 const extU=(m.unknowns??[]).find(u=>u.kind==='package');if(extU&&m.stations.filter(x=>!['usage','entry'].includes(x.role)).length<2&&!other.length)parts.touches='這條路一進來就交給外部套件（'+(extU.text.match(/（([^）]+)）/)?.[1]??'')+'），原碼本身沒看到連網、跑其他程式或開連線埠；讀寫與連網實際要看那些套件，試跑才算數';
 const ext=(m.unknowns??[]).find(u=>u.kind==='dynamic'&&/repo 以外/.test(u.text));if(ext)parts.touches+='；另外 '+ext.file+':'+ext.line+' 會從 repo 以外的路徑載入程式碼（外掛），隔離環境要確認那裡是空的';
 const errs=R.filter(t=>(t.cap==='stderr'||t.cap==='exit')&&errCtx(t));
 const leak=R.filter(t=>t.cap==='stdout'&&errCtx(t));
 parts.error=errs.length?'出錯時'+(errs.some(t=>t.cap==='stderr')?'把錯誤印到錯誤輸出':'')+(errs.some(t=>t.cap==='exit')?(errs.some(t=>t.cap==='stderr')?'並':'')+'以非 0 結束':'')+(leak.length?'，但有錯誤訊息印到標準輸出（'+leak.slice(0,2).map(t=>t.file+':'+t.line).join('、')+'），別把標準輸出整段當 JSON':''):(e.kind==='bin'?'錯誤處理讀碼看不出來':'出錯時是拋例外還是回傳錯誤，讀碼沒確認')+'，待試跑';
 const t=m.trial,caveats=[],normal=[];
 // a formatter / pretty-printer does not validate: a malformed input formatted with exit 0 is expected, not a warning
 const formatter=/排版|格式化|美化|縮排|\b(format|formatter|prettier|prettify|beautif\w*|fmt|lint)\b/i.test(m.question??'')||/fmt|format|pretty|beautif/i.test(m.entry?.name??'');
 if(t?.ran&&t.project){const cs=t.cases;const nm=c=>'`'+(t.multi.find(x=>x.cmd===c.id)?.display??c.id)+'`';
  const own=c=>c.changed.filter(f=>!/^<家目錄或暫存>\//.test(f)),wf=c=>/--(apply|write)\b/.test(c.id),ro=cs.filter(c=>c.exit===0&&!own(c).length&&!wf(c)),wr=cs.filter(c=>own(c).length),idle=cs.filter(c=>c.exit===0&&!own(c).length&&wf(c));
  parts.entry='可以先接命令列，各指令分開接：'+cs.map(nm).join('、');parts.input='這些指令讀的是所在專案（package.json、原始碼），不吃另外的輸入檔';
  parts.output=(ro.length?'在假專案試跑，只讀不寫的：'+ro.map(nm).join('、'):'沒有一個指令是只讀的')+(wr.length?'；會寫檔的：'+wr.map(c=>nm(c)+'（'+own(c).slice(0,5).join('、')+(own(c).length>5?' 等 '+own(c).length+' 個':'')+'）').join('；'):'');
  for(const c of idle)caveats.push(nm(c)+' 是會改檔的寫法，這次沒改到任何檔（假專案沒有它要改的寫法），不代表它不會改原碼');
  for(const c of cs){if(c.timedOut)caveats.push(nm(c)+' 在沒網路時卡到逾時，代表它要連網');else if(c.exit!==0)caveats.push(nm(c)+' 回結束碼 '+c.exit+'（'+((c.stderr||c.stdout).replace(/\u001b\[[0-9;]*m/g,'').trim().split('\n').filter(l=>!/^astryx: answered|^\s*$/.test(l)).find(l=>/error|錯|not|cannot|fail|outside|no /i.test(l))?.slice(0,90)??'').trim()+'）');}
  const home=[...new Set(cs.flatMap(c=>c.changed.filter(f=>/^<家目錄或暫存>\//.test(f)).map(f=>f.split('/').slice(0,2).join('/'))))];if(home.length)caveats.push('專案以外還寫了 '+home.join('、')+'（家目錄或暫存資料夾）');
  parts.verified='已在隔離副本（無網路）的假專案（package.json＋src/App.tsx'+(Object.keys(t.peers??{}).length?'，連上 repo 裡的 '+Object.keys(t.peers).join('、'):'')+'）依序跑 '+cs.length+' 個指令確認。';}
 else if(t?.ran&&t.scaffold){const g0=t.cases.find(c=>c.id==='good'),again=t.cases.find(c=>c.id==='good-again'),off=t.cases.find(c=>c.id==='offline');
  const shown=(t.display??t.run).replace(/\{input\}/,'<檔案>');parts.entry='可以先接命令列 `'+shown+'`（建立專案的指令，不吃輸入檔）';parts.input='它不讀你的資料，把自帶的範本複製出去';
  const tops=c=>[...new Set(c.changed.map(f=>f.split('/').slice(0,2).join('/')))].slice(0,6).join('、');
  const okRun=[g0,off].find(c=>c&&c.exit===0);
  parts.output=okRun?'試跑在空資料夾寫了 '+okRun.changedCount+' 個檔（'+tops(okRun)+'）':'試跑寫了 '+(g0?.changedCount??0)+' 個檔（'+tops(g0)+'）';
  if(g0&&(g0.timedOut||g0.exit!==0))caveats.push('直接跑'+(g0.timedOut?'在沒網路時卡到逾時（最後一步：'+(g0.stdout.replace(/\u001b\[[0-9;]*m/g,'').trim().split('\n').pop()??'').replace(/^[│◇◆┌└\s]+/,'').slice(0,40)+'）':'回結束碼 '+g0.exit)+'，代表它要連網');
  if(off)caveats.push(off.exit===0?'加 '+off.label.replace(/^加 | 再跑$/g,'')+' 就不需要網路（'+off.ms+' ms 完成）':'加 '+off.label.replace(/^加 | 再跑$/g,'')+' 仍失敗（結束碼 '+off.exit+'）');
  if(again)caveats.push(again.exit===0?'同一資料夾再跑會照寫（改了 '+again.changedCount+' 個檔）':'同一資料夾再跑會拒絕（結束碼 '+again.exit+(/--force/.test(again.stdout+again.stderr)?'，要加 --force 才會覆蓋':'')+'）');
  if(g0?.changed.some(f=>/^<repo>/.test(f)))caveats.push('它也改了 repo 自己的檔');
  parts.verified='已在隔離副本（無網路）的空資料夾跑 '+t.cases.length+' 次確認寫了什麼。';}
 else if(t?.ran){const good=t.cases.find(c=>c.id==='good'),bad=t.cases.find(c=>c.id==='bad'),miss=t.cases.find(c=>c.id==='missing'),again=t.cases.find(c=>c.id==='good-again');
  if(good?.json?.ok&&!writes.length)parts.output='結果是標準輸出的 JSON（試跑：'+good.json.shape+'）；'+noWrite;
  else if(good?.marker&&!good.json?.ok&&good.exit===0)parts.output='結果印到標準輸出（試跑：假 '+(t.inputs?.format??'').toUpperCase()+' 裡的「'+t.inputs.marker+'」有出現在輸出）'+(good.changed.length?'':'，預設跑法沒寫任何檔')+(writes.length&&writes.every(onlyIfW)?'；'+[...new Set(writes.slice(0,2).map(gWhy))].join('；'):writes.length&&!good.changed.length?'；但原碼另有寫檔（'+writes[0].file+':'+writes[0].line+'），這次試跑沒走到，要查哪個參數會觸發':'');
  else if(good&&good.marker===false&&good.exit===0&&t.inputs?.marker)caveats.push('正常輸入結束碼 0，但輸出裡找不到假檔的內容（「'+t.inputs.marker+'」），要確認它真的有轉');
  const srv=good?.server;
  if(srv){const ok=srv.gets.filter(g=>g.status&&g.status<400),host=(srv.base??'').replace(/^https?:\/\//,'');
   parts.output=srv.listened?'試跑：服務只在本機 '+host+' 起來，GET '+ok.slice(0,4).map(g=>new URL(g.url).pathname+(g.shape?'（'+g.shape+'）':'')).join('、')+(ok.length?' 有回資料':'都沒回 2xx')+'；GET 前後'+(good.changed.length?'改了 '+good.changed.slice(0,3).join('、'):'檔案沒變'):'試跑時服務沒在 8 秒內開起連線埠'+(good.exit!=null?'（結束碼 '+good.exit+'）':'');}
  if(!srv)parts.output+=trigText(t);
  if(good&&good.exit!==0&&!(srv?.stoppedByProbe))caveats.push('正常輸入卻回結束碼 '+good.exit+'，先看試跑紀錄');
  const named=srv?[]:good?.changed.filter(f=>!/^</.test(f)&&(t.run??'').split(/\s+/).includes(f))??[];
  if(srv){}else if(good?.changed.length&&named.length===good.changed.length)parts.output='試跑只寫了指令裡指定的 '+named.join('、')+'，沒動其他檔'+(good.stdout.trim()?'；標準輸出另有內容':'');
  else if(good?.changed.length){const hm=good.changed.filter(f=>/^<家目錄或暫存>\//.test(f)),ot=good.changed.filter(f=>!/^<家目錄或暫存>\//.test(f));
   if(ot.length)caveats.push('試跑時改了 '+ot.length+' 個檔（'+ot.slice(0,3).join('、')+'）'+(named.length?'，其中 '+named.join('、')+' 是指令指定的':''));
   if(hm.length)caveats.push('試跑時在家目錄或暫存資料夾寫了 '+hm.length+' 個檔（'+hm.slice(0,2).map(f=>f.replace(/^<家目錄或暫存>\//,'~/')).join('、')+'），不是專案檔，但接進來時要給它可寫的家目錄或關掉這些快取');}
  if(good?.exit===0&&good.stderr.trim()&&!srv)caveats.push('正常時錯誤輸出也有字（'+good.stderr.replace(/\u001b\[[0-9;]*m/g,'').trim().split('\n').pop().slice(0,40)+'），不能用「錯誤輸出有字」判斷失敗，要看結束碼');
  if(again&&again.sameStdout===false&&!srv)caveats.push('同一份重跑輸出不同');
  if(bad){if(bad.exit!==0)caveats.push('格式錯時結束碼 '+bad.exit+(bad.stderr.trim()?'、錯誤在錯誤輸出':'')+(bad.stdout.trim()&&!bad.json.ok?'，但標準輸出已印出半截內容，要用結束碼判斷成功，不要只看輸出':''));
   else if(formatter&&!bad.json.ok)normal.push('格式錯的輸入也照樣排版、回結束碼 0（排版工具本來就不驗語法，正常；要擋壞檔得另外檢查）');
   else{const echo=(t.inputs?.bad??'').replace(/[·\s]+/g,' ').trim().slice(0,16);caveats.push('格式錯時仍回結束碼 0'+(bad.json.ok?'，並輸出 JSON（'+bad.json.shape+'）':echo.length>6&&bad.stdout.replace(/[\u0000-\u0008\s]+/g,' ').includes(echo.replace(/·/g,'').trim().slice(2,14))?'，還把壞檔的原始內容當成文字印出來（不會報錯）':'')+'，要自己檢查內容');}}
  const empty=t.cases.find(c=>c.id==='empty');
  if(empty){if(empty.exit===0)caveats.push('空輸入時結束碼 0'+(empty.json.ok?'，輸出 '+empty.json.shape:empty.stdout.trim()?'，標準輸出有非 JSON 內容':'、沒有輸出')+'，空資料要自己判斷');else caveats.push('空輸入時結束碼 '+empty.exit+(empty.stderr.trim()?'、錯誤在錯誤輸出':''));}
  const deps=[...new Set(t.cases.map(c=>c.missingDep).filter(Boolean))];if(deps.length)caveats.push('試跑缺套件 '+deps.join('、')+'（沒裝，沒替你安裝），相關結果不算數');
  if(miss&&miss.server?.stoppedByProbe)caveats.push('檔案不存在時不報錯'+(miss.changed.length?'，還自己建了 '+miss.changed.map(f=>f.replace(/^<輸入資料夾>\//,'')).join('、')+'（範例資料）':'')+'，照常開服務；呼叫前要先確認檔案存在');
  else if(miss){if(miss.exit===0)caveats.push('檔案不存在時不報錯（結束碼 0）'+(miss.json.ok?'，輸出 '+miss.json.shape:miss.stdout.trim()?'，標準輸出混進提示文字':'')+'，呼叫前要先確認檔案存在');
   else if(miss.timedOut)caveats.push('檔案不存在時卡住（等標準輸入），呼叫時要關掉標準輸入或先確認檔案存在');
   else caveats.push('檔案不存在時結束碼 '+miss.exit);}
  if(t.display||t.viaStdin)parts.entry='可以先接命令列 `'+(t.display??t.run).replace(/\{input\}/,'<檔案>')+'`'+(t.inferred?'（參數是推論的，見試跑）':'')+(!t.display&&e.lang==='python'&&/-m\s/.test(t.run)&&!/^python -m/.test(e.name)?'（裝好後就是 `'+e.name+'`）':'')+(m.framework?.picked?.some(x=>x.kind==='route')?'，這條路走 '+m.framework.picked.filter(x=>x.kind==='route').slice(0,3).map(x=>'`'+x.name+'`').join('、')+' 路由':'');
  if(t.viaStdin){
   const reads2=R.filter(x=>x.cap==='read-file'&&!/exists|stat|access|listdir|scandir|walk|glob/.test(x.canon??''));parts.input='它從標準輸入讀資料'+(reads2.length?'（原碼另有 '+reads2.slice(0,2).map(x=>short(x.canon)+' '+x.file+':'+x.line).join('、')+' 會讀檔，這次用法沒給檔名）':'');}
  parts.verified='原碼 '+m.stations.length+' 站已核對，已在隔離副本（'+(t.network==='off'?(t.server?'只有本機回環、連不到外面':'無網路'):'網路未隔離')+'）用假檔試跑 '+t.cases.length+' 種情況確認。';}
 else parts.verified='原碼 '+(m.stations?.length??0)+' 站已核對，實際輸出格式待試跑確認。';
 if(m.dynPicked?.length)parts.input+='，再交給 '+m.dynPicked.slice(0,2).map(d=>d.file).join('、')+' 解析（原碼是動態載入，依問句挑的）';
 if(parts.blind.length)caveats.push('這裡看不到，不保證：'+parts.blind.slice(0,2).join('；'));
 parts.caveats=caveats;parts.normal=normal;
 // the question asks about logging in to an AI agent (Claude / Codex …): say where the repo launches one, on this route or not
 if(/登入|login|claude|codex|gemini|模型|agent/i.test(m.question??'')){const ag=x=>x.filter(t=>t.agentCli);const onR=ag(R),els=ag(m.touches?.elsewhere??[]);
  parts.agent=onR.length?'這條路會啟動 '+[...new Set(onR.map(t=>t.agentCli))].join('、')+'（'+onR[0].file+':'+onR[0].line+'），要用你的登入與額度':els.length?'這條路不用登入 AI 代理；repo 另一處會啟動 '+[...new Set(els.map(t=>t.agentCli))].join('、')+'（'+els.slice(0,2).map(t=>t.file+':'+t.line).join('、')+'，不在這條路上），用到那部分才要你的登入':'沒看到它啟動 Claude、Codex 等 AI 代理 CLI';}
 // the question asks for something this route never reaches (export in a UI button, a codemod in another command …)
 const FMT=/^(pdf|pptx|ppt|docx|xlsx|html|csv|epub|png|svg|codemod|scaffold|template|theme)$/,caps=(m.capabilities??[]).filter(c=>FMT.test(c.term)||c.term==='export'&&!(m.capabilities??[]).some(x=>FMT.test(x.term)));
 const off=caps.filter(c=>!c.onRoute),on=new Set(caps.filter(c=>c.onRoute).map(c=>c.term));const offT=[...new Set(off.filter(c=>!on.has(c.term)).map(c=>c.term))];
 if(offT.length&&t?.project)parts.offRoute='原碼路線只追到入口與指令分派，'+offT.slice(0,3).map(x=>x.toUpperCase()).join('、')+' 的實作（'+off.filter(c=>offT.includes(c.term)).slice(0,2).map(c=>c.file).join('、')+'）由指令執行時載入，以上各指令的行為以試跑為準';
 else if(offT.length)parts.offRoute='問句要的 '+offT.slice(0,3).map(t=>t.toUpperCase()+' 在 '+off.filter(c=>c.term===t).slice(0,2).map(c=>c.file+(c.via.length?'（由 '+c.via.slice(0,2).map(v=>v.file+':'+v.line).join('、')+' 載入'+(c.ui?'，介面功能':'')+'）':'（沒找到誰載入）')).join('、')).join('；')+'，這條入口走不到，不能當成這個步驟的輸出';
 if(m.uiTrial){parts.uiTrial=uiTrialSentence(m.uiTrial);if(parts.offRoute&&m.uiTrial.results?.some(r=>r.ok))parts.offRoute=parts.offRoute.replace('，這條入口走不到，不能當成這個步驟的輸出','，命令列入口走不到');}
 const text=[parts.entry+'。'+parts.input+'；'+parts.output+'。',parts.touches+'。',caveats.length?caveats.join('；')+'。':parts.error+'。',normal.length?normal.join('；')+'。':'',parts.offRoute?parts.offRoute+'。':'',parts.uiTrial?parts.uiTrial+'。':'',parts.agent?parts.agent+'。':'',parts.verified].join('');
 return {text,parts,draft:true};
}
// ---- isolated trial ----
const DEFAULT_CSV='name,age,city\nAmy,30,Taipei\nBob,25,"Kaohsiung, TW"\n';
const DEFAULT_JSON='{"posts": [{"id": 1, "title": "hello"}, {"id": 2, "title": "world"}]}\n';
const BAD_CSV='name,age\n"Amy,30\nBob,25,extra,,\n';
export function copyRepo(root,dest){const skip=/(^|\/)(\.git|node_modules|\.venv|venv|__pycache__)$/;const walk=(s,d)=>{fs.mkdirSync(d,{recursive:true});for(const e of fs.readdirSync(s,{withFileTypes:true})){if(skip.test(e.name)||e.isSymbolicLink())continue;const a=path.join(s,e.name),b=path.join(d,e.name);if(e.isDirectory())walk(a,b);else if(e.isFile())fs.copyFileSync(a,b);}};walk(root,dest);}
export function snapshot(dir){const m=new Map();const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==='node_modules')continue;const p=path.join(d,e.name);if(e.isSymbolicLink()){let t='';try{t=fs.readlinkSync(p);}catch{}m.set(path.relative(dir,p)+' →link',t);}else if(e.isDirectory())walk(p);else if(e.isFile()){const st=fs.statSync(p);m.set(path.relative(dir,p),st.size+':'+st.mtimeMs);}}};walk(dir);return m;}
// HOME and TMPDIR of a trial point at its own folder: what lands there outside the repo copy, inputs and work folders
export function snapOther(base){const m=new Map();for(const e of fs.readdirSync(base,{withFileTypes:true})){if(/^(repo|inputs|work-.*)$/.test(e.name))continue;const p=path.join(base,e.name);if(e.isDirectory()){for(const [k,v] of snapshot(p))m.set(e.name+'/'+k,v);}else if(e.isFile())m.set(e.name,String(fs.statSync(p).size));}return m;}
// many files under one folder (a compile cache) → one line with a count
const squash=list=>{const by=new Map();for(const f of list){const k=f.split('/').slice(0,2).join('/');by.set(k,(by.get(k)??0)+1);}return [...by].map(([k,n])=>n>3?k+'/…（'+n+' 個檔）':null).filter(Boolean).concat(list.filter(f=>(by.get(f.split('/').slice(0,2).join('/'))??0)<=3));};
const diff=(a,b)=>[...b.keys()].filter(k=>a.get(k)!==b.get(k)).concat([...a.keys()].filter(k=>!b.has(k)).map(k=>k+'（被刪）'));
function jsonShape(s){try{const v=JSON.parse(s);return {ok:true,shape:Array.isArray(v)?'陣列 '+v.length+' 筆'+(v[0]&&typeof v[0]==='object'?'，欄位 '+Object.keys(v[0]).slice(0,6).join('/'):''):typeof v==='object'&&v?'物件，欄位 '+Object.keys(v).slice(0,6).join('/'):typeof v,sample:JSON.stringify(Array.isArray(v)?v.slice(0,2):v).slice(0,300)};}catch(e){return {ok:false,error:String(e.message).slice(0,120)};}}
// ---- trial arguments: README usage → --help in the isolated copy → the flag / subcommand the sentence names ----
const pyVenv=root=>['.venv','venv'].map(d=>path.join(root,d,'bin','python')).find(p=>fs.existsSync(p))??null;
const FILEISH=/^(<?\[?)(file|files|input|infile|source|src|path_to_file|csv|json|filename|csv[_-]?file|json[_-]?file|data|db\.json|path[_-]to[_-]file|.+\.(csv|json|tsv|txt|xml|yaml|yml|svg|md|pdf|docx?|pptx?|xlsx?|html?|epub|zip|png|jpe?g|sql|toml|ini|cfg|log|rst|css|scss|graphql|proto|mmd|dot|tex))(\]?>?)(\.\.\.)?$/i;
export function inferRun(root,m,{timeoutMs=8000}={}){
 root=path.resolve(root);const e=m.entry;if(e?.kind!=='bin')return null;
 const top=e.module?.split('.')[0],why=[];
 const base=e.lang==='python'?(e.name.startsWith('python -m ')?['python3','-m',e.module]:/\.__main__$/.test(e.module??'')?['python3','-m',e.module.replace(/\.__main__$/,'')]:fs.existsSync(path.join(root,top,'__main__.py'))?['python3','-m',top]:['python3','-c',`import sys; sys.argv[0]='${e.name}'; from ${e.module} import ${e.fn}; sys.exit(${e.fn}())`]):['node',e.builtFrom&&fs.existsSync(path.join(root,e.builtFrom))?e.builtFrom:e.file];
 const shown=e.lang==='python'?e.name:e.name;
 const kw=KEYWORDS(m.question??'').filter(k=>!['convert','transform','parse','process','render','compile','format','handle','json','give','file'].includes(k)||/csv|xml|yaml|tsv/.test(k));
 const cmd=m.framework?.picked?.find(x=>x.kind==='command')?.name??null;
 // 1. --help inside an isolated, network-less copy
 const iso=isoCopy(root),help=args=>{const r=execIso(iso,root,[...base,...args],{timeoutMs});return ((r.stdout??'')+'\n'+(r.stderr??'')).slice(0,20000);};
 let h='',sub='';try{h=help(['--help']);if(cmd)sub=help([cmd,'--help']);}finally{fs.rmSync(iso.base,{recursive:true,force:true});}
 const text=sub||h;
 // The sentence names several of the tool's own commands (元件→component, 模板→template, AGENTS.md→init …):
 // try each one in order inside one throw-away project, to see which files each command writes.
 const cmdList=[...((h.match(/\nCommands:\n([\s\S]*?)(\n\s*\n|$)/)?.[1]??'').matchAll(/^\s{2}([a-z][\w-]*)\b/gm))].map(x=>x[1]).filter(c=>c!=='help');
 const wantCmd=new Set();const q=(m.question??'').toLowerCase();
 for(const c of cmdList)if(new RegExp('(^|[^a-z])'+c+'([^a-z]|$)').test(q.replace(/[\w-]+\.(json|md|ya?ml|toml)\b/g,' ')))wantCmd.add(c);
 for(const [re,c] of CMD_WORDS)if(re.test(m.question??'')&&cmdList.includes(c))wantCmd.add(c);
 let multi=null;
 if(wantCmd.size>=2){const order=c=>/^(init|setup|create|new)$/.test(c)?0:/^(upgrade|codemod|migrate|swizzle|add|eject)$/.test(c)?2:1;
  const normU=u=>{const pn=(e.pkgName??m.repo?.name??'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return pn?{...u,text:u.text.replace(new RegExp('(^|[\\s$|>])(?:npx|bunx|pnpx|pnpm\\s+dlx|pnpm\\s+exec|yarn\\s+dlx|npm\\s+exec)\\s+(?:-y\\s+)?'+pn+'(?:@\\S+)?(?=\\s|$)'),'$1'+e.name)}:u;};let uses0=(m.usage??[]).map(normU);
  // each command's own --help "Examples:" lines count as usage too (upgrade --from 0.1.0 --apply)
  const i3=isoCopy(root);try{for(const c of wantCmd){const r=execIso(i3,root,[...base,c,'--help'],{timeoutMs});const ht=(r.stdout??'')+(r.stderr??'');const ex=ht.split(/\n/).slice(ht.split(/\n/).findIndex(l=>/^Examples?:/i.test(l))+1).filter(l=>/^\s+\S/.test(l)&&!/^\s*#/.test(l)).map(l=>l.trim());
    if(/^Examples?:/im.test(ht))for(const l of ex.slice(0,8))uses0.push(normU({file:c+' --help',line:0,text:l}));}}finally{fs.rmSync(i3.base,{recursive:true,force:true});}
  multi=[...wantCmd].sort((a,b)=>order(a)-order(b)).slice(0,5).map(c=>{const re=new RegExp('(^|\\s)'+e.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s+'+c+'(\\s|$)');
   const u=uses0.filter(u=>re.test(u.text)&&!/[<\[]/.test(u.text.split(re)[3]??'')).sort((a,b)=>{const ap=x=>/--(apply|write)\b/.test(x.text),fv=x=>(x.text.match(/--[\w-]+\s+[^-\s]\S*/g)??[]).length,fo=x=>/--force/.test(x.text);
    return fo(a)-fo(b)||(order(c)===2?(ap(b)-ap(a))||(fv(b)-fv(a)):ap(a)-ap(b))||a.text.length-b.text.length;})[0];
   const args=u?u.text.replace(/#.*$/,'').split(re).pop().trim().split(/\s+/).filter(Boolean):[];
   const w=u?(u.line?u.file+':'+u.line:u.file+' 的範例')+'：'+u.text.slice(0,80):'問句提到 '+c+'，文件沒有範例，只跑指令本身';
   // a writer example (--apply / --write): run it once without the flag (preview) and once with it, to see what it changes
   const wf=args.find(a=>/^--(apply|write)$/.test(a));if(wf)return [{cmd:c,args:[c,...args.filter(a=>a!==wf)],why:w+'（先不加 '+wf+' 預覽）'},{cmd:c+' '+wf,args:[c,...args],why:w}];
   return [{cmd:c,args:[c,...args],why:w}];}).flat();
  why.push('問句提到 '+multi.length+' 個指令（'+multi.map(x=>x.cmd).join('、')+'），依序在同一個假專案裡各跑一次，看每個寫了什麼');}
 // flags whose name is one of the sentence's words (--csv), exact first
 const flags=[...text.matchAll(/(?:^|[\s,])(--[a-z][\w-]*)/gim)].map(x=>x[1]);
 const flag=kw.map(k=>flags.find(f=>f==='--'+k)).find(Boolean)??null;
 // 2. README usage lines for this entry that mention the sentence's words
 const pn=(e.pkgName??m.repo?.name??'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),npx=pn?new RegExp('(^|[\\s$|>])(?:npx|bunx|pnpx|pnpm\\s+dlx|yarn\\s+dlx|npm\\s+exec)\\s+(?:-y\\s+|--yes\\s+)?'+pn+'(?:@\\S+)?(?=\\s|$)'):null;
 const esc=e.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),uses=(m.usage??[]).map(u=>npx?{...u,text:u.text.replace(npx,'$1'+e.name)}:u).filter(u=>new RegExp('(^|[\\s|$>])'+esc+'(\\s|$)').test(u.text));
 // rank: names the sentence's words, is a concrete example (not `[options] <file>`), matches the named command, gives a file when the sentence says 檔
 const nameToks=new Set(e.name.toLowerCase().split(/[^a-z0-9]+/));const kwU=kw.filter(k=>!nameToks.has(k)&&!e.name.toLowerCase().includes(k));
 const template=t=>/\[[\w -]+\]|<[\w -]+>/.test(t),score=u=>{const t=u.text.toLowerCase();const tk=u.text.replace(/^\$\s*/,'').split(/\s+/).slice(1);return -tk.filter(x=>/^--?[a-z]/i.test(x)&&!kwU.some(k=>x.toLowerCase().includes(k))).length*1.5+(tk.some(x=>FILEISH.test(x.replace(/^['"]|['"]$/g,''))||/<[\w -]*(file|path|input|source)[\w -]*>/i.test(u.text))?3:/[|<]/.test(u.text)?0:tk.every(x=>x.startsWith('-'))?-4:0)+kwU.filter(k=>t.includes(k)).length*3+(template(u.text)?0:2)+(cmd&&u.text.includes(' '+cmd)?4:cmd?-4:0)-(new RegExp('^\\s*(\\$\\s*)?([^|]*\\|\\s*)?'+esc+'(\\s|$)').test(u.text)?0:3)+(/檔/.test(m.question??'')&&!/\|/.test(u.text)?1:0)-(/https?:\/\//.test(u.text)?3:0)-((u.text.match(/'/g)??[]).length%2||(u.text.match(/"/g)??[]).length%2?6:0)-u.text.split(/\s+/).length/8;};
 // the same score, said in words (shown in 怎麼挑的)
 const useWhy=u=>{const t=u.text.toLowerCase(),tk=u.text.replace(/^\$\s*/,'').split(/\s+/).slice(1),w=[];const hit=kwU.filter(k=>t.includes(k));if(hit.length)w.push('有問句的字 '+hit.join('、'));
  if(tk.some(x=>FILEISH.test(x.replace(/^['"]|['"]$/g,'')))||/<[\w -]*(file|path|input|source)[\w -]*>/i.test(u.text))w.push('給了檔案');else if(tk.every(x=>x.startsWith('-')))w.push('只有旗標');
  if(cmd)w.push(u.text.includes(' '+cmd)?'是問句的 '+cmd+' 指令':'不是 '+cmd+' 指令');if(template(u.text))w.push('是範本寫法 <…>');
  const ex=tk.filter(x=>/^--?[a-z]/i.test(x)&&!kwU.some(k=>x.toLowerCase().includes(k)));if(ex.length)w.push('多了旗標 '+ex.slice(0,3).join(' '));if(/https?:\/\//.test(u.text))w.push('要網址');return w;};
 const useRank=[...uses].filter(u=>!/\\$/.test(u.text)&&(!cmd||u.text.includes(' '+cmd+' ')||u.text.endsWith(' '+cmd))).map(u=>({u,s:score(u)})).sort((a,b)=>b.s-a.s),pickUse=useRank[0]?.u??null;
 const useChoice=useRank.length?{what:'試跑用法',how:'README／文件用法行',ranked:useRank.filter((x,i)=>useRank.findIndex(y=>y.u.text===x.u.text)===i).slice(0,4).map(x=>({name:x.u.text.slice(0,90),file:x.u.file,line:x.u.line,score:Math.round(x.s*10)/10,why:useWhy(x.u)}))}:null;
 let args=[],stdin=false;
 if(pickUse){const line=pickUse.text.replace(/^\$\s*/,'');const line2=line.replace(/<[\w -]+>/g,'X');stdin=new RegExp('\\|\\s*'+esc+'\\b').test(line2)||new RegExp(esc+'\\b[^|>]*<\\s*\\S').test(line2);
  const after=(line.split(new RegExp('(?:^|\\s)'+esc+'(?=\\s|$)'))[1]??'').replace(/<([\w -]+)>/g,(x,y)=>'⟨'+y.trim().replace(/\s+/g,'_')+'⟩').replace(/\[[^\]]*\]/g,' ');const toks=after.split(/\s*[|>]\s*/)[0].replace(/<\s*\S+/,'').trim().split(/\s+/).filter(Boolean);
  let gave=false;args=toks.map(t=>{const ph=/^⟨.*⟩$/.test(t),n=t.replace(/[⟨⟩]/g,'');if(!gave&&!t.startsWith('-')&&(FILEISH.test(n)||ph&&/file|path|source|input/i.test(n))&&!stdin&&!(cmd&&t===cmd)){gave=true;return '{input}';}return ph?n.toLowerCase():t;});
  const scaffold=SCAFFOLD.test(args[0]??'')&&!/給它一份.*(檔|file)|這份檔/.test('');
  if(scaffold)why.push('「'+args[0]+'」是建立專案的指令，不吃輸入檔；在空資料夾跑，看它寫了什麼');
  // flags that keep a scaffolder off the network (skip install / git) — tried as a second run if the first one needs network
  var offline=null;if(scaffold){const i2=isoCopy(root);try{const r=execIso(i2,root,[...base,args[0],'--help'],{timeoutMs});const ht=(r.stdout??'')+(r.stderr??'');offline=[...new Set([...ht.matchAll(/(--(?:no-install|skip-install|no-deps|offline|no-git|skip-git|no-network))\b/g)].map(x=>x[1]))];}finally{fs.rmSync(i2.base,{recursive:true,force:true});}}
  if(!stdin&&!gave&&!scaffold&&!args.some(a=>a==='{input}'))args.push('{input}');
  why.push((/^readme/i.test(pickUse.file)?'README 用法 ':'文件用法 ')+pickUse.file+':'+pickUse.line+'：'+pickUse.text.slice(0,80));}
 else{
  if(cmd){args.push(cmd);why.push('問句點名指令 '+cmd+'（框架註冊）');}
  // positional arguments from the usage line of --help: FILE-ish → {input}, others → placeholders
  const usage=(text.match(/usage:\s*([^\n]+)/i)?.[1]??'').replace(/\[options\]|\[OPTIONS\]|\[flags\]|\[FLAGS\]/g,'');const ut=usage.split(/\s+/).filter(Boolean),ci=cmd?ut.indexOf(cmd):-1;
  // positionals after the program (and the subcommand); optional [X] kept only when it looks like the input file
  const pos=ut.slice(ci>=0?ci+1:ut.findIndex(t=>!/^(python[\d.]*|-m|-c|node)$/.test(t)&&!/\.py$/.test(t))+1).filter(t=>t&&!/^-/.test(t)&&!/^(COMMAND|ARGS|\[ARGS\]|\[COMMAND\])\.\.\.$/.test(t)&&(!/^\[/.test(t)||FILEISH.test(t.replace(/[[\].]/g,''))));
  let gave=false;for(const t of pos){const n=t.replace(/[<>[\].]/g,'');if(!n)continue;if(!gave&&FILEISH.test(n)&&!/^path$/i.test(n)||!gave&&pos.indexOf(t)===pos.length-1){args.push('{input}');gave=true;}else args.push(/path|db|database|out|dest|dir/i.test(n)?'trial-out'+(/db|database/i.test(n)||/sqlite/i.test(e.name)?'.db':''):n.toLowerCase());}
  if(pos.length)why.push('--help 的用法行：'+usage.trim().slice(0,80));
  if(!gave){const stdinHelp=/stdin|standard input|STDIN/.test(text);if(stdinHelp){stdin=true;why.push('--help 說會讀標準輸入');}else args.push('{input}');}}
 if(flag&&!args.includes(flag)){args.push(flag);why.push('--help 有 '+flag+'（對到問句的「'+flag.slice(2)+'」）');}
 const run=[...base.map(x=>/\s/.test(x)?'"'+x+'"':x),...args.filter(a=>a!=='{input}'||!stdin),...(stdin?['<','{input}']:[])].join(' ').replace(/(\S+) < \{input\}$/,'$1 < {input}');
 const display=[shown,...args.filter(a=>a!=='{input}'||!stdin),...(stdin?['<','{input}']:[])].join(' ');
 if(!why.length)why.push('沒有 README 用法也讀不到 --help，只用入口加檔案');
 if(multi){why.splice(0,why.length,...why.filter(w=>/^問句提到 \d+ 個指令/.test(w)));const q2=x=>/\s/.test(x)?'"'+x+'"':x;for(const x of multi){x.run=[...base.map(q2),...x.args.map(q2)].join(' ');x.display=[shown,...x.args].join(' ');}
  const own=e.pkg?readJson(path.join(root,e.pkg,'package.json')):null;const ws=new Map(subPackages(root).map(d=>[readJson(path.join(root,d,'package.json'))?.name,d]));
  var peers=Object.fromEntries(Object.keys(own?.peerDependencies??{}).filter(n=>ws.has(n)).map(n=>[n,ws.get(n)]));}
 return {...(useChoice&&!multi?{choice:useChoice}:{}),run:multi?multi[0].run:run,display:multi?multi.map(x=>x.display).join(' → '):display,...(multi?{multi,peers}:{}),why,inferred:true,...(typeof offline!=='undefined'&&offline?.length?{offlineFlags:offline}:{}),help:(sub||h).split('\n').filter(Boolean).slice(0,12).join('\n').slice(0,900),sure:!!(pickUse||flag||cmd)};
}
// PYTHONPATH for the copy: every folder that holds a top-level package (root, src/, packages/x/src …)
function pyPathOf(copy){const inits=[];const walk=(d,rel,depth)=>{if(depth>6||inits.length>4000)return;let es;try{es=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
  for(const x of es){if(x.isDirectory()){if(!/^(node_modules|\.git|\.venv|venv|__pycache__|site-packages|\..*)$/.test(x.name))walk(path.join(d,x.name),rel?rel+'/'+x.name:x.name,depth+1);}else if(x.name==='__init__.py')inits.push(rel+'/__init__.py');}};
 walk(copy,'',0);return pyRootsOf(inits).map(r=>r?path.join(copy,r):copy).join(':');}
// Test sources (for "does a test hit this route"), capped
function listTestText(root){let out='',n=0;const walk=(d,rel,depth)=>{if(depth>4||n>200)return;let es;try{es=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
  for(const x of es){if(x.isDirectory()){if(!/^(node_modules|\.git|\.venv|venv|dist|build)$/.test(x.name))walk(path.join(d,x.name),rel+'/'+x.name,depth+1);}else if(/(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[cm]?[jt]s$|^test_.*\.py$/.test(rel+'/'+x.name)&&n++<200){try{out+=fs.readFileSync(path.join(d,x.name),'utf8').slice(0,40000);}catch{}}}};
 walk(root,'',0);return out;}
// node_modules of the root and of each workspace package (pnpm keeps one per package), linked read-through into the copy
function linkModules(root,copy){const walk=(rel,depth)=>{let es;try{es=fs.readdirSync(path.join(root,rel),{withFileTypes:true});}catch{return;}
  for(const x of es){if(!x.isDirectory())continue;const r=rel?rel+'/'+x.name:x.name;
   if(x.name==='node_modules'){if(fs.existsSync(path.join(copy,rel))&&!fs.existsSync(path.join(copy,r)))fs.symlinkSync(path.join(root,r),path.join(copy,r),'dir');}
   else if(depth<4&&!/^(\.git|\.venv|venv|__pycache__|dist|build)$/.test(x.name)&&!x.name.startsWith('.'))walk(r,depth+1);}};walk('',0);}
function isoCopy(root){const base=fs.mkdtempSync(path.join(os.tmpdir(),'tcl-trial-')),copy=path.join(base,'repo');copyRepo(root,copy);linkModules(root,copy);return {base,copy};}
function trialEnv(iso,cmd0){const env={PATH:process.env.PATH,HOME:iso.base,TMPDIR:iso.base,LANG:'C.UTF-8',NO_COLOR:'1',TERM:'dumb',COLUMNS:'100'};
 if(/(^|\/)python[\d.]*$/.test(cmd0))Object.assign(env,{PYTHONPATH:pyPathOf(iso.copy),PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',PYTHONIOENCODING:'utf-8'});return env;}
function execIso(iso,root,cmd,{timeoutMs=8000,input}={}){
 if(/^python[\d.]*$/.test(cmd[0])&&pyVenv(root))cmd=[pyVenv(root),...cmd.slice(1)];
 const unshare=spawnSync('unshare',['-rn','true']).status===0,full=unshare?['unshare','-rn','--',...cmd]:cmd;
 return spawnSync(full[0],full.slice(1),{cwd:iso.copy,env:trialEnv(iso,cmd[0]),encoding:'utf8',timeout:timeoutMs,input,stdio:[input!=null?'pipe':'ignore','pipe','pipe'],maxBuffer:4*1024*1024});}
export function runTrial(root,{run,input,badInput,timeoutMs=15000,question='',plan=null,server=null,triggers=[]}={}){
 root=path.resolve(root);if(!run)throw Error('試跑要給 --run，例如 --run "node bin/cli.js {input}"');
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'tcl-trial-')),copy=path.join(base,'repo'),inDir=path.join(base,'inputs');copyRepo(root,copy);fs.mkdirSync(inDir);
 linkModules(root,copy);
 // fake input in the format the sentence names (CSV, JSON, DOCX, PDF, HTML …); the good one carries MARKER
 const fmt=input?null:formatOf(question)??(/\.csv$/i.test(input??'')?'csv':null),fk=fakeInput(fmt);
 const good=path.join(inDir,'good'+(input?path.extname(input)||'.txt':fk.ext));fs.writeFileSync(good,input?fs.readFileSync(input):fk.good);
 const bad=path.join(inDir,'bad'+path.extname(good));fs.writeFileSync(bad,badInput?fs.readFileSync(badInput):input?'\u0000\u0001not valid\n':fk.bad);
 const unshare=spawnSync('unshare',['-rn','true']).status===0;
 const argv=s=>s.match(/"[^"]*"|'[^']*'|\S+/g).map(x=>x.replace(/^["']|["']$/g,''));
 const env={PATH:process.env.PATH,HOME:base,TMPDIR:base,LANG:'C.UTF-8',NO_COLOR:'1'};
 // Python: import from the copy, never write .pyc into it, no user site-packages; deps are whatever the box already has (no install).
 const py=/(^|\/)python[\d.]*$|^uv$|^pipx$/.test(argv(run)[0]),venv=py?pyVenv(root):null;
 if(py)Object.assign(env,{PYTHONPATH:pyPathOf(copy),PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',PYTHONIOENCODING:'utf-8'});
 // `< {input}` feeds the file on standard input instead of a path argument.
 const viaStdin=/<\s*\{input\}/.test(run);
 const cases=[],runOne=(id,label,file,reuse=null)=>{
  // run from an empty work folder, like a caller would (not inside the repo, so the repo's own config files do not apply);
  // repo-relative script paths in the command point into the copy
  const work=path.join(base,'work-'+(reuse??id));if(!reuse)fs.mkdirSync(work);
  const before=snapshot(copy),beforeIn=snapshot(inDir),beforeW=snapshot(work),beforeH=snapOther(base),t0=Date.now();let cmd=viaStdin?argv(run.replace(/<\s*\{input\}/,'')):argv(run).map(x=>file?x.replace('{input}',file):x);if(py&&venv)cmd=[venv,...cmd.slice(1)];
  cmd=cmd.map((x,i)=>!x.startsWith('-')&&!path.isAbsolute(x)&&/[\/.]/.test(x)&&fs.existsSync(path.join(copy,x))&&(i===0||fs.statSync(path.join(copy,x)).isFile())?path.join(copy,x):x);
  // servers: loopback only (still no outside network), probe with GETs, then stop it
  const probe=server&&unshare&&!viaStdin;const penv=probe?{...env,TCL_PROBE:JSON.stringify({cmd,paths:server.paths??[],waitMs:8000})}:env;
  const full=probe?['unshare','-rn','--','sh','-c','ip link set lo up 2>/dev/null; exec "$0" "$1"',process.execPath,path.join(path.dirname(new URL(import.meta.url).pathname),'serve-probe.mjs')]:unshare?['unshare','-rn','--',...cmd]:cmd;
  const r0=spawnSync(full[0],full.slice(1),{cwd:work,env:penv,encoding:'utf8',timeout:timeoutMs,input:viaStdin?fs.readFileSync(file):undefined,stdio:[viaStdin?'pipe':'ignore','pipe','pipe'],maxBuffer:4*1024*1024});
  let r=r0,srv=null;if(probe){const line=(r0.stdout??'').split('\n').find(l=>l.startsWith('@@TCL_PROBE@@'));if(line){srv=JSON.parse(line.slice(13));r={status:srv.exit,stdout:srv.stdout,stderr:srv.stderr};for(const x of srv.gets)if(x.body)x.body=x.body.replaceAll(base,'<隔離>');}}
  const stdout=r.stdout??'',stderr=r.stderr??'';
  const dep=stderr.match(/(?:ModuleNotFoundError|ImportError): No module named '([\w.]+)'/)?.[1]??stderr.match(/Cannot find (?:module|package) '([^']+)'/)?.[1]??null;
  cases.push({id,label,ms:Date.now()-t0,command:(cmd.join(' ')+(viaStdin?' < '+file:'')).replaceAll(base,'<隔離>'),missingDep:dep,exit:r.status??(r.signal?'被中止 '+r.signal:'?'),timedOut:r.error?.code==='ETIMEDOUT',stdout:stdout.replaceAll(base,'<隔離>').slice(0,3000),stderr:stderr.replaceAll(base,'<隔離>').slice(0,1500),json:jsonShape(stdout),marker:input?null:stdout.includes(MARKER)||null,changed:[...diff(before,snapshot(copy)).map(f=>'<repo>/'+f),...diff(beforeIn,snapshot(inDir)).map(f=>'<輸入資料夾>/'+f),...diff(beforeW,snapshot(work)).map(f=>beforeW.has(f)?f+'（改）':f),...squash(diff(beforeH,snapOther(base))).map(f=>'<家目錄或暫存>/'+f)].slice(0,scaffold?80:20),changedCount:diff(before,snapshot(copy)).length+diff(beforeW,snapshot(work)).length,...(srv?{server:{listened:srv.listened,base:srv.base,gets:srv.gets,stoppedByProbe:srv.stoppedByProbe}}:{})});};
 // scaffolders (init / create / new …) take no input file: run in an empty folder, then again in the same folder
 const scaffold=!/\{input\}/.test(run);
 if(plan?.multi){// a small made-up project (package.json + one React file), every command run in it one after another
  const proj=path.join(base,'work-project');fs.mkdirSync(path.join(proj,'src'),{recursive:true});
  fs.writeFileSync(path.join(proj,'package.json'),JSON.stringify({name:'trial-app',version:'0.0.0',private:true,type:'module',dependencies:{react:'^19.0.0'}},null,2)+'\n');
  // peer packages the tool expects in a project (e.g. @astryxdesign/core) and that live in this repo: linked into the made-up project
  const peers=Object.keys(plan.peers??{});const pj=JSON.parse(fs.readFileSync(path.join(proj,'package.json'),'utf8'));
  for(const n of peers){const d=plan.peers[n];const dst=path.join(proj,'node_modules',...n.split('/'));fs.mkdirSync(path.dirname(dst),{recursive:true});fs.symlinkSync(path.join(copy,d),dst,'dir');pj.dependencies[n]=JSON.parse(fs.readFileSync(path.join(copy,d,'package.json'),'utf8')).version??'*';}
  fs.writeFileSync(path.join(proj,'package.json'),JSON.stringify(pj,null,2)+'\n');
  // project files the sentence names (AGENTS.md, CLAUDE.md …) already exist with the owner's own text, as in a real project
  for(const f of new Set((question.match(/\b[A-Za-z][\w-]*\.md\b/g)??[])))fs.writeFileSync(path.join(proj,f),'# my rules\n');
  fs.writeFileSync(path.join(proj,'src','App.tsx'),"export default function App(){return <main><h1>Trial Report 2026</h1><button>OK</button></main>;}\n");
  const r0=run;for(const x of plan.multi){run=x.run;runOne(x.cmd,'在假專案跑 '+x.display,null,'project');cases.at(-1).fixture=true;}run=r0;}
 else  if(scaffold){runOne('good','空資料夾跑一次',null);runOne('good-again','同一資料夾再跑',null,'good');
  const g0=cases[0];if(plan?.offlineFlags?.length&&(g0.timedOut||g0.exit!==0)){const r0=run;run=run+' '+plan.offlineFlags.join(' ');runOne('offline','加 '+plan.offlineFlags.join(' ')+' 再跑',null);run=r0;}}
 else{runOne('good','正常輸入',good);runOne('good-again','同一份重跑',good);runOne('bad','格式錯的輸入',bad);if(viaStdin){const empty=path.join(inDir,'empty'+path.extname(good));fs.writeFileSync(empty,'');runOne('empty','空輸入',empty);}else runOne('missing','檔案不存在',path.join(inDir,'no-such-file'+path.extname(good)));}
 // guarded writes: run once more per output flag on a copy of the good input (value flags write to a new file in the work folder)
 if(!scaffold&&!plan?.multi&&!viaStdin&&!server)triggers.slice(0,3).forEach((x,k)=>{const ext=path.extname(good),inp=path.join(inDir,'trig-'+(k+1)+ext);fs.copyFileSync(good,inp);const h0=fs.readFileSync(inp);
  const outP=path.join(base,'work-trig-'+(k+1),'out'+ext);const r0=run;run=run.replace('{input}',x.flag+(x.value?' '+outP:'')+' {input}');runOne('trig-'+(k+1),'加 '+x.flag+(x.value?' <新檔>':''),inp);run=r0;
  const c=cases.at(-1),ow=fs.existsSync(outP);c.trigger={flag:x.flag,value:x.value,defined:x.file+':'+x.line,outWritten:ow,outBytes:ow?fs.statSync(outP).size:0,outHead:ow?fs.readFileSync(outP,'utf8').slice(0,300):null,inputChanged:!fs.readFileSync(inp).equals(h0)};});
 const a=cases.find(c=>c.id==='good'),b=cases.find(c=>c.id==='good-again');if(a&&b)b.sameStdout=a.stdout===b.stdout;
 const out={ran:true,...(plan?.multi?{project:true,peers:plan.peers??{},multi:plan.multi.map(x=>({cmd:x.cmd,display:x.display,why:x.why}))}:scaffold?{scaffold:true}:{}),viaStdin,python:py,...(venv?{venv:path.relative(root,venv)}:{}),...(plan?{inferred:true,display:plan.display,why:plan.why,help:plan.help,sure:plan.sure}:{}),network:unshare?'off':'guarded',...(server&&unshare?{server:true}:{}),isolation:unshare?(server?'獨立網路命名空間（只有本機回環，連不到外面），在 repo 副本裡跑；服務起來後用 GET 試讀再關掉':'獨立網路命名空間（完全沒有網路），在 repo 副本裡跑'):'沒有 unshare，網路沒隔離',run,inputs:{format:input?path.extname(input):fk.fmt,marker:input?null:MARKER,good:/^(docx|pdf)$/.test(fk.fmt??'')&&!input?'（'+fk.fmt+' 二進位檔，內含「'+MARKER+'」）':fs.readFileSync(good,'utf8').slice(0,400),bad:fs.readFileSync(bad,'utf8').slice(0,400).replace(/[\u0000-\u0008]/g,'·')},cases,at:new Date().toISOString()};
 fs.rmSync(base,{recursive:true,force:true});return out;
}
// ---- short mode: "is feature X wired?" A → … → B, plus whether a test reaches B. ----
function unitsFor(g,spec){
 const [file,name]=spec.includes(':')&&!/^[A-Za-z]:[\\/]/.test(spec)?[spec.slice(0,spec.lastIndexOf(':')),spec.slice(spec.lastIndexOf(':')+1)]:g.files.has(spec)||/\.\w+$/.test(spec)?[spec,null]:[null,spec];
 const exact=file&&g.files.has(file);const out=[];for(const f of g.files.values()){if(file&&f.rel!==file&&(exact||!f.rel.endsWith('/'+file)))continue;for(const u of f.units.values()){if(name?u.name===name||u.name.endsWith('.'+name)||u.name.toLowerCase().includes(name.toLowerCase())&&name.length>3:true)out.push(u.id);}}
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

// a choice is close when the runner-up is within 1 point (or 15%) of the pick: say so instead of guessing silently
export function choiceNotes(choices=[]){const out=[];for(const c of choices){const [a,b]=c.ranked;if(!a||!b)continue;const gap=a.score-b.score,close=gap<=Math.max(1,Math.abs(a.score)*0.15);c.close=close;c.gap=Math.round(gap*10)/10;
  if(close)out.push(c.what+'挑 `'+a.name+'`（'+a.score+' 分）只贏 `'+b.name+'`（'+b.score+' 分）'+c.gap+' 分，可能挑錯；'+(c.what==='入口'?'要換就加 '+(b.switch??'--entry'):c.what==='試跑用法'?'要換就給 --run':'要換就在問句寫 '+b.name));}
 return out;}
