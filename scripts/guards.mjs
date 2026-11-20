// When does a side effect happen? For a write (or other side-effect) line on the route, find the conditions that must
// hold to reach it: enclosing if / elif / else, and earlier if-chains whose other branches return / raise / exit
// (sqlparse: `if inplace … elif outfile … else: print; return` → the write needs --in-place or --outfile).
// Then map the variables in those conditions to command-line flags (argparse, click, commander, yargs, util.parseArgs).
// Text + indentation, Python and JS/TS; marked as inferred. Read-only.
import fs from 'node:fs';
import path from 'node:path';

const ind=s=>{const m=s.match(/^[ \t]*/)[0];return m.replace(/\t/g,'    ').length;};
const blank=s=>!s.trim()||/^\s*(#|\/\/|\/\*|\*)/.test(s);
const FN=/^(async\s+)?def\s|^(export\s+)?(default\s+)?(async\s+)?function\b|=>\s*\{?\s*$|^(public|private|protected|static|async|\s)*[\w$]+\s*\([^)]*\)\s*(:\s*[\w<>[\], |]+)?\s*\{\s*$|^class\s/;
const EXIT=/\b(return|raise|throw)\b|\bsys\.exit\(|\bprocess\.exit\(|(^|\s)exit\(/;
// condition text of a header line, or null if not an if/elif/else-if line; 'else' for a plain else
function header(t){t=t.replace(/^\}\s*/,'');
 if(/^else\s*(:|\{|$)/.test(t))return {kind:'else'};
 let m=t.match(/^(if|elif|else\s+if)\b\s*(.*)$/);if(!m)return null;const kind=m[1]==='if'?'if':'elif';let rest=m[2];
 if(rest.startsWith('(')){let d=0,i=0;for(;i<rest.length;i++){if(rest[i]==='(')d++;else if(rest[i]===')'){d--;if(!d)break;}}return {kind,cond:rest.slice(1,i).trim(),tail:rest.slice(i+1).replace(/^\s*\{?\s*/,'')};}
 const c=rest.lastIndexOf(':');if(c>0){const tail=rest.slice(c+1);return {kind,cond:rest.slice(0,c).trim(),tail:tail.trim()};}return {kind,cond:rest.trim(),tail:''};}
// a branch exits when a statement at its own top level returns / raises / exits (not one inside a nested except / catch / if)
const exits=b=>{const ls=b.body.filter(l=>!blank(l));if(!ls.length)return false;const top=Math.min(...ls.map(ind));return ls.some(l=>(ind(l)===top||l===b.tail)&&EXIT.test(l));};
const neg=c=>({...c,neg:!c.neg});
// one if-chain at indent `lvl` that starts at line s (0-based); returns branches with body lines
function chainAt(L,s,lvl,stop){const br=[];let i=s;
 while(i<stop){const t=L[i].trim();const h=ind(L[i])===lvl&&header(t);if(!h||(br.length&&h.kind==='if'))break;
  let j=i+1;const body=h.tail?[h.tail]:[];while(j<stop&&(blank(L[j])||ind(L[j])>lvl||/^\}\s*$/.test(L[j].trim())&&ind(L[j])===lvl&&!(L[j+1]&&ind(L[j+1])===lvl&&/^(\}\s*)?else\b/.test(L[j+1].trim())))){if(/^\}\s*$/.test(L[j].trim())&&ind(L[j])===lvl){j++;break;}if(!blank(L[j]))body.push(L[j]);j++;}
  br.push({...h,line:i+1,body});i=j;if(h.kind==='else')break;
  while(i<stop&&blank(L[i]))i++;}
 return {branches:br,end:i};}
// guard of the statement at 1-based line n
export function guardAt(lines,n){const W=n-1;if(!lines[W])return null;let cur=ind(lines[W]);const all=[],anyOf=[],at=[];
 let i=W-1;
 while(i>=0){const s=lines[i];if(blank(s)){i--;continue;}const lv=ind(s),t=s.trim();
  if(lv<cur){if(FN.test(t))break;const h=header(t);
   if(h&&h.kind!=='else'){all.push({text:h.cond,neg:false});at.push(i+1);}
   else if(h?.kind==='else'){// an enclosing else: none of the earlier branches of its chain
    for(let k=i-1;k>=0;k--){if(blank(lines[k])||ind(lines[k])>lv)continue;if(ind(lines[k])<lv)break;const hh=header(lines[k].trim());if(!hh)break;if(hh.cond){all.push({text:hh.cond,neg:true});at.push(k+1);}if(hh.kind==='if')break;}}
   cur=lv;i--;continue;}
  if(lv===cur){const h=header(t);
   if(h){// find the chain start, then read the whole chain (must end before W)
    let s0=i;while(s0>=0){const hh=ind(lines[s0])===cur&&header(lines[s0].trim());if(hh&&hh.kind==='if')break;s0--;if(s0>=0&&!blank(lines[s0])&&ind(lines[s0])<cur){s0=-1;break;}}
    if(s0>=0){const {branches}=chainAt(lines,s0,cur,W);const ex=branches.map(exits);
     const hasElse=branches.at(-1)?.kind==='else';if(ex.some(Boolean)&&!(hasElse&&ex.every(Boolean))){
      const non=branches.filter((b,k)=>!ex[k]);
      if(hasElse&&!(non.length===1&&non[0].kind==='else'))anyOf.push(...non.filter(b=>b.cond).map(b=>({text:b.cond,neg:false})));
      else branches.forEach((b,k)=>{if(ex[k]&&b.cond)all.push({text:b.cond,neg:true});});
      at.push(s0+1,branches.at(-1).line);}
     i=s0-1;continue;}}}
  i--;}
 if(!all.length&&!anyOf.length)return null;
 return {all:all.map(norm),any:anyOf.map(norm),lines:[...new Set(at)].sort((a,b)=>a-b)};}
// `not x` / `!x` folded into neg
function norm(c){let t=c.text.trim(),n=c.neg;for(;;){const m=t.match(/^(not\s+|!\s*)(.*)$/);if(!m||/[|&]|\bor\b|\band\b/.test(m[2])&&!/^\(.*\)$/.test(m[2]))break;t=m[2].trim();n=!n;}return {text:t,neg:n};}

// command-line flags defined in these files: var name → {flag, short, value, file, line}
export function flagMap(root,files){const map=new Map();const camel=s=>s.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());const lineOf=(t,i)=>t.slice(0,i).split('\n').length;
 const put=(v,o)=>{if(v&&!map.has(v))map.set(v,o);};
 for(const f of files){let t;try{t=fs.readFileSync(path.join(root,f),'utf8');}catch{continue;}if(t.length>400000)continue;
  for(const m of t.matchAll(/(add_argument|click\.option|typer\.Option)\(([\s\S]*?)\)\s*(?:\n|$|,\s*\n|\)|$)/g)){const a=m[2];const strs=[...a.matchAll(/['"]([^'"]+)['"]/g)].map(x=>x[1]);const flags=strs.filter(s=>/^-/.test(s)).flatMap(s=>s.split('/'));if(!flags.length)continue;
   const long=flags.filter(s=>s.startsWith('--')).sort((x,y)=>y.length-x.length)[0]??flags[0];const dest=a.match(/dest\s*=\s*['"](\w+)['"]/)?.[1]??(m[1]==='click.option'?strs.find(s=>/^[a-z_]\w*$/i.test(s)):null)??long.replace(/^-+/,'').replace(/-/g,'_');
   const value=!/action\s*=\s*['"](store_true|store_false|count|store_const)['"]|is_flag\s*=\s*True/.test(a)&&!flags.some(s=>s.includes('/'))&&!/\btype\s*=\s*bool\b/.test(a);
   put(dest,{flag:long,short:flags.find(s=>/^-\w$/.test(s))??null,value,file:f,line:lineOf(t,m.index)});}
  for(const m of t.matchAll(/\.(?:requiredO|o)ption\(\s*['"`]([^'"`]+)['"`]/g)){const spec=m[1];const long=spec.match(/--([\w-]+)/)?.[1];if(!long)continue;const neg=long.startsWith('no-');const v=camel(neg?long.slice(3):long);
   put(v,{flag:'--'+long,short:spec.match(/(^|[\s,])(-\w)\b/)?.[2]??null,value:/<[^>]+>|\[[^\]]+\]/.test(spec),file:f,line:lineOf(t,m.index)});}
  for(const m of t.matchAll(/\.option\(\s*['"]([\w-]+)['"]\s*,\s*\{([^}]*)\}/g)){put(camel(m[1]),{flag:'--'+m[1],short:m[2].match(/alias\s*:\s*['"](\w)['"]/)?.[1]?'-'+m[2].match(/alias\s*:\s*['"](\w)['"]/)[1]:null,value:!/type\s*:\s*['"]boolean['"]|boolean\s*:\s*true/.test(m[2]),file:f,line:lineOf(t,m.index)});}
  for(const m of t.matchAll(/['"]?([\w-]+)['"]?\s*:\s*\{\s*type\s*:\s*['"](string|boolean)['"]([^}]*)\}/g)){put(camel(m[1]),{flag:'--'+m[1],short:m[3].match(/short\s*:\s*['"](\w)['"]/)?'-'+m[3].match(/short\s*:\s*['"](\w)['"]/)[1]:null,value:m[2]==='string',file:f,line:lineOf(t,m.index)});}}
 return map;}

// flags named by a condition text
function flagsIn(text,map){const out=[];for(const m of text.matchAll(/(?:\.|\b)([A-Za-z_$][\w$]*)/g)){const o=map.get(m[1]);if(o&&!out.some(x=>x.flag===o.flag))out.push({...o,var:m[1]});}return out;}

// patterns this text analysis cannot see through, near a side effect: the report says 「這裡看不到，不保證」
export function blindAt(L,n,g){const out=[];const conds=g?[...g.any,...g.all].map(c=>c.text):[];
 const call=c=>[...c.matchAll(/([A-Za-z_$][\w$.]*)\(/g)].some(m=>!/^(in|not|and|or|is|if|typeof|await|len|isinstance|hasattr|getattr|str|int|bool|Boolean|String|Number|Array\.isArray)$/.test(m[1]));
 const hc=conds.find(call);if(hc)out.push('條件是函式呼叫（'+hc.slice(0,40)+'），沒追進去看它判斷什麼');
 const W=n-1,cur=ind(L[W]??'');let lv=cur;for(let i=W-1;i>=0&&i>W-80;i--){const s=L[i];if(blank(s))continue;const v=ind(s),t=s.trim();if(v<lv){if(FN.test(t))break;if(/^(match|switch)\b|^case\b|^default\s*:/.test(t)){out.push('在 match／switch／case 裡（第 '+(i+1)+' 行），分支條件沒解析');break;}lv=v;}}
 if(/\?[^?:]+:/.test(L[W]??'')&&!/^\s*(\/\/|#)/.test(L[W]??'')||/\bif\b.+\belse\b/.test(L[W]??'')&&/^\s*[\w.]+\s*=/.test(L[W]??''))out.push('這行用三元運算挑值，條件沒解析');
 return out;}
// Attach guards to side-effect touches on the route (writes, other programs, network …).
export const GUARDED=new Set(['write-file','subprocess','network','delete','listen','paid','real-account']);
export function attachGuards(root,touches){const files=[...new Set(touches.map(t=>t.file))];const map=flagMap(root,files);const cache=new Map();
 const lines=f=>{if(!cache.has(f)){let L=[];try{L=fs.readFileSync(path.join(root,f),'utf8').split(/\r?\n/);}catch{}cache.set(f,L);}return cache.get(f);};
 for(const t of touches){if(!GUARDED.has(t.cap))continue;const L=lines(t.file),g=guardAt(L,t.line);const bl=blindAt(L,t.line,g);if(bl.length)t.blind=bl;if(!g)continue;
  const any=g.any.map(c=>({...c,flags:flagsIn(c.text,map)})),all=g.all.map(c=>({...c,flags:flagsIn(c.text,map)}));
  // triggers: flags whose being set makes the side effect possible; blockers: flags that stop it
  const trig=[...any.filter(c=>!c.neg),...all.filter(c=>!c.neg)].flatMap(c=>c.flags),block=all.filter(c=>c.neg&&!/\b(and|or)\b|&&|\|\|/.test(c.text)).flatMap(c=>c.flags);
  const uniq=a=>a.filter((x,i)=>a.findIndex(y=>y.flag===x.flag)===i);
  if(![...any,...all].some(c=>c.flags.length)&&[...any,...all].some(c=>/\b(args|opts|options|argv|flags|params|config|cfg)\.\w+/.test(c.text)))(t.blind??=[]).push('條件用到的選項沒在這條路的檔案裡找到定義，對不回旗標');
  t.guard={any,all,lines:g.lines,file:t.file,triggers:uniq(trig),blockers:uniq(block).filter(b=>!trig.some(x=>x.flag===b.flag)),inferred:true,
   text:guardText(t,uniq(trig),uniq(block),any,all)};}
 return map;}
const VERB={'write-file':'寫檔',subprocess:'執行其他程式',network:'連網',delete:'刪檔',listen:'開連線埠',paid:'花錢','real-account':'用真帳號'};
function guardText(t,trig,block,any,all){const v=VERB[t.cap]??'做這件事';const fl=x=>x.flag+(x.value?' <值>':'');
 if(trig.length)return '加 '+trig.map(fl).join(any.length>1?' 或 ':'、')+' 才會'+v+(block.length?'（加 '+block.map(x=>x.flag).join('、')+' 就不會）':'');
 if(block.length)return '沒加 '+block.map(x=>x.flag).join('、')+' 才會'+v;
 const c=[...any.map(c=>c.text),...all.map(c=>(c.neg?'不是 ':'')+c.text)].slice(0,2).join(any.length?' 或 ':' 且 ');return '只在「'+c.slice(0,60)+'」時'+v;}
