import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync,spawn} from 'node:child_process';
import os from 'node:os';
import {initChain,checkChainAnchor} from './chain-card.mjs';
import {reviewUnknowns} from './unknowns.mjs';
import {noLinks} from './walker.mjs';
import {gitRead} from './git-evidence.mjs';
import {targetHas} from './target-has.mjs';
import {adapterContract} from './adapter-contract.mjs';
import {traceRoute,traceWired,runTrial,draftAnswer,astPreflight,inferRun,packageNames,choiceNotes,guardTriggers} from './usage-route.mjs';
import {renderRouteHtml} from './route-report-html.mjs';
import {uiTargets} from './ui-trial.mjs';
import {checkQuotes} from './check-quotes.mjs';
import {trialGate,preflight,resolveScope,scopeNotes,scopeLine,pendingText,answersFrom,ownerAsks,relayText,capLabel,parseCapability} from './preflight.mjs';
// Dogfood ext round: the step hints say 超出範圍 etc. in Chinese, so --unknown accepts the Chinese class labels too.
const UNKNOWN_CLASS_ZH={'沒去跑':'not-run','沒跑':'not-run','未試跑':'not-run','由模型決定':'model-choice','單次異常':'one-off','資料沒了':'evidence-lost','要負責人判斷':'owner-only','負責人判斷':'owner-only','範圍或授權外':'out-of-scope','超出範圍':'out-of-scope'};

export const playbooks=JSON.parse(fs.readFileSync(new URL('../assets/playbooks.json',import.meta.url),'utf8'));
const array=x=>Array.isArray(x)?x:[];
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const one=x=>String(x??'').replace(/[\r\n]+/g,' ').slice(0,1800);
const completed=s=>s.done===true||['done','skipped'].includes(s.status);
// Dogfood ext round: correcting a filled card needed hand-edited JSON; `fix` removes one row or re-labels an unknown's class.
const FIX_SECTIONS={chain:['chain'],鏈:['chain'],conflict:['conflicts'],衝突:['conflicts'],cleared:['cleared'],排除:['cleared'],verify:['verification'],驗證:['verification'],unknown:['unknowns'],未知:['unknowns'],condition:['integration','conditions'],條件:['integration','conditions'],permission:['integration','permissions'],權限:['integration','permissions'],interface:['integration','interfaces'],介面:['integration','interfaces']};
export function fixTrace(c,args){
 const done=[],removals=[];
 for(let i=0;i<args.length;i++){
  const flag=args[i],value=args[i+1];
  if(flag==='--card'){i++;continue;}
  if(flag==='--remove'){i++;const m=String(value??'').match(/^([^:：]+)[:：]([1-9]\d*)$/),keys=m&&FIX_SECTIONS[m[1].trim()];
   if(!keys)throw Error('--remove 期望「章節:序號」，章節為 chain、conflict、cleared、verify、unknown、condition、permission、interface（或中文名）；收到 '+value);
   removals.push({keys,n:Number(m[2]),label:m[1].trim()});}
  else if(flag==='--class'){i++;const m=String(value??'').match(/^([1-9]\d*)=(.+)$/);if(!m)throw Error('--class 期望「未知序號=類別」；收到 '+value);
   const row=array(c.unknowns)[Number(m[1])-1];if(!row)throw Error('沒有未知第 '+m[1]+' 項');
   const v=UNKNOWN_CLASS_ZH[m[2].trim()]??m[2].trim();if(!Object.values(UNKNOWN_CLASS_ZH).includes(v))throw Error('類別無效：'+m[2]+'；可用：沒去跑、由模型決定、單次異常、資料沒了、要負責人判斷、範圍或授權外');
   row.class=v;done.push('未知第 '+m[1]+' 項類別改為 '+m[2].trim());}
  else throw Error('fix 只收 --remove 與 --class；收到 '+flag);
 }
 // Remove from the highest index first so earlier numbers stay valid within one call.
 removals.sort((a,b)=>b.n-a.n);
 for(const r of removals){const owner=r.keys.length>1?c[r.keys[0]]:c,list=array(owner?.[r.keys.at(-1)]);
  if(r.n>list.length)throw Error(r.label+' 沒有第 '+r.n+' 項（共 '+list.length+' 項）');list.splice(r.n-1,1);done.push('已刪除 '+r.label+' 第 '+r.n+' 項');}
 if(!done.length)throw Error('fix 沒有要改的項目；用 --remove 章節:序號 或 --class 序號=類別');
 return done;
}

export function startTrace(mode,question,root,books=playbooks){
 const book=books.modes[mode];if(!book)return null;
 const c={...initChain(question,root),chain:[],unknowns:[],...(mode==='integrate'?{integration:{decision:'',conditions:[],permissions:[],interfaces:[]}}:{}),mode,steps:book.steps.map(s=>({id:s.id,status:'pending',notes:'',anchors:[]}))};
 c.version.worktree='UNKNOWN';
 try{
  c.version.commit=gitRead(c.root,['rev-parse','--verify','HEAD']).trim();
  c.version.worktree=gitRead(c.root,['status','--porcelain','--untracked-files=normal']).trim()?'有未提交變更':'乾淨';
 }catch(e){c.version.reason=one(e.message);}
 return c;
}
// Card-required capabilities (fixed options) vs what the 負責人 granted in preflight; scan-inferred needs fill the rest.
export function capabilityReview(c){
 const s=c?.preflight?.scope??{},granted=array(s.capabilities),perms=array(c?.integration?.permissions);
 const required=perms.map(x=>{const parsed=x?.capability!==undefined?x:parseCapability(x?.text);return {capability:parsed.capability??null,refine:parsed.refine??null,text:x?.text??'',anchors:array(x?.anchors)};});
 const req=[...new Set(required.map(x=>x.capability).filter(Boolean))];
 const missing=c?.preflight?req.filter(x=>!granted.includes(x)):req;
 const scanOnly=array(s.capabilityNeeds).filter(x=>!granted.includes(x)&&!req.includes(x));
 const review=required.filter(x=>x.capability&&x.refine&&granted.includes(x.capability));
 const freeText=required.filter(x=>!x.capability);
 const cap=c?.mode!=='integrate'?null:!c.preflight?{reason:'沒做開卡前檢查'}:c.preflight.decisionCap?{reason:'負責人仍有未回覆項目（'+pendingText(c.preflight)+'）'}:missing.length?{reason:'卡上需要的能力負責人沒准（'+missing.map(capLabel).join('、')+'）'}:null;
 return {granted,required,missing,scanOnly,review,freeText,cap};
}
export function inspectTrace(input,books=playbooks){
 const c=object(input),book=books.modes[c.mode],flags=[],anchors=[];
 const steps=array(book?.steps),saved=array(c.steps),root=typeof c.root==='string'?c.root:'.';
 if(!book)flags.push('尚未選定可用的情境，請依劇本說明補選。');
 if(!c.question||!c.root)flags.push('問題或受查位置尚未填齊。');
 const check=a=>{const r=checkChainAnchor(root,a);anchors.push(r);return r;};
 let next=-1,done=0,skipped=0;
 steps.forEach((s,i)=>{
  const r=object(saved.find(r=>r?.id===s.id));if(r.status==='skipped')skipped++;else if(completed(r))done++;if(!completed(r)&&next<0)next=i;
  const aa=array(r.anchors).length?array(r.anchors):r.anchor?[r.anchor]:[];
  if(!aa.length&&completed(r)&&!(r.sectionAnchors>0)&&!(r.status==='skipped'&&r.notes))flags.push('第 '+(i+1)+' 步還沒有錨點；跳過時可填說明。');
  else if(aa.map(check).some(a=>a.status!=='PASS'))flags.push('第 '+(i+1)+' 步的錨點對不上。');
  if(r.status==='skipped'&&!r.notes)flags.push('第 '+(i+1)+' 步已跳過；請補原因。');
 });
 for(const [key,label] of [['chain','鏈'],['conflicts','衝突'],['cleared','排除項目'],['verification','驗證'],['unknowns','未知']]){
  array(c[key]).forEach((r,i)=>{
   r=object(r);const aa=Array.isArray(r.anchors)?r.anchors:r.anchor?[r.anchor]:[];
   if(!aa.length&&['chain','cleared'].includes(key))flags.push(label+'第 '+(i+1)+' 項還沒有錨點。');
   if(aa.map(check).some(a=>a.status!=='PASS'))flags.push(label+'第 '+(i+1)+' 項的錨點對不上。');
  });
 }
 const unknowns=reviewUnknowns(array(c.unknowns));
 if(c.mode==='integrate'){
  const r=object(c.integration);
  for(const row of [r,...array(r.conditions),...array(r.permissions),...array(r.interfaces)])if(array(row.anchors).map(check).some(a=>a.status!=='PASS'))flags.push('接入結論的錨點對不上。');
  if(next<0&&(!r.decision||!array(r.interfaces).length))flags.push('接入結論或介面摘要尚未填齊。');
  // Dogfood ext round: chain-card requires an anchor per interface; say so at fill time, not only as ANCHOR_MISMATCH in the report.
  array(r.interfaces).forEach((x,i)=>{if(!array(x.anchors).length)flags.push('介面第 '+(i+1)+' 項還沒有錨點；產鏈卡時必填，請在 --interface 後緊接 --anchor。');});
  const cap=capabilityReview(c);
  if(!c.preflight)flags.push('未做開卡前檢查：負責人授權範圍未記錄，結論最多「有條件可接」。');
  if(cap.cap&&r.decision==='可接')flags.push(cap.cap.reason+'，結論最多「有條件可接」；請改填。');
  if(cap.missing.length)flags.push('卡上需要、但負責人沒准的能力：'+cap.missing.map(capLabel).join('、')+'；結論須寫成條件。');
  if(cap.freeText.length)flags.push('需要授權的能力有 '+cap.freeText.length+' 項沒對上固定選項（需人看）；建議改填固定選項，範圍放在「|」後面。');
  if(r.decision==='可接'&&cap.scanOnly.length)flags.push('結論是可接，但掃描看到它可能需要負責人沒准的能力：'+cap.scanOnly.map(capLabel).join('、')+'；請改成有條件可接或寫明為何不需要。');
 }
 for(const r of unknowns.items){
  if(r.affects==='no')continue;
  if(r.flags.includes('未交代原因'))flags.push('未知第 '+(r.index+1)+' 項沒交代原因。');
  if(r.missing.length)flags.push('未知第 '+(r.index+1)+' 項交代未齊。');
  if(r.flags.includes('UNKNOWN_CLASS_INVALID'))flags.push('未知第 '+(r.index+1)+' 項的類別無效（'+'可用：沒去跑、由模型決定、單次異常、資料沒了、要負責人判斷、範圍或授權外'+'）；用 fix --class '+(r.index+1)+'=沒去跑 這類寫法改。');
  if(r.flags.includes('UNKNOWN_AFFECTS_INVALID'))flags.push('未知第 '+(r.index+1)+' 項的是否影響結論選項無效。');
  if(r.flags.includes('應先補做'))flags.push('未知第 '+(r.index+1)+' 項可先補做。');
 }
 return {book,steps,next,done,skipped,flags,anchors,unknowns};
}
export function stepText(step,index,total){
 return ['第 '+(index+1)+' 步／共 '+total+' 步','要做：'+one(step.do),'工具：'+one(step.tool),'停止：'+one(step.stop),'填入：'+one(step.section)];
}
// Repeated options append rows; no JSON editing required. A repeated fill appends again.
export function fillTrace(c,args,errors=[]){
 const entries=[];
 for(let i=0;i<args.length;i++){
  const flag=args[i],value=flag==='--skip'?undefined:args[i+1]?.startsWith('--')?undefined:args[++i];
  entries.push({flag,value});
 }
 const n=Number(entries.find(e=>e.flag==='--step')?.value),step=c.steps?.[n-1];
 const validStep=Number.isInteger(n)&&n>0&&step;
 if(!validStep)errors.push('--step：期望卡片內的步驟編號；收到 '+(Number.isNaN(n)?'未填':n)+'，步驟內容未寫入。');
 let owner=validStep?step:null,touched=false,skip=false,sectionAnchors=0;
 const sections=new Set(['--chain','--conflict','--cleared','--verify','--unknown','--decision','--condition','--permission','--interface']);
 const formats={'--conflict':'現象|方向','--verify':'檢查|結果','--unknown':'問題|類別|原因|試過|下一步|成本|理解|會不會改變本題結論（末欄可省略）','--interface':'名稱|輸入|輸出|錯誤|重送'};
 for(const {flag,value} of entries){
  if(sections.has(flag))owner=null; // A rejected section must not steal the previous section's anchors.
  try{
   if(['--card','--step'].includes(flag))continue;
   if(flag==='--skip'){skip=true;touched=true;continue;}
   if(!['--note','--anchor','--version',...sections].includes(flag))throw Error('未知參數；請用 fill --help 查看格式');
   const format=formats[flag]??(flag==='--version'?'提交 或 提交|執行版本':flag==='--anchor'?'檔案:行號:比對文字':'非空文字');
   const p=value===undefined?[]:value.split('|');
   if(!value?.trim()||formats[flag]&&((flag==='--unknown'?![7,8].includes(p.length):p.length!==format.split('|').length)||p.some(x=>!x.trim()))||flag==='--version'&&(![1,2].includes(p.length)||p.some(x=>!x.trim())))throw Error('期望 '+format+'；收到 '+p.length+' 欄（各欄不可空白）');
   if(flag==='--unknown'&&p.length===8&&!['yes','no','unsure'].includes(p[7]))throw Error('末欄須選會、不會或不確定，輸入方式請見說明');
   if(flag==='--unknown'&&!Object.values(UNKNOWN_CLASS_ZH).includes(UNKNOWN_CLASS_ZH[p[1].trim()]??p[1].trim()))throw Error('第 2 欄類別無效：'+p[1]+'；'+'可用：沒去跑、由模型決定、單次異常、資料沒了、要負責人判斷、範圍或授權外');
   if(flag==='--version'){c.version={...c.version,repo:c.root,commit:p[0],running:p[1]??c.version?.running??'UNKNOWN'};touched=true;continue;}
   if(flag==='--note'){if(!validStep)throw Error('無有效 --step，說明未寫入');step.notes=value;touched=true;continue;}
   if(flag==='--anchor'){
    const m=value.match(/^(.+?):([1-9]\d*):([\s\S]+)$/);
    if(!m||!m[3].trim())throw Error('期望 '+format+'；收到 '+value.split(':').length+' 欄（行號須為正整數）');
    if(!owner)throw Error('前一章節或步驟無效，錨點未寫入；請連同該章節重送');
    (owner.anchors??=[]).push(checkChainAnchor(c.root,{file:m[1],line:Number(m[2]),expect:m[3]}));if(owner!==step)sectionAnchors++;touched=true;continue;
   }
   const add=(target,key,row)=>{owner={...row,anchors:[]};(target[key]??=[]).push(owner);};
   if(flag==='--chain')add(c,'chain',{label:value});
   if(flag==='--cleared')add(c,'cleared',{finding:value});
   if(flag==='--conflict')add(c,'conflicts',{phenomenon:p[0],direction:p[1]});
   if(flag==='--verify')add(c,'verification',{check:p[0],result:p[1]});
   if(flag==='--unknown')add(c,'unknowns',{question:p[0],class:UNKNOWN_CLASS_ZH[p[1]]??p[1],cause:p[2],tried:p[3],next:{action:p[4],cost:p[5]},understanding:p[6],...(p.length===8?{affects:p[7]}:{})});
   if(['--decision','--condition','--permission','--interface'].includes(flag)){
    if(c.mode!=='integrate')throw Error('期望接入情境（integrate），目前為 '+c.mode);
    const r=c.integration??={decision:'',conditions:[],permissions:[],interfaces:[]};
    if(flag==='--decision'){
     if(!['可接','有條件可接','不建議'].includes(value))throw Error('期望 可接／有條件可接／不建議；收到 1 欄');
     if(value==='可接'){const cr=capabilityReview(c);if(cr.cap)throw Error((cr.cap.reason==='沒做開卡前檢查'?'沒做開卡前檢查':cr.cap.reason.startsWith('負責人仍有')?cr.cap.reason.replace('負責人仍有','負責人尚有'):cr.cap.reason)+'，結論最多「有條件可接」');}
     r.decision=value;r.anchors=[];owner=r;
    }
    if(flag==='--condition')add(r,'conditions',{text:value});
    if(flag==='--permission'){const pc=parseCapability(value);add(r,'permissions',{text:pc.text,capability:pc.capability,refine:pc.refine});}
    if(flag==='--interface')add(r,'interfaces',{name:p[0],input:p[1],output:p[2],error:p[3],retry:p[4]});
   }
   touched=true;
  }catch(e){errors.push(flag+'：'+e.message+'。');}
 }
 if(c.mode==='integrate'&&c.integration?.decision==='可接'){const cr=capabilityReview(c);if(cr.cap){c.integration.decision='';errors.push('--decision：'+cr.cap.reason+'，結論最多「有條件可接」；結論已清空，請改填。');}}
 if(validStep&&touched){step.status=skip?'skipped':'done';if(sectionAnchors)step.sectionAnchors=(step.sectionAnchors??0)+sectionAnchors;}
 return c;
}
export function traceHelp(){
 return [
  '用法：node scripts/trace.mjs <route|wired|route-report|preflight|answer|start|fill|fix|next|status|report> [參數]；--help 顯示本說明。',
  '用途路線：route --root <repo> --question "一句用途" --out <路線.json> [--html 報告] [--entry bin:名稱|library|檔] [--trial [--run "node bin/x {input}"] [--no-ui-trial] [--ui-keep 資料夾]] [--preflight 答覆.json] [--target 要接進的系統 [--target-name 名稱]]；',
  '  功能接好沒：wired --from 檔:函式 --to 函式；改寫答案：route-report --route <路線.json> --out <報告.html> --answer "…"。',
  '數字出處核對：check-quotes [--root 資料夾] [--map OS=/repo,WL=/repo] 草稿.md …（每個數字與單位對回引用的 檔:行）。',  '開卡前三步：preflight --root <repo> --out <問題.json> [--paths 目錄,檔] [--mode 情境]，把印出的問題原文轉給負責人；',
  '  answer --questions <問題.json> --out <答覆.json> --by "誰回的" [--accept-defaults] [--set 1=乙]… [--simulated]；',
  '  start … --preflight <答覆.json>。未回覆＝未授權，接入結論最多「有條件可接」。',
  '走完：report --card <卡片.json> --out <報告.html>：自動跑唯讀分診、套用不查範圍、產鏈卡與單檔網頁報告。',
  'start：--mode <symptom|takeover|change|integrate> --question <問題> --root <repo> --out <卡片.json>（須在 repo 外）。',
  'start 自動讀提交及工作樹；Git 拒絕時保留未知與原因。next/status：--card <卡片.json>。',
  'fill：--card <卡片.json> --step <正整數>；以下可重複，合法項目寫入，錯誤項目逐一回報。',
  '--note <說明>；--skip 跳過本步（搭配 --note 原因）。',
  '--version "提交" 或 "提交|執行版本"',
  '--chain "一站"；--cleared "排除項目"',
  '--conflict "現象|方向"；--verify "檢查|結果"',
  '--unknown "問題|類別|原因|試過|下一步|成本|理解|會不會改變本題結論"；類別：沒去跑、由模型決定、單次異常、資料沒了、要負責人判斷、範圍或授權外（或超出範圍）；末欄可省略：yes＝會、no＝不會、unsure＝不確定。',
  '--decision <可接|有條件可接|不建議>（以下四項僅 integrate）',
  '--condition "條件"；--permission "固定選項|一句範圍補充（可省）"：讀檔、寫檔、執行其他程式、連外網、用真帳號、花錢、讀機密、讓模型下系統指令；對不上的保留為需人看。',
  '--interface "名稱|輸入|輸出|錯誤|重送"',
  'fix --card <卡片.json> --remove "章節:序號"（如 interface:2、未知:1，可重複）--class "未知序號=類別"：修正已填的項目，不用手改卡片。\n'+
  '--anchor "檔案:行號:比對文字"：歸前面最近的章節；第一章節前歸步驟，其他參數不改歸屬。',
  '章節為 chain/conflict/cleared/verify/unknown/decision/condition/permission/interface；欄位均不可空白。',
  '例（start）：node scripts/trace.mjs start --mode symptom --question "為何出錯" --root . --out ../card.json',
  '例（fill）：node scripts/trace.mjs fill --card ../card.json --step 1 --note "已讀" --chain "入口" --anchor "main.mjs:1:run"',
  '例（next/status）：node scripts/trace.mjs status --card ../card.json（將 status 換成 next 看下一步）'
 ].join('\n');
}
export function traceOutput(c,command,file,books=playbooks){
 const r=inspectTrace(c,books),pass=r.anchors.filter(a=>a.status==='PASS').length;
 if(command==='status')return [`第 ${r.next<0?r.steps.length:r.next+1} 步／共 ${r.steps.length} 步；已完成 ${r.done} 步，跳過 ${r.skipped} 步；錨點通過 ${pass}／${r.anchors.length} 個；未知 ${r.unknowns.counts.total} 項`];
 const notes=scopeLine(c?.preflight)?[scopeLine(c.preflight)]:[];
 if(r.next>=0)notes.push(...scopeNotes(c,r.steps[r.next]?.id));else notes.push(...scopeNotes(c,'D8'));
 r.flags.push(...(command==='status'?[]:notes));
 const tail=r.next<0?(r.book?['步驟已走完；提醒仍需自行補查。','產卡命令：node scripts/chain-card.mjs --config '+JSON.stringify(file)+' --out '+JSON.stringify(path.dirname(file)),'報告命令（鏈卡＋網頁一次產）：node scripts/trace.mjs report --card '+JSON.stringify(file)+' --out '+JSON.stringify(path.join(path.dirname(file),'report.html'))]:[]):stepText(r.steps[r.next],r.next,r.steps.length);
 const limit=20-tail.length,head=r.flags.slice(0,Math.max(0,limit-1));if(r.flags.length>head.length)head.push('另有 '+(r.flags.length-head.length)+' 項提醒；可用摘要查看數量並回卡補齊。');
 return [...head,...tail];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [command,...args]=process.argv.slice(2),get=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
 if(command==='--help'||args.includes('--help'))console.log(traceHelp());
 else if(command==='check-quotes'){
  // numbers / units quoted from docs, checked against the cited file:line (see scripts/check-quotes.mjs)
  const map={};for(const kv of (get('--map')??'').split(',').filter(Boolean)){const [k,v]=kv.split('=');map[k]=path.resolve(v);}if(get('--root'))map['']=path.resolve(get('--root'));
  const files=args.filter((a,i)=>i>0&&!a.startsWith('--')&&!['--map','--root'].includes(args[i-1]));if(!files.length)throw Error('用法：check-quotes [--root 資料夾] [--map OS=/repo,WL=/repo] 草稿.md …');
  let bad=0;for(const f of files){const r=checkQuotes(fs.readFileSync(f,'utf8'),{map,file:f});bad+=r.findings.filter(x=>x.severity!=='check').length;
   console.log(f+'：核對 '+r.checked+' 個數字'+(r.findings.length?'，'+r.findings.length+' 個要看':'，都對得上')+(r.derived.length?'（另 '+r.derived.length+' 個是標明的換算，原文沒有）':''));
   for(const x of r.findings)console.log('  第 '+x.line+' 行 ['+({'unit-mismatch':'單位不同','range-end':'範圍的一端','not-in-source':'原文沒有'}[x.kind])+'] '+x.text);}
  process.exitCode=bad?1:0;}
 else if(command==='route'||command==='wired'||command==='route-report'){
  try{
   const out=get('--out');if(!out)throw Error('請給 --out <路線.json 或 報告.html>。');
   let m;
   if(command==='route-report'){m=JSON.parse(fs.readFileSync(path.resolve(get('--route')??''),'utf8'));if(get('--answer'))m.answer={...(m.answer??{}),text:get('--answer'),draft:false,editedAt:new Date().toISOString()};}
   else{
    const root=path.resolve(get('--root')??'.'),rel=path.relative(root,path.resolve(out));
    if(!rel||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))throw Error('路線檔請放在受查資料夾外。');
    if(command==='wired'){if(!get('--from')||!get('--to'))throw Error('wired 要給 --from 檔案:函式 與 --to 函式');m=await traceWired(root,{from:get('--from'),to:get('--to'),question:get('--question')});}
    else{m=await traceRoute(root,{question:get('--question')??'',entry:get('--entry'),fn:get('--fn')});
     // the owner's answers are read before anything runs: no answer / not approved = no CLI trial, no --help probe, no dev server, no browser
     const pf=get('--preflight')?(()=>{const af=path.resolve(get('--preflight')),ans=JSON.parse(fs.readFileSync(af,'utf8')),qs=JSON.parse(fs.readFileSync(path.resolve(path.dirname(af),ans.questionsFile),'utf8'));return resolveScope(qs,ans);})():null;
     const gate=args.includes('--trial')?trialGate(pf,{listens:(m.touches?.route??[]).some(t=>t.cap==='listen'),ui:!args.includes('--no-ui-trial')&&uiTargets(m).length>0}):null;
     if(gate&&!gate.cli){m.trial={ran:false,skipped:gate.reason,cases:[]};if(uiTargets(m).length&&!args.includes('--no-ui-trial'))m.uiTrial={ran:false,skipped:gate.uiReason??gate.reason};console.log('試跑不跑：'+gate.reason);m.answer=draftAnswer(m);}
     else if(gate){
      // no --run: infer it from README usage, --help (run in the isolated copy) and the sentence; marked 推論
      const plan=get('--run')?null:inferRun(root,m);const run=get('--run')??plan?.run;if(!run)throw Error('這個入口不是命令列，試跑要給 --run');if(plan)console.log('試跑指令（推論）：'+plan.display+'\n　依據：'+plan.why.join('；'));
      const listens=(m.touches?.route??[]).some(t=>t.cap==='listen');
      if(plan?.choice)m.choices=[...(m.choices??[]),plan.choice];
      // the capability the sentence wants lives only behind a UI control: open the app (loopback only) and press it, alongside the command-line trial
      let uiJob=null;if(!gate.ui&&gate.uiReason){m.uiTrial={ran:false,skipped:gate.uiReason};console.log('介面試跑不跑：'+gate.uiReason);}
      if(gate.ui){console.log('介面試跑：'+uiTargets(m).map(t=>t.term.toUpperCase()+'（'+t.file+'）').join('、')+'，在隔離副本開 dev 伺服器，用無頭瀏覽器按按鈕（和命令列試跑同時跑）…');
       const d=fs.mkdtempSync(path.join(os.tmpdir(),'tcl-uijob-'));fs.writeFileSync(path.join(d,'m.json'),JSON.stringify({root:m.root,question:m.question,capabilities:m.capabilities}));
       const ch=spawn(process.execPath,[fileURLToPath(new URL('./ui-trial.mjs',import.meta.url)),path.join(d,'m.json'),path.join(d,'r.json'),get('--ui-keep')?path.resolve(get('--ui-keep')):''],{stdio:'ignore'});uiJob={d,done:new Promise(r=>ch.on('exit',r))};}
      m.trial=runTrial(root,{run,plan,triggers:guardTriggers(m),server:listens?{paths:(m.framework?.picked??[]).filter(e=>e.kind==='route'&&/GET|ALL/.test(e.method??'GET')).map(e=>e.name.replace(/^\S+\s+/,'')).filter(p=>p.startsWith('/')&&!/[:*{(]/.test(p))}:null,input:get('--fake-input')&&path.resolve(get('--fake-input')),badInput:get('--bad-input')&&path.resolve(get('--bad-input')),question:m.question});
      if(m.trial.cases.find(c=>c.id==='good')?.json?.ok){for(const s of m.stations)if(/^推論/.test(s.status))s.status+='；試跑有正確輸出，間接支持';for(const u of m.unknowns)if(u.kind==='inferred')u.text+='試跑有正確輸出，間接支持這些推論。';}
      if(uiJob){await uiJob.done;try{m.uiTrial=JSON.parse(fs.readFileSync(path.join(uiJob.d,'r.json'),'utf8'));}catch{m.uiTrial={ran:false,skipped:'介面試跑沒有留下結果'};}fs.rmSync(uiJob.d,{recursive:true,force:true});}
      m.answer=draftAnswer(m);}
     if(m.choices?.length&&m.answer){const cn=choiceNotes(m.choices);if(cn.length){m.answer.parts.caveats=[...(m.answer.parts.caveats??[]),...cn];m.answer.text=m.answer.text.replace(/。?$/,'。')+cn.join('；')+'。';}}}
   }
   // --preflight 答覆.json: what the owner granted, so the page says 已准／沒准 per capability on this route
   if(get('--preflight')){const af=path.resolve(get('--preflight')),ans=JSON.parse(fs.readFileSync(af,'utf8')),qs=JSON.parse(fs.readFileSync(path.resolve(path.dirname(af),ans.questionsFile),'utf8')),r=resolveScope(qs,ans);
    m.scope={granted:r.scope.capabilities.map(x=>parseCapability?parseCapability(x).capability??x:x),pending:r.pending,pendingLabels:r.pendingLabels,simulated:r.simulated,answeredBy:r.answeredBy};}
   // --target <system repo>: does the system you wire into already do this? (read-only search, before claiming a gap)
   if(get('--target')&&command!=='route-report'){const GENERIC=/^(slide|deck|export)$/;m.targetHas=targetHas(path.resolve(get('--target')),m.toolTerms??[],{name:get('--target-name'),packages:packageNames(m.root),question:m.question});const th=m.targetHas;
    if(m.answer&&(th.rows.length||th.uses?.length)){const ev=r=>r.evidence[0]?r.evidence[0].file+':'+r.evidence[0].line:'';const has=th.rows.filter(r=>r.status==='has');
     const usesTxt=th.uses?.length?th.target+' 已經裝了 '+[...new Map(th.uses.map(u=>[u.name+u.version,u])).values()].slice(0,3).map(u=>u.name+' '+u.version+'（'+u.file+':'+u.line+'）').join('、')+(m.repo?.version||m.entry?.version?'，這次看的是 '+(m.entry?.version??m.repo.version):'')+'；':'';
     const txt=usesTxt+(has.length?th.target+' 已有 '+has.map(r=>r.term.toUpperCase()+'（'+ev(r)+'）').join('、')+'，這部分不算缺口':th.target+' 沒找到同功能的模組')+([...th.gap,...th.partial,...(th.docOnly??[])].some(x=>!GENERIC.test(x))?(!has.length&&!th.partial.length&&!(th.docOnly??[]).length?'，接進來就是補上 ':'；要補的是 ')+[...th.partial.filter(x=>!GENERIC.test(x)).map(x=>x.toUpperCase()+'（程式只接受這個格式或定義了沒人用）'),...(th.docOnly??[]).filter(x=>!GENERIC.test(x)).map(x=>x.toUpperCase()+'（只有文件提到）'),...th.gap.filter(x=>!GENERIC.test(x)).map(x=>x.toUpperCase())].slice(0,6).join('、'):'')+'（文字搜尋，見接線）';
     m.answer.parts.target=txt;m.answer.text=m.answer.text.replace(/。?$/,'。')+txt+'。';}}
   if(m.stations&&command!=='wired')m.adapter=adapterContract(m);
   const html=command==='route-report'?path.resolve(out):get('--html')&&path.resolve(get('--html'));
   if(command!=='route-report'){noLinks(path.resolve(out));fs.writeFileSync(path.resolve(out),JSON.stringify(m,null,1)+'\n');}
   if(html){noLinks(html);fs.writeFileSync(html,renderRouteHtml(m));}
   console.log(['怎麼接：'+(m.answer?.text??'（沒有）'),'路線 '+m.stations.length+' 站：'+m.stations.map(s=>s.label+' '+s.file+(s.line?':'+s.line:'')).join(' → '),
    '這條路會碰：'+([...new Set(m.touches.route.map(t=>t.label))].join('、')||'無')+'；未知 '+m.unknowns.length+' 項'+(m.engine.name!=='tree-sitter'?'；【沒有語法解析】'+m.engine.reason:''),
    ...(command!=='route-report'?['路線資料：'+path.resolve(out)]:[]),...(html?['報告：'+html]:[]),...(m.answer?.draft?['給 agent：讀過路線上的原碼後，可用 route-report --route <路線.json> --out <報告.html> --answer "…" 改寫怎麼接。']:[])].join('\n'));
  }catch(e){console.error('路線未建立：'+e.message+(/Aborted\(\)/.test(String(e.message))?'\n語法樹解析把記憶體用完了（通常是 repo 太大）。請把 --root 指到要查的子資料夾（例如 server 或 packages/某套件）再跑。':''));process.exitCode=1;}
 }
 else if(command==='preflight'){
  try{
   const root=path.resolve(get('--root')??'.'),out=get('--out');if(!out)throw Error('請給 --out <問題.json>。');
   const target=path.resolve(out),rel=path.relative(root,target);
   if(!rel||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))throw Error('問題清單請放在受查資料夾外。');
   const paths=(get('--paths')??'').split(',').map(x=>x.trim()).filter(Boolean),mode=get('--mode')??'integrate';
   noLinks(target);const astScan=args.includes('--no-ast')?null:await astPreflight(root,{entry:get('--entry')});const q=preflight(root,{paths,mode,ast:astScan});fs.writeFileSync(target,JSON.stringify(q,null,2)+'\n',{encoding:'utf8',flag:'wx'});
   const live=q.target.findings.filter(f=>!f.test&&!f.retired&&!f.typesOnly&&!f.unreached).length,unreached=q.target.findings.filter(f=>f.unreached&&!f.test).length;
   const eng=q.target.engine;console.log(eng.name==='tree-sitter'?'掃描方式：語法樹（tree-sitter '+eng.version+'，'+eng.files+' 個 JS/TS/Python 檔）；入口 '+((q.target.entries??[]).map(e=>e.kind+':'+e.name).join('、')||'找不到，全部列入')+(unreached?'；repo 有但入口走不到的線索 '+unreached+' 項，不問':''):'掃描方式：文字比對（'+(eng.reason??'')+'）');
   console.log(['開卡前檢查：讀 '+q.target.fileCount+' 檔'+(paths.length?'（只看 '+paths.join('、')+'）':'')+'；需要負責人知道的線索 '+live+' 項（另有測試、退役、型別宣告或入口走不到 '+(q.target.findings.length-live)+' 項）。'+(!paths.length&&q.target.fileCount>500?'\n範圍很大（'+q.target.fileCount+' 檔）：若只要接其中一部分，請重做並加 --paths 子目錄，問題和報告都會小很多。':''),'',relayText(q),'',
    ...(ownerAsks(q).length?['給 agent：只把上面「請負責人決定」那幾題轉給負責人；其餘由你依預設答。收到回覆後執行',
    '  node scripts/trace.mjs answer --questions '+JSON.stringify(target)+' --out <答覆.json> --by "回覆者" --agent-defaults [--set 題號=甲乙丙]',
    '  回「照建議」就改加 --accept-defaults；負責人還沒回時先只加 --agent-defaults，那幾項記為沒准；模擬演練一定要加 --simulated。']
    :['給 agent：不用問負責人，直接執行',
    '  node scripts/trace.mjs answer --questions '+JSON.stringify(target)+' --out <答覆.json> --by agent --agent-defaults']),
    ].join('\n'));
  }catch(e){console.error('問題清單未建立：'+e.message);process.exitCode=1;}
 }
 else if(command==='answer'){
  try{
   const qf=path.resolve(get('--questions')??''),out=get('--out');if(!out)throw Error('請給 --out <答覆.json>。');
   const qs=JSON.parse(fs.readFileSync(qf,'utf8')),set={};
   args.forEach((a,i)=>{if(a==='--set'){const m=String(args[i+1]??'').match(/^([^=]+)=(.*)$/);if(!m)throw Error('--set 要寫成 題號=選項，例如 1=乙');set[m[1].trim()]=m[2];}});
   const by=get('--by');if(!by)throw Error('請用 --by 寫明是誰回覆的。');
   const {answers,errors}=answersFrom(qs,{acceptDefaults:args.includes('--accept-defaults'),agentDefaults:args.includes('--agent-defaults'),set,by,simulated:args.includes('--simulated')});
   if(errors.length)throw Error(errors.join('；'));
   answers.questionsFile=path.relative(path.dirname(path.resolve(out)),qf)||path.basename(qf);
   const target=path.resolve(out);noLinks(target);fs.writeFileSync(target,JSON.stringify(answers,null,2)+'\n',{encoding:'utf8',flag:'wx'});
   const r=resolveScope(qs,answers);
   console.log([(answers.simulated?'【模擬回覆】':'')+'答覆已寫入；'+(r.pending.length?'仍未回覆 '+r.pending.length+' 項（'+pendingText(r)+'），結論最多「有條件可接」。':'全部已回覆。'),scopeLine(r),'下一步：start … --preflight '+JSON.stringify(target)].join('\n'));
  }catch(e){console.error('答覆未建立：'+e.message);process.exitCode=1;}
 }
 else if(command==='report'){
  try{
   const file=path.resolve(get('--card')??''),out=get('--out');if(!out)throw Error('請給 --out <報告.html>。');
   // Separate process: trace-report-html imports this module, so an in-process import would deadlock.
   const extra=args.flatMap((a,i)=>['--proto','--boundary','--instrument-log','--ledger','--chain-dir'].includes(a)?[a,args[i+1]]:a==='--route'?[a,path.resolve(args[i+1])]:[]);
   const r=spawnSync(process.execPath,[fileURLToPath(new URL('./trace-report-html.mjs',import.meta.url)),'--make','--card',file,'--out',path.resolve(out),...extra],{encoding:'utf8',windowsHide:true});
   if(r.status!==0)throw Error((r.stderr||r.stdout||'').trim().split(/\r?\n/).pop());
   process.stdout.write(r.stdout);
  }catch(e){console.error('報告未建立：'+e.message);process.exitCode=1;}
 }
 else if(command==='start'){
  try{
   const c=startTrace(get('--mode'),get('--question')??'',get('--root')??'.'),out=get('--out');
   if(c&&get('--preflight')){const ans=JSON.parse(fs.readFileSync(path.resolve(get('--preflight')),'utf8'));const qf=path.resolve(path.dirname(path.resolve(get('--preflight'))),ans.questionsFile??'');const qs=JSON.parse(fs.readFileSync(qf,'utf8'));
    if(path.resolve(qs.root)!==path.resolve(c.root))throw Error('開卡前檢查的受查位置和這張卡不同');if(qs.mode&&qs.mode!==c.mode)throw Error('開卡前檢查是用「'+qs.mode+'」情境問的，和這張卡不同；請用同一情境重做開卡前檢查');c.preflight={questionsFile:qf,...resolveScope(qs,ans)};}
   if(!c||!out||!c.question){console.log('請選擇情境，填一句問題、受查位置與卡片存放位置。');}
   else{
    const target=path.resolve(out),rel=path.relative(c.root,target);
    if(!rel||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))throw Error('卡片請放在受查資料夾外。');
    noLinks(target);fs.writeFileSync(target,JSON.stringify(c,null,2)+'\n',{encoding:'utf8',flag:'wx'});
    console.log([...(c.preflight?[(c.preflight.simulated?'【模擬回覆】':'')+scopeLine(c.preflight)]:[]),...stepText(playbooks.modes[c.mode].steps[0],0,c.steps.length)].join('\n'));
   }
  }catch(e){console.log(String(e?.message).startsWith('開卡前檢查')?'卡片未建立：'+e.message+'。':'卡片未建立；請確認位置可寫、檔案不存在，而且位於受查資料夾外。');}
 }else if(['next','status','fill','fix'].includes(command)){
  let c,file;try{file=path.resolve(get('--card'));c=JSON.parse(fs.readFileSync(file,'utf8'));}catch{console.error('卡片讀不到，或內容不是有效的資料格式。');process.exitCode=1;}
  if(!process.exitCode)try{
   if(command==='fix'){noLinks(file);const rel=path.relative(path.resolve(c.root),file);if(!rel||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))throw Error('卡片請放在受查資料夾外。');const done=fixTrace(c,args);fs.writeFileSync(file,JSON.stringify(c,null,2)+'\n','utf8');console.log(done.join('\n'));}
   if(command==='fill'){noLinks(file);const rel=path.relative(path.resolve(c.root),file);if(!rel||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))throw Error('卡片請放在受查資料夾外。');const errors=[];fillTrace(c,args,errors);fs.writeFileSync(file,JSON.stringify(c,null,2)+'\n','utf8');if(errors.length)console.error(errors.join('\n')+'\n其餘合法內容已寫入；只需補送被拒絕的項目。');}
   console.log(traceOutput(c,command==='fix'?'status':command,file).join('\n'));
  }catch(e){console.error(e.message);process.exitCode=1;}
 }else console.log('先用 preflight 做開卡前檢查，再用 start 選情境與問題；填卡後用 next 看下一步，或用 status 看進度。用法見 references/playbooks.md。');
}
