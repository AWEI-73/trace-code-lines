import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readBounded,noLinks,sha256} from './walker.mjs';
import {reviewUnknowns,unknownSummary,renderUnknowns} from './unknowns.mjs';

export function initChain(question,root){
 return {question,root:path.resolve(root),version:{repo:path.resolve(root),commit:'UNKNOWN',running:'UNKNOWN'},
  chain:[{label:'入口 → 下一站',anchor:{file:'',line:1,expect:''}}],
  conflicts:[],cleared:[],verification:[],unknowns:[{question:'尚待確認的問題',class:'not-run',cause:'尚未讀碼',tried:'尚未開始',next:{action:'沿問題讀碼並填錨點',cost:'免費讀取'},understanding:'沒有線索；讀碼後補解釋與可推翻的觀察'}]};
}
export function checkChainAnchor(root,input){
 const a=input&&typeof input==='object'?{...input}:{};
 delete a.sha256;delete a.corrected;delete a.note;delete a.reason;
 try{
  if(!Number.isInteger(a.line)||a.line<1||typeof a.expect!=='string'||!a.expect.trim())throw Error('file, positive line and nonempty expect required');
  const bytes=readBounded(root,a.file),lines=bytes.toString('utf8').split(/\r?\n/);a.sha256=sha256(bytes);
  const requested=a.line;
  if(!lines[requested-1]?.includes(a.expect)){
   const matches=[];for(let n=Math.max(1,requested-3);n<=Math.min(lines.length,requested+3);n++)if(lines[n-1].includes(a.expect))matches.push(n);
   if(matches.length!==1)throw Error(matches.length?'Ambiguous nearby matches':'Expected text not found within ±3 lines');
   a.line=matches[0];a.requestedLine=requested;a.corrected=true;a.note='行號已校正';
  }
  return {...a,status:'PASS'};
 }catch(e){return {...a,status:'ANCHOR_MISMATCH',reason:e.message};}
}
export function buildChainCard(c){
 if(typeof c.question!=='string'||!c.question.trim()||typeof c.root!=='string')throw Error('question and root required');
 const root=path.resolve(c.root),mismatches=[];
 const check=(a,location)=>{const r=checkChainAnchor(root,a);if(r.status!=='PASS')mismatches.push({location,...r});return r;};
 const rows=(items,kind,required=false)=>(items??[]).map((row,i)=>{
  const inputs=row.anchors??(row.anchor?[row.anchor]:[]),anchors=inputs.map((a,n)=>check(a,`${kind}[${i}].anchors[${n}]`));
  if(required&&!inputs.length)anchors.push(check(null,`${kind}[${i}].anchor`));
  const {anchor,...rest}=row;return {...rest,anchors,...(!anchors.length?{basis:'無錨點：推論'}:{})};
 });
 const chain=rows(c.chain,'chain',true),conflicts=rows(c.conflicts,'conflicts'),cleared=rows(c.cleared,'cleared',true);
 conflicts.sort((a,b)=>(['critical','high','medium','low'].indexOf(a.severity)+1||5)-(['critical','high','medium','low'].indexOf(b.severity)+1||5));
 const verification=rows(c.verification,'verification'),unknowns=rows(c.unknowns,'unknowns');
 const steps=Array.isArray(c.steps)?rows(c.steps,'steps'):undefined;
 const unknownReview=reviewUnknowns(unknowns);
 const integration=c.mode==='integrate'?{decision:c.integration?.decision??'尚未判斷',
  anchors:(c.integration?.anchors??[]).map(a=>check(a,'integration')),
  conditions:rows(c.integration?.conditions,'conditions'),permissions:rows(c.integration?.permissions,'permissions'),interfaces:rows(c.integration?.interfaces,'interfaces',true)}:undefined;
 return {schema:'chain-card-v1',question:c.question,root,version:c.version??{repo:root,commit:'UNKNOWN',running:'UNKNOWN'},chain,conflicts,cleared,verification,unknowns:unknownReview.items,unknownReview,
  ...(c.mode?{mode:c.mode}:{}),...(steps?{steps}:{}),...(integration?{integration}:{}),
  anchorReview:{status:mismatches.length?'ANCHOR_MISMATCH':'PASS',mismatches},basis:'STATIC_ONLY unless separately supported by the listed execution evidence; anchor checks do not validate interpretation.'};
}
const anchorText=a=>`${a.file??'未填檔案'}:${a.line??'?'} — ${a.status==='PASS'?'核對通過':'錨點不符'}${a.corrected?'（行號已校正：'+a.requestedLine+' → '+a.line+'）':''}；比對文字：${JSON.stringify(a.expect??'')}；雜湊：${a.sha256?.slice(0,8)??'未取得'}`;
export function renderChainCard(c){
 const lines=['# '+c.question,'',`> 錨點${c.anchorReview.status==='PASS'?'核對通過':'不符'}；${unknownSummary(c.unknownReview)}`];
 for(const a of c.anchorReview.mismatches)lines.push('> 錨點不符：'+anchorText(a)+'；請回讀檔案與比對文字。');
 lines.push('','## ① 讀的是哪一份','',...Object.entries(c.version).map(([k,v])=>'- '+({repo:'原碼位置',commit:'提交',running:'執行版本',worktree:'工作樹',reason:'版本讀取原因'}[k]??'版本補充')+'：'+(v==='UNKNOWN'?'未知':v)),'','## ② 鏈','',c.chain.map(r=>r.label).join(' → '));
 const add=(r,text)=>{lines.push('',text);for(const a of r.anchors)lines.push('  - '+anchorText(a));if(r.basis)lines.push('  - '+r.basis);};
 c.chain.forEach(r=>add(r,'- '+r.label));
 lines.push('','## ③ 衝突點','');if(!c.conflicts.length)lines.push('未列出衝突；不表示已證明沒有問題。');
 c.conflicts.forEach(r=>add(r,`- [${{critical:'最高',high:'高',medium:'中',low:'低'}[r.severity]??'未定嚴重度'}] 現象：${r.phenomenon??''}\n  - 方向：${r.direction??''}`));
 lines.push('','## ④ 查過、不是問題','');if(!c.cleared.length)lines.push('本輪未列。');c.cleared.forEach(r=>add(r,'- '+r.finding));
 lines.push('','## ⑤ 驗證與未知','');if(!c.verification.length)lines.push('未執行驗證。');
 c.verification.forEach(r=>add(r,`- ${r.command??r.check??''}：${{PASS:'通過',FAIL:'未通過'}[r.status]??'依下列記錄判讀'}；${r.result??''}`));
 lines.push('',renderUnknowns(c.unknownReview));
 c.unknowns.forEach(r=>{for(const a of r.anchors)lines.push('- '+r.question+'：'+anchorText(a));});
 if(c.integration){const r=c.integration;lines.push('','## ⑥ 接入結論','',r.decision);
  add(r,'- 結論依據');for(const row of r.conditions)add(row,'- 條件：'+row.text);for(const row of r.permissions)add(row,'- 需要授權：'+row.text);
  for(const row of r.interfaces)add(row,`- 入口：${row.name}\n  - 輸入：${row.input}\n  - 輸出：${row.output}\n  - 錯誤回法：${row.error}\n  - 重送：${row.retry}`);
  lines.push('','平台宣告草稿請用既有 scripts/export-profile.mjs；本卡不代表已授權或完成試接。');
 }
 lines.push('','錨點與雜湊只核對引用，不替代語意覆核或執行證據。','');return lines.join('\n');
}
export function writeChainCard(c,out){
 const root=path.resolve(c.root),dir=path.resolve(out),rel=path.relative(root,dir);
 if(!rel||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel))throw Error('Output must be outside inspected root');
 const targets=['chain-card.md','chain-card.json'].map(n=>path.join(dir,n));targets.forEach(noLinks);
 const card=buildChainCard(c);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(targets[0],renderChainCard(card),'utf8');fs.writeFileSync(targets[1],JSON.stringify(card,null,2)+'\n','utf8');return card;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
  if(args.includes('--help'))console.log('Usage: chain-card.mjs --init --question "question" --root repo --out input.json | --config input.json [--out output-directory]');
  else if(args.includes('--init')){
   for(const k of ['--question','--root','--out'])if(!args.includes(k)||!value(k))throw Error(k+' required');
   const out=path.resolve(value('--out')),root=path.resolve(value('--root')),rel=path.relative(root,out);
   if(!rel||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel))throw Error('Skeleton must be outside inspected root');
   noLinks(out);fs.writeFileSync(out,JSON.stringify(initChain(value('--question'),root),null,2)+'\n',{encoding:'utf8',flag:'wx'});console.log(JSON.stringify({output:out}));
  }else{
   if(!args.includes('--config'))throw Error('Use --help');
   const file=path.resolve(value('--config')),c=JSON.parse(fs.readFileSync(file,'utf8'));
   const out=args.includes('--out')?value('--out'):c.outDir??path.dirname(file),card=writeChainCard(c,out);
   console.log(JSON.stringify({outputs:['chain-card.md','chain-card.json'].map(n=>path.resolve(out,n)),anchorReview:card.anchorReview,unknowns:card.unknownReview.counts}));
  }
 }catch(e){console.error(e.message);process.exitCode=1;}
}
