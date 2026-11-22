import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readBounded} from './walker.mjs';
import {gitRead,gitUnknown} from './git-evidence.mjs';
import {tokens} from './language-static.mjs';
import {readOptions,printReport,summaryLine} from './cli-output.mjs';
import {isMain} from './is-main.mjs';

const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function writerPattern(field){
 const f=escape(field);
 const assignment='(?:(?:[+*/%&|^?-]|\\*\\*|\\?\\?|&&|\\|\\|)?=)(?!=|>)';
 return new RegExp('(?:["\']'+f+'["\']\\s*\\]\\s*'+assignment+'|(?:["\']'+f+'["\']|(?<![\\w$])'+f+'(?![\\w$]))\\s*(?::|'+assignment+'))','g');
}
// Bounded lexical statements: ignore comments/string contents, retain multiline calls/objects.
function errorStatements(body,file){
 const ts=tokens(body,file.endsWith('.py'),{regexLiterals:true}),ranges=[];
 let statement=[],stack=[];
 const flush=()=>{
  if(statement.some((t,i)=>t.kind==='name'&&(
   ['throw','raise'].includes(t.v)||/^(?:fail|refuse|bad|raise)(?:$|[A-Z_])/.test(t.v)&&statement[i+1]?.v==='('&&statement[i-1]?.v!=='function'||
   t.v==='new'&&statement[i+1]?.kind==='name'&&/Error$/.test(statement[i+1].v))))ranges.push([statement[0].start,statement.at(-1).end]);
  statement=[];
 };
 for(const t of ts){
  const prev=statement.at(-1)?.v;
  if(t.v==='\n'){
   if(!stack.some(s=>s!=='block')&&!['throw','raise','=','.',','].includes(prev))flush();
   continue;
  }
  if(t.kind!=='string'&&t.kind!=='regex'){
   if(t.v==='{'&&(!stack.length||stack.at(-1)==='block')&&!['=',':',',','return','['].includes(prev)){flush();stack.push('block');continue;}
   if(t.v==='}'&&stack.at(-1)==='block'){flush();stack.pop();continue;}
   if(['(','[','{'].includes(t.v))stack.push(t.v);
   if([')',']','}'].includes(t.v))stack.pop();
   if(t.v===';'&&!stack.some(s=>s!=='block')){flush();continue;}
  }
  statement.push(t);
 }
 flush();return ranges;
}
const sourceRank=file=>/(?:^|\/)(?:tests?|__tests__|fixtures?|docs?|examples?)(?:\/|$)|(?:^|[./_-])(?:test|spec|self-test)(?:[./_-]|$)|\.(?:md|rst|txt)$/i.test(file)?1:0;
export function scanSymptom(mode,{root='.',text,field,safeDirectory,rev}={}){
 const matches=[],skipped=[];let scanned=0,binary=0;
 try{
  if(mode==='literal'&&!text||mode==='writers'&&!field)throw Error('請提供要搜尋的字面或欄位名稱');
  if(!['literal','writers'].includes(mode))throw Error('請選擇字面或寫入候選搜尋');
  const revision=rev?gitRead(root,['rev-parse','--verify',rev+'^{commit}'],{safeDirectory}).trim():null;
  const tracked=gitRead(root,revision?['ls-tree','-r','--name-only','-z',revision]:['ls-files','-z'],{safeDirectory}).split('\0').filter(Boolean),pattern=mode==='writers'?writerPattern(field):null;
  const files=revision&&mode==='literal'?gitRead(root,['grep','-I','-l','-z','-F','-e',text,revision,'--'],{safeDirectory}).split('\0').filter(Boolean).map(f=>f.slice(revision.length+1)):tracked;
  for(const file of files){
   let bytes;try{bytes=revision?Buffer.from(gitRead(root,['show',revision+':'+file],{safeDirectory})):readBounded(root,file);}catch(e){skipped.push({file,reason:e.message});continue;}
   if(bytes.includes(0)){binary++;continue;}scanned++;
   const body=bytes.toString('utf8'),errors=mode==='literal'&&body.includes(text)?errorStatements(body,file):[];let offset=0;
   body.split('\n').forEach((raw,i)=>{
    const line=raw.replace(/\r$/,'');
    const hits=pattern?[...line.matchAll(pattern)].map(m=>m.index):[line.indexOf(text)].filter(n=>n>=0);
    for(const at of hits){
     const before=line.slice(line.lastIndexOf(';',at-1)+1,at),context=before+line.slice(at,at+100);
     const kind=errors.some(([start,end])=>offset+at>=start&&offset+at<end)?'丟出錯誤':/\b(?:console|logger|log)\s*[.(]|\blog(?:ger)?\./i.test(before)?'寫記錄':/=(?!=|>)/.test(context)||/['"\w$]+\s*:/.test(context)?'賦值':'其他';
     matches.push({file,line:i+1,column:at+1,text:Array.from(line.slice(Math.max(0,at-50))).slice(0,200).join(''),kind:pattern?'寫入候選':kind,candidate:true});
    }
    offset+=raw.length+1;
   });
  }
  if(mode==='literal')matches.sort((a,b)=>(a.kind==='丟出錯誤'?0:1)-(b.kind==='丟出錯誤'?0:1)||sourceRank(a.file)-sourceRank(b.file)||a.file.localeCompare(b.file)||a.line-b.line||a.column-b.column);
  const total=matches.length,omitted=mode==='literal'?Math.max(0,total-20):0;
  return {status:skipped.length?'UNKNOWN':'PASS',root:path.resolve(root),query:mode==='literal'?{text}:{field},revision,scope:revision?'git tracked files at pinned commit; lexical candidates':'git tracked working-tree text files; lexical candidates, not execution evidence',tracked:tracked.length,scanned,binary,skipped,total,omitted,matches:mode==='literal'?matches.slice(0,20):matches};
 }catch(e){return {...gitUnknown(e.message),matches,skipped};}
}
export function compareRecords(good,bad){
 const differences=[];let total=0;
 const add=(key,kind,a,b)=>{total++;if(differences.length<40)differences.push({key,kind,...(kind!=='only-bad'?{good:a}:{}),...(kind!=='only-good'?{bad:b}:{})});};
 const obj=x=>x!==null&&typeof x==='object';
 function visit(a,b,key){
  if(obj(a)&&obj(b)&&Array.isArray(a)===Array.isArray(b)){
   for(const k of new Set([...Object.keys(a),...Object.keys(b)])){
    const next=key+'/'+k.replaceAll('~','~0').replaceAll('/','~1');
    if(!Object.hasOwn(a,k))add(next,'only-bad',undefined,b[k]);else if(!Object.hasOwn(b,k))add(next,'only-good',a[k]);else visit(a[k],b[k],next);
   }
  }else if(!Object.is(a,b))add(key,'different',a,b);
 }
 visit(good,bad,'');return {differences,total,omitted:total-differences.length};
}
export function symptomSummary(r){
 const rows=r.matches??r.differences??[],shown=rows.slice(0,12),total=r.total??rows.length;
 return [`${r.differences?'記錄比較':'症狀搜尋'}：${r.status==='UNKNOWN'?'未知':'完成'}；共 ${total} 筆，先看 ${shown.length} 筆，省略 ${total-shown.length} 筆。`,
  ...(r.cause?['原因：'+summaryLine(r.cause)]:[]),
  ...shown.map(x=>x.file?`${x.file}:${x.line} — ${x.kind}；${x.text}`:`${x.key||'/'} — ${{different:'值不同','only-good':'僅成功記錄有','only-bad':'僅失敗記錄有'}[x.kind]}`),
  ...(r.skipped?.length?['另有 '+r.skipped.length+' 檔未讀取；詳見 JSON 的 skipped。']:[]),
  r.differences?'比較以欄位路徑定位，沒有原碼行號。':'這是詞法候選，需回讀原碼；不證明已執行。'
 ].map(summaryLine);
}
if(isMain(import.meta.url)){
 const [mode,...args]=process.argv.slice(2),options=readOptions(args);
 if(mode==='--help'||options.help)console.log('症狀回溯：literal --root <repo> --text <字面>（錯誤候選優先，預設 20 筆）；writers --root <repo> --field <名稱>；compare --good <成功記錄> --bad <失敗記錄>。共用 --summary、--out <JSON>；搜尋可選 --rev、--safe-directory。');
 else{
  let r;try{r=mode==='compare'?compareRecords(JSON.parse(fs.readFileSync(options.good,'utf8')),JSON.parse(fs.readFileSync(options.bad,'utf8'))):scanSymptom(mode,options);}catch(e){r=gitUnknown(e.message);}
  try{printReport(r,options,symptomSummary);}catch(e){console.error(e.message);process.exitCode=1;}
 }
}
