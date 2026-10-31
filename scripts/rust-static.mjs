// Bounded Rust file dependencies only; no compiler, macro expansion or cfg evaluation.
import {posix} from 'node:path';
import {gapList} from './gap-shape.mjs';

const identifier=/^(?:r#)?[A-Za-z_][A-Za-z0-9_]*/;
const valid=p=>p!=='.'&&p!=='..'&&!p.startsWith('../')&&!posix.isAbsolute(p)&&!/[\\:\x00-\x1f]/.test(p);
const moduleBase=p=>['lib.rs','main.rs','mod.rs'].includes(posix.basename(p))?posix.dirname(p):p.slice(0,-3);
const knownMacros=new Set(['assert','assert_eq','assert_ne','debug_assert','debug_assert_eq','debug_assert_ne','format','format_args','println','print','eprintln','eprint','write','writeln','panic','unreachable','unimplemented','todo','vec','matches','dbg','stringify','concat','env','option_env','file','line','column','module_path']);

function lex(source){
  const tokens=[],issues=[];let at=0,line=1;
  const advance=end=>{for(;at<end;at++)if(source[at]==='\n')line++;};
  while(at<source.length){
    const start=at,here=line,c=source[at];
    if(/\s/.test(c)){advance(at+1);continue;}
    if(source.startsWith('//',at)){const end=source.indexOf('\n',at);advance(end<0?source.length:end);continue;}
    if(source.startsWith('/*',at)){
      let depth=1;advance(at+2);
      while(at<source.length&&depth){if(source.startsWith('/*',at)){depth++;advance(at+2);}else if(source.startsWith('*/',at)){depth--;advance(at+2);}else advance(at+1);}
      if(depth)issues.push({code:'RUST_LEX_UNSUPPORTED',line:here,detail:'Unclosed nested block comment'});
      continue;
    }
    const raw=source.slice(at).match(/^(?:br|cr|r)(#{0,255})"/);
    if(raw){const close='"'+raw[1],end=source.indexOf(close,at+raw[0].length);advance(end<0?source.length:end+close.length);if(end<0)issues.push({code:'RUST_LEX_UNSUPPORTED',line:here,detail:'Unclosed raw string'});tokens.push({v:'STRING',kind:'string',start,end:at,line:here});continue;}
    if(c==='"'||/^[bc]"/.test(source.slice(at,at+2))){
      if(c!=='"')advance(at+1);advance(at+1);let closed=false;
      while(at<source.length){if(source[at]==='\\'){advance(Math.min(source.length,at+2));continue;}if(source[at]==='"'){advance(at+1);closed=true;break;}advance(at+1);}
      if(!closed)issues.push({code:'RUST_LEX_UNSUPPORTED',line:here,detail:'Unclosed string'});
      tokens.push({v:'STRING',kind:'string',start,end:at,line:here});continue;
    }
    if(c==="'"||c==='b'&&source[at+1]==="'"){
      const text=source.slice(at+(c==='b'?1:0)),char=text.match(/^'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|[^\r\n])|[^\\'\r\n])'/u);
      if(char){advance(at+char[0].length+(c==='b'?1:0));continue;}
      const lifetime=c==="'"&&text.match(/^'[A-Za-z_][A-Za-z0-9_]*/);
      if(lifetime){advance(at+lifetime[0].length);continue;}
      issues.push({code:'RUST_LEX_UNSUPPORTED',line:here,detail:'Unsupported character or lifetime syntax'});advance(at+1);continue;
    }
    const name=source.slice(at).match(identifier);
    if(name){advance(at+name[0].length);tokens.push({v:name[0].replace(/^r#/,''),kind:'name',start,end:at,line:here});continue;}
    const v=source.startsWith('::',at)?'::':c;advance(at+v.length);tokens.push({v,start,end:at,line:here});
  }
  return {tokens,issues};
}

function closing(t,start){
  const pairs={'(':')','[':']','{':'}'},stack=[pairs[t[start]?.v]];
  if(!stack[0])return start;
  for(let i=start+1;i<t.length;i++){
    if(t[i].kind==='string')continue;
    if(pairs[t[i].v])stack.push(pairs[t[i].v]);
    else if([')',']','}'].includes(t[i].v)){if(stack.pop()!==t[i].v)return -1;if(!stack.length)return i;}
  }
  return -1;
}

function parse(source){
  const {tokens:t,issues}=lex(source),mods=[],uses=[],items=new Set(),innerConditions=[];let attrs=[],depth=0;
  const issue=(code,token,detail)=>issues.push({code,line:token.line,detail});
  for(let i=0;i<t.length;i++){
    const token=t[i],v=token.v;
    if(v==='#'&&(t[i+1]?.v==='['||t[i+1]?.v==='!'&&t[i+2]?.v==='[')){
      const inner=t[i+1].v==='!',open=i+(inner?2:1),end=closing(t,open);
      if(end<0){issue('RUST_LEX_UNSUPPORTED',token,'Unclosed attribute');break;}
      const text=source.slice(token.start,t[end].end),name=t[open+1]?.v;
      if(['cfg','cfg_attr'].includes(name))issue('RUST_CFG_UNEVALUATED',token,text);
      if(inner&&name==='cfg')innerConditions.push(text);else attrs.push({name,text,line:token.line});
      i=end;continue;
    }
    if(v==='pub'){if(t[i+1]?.v==='('){const end=closing(t,i+1);if(end<0){issue('RUST_LEX_UNSUPPORTED',token,'Unclosed visibility');break;}i=end;}continue;}
    if(v==='mod'&&t[i+1]?.kind==='name'){
      const name=t[i+1].v,next=t[i+2],record={name,line:token.line,attrs};attrs=[];
      if(next?.v==='{'){
        issue('RUST_INLINE_MODULE_UNSUPPORTED',token,'Inline module '+name+' is skipped, including its inner imports');const end=closing(t,i+2);if(end<0){issue('RUST_LEX_UNSUPPORTED',token,'Unclosed inline module');break;}i=end;continue;
      }
      if(next?.v!==';'){issue('RUST_MODULE_SYNTAX_UNSUPPORTED',token,'Expected mod name;');continue;}
      if(depth)issue('RUST_BLOCK_MODULE_UNSUPPORTED',token,'Block-local module '+name+' is not resolved');
      else mods.push(record);
      i+=2;continue;
    }
    if(v==='use'){
      let end=i+1,nesting=0;
      for(;end<t.length;end++){if(!nesting&&t[end].v===';')break;if(['{','[','('].includes(t[end].v))nesting++;else if(['}',']',')'].includes(t[end].v))nesting--;if(nesting<0)break;}
      if(t[end]?.v!==';'){issue('RUST_USE_SYNTAX_UNSUPPORTED',token,'Unclosed use declaration');attrs=[];continue;}
      uses.push({line:token.line,tokens:t.slice(i+1,end),specifier:source.slice(t[i+1]?.start??token.end,t[end].start).trim(),attrs});attrs=[];i=end;continue;
    }
    if(token.kind==='name'&&t[i+1]?.v==='!'){
      let open=i+2;if(v==='macro_rules'&&t[open]?.kind==='name')open++;
      if(['(','[','{'].includes(t[open]?.v)){
        if(!knownMacros.has(v))issue(['include','include_str','include_bytes'].includes(v)?'RUST_INCLUDE_UNSUPPORTED':'RUST_MACRO_UNEXPANDED',token,'Macro '+v+' is not expanded');
        const end=closing(t,open);if(end<0){issue('RUST_LEX_UNSUPPORTED',token,'Unclosed macro token tree');break;}i=end;attrs=[];continue;
      }
    }
    if(!depth&&['fn','struct','enum','trait','type','const','static','union'].includes(v)&&t[i+1]?.kind==='name')items.add(t[i+1].v);
    if(v==='{')depth++;else if(v==='}')depth=Math.max(0,depth-1);
    attrs=[];
  }
  return {mods,uses,items,issues,innerConditions};
}

function crateRootFor(path,rows){
  if(['lib.rs','main.rs'].includes(posix.basename(path)))return path;
  let dir=posix.dirname(path);
  while(true){for(const name of ['lib.rs','main.rs']){const p=posix.join(dir,name);if(rows.has(p))return p;}const parent=posix.dirname(dir);if(parent===dir)break;dir=parent;}
  return null;
}

function manifestNames(root,rows,read){
  const names=new Set(['std','core','alloc']);let dir=posix.dirname(root);
  while(true){
    const path=posix.join(dir,'Cargo.toml');
    if(rows.has(path)){
      try{
        let section='';
        for(const line of String(read(path)).split(/\r?\n/)){
          const header=line.match(/^\s*\[([^\]]+)\]/);if(header){section=header[1];const table=section.match(/(?:^|\.)(?:dev-|build-)?dependencies\.([A-Za-z_][\w-]*)$/);if(table)names.add(table[1].replaceAll('-','_'));continue;}
          if(section==='package'){const name=line.match(/^\s*name\s*=\s*"([A-Za-z_][\w-]*)"/);if(name)names.add(name[1].replaceAll('-','_'));}
          if(/(?:^|\.)(?:dev-|build-)?dependencies$/.test(section)){const name=line.match(/^\s*(?:"([A-Za-z_][\w-]*)"|([A-Za-z_][\w-]*))\s*=/);if(name)names.add((name[1]??name[2]).replaceAll('-','_'));}
        }
      }catch{} // An unknown bare use remains a gap if the manifest cannot be read.
      break;
    }
    const parent=posix.dirname(dir);if(parent===dir)break;dir=parent;
  }
  return names;
}

function moduleIndex(root,rows,read,parseFile){
  const nodes=new Map(),byPath=new Map(),pending=[{path:root,key:'',conditions:[]}],issues=[];let bytes=0;
  while(pending.length){
    const node=pending.pop();if(byPath.has(node.path))continue;
    if(nodes.size>=2048||node.key.split('::').length>64){issues.push('Module index exceeds 2048 files or 64 module levels');break;}
    let source;try{source=String(read(node.path));}catch{continue;}
    bytes+=Buffer.byteLength(source);if(bytes>16*1024*1024){issues.push('Module index exceeds 16 MiB');break;}
    const parsed=parseFile(node.path,source);Object.assign(node,{parsed,children:new Map(),conditions:[...node.conditions,...parsed.innerConditions]});nodes.set(node.key,node);byPath.set(node.path,node);
    for(const mod of parsed.mods){
      if(mod.attrs.some(a=>['path','cfg_attr'].includes(a.name)))continue;
      const targets=[posix.join(moduleBase(node.path),mod.name+'.rs'),posix.join(moduleBase(node.path),mod.name,'mod.rs')].filter(p=>valid(p)&&rows.has(p));
      if(targets.length!==1)continue;
      const key=node.key?node.key+'::'+mod.name:mod.name;node.children.set(mod.name,key);
      pending.push({path:targets[0],key,conditions:[...node.conditions,...mod.attrs.filter(a=>a.name==='cfg').map(a=>a.text)]});
    }
  }
  return {nodes,byPath,issues,externalNames:manifestNames(root,rows,read)};
}

export function rustEdges(path,source,{rows,read,crateRoot,resolutionCache=new Map()}={}){
  const edges=[],gaps=gapList(),external=[];
  const gap=(code,line,detail)=>gaps.push({code,path,line,detail,introducedIn:'1.24.0'});
  const parseFile=(name,text)=>{const key='rust:parse:'+name+':'+(rows.get(name)?.sha256??text);if(!resolutionCache.has(key))resolutionCache.set(key,parse(text));return resolutionCache.get(key);};
  const parsed=parseFile(path,source),root=crateRoot??crateRootFor(path,rows);
  const indexKey='rust:index:'+root;
  if(root&&!resolutionCache.has(indexKey))resolutionCache.set(indexKey,moduleIndex(root,rows,read,parseFile));
  const index=root?resolutionCache.get(indexKey):null,node=index?.byPath.get(path),conditions=node?.conditions??parsed.innerConditions;
  const add=(kind,line,specifier,targets,extra={})=>edges.push({kind,path,line,specifier,targets,basis:'RUST_LEXICAL',candidate:true,runtimeVerified:false,introducedIn:'1.24.0',...(conditions.length?{conditions}:{}),...extra});
  if(!root)gap('RUST_CRATE_ROOT_UNKNOWN',1,'Select main.rs or lib.rs as an explicit crate root');
  else if(!node)gap('RUST_MODULE_CONTEXT_UNKNOWN',1,'This file is not reachable through supported mod declarations from '+root);
  if(path===root)for(const detail of index.issues)gap('RUST_SCAN_LIMIT',1,detail);
  for(const issue of parsed.issues)gap(issue.code,issue.line,issue.detail);
  for(const mod of parsed.mods){
    const unsupported=mod.attrs.filter(a=>['path','cfg_attr'].includes(a.name));
    if(unsupported.length){for(const a of unsupported)gap('RUST_MODULE_ATTRIBUTE_UNSUPPORTED',a.line,a.text+'; module '+mod.name+' is not resolved');continue;}
    const candidates=[posix.join(moduleBase(path),mod.name+'.rs'),posix.join(moduleBase(path),mod.name,'mod.rs')],targets=candidates.filter(p=>valid(p)&&rows.has(p));
    if(targets.length!==1){gap(targets.length?'RUST_MODULE_AMBIGUOUS':'RUST_MODULE_MISSING',mod.line,{module:mod.name,candidates});continue;}
    const ownConditions=mod.attrs.filter(a=>a.name==='cfg').map(a=>a.text);
    add('RUST_MOD',mod.line,mod.name,targets,ownConditions.length?{conditions:[...conditions,...ownConditions]}:{});
  }
  for(const use of parsed.uses){
    let t=use.tokens;
    if(t.some(x=>['{','}','*'].includes(x.v))){gap('RUST_USE_UNSUPPORTED',use.line,use.specifier+'; grouped and glob imports are not resolved');continue;}
    const alias=t.findIndex(x=>x.v==='as');if(alias>=0){if(alias!==t.length-2||t.at(-1)?.kind!=='name'){gap('RUST_USE_UNSUPPORTED',use.line,use.specifier);continue;}t=t.slice(0,alias);}
    const absolute=t[0]?.v==='::';if(absolute)t=t.slice(1);
    if(!t.length||t.some((x,i)=>i%2?x.v!=='::':x.kind!=='name')){gap('RUST_USE_UNSUPPORTED',use.line,use.specifier);continue;}
    const parts=t.filter((_,i)=>i%2===0).map(x=>x.v),first=parts[0];let base=node,at=0;
    if(!absolute&&first==='crate'){base=index?.nodes.get('');at=1;}
    else if(!absolute&&first==='self')at=1;
    else if(!absolute&&first==='super'){
      while(parts[at]==='super'){
        if(!base||!base.key){base=null;break;}
        base=index.nodes.get(base.key.split('::').slice(0,-1).join('::'));at++;
      }
      if(!base){gap('RUST_SUPER_OUTSIDE_CRATE',use.line,use.specifier);continue;}
    }else if(absolute||!base?.children.has(first)&&!base?.parsed.items.has(first)){
      if(index?.externalNames.has(first)||['std','core','alloc'].includes(first)){
        external.push({kind:'RUST_USE',path,line:use.line,specifier:use.specifier,program:null,crate:first,classification:'EXTERNAL_CRATE',basis:'RUST_EXTERNAL_NAME',runtimeVerified:false});
        add('RUST_USE',use.line,use.specifier,[],{external:true,crate:first});
      }else gap('RUST_USE_ROOT_UNKNOWN',use.line,use.specifier+'; no declared local module/item or known external crate binding');
      continue;
    }
    if(!base){gap('RUST_USE_UNRESOLVED',use.line,use.specifier);continue;}
    let crossed=false;
    for(;at<parts.length&&base.children.has(parts[at]);at++){base=index.nodes.get(base.children.get(parts[at]));crossed=true;if(!base)break;}
    if(!base){gap('RUST_USE_UNRESOLVED',use.line,use.specifier);continue;}
    const suffix=parts.slice(at),knownItem=suffix.length===1&&base.parsed.items.has(suffix[0]);
    if(suffix.length&&!knownItem&&!crossed){gap('RUST_USE_UNRESOLVED',use.line,use.specifier);continue;}
    if(suffix.length&&!knownItem)gap('RUST_ITEM_UNVERIFIED',use.line,use.specifier+'; only the containing module file is established');
    const useConditions=use.attrs.filter(a=>a.name==='cfg').map(a=>a.text);
    add('RUST_USE',use.line,use.specifier,[base.path],{...(suffix.length?{itemSuffix:suffix.join('::'),itemVerified:knownItem}:{}),...(useConditions.length?{conditions:[...conditions,...useConditions]}:{})});
  }
  return {edges,gaps,external,targets:[...new Set(edges.flatMap(e=>e.targets))],crateRoot:root};
}
