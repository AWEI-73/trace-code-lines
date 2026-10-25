import {compareStopSites} from './stop-sites.mjs';
import {buildMaintenance,loadMaintenanceWater,renderMaintenanceMarkdown} from './maintenance.mjs';
// Offline source-bound health and on-demand flow reports; no target code execution.
import {renderHumanHealth,renderHumanFlow,validateMainFlow} from './report-html.mjs';
import fs from 'node:fs';
import path,{posix} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {tokens,writerCandidates} from './language-static.mjs';
import {readBounded,noLinks,sha256} from './walker.mjs';

export const headings=['\u7bc4\u570d\u8207\u7248\u672c','\u5165\u53e3','\u7d71\u8a08','\u65b7\u7dda','\u602a\u7570','\u53ea\u6709\u6e2c\u8a66\u5728\u7528','\u6c92\u4eba\u7528','\u5de5\u5177\u9650\u5236','\u53ef\u91cd\u8dd1\u547d\u4ee4'];
const names={broken:'\u65b7\u7dda',generated:'\u6253\u5305\u5f8c\u624d\u6709',redirect:'\u53ef\u80fd\u9760\u8f49\u5740\u63a5\u4e0a',nonproduction:'\u6b63\u5f0f\u7a0b\u5f0f\u4f9d\u8cf4\u975e\u6b63\u5f0f\u5340\u584a',testOnly:'\u53ea\u6709\u6e2c\u8a66\u5728\u7528',unused:'\u6c92\u4eba\u7528',limitation:'\u5de5\u5177\u9650\u5236'};
const marks={trace:'\u67e5\u7dda',comment:'\u8a3b\u89e3',document:'\u6587\u4ef6',inference:'\u63a8\u6e2c'};
const kinds=new Set(['production','prototype','experiment','plan','tools','tests','docs']);
const uniq=xs=>[...new Set(xs)],dedup=(xs,key)=>[...new Map(xs.map(x=>[key(x),x])).values()];
const loc=r=>(r.file??r.path??'.')+':'+(r.line??'UNKNOWN');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const md=s=>String(s??'').replace(/[|<>]/g,c=>({'|':'\\|','<':'&lt;','>':'&gt;'}[c])).replace(/\r?\n/g,'<br>');
export const programFile=p=>/\.(?:mjs|js|cjs|ts|tsx|gs|html|css|py)$/i.test(p)&&!/(?:^|\/)(?:[^/]*\.config|config)\.[^/]+$|(?:^|\/)[^/]*lock(?:\.[^/]+)?$/i.test(p);
const testFile=p=>/(?:^|\/)(?:tests?|__tests__)(?:\/|_)|[.](?:test|spec)[.]|(?:^|\/)test_[^/]+\.py$/.test(p);
function glob(s){
  if(typeof s!=='string'||s.startsWith('/')||s.split('/').includes('..')||s.includes('\\'))throw Error('blocks.match requires repo-relative globs');
  let out='^';for(let i=0;i<s.length;i++){
    if(s[i]==='*'){if(s[i+1]==='*'){i++;if(s[i+1]==='/'){i++;out+='(?:.*/)?';}else out+='.*';}else out+='[^/]*';}
    else if(s[i]==='?')out+='[^/]';else out+=s[i].replace(/[.*+?^\x24{}()|[\]\\]/g,'\\$&');
  }return new RegExp(out+'$');
}
const relativeSafe=p=>typeof p==='string'&&p!=='.'&&!posix.isAbsolute(p)&&!p.split('/').includes('..')&&!/[\\:\0]/.test(p);
function comments(source,py=false){
  const out=[];let i=0,line=1,codeSeen=false;
  while(i<source.length){
    const start=i,ln=line,c=source[i];
    if(c==='\n'){line++;i++;continue;}
    if(/\s/.test(c)){i++;continue;}
    if((py&&c==='#')||(!py&&source.slice(i,i+2)==='//')||(!py&&source.slice(i,i+2)==='/*')||source.slice(i,i+4)==='<!--'){
      const close=source.slice(i,i+4)==='<!--'?'-->':source.slice(i,i+2)==='/*'?'*/':null;
      if(close){const end=source.indexOf(close,i+(close==='-->'?4:2));i=end<0?source.length:end+close.length;}
      else {const end=source.indexOf('\n',i);i=end<0?source.length:end;}
      const text=source.slice(start,i);line+=(text.match(/\n/g)??[]).length;out.push({line:ln,endLine:line,text,header:!codeSeen});continue;
    }
    codeSeen=true;
    if(c==='"'||c==="'"||(!py&&c===String.fromCharCode(96))){
      const quote=py&&source.slice(i,i+3)===c.repeat(3)?c.repeat(3):c;i+=quote.length;
      while(i<source.length){if(source[i]==='\\'){if(source[i+1]==='\n')line++;i+=2;continue;}if(source.slice(i,i+quote.length)===quote){i+=quote.length;break;}if(source[i]==='\n')line++;i++;}
    }else i++;
  }return out;
}
function literalExpression(s){
  if(typeof s!=='string')return null;const t=tokens(s,false,{regexLiterals:true}).filter(t=>t.v!=='\n');
  if(t.length!==1||t[0].kind!=='string'||!t[0].literal)return null;
  return t[0].v.replace(/\\(['"\\])/g,'$1');
}
function sourceImports(file,body){
  const t=tokens(body,false,{regexLiterals:true}).filter(t=>t.v!=='\n'),out=[];
  for(let i=0;i<t.length;i++)if(t[i].kind==='string'&&t[i].literal&&t[i].v.startsWith('.')){
    const prev=t[i-1]?.v,before=t[i-2]?.v;
    if(prev==='from'||prev==='import'||prev==='('&&['import','require'].includes(before)){
      const target=posix.normalize(posix.join(posix.dirname(file),t[i].v));
      if(relativeSafe(target))out.push({file,line:t[i].line,target,specifier:t[i].v,source:'\u67e5\u7dda'});
    }
  }return out;
}
export function buildReport(inputs,config={},options={}){
  if(!inputs.length)throw Error('At least one derive-map required');
  const maps=inputs.map(x=>x.map??x),repo=maps[0].repo,head=maps[0].head,version=maps[0].toolVersion;
  for(const m of maps)if(m.repo!==repo||m.head!==head||m.toolVersion!==version||m.readOnly?.status!=='PASS'||!Array.isArray(m.closures))throw Error('Map scope/version/integrity mismatch');
  const roles=inputs.map(x=>x.role??'production');if(!roles.includes('production')||roles.some(r=>!['production','tests'].includes(r)))throw Error('Use production/tests map roles with at least one production');
  const inventory=uniq(maps.flatMap(m=>[...m.closures.flatMap(c=>c.files),...(m.zeroCoverageCandidates??[]).map(r=>r.path)])).sort(),inv=new Set(inventory);
  const production=new Set(maps.flatMap((m,i)=>roles[i]==='production'?m.closures.flatMap(c=>c.files):[]));
  const tests=new Set(maps.flatMap((m,i)=>roles[i]==='tests'?m.closures.flatMap(c=>c.files):[]));
  const limitations=[],cache=new Map(),read=options.read??(file=>readBounded(repo,file).toString('utf8'));
  const get=file=>{if(!inv.has(file)||!relativeSafe(file))throw Error('Source outside inventory: '+file);if(!cache.has(file))cache.set(file,String(read(file)));return cache.get(file);};
  const safeGet=file=>{try{return get(file);}catch(error){limitations.push({file,line:null,category:'limitation',source:'\u67e5\u7dda',reason:error.message});return null;}};
  const blocks=[],blockOf=new Map(),configured=(config.blocks??[]).map(b=>{
    if(!b.name||!kinds.has(b.kind)||!Array.isArray(b.match)||!b.match.length)throw Error('Invalid block');
    return {...b,patterns:b.match.map(glob)};
  });
  if(new Set(configured.map(b=>b.name)).size!==configured.length)throw Error('Duplicate block name');
  for(const b of configured)blocks.push({id:'m'+blocks.length,name:b.name,kind:b.kind,files:[],production:[],testOnly:[],unused:[],clues:[]});
  for(const file of inventory){
    let b=blocks[configured.findIndex(b=>b.patterns.some(re=>re.test(file)))];
    if(!b){const parts=file.split('/'),name=parts.length===1?'(root)':parts[0]==='src'&&parts.length>2?parts.slice(0,2).join('/'):parts[0];
      b=blocks.find(b=>b.defaultName===name);
      if(!b){b={id:'m'+blocks.length,name,defaultName:name,kind:/^(tests?|__tests__)$/.test(name)?'tests':name==='docs'?'docs':'production',files:[],production:[],testOnly:[],unused:[],clues:[]};blocks.push(b);}
    }b.files.push(file);blockOf.set(file,b);if(production.has(file))b.production.push(file);
  }
  const isTest=p=>testFile(p)||blockOf.get(p)?.kind==='tests';
  const testOnly=inventory.filter(p=>tests.has(p)&&!production.has(p)&&programFile(p)&&!isTest(p));
  const unused=inventory.filter(p=>!tests.has(p)&&!production.has(p)&&programFile(p)&&!isTest(p));
  for(const p of testOnly)blockOf.get(p).testOnly.push(p);for(const p of unused)blockOf.get(p).unused.push(p);
  const allEdges=dedup(maps.flatMap(m=>[...m.closures.flatMap(c=>c.edges??[]),...(m.gasAnalysis?.edges??[]),...(m.frameworkPathLoads?.edges??[])]),e=>JSON.stringify([e.kind,e.path,e.line,e.targets,e.specifier]));
  const prodEdges=allEdges.filter(e=>production.has(e.path));
  const gaps=dedup(maps.flatMap(m=>[...m.closures.flatMap(c=>c.gaps??[]),...(m.gasAnalysis?.gaps??[]),...(m.frameworkPathLoads?.gaps??[]),...(m.inventoryGaps??[])]),g=>g.gapId??JSON.stringify(g));
  const writers=dedup(maps.flatMap(m=>m.endpointTable?.endpoints??[]),w=>w.id??JSON.stringify(w));
  const scanned=new Set(maps.flatMap(m=>m.closures.flatMap(c=>c.files)));
  for(const file of inventory)if(!scanned.has(file)&&/\.(?:py|mjs|cjs|js|ts|tsx|jsx)$/.test(file)){
    const body=safeGet(file);if(body!==null)try{writers.push(...writerCandidates(file,body).map(w=>({...w,reportInventoryScan:true})));}catch(error){limitations.push({file,line:null,category:'limitation',source:'\u67e5\u7dda',reason:error.message});}
  }
  const imports=inventory.filter(p=>production.has(p)&&/\.(?:mjs|cjs|js|ts|tsx|gs)$/.test(p)).flatMap(file=>{const body=safeGet(file);return body===null?[]:sourceImports(file,body);});
  const findings=[],handled=new Set();
  const add=f=>findings.push({...f,source:'\u67e5\u7dda',locations:f.locations??[{file:f.file,line:f.line}],clues:[]});
  const classifyMissing=(site,target,gas=false,gapId)=>{
    if(!relativeSafe(target)){limitations.push({file:site.file,line:site.line,category:'limitation',source:'\u67e5\u7dda',reason:'\u4e0d\u652f\u63f4\u6216\u8d8a\u754c\u7684\u8def\u5f91\uff1a'+target});return;}
    const basename=posix.basename(target),same=inventory.filter(p=>posix.basename(p)===basename);
    const ws=writers.filter(w=>w.literalTarget&&(posix.normalize(w.literalTarget)===target||gas&&posix.basename(w.literalTarget)===basename));
    const refs=allEdges.filter(e=>e.kind==='DATA_READ'&&(e.targets??[]).some(p=>same.includes(p)));
    if(ws.length)add({...site,target,category:'generated',reason:'\u5b57\u9762\u76ee\u6a19\u4e0d\u5728\u5feb\u7167\uff1b\u627e\u5230\u5b57\u9762 writer \u5019\u9078\u3002',witnesses:ws.map(w=>({file:w.writer,line:w.line,target:w.literalTarget})),risk:'\u82e5\u90e8\u7f72\u8f38\u5165\u7f3a\u5c11\u7522\u751f\u6a94\uff0c\u8f09\u5165\u53ef\u80fd\u5931\u6557\u3002',advice:'\u6838\u5c0d\u6253\u5305\u8207\u90e8\u7f72\u6536\u64da\uff1b\u975c\u614b writer \u4e0d\u80fd\u8b49\u660e\u5df2\u7522\u6a94\u3002'});
    else if(same.length&&refs.length&&site.import)add({...site,target,category:'redirect',reason:'\u540c\u76ee\u9304 import \u76ee\u6a19\u7f3a\u5931\uff1b\u5225\u8655\u540c\u540d\u6a94\u6709\u5b57\u9762\u8b80\u5165\u5019\u9078\u3002',alternatives:same,witnesses:refs.map(e=>({file:e.path,line:e.line,targets:e.targets})),risk:'\u539f\u59cb import \u8207\u7d44\u88dd\u8def\u5f91\u4e0d\u540c\uff0c\u6539\u8def\u5f91\u6216\u7d44\u88dd\u9806\u5e8f\u53ef\u80fd\u4e2d\u65b7\u3002',advice:'\u6838\u5c0d\u7d44\u88dd\uff0f\u4f3a\u670d\u5668\u8def\u5f91\uff1b\u8a55\u4f30\u6539\u7528\u76f4\u63a5\u5f15\u7528\u6216\u660e\u78ba\u8a18\u9304\u3002'});
    else if(same.length){limitations.push({...site,category:'limitation',source:'\u67e5\u7dda',reason:'\u5b58\u5728\u540c\u540d\u66ff\u4ee3\u5019\u9078\u4f46\u6c92\u6709\u8db3\u5920\u63a5\u7dda\u8b49\u64da\uff1a'+same.join(', ')});}
    else add({...site,target,category:'broken',reason:'\u5b57\u9762\u76ee\u6a19\u4e0d\u5b58\u5728\uff0cinventory \u4e2d\u627e\u4e0d\u5230\u66ff\u4ee3\u4f86\u6e90\u6216\u5b57\u9762 writer\u3002',witnesses:[],risk:'\u82e5\u57f7\u884c\u5230\u9019\u500b\u4f9d\u8cf4\uff0c\u53ef\u80fd\u7121\u6cd5\u8f09\u5165\u3002',advice:'\u6838\u5c0d\u4f86\u6e90\u7248\u672c\u3001\u8def\u5f91\u8207\u751f\u6210\u898f\u5247\uff1b\u672c\u6b21\u4e0d\u4fee\u6539\u53d7\u67e5\u5c08\u6848\u3002'});
    if(gapId)handled.add(gapId);
  };
  for(const g of gaps){
    if(g.code==='CORE_PIN_CLOSURE_MISSING'){
      const sites=imports.filter(s=>s.target===g.path);if(sites.length){for(const s of sites)classifyMissing({...s,import:true},g.path,false,g.gapId);continue;}
    }
    if(production.has(g.path)&&g.code==='FRAMEWORK_PATH_LOAD_UNKNOWN'&&g.detail==='No existing inventory target'){
      const value=literalExpression(g.data?.expression);if(value!==null){const gas=/HtmlService|^include$/.test(g.data.call);classifyMissing({file:g.path,line:g.line},gas&&!/\.html$/i.test(value)?value+'.html':value,gas,g.gapId);continue;}
    }
    if(production.has(g.path)&&g.code==='DATA_READ_TARGET_UNKNOWN'){
      const value=literalExpression(g.data?.expression??g.data?.targetExpression);
      if(value!==null){classifyMissing({file:g.path,line:g.line},posix.normalize(value),false,g.gapId);continue;}
    }
    if(!handled.has(g.gapId))limitations.push({file:g.path,line:g.line??null,category:'limitation',source:'\u67e5\u7dda',reason:(g.code??'INVENTORY')+': '+g.detail,scope:production.has(g.path)?'production':'tests-or-inventory'});
  }
  for(const e of prodEdges)for(const target of e.targets??[]){
    const a=blockOf.get(e.path),b=blockOf.get(target);
    if(a?.kind==='production'&&['prototype','experiment','plan'].includes(b?.kind))add({file:e.path,line:e.line,target,category:'nonproduction',reason:'production \u5340\u584a\u5f15\u7528 '+b.kind+' \u5340\u584a\uff08'+e.kind+'\uff09\u3002',witnesses:[{file:target,line:null}],risk:'\u975e\u6b63\u5f0f\u5340\u584a\u82e5\u88ab\u6574\u7406\u6216\u66f4\u52d5\uff0c\u6b63\u5f0f\u8def\u7dda\u4e5f\u53ef\u80fd\u53d7\u5f71\u97ff\u3002',advice:'\u8a18\u9304\u5171\u7528\u95dc\u4fc2\u8207\u8cac\u4efb\uff1b\u8a55\u4f30\u7a69\u5b9a\u4ecb\u9762\u6216\u8abf\u6574\u6b78\u5c6c\u3002'});
  }
  const grouped=new Map();
  for(const f of findings){const key=JSON.stringify([f.category,f.file,f.target]);if(grouped.has(key)){const prev=grouped.get(key);prev.locations=dedup([...prev.locations,...f.locations],loc);}else grouped.set(key,f);}
  const issues=[...grouped.values()].sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line);
  function cluesFor(sites){
    const found=[];
    for(const site of dedup(sites,s=>loc(s))){const file=site.file;if(!inv.has(file)||!programFile(file)&&!file.endsWith('.md'))continue;const body=safeGet(file);if(body===null)continue;
      for(const c of comments(body,file.endsWith('.py')))if(c.header||Number.isInteger(site.line)&&c.line<=site.line+5&&c.endLine>=site.line-5)found.push({file,line:c.line,endLine:c.endLine,source:'\u8a3b\u89e3',text:c.text});
      const dir=posix.dirname(file);
      for(const doc of uniq([posix.join(dir,'README.md'),posix.join(posix.dirname(dir),'README.md')]))if(inv.has(doc)){
        const text=safeGet(doc);if(text===null)continue;const lines=text.split(/\r?\n/),heading=lines.findIndex(l=>/^#{1,6}\s+/.test(l));
        const start=lines.findIndex((l,i)=>i>heading&&l.trim()&&!/^#{1,6}\s+/.test(l)&&!l.startsWith(String.fromCharCode(96).repeat(3)));
        let end=start;if(start>=0)while(end<lines.length&&lines[end].trim()&&!/^#{1,6}\s+/.test(lines[end]))end++;
        if(heading>=0)found.push({file:doc,line:heading+1,source:'\u6587\u4ef6',text:lines[heading]});
        if(start>=0)found.push({file:doc,line:start+1,source:'\u6587\u4ef6',text:lines.slice(start,end).join('\n')});
      }
    }return dedup(found,c=>JSON.stringify([c.file,c.line,c.text]));
  }
  const rejectedNotes=[],notes=[];
  for(const note of config.notesData??[]){
    if(!note||typeof note.target!=='string'||typeof note.reason!=='string'||!Array.isArray(note.sources)||!note.sources.length){rejectedNotes.push({target:note?.target,reason:'Missing target/reason/sources'});continue;}
    const valid=note.sources.every(source=>{const m=String(source).match(/^(.*):([1-9]\d*)$/);if(!m||!inv.has(m[1]))return false;const body=safeGet(m[1]);return body!==null&&+m[2]<=body.split(/\r?\n/).length;});
    if(valid)notes.push({...note,source:'\u63a8\u6e2c'});else rejectedNotes.push({target:note.target,reason:'Source location is outside inventory or missing'});
  }
  for(const f of issues){f.id='issue-'+(issues.indexOf(f)+1);f.clues=cluesFor([...f.locations,...(f.witnesses??[]),...(inv.has(f.target)?[{file:f.target,line:null}]:[])]);f.notes=notes.filter(n=>f.locations.some(s=>loc(s)===n.target));}
  for(const b of blocks){
    b.programFiles=b.files.filter(programFile);
    b.clues=cluesFor(b.files.filter(programFile).map(file=>({file,line:null})));
    b.notes=notes.filter(n=>n.target===b.name);
    b.issueCount=issues.filter(f=>b.files.includes(f.file)).length;
  }
  const categoryGroups=[];
  for(const category of ['testOnly','unused'])for(const b of blocks)if(b[category].length)categoryGroups.push({category,block:b.name,blockId:b.id,files:b[category],source:'\u67e5\u7dda',file:b[category][0],line:null,clues:cluesFor(b[category].map(file=>({file,line:null}))),reason:category==='testOnly'?'\u53ea\u5728\u9078\u5b9a\u6e2c\u8a66\u9589\u5305\u51fa\u73fe\uff0c\u6b63\u5f0f\u9589\u5305\u672a\u6db5\u84cb\u3002':'\u6240\u6709\u9078\u5b9a\u5165\u53e3\u9589\u5305\u5747\u672a\u6db5\u84cb\uff1b\u9019\u4e0d\u662f\u6b7b\u78bc\u8b49\u660e\u3002',risk:'\u5165\u53e3\u9078\u64c7\u3001\u624b\u52d5\u4f7f\u7528\u6216\u52d5\u614b\u5f15\u7528\u53ef\u80fd\u672a\u88ab\u6db5\u84cb\u3002',advice:'\u4f9d\u5f15\u7528\u6f0f\u6597\u67e5\u8b49\uff1b\u4e0d\u64da\u6b64\u522a\u9664\u3002'});
  for(const m of maps)for(const reason of m.limitations??[])limitations.push({file:'.',line:null,category:'limitation',source:'\u67e5\u7dda',reason});
  for(const s of dedup(maps.flatMap(m=>m.dataReadComputedSamples??[]),s=>JSON.stringify([s.path,s.line])))limitations.push({file:s.path??s.file??'.',line:s.line??null,category:'limitation',source:'\u67e5\u7dda',reason:'DATA_READ_COMPUTED: '+(s.expression??s.detail??JSON.stringify(s))});
  const links=new Map();
  for(const e of allEdges)for(const target of e.targets??[]){
    const a=blockOf.get(e.path),b=blockOf.get(target);if(!a||!b||a===b)continue;
    const key=a.id+'>'+b.id;if(!links.has(key))links.set(key,{from:a.id,to:b.id,count:0,production:0});const link=links.get(key);link.count++;if(production.has(e.path))link.production++;
  }
  const stats={productionFiles:production.size,broken:issues.filter(f=>f.category==='broken').length,odd:issues.filter(f=>['generated','redirect','nonproduction'].includes(f.category)).length,testOnly:testOnly.length,unused:unused.length};
  const report={schema:'trace-health-v1',title:config.title??'\u67e5\u7dda\u5065\u6aa2',repo,commit:head,toolVersion:version,configurationSha256:config.configurationSha256??sha256(JSON.stringify(config)),inputs:inputs.map((x,i)=>({path:x.path??'map-'+i,role:roles[i],sha256:x.sha256??sha256(JSON.stringify(maps[i])),configurationSha256:maps[i].configurationSha256})),stats,
    conclusion:'\u6b63\u5f0f\u8def\u7dda '+stats.productionFiles+' \u6a94\uff0c\u5b57\u9762\u65b7\u7dda '+stats.broken+' \u8655\uff0c\u9700\u7559\u610f '+stats.odd+' \u8655\u3002\u9019\u662f\u975c\u614b\u67e5\u7dda\u7d50\u679c\uff0c\u5c1a\u672a\u9a57\u8b49\u57f7\u884c\u3002',
    roots:maps.flatMap((m,i)=>m.roots.map(r=>({...r,role:roles[i],file:r.path,line:null,category:'\u5165\u53e3',source:'\u67e5\u7dda'}))),
    blocks:blocks.filter(b=>b.programFiles.length||b.production.length),links:[...links.values()].filter(l=>blocks.find(b=>b.id===l.from).programFiles.length||blocks.find(b=>b.id===l.from).production.length).filter(l=>blocks.find(b=>b.id===l.to).programFiles.length||blocks.find(b=>b.id===l.to).production.length),issues,groups:categoryGroups,limitations:dedup(limitations,l=>JSON.stringify([l.file,l.line,l.reason])),rejectedNotes,commands:config.commands??[],sourceReads:[]};
  if(config.stopSites)report.stopSites=compareStopSites({root:repo,files:inventory,config:{...config.stopSites,comparisonCommands:config.commands?.map(c=>[c.bin,...c.args])??[]},read,routes:maps.flatMap((m,i)=>m.closures.map(c=>({...c,role:roles[i]}))),water:config.maintenanceWater});
  report.maintenance=buildMaintenance(report,{decisions:config.maintenanceDecisions??[],water:config.maintenanceWater,edges:allEdges,routes:maps.flatMap(m=>m.closures),rerunPrerequisites:config.maintenance?.rerunPrerequisites??[],read:get});
  if(report.maintenance.waterProvided)report.conclusion='\u5df2\u63a5\u5165\u8a66\u8dd1\u7d50\u679c\uff1b\u9010\u4ef6\u898b\u7dad\u4fee\u55ae\uff0c\u8dd1\u904e\u4e0d\u7b49\u65bc\u9a57\u6536\u901a\u904e\u3002';
  report.sourceReads=[...new Map([...cache].map(([file,body])=>({file,sha256:sha256(body)})).concat(report.stopSites?.sourceReads??[]).map(s=>[s.file,s])).values()];
  return report;
}
export function checkFlow(flow,map,read){
  validateMainFlow(flow);
  if(!flow||!Array.isArray(flow.steps)||!Array.isArray(flow.arrows))throw Error('flow.steps/arrows required');
  const closure=map.closures.find(c=>c.root===flow.routeRoot);if(!closure)throw Error('flow.routeRoot must select one map root');
  const files=new Set(closure.files),ids=new Set();
  for(const s of flow.steps){if(typeof s.id!=='string'||!s.id||ids.has(s.id)||typeof s.label!=='string'||!s.label||!Object.values(marks).includes(s.source))throw Error('Invalid flow step/id/source');ids.add(s.id);}
  for(const a of flow.arrows)if(!ids.has(a.from)||!ids.has(a.to)||typeof a.when!=='string'||!a.when.trim())throw Error('Invalid arrow endpoints/condition');
  const steps=flow.steps.map(s=>{
    const a=s.anchor??{},reasons=[];let actual=null;
    if(!files.has(a.file)||!relativeSafe(a.file))reasons.push('FILE_OUTSIDE_ROUTE');
    else try{const lines=String(read(a.file)).split(/\r?\n/);if(!Number.isInteger(a.line)||a.line<1||a.line>lines.length)reasons.push('LINE_MISSING');else actual=lines[a.line-1];}catch{reasons.push('FILE_UNREADABLE');}
    if(typeof a.expect!=='string'||!a.expect||actual!==null&&!actual.includes(a.expect))reasons.push('EXPECT_MISMATCH');
    return {...s,check:{status:reasons.length?'FAIL':'PASS',reasons,actual}};
  });
  return {...flow,repo:map.repo,commit:map.head,steps,status:steps.every(s=>s.check.status==='PASS')?'PASS':'FAIL',pass:steps.filter(s=>s.check.status==='PASS').length,fail:steps.filter(s=>s.check.status==='FAIL').length};
}

export const renderHealth=renderHumanHealth;
function itemMD(f){
  let out='- '+md((f.locations??[{file:f.file,line:f.line}]).map(loc).join('\u3001'))+' | \u985e\u5225\uff1a'+md(names[f.category]??f.category)+' | \u4f86\u6e90\uff1a'+md(f.source??'\u67e5\u7dda')+' | '+md(f.reason??f.target??'')+'\n';
  if(f.target)out+='  - \u76ee\u6a19\uff1a'+md(f.target)+'\n';
  if(f.witnesses?.length)out+='  - \u9023\u7dda\u8b49\u64da\uff1a'+f.witnesses.map(loc).map(md).join('\u3001')+' | \u4f86\u6e90\uff1a\u67e5\u7dda\n';
  if(f.risk)out+='  - \u98a8\u96aa\uff1a'+md(f.risk)+' \u5efa\u8b70\uff1a'+md(f.advice)+'\n';
  for(const c of f.clues??[])out+='  - '+md(loc(c))+' | \u985e\u5225\uff1a\u7dda\u7d22 | \u4f86\u6e90\uff1a'+c.source+' | '+md(c.text)+'\n';
  for(const n of f.notes??[])out+='  - '+md(n.target)+' | \u985e\u5225\uff1a\u63a8\u6e2c | \u4f86\u6e90\uff1a\u63a8\u6e2c | '+md(n.reason)+'\uff1b\u4f9d\u64da\uff1a'+n.sources.map(md).join('\u3001')+'\n';
  if(f.files)out+='\n<details><summary>'+md(f.block)+'\uff1a'+f.files.length+' \u6a94</summary>\n\n'+f.files.map(p=>'- '+md(p)+':UNKNOWN | \u985e\u5225\uff1a'+names[f.category]+' | \u4f86\u6e90\uff1a\u67e5\u7dda').join('\n')+'\n\n</details>\n';
  return out;
}
export function rebaseLinks(text,sourceFile,outputDirectory){
 return String(text).replace(/(!?\[[^\]]*\])\(([^)\s]+)(?:\s+"[^"]*")?\)/g,(whole,label,target)=>{
  if(/^(?:[a-z]+:|\/|#)/i.test(target))return whole;
  const [part,fragment]=target.split('#'),absolute=path.resolve(path.dirname(sourceFile),decodeURIComponent(part));
  if(!fs.existsSync(absolute))return label.slice(label.indexOf('[')+1,-1)+' (UNKNOWN: '+target+')';
  const rel=path.relative(outputDirectory,absolute).replaceAll('\\','/');
  return label+'('+rel.split('/').map(encodeURIComponent).join('/')+(fragment?'#'+fragment:'')+')';
 });
}
export function renderLegacyMarkdown(r,{outputDirectory}={}){
 if(outputDirectory){r=structuredClone(r);for(const row of [...r.issues,...r.groups,...r.limitations])for(const c of row.clues??[])c.text=rebaseLinks(c.text,path.resolve(r.repo,c.file),outputDirectory);}
  const section=(i,s)=>'## '+(i+1)+'. '+headings[i]+'\n\n'+s.trim()+'\n\n',fence=String.fromCharCode(96).repeat(3);
  const list=xs=>xs.length?xs.map(itemMD).join('\n'):'- .:UNKNOWN | \u985e\u5225\uff1a\u7121\u9805\u76ee | \u4f86\u6e90\uff1a\u67e5\u7dda | \u672c\u6b21\u6bcd\u9ad4\u70ba\u96f6\u3002';
  return '# '+r.title+'\n\n'+
    section(0,'- .:UNKNOWN | \u985e\u5225\uff1a\u7bc4\u570d | \u4f86\u6e90\uff1a\u67e5\u7dda | repo\uff1a'+md(r.repo)+'\uff1bcommit\uff1a'+r.commit+'\uff1b\u5de5\u5177\u7248\u672c\uff1a'+r.toolVersion+'\uff1b\u8a2d\u5b9a SHA-256\uff1a'+r.configurationSha256+'\n'+r.inputs.map(i=>'- '+md(i.path)+':UNKNOWN | \u985e\u5225\uff1a\u8f38\u5165 | \u4f86\u6e90\uff1a\u67e5\u7dda | '+i.role+'\uff1bmap sha\uff1a'+i.sha256+'\uff1b\u8a2d\u5b9a sha\uff1a'+i.configurationSha256).join('\n'))+
    section(1,r.roots.map(r=>'- '+md(loc(r))+' | \u985e\u5225\uff1a\u5165\u53e3 | \u4f86\u6e90\uff1a\u67e5\u7dda | '+r.role+'\uff1b'+md(r.reason)).join('\n'))+
    section(2,'| \u6307\u6a19 | \u6578\u503c | \u5b9a\u4f4d | \u985e\u5225 | \u4f86\u6e90 |\n|---|---:|---|---|---|\n'+Object.entries(r.stats).map(([k,v])=>'| '+k+' | '+v+' | .:UNKNOWN | \u7d71\u8a08 | \u67e5\u7dda |').join('\n')+'\n\n'+r.conclusion)+
    section(3,list(r.issues.filter(i=>i.category==='broken')))+section(4,list(r.issues.filter(i=>i.category!=='broken')))+
    section(5,list(r.groups.filter(i=>i.category==='testOnly')))+section(6,list(r.groups.filter(i=>i.category==='unused')))+
    section(7,list(r.limitations))+section(8,r.commands.length?r.commands.map(c=>'- '+md(c.file??'.')+':UNKNOWN | \u985e\u5225\uff1a\u91cd\u8dd1\u547d\u4ee4 | \u4f86\u6e90\uff1a\u67e5\u7dda\n\n'+fence+'text\n'+JSON.stringify(c)+'\n'+fence).join('\n\n'):'- .:UNKNOWN | \u985e\u5225\uff1a\u91cd\u8dd1\u547d\u4ee4 | \u4f86\u6e90\uff1a\u67e5\u7dda | \u672a\u63d0\u4f9b\u547d\u4ee4\u8a2d\u5b9a\uff1b\u4f7f\u7528\u539f derive-map command\u3002');
}
export function renderMarkdown(r,options={}){
 const sheet=r.maintenance??buildMaintenance(r);
 return renderMaintenanceMarkdown(sheet)+'\n[\u5b8c\u6574\u6280\u8853\u8cc7\u6599](health.json)\n';
}
export const renderFlow=renderHumanFlow;
export function writeUTF8(file,body){
  const eol=fs.existsSync(file)&&fs.readFileSync(file,'utf8').includes('\r\n')?'\r\n':'\n';
  body=body.replace(/\r?\n/g,eol);fs.writeFileSync(file,body,'utf8');
  const actual=fs.readFileSync(file,'utf8');if(actual!==body)throw Error('UTF8 readback mismatch');
  return {file,sha256:sha256(actual),cjk:(actual.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)??[]).length,questionMarks:(actual.match(/\?/g)??[]).length,replacementCharacters:(actual.match(/\ufffd/g)??[]).length,cr:(actual.match(/\r/g)??[]).length};
}
function inside(base,p){const r=path.relative(base,p);return r===''||!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);}
export function runReport(configFile){
  const absolute=path.resolve(configFile),raw=fs.readFileSync(absolute,'utf8'),config=JSON.parse(raw),base=path.dirname(absolute);
  const inputs=(config.maps??[]).map(x=>{const p=path.resolve(base,x.path),bytes=fs.readFileSync(p);return {...x,path:p,sha256:sha256(bytes),map:JSON.parse(bytes)};});
  if(!inputs.length)throw Error('maps required');
  const repo=noLinks(path.resolve(inputs[0].map.repo)),out=noLinks(path.resolve(base,config.outDir??'report'));
  const outputs=['health.html','report.md','health.json','report-receipt.json',...(config.flow?['flow.html','flow-checked.json']:[])].map(f=>path.join(out,f));
  const inputPaths=[absolute,...inputs.map(i=>i.path),...[config.notes,config.flow,config.maintenance?.decisions].filter(Boolean).map(p=>path.resolve(base,p)),...(config.maintenance?.waterSources??[]).flatMap(x=>[x.report,x.config,x.snapshot].map(r=>path.resolve(base,r.path)))];
  if(inside(repo,out)||outputs.some(p=>inputPaths.some(i=>path.resolve(p)===path.resolve(i))))throw Error('Output overlaps source/input');
  for(const p of outputs)noLinks(p);
  const git=args=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},windowsHide:true});
  const head=git(['rev-parse','HEAD']).trim(),status=git(['status','--porcelain']);if(status||inputs.some(i=>i.map.head!==head))throw Error('Source snapshot changed');
  if(config.notes)config.notesData=JSON.parse(fs.readFileSync(path.resolve(base,config.notes),'utf8'));
  config.configurationSha256=sha256(raw);config.commands=[...inputs.map(i=>i.map.command),{bin:process.execPath,args:[process.argv[1],'--config',absolute]}];
  const maintenance=config.maintenance??{};
  if(maintenance.decisions)config.maintenanceDecisions=JSON.parse(fs.readFileSync(noLinks(path.resolve(base,maintenance.decisions)),'utf8'));
  config.maintenanceWater=loadMaintenanceWater(maintenance.waterSources,base,repo);
  const report=buildReport(inputs,config);
  let flow;
  if(config.flow){const value=JSON.parse(fs.readFileSync(path.resolve(base,config.flow),'utf8'));const sourceMap=inputs.find(i=>i.role!=='tests'&&i.map.closures.some(c=>c.root===value.routeRoot))?.map;if(!sourceMap)throw Error('Flow root is not a production route');flow=checkFlow(value,sourceMap,p=>readBounded(repo,p).toString('utf8'));}
  for(const row of report.sourceReads)if(sha256(readBounded(repo,row.file))!==row.sha256)throw Error('Source changed during report');
  if(git(['rev-parse','HEAD']).trim()!==head||git(['status','--porcelain'])!==status)throw Error('Source integrity changed');
  fs.mkdirSync(out,{recursive:true});const receipts=[];
  for(const e of config.maintenanceWater.evidence??[]){const dir=noLinks(path.join(out,'evidence'));if(inside(repo,dir)||inputPaths.some(p=>inside(dir,p)))throw Error('Evidence overlaps source/input');fs.mkdirSync(dir,{recursive:true});const p=noLinks(path.join(dir,e.id+'.json'));receipts.push(writeUTF8(p,JSON.stringify(e.payload,null,2)+'\n'));}
  receipts.push(writeUTF8(path.join(out,'health.html'),renderHealth(report)),writeUTF8(path.join(out,'report.md'),renderMarkdown(report,{outputDirectory:out})),writeUTF8(path.join(out,'health.json'),JSON.stringify(report,null,2)+'\n'));
  if(flow)receipts.push(writeUTF8(path.join(out,'flow.html'),renderFlow(flow)),writeUTF8(path.join(out,'flow-checked.json'),JSON.stringify(flow,null,2)+'\n'));
  writeUTF8(path.join(out,'report-receipt.json'),JSON.stringify({status:'PASS',sourceReadback:'PASS',head,stats:report.stats,flow:flow?{status:flow.status,pass:flow.pass,fail:flow.fail}:null,outputs:receipts},null,2)+'\n');
  return {stats:report.stats,flow:flow?.status,outputs:receipts.map(r=>r.file)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{const args=process.argv.slice(2);if(args.length===1&&args[0]==='--help')console.log('Usage: node report.mjs --config report-config.json');
    else{if(args.length!==2||args[0]!=='--config')throw Error('Usage: node report.mjs --config report-config.json');console.log(JSON.stringify(runReport(args[1])));}
  }catch(error){console.error(JSON.stringify({status:'ERROR',message:error.message}));process.exitCode=1;}
}
