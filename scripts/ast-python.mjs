// 1.38 usage-route, Python half: tree-sitter-python → the same file model ast-graph.mjs uses for JS/TS
// (units, scoped bindings, calls with all hits and exact lines, imports, exports, dynamic sites). Read-only.
import fs from 'node:fs';
import path from 'node:path';
export const PY_FILE=/\.py$/;
export const PY_STDLIB=new Set(('__future__ abc argparse array ast asyncio atexit base64 binascii bisect builtins bz2 calendar cgi cmd codecs codeop collections colorsys concurrent configparser contextlib contextvars copy copyreg csv ctypes dataclasses datetime dbm decimal difflib dis doctest email encodings enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http imaplib importlib inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox marshal math mimetypes mmap multiprocessing netrc numbers operator optparse os pathlib pdb pickle pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty pwd py_compile queue quopri random re readline reprlib resource rlcompleter sched secrets select selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 ssl stat statistics string stringprep struct subprocess sys sysconfig syslog tarfile tempfile termios textwrap threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle types typing unicodedata unittest urllib uuid venv warnings wave weakref webbrowser wsgiref xml xmlrpc zipapp zipfile zipimport zlib zoneinfo').split(' '));
for(const m of ['winreg','msvcrt','pydoc','_winapi','nt','ntpath','winsound','curses','sre_compile','sre_parse','sre_constants','_thread','imp','asynchat','asyncore','distutils','pkg_resources'])PY_STDLIB.add(m);
const PY_GLOBALS=new Set(['open','print','input','eval','exec','exit','quit','__import__','getattr','compile','breakpoint']);
const UNIT_TYPES=new Set(['function_definition','lambda']);
const unwrap=n=>{while(n&&['parenthesized_expression','await'].includes(n.type))n=n.namedChildren[0];return n;};
const strOf=n=>{n=unwrap(n);if(n?.type!=='string')return null;if(n.namedChildren.some(c=>c.type==='interpolation'))return null;return n.namedChildren.filter(c=>c.type==='string_content').map(c=>c.text).join('');};
// literal prefix of an f-string / 'a' + x, for dynamic imports like import_module(f'jc.parsers.{name}')
const prefixOf=n=>{n=unwrap(n);if(n?.type==='string'){let s='';for(const c of n.namedChildren){if(c.type==='interpolation')return s||null;if(c.type==='string_content')s+=c.text;}return null;}if(n?.type==='binary_operator')return strOf(n.childForFieldName('left'));return null;};
export function parsePy(f,tree){
 const rel=f.rel,TOP=rel+'::<top>',nodeUnit=new Map();
 f.units.set(TOP,{id:TOP,name:'<top>',file:rel,line:1,end:f.lines.length});f.dynImports=[];
 const uname=(name,line)=>{let id=rel+'::'+name;if(f.units.has(id))id+='@'+line;return id;};
 const addUnit=(node,name,cls=null)=>{const line=node.startPosition.row+1,id=uname(name,line);f.units.set(id,{id,name,cls,file:rel,line,end:node.endPosition.row+1});nodeUnit.set(node.id,id);return id;};
 // Python scopes: module, class body, function. Lookup = innermost scope containing the use.
 const table=new Map();
 const scopeOf=n=>{for(let p=n.parent;p;p=p.parent)if(p.type==='function_definition'||p.type==='lambda'||p.type==='class_definition')return [p.startIndex,p.endIndex];return [0,Infinity];};
 const bind=(name,b,node,scope)=>{const [s0,e0]=scope??(node?scopeOf(node):[0,Infinity]);const list=table.get(name)??[];const same=list.find(x=>x.s===s0&&x.e===e0);
  if(same){if(b.kind==='unit'&&same.kind!=='unit')Object.assign(same,b);else if(b.kind==='expr'&&same.kind==='expr'&&(same.alts??=[]).length<8)same.alts.push(b.node);return;}list.push({...b,s:s0,e:e0});table.set(name,list);};
 f.bindings={get:(name,pos=null)=>{const list=table.get(name);if(!list)return undefined;const hits=list.filter(x=>pos==null?x.s===0:x.s<=pos&&pos<x.e);if(!hits.length)return undefined;hits.sort((a,b)=>(a.e-a.s)-(b.e-b.s));return hits[0].kind==='param'?null:hits[0];},has(name,pos=null){return this.get(name,pos)!==undefined;}};
 const classOf=n=>{for(let p=n.parent;p;p=p.parent){if(p.type==='class_definition')return p.childForFieldName('name')?.text;if(p.type==='function_definition')return null;}return null;};
 const methodClass=n=>{for(let p=n.parent;p;p=p.parent)if(nodeUnit.has(p.id))return f.units.get(nodeUnit.get(p.id))?.cls??null;return null;};
 const isTop=n=>scopeOf(n)[0]===0&&scopeOf(n)[1]===Infinity;
 function visit1(n){
  switch(n.type){
   case 'function_definition':{const nm=n.childForFieldName('name')?.text;if(!nm)break;const cls=classOf(n);const id=addUnit(n,cls?cls+'.'+nm:nm,cls);if(!cls){bind(nm,{kind:'unit',id},n);if(isTop(n))f.exports.set(nm,{local:nm});}
    for(const p of n.childForFieldName('parameters')?.namedChildren??[]){const id2=p.type==='identifier'?p:p.childForFieldName?.('name')??p.namedChildren.find(c=>c.type==='identifier');if(id2?.type==='identifier'&&!(cls&&['self','cls'].includes(id2.text)))bind(id2.text,{kind:'param'},null,[n.startIndex,n.endIndex]);}
    break;}
   case 'class_definition':{const nm=n.childForFieldName('name')?.text;if(!nm)break;addUnit(n,nm,nm);bind(nm,{kind:'class',cls:nm},n);if(isTop(n))f.exports.set(nm,{local:nm});
    const sup=n.childForFieldName('superclasses')?.namedChildren?.find(c=>c.type!=='keyword_argument');if(sup)f.supers.set(nm,sup);break;}
   case 'import_statement':{for(const c of n.namedChildren){const dn=c.type==='aliased_import'?c.childForFieldName('name'):c,al=c.type==='aliased_import'?c.childForFieldName('alias')?.text:null;if(!dn)continue;const mod=dn.text;
     f.imports.push({src:mod,line:n.startPosition.row+1,kind:'import',unit:unitOf(n)});
     if(al)bind(al,{kind:'module',src:mod},n);else bind(mod.split('.')[0],{kind:'module',src:mod.split('.')[0]},n);if(isTop(n))f.exports.set(al??mod.split('.')[0],{local:al??mod.split('.')[0]});}break;}
   case 'import_from_statement':{const mn=n.childForFieldName('module_name');const src=mn?.text??'';const line=n.startPosition.row+1;
    const names=n.namedChildren.filter(c=>c!==mn&&(c.type==='dotted_name'||c.type==='aliased_import'));
    if(n.namedChildren.some(c=>c.type==='wildcard_import')){f.imports.push({src,line,kind:'from',unit:unitOf(n)});(f.star??=[]).push(src);break;}
    for(const c of names){const nm=(c.type==='aliased_import'?c.childForFieldName('name'):c).text,al=c.type==='aliased_import'?c.childForFieldName('alias')?.text:nm;
     // `from . import utils` may name a submodule; record both the package and the submodule import
     f.imports.push({src,line,kind:'from',member:nm,unit:unitOf(n)});bind(al,{kind:'module',src,member:nm},n);if(isTop(n))f.exports.set(al,{local:al});}
    break;}
   case 'assignment':case 'augmented_assignment':{const l=n.childForFieldName('left'),r=n.childForFieldName('right');if(!l||!r)break;
    if(l.type==='identifier'){bind(l.text,{kind:'expr',node:r},n);if(isTop(n))f.exports.set(l.text,{local:l.text});}
    else if(l.type==='attribute'&&['self','cls'].includes(l.childForFieldName('object')?.text)){const cls=methodClass(n);const a=l.childForFieldName('attribute')?.text;if(cls&&a&&!f.fields.has(cls+'#.'+a))f.fields.set(cls+'#.'+a,{node:r});}
    else if(l.type==='pattern_list'||l.type==='tuple_pattern'){for(const c of l.namedChildren)if(c.type==='identifier')bind(c.text,{kind:'param'},n);}
    break;}
   case 'with_item':{const v=n.childForFieldName('value');if(v?.type==='as_pattern'){const t=v.childForFieldName('alias')?.namedChildren?.[0];const e=v.namedChildren[0];if(t?.type==='identifier'&&e)bind(t.text,{kind:'expr',node:e,ctxManager:true},n);}break;}
   case 'if_statement':{if(isTop(n)&&!n.parent?.parent&&/^__name__\s*==\s*['"]__main__['"]$|^['"]__main__['"]\s*==\s*__name__$/.test(n.childForFieldName('condition')?.text??'')){addUnit(n,'<main>');f.mainGuard=n.startPosition.row+1;}break;}
   case 'for_statement':{const l=n.childForFieldName('left');if(l?.type==='identifier')bind(l.text,{kind:'param'},n);break;}
  }
  for(const c of n.namedChildren)visit1(c);
 }
 function unitOf(n){for(let p=n;p;p=p.parent)if(nodeUnit.has(p.id))return nodeUnit.get(p.id);return TOP;}
 visit1(tree.rootNode);
 // f'{modpath}{name}' where modpath = 'a.' if … else 'b.' → ['a.','b.']
 function prefixesOf(a){a=unwrap(a);const p=prefixOf(a);if(p)return [p];
  const first=a?.type==='string'?a.namedChildren.find(c=>c.type==='interpolation'||c.type==='string_content'):a?.type==='binary_operator'?a.childForFieldName('left'):null;
  const id=first?.type==='interpolation'?first.childForFieldName('expression'):first;if(id?.type!=='identifier')return [];
  const b=f.bindings.get(id.text,id.startIndex);if(b?.kind!=='expr')return [];const out=[];
  const walk=x=>{x=unwrap(x);if(!x)return;const s=strOf(x);if(s!=null){out.push(s);return;}if(x.type==='conditional_expression'){walk(x.namedChildren[0]);walk(x.namedChildren[2]);}};
  for(const x of [b.node,...(b.alts??[])])walk(x);return [...new Set(out)].filter(s=>/^[\w.]+$/.test(s));}
 function context(n){const ctx=[];let prev=n;
  for(let p=n.parent;p&&!nodeUnit.has(p.id);prev=p,p=p.parent){
   if(p.type==='if_statement'&&prev.id===p.childForFieldName('consequence')?.id)ctx.push('當 '+(p.childForFieldName('condition')?.text??'').replace(/\s+/g,' ').slice(0,70));
   else if(p.type==='elif_clause'&&prev.id===p.childForFieldName('consequence')?.id)ctx.push('當 '+(p.childForFieldName('condition')?.text??'').replace(/\s+/g,' ').slice(0,70));
   else if(p.type==='else_clause'&&p.parent?.type==='if_statement')ctx.push('否則（不是 '+(p.parent.childForFieldName('condition')?.text??'').replace(/\s+/g,' ').slice(0,60)+'）');
   else if(p.type==='except_clause')ctx.push('出錯時（except '+(p.namedChildren[0]?.type!=='block'?p.namedChildren[0]?.text.slice(0,30):'')+'）');
   else if(p.type==='conditional_expression')ctx.push('當 '+(p.namedChildren[1]?.text??'').slice(0,60));}
  return ctx.slice(0,3);}
 function visit2(n){
  if(n.type==='call'){const fn=n.childForFieldName('function'),args=n.childForFieldName('arguments'),line=n.startPosition.row+1;
   const pos=[],kw={};for(const a of args?.namedChildren??[]){if(a.type==='keyword_argument')kw[a.childForFieldName('name')?.text]=a.childForFieldName('value')?.text??'';else pos.push(a);}
   const fnText=fn?.text??'';
   if(/^(importlib\.)?import_module$/.test(fnText)||fnText==='__import__'){const s=strOf(pos[0]);if(s!=null)f.imports.push({src:s,line,kind:'dynamic-import',unit:unitOf(n)});
    else{const pres=prefixesOf(pos[0]);f.dynamic.push({line,unit:unitOf(n),why:'動態載入模組：'+n.text.replace(/\s+/g,' ').slice(0,70)+(pres.length?'（前綴 '+pres.join(' / ')+'）':'')});if(pres.length)f.dynImports.push({prefixes:pres,line,unit:unitOf(n)});}}
   else if(fnText==='getattr'&&pos[1]&&strOf(pos[1])==null&&n.parent?.type==='call'&&n.parent.childForFieldName('function')?.id===n.id)f.dynamic.push({line,unit:unitOf(n),call:true,why:'用算出來的名稱呼叫：'+n.parent.text.replace(/\s+/g,' ').slice(0,60)});
   if(fn)f.calls.push({node:fn,prop:fn.type==='attribute'?fn.childForFieldName('attribute')?.text:null,isNew:false,line,col:n.startPosition.column,unit:unitOf(n),text:n.text.replace(/\s+/g,' ').slice(0,90),arg0:pos[0]?.text.replace(/\s+/g,' ').slice(0,40)??null,pyArgs:{pos:pos.map(p=>p.text.slice(0,40)),kw},ctx:context(n)});
   for(const a of pos){const u=unwrap(a);if(u?.type==='identifier'||u?.type==='attribute')f.refs.push({node:u,line,unit:unitOf(n)});}
   for(const a of args?.namedChildren??[])if(a.type==='keyword_argument'){const v=a.childForFieldName('value');if(v?.type==='identifier'||v?.type==='attribute')f.refs.push({node:v,line,unit:unitOf(n)});}
  }else if(n.type==='attribute'&&/^(sys\.(stdin|argv)|os\.environ)$/.test(n.text)&&!(n.parent?.type==='attribute'&&n.parent.parent?.type==='call'&&n.parent.parent.childForFieldName('function')?.id===n.parent.id)){
   f.calls.push({node:n,ref:true,line:n.startPosition.row+1,col:n.startPosition.column,unit:unitOf(n),text:(n.parent?.text??n.text).replace(/\s+/g,' ').slice(0,90),ctx:context(n)});
  }else if(n.type==='raise_statement'&&/^raise\s+SystemExit\b/.test(n.text)){f.calls.push({node:null,synthetic:'py:sys.exit',line:n.startPosition.row+1,col:0,unit:unitOf(n),text:n.text.slice(0,90),ctx:context(n)});}
  else if((n.type==='dictionary'||n.type==='list'||n.type==='return_statement')){for(const c of n.namedChildren){const v=c.type==='pair'?c.childForFieldName('value'):c;if(v?.type==='identifier')f.refs.push({node:v,line:v.startPosition.row+1,unit:unitOf(n)});}}
  for(const c of n.namedChildren)visit2(c);
 }
 visit2(tree.rootNode);
 return f;
}
// Python import resolution: dotted (absolute, tried from repo root and src/) or relative (leading dots).
export function resolvePy(g,from,src,member=null){
 const m=src.match(/^(\.*)(.*)$/),level=m[1].length,dotted=m[2];
 const fileFor=base=>{for(const c of [base+'.py',base+'/__init__.py'])if(g.set.has(c))return c;return null;};
 if(level){let dir=path.posix.dirname(from);for(let i=1;i<level;i++)dir=path.posix.dirname(dir);const base=dotted?path.posix.join(dir==='.'?'':dir,...dotted.split('.')):dir;
  const sub=member?fileFor(path.posix.join(base==='.'?'':base,member)):null;if(sub)return {type:'file',file:sub,submodule:true};
  const p=fileFor(base==='.'||base===''?'__init__':base)??(base===dir?fileFor(path.posix.join(dir,'__init__')):null);return p?{type:'file',file:p}:{type:'unresolved',src};}
 const top=dotted.split('.')[0];
 if(PY_STDLIB.has(top))return {type:'builtin',name:dotted,py:true};
 for(const root of g.pyRoots??['']){const base=path.posix.join(root,...dotted.split('.'));const sub=member?fileFor(path.posix.join(base,member)):null;if(sub)return {type:'file',file:sub,submodule:true};const p=fileFor(base);if(p)return {type:'file',file:p};}
 return {type:'package',name:top,sub:dotted.slice(top.length),py:true};
}
// Python expression → canon (same canon language as JS: py:mod.attr, pkg:x, file:rel|.name, local:rel::Name[#]).
export function pyCanon(g,f,node,unit,depth,h){
 node=unwrap(node);if(!node||depth>12)return null;const C=n=>pyCanon(g,f,n,unit,depth+1,h);
 switch(node.type){
  case 'identifier':{if(['self','cls'].includes(node.text)){const u=f.units.get(unit);if(u?.cls)return 'local:'+f.rel+'::'+u.cls+'#';}
   const b=f.bindings.get(node.text,node.startIndex);if(b)return pyBinding(g,f,b,depth,h);if(b===null)return null;return PY_GLOBALS.has(node.text)?'global.'+node.text:null;}
  case 'attribute':{const a=node.childForFieldName('attribute')?.text,base=C(node.childForFieldName('object'));return base&&a?h.normalize(g,base+'.'+a):null;}
  case 'call':{const fn=unwrap(node.childForFieldName('function'));const b=C(fn);if(!b)return null;
   // calling a class makes an instance
   if(/^local:/.test(b)&&h.targetsOf(g,b).some(t=>{const u=h.findUnit(g,t);return u?.cls&&u.name===u.cls;}))return b+'#';
   if(/^file:/.test(b)){const ts=h.targetsOf(g,b);if(ts.some(t=>{const u=h.findUnit(g,t);return u?.cls&&u.name===u.cls;}))return b+'#';}
   return b+'()';}
  case 'boolean_operator':case 'conditional_expression':{const cs=node.namedChildren.filter((c,i)=>node.type==='boolean_operator'||i!==1).map(C).filter(Boolean);return cs.find(c=>h.capOf(c)||/^(py:|pkg:)/.test(c))??cs[0]??null;}
 }
 return null;
}
export function pyBinding(g,f,b,depth,h){
 if(b.kind==='unit')return 'local:'+b.id;
 if(b.kind==='class')return 'local:'+f.rel+'::'+b.cls;
 if(b.kind==='module'){const t=resolvePy(g,f.rel,b.src,b.member);if(t.submodule)return 'file:'+t.file+'|';const base=h.modCanon(t);if(!base)return null;return b.member?h.normalize(g,base+'.'+b.member):base;}
 if(b.kind==='expr'){if(b.busy)return null;b.busy=true;try{const cs=[b.node,...(b.alts??[])].map(n=>pyCanon(g,f,n,f.rel+'::<top>',depth+1,h)).filter(Boolean);let c=cs.find(c=>h.capOf(c)||/^(py:|pkg:)/.test(c))??cs[0]??null;
  if(c&&b.ctxManager&&/^global\.open\(\)$|\.open\(\)$/.test(c))c=c.replace(/\(\)$/,'()');return c;}finally{b.busy=false;}}
 return null;
}
// console_scripts / [project.scripts] / __main__.py → CLI entries {kind:'bin',name,module,fn}
export function pyEntries(root){
 const out=[],read=f=>{try{return fs.readFileSync(path.join(root,f),'utf8');}catch{return '';}};
 const add=(name,spec,file,body)=>{const [mod,fn]=spec.trim().split(':');if(!/^[\w.]+$/.test(mod??''))return;const i=body.indexOf(spec.trim());out.push({kind:'bin',name:name.trim(),module:mod,fn:fn?.trim()||null,lang:'python',declared:{file,line:i<0?null:body.slice(0,i).split('\n').length}});};
 const py=read('pyproject.toml');const sec=py.match(/^\[project\.scripts\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m);if(sec)for(const m of sec[1].matchAll(/^\s*["']?([\w.-]+)["']?\s*=\s*["']([^"']+)["']/gm))add(m[1],m[2],'pyproject.toml',py);
 const poetry=py.match(/^\[tool\.poetry\.scripts\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m);if(poetry)for(const m of poetry[1].matchAll(/^\s*["']?([\w.-]+)["']?\s*=\s*["']([^"']+)["']/gm))add(m[1],m[2],'pyproject.toml',py);
 const cfg=read('setup.cfg');const cs=cfg.match(/console_scripts\s*=\s*\n((?:[ \t]+.+\n?)+)/);if(cs)for(const m of cs[1].matchAll(/^\s*([\w.-]+)\s*=\s*([\w.:]+)/gm))add(m[1],m[2],'setup.cfg',cfg);
 const sp=read('setup.py');const ss=sp.match(/console_scripts['"]\s*:\s*\[([\s\S]*?)\]/);if(ss)for(const m of ss[1].matchAll(/['"]\s*([\w.-]+)\s*=\s*([\w.:]+)\s*['"]/g))add(m[1],m[2],'setup.py',sp);
 return out;
}
