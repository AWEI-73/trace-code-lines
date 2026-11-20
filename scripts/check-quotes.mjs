// Number / unit source check: a report or extraction that quotes numbers from docs ("內文 32–44px", "約 40 words")
// is checked line by line against the file:line it cites. Every number must appear on the cited lines, with the same unit.
// Citations: `PREFIX:path:12`, `path:12-14`, a bare `:30` (same file as the previous citation on that line), and
// aliases declared in the file as "`SA` = `OS:path/to/file.md`". Prefixes map to folders with --map OS=/repo.
import fs from 'node:fs';
import path from 'node:path';
const UNIT={px:/^px$/i,pt:/^(pt|points?)$/i,ms:/^ms$/i,'%':/^%$/,in:/^(in|inch(es)?|吋)$/i,words:/^(words?|個英文單字|英文單字)$/i,chars:/^(字|個字|characters?|chars?)$/i,s:/^(s|秒|seconds?)$/i,
 pages:/^(頁|pages?)$/i,slides:/^(張|slides?)$/i,kb:/^kb$/i,mb:/^mb$/i,emu:/^emu$/i};
const unitOf=u=>{if(!u)return null;for(const [k,re] of Object.entries(UNIT))if(re.test(u.trim()))return k;return null;};
const NUM=/(?<![\w.:\/#@-])(\d+(?:\.\d+)?)(?:\s*[–~-]\s*(\d+(?:\.\d+)?))?\s*(px|pt|ms|%|in\b|吋|個英文單字|英文單字|words?\b|個字|字(?![型級體元號幕])|characters?\b|chars?\b|頁|pages?\b|張|slides?\b|秒|KB\b|MB\b|EMU\b|s\b)?/gi;
const CITE=/`(?:([A-Z]{2,3}):)?((?:[\w@.\-]+\/)*[\w@.\-]+\.[a-z]{1,5}|[A-Z]{2,3})?:(\d+)(?:\s*[-–]\s*(\d+))?((?:,\d+)*)`|(?:([A-Z]{2,3}):)?((?:[\w@.\-]+\/)+[\w@.\-]+\.[a-z]{1,5}):(\d+)(?:\s*[-–]\s*(\d+))?/g;
const DERIVED=/換算|推論|除以|乘以|÷|×|=|約等於|≈|相當於/;
export function checkQuotes(text,{map={},file=''}={}){
 const alias=new Map();for(const m of text.matchAll(/`([A-Z]{2,3})`\s*=\s*`([A-Z]{2,3}):([^`]+)`/g))alias.set(m[1],{prefix:m[2],path:m[3]});
 const findings=[];const lines=text.split(/\r?\n/);let checked=0,section=[];const derived=[];
 lines.forEach((ln,i)=>{if(/^\s*`[A-Z]{2,3}`\s*=/.test(ln))return;
  const cites=[];let last=null;for(const m of ln.matchAll(CITE)){let pre=m[1]??m[6],p=m[2]??m[7],a=+(m[3]??m[8]),b=+(m[4]??m[9]??m[3]??m[8]);const extra=(m[5]??'').split(',').filter(Boolean).map(Number);
   if(p&&/^[A-Z]{2,3}$/.test(p)&&alias.has(p)){const al=alias.get(p);pre=al.prefix;p=al.path;}
   else if(!p&&last){pre=last.pre;p=last.p;}else if(!p&&!pre)continue;
   if(!p)continue;const base=pre&&map[pre]?map[pre]:map['']??'.';let abs=path.resolve(base,p);
   if(!fs.existsSync(abs)&&!p.includes('/')){abs=findByName(base,p);}if(!abs||!fs.existsSync(abs))continue;
   last={pre,p};cites.push({file:abs,rel:(pre?pre+':':'')+p,a,b,span:[m.index,m.index+m[0].length]});for(const x of extra)cites.push({file:abs,rel:(pre?pre+':':'')+p,a:x,b:x,span:[m.index,m.index]});}
  // a heading resets; a line that is only a source note ("出處：`…:35`") covers the list items under it
  if(/^\s*#/.test(ln)){section=[];return;}
  const bare=ln.replace(CITE,'').replace(/[`、，,。：:；;（）()\s-]|出處|來源|見/g,'');
  if(cites.length&&!bare){section=cites.map(c=>({...c,span:[0,0]}));return;}
  if(!cites.length){if(!section.length||!/\d/.test(ln))return;cites.push(...section);}
  // the claim: the line with citations, code spans holding paths, and list numbering removed
  let claim=ln;for(const c of [...cites].sort((x,y)=>y.span[0]-x.span[0]))claim=claim.slice(0,c.span[0])+' '.repeat(c.span[1]-c.span[0])+claim.slice(c.span[1]);
  claim=claim.replace(/^\s*(\d+\.|[-*]|\|)\s*/,'').replace(/`[^`]*[\/:][^`]*`/g,m=>' '.repeat(m.length)).replace(/\[[ x]\]/g,'');
  const src=cites.map(c=>{const L=fs.readFileSync(c.file,'utf8').split(/\r?\n/);return L.slice(Math.max(0,c.a-1),c.b).join('\n');}).join('\n');
  for(const m of claim.matchAll(NUM)){const n1=m[1],n2=m[2],u=unitOf(m[3]);if(!u&&+n1<10&&!n2)continue;// bare small numbers (counts, ordinals) are too ambiguous
   checked++;const nums=[n1,n2].filter(Boolean);const miss=nums.filter(n=>!new RegExp('(?<![\\d.])'+n.replace('.','\\.')+'(?![\\d])').test(src));
   const loc=cites.map(c=>c.rel+':'+c.a+(c.b!==c.a?'-'+c.b:'')).join('、');
   // a computed number said to be computed (換算、÷ 2 …) is reported as derived, not as a mismatch
   const sent=claim.slice(Math.max(0,claim.lastIndexOf('。',m.index)+1),(claim.indexOf('。',m.index)+1||claim.length+1)-1);
   if(miss.length&&DERIVED.test(sent)){derived.push({line:i+1,quote:m[0].trim(),cited:cites.map(c=>c.rel+':'+c.a).join('、')});continue;}
   if(miss.length){findings.push({line:i+1,quote:m[0].trim(),kind:'not-in-source',cited:loc,text:'「'+m[0].trim()+'」的 '+miss.join('、')+' 不在引用的 '+loc+' 裡（原文沒有，或是換算／推論，要標明）'});continue;}
   // a single number that the source only has as one end of a range (22–28px) may be a different row of a table
   if(!n2){const occ=[...src.matchAll(new RegExp('(?<![\\d.])'+n1.replace('.','\\.')+'(?![\\d])','g'))];const inRange=o=>{const pre=src.slice(Math.max(0,o.index-8),o.index),post=src.slice(o.index+o[0].length,o.index+o[0].length+8);return /\d\s*[–~-]\s*$/.test(pre)||/^\s*[–~-]\s*\d/.test(post);};
    const rangeIn=o=>{const a=src.slice(Math.max(0,o.index-8),o.index+o[0].length+8).match(/(\d+(?:\.\d+)?)\s*[–~-]\s*(\d+(?:\.\d+)?)/);return a&&new RegExp(a[1]+'\\s*[–~-]\\s*'+a[2]).test(claim);};
    if(occ.length&&occ.every(inRange)&&!occ.some(rangeIn)&&!findings.some(f=>f.line===i+1&&f.quote===m[0].trim())){const o=occ[0],lineTxt=src.slice(src.lastIndexOf('\n',o.index)+1,(src.indexOf('\n',o.index)+1||src.length+1)-1).trim();findings.push({line:i+1,quote:m[0].trim(),kind:'range-end',severity:'check',cited:loc,text:'「'+m[0].trim()+'」在原文只出現在範圍裡（'+lineTxt.slice(0,70)+'），確認是不是同一項'});continue;}}
   if(u){// same number in the source must carry the same kind of unit
    const srcUnits=[...src.matchAll(new RegExp('(?<![\\d.])'+n1.replace('.','\\.')+'(?:\\s*[–~-]\\s*\\d+(?:\\.\\d+)?)?\\s*(px|pt|ms|%|in\\b|inch(?:es)?|吋|words?|字|characters?|chars?|pages?|頁|slides?|張|秒|seconds?|KB|MB|EMU|s\\b)?','gi'))].map(x=>unitOf(x[1])).filter(Boolean);
    if(srcUnits.length&&!srcUnits.includes(u))findings.push({line:i+1,quote:m[0].trim(),kind:'unit-mismatch',cited:loc,text:'「'+m[0].trim()+'」單位是 '+u+'，引用的 '+loc+' 寫的是 '+[...new Set(srcUnits)].join('、')});}}});
 return {file,checked,ok:!findings.some(f=>f.severity!=='check'),findings,derived};}
function findByName(base,name){let hit=null,n=0;const walk=d=>{if(hit||n++>20000)return;let es;try{es=fs.readdirSync(d,{withFileTypes:true});}catch{return;}for(const e of es){if(/^(node_modules|\.git|dist|build)$/.test(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.name===name){hit=p;return;}}};walk(base);return hit;}
// CLI: node scripts/check-quotes.mjs --map OS=/repo,WL=/other draft.md …
if(import.meta.url===`file://${process.argv[1]}`){const a=process.argv.slice(2);const mi=a.indexOf('--map');const map={};if(mi>=0){for(const kv of a[mi+1].split(',')){const [k,v]=kv.split('=');map[k]=v;}a.splice(mi,2);}
 const asJson=a.includes('--json');const files=a.filter(x=>x!=='--json');let bad=0;const all=[];
 for(const f of files){const r=checkQuotes(fs.readFileSync(f,'utf8'),{map,file:f});all.push(r);bad+=r.findings.filter(f=>f.severity!=='check').length;
  if(!asJson){console.log(f+'：核對 '+r.checked+' 個數字'+(r.findings.length?'，'+r.findings.length+' 個要看':'，都對得上')+(r.derived.length?'（另 '+r.derived.length+' 個是標明的換算，原文沒有）':''));for(const x of r.findings)console.log('  第 '+x.line+' 行 ['+({'unit-mismatch':'單位不同','range-end':'範圍的一端','not-in-source':'原文沒有'}[x.kind])+'] '+x.text);}}
 if(asJson)console.log(JSON.stringify(all,null,1));process.exitCode=bad?1:0;}
