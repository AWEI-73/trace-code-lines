import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readOptions,printReport,summaryLine} from './cli-output.mjs';

// No shell, hooks, external diff, configuration writes or implicit trust changes.
export function gitRead(root,args,options={}){
 const prefix=options.safeDirectory?['-c','safe.directory='+path.resolve(options.safeDirectory)]:[];
 const r=spawnSync('git',[...prefix,'--no-pager','-C',root,...args],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,
  env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1'}});
 if(!r.error&&r.status===1&&args[0]==='grep')return '';
 if(r.error||r.status!==0)throw Error((r.stderr||r.error?.message||'git 讀取失敗').trim());
 return r.stdout;
}
export function gitUnknown(reason){
 return {status:'UNKNOWN',class:'not-run',cause:reason,tried:'唯讀查詢本機 git',next:{action:'確認儲存庫位置、讀取授權與完整歷史後重查',cost:'Owner'},understanding:'沒有足夠歷史證據；不能把空結果當作從未發生'};
}
const sinceArg=s=>s?['--since='+(/^\d+d$/.test(s)?s.slice(0,-1)+' days ago':s)]:[];
export function parseHistory(raw){
 const parts=raw.split('\0'),rows=[];let row;
 for(let i=0;i<parts.length;i++){
  if(parts[i]==='TRACE_COMMIT'){row={hash:parts[++i],date:parts[++i],subject:parts[++i],files:[]};rows.push(row);}
  else if(row&&parts[i]){const f=parts[i].replace(/^\n/,'');if(f)row.files.push(f);}
 }
 return rows;
}
export function summarizeHistory(rows,mode,{path:target,top=15}={}){
 const counts=new Map();let eligible=0,ignored=0;
 for(const row of rows){
  const files=[...new Set(row.files)];
  if(mode==='cochange'){
   if(!files.includes(target))continue;
   if(files.length>30){ignored++;continue;}eligible++;
  }
  for(const file of files)if(mode!=='cochange'||file!==target){const item=counts.get(file)??{file,count:0,commits:[]};item.count++;item.commits.push(row.hash);counts.set(file,item);}
 }
 const all=[...counts.values()].sort((a,b)=>b.count-a.count||a.file.localeCompare(b.file));
 if(mode==='cochange')return {eligibleCommits:eligible,ignoredLargeCommits:ignored,files:all.map(r=>({...r,ratio:r.count/eligible}))};
 return {measure:'number-of-commits-touching-file',files:all.slice(0,top),omitted:Math.max(0,all.length-top)};
}
export function gitEvidence(mode,options={}){
 try{
  const root=path.resolve(options.root??'.'),run=args=>gitRead(root,args,options);
  run(['rev-parse','--git-dir']);const head=run(['rev-parse','--verify',(options.rev??'HEAD')+'^{commit}']).trim();
  const shallow=run(['rev-parse','--is-shallow-repository']).trim()==='true';
  const since=options.since??({recent:'30d',churn:'90d',cochange:'180d'}[mode]);
  const args=['log','--no-ext-diff','--no-textconv','--no-renames','--root','--format=%x00TRACE_COMMIT%x00%H%x00%cI%x00%s%x00','--name-only','-z',...sinceArg(since)];
  if(mode==='pickaxe'){if(!options.text)throw Error('請提供要查的字面');args.push('-S'+options.text,'--pickaxe-all');}
  else if(!['recent','churn','cochange'].includes(mode))throw Error('請選擇最近提交、字面歷史、熱區或共同改動');
  args.push(head);
  if(mode==='recent'){if(!options.paths)throw Error('請提供路徑');args.push('--',...options.paths.split(','));}
  if(mode==='cochange'&&!options.path)throw Error('請提供共同改動的目標檔');
  const rows=parseHistory(run(args)),unknowns=shallow?[gitUnknown('歷史被截斷；以下只涵蓋本機可讀提交')]:[];
  return {status:shallow?'UNKNOWN':'PASS',root,head,mode,since:since??null,queriedAt:new Date().toISOString(),query:{text:options.text,paths:options.paths,path:options.path,top:options.top??15},safeDirectoryOverride:options.safeDirectory??null,scope:'Pinned commit reachable history; merge diffs follow git log defaults; renames counted as paths',unknowns,
   ...(shallow?{class:unknowns[0].class,cause:unknowns[0].cause}:{}),
   ...(['churn','cochange'].includes(mode)?summarizeHistory(rows,mode,options):{commits:rows})};
 }catch(e){return gitUnknown(e.message);}
}
export function historySummary(r){
 const rows=r.commits??r.files??[],shown=rows.slice(0,8),omitted=(r.omitted??0)+rows.length-shown.length;
 const location=(file,commit)=>{
  try{
   const diff=gitRead(r.root,['show','--format=','--no-ext-diff','--no-textconv','--no-renames','--unified=0',commit,'--',file],{safeDirectory:r.safeDirectoryOverride});
   const hunk=diff.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/m);
   if(hunk)return `${summaryLine(file)}:${hunk[4]==='0'?hunk[1]+'（刪除前）':hunk[3]}`;
   return summaryLine(file)+':行號不適用（沒有文字差異區塊）';
  }catch{return summaryLine(file)+':行號未知（差異無法讀取）';}
 };
 return [
  `歷史查詢：${r.status==='PASS'?'完成':'未知'}；共 ${rows.length+(r.omitted??0)} 筆，先看 ${shown.length} 筆，省略 ${omitted} 筆。`,
  ...(r.cause?['原因：'+summaryLine(r.cause)]:[]),
  ...shown.map(x=>x.hash?`${x.hash.slice(0,8)} ${x.files.slice(0,3).map(f=>location(f,x.hash)).join('、')||'未列路徑'}${x.files.length>3?'（另 '+(x.files.length-3)+' 檔）':''}；${summaryLine(x.subject)}`:`${location(x.file,x.commits[0])}：${x.count} 次共同或歷史改動${x.ratio!==undefined?'，比例 '+Math.round(x.ratio*100)+'%':''}；最近提交 ${x.commits[0].slice(0,8)}`),
  ...(r.ignoredLargeCommits?['另排除 '+r.ignoredLargeCommits+' 個大範圍提交。']:[]),
  '行號指該提交第一處文字差異（刪除用前版）；不是目前工作樹或執行證據。'
 ];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [mode,...args]=process.argv.slice(2),options=readOptions(args);
 if(mode==='--help'||options.help)console.log('唯讀歷史：recent --root <repo> --paths <a,b>；pickaxe --root <repo> --text <字面>；churn --root <repo>；cochange --root <repo> --path <檔>。可選 --since、--top、--rev、--safe-directory、--summary、--out <JSON>。');
 else try{printReport(gitEvidence(mode,options),options,historySummary);}catch(e){console.error(e.message);process.exitCode=1;}
}
