// 「目標系統已有／缺口」: before saying a tool fills a gap, look in the system you want to wire it into
// for something that already does the same job. Read-only text search; every hit is file:line evidence.
//   has     = a module/function named for the job (docx-text.mjs, pdfToText, exportPptx …) or a known library for it (PptxGenJS)
//   partial = it only accepts / mentions the format (sourceExtensions: ['.pdf'], docs, retired code)
//   gap     = nothing found (still a search result, not proof)
import fs from 'node:fs';
import path from 'node:path';
const SKIP=/(^|\/)(node_modules|\.git|\.venv|venv|__pycache__|dist|build|coverage|vendor|third_party|site-packages|\.next|out)(\/|$)/;
const TESTY=/(^|\/)(tests?|__tests__|fixtures?|spec|e2e|examples?)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$/;
const RETIRED=/(^|\/)(history|retired|archive|deprecated|legacy)[^/]*(\/|$)/i;
const CODE=/\.(m?js|cjs|ts|tsx|jsx|py)$/,DECL=/\.(json|ya?ml|toml)$/,DOC=/\.(md|rst)$/;
const VERB='text|txt|md|markdown|convert|converter|extract|parse|reader|read|render|export|import|to|from|loader|load|writer|write|ingest|intake';
// Well-known libraries that do the job: using one counts as having it (a system that drives PptxGenJS can already produce .pptx).
const LIBS={pptx:{r:['python-pptx','pptx2json','officeparser'],w:['pptxgenjs','python-pptx','pptx-automizer']},pdf:{r:['pdfjs-dist','pdf-parse','pypdf','pdfminer','pdfplumber','unpdf'],w:['pdf-lib','pdfkit','printToPDF','reportlab','weasyprint']},
 docx:{r:['mammoth','docx4js','python-docx'],w:['docxtemplater','python-docx']},xlsx:{r:['exceljs','sheetjs','openpyxl'],w:['exceljs','sheetjs','openpyxl']},html:{r:['turndown','html-to-text','markdownify'],w:[]},epub:{r:['epubjs','ebooklib'],w:['epub-gen']},csv:{r:['csv-parse','papaparse','csvtojson'],w:['csv-stringify']}};
const VERB_R='text|txt|md|markdown|convert|converter|extract|parse|parser|reader|read|import|to|from|loader|load|ingest|intake';
const VERB_W='export|exporter|writer|write|build|builder|render|generate|make|compose|from|to';
// which way the question needs a format: "給它一份 PDF" = read it, "匯出 PDF / 產出 PPTX" = write it
export function directionOf(term,question=''){return new RegExp('(匯出|導出|產出|輸出|生成|做成|存成|export|generate|output)[^，。？?；]{0,14}'+term,'i').test(question)?'w':'r';}
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
import {spawnSync} from 'node:child_process';
// tracked files when it is a git repo (skips scratch copies like .tmp/), else a walk without dot folders
function files(root,cap=8000){const g=spawnSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8',maxBuffer:64*1024*1024});
 if(g.status===0&&g.stdout)return g.stdout.split('\0').filter(r=>r&&!SKIP.test(r)&&(CODE.test(r)||DECL.test(r)||DOC.test(r))).slice(0,cap);
 const out=[];const walk=(d,rel)=>{if(out.length>=cap)return;let es;try{es=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
 for(const x of es){const r=rel?rel+'/'+x.name:x.name;if(SKIP.test(r)||x.name.startsWith('.'))continue;if(x.isDirectory())walk(path.join(d,x.name),r);else if(CODE.test(x.name)||DECL.test(x.name)||DOC.test(x.name))out.push(r);}};walk(root,'');return out;}
export function targetHas(target,terms,{name=null,packages=[],question=''}={}){
 target=path.resolve(target);const list=files(target).filter(f=>!/(^|\/)[0-9a-f]{32,}\.json$/i.test(f)),uniq=[...new Set(terms.map(t=>t.toLowerCase()).filter(t=>/^[a-z0-9]{2,}$/.test(t)))].slice(0,16);
 const rows=uniq.map(term=>{const ev=[];const t=esc(term);const dir=FORMAT.has(term)?directionOf(term,question):'rw',VERB=dir==='w'?VERB_W:dir==='r'?VERB_R:VERB_R+'|'+VERB_W;
  const nameRe=new RegExp('(^|[^a-z])'+t+'([-_.]?('+VERB+'))|('+VERB+')[-_.]?'+t+'([^a-z]|$)','i');
  const symRe=new RegExp('\\b(function|const|let|class|def|export\\s+(const|function|class))\\s+\\w*('+t+'(?:'+VERB+')|(?:'+VERB+')'+t+')\\w*','i');
  const idRe=new RegExp("\\bid\\s*:\\s*['\"][\\w-]*"+t+"[\\w-]*['\"]",'i');
  const libL=LIBS[term]?(dir==='w'?LIBS[term].w:dir==='r'?LIBS[term].r:[...LIBS[term].r,...LIBS[term].w]):[];const libRe=libL.length?new RegExp('('+libL.map(x=>esc(x).replace(/-/g,'[-_]?')).join('|')+')','i'):null;
  const accRe=new RegExp("['\"]\\.?"+t+"['\"]",'i');
  for(const f of list){const low=f.toLowerCase(),weak=TESTY.test(f)||RETIRED.test(f);let body;try{const st=fs.statSync(path.join(target,f));if(st.size>600000)continue;body=fs.readFileSync(path.join(target,f),'utf8');}catch{continue;}
   if(!body.toLowerCase().includes(term)&&!(libRe&&libRe.test(body)))continue;const lines=body.split(/\r?\n/);
   if(CODE.test(f)&&nameRe.test(path.basename(low)))ev.push({kind:weak?'weak':'module',file:f,line:1,text:path.basename(f)});
   lines.forEach((l,i)=>{if(ev.length>40)return;
    if(CODE.test(f)&&(symRe.test(l)||idRe.test(l)))ev.push({kind:weak?'weak':'symbol',file:f,line:i+1,text:l.trim().slice(0,120)});
    else if(libRe&&CODE.test(f)&&libRe.test(l)&&/require|import|from|new\s|Module|\.launch|printToPDF/.test(l))ev.push({kind:weak?'weak':'library',file:f,line:i+1,text:l.trim().slice(0,120)});
    else if(FORMAT.has(term)&&dir!=='w'&&(CODE.test(f)||DECL.test(f))&&accRe.test(l)&&/extension|accept|format|source|mime|input|type/i.test(l))ev.push({kind:'accepts',file:f,line:i+1,text:l.trim().slice(0,120),weak});
    else if(DOC.test(f)&&!weak&&new RegExp('\\b'+t+'\\b','i').test(l)&&/\b(convert|extract|reads?|reading|parse|import|export)\w*|轉|讀|匯入|匯出|輸出/i.test(l))ev.push({kind:'doc',file:f,line:i+1,text:l.trim().slice(0,120)});});}
  const strong=ev.filter(e=>e.kind==='module'||e.kind==='symbol'||e.kind==='library'),acc=ev.filter(e=>e.kind==='accepts'&&!e.weak),doc=ev.filter(e=>e.kind==='doc');
  const status=strong.length?'has':acc.length||doc.length?'partial':'gap';
  const pick=[...strong.sort((a,b)=>(/^docs?\//.test(a.file)-/^docs?\//.test(b.file))||(a.kind!=='module')-(b.kind!=='module')),...acc,...doc].slice(0,3);
  return {term,dir,status,evidence:pick,counts:{strong:strong.length,accepts:acc.length,docs:doc.length,weak:ev.filter(e=>e.kind==='weak'||e.weak).length}};});
 // the target already depends on this tool (any of its package names in a package.json / pyproject / requirements)
 const uses=[];if(packages.length)for(const f of list.filter(f=>/(^|\/)(package\.json|pyproject\.toml|requirements[^/]*\.txt)$/.test(f))){let b;try{b=fs.readFileSync(path.join(target,f),'utf8');}catch{continue;}
  b.split(/\r?\n/).forEach((l,i)=>{for(const n of packages){const m=l.match(new RegExp('["\']?'+esc(n)+'["\']?\\s*[:=<>~^]+\\s*["\']?([\\w.^~*-]+)'));if(m&&!/"name"\s*:/.test(l))uses.push({name:n,version:m[1],file:f,line:i+1,weak:TESTY.test(f)||RETIRED.test(f)});}});}
 return {target:name??path.basename(target),searched:list.length,rows,uses:uses.filter(u=>!u.weak).slice(0,8),has:rows.filter(r=>r.status==='has').map(r=>r.term),partial:rows.filter(r=>r.status==='partial').map(r=>r.term),gap:rows.filter(r=>r.status==='gap').map(r=>r.term),
  note:'文字搜尋，不是執行；「有」= 目標系統有以這個格式／工作命名的模組或函式，或用了做這件事的知名套件，「部分」= 只看到接受或文件提到，「缺口」= 沒找到（不等於確定沒有）。'};
}
// Terms worth checking: the question's format/work words + what the tool itself handles (XConverter classes, export targets).
const FORMAT=new Set(['docx','doc','pdf','pptx','ppt','xlsx','xls','html','csv','json','epub','zip','ipynb','msg','rss','image','audio','markdown','md','odt','rtf','svg','png']);
export function toolTerms(g,question=''){const t=new Set();
 for(const w of question.toLowerCase().replace(/[\w-]+\.(json|md|ya?ml|toml|lock|js|ts|mjs)\b/g,' ').match(/[a-z][a-z0-9]{1,}/g)??[])if(FORMAT.has(w)&&!/^(markdown|md)$/.test(w)||/^(slide|slides|deck|codemod|template|scaffold|theme|component|export)s?$/.test(w))t.add(w.replace(/s$/,'')==='slide'?'slide':w);
 for(const f of g?.files?.values()??[])for(const u of f.units.values()){const m=u.cls&&u.name===u.cls&&/^_?([A-Z][a-z]+)(Converter|Exporter|Reader|Loader)$/.exec(u.cls);if(m&&FORMAT.has(m[1].toLowerCase())&&!/^(markdown|md)$/i.test(m[1]))t.add(m[1].toLowerCase());}
 for(const [re,w] of [[/匯出|導出/,'export'],[/簡報|投影片/,'slide'],[/模板|範本/,'template'],[/元件/,'component'],[/主題/,'theme'],[/改原碼|codemod/i,'codemod'],[/腳手架|scaffold/i,'scaffold']])if(re.test(question))t.add(w);
 return [...t];}
