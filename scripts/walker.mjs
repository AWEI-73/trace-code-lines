import {gapList} from './gap-shape.mjs';
import {buildFrameworkGraph} from './gas-framework.mjs';
// Preserved MAP-2 loop and bounded path/read helpers; see references/provenance.md.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {resolve,dirname,isAbsolute,posix} from 'node:path';
import {isBuiltin} from 'node:module';
import {languageEdges,jsSupplementalEdges,tokens} from './language-static.mjs';
import {jsResolver} from './js-resolution.mjs';
import {jsDataReadEdges,dataReadCodeFile} from './js-data-reads.mjs';
export const sha256=b=>createHash('sha256').update(b).digest('hex');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
export function safeName(name){
  if(typeof name!=='string'||!name||isAbsolute(name)||/[\\:<>"|?*\x00-\x1f]/.test(name)||name.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))fail('UNSAFE_REFERENCE','Use a regular package-relative path');
  return name;
}
export function noLinks(path){
  let p=resolve(path);
  while(true){try{if(lstatSync(p).isSymbolicLink())fail('SYMLINK_REFERENCE','Links are not package evidence');}catch(e){if(e.code!=='ENOENT')throw e;}const parent=dirname(p);if(parent===p)break;p=parent;}
  return resolve(path);
}
export function readBounded(root,name,limit=8*1024*1024){
  safeName(name);const path=resolve(root,name);noLinks(path);const stat=lstatSync(path);
  if(!stat.isFile()||stat.size>limit)fail('UNBOUNDED_FILE','Evidence must be a bounded regular file');
  return readFileSync(path);
}

// Only literal/PSScriptRoot paths; bounded nested Join-Path, never PowerShell execution.
function powerShellPath(text,file){
  let at=0,joins=0;
  const ws=()=>{while(/\s/.test(text[at]??'')&&at<text.length)at++;};
  const word=s=>{ws();if(text.slice(at,at+s.length).toLowerCase()!==s.toLowerCase())throw Error('Unknown path syntax');at+=s.length;};
  function expr(){
    ws();if(text[at]==='('){at++;const value=expr();word(')');return value;}
    if(text.slice(at,at+13).toLowerCase()==='$psscriptroot'){at+=13;return posix.dirname(file);}
    if(["'",'"'].includes(text[at])){
      const q=text[at++],start=at;while(at<text.length&&text[at]!==q)at++;
      if(at===text.length)throw Error('Unclosed literal');
      const value=text.slice(start,at++).replaceAll('\\','/');
      if(!value||/[$\x60]/.test(value)||/^(?:[A-Za-z]:|\/)/.test(value))throw Error('Computed/absolute path');
      return value;
    }
    word('Join-Path');if(++joins>2)throw Error('Join depth');
    const named=new Map(),positional=[];
    while(true){
      ws();if(at>=text.length||text[at]===')')break;
      const parameter=text.slice(at).match(/^-(Path|ChildPath|AdditionalChildPath)\b/i);
      if(parameter){
        at+=parameter[0].length;const key=parameter[1].toLowerCase();if(named.has(key))throw Error('Duplicate parameter');
        const values=[expr()];ws();
        if(key==='additionalchildpath')while(text[at]===','){at++;values.push(expr());ws();}
        named.set(key,values);
      }else positional.push(expr());
    }
    const base=named.get('path')?.[0]??positional.shift(),child=named.get('childpath')?.[0]??positional.shift();
    if(base===undefined||child===undefined)throw Error('Path and ChildPath required');
    return posix.normalize(posix.join(base,child,...positional,...(named.get('additionalchildpath')??[])));
  }
  try{const value=expr();if(!joins||(text[at]&&!/\s/.test(text[at])))return null;return value;}catch{return null;}
}

export function textReferences(path,source,rows,sourceRoots=['.','src']){
  const edges=[],gaps=gapList();
  for(const [index,line] of source.split(/\r?\n/).entries()){
    const commands=/(?:^|[\s`;&|:])((?:node|python3?|uv)(?:\.exe)?)\s+([^`;&|\r\n]+)/g;
    for(const match of line.matchAll(commands)){
      if(path.endsWith('.ps1')&&/^\s*\(?\s*Join-Path\b/i.test(match[2])){
        const value=powerShellPath(match[2],path),targets=value&&!value.startsWith('../')&&value!=='..'&&!posix.isAbsolute(value)&&!value.includes(':')&&rows.has(value)?[value]:[];
        if(targets.length)edges.push({kind:'TEXT_REFERENCE',path,line:index+1,specifier:match[2].trim(),targets,basis:/\$PSScriptRoot/i.test(match[2])?'PSSCRIPTROOT_LITERAL':'TEXT_LITERAL',candidate:true,runtimeVerified:false});
        else gaps.push({code:value?'TEXT_REFERENCE_UNRESOLVED':'TEXT_REFERENCE_COMPUTED',path,line:index+1,detail:line.trim()});
        continue;
      }
      const args=match[2].match(/"[^"]*"|'[^']*'|[^\s]+/g)??[];
      let executable=match[1].replace(/\.exe$/,''),at=0,module=false;
      if(executable==='uv'){
        if(args[at++]!=='run')continue;
        if(/^(?:python3?|node)$/.test(args[at]??''))executable=args[at++];
      }
      while(['-u','-B','-I','--'].includes(args[at]))at++;
      if(args[at]==='-m'){module=true;at++;}
      const raw=args[at]??'',value=raw.replace(/^['"]|['"]$/g,'').replaceAll('\\','/');
      const gap=code=>gaps.push({code,path,line:index+1,detail:line.trim()});
      if(!value||/[$%{}()*+]/.test(value)||value.startsWith('-')||(!/^['"]/.test(raw)&&/[\[\]]/.test(value))){gap('TEXT_REFERENCE_COMPUTED');continue;}
      let candidates;
      if(module){
        if(!/^[A-Za-z_]\w*(?:\.\w+)*$/.test(value)){gap('TEXT_REFERENCE_COMPUTED');continue;}
        candidates=sourceRoots.flatMap(r=>[posix.join(r,value.replaceAll('.','/')+'.py'),posix.join(r,value.replaceAll('.','/'),'__main__.py')]);
      }else candidates=[posix.normalize(value),posix.normalize(posix.join(posix.dirname(path),value))];
      const targets=[...new Set(candidates)].filter(p=>!p.startsWith('../')&&p!=='..'&&!posix.isAbsolute(p)&&!p.includes(':')&&rows.has(p));
      if(!targets.length){gap('TEXT_REFERENCE_UNRESOLVED');continue;}
      edges.push({kind:'TEXT_REFERENCE',path,line:index+1,specifier:value,targets,basis:'TEXT_LITERAL',candidate:true,runtimeVerified:false});
    }
  }
  if(!edges.length)gaps.push({code:'UNSUPPORTED_LANGUAGE_ROOT_ONLY',path,detail:'No existing literal command target extracted.'});
  return {edges,gaps,targets:[...new Set(edges.flatMap(e=>e.targets))]};
}

export function walk(coreRoot,roots,rows,options={}){
  options.progress?.('walk: starting '+roots.join(', '));
  const read=options.read??(name=>readBounded(coreRoot,name));
  const frameworkGraph=options.frameworkGraph??buildFrameworkGraph(rows,read,options);
  const pending=[...roots],gaps=gapList(),files=[],edges=[],external=[],seen=new Set(),dataReadFiles=new Set(),dataReadComputedSamples=[];let total=0,dataReadComputed=0;
  const gap=(code,path,detail)=>gaps.push({code,path,detail});
// BEGIN PRESERVED LOOP
  while(pending.length){
    const path=pending.pop();if(seen.has(path))continue;seen.add(path);
    if(!rows.has(path)){gap('CORE_PIN_CLOSURE_MISSING',path,'Static reader dependency is absent from the pin');continue;}
    let bytes;try{bytes=read(path);}catch{gap('CORE_PIN_FILE_UNREADABLE',path,'Pinned reader is not a readable bounded regular file');continue;}
    total+=bytes.length;if(total>16*1024*1024){gap('CORE_PIN_SIZE',path,'Reader closure exceeds 16 MiB');break;}
    const actual=sha256(bytes),expected=rows.get(path).sha256;files.push({path,expectedSha256:expected,actualSha256:actual});
    if(actual!==expected)gap('CORE_PIN_STALE',path,'Reader bytes changed without the matching pin update');
    const framework=frameworkGraph.byPath.get(path);
    if(framework){gaps.push(...framework.gaps.map(g=>({...g,legacyIds:{...g.legacyIds}})));edges.push(...framework.edges);pending.push(...framework.edges.flatMap(e=>e.targets));}
    if(/\.html?$/i.test(path)){
 const source=bytes.toString('utf8').replace(/<!--[\s\S]*?-->/g,m=>m.replace(/[^\n]/g,' '));
 for(const match of source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)){
  const spec=match[1],line=source.slice(0,match.index).split('\n').length;
  if(/^(?:https?:|\/\/|data:)/i.test(spec)){external.push({kind:'HTML_SCRIPT_SRC',path,line,specifier:spec,classification:'EXTERNAL_RESOURCE'});continue;}
  const target=posix.normalize(posix.join(posix.dirname(path),spec.split(/[?#]/)[0]));
  if(spec.startsWith('/')||target.startsWith('../')){gap('HTML_SCRIPT_UNSAFE',path,spec);continue;}
  const found=rows.has(target);edges.push({kind:'HTML_SCRIPT_SRC',path,line,specifier:spec,targets:found?[target]:[]});
  if(found)pending.push(target);else gap('HTML_SCRIPT_MISSING',path,spec);
 }
}
if(/\.(?:md|ps1|sh|yml|yaml)$/.test(path)){
      const parsed=textReferences(path,bytes.toString('utf8'),rows,options.pythonSourceRoots??['.','src']);
      gaps.push(...parsed.gaps);edges.push(...parsed.edges);pending.push(...parsed.targets);continue;
    }
    if(/\.(?:py|cjs|mjs|js|ts|tsx|jsx|mts|cts|gs)$/.test(path)) {
      const key=path+':'+actual;
      const parsed=options.parserCache?.get(key)??languageEdges(path,bytes.toString('utf8'),{rows,resolutionCache:options.resolutionCache,read:p=>read(p).toString('utf8'),sourceRoots:options.pythonSourceRoots??['.','src']});
      options.parserCache?.set(key,parsed);
      gaps.push(...parsed.gaps);edges.push(...parsed.edges);external.push(...parsed.external);pending.push(...parsed.targets);
    }
    if(/\.(?:cjs|mjs|js|ts|tsx|jsx|mts|cts|gs)$/.test(path))
      for(const edge of jsSupplementalEdges(path,bytes.toString('utf8'),rows,p=>read(p).toString('utf8'),options.resolutionCache).edges)
        if(edge.kind==='DYNAMIC_IMPORT'&&edge.exists&&edge.literalPath===true)
          for(const target of edge.targets){try{safeName(target);pending.push(target);}catch{}}
    let contentReads={edges:[],gaps:[],readRanges:[]};
    if(/\.(?:cjs|mjs|js|ts|tsx|jsx|mts|cts|gs)$/.test(path)){
      contentReads=jsDataReadEdges(path,bytes.toString('utf8'),rows);
      gaps.push(...contentReads.gaps);edges.push(...contentReads.edges);
      dataReadComputed+=contentReads.dataReadComputed;
      dataReadComputedSamples.push(...contentReads.dataReadComputedSamples.slice(0,20-dataReadComputedSamples.length));
      for(const edge of contentReads.edges)for(const target of edge.targets)if(dataReadCodeFile(target)){
        try{safeName(target);dataReadFiles.add(target);pending.push(target);}catch{}
      }
    }
    if(path.endsWith('.py'))continue;
    if(/\.(?:cjs|mjs|js|ts|tsx|jsx|mts|cts|gs)$/.test(path)){
      const source=bytes.toString('utf8'),ts=/\.(?:ts|tsx|jsx|mts|cts)$/.test(path),resolver=jsResolver(path,rows,p=>read(p).toString('utf8'),options.resolutionCache);
      if(ts)for(const issue of resolver.issues)gaps.push({code:'TS_RESOLUTION_UNSUPPORTED',path,line:null,detail:issue.reason,data:issue,legacyIds:{'1.11.0':null}});
      const t=tokens(source,false,{regexLiterals:true});
      for(let i=0;i<t.length;i++){
        if(t[i].kind!=='name'||!['import','export'].includes(t[i].v)||t[i-1]?.v==='.'||['(','.'].includes(t[i+1]?.v))continue;
        let spec=t[i+1]?.kind==='string'?t[i+1]:null;
        if(!spec)for(let j=i+1;j<t.length;j++){
          if(t[j].v===';'||['import','export'].includes(t[j].v)||['const','let','function','class','interface'].includes(t[j].v))break;
          if(t[j].v==='from'&&t[j+1]?.kind==='string'){spec=t[j+1];break;}
        }
        if(!spec?.literal||isBuiltin(spec.v))continue;
        const r=resolver.resolve(spec.v);
        if(!r.local){if(!ts)gap('CORE_PIN_UNSUPPORTED_IMPORT',path,'A static import is not a Node builtin or relative module');continue;}
        if(r.unsafe){gap(ts?'TS_RESOLUTION_UNSUPPORTED':'CORE_PIN_UNSAFE_IMPORT',path,'Static reader import escapes the checked source root');continue;}
        if(!r.target){
          if(ts)gaps.push({code:'TS_RESOLUTION_UNSUPPORTED',path,line:t[i].line,detail:spec.v,legacyIds:{'1.11.0':null}});
          else {try{safeName(r.base);pending.push(r.base);}catch{gap('CORE_PIN_UNSAFE_IMPORT',path,'Static reader import escapes the checked source root');}}
          continue;
        }
        const target=r.target;pending.push(target);
        if(!edges.some(e=>e.kind==='STATIC_IMPORT'&&e.path===path&&e.line===t[i].line&&e.targets.includes(target)))
          edges.push({kind:'STATIC_IMPORT',path,line:t[i].line,specifier:spec.v,targets:[target],...(!spec.v.startsWith('.')||posix.normalize(posix.join(posix.dirname(path),spec.v))!==target?{introducedIn:'1.12.0'}:{}),...(t[i+1]?.v==='type'?{typeOnly:true}:{})});
      }
    }
    // Module-relative JSON read through new URL(..., import.meta.url) is loaded with the reader.
    for(const match of bytes.toString('utf8').matchAll(/new URL\(\s*['"](\.{1,2}\/[^'"]+\.json)['"]\s*,\s*import\.meta\.url\s*\)/g)){
      const target=posix.normalize(posix.join(posix.dirname(path),match[1]));
      // Content reads retain data edges without loading data into the code closure.
      // Keep the historical standalone URL pin behavior and missing-pin diagnostics.
      if(rows.has(target)&&contentReads.readRanges.some(r=>r.start<=match.index&&match.index<r.end))continue;
      try{safeName(target);pending.push(target);}catch{gap('CORE_PIN_UNSAFE_IMPORT',path,'Reader data file escapes the checked source root');}
    }
  }
// END PRESERVED LOOP
  // Legacy supplemental output is retained; content reads were traversed above.
  const closure=new Set(files.map(f=>f.path));
  for(const edge of edges)if(edge.kind==='DATA_READ')edge.inClosure=edge.targets.every(p=>closure.has(p));
  const edgeKey=e=>JSON.stringify([e.kind,e.path,e.line,e.specifier,e.targets]);
  const externalKey=e=>JSON.stringify([e.kind,e.path,e.line,e.specifier]);
  const edgeKeys=new Set(edges.map(edgeKey)),externalKeys=new Set(external.map(externalKey));
  for(const file of files)if(/\.(?:cjs|mjs|js|ts|tsx|jsx|mts|cts|gs)$/.test(file.path)){
    const parsed=jsSupplementalEdges(file.path,read(file.path).toString('utf8'),rows,p=>read(p).toString('utf8'),options.resolutionCache);
    gaps.push(...parsed.gaps);
    for(const e of parsed.edges){const key=edgeKey(e);if(!edgeKeys.has(key)){edges.push({...e,inClosure:e.targets.length>0&&e.targets.every(p=>closure.has(p))});edgeKeys.add(key);}}
    for(const e of parsed.external){const key=externalKey(e);if(!externalKeys.has(key)){external.push(e);externalKeys.add(key);}}
  }
  // New traversal paths must not claim that newly exposed gaps existed in 1.11.0.
  const priorReachable=new Set(),priorPending=[...roots],priorAdjacency=new Map();
  for(const edge of edges)if(!['1.12.0','1.12.1','1.13.0','1.14.0'].includes(edge.introducedIn)){
    if(!priorAdjacency.has(edge.path))priorAdjacency.set(edge.path,[]);priorAdjacency.get(edge.path).push(...edge.targets);
  }
  while(priorPending.length){const p=priorPending.pop();if(priorReachable.has(p))continue;priorReachable.add(p);priorPending.push(...(priorAdjacency.get(p)??[]));}
  for(const g of gaps)if(!priorReachable.has(g.path))g.legacyIds={...g.legacyIds,'1.11.0':null};
  const v120Reachable=new Set(),v120Pending=[...roots],v120Adjacency=new Map();
  for(const e of edges)if(!['1.12.1','1.13.0','1.14.0'].includes(e.introducedIn)){
    if(!v120Adjacency.has(e.path))v120Adjacency.set(e.path,[]);v120Adjacency.get(e.path).push(...e.targets);
  }
  while(v120Pending.length){const p=v120Pending.pop();if(v120Reachable.has(p))continue;v120Reachable.add(p);v120Pending.push(...(v120Adjacency.get(p)??[]));}
  for(const g of gaps)if(!v120Reachable.has(g.path)){
    g.legacyIds=Object.fromEntries([...new Set([...Object.keys(g.legacyIds??{}),'1.8.0','1.9.0','1.12.0'])].map(v=>[v,null]));g.legacyId=null;
  }
  const v121Reachable=new Set(),v121Pending=[...roots],v121Adjacency=new Map();
  for(const e of edges)if(!['1.13.0','1.14.0'].includes(e.introducedIn)){
    if(!v121Adjacency.has(e.path))v121Adjacency.set(e.path,[]);v121Adjacency.get(e.path).push(...e.targets);
  }
  while(v121Pending.length){const p=v121Pending.pop();if(v121Reachable.has(p))continue;v121Reachable.add(p);v121Pending.push(...(v121Adjacency.get(p)??[]));}
  for(const g of gaps)if(!v121Reachable.has(g.path)||g.introducedIn==='1.13.0'){
    g.legacyIds=Object.fromEntries([...new Set([...Object.keys(g.legacyIds??{}),'1.8.0','1.9.0','1.12.0','1.12.1'])].map(v=>[v,null]));g.legacyId=null;
  }
  const v130Reachable=new Set(),v130Pending=[...roots],v130Adjacency=new Map();
  for(const e of edges)if(e.introducedIn!=='1.14.0'){
    if(!v130Adjacency.has(e.path))v130Adjacency.set(e.path,[]);v130Adjacency.get(e.path).push(...e.targets);
  }
  while(v130Pending.length){const p=v130Pending.pop();if(v130Reachable.has(p))continue;v130Reachable.add(p);v130Pending.push(...(v130Adjacency.get(p)??[]));}
  for(const g of gaps)if(!v130Reachable.has(g.path)||g.introducedIn==='1.14.0'){
    g.legacyIds=Object.fromEntries([...new Set([...Object.keys(g.legacyIds??{}),'1.8.0','1.9.0','1.12.0','1.12.1','1.13.0'])].map(v=>[v,null]));g.legacyId=null;
  } else {
    // Older reachability passes may have cleared the new historical slot.
    // The inference layer fills it from the final, normalized current identity.
    delete g.legacyIds['1.13.0'];
  }
  options.progress?.('walk: complete '+files.length+' files');
  return {files:files.sort((a,b)=>a.path.localeCompare(b.path)),gaps,edges,external,dataReadComputed,dataReadComputedSamples,dataReadFiles:[...dataReadFiles].filter(p=>closure.has(p)).sort(),seen:[...seen],calibration:{status:'UNCALIBRATED'},confidence:'PROVISIONAL_STATIC'};
}
