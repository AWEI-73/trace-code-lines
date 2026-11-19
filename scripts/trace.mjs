import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {initChain,checkChainAnchor} from './chain-card.mjs';
import {reviewUnknowns} from './unknowns.mjs';
import {noLinks} from './walker.mjs';
import {gitRead} from './git-evidence.mjs';

export const playbooks=JSON.parse(fs.readFileSync(new URL('../assets/playbooks.json',import.meta.url),'utf8'));
const array=x=>Array.isArray(x)?x:[];
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const one=x=>String(x??'').replace(/[\r\n]+/g,' ').slice(0,1800);
const completed=s=>s.done===true||['done','skipped'].includes(s.status);
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
  if(!aa.length&&completed(r)&&!(r.status==='skipped'&&r.notes))flags.push('第 '+(i+1)+' 步還沒有錨點；跳過時可填說明。');
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
 }
 for(const r of unknowns.items){
  if(r.affects==='no')continue;
  if(r.flags.includes('未交代原因'))flags.push('未知第 '+(r.index+1)+' 項沒交代原因。');
  if(r.missing.length)flags.push('未知第 '+(r.index+1)+' 項交代未齊。');
  if(r.flags.includes('UNKNOWN_CLASS_INVALID'))flags.push('未知第 '+(r.index+1)+' 項的類別無效。');
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
 let owner=validStep?step:null,touched=false,skip=false;
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
   if(flag==='--version'){c.version={...c.version,repo:c.root,commit:p[0],running:p[1]??c.version?.running??'UNKNOWN'};touched=true;continue;}
   if(flag==='--note'){if(!validStep)throw Error('無有效 --step，說明未寫入');step.notes=value;touched=true;continue;}
   if(flag==='--anchor'){
    const m=value.match(/^(.+?):([1-9]\d*):([\s\S]+)$/);
    if(!m||!m[3].trim())throw Error('期望 '+format+'；收到 '+value.split(':').length+' 欄（行號須為正整數）');
    if(!owner)throw Error('前一章節或步驟無效，錨點未寫入；請連同該章節重送');
    (owner.anchors??=[]).push(checkChainAnchor(c.root,{file:m[1],line:Number(m[2]),expect:m[3]}));touched=true;continue;
   }
   const add=(target,key,row)=>{owner={...row,anchors:[]};(target[key]??=[]).push(owner);};
   if(flag==='--chain')add(c,'chain',{label:value});
   if(flag==='--cleared')add(c,'cleared',{finding:value});
   if(flag==='--conflict')add(c,'conflicts',{phenomenon:p[0],direction:p[1]});
   if(flag==='--verify')add(c,'verification',{check:p[0],result:p[1]});
   if(flag==='--unknown')add(c,'unknowns',{question:p[0],class:p[1],cause:p[2],tried:p[3],next:{action:p[4],cost:p[5]},understanding:p[6],...(p.length===8?{affects:p[7]}:{})});
   if(['--decision','--condition','--permission','--interface'].includes(flag)){
    if(c.mode!=='integrate')throw Error('期望接入情境（integrate），目前為 '+c.mode);
    const r=c.integration??={decision:'',conditions:[],permissions:[],interfaces:[]};
    if(flag==='--decision'){
     if(!['可接','有條件可接','不建議'].includes(value))throw Error('期望 可接／有條件可接／不建議；收到 1 欄');
     r.decision=value;r.anchors=[];owner=r;
    }
    if(flag==='--condition')add(r,'conditions',{text:value});
    if(flag==='--permission')add(r,'permissions',{text:value});
    if(flag==='--interface')add(r,'interfaces',{name:p[0],input:p[1],output:p[2],error:p[3],retry:p[4]});
   }
   touched=true;
  }catch(e){errors.push(flag+'：'+e.message+'。');}
 }
 if(validStep&&touched)step.status=skip?'skipped':'done';
 return c;
}
export function traceHelp(){
 return [
  '用法：node scripts/trace.mjs <start|fill|next|status> [參數]；--help 顯示本說明。',
  'start：--mode <symptom|takeover|change|integrate> --question <問題> --root <repo> --out <卡片.json>（須在 repo 外）。',
  'start 自動讀提交及工作樹；Git 拒絕時保留未知與原因。next/status：--card <卡片.json>。',
  'fill：--card <卡片.json> --step <正整數>；以下可重複，合法項目寫入，錯誤項目逐一回報。',
  '--note <說明>；--skip 跳過本步（搭配 --note 原因）。',
  '--version "提交" 或 "提交|執行版本"',
  '--chain "一站"；--cleared "排除項目"',
  '--conflict "現象|方向"；--verify "檢查|結果"',
  '--unknown "問題|類別|原因|試過|下一步|成本|理解|會不會改變本題結論"；末欄可省略：yes＝會、no＝不會、unsure＝不確定。',
  '--decision <可接|有條件可接|不建議>（以下四項僅 integrate）',
  '--condition "條件"；--permission "需要授權的能力"',
  '--interface "名稱|輸入|輸出|錯誤|重送"',
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
 const tail=r.next<0?(r.book?['步驟已走完；提醒仍需自行補查。','產卡命令：node scripts/chain-card.mjs --config '+JSON.stringify(file)+' --out '+JSON.stringify(path.dirname(file))]:[]):stepText(r.steps[r.next],r.next,r.steps.length);
 const limit=20-tail.length,head=r.flags.slice(0,Math.max(0,limit-1));if(r.flags.length>head.length)head.push('另有 '+(r.flags.length-head.length)+' 項提醒；可用摘要查看數量並回卡補齊。');
 return [...head,...tail];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [command,...args]=process.argv.slice(2),get=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
 if(command==='--help'||args.includes('--help'))console.log(traceHelp());
 else if(command==='start'){
  try{
   const c=startTrace(get('--mode'),get('--question')??'',get('--root')??'.'),out=get('--out');
   if(!c||!out||!c.question){console.log('請選擇情境，填一句問題、受查位置與卡片存放位置。');}
   else{
    const target=path.resolve(out),rel=path.relative(c.root,target);
    if(!rel||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))throw Error('卡片請放在受查資料夾外。');
    noLinks(target);fs.writeFileSync(target,JSON.stringify(c,null,2)+'\n',{encoding:'utf8',flag:'wx'});
    console.log(stepText(playbooks.modes[c.mode].steps[0],0,c.steps.length).join('\n'));
   }
  }catch{console.log('卡片未建立；請確認位置可寫、檔案不存在，而且位於受查資料夾外。');}
 }else if(['next','status','fill'].includes(command)){
  let c,file;try{file=path.resolve(get('--card'));c=JSON.parse(fs.readFileSync(file,'utf8'));}catch{console.error('卡片讀不到，或內容不是有效的資料格式。');process.exitCode=1;}
  if(!process.exitCode)try{
   if(command==='fill'){noLinks(file);const rel=path.relative(path.resolve(c.root),file);if(!rel||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))throw Error('卡片請放在受查資料夾外。');const errors=[];fillTrace(c,args,errors);fs.writeFileSync(file,JSON.stringify(c,null,2)+'\n','utf8');if(errors.length)console.error(errors.join('\n')+'\n其餘合法內容已寫入；只需補送被拒絕的項目。');}
   console.log(traceOutput(c,command,file).join('\n'));
  }catch(e){console.error(e.message);process.exitCode=1;}
 }else console.log('先用 start 選情境與問題；填卡後用 next 看下一步，或用 status 看進度。用法見 references/playbooks.md。');
}
