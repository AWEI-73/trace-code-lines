// 1.38 usage-route: JS/TS syntax tree (tree-sitter, optional) -> call graph, aliases, capability touches, reachability.
// Read-only: parses files, never loads or runs target code. If web-tree-sitter or the grammars are missing,
// loadAst() returns {ok:false,reason} and callers fall back to the old regex scan and say so in the report.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {PY_FILE,parsePy,resolvePy,pyCanon,pyBinding} from './ast-python.mjs';
const sha256=s=>crypto.createHash('sha256').update(s).digest('hex');
const SKILL_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const JS_FILE=/\.(m?js|cjs|jsx|ts|mts|cts|tsx)$/;
const SKIP_DIR=/(^|\/)(node_modules|\.git|coverage|\.next|\.nuxt|\.venv|venv|\.tox|__pycache__|site-packages|vendor|third_party|bower_components|\.mypy_cache|\.pytest_cache|_build)(\/|$)/;
const TYPE_DECL=/\.d\.(ts|mts|cts)$/;
let cached=null;
// Search order: $TCL_AST_DIR (a folder with node_modules), then this skill's own node_modules.
export async function loadAst(){
 if(cached)return cached;
 const tried=[];
 for(const base of [process.env.TCL_AST_DIR,SKILL_ROOT].filter(Boolean)){
  try{
   const req=createRequire(path.join(path.resolve(base),'package.json'));
   const dir=pkg=>{for(const d of req.resolve.paths(pkg)??[]){const p=path.join(d,pkg);if(fs.existsSync(path.join(p,'package.json')))return p;}throw Object.assign(Error(pkg),{code:'MISSING '+pkg});};
   const ts=req.resolve('web-tree-sitter');const mod=await import(new URL('file://'+ts).href);
   const Parser=mod.Parser??mod.default,Language=mod.Language??mod.default?.Language;
   await Parser.init();
   const wasm=(pkg,f)=>path.join(dir(pkg),f);
   const langs={javascript:await Language.load(wasm('tree-sitter-javascript','tree-sitter-javascript.wasm')),
    typescript:await Language.load(wasm('tree-sitter-typescript','tree-sitter-typescript.wasm')),
    tsx:await Language.load(wasm('tree-sitter-typescript','tree-sitter-tsx.wasm'))};
   // Python grammar is optional on its own: without it, .py files fall back to the regex scan.
   let pyNote=null;try{langs.python=await Language.load(wasm('tree-sitter-python','tree-sitter-python.wasm'));}catch(e){pyNote='沒有 tree-sitter-python，Python 檔改用文字比對';}
   const version=JSON.parse(fs.readFileSync(path.join(dir('web-tree-sitter'),'package.json'),'utf8')).version;
   return cached={ok:true,Parser,langs,engine:'tree-sitter',version,from:base,pyNote};
  }catch(e){tried.push(base+'：'+String(e?.code??e?.message??e).slice(0,80));}
 }
 return cached={ok:false,engine:'regex-fallback',reason:'沒有裝 tree-sitter（'+tried.join('；')+'）；改用文字比對，可能漏抓或誤判。安裝：在 skill 資料夾執行 npm install --ignore-scripts'};
}
const langOf=(rel,head)=>/\.py$/.test(rel)||!/\.\w+$/.test(rel)&&/^#!.*\bpython/.test(head)?'python':/\.tsx$/.test(rel)?'tsx':/\.(ts|mts|cts)$/.test(rel)?'typescript':/\.(m?js|cjs|jsx)$/.test(rel)||/^#!.*\bnode\b/.test(head)?'javascript':null;
export const BUILTINS=new Set(['assert','buffer','child_process','cluster','crypto','dgram','dns','events','fs','fs/promises','http','http2','https','module','net','os','path','perf_hooks','process','querystring','readline','stream','stream/promises','string_decoder','timers','tls','tty','url','util','v8','vm','worker_threads','zlib','dns/promises','readline/promises','timers/promises']);
const GLOBALS=new Set(['fetch','XMLHttpRequest','WebSocket','EventSource','process','console','Buffer','eval','Function','Worker','RegExp','JSON','Promise','Object','Array','setTimeout','setInterval','globalThis','window','document','navigator','require','module','exports','__dirname','__filename']);
// canon string -> capability. Canon forms: node:fs.readFile  global.fetch  pkg:axios.get  (instances end with #)
const CAPS=[
 ['subprocess',/^node:child_process\.(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)$|^pkg:(execa|cross-spawn|shelljs)(\.|$)|^py:subprocess\.(run|call|check_call|check_output|Popen|getoutput|getstatusoutput)$|^py:os\.(system|popen|exec\w*|spawn\w*|posix_spawn\w*)$|^pkg:(sh|plumbum|pexpect)(\.|$)/],
 ['network',/^global\.(fetch|XMLHttpRequest#?|WebSocket#?|EventSource#?)$|^node:(http|https|http2)\.(request|get|connect)$|^node:(net|tls)\.(connect|createConnection|Socket#?)$|^node:dgram\.createSocket$|^node:dns(\/promises)?\.\w+$|^pkg:(axios|node-fetch|got|undici|request|superagent|ws|cross-fetch|isomorphic-fetch|ky|follow-redirects)(\.|#|$)|^py:(urllib\.request\.(urlopen|urlretrieve|build_opener)|http\.client\.\w*Connection|socket\.(socket|create_connection)|smtplib\.SMTP\w*|ftplib\.FTP\w*|imaplib\.IMAP4\w*|poplib\.POP3\w*|xmlrpc\.client\.ServerProxy)$|^pkg:(requests|httpx)(\.(get|post|put|patch|delete|head|options|request|stream)|\.(Session|Client|AsyncClient)(\(\))?#?\.(get|post|put|patch|delete|head|options|request|send|stream))$|^pkg:(aiohttp|urllib3|websockets|websocket|boto3|botocore|grpc|paramiko|pycurl)(\.|#|$)/],
 ['listen',/^node:(http|https|http2|net|tls)\.createServer$|\.createServer\(\)#?\.listen$|^(pkg|local|file):.*[.)#]\.?listen$|^pkg:(express|koa|fastify)(\(\))?#?\.listen$|^py:(http\.server|socketserver)\.\w+$|^pkg:(flask|fastapi|uvicorn|django|tornado|bottle|sanic|starlette|gunicorn|aiohttp\.web)(\.|#|$)/],
 ['write-file',/^node:fs(\/promises)?\.(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|symlink|symlinkSync|chmod|chmodSync|truncate|truncateSync)$|^py:(shutil\.(copy(?!fileobj)\w*|move|rmtree|make_archive|unpack_archive)|os\.(remove|unlink|rename|replace|makedirs|mkdir|rmdir|removedirs|chmod|chown|symlink|link|truncate))$|^py:pathlib\.\w*Path\(\)\.(write_text|write_bytes|mkdir|unlink|rename|replace|touch|rmdir|symlink_to|chmod)$|^py:(sqlite3\.connect|dbm\.open|shelve\.open)$|^pkg:(better-sqlite3|sqlite3)(\.|#|$)/],
 ['read-file',/^node:fs(\/promises)?\.(readFile|readFileSync|createReadStream|readdir|readdirSync|existsSync|exists|stat|statSync|lstat|lstatSync|access|accessSync|open|openSync|read|readSync|opendir)$|^py:(os\.(listdir|scandir|walk)|glob\.\w+)$|^py:pathlib\.\w*Path\(\)\.(read_text|read_bytes|iterdir|glob|rglob|open)$/],
 ['stdin',/^global\.process\.stdin(\.\w+)?$|^py:sys\.stdin(\.\w+)*$|^global\.input$|^py:fileinput\.input$/],
 ['stdout',/^global\.console\.(log|info|debug|table|dir)$|^global\.process\.stdout\.write$|^global\.print$|^py:sys\.stdout(\.buffer)?\.write$/],
 ['stderr',/^global\.console\.(error|warn|trace)$|^global\.process\.stderr\.write$|^py:sys\.stderr(\.buffer)?\.write$/],
 ['exit',/^global\.process\.exit$|^py:sys\.exit$|^py:os\._exit$|^global\.(exit|quit)$/],
 ['args',/^global\.process\.argv$|^py:sys\.argv$|^py:argparse\.ArgumentParser$|^py:getopt\.\w+$/],
 ['env',/^global\.process\.env(\.\w+)?$|^py:os\.(environ(\.\w+)?|getenv|putenv)$|^pkg:dotenv(\.|$)/],
 ['worker',/^node:worker_threads\.Worker#?$|^global\.Worker#?$|^py:(threading\.Thread|multiprocessing\.(Process|Pool)|concurrent\.futures\.\w+Executor)$/],
 ['paid',/^pkg:(openai|@anthropic-ai\/sdk|stripe|twilio|@sendgrid\/mail)(\.|#|$)|^pkg:(openai|anthropic|stripe|twilio|sendgrid)(\.|#|$)/],
 ['real-account',/^pkg:nodemailer(\.|#|$)/],
 ['mcp-tools',/^pkg:@modelcontextprotocol\/sdk[^#]*#?\.(tool|registerTool|setRequestHandler)$|^pkg:@modelcontextprotocol\/sdk\S*McpServer#$/],
 ['dynamic',/^global\.(eval|Function#?)$|^global\.(eval|exec|compile)$/]
];
export const CAP_LABEL={subprocess:'執行其他程式',network:'網路呼叫',listen:'開放連線埠',['write-file']:'寫檔',['read-file']:'讀檔',stdin:'讀標準輸入',stdout:'印到標準輸出',stderr:'印到錯誤輸出',exit:'結束程式（exit code）',args:'讀命令列參數',env:'讀環境變數',worker:'開背景執行緒',paid:'付費呼叫','real-account':'用真帳號的呼叫','mcp-tools':'提供給模型的工具',dynamic:'動態執行（eval 類或算出來的載入路徑）','dynamic-call':'用算出來的名稱呼叫'};
export function capOf(canon){if(!canon)return null;for(const [k,re] of CAPS)if(re.test(canon))return k;return null;}
// Node stream / thenable protocol methods are called by the runtime, not by visible code.
const PROTOCOL=new Set(['_transform','_flush','_read','_write','_writev','_final','_destroy','then','constructor','__init__','__call__','__enter__','__exit__','__iter__','__next__','__aenter__','__aexit__']);
export function listFiles(root){
 const out=[];const walk=(d,rel)=>{let es;try{es=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
  for(const e of es){const r=rel?rel+'/'+e.name:e.name;if(e.isSymbolicLink()||SKIP_DIR.test(r))continue;if(e.isDirectory())walk(path.join(d,e.name),r);else if(e.isFile()&&out.length<20000)out.push(r);}};
 walk(root,'');return out;
}
const unwrap=n=>{while(n&&['parenthesized_expression','as_expression','non_null_expression','satisfies_expression','type_assertion','await_expression'].includes(n.type))n=n.type==='parenthesized_expression'?n.namedChildren.at(-1):n.namedChildren[0];if(n?.type==='sequence_expression')return unwrap(n.namedChildren.at(-1));return n;};
const strOf=n=>{n=unwrap(n);if(!n)return null;if(n.type==='string')return n.text.slice(1,-1);if(n.type==='template_string'&&!n.namedChildren.some(c=>c.type==='template_substitution'))return n.text.slice(1,-1);return null;};
const propName=n=>n?.type==='property_identifier'||n?.type==='private_property_identifier'?n.text:null;
const FUNC=new Set(['function_declaration','generator_function_declaration','function_expression','function','arrow_function','generator_function','method_definition']);
// Parse one file into units, bindings, calls, refs, exports.
function parseFile(ast,root,rel){
 let body;try{const st=fs.statSync(path.join(root,rel));if(st.size>2*1024*1024)return {rel,ok:false,error:'檔案太大（>2MB），沒解析'};body=fs.readFileSync(path.join(root,rel),'utf8');}catch(e){return {rel,ok:false,error:String(e.code??e)};}
 const lang=langOf(rel,body.slice(0,80));if(!lang)return null;
 if(/\.min\.[cm]?js$/.test(rel)||body.length>20000&&body.length/(body.split('\n').length)>400)return {rel,ok:false,error:'壓縮過的打包檔，沒解析',minified:true};
 if(lang==='python'&&!ast.langs.python)return null;
 const parser=new ast.Parser();parser.setLanguage(ast.langs[lang]);
 let tree;try{tree=parser.parse(body);}catch(e){return {rel,ok:false,error:'解析失敗'};}
 const lines=body.split(/\r?\n/);
 const f={rel,ok:true,lang,lines,errors:tree.rootNode.hasError?1:0,units:new Map(),bindings:null,fields:new Map(),props:new Map(),supers:new Map(),calls:[],refs:[],imports:[],exports:new Map(),dynamic:[]};
 if(lang==='python'){parsePy(f,tree);f.tree=tree;f.bodySha=sha256(body);return f;}
 const TOP=rel+'::<top>';f.units.set(TOP,{id:TOP,name:'<top>',file:rel,line:1,end:lines.length});
 const nodeUnit=new Map();// node id -> unit id for function nodes that are named units
 const uname=(name,line)=>{let id=rel+'::'+name;if(f.units.has(id))id+='@'+line;return id;};
 const addUnit=(node,name,cls=null)=>{const line=node.startPosition.row+1,id=uname(name,line);f.units.set(id,{id,name,cls,file:rel,line,end:node.endPosition.row+1});nodeUnit.set(node.id,id);return id;};
 // Lexical scopes: a binding applies inside [s,e) of its scope node; lookups pick the innermost scope containing the use.
 const table=new Map(),SCOPE_FN=new Set([...FUNC,'program','class_body']),SCOPE_BLOCK=new Set([...SCOPE_FN,'statement_block','for_statement','for_in_statement']);
 const scopeOf=(node,how)=>{let p=how==='fn'||how==='let'?node.parent:node;const set=how==='let'?SCOPE_BLOCK:SCOPE_FN;if(how==='param')return [node.startIndex,node.endIndex];if(how==='top')return [0,Infinity];
  for(;p;p=p.parent)if(set.has(p.type))return p.type==='program'?[0,Infinity]:[p.startIndex,p.endIndex];return [0,Infinity];};
 const bind=(name,b,node,how='var')=>{const [s0,e0]=node?scopeOf(node,how):[0,Infinity];const list=table.get(name)??[];
  const same=list.find(x=>x.s===s0&&x.e===e0);if(same){if(b.kind==='unit'&&same.kind!=='unit')Object.assign(same,b);else if(how==='assign'&&b.kind==='expr'&&same.kind==='expr'&&(same.alts??=[]).length<8)same.alts.push(b.node);return;}list.push({...b,s:s0,e:e0,assign:how==='assign'});table.set(name,list);};
 f.bindings={get:(name,pos=null)=>{const list=table.get(name);if(!list)return undefined;const hits=list.filter(x=>pos==null?x.s===0:x.s<=pos&&pos<x.e);if(!hits.length)return pos==null?list.find(x=>x.assign):undefined;
  hits.sort((a,b)=>(a.e-a.s)-(b.e-b.s)||a.assign-b.assign);return hits[0].kind==='param'?null:hits[0];},has(name,pos=null){return this.get(name,pos)!==undefined;}};
 // Pass 1: units + bindings + exports.
 const funcValue=v=>{v=unwrap(v);return v&&FUNC.has(v.type)?v:null;};
 function classScope(node){for(let p=node.parent;p;p=p.parent)if(p.type==='class_declaration'||p.type==='class'||p.type==='abstract_class_declaration')return p.childForFieldName('name')?.text??(p.parent?.type==='variable_declarator'?p.parent.childForFieldName('name')?.text:null)??null;return null;}
 function visit1(n){
  switch(n.type){
   case 'function_declaration':case 'generator_function_declaration':{const nm=n.childForFieldName('name')?.text;if(nm){const id=addUnit(n,nm);bind(nm,{kind:'unit',id},n,'fn');}break;}
   case 'class_declaration':case 'abstract_class_declaration':case 'class':{let nm=n.childForFieldName('name')?.text;if(!nm&&n.parent?.type==='variable_declarator')nm=n.parent.childForFieldName('name')?.text;if(!nm)break;
    if(n.type!=='class')bind(nm,{kind:'class',cls:nm},n,'let');
    const her=n.namedChildren.find(c=>c.type==='class_heritage');const ext=her?(her.namedChildren.find(c=>c.type==='extends_clause')?.childForFieldName('value')??her.namedChildren[0]):null;if(ext)f.supers.set(nm,ext);
    // class without an explicit constructor still gets a unit, so `new X()` reaches it and its methods
    const body=n.childForFieldName('body');if(!body?.namedChildren.some(c=>c.type==='method_definition'&&c.childForFieldName('name')?.text==='constructor'))addUnit(n,nm,nm);break;}
   case 'method_definition':{const cls=classScope(n),nm=n.childForFieldName('name')?.text;if(cls&&nm)addUnit(n,(nm==='constructor'?cls:cls+'.'+nm),cls);break;}
   case 'variable_declarator':{const name=n.childForFieldName('name'),value=n.childForFieldName('value'),how=/^(let|const)\b/.test(n.parent?.text??'')?'let':'var';
    if(name?.type==='identifier'&&value){const fv=funcValue(value);if(fv){const id=addUnit(fv,name.text);bind(name.text,{kind:'unit',id},n,how);}
     else if(unwrap(value)?.type==='class')bind(name.text,{kind:'class',cls:name.text},n,how);else bind(name.text,{kind:'expr',node:value},n,how);}
    else if(name?.type==='object_pattern'&&value)for(const p of name.namedChildren){
     if(p.type==='shorthand_property_identifier_pattern')bind(p.text,{kind:'expr',node:value,member:p.text},n,how);
     else if(p.type==='pair_pattern'){const k=p.childForFieldName('key')?.text,v=p.childForFieldName('value');if(k&&v?.type==='identifier')bind(v.text,{kind:'expr',node:value,member:k},n,how);}}
    break;}
   case 'assignment_expression':{const l=n.childForFieldName('left'),r=n.childForFieldName('right');if(!l||!r)break;const lt=l.text;
    const fv=funcValue(r);
    let m;
    if(l.type==='identifier'){if(fv){const id=addUnit(fv,lt);bind(lt,{kind:'unit',id},n,'top');}else bind(lt,{kind:'expr',node:r},n,'assign');}
    else if((m=lt.match(/^([A-Za-z_$][\w$]*)\.prototype\.([A-Za-z_$][\w$]*)$/))){if(fv)addUnit(fv,m[1]+'.'+m[2],m[1]);}
    else if(lt==='module.exports'){f.exports.set('',fv&&!nodeUnit.has(fv.id)?{unit:addUnit(fv,'module.exports')}:{node:r});
     // module.exports = {a, b: c} → named exports a, b
     if(unwrap(r)?.type==='object')for(const p of unwrap(r).namedChildren){if(p.type==='shorthand_property_identifier')f.exports.set(p.text,{local:p.text});else if(p.type==='pair'){const k=p.childForFieldName('key'),v=p.childForFieldName('value');const kn=k?.type==='property_identifier'?k.text:strOf(k);if(kn&&v){const fv2=funcValue(v);if(fv2&&!nodeUnit.has(fv2.id)){addUnit(fv2,'exports.'+kn);f.exports.set(kn,{unit:rel+'::exports.'+kn});}else f.exports.set(kn,v.type==='identifier'?{local:v.text}:{node:v});}}else if(p.type==='method_definition'){const kn=p.childForFieldName('name')?.text;if(kn){addUnit(p,'exports.'+kn);f.exports.set(kn,{unit:rel+'::exports.'+kn});}}}if(fv&&!nodeUnit.has(fv.id)){const nm=fv.childForFieldName?.('name')?.text??'module.exports';addUnit(fv,nm);if(nm!=='module.exports')bind(nm,{kind:'unit',id:rel+'::'+nm},null);}}
    else if((m=lt.match(/^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/))){f.exports.set(m[1],{node:r});if(fv&&!nodeUnit.has(fv.id))addUnit(fv,'exports.'+m[1]);}
    else if((m=lt.match(/^this\.([A-Za-z_$][\w$]*)$/))||(m=lt.match(/^_this\.([A-Za-z_$][\w$]*)$/))){const cls=classScope(n);if(cls){if(fv)addUnit(fv,cls+'.'+m[1],cls);else if(!f.fields.has(cls+'#.'+m[1]))f.fields.set(cls+'#.'+m[1],{node:r});}else pending.push({n,prop:m[1],r,fv});}
    else if((m=lt.match(/^([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*)|\[["']([\w$]+)["']\])$/))){const pn=m[2]??m[3];if(fv)addUnit(fv,m[1]+'.'+pn,m[1]);else if(!f.props.has(m[1]+'.'+pn))f.props.set(m[1]+'.'+pn,{node:r});}
    break;}
   case 'import_statement':{const src=strOf(n.childForFieldName('source'));if(src==null)break;if(/^import\s+type\b/.test(n.text))break;
    f.imports.push({src,line:n.startPosition.row+1,kind:'import'});
    const clause=n.namedChildren.find(c=>c.type==='import_clause');
    if(clause)for(const c of clause.namedChildren){
     if(c.type==='identifier')bind(c.text,{kind:'module',src,member:'default'},null);
     else if(c.type==='namespace_import'){const id=c.namedChildren.find(x=>x.type==='identifier');if(id)bind(id.text,{kind:'module',src},null);}
     else if(c.type==='named_imports')for(const s of c.namedChildren){if(s.type!=='import_specifier'||/^type\s/.test(s.text))continue;const nm=s.childForFieldName('name')?.text,al=s.childForFieldName('alias')?.text??nm;if(nm)bind(al,{kind:'module',src,member:nm},null);}
    }break;}
   case 'export_statement':{const src=strOf(n.childForFieldName('source'));const decl=n.childForFieldName('declaration');const isDefault=/^export\s+default\b/.test(n.text);
    if(src!=null){f.imports.push({src,line:n.startPosition.row+1,kind:'re-export'});const ec=n.namedChildren.find(c=>c.type==='export_clause');
     if(ec)for(const s of ec.namedChildren){if(s.type!=='export_specifier')continue;const nm=s.childForFieldName('name')?.text,al=s.childForFieldName('alias')?.text??nm;f.exports.set(al,{module:src,member:nm});}
     else if(/^export\s+\*\s+as\s+(\w+)/.test(n.text))f.exports.set(n.text.match(/^export\s+\*\s+as\s+(\w+)/)[1],{module:src});
     else (f.star??=[]).push(src);}
    else if(decl){
     if(isDefault){const fv=funcValue(decl);if(fv&&!decl.childForFieldName?.('name')){addUnit(fv,'default');f.exports.set('default',{unit:rel+'::default'});}else f.exports.set('default',{node:decl});}
     else{const nm=decl.childForFieldName?.('name')?.text;if(nm)f.exports.set(nm,{local:nm});for(const d of decl.namedChildren.filter(c=>c.type==='variable_declarator')){const dn=d.childForFieldName('name');if(dn?.type==='identifier')f.exports.set(dn.text,{local:dn.text});}}}
    else{const ec=n.namedChildren.find(c=>c.type==='export_clause');if(ec)for(const s of ec.namedChildren){if(s.type!=='export_specifier')continue;const nm=s.childForFieldName('name')?.text,al=s.childForFieldName('alias')?.text??nm;f.exports.set(al,{local:nm});}
     else if(isDefault){const v=n.namedChildren.at(-1);if(v)f.exports.set('default',{node:v});}}
    break;}
  }
  if(FUNC.has(n.type)){const ps=n.childForFieldName('parameters')??(n.childForFieldName('parameter')?{namedChildren:[n.childForFieldName('parameter')]}:null);
   const names=[];const collect=x=>{if(!x)return;if(x.type==='identifier'||x.type==='shorthand_property_identifier_pattern')names.push(x.text);else if(x.type==='required_parameter'||x.type==='optional_parameter')collect(x.childForFieldName('pattern'));else if(x.type==='assignment_pattern')collect(x.childForFieldName('left'));else for(const c of x.namedChildren??[])if(c.type!=='type_annotation')collect(c);};
   for(const c of ps?.namedChildren??[])collect(c);for(const nm of names)bind(nm,{kind:'param'},n,'param');}
  for(const c of n.namedChildren)visit1(c);
 }
 const pending=[];
 function enclosingProtoClass(n){for(let p=n.parent;p;p=p.parent){if(nodeUnit.has(p.id)){const u=f.units.get(nodeUnit.get(p.id));return u?.cls??null;}}return null;}
 visit1(tree.rootNode);
 // ES5 compiled classes: `function Converter(){}` + `Converter.prototype.x = …` → constructor unit gets cls.
 for(const u of f.units.values())if(!u.cls&&[...f.units.values()].some(v=>v.cls===u.name))u.cls=u.name;
 for(const x of pending){const cls=enclosingProtoClass(x.n);if(!cls)continue;if(x.fv){if(!nodeUnit.has(x.fv.id))addUnit(x.fv,cls+'.'+x.prop,cls);}else if(!f.fields.has(cls+'#.'+x.prop))f.fields.set(cls+'#.'+x.prop,{node:x.r});}
 // Pass 2: calls / refs with enclosing unit + condition context.
 // Framework entries (JS): commander .command('x').action(fn), yargs .command('x', d, b, fn), Express/Koa/Fastify app.get('/p', fn).
 // Inline handlers become their own units so a route can include one command without the others.
 f.framework=[];const srcs=new Set([...f.imports.map(i=>i.src),...[...body.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m=>m[1])]);const has=re=>[...srcs].some(x=>re.test(x));
 const WEB=has(/^(express|koa|@koa\/router|koa-router|fastify|hono|restify|polka|@tinyhttp\/app|router)$/)?([...srcs].find(x=>/^(express|koa|@koa\/router|koa-router|fastify|hono|restify|polka|@tinyhttp\/app|router)$/.test(x))):null;
 const CLI=has(/^(commander|yargs|yargs\/yargs|cac|sade)$/)?[...srcs].find(x=>/^(commander|yargs|yargs\/yargs|cac|sade)$/.test(x)).replace(/\/yargs$/,''):null;
 const fwHandler=(node,name,entry)=>{const fv=funcValue(node);if(fv){const id=nodeUnit.get(fv.id)??addUnit(fv,name);f.framework.push({...entry,unit:id});}else if(unwrap(node)?.type==='identifier'||unwrap(node)?.type==='member_expression')f.framework.push({...entry,handlerNode:unwrap(node)});};
 // router.route('/x').get(a).post(b): the path sits on an earlier call in the chain
 const routeOf=callee=>{let o=callee.childForFieldName('object');for(let i=0;o&&i<8;i++){o=unwrap(o);if(o?.type!=='call_expression')return null;const c=unwrap(o.childForFieldName('function'));if(c?.type==='member_expression'&&propName(c.childForFieldName('property'))==='route'){const s=strOf(o.childForFieldName('arguments')?.namedChildren?.[0]);return s&&/^[/*]/.test(s)?s:null;}o=c?.childForFieldName?.('object');}return null;};
 (function fw(n){
  if(n.type==='call_expression'){const callee=unwrap(n.childForFieldName('function')),args=n.childForFieldName('arguments')?.namedChildren??[];const prop=callee?.type==='member_expression'?propName(callee.childForFieldName('property')):null;const line=n.startPosition.row+1,regNode=n;
   if(CLI&&prop==='action'&&args[0]){let o=callee.childForFieldName('object'),nm=null;for(let i=0;o&&i<8&&!nm;i++){o=unwrap(o);if(o?.type==='call_expression'){const c=unwrap(o.childForFieldName('function'));if(c?.type==='member_expression'&&propName(c.childForFieldName('property'))==='command'){nm=strOf(o.childForFieldName('arguments')?.namedChildren?.[0])?.split(/\s/)[0]??null;}o=c?.childForFieldName?.('object');}else break;}
    fwHandler(args[0],'command '+(nm??'(主程式)'),{kind:'command',framework:CLI,name:nm??'(主程式)',line,regNode,via:n.text.replace(/\s+/g,' ').slice(0,60)});}
   else if(CLI&&prop==='command'&&args.length>=2&&strOf(args[0])!=null){const h=args.slice(1).reverse().find(a=>funcValue(a)||unwrap(a)?.type==='identifier'&&args.indexOf(a)>=3);const nm=strOf(args[0]).split(/\s/)[0];if(h)fwHandler(h,'command '+nm,{kind:'command',framework:CLI,name:nm,line,regNode,via:n.text.replace(/\s+/g,' ').slice(0,60)});}
   else if(WEB&&/^(get|post|put|delete|del|patch|all|head|options)$/.test(prop??'')&&(args.length>=2&&/^[/*]/.test(strOf(args[0])??'')||args.length>=1&&routeOf(callee))){const meth=prop==='all'?'ALL':prop==='del'?'DELETE':prop.toUpperCase(),direct=/^[/*]/.test(strOf(args[0])??''),pth=direct?strOf(args[0]):routeOf(callee);
    for(const h of args.slice(direct?1:0))fwHandler(h,meth+' '+pth,{kind:'route',framework:WEB,name:meth+' '+pth,method:meth,path:pth,line,regNode,via:n.text.replace(/\s+/g,' ').slice(0,60)});}
   else if(WEB&&prop==='route'&&args[0]&&unwrap(args[0])?.type==='object'){const o=unwrap(args[0]),get=k=>o.namedChildren.find(p=>p.type==='pair'&&(p.childForFieldName('key')?.text===k||strOf(p.childForFieldName('key'))===k))?.childForFieldName('value');const pth=strOf(get('url'))??strOf(get('path')),meth=(strOf(get('method'))??'GET').toUpperCase();if(pth&&get('handler'))fwHandler(get('handler'),meth+' '+pth,{kind:'route',framework:WEB,name:meth+' '+pth,method:meth,path:pth,line,regNode,via:n.text.replace(/\s+/g,' ').slice(0,60)});}}
  for(const c of n.namedChildren)fw(c);})(tree.rootNode);
 const unitOf=n=>{for(let p=n;p;p=p.parent)if(nodeUnit.has(p.id))return nodeUnit.get(p.id);return TOP;};
 for(const e of f.framework){e.reg=unitOf(e.regNode.parent);delete e.regNode;}
 function context(n){
  // Nearest guard inside the same unit: if condition, ternary, &&/||, catch, error-event handler.
  const ctx=[];let prev=n;
  for(let p=n.parent;p&&!nodeUnit.has(p.id);prev=p,p=p.parent){
   if(p.type==='if_statement'&&prev.id!==p.childForFieldName('condition')?.id){const c=p.childForFieldName('condition')?.text??'';const inElse=p.childForFieldName('alternative')&&prev.id===p.childForFieldName('alternative').id;ctx.push((inElse?'否則（不是 ':'當 ')+c.replace(/^\(|\)$/g,'').replace(/\s+/g,' ').slice(0,70)+(inElse?'）':''));}
   else if(p.type==='ternary_expression'&&prev.id!==p.childForFieldName('condition')?.id)ctx.push('當 '+(p.childForFieldName('condition')?.text??'').replace(/\s+/g,' ').slice(0,70)+(prev.id===p.childForFieldName('alternative')?.id?' 不成立':''));
   else if(p.type==='catch_clause')ctx.push('出錯時（catch）');
   else if(p.type==='switch_case')ctx.push('case '+(p.childForFieldName('value')?.text??'').slice(0,40));
   else if(p.type==='arguments'&&FUNC.has(prev.type)){const call=p.parent,cal=call?.childForFieldName('function'),ev=strOf(p.namedChildren[0]);if(cal?.type==='member_expression'&&/^(on|once|addListener)$/.test(propName(cal.childForFieldName('property'))??'')&&ev)ctx.push('事件 '+ev);}
  }
  for(let p=n.parent;p;p=p.parent){if(p.type==='arguments'&&FUNC.has(p.namedChildren.find(c=>c.startIndex<=n.startIndex&&c.endIndex>=n.endIndex)?.type)){const call=p.parent,cal=call?.childForFieldName('function'),ev=strOf(p.namedChildren[0]);if(cal?.type==='member_expression'&&/^(on|once)$/.test(propName(cal.childForFieldName('property'))??'')&&ev&&!ctx.includes('事件 '+ev))ctx.push('事件 '+ev);}if(nodeUnit.has(p.id)&&!FUNC.has(p.type))break;}
  return ctx.slice(0,3);
 }
 function visit2(n){
  if(n.type==='call_expression'||n.type==='new_expression'){
   const callee=n.type==='new_expression'?n.childForFieldName('constructor'):n.childForFieldName('function');
   const args=n.childForFieldName('arguments');const a0=args?.namedChildren?.[0];
   if(callee){
    const line=n.startPosition.row+1;
    if(callee.type==='identifier'&&callee.text==='require'&&!f.bindings.has('require',callee.startIndex)){const s=strOf(a0);if(s!=null)f.imports.push({src:s,line,kind:'require',unit:unitOf(n)});else f.dynamic.push({line,unit:unitOf(n),why:'require 的路徑是算出來的：'+n.text.slice(0,60)});}
    else if(callee.type==='import'){const s=strOf(a0);if(s!=null)f.imports.push({src:s,line,kind:'dynamic-import',unit:unitOf(n)});else{f.dynamic.push({line,unit:unitOf(n),why:'import() 的路徑是算出來的：'+n.text.slice(0,60)});
     // `const importSrc = rel => import(join(binDir,'..',rel))`: a helper whose import path is its own parameter;
     // calls like importSrc('run.mjs') are then resolved from the literal (the `'..'` pieces kept)
     for(let p=n.parent,d=0;p&&d<6;p=p.parent,d++){if(p.type==='variable_declarator'&&/arrow_function|function_expression|^function$/.test(p.childForFieldName('value')?.type??'')||p.type==='function_declaration'){const fn=p.type==='function_declaration'?p:p.childForFieldName('value');const prm=(fn.childForFieldName('parameters')??fn.childForFieldName('parameter'))?.text.replace(/[()\s]/g,'').split(',')[0];const nm=p.childForFieldName('name')?.text;
      if(nm&&prm&&new RegExp('\\b'+prm+'\\b').test(a0?.text??'')){(f.importHelpers??=new Map()).set(nm,{line,ups:(a0.text.match(/['"]\.\.['"]/g)??[]).length});}break;}}}}
    else{
     if(unwrap(callee)?.type==='subscript_expression'){const idx=unwrap(callee).childForFieldName('index');if(!strOf(idx)&&idx?.type!=='number')f.dynamic.push({line,unit:unitOf(n),call:true,why:'用算出來的名稱呼叫：'+n.text.replace(/\s+/g,' ').slice(0,60)});}
     f.calls.push({node:callee,prop:unwrap(callee)?.type==='member_expression'?propName(unwrap(callee).childForFieldName('property')):null,isNew:n.type==='new_expression',line,col:n.startPosition.column,unit:unitOf(n),text:n.text.replace(/\s+/g,' ').slice(0,90),arg0:a0?a0.text.replace(/\s+/g,' ').slice(0,40):null,ctx:context(n)});
     if(args)for(const a of args.namedChildren){const ua=unwrap(a);if(ua?.type==='identifier'||ua?.type==='member_expression')f.refs.push({node:ua,line,unit:unitOf(n)});}
    }
   }
  }else if(n.type==='member_expression'&&/^process\.(stdin|argv|env)\b/.test(n.text)&&!(n.parent?.type==='member_expression'&&n.parent.childForFieldName('object')?.id===n&&/^process\.(stdin|argv|env)$/.test(n.text)&&n.parent.parent?.type==='call_expression'&&false)){
   if(/^process\.(stdin|argv|env)$/.test(n.text)||/^process\.env\.\w+$/.test(n.text))f.calls.push({node:n,ref:true,line:n.startPosition.row+1,col:n.startPosition.column,unit:unitOf(n),text:(n.parent?.text??n.text).replace(/\s+/g,' ').slice(0,90),ctx:context(n)});
  }else if(['pair','array','return_statement'].includes(n.type)){for(const c of n.namedChildren){if(c.type==='identifier'&&n.type!=='pair')f.refs.push({node:c,line:c.startPosition.row+1,unit:unitOf(n)});}if(n.type==='pair'){const v=n.childForFieldName('value');if(v?.type==='identifier')f.refs.push({node:v,line:v.startPosition.row+1,unit:unitOf(n)});}}
  for(const c of n.namedChildren)visit2(c);
 }
 visit2(tree.rootNode);
 if(f.importHelpers)for(const c of f.calls){const nm=c.node?.type==='identifier'?c.node.text:null,h=nm&&f.importHelpers.get(nm);if(!h||!c.arg0||!/^['"`][^'"`$]+['"`]$/.test(c.arg0))continue;
  const lit=c.arg0.slice(1,-1),src=(h.ups?'../'.repeat(h.ups):'')+lit.replace(/^\.\//,'');f.imports.push({src:src.startsWith('.')?src:'./'+src,line:c.line,kind:'dynamic-import',helper:nm,unit:c.unit});
  const i=f.dynamic.findIndex(d=>d.line===h.line);if(i>=0)f.dynamic[i].resolvedByHelper=nm;}
 if(f.importHelpers)f.dynamic=f.dynamic.filter(d=>!d.resolvedByHelper);
 f.tree=tree;f.bodySha=sha256(body);
 return f;
}
// ---- graph ----
export function pyRootsOf(all,set=new Set(all)){const r=new Set(['']);for(const f of all){if(!/\/__init__\.py$/.test(f))continue;const pkg=path.posix.dirname(f),parent=path.posix.dirname(pkg);if(!set.has((parent==='.'?'':parent+'/')+'__init__.py'))r.add(parent==='.'?'':parent);}
 return [...r].sort((a,b)=>(a!=='')-(b!=='')||(a!=='src')-(b!=='src')||a.split('/').length-b.split('/').length).slice(0,24);}
// Build output the repo itself ignores (packages/x/dist/ when packages/x/src/ exists): read the source, not the bundle.
const _ign=new Map();
export function ignoredBuild(root){root=path.resolve(root);if(_ign.has(root))return _ign.get(root);let dirs=[];
 const r=spawnSync('git',['-C',root,'ls-files','-o','-i','--exclude-standard','--directory'],{encoding:'utf8',maxBuffer:32*1024*1024});
 if(r.status===0)dirs=r.stdout.split('\n').filter(d=>/(^|\/)(dist|build|out|lib|esm|cjs)\/$/.test(d)&&!/node_modules/.test(d)&&fs.existsSync(path.join(root,d.replace(/(dist|build|out|lib|esm|cjs)\/$/,'src'))));
 const f=rel=>dirs.some(d=>rel.startsWith(d));_ign.set(root,f);return f;}
export function buildGraph(ast,root,{files=null,focus=[]}={}){
 root=path.resolve(root);if(!ast?.ok)throw Error('AST 未載入');
 const ign=ignoredBuild(root);const all=(files??listFiles(root)).filter(r=>!SKIP_DIR.test(r)&&!ign(r));
 const set=new Set(all);
 const g={root,files:new Map(),failed:[],set,pkgCache:new Map()};
 const parseList=all.filter(r=>JS_FILE.test(r)&&!TYPE_DECL.test(r)||ast.langs.python&&PY_FILE.test(r)||isScriptNoExt(root,r,!!ast.langs.python));
 // import roots: every folder holding a top-level package (repo root, src/, and monorepo packages/x/src)
 g.pyRoots=pyRootsOf(all,set);
 for(const r of parseList){const f=parseFile(ast,root,r);if(!f)continue;if(f.ok)g.files.set(r,f);else g.failed.push({file:r,error:f.error,minified:!!f.minified});}
 g.resolveImport=(from,src)=>resolveImport(g,from,src);
 g.canonCache=new Map();
 for(const f of g.files.values()){
  for(const im of f.imports)im.target=f.lang==='python'?resolvePy(g,f.rel,im.src,im.member):resolveImport(g,f.rel,im.src);
  for(const c of f.calls){c.canon=c.synthetic??canonOf(g,f,c.node,c.unit);if(c.isNew&&c.canon)c.canon+='#';c.cap=capOf(c.canon);if(f.lang==='python')pyCapFix(c);if(c.cap==='env'){c.envName=f.lang==='python'?(c.arg0?.match(/^['"]([\w.-]+)['"]$/)?.[1]??c.text.match(/environ\[['"]([\w.-]+)/)?.[1]??null):c.canon.split('.')[2]??null;}}
  for(const r of f.refs)r.canon=canonOf(g,f,r.node,r.unit);
  for(const e of f.framework??[]){if(e.handlerNode&&!e.unit){const ts=targetsOf(g,canonOf(g,f,e.handlerNode,e.reg??f.rel+'::<top>'));e.unit=ts[0]??null;}delete e.handlerNode;e.file=f.rel;
   // @cli.command under `def cli()` group: reaching the group function reaches its commands too
   if(e.owner){const u=[...f.units.values()].find(u=>u.name===e.owner);if(u&&u.id!==e.unit)e.ownerUnit=u.id;}}
 }
 g.framework=[...g.files.values()].flatMap(f=>(f.framework??[]).filter(e=>e.unit));g.fwUnits=new Map(g.framework.map(e=>[e.unit,e]));
 return g;
}
function isScriptNoExt(root,r,py=false){if(path.posix.extname(r)||!/(^|\/)(bin|cli|scripts)\//.test(r))return false;try{const h=fs.readFileSync(path.join(root,r),'utf8').slice(0,80);return /^#!.*\bnode\b/.test(h)||py&&/^#!.*\bpython/.test(h);}catch{return false;}}
// open(path, 'w') writes, open(path) reads; print(..., file=sys.stderr) is the error stream.
function pyCapFix(c){const a=c.pyArgs;if(!a)return;
 if(c.canon==='global.open'||/^py:(io|codecs)\.open$/.test(c.canon)||/^py:pathlib\.\w*Path\(\)\.open$/.test(c.canon??'')){const mode=(c.canon==='global.open'||/^py:(io|codecs)/.test(c.canon)?a.pos[1]:a.pos[0])??a.kw.mode??'';c.cap=/[wax+]/.test(mode.replace(/^[rbuf]*(['"])/,'$1'))?'write-file':'read-file';c.mode=mode||"'r'";}
 if(c.canon==='global.print'&&a.kw.file){c.cap=/stderr/.test(a.kw.file)?'stderr':/stdout/.test(a.kw.file)?'stdout':null;}}
function readPkg(g,dir){if(g.pkgCache.has(dir))return g.pkgCache.get(dir);let p=null;try{p=JSON.parse(fs.readFileSync(path.join(g.root,dir,'package.json'),'utf8'));}catch{}g.pkgCache.set(dir,p);return p;}
const EXT=['.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs'];
function resolveFile(g,base){
 base=path.posix.normalize(base).replace(/\/+$/,'')||'.';if(base.startsWith('../')||base==='..')return null;
 const has=p=>g.set.has(p);
 if(has(base)&&!g.set.has(base+'/package.json'))return base;
 const ext=path.posix.extname(base);
 if(['.js','.jsx','.mjs','.cjs'].includes(ext)){for(const e of ['.ts','.tsx','.mts','.cts']){const p=base.slice(0,-ext.length)+e;if(has(p))return p;}}
 for(const e of EXT)if(has(base+e))return base+e;
 const pkg=readPkg(g,base);if(pkg){const m=pickExport(pkg)??pkg.main;if(typeof m==='string'){const p=resolveFile(g,path.posix.join(base,m));if(p)return p;}}
 for(const e of EXT)if(has(base+'/index'+e))return base+'/index'+e;
 return null;
}
function pickExport(pkg){let e=pkg?.exports;if(!e)return null;if(typeof e==='string')return e;if(e['.']!==undefined)e=e['.'];const walk=x=>typeof x==='string'?x:Array.isArray(x)?walk(x[0]):x&&typeof x==='object'?walk(x.require??x.node??x.import??x.default??Object.values(x)[0]):null;return walk(e);}
// Workspace packages (monorepo): name -> folder, so `import x from '@scope/pkg'` resolves inside the repo.
function workspaceDirs(g){if(g.ws)return g.ws;g.ws=new Map();for(const r of g.set){if(!r.endsWith('package.json'))continue;const dir=path.posix.dirname(r);const p=readPkg(g,dir==='.'?'':dir);if(p?.name)g.ws.set(p.name,dir==='.'?'':dir);}return g.ws;}
// tsconfig/jsconfig `paths` (e.g. "@/*": ["./src/app/*"]) from the nearest config above the importing file.
function tsPaths(g,dir){g.tsp??=new Map();if(g.tsp.has(dir))return g.tsp.get(dir);let r=null;
 for(const n of ['tsconfig.json','jsconfig.json']){const f=dir?dir+'/'+n:n;if(!g.set.has(f)&&!fs.existsSync(path.join(g.root,f)))continue;
  try{const t=fs.readFileSync(path.join(g.root,f),'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:"'])\/\/.*$/gm,'$1').replace(/,(\s*[}\]])/g,'$1');const co=JSON.parse(t).compilerOptions??{};
   if(co.paths){r={base:path.posix.join(dir,co.baseUrl??'.'),paths:co.paths,file:f};break;}}catch{}}
 if(!r&&dir&&dir!=='.')r=tsPaths(g,path.posix.dirname(dir)==='.'?'':path.posix.dirname(dir));g.tsp.set(dir,r);return r;}
function aliasResolve(g,from,src){const d=path.posix.dirname(from);const tp=tsPaths(g,d==='.'?'':d);if(!tp)return null;
 for(const [k,vs] of Object.entries(tp.paths)){const star=k.endsWith('*'),pre=star?k.slice(0,-1):k;if(star?!src.startsWith(pre):src!==k)continue;
  for(const v of [].concat(vs)){const p=resolveFile(g,path.posix.join(tp.base,star?v.replace('*',src.slice(pre.length)):v));if(p)return {type:'file',file:p,alias:tp.file};}
  return {type:'unresolved',src,alias:tp.file};}
 return null;}
export function resolveImport(g,from,src){
 const name=src.replace(/^node:/,'');
 if(src.startsWith('node:')||BUILTINS.has(name))return {type:'builtin',name:name==='fs/promises'?'fs/promises':name};
 if(src.startsWith('.')){const p=resolveFile(g,path.posix.join(path.posix.dirname(from),src));return p?{type:'file',file:p}:{type:'unresolved',src};}
 const al=aliasResolve(g,from,src);if(al)return al;
 const m=src.match(/^(@[^/]+\/[^/]+|[^/]+)(\/.*)?$/);const ws=workspaceDirs(g);
 if(m&&ws.has(m[1])){const dir=ws.get(m[1]);const p=resolveFile(g,dir?(m[2]?dir+m[2]:dir):(m[2]?m[2].slice(1):'.'));if(p)return {type:'file',file:p,workspace:m[1]};}
 return {type:'package',name:m?m[1]:src,sub:m?.[2]??''};
}
function modCanon(t){if(!t)return null;if(t.type==='builtin')return (t.py?'py:':'node:')+t.name;if(t.type==='file')return 'file:'+t.file+'|';if(t.type==='package')return 'pkg:'+t.name+(t.sub??'');return null;}
// Expression -> canonical name. Flat per-file scope (documented limit: shadowed names may mis-resolve).
function canonOf(g,f,node,unit,depth=0){
 if(f.lang==='python')return pyCanon(g,f,node,unit,depth,PYH);
 node=unwrap(node);if(!node||depth>12)return null;
 const C=(n,d=depth+1)=>canonOf(g,f,n,unit,d);
 switch(node.type){
  case 'identifier':{if(/^(_this|self|that|_self)$/.test(node.text)){const u=f.units.get(unit);if(u?.cls)return 'local:'+f.rel+'::'+u.cls+'#';}
   const b=f.bindings.get(node.text,node.startIndex);if(b)return bindingCanon(g,f,node.text,b,depth);if(b===null)return null;return GLOBALS.has(node.text)?'global.'+node.text:null;}
  case 'this':{const u=f.units.get(unit);return u?.cls?'local:'+f.rel+'::'+u.cls+'#':null;}
  case 'member_expression':{const obj=node.childForFieldName('object'),p=propName(node.childForFieldName('property'));if(!p)return null;
   if(obj?.type==='identifier'&&obj.text==='_this'&&!f.bindings.has('_this',obj.startIndex)){const u=f.units.get(unit);if(u?.cls)return normalize(g,'local:'+f.rel+'::'+u.cls+'#.'+p);}
   const base=C(obj);return base?normalize(g,base+'.'+p):null;}
  case 'subscript_expression':{const s=strOf(node.childForFieldName('index'));if(s==null)return null;const base=C(node.childForFieldName('object'));return base?normalize(g,base+'.'+s):null;}
  case 'call_expression':{const fn=unwrap(node.childForFieldName('function')),a=node.childForFieldName('arguments')?.namedChildren??[];
   if(fn?.type==='identifier'&&fn.text==='require'&&!f.bindings.has('require',fn.startIndex)){const s=strOf(a[0]);return s==null?null:modCanon(resolveImport(g,f.rel,s));}
   if(fn?.type==='identifier'&&/^__import(Default|Star)$|^_interopRequire(Default|Wildcard)$/.test(fn.text)){const inner=C(a[0]);return inner?(/Default/.test(fn.text)?inner+'!d':inner):null;}
   if(fn?.type==='member_expression'&&/^(bind|call|apply)$/.test(propName(fn.childForFieldName('property'))??''))return C(fn.childForFieldName('object'));
   if(fn&&['function_expression','function','arrow_function'].includes(fn.type)){const body=fn.childForFieldName('body');const ret=body?.namedChildren?.filter(c=>c.type==='return_statement').at(-1);return ret?.namedChildren[0]?C(ret.namedChildren[0]):null;}
   const b=C(fn);return b?b+'()':null;}
  case 'new_expression':{const b=C(node.childForFieldName('constructor'));return b?b+'#':null;}
  case 'await_expression':return C(node.namedChildren[0]);
  // a || b, a ?? b, c ? a : b: either side may run; prefer the side that is a known capability, else the first resolvable.
  case 'binary_expression':case 'ternary_expression':{const op=node.childForFieldName('operator')?.text;if(node.type==='binary_expression'&&!['||','??','&&'].includes(op))return null;
   const sides=node.type==='ternary_expression'?[node.childForFieldName('consequence'),node.childForFieldName('alternative')]:[node.childForFieldName('left'),node.childForFieldName('right')];
   const cs=sides.map(x=>C(x)).filter(Boolean);return cs.find(c=>capOf(c)||/^(node:|pkg:)/.test(c))??cs[0]??null;}
  case 'function_expression':case 'arrow_function':case 'function':return null;
 }
 return null;
}
const PYH={normalize:(g,c)=>normalize(g,c),targetsOf:(g,c)=>targetsOf(g,c),findUnit:(g,id)=>findUnit(g,id),capOf:c=>capOf(c),modCanon:t=>modCanon(t)};
function normalize(g,c){
 c=c.replace(/!d\.default(?=\.|#|$)/,'').replace(/!d/,'');
 c=c.replace(/^node:fs\.promises\./,'node:fs/promises.').replace(/^node:(\w+)\.default(?=\.|$)/,'node:$1');
 // Field of a class instance assigned in its constructor: Class#.field -> that expression's canon.
 const m=c.match(/^local:([^:]+)::([\w$]+)#\.([\w$]+)(.*)$/);
 if(m){const f=g.files.get(m[1]);const fb=f?.fields.get(m[2]+'#.'+m[3]);if(fb&&!fb.busy){fb.busy=true;try{const inner=canonOf(g,f,fb.node,m[1]+'::'+m[2],0);if(inner)return normalize(g,inner+m[4]);}finally{fb.busy=false;}}}
 // Property set on a local function/object: helper.Converter = X -> X.
 const p=c.match(/^local:([^:]+)::([\w$]+)\.([\w$]+)(.*)$/);
 if(p){const f=g.files.get(p[1]);const pb=f?.props.get(p[2]+'.'+p[3]);if(pb&&!pb.busy&&!f.units.has(p[1]+'::'+p[2]+'.'+p[3])){pb.busy=true;try{const inner=canonOf(g,f,pb.node,p[1]+'::<top>',0);if(inner)return normalize(g,inner+p[4]);}finally{pb.busy=false;}}}
 return c;
}
function bindingCanon(g,f,name,b,depth){
 if(f.lang==='python')return pyBinding(g,f,b,depth,PYH);
 if(b.kind==='unit')return 'local:'+b.id;
 if(b.kind==='class')return 'local:'+f.rel+'::'+b.cls;
 if(b.kind==='module'){const t=resolveImport(g,f.rel,b.src);const base=modCanon(t);if(!base)return null;return b.member?normalize(g,base+'.'+b.member):base;}
 if(b.kind==='expr'){if(b.busy)return null;b.busy=true;try{
  // Several assignments (transport = a; transport = b): prefer the one that is a known capability.
  const cs=[b.node,...(b.alts??[])].map(n=>canonOf(g,f,n,f.rel+'::<top>',depth+1)).filter(Boolean).map(c=>b.member?normalize(g,c+'.'+b.member):c);
  return cs.find(c=>capOf(c)||/^(node:|pkg:)/.test(c))??cs[0]??null;}finally{b.busy=false;}}
 return null;
}
// Canon -> target unit ids (local functions, class methods, exported symbols across files).
export function targetsOf(g,canon,seen=new Set()){
 if(!canon||seen.has(canon)||seen.size>40)return [];seen.add(canon);
 let m;
 if((m=canon.match(/^file:([^|]+)\|(.*)$/))&&g.files.has(m[1])){
  // file:rel|[.export][rest]  rest may be .member, #, #.method, ()
  const em=m[2].match(/^\.([\w$]+)(.*)$/);m=[null,m[1],em?em[1]:'',em?em[2]:m[2],''];
  const f=g.files.get(m[1]);const exp=m[2]??'',rest=m[3]??'',inst=m[4];
  const e=f.exports.get(exp)??(exp===''?null:exp==='default'?f.exports.get(''):null);
  let target=null;
  if(e?.unit)target='local:'+e.unit;else if(e?.local){const b=f.bindings.get(e.local);target=b?bindingCanon(g,f,e.local,b,0):null;if(!target&&f.units.has(f.rel+'::'+e.local))target='local:'+f.rel+'::'+e.local;}
  else if(e?.node)target=canonOf(g,f,e.node,f.rel+'::<top>');
  else if(!e&&exp&&f.lang==='python'&&/(^|\/)__init__\.py$/.test(f.rel)){const dir=path.posix.dirname(f.rel);const sub=['.py','/__init__.py'].map(x=>(dir==='.'?'':dir+'/')+exp+x).find(x=>g.files.has(x));if(sub)return targetsOf(g,'file:'+sub+'|'+rest+inst,seen);if(f.star)for(const s of f.star){const t=resolvePy(g,f.rel,s);if(t.type==='file'){const r=targetsOf(g,'file:'+t.file+'|.'+exp+rest+inst,seen);if(r.length)return r;}}}
  else if(e?.module){const t=resolveImport(g,f.rel,e.module);const b=modCanon(t);target=b?(e.member?b+'.'+e.member:b):null;}
  else if(f.exports.has('')){const whole=canonOf(g,f,f.exports.get('').node,f.rel+'::<top>');target=whole?whole+'.'+exp:null;}
  else if(exp&&f.star){for(const s of f.star){const t=resolveImport(g,f.rel,s);if(t.type==='file'){const r=targetsOf(g,'file:'+t.file+'|.'+exp+rest+inst,seen);if(r.length)return r;}}}
  else if(!exp&&!rest){return [f.rel+'::<top>'];}
  if(!target&&!exp&&!rest)return [f.rel+'::<top>'];
  // module-level object literal export (helper["Converter"] = …) — fall back to local same-name unit.
  if(!target&&exp){const b=f.bindings.get(exp);if(b)target=bindingCanon(g,f,exp,b,0);}
  return target?targetsOf(g,normalize(g,target+rest+inst),seen):[];
 }
 if((m=canon.match(/^local:([^:]+)::([\w$@]+)(?:\.([\w$]+))?(#)?(?:\.([\w$]+))?(\(\))?$/))&&g.files.has(m[1])){
  const f=g.files.get(m[1]);const [,rel,name,stat,inst,meth]=m;
  if(inst&&!meth&&!stat){const ctor=f.units.get(rel+'::'+name);return ctor?[ctor.id]:[];}
  if(inst&&meth){const u=f.units.get(rel+'::'+name+'.'+meth);if(u)return [u.id];const parent=superOf(g,f,name);return parent?targetsOf(g,parent+'#.'+meth,seen):[];}
  if(stat){const u=f.units.get(rel+'::'+name+'.'+stat);if(u)return [u.id];
   // helper.Converter where helper is a local function object
   const b=f.bindings.get(stat);return [];}
  const u=f.units.get(rel+'::'+name);if(u)return [u.id];return [];
 }
 if((m=canon.match(/^(local:[^#]+)\(\)(.*)$/)))return [];
 return [];
}
function superOf(g,f,cls){const n=f.supers.get(cls);if(!n)return null;const c=canonOf(g,f,n,f.rel+'::<top>');return c?c.replace(/#$/,''):null;}
export function superUnits(g,u){const f=g.files.get(u.file);const sc=f?superOf(g,f,u.cls):null;return sc?targetsOf(g,sc+'#'):[];}
// Reachability from root units; returns parent map for station paths.
export function reach(g,roots,{classes=null,hints=null,framework='all'}={}){
 const parent=new Map(),queue=[];
 // framework: 'all' | 'none' | Set of handler unit ids this route may enter (others stay off, even if referenced)
 const fwOff=id=>framework!=='all'&&g.fwUnits?.has(id)&&!(framework instanceof Set&&framework.has(id))&&!roots.includes(id);
 const push=(id,from,edge)=>{if(!id||parent.has(id)||fwOff(id))return;parent.set(id,{from,...edge});queue.push(id);};
 for(const r of roots)push(r,null,{why:'入口'});
 const unitFile=id=>id.split('::')[0];
 // Many classes share a method name (plugin registries: XConverter.convert): keep the classes the question names
 // (docx → DocxConverter); words that match most classes (convert) say nothing and are ignored.
 const hintWords=Array.isArray(hints)?hints.filter(h=>h.length>=3):[];
 const byHint=(prop,ids)=>{if(!hintWords.length)return ids;const cls=new Map();for(const t of ids){const u=findUnit(g,t);if(u?.cls)cls.set(u.file+'::'+u.cls,u);}if(cls.size<3)return ids;
  const keep=new Set();for(const h of hintWords){const m=[...cls].filter(([k,u])=>u.cls.toLowerCase().includes(h)||path.posix.basename(u.file).toLowerCase().includes(h));if(m.length&&m.length<=cls.size/2)m.forEach(([k])=>keep.add(k));}
  if(!keep.size)return ids;const out=ids.filter(t=>{const u=findUnit(g,t);return !u?.cls||keep.has(u.file+'::'+u.cls);});
  const rec=(parent.methodPicked??=new Map());if(!rec.has(prop))rec.set(prop,{method:prop,picked:[...keep].map(k=>k.split('::')[1]),total:cls.size});return out;};
 // Method calls on values we cannot type (x.chain().push(t)) link by method name to classes this route instantiates.
 const methodsByName=new Map(),pendingByName=new Map(),seenCls=new Set();
 const instantiate=(u,edge)=>{if(!u?.cls)return;const key=u.file+'::'+u.cls;if(seenCls.has(key))return;seenCls.add(key);
  for(const s of superUnits(g,u)){push(s,edge.from,{...edge,why:'父類別'});instantiate(findUnit(g,s),edge);}
  for(const v of g.files.get(u.file).units.values()){if(v.cls!==u.cls||v.name===u.cls)continue;const short=v.name.split('.').pop();
   if(PROTOCOL.has(short))push(v.id,edge.from,{...edge,why:'執行環境自動呼叫（推論）',inferred:true});
   (methodsByName.get(short)??methodsByName.set(short,[]).get(short)).push(v.id);
   for(const p of pendingByName.get(short)??[])if(byHint(short,[...methodsByName.get(short)]).includes(v.id))push(v.id,p.from,{...p,why:'依方法名推論',inferred:true});}};
 // Context from a wider reach (e.g. the whole API): classes it instantiates are live objects this route may call into.
 for(const cid of classes??[]){const u=findUnit(g,cid);if(!u?.cls)continue;for(const v of g.files.get(u.file).units.values())if(v.cls===u.cls&&v.name!==u.cls)(methodsByName.get(v.name.split('.').pop())??methodsByName.set(v.name.split('.').pop(),[]).get(v.name.split('.').pop())).push(v.id);}
 while(queue.length){
  const id=queue.shift(),rel=unitFile(id),f=g.files.get(rel);if(!f)continue;
  for(const im of f.imports)if(im.unit===id||(!im.unit&&id.endsWith('::<top>'))){if(im.target?.type==='file')push(im.target.file+'::<top>',id,{why:'載入',file:rel,line:im.line});}
  for(const c of f.calls){if(c.unit!==id)continue;
   const ts=c.canon?targetsOf(g,c.canon):[];
   for(const t of ts)push(t,id,{why:c.isNew?'建立':'呼叫',file:rel,line:c.line,text:c.text,...(c.ctx?.length?{ctx:c.ctx}:{})});
   if(c.isNew)for(const t of ts)instantiate(findUnit(g,t),{from:id,file:rel,line:c.line,text:c.text});
   if(f.lang==='python')for(const t of ts){const u=findUnit(g,t);if(u?.cls&&u.name===u.cls){const init=u.file+'::'+u.cls+'.__init__';if(findUnit(g,init))push(init,id,{why:'建立',file:rel,line:c.line,text:c.text});instantiate(u,{from:id,file:rel,line:c.line,text:c.text});}}
   if(!ts.length&&c.prop&&!/^(node:|global\.|pkg:)/.test(c.canon??'')&&!c.cap){const e={from:id,file:rel,line:c.line,text:c.text};
    for(const t of byHint(c.prop,methodsByName.get(c.prop)??[]))push(t,id,{...e,why:'依方法名推論',inferred:true});
    const list=pendingByName.get(c.prop)??pendingByName.set(c.prop,[]).get(c.prop);if(list.length<3)list.push(e);}
  }
  for(const r of f.refs){if(r.unit!==id||!r.canon)continue;for(const t of targetsOf(g,r.canon))push(t,id,{why:'當成回呼傳入',file:rel,line:r.line});}
  for(const e of g.framework??[])if(e.reg===id||e.ownerUnit===id)push(e.unit,id,{why:'框架註冊（'+e.framework+(e.kind==='route'?' 路由 ':' 指令 ')+e.name+'）',file:e.file,line:e.line,text:e.via});
  // Python import_module(f'pkg.parsers.{name}'): pick the module(s) the question names (csv → pkg/parsers/csv.py).
  for(const d of f.dynImports??[]){if(d.unit!==id)continue;for(const pre of d.prefixes){const dir=pre.replace(/\.$/,'').split('.').join('/');
   for(const cand of g.files.values()){if(path.posix.dirname(cand.rel)!==dir)continue;const base=path.posix.basename(cand.rel,'.py');
    if(hints!==true&&!hints?.some(h=>h===base))continue;const e={file:rel,line:d.line,text:'動態載入 '+pre+base,why:hints===true?'動態載入（前綴下的模組都算）':'動態載入（依問句推論）',inferred:true};
    (parent.dynPicked??=[]).push({file:cand.rel,from:rel,line:d.line,prefix:pre});
    push(cand.rel+'::<top>',id,e);for(const u of cand.units.values())if(!u.cls&&u.name!=='<top>'&&u.name!=='<main>'&&!u.name.startsWith('_')&&!u.name.includes('.'))push(u.id,id,e);}}}
 }
 if(parent.methodPicked)parent.methodPicked=[...parent.methodPicked.values()];
 parent.classes=[...seenCls].map(k=>k.split('::')[0]+'::'+k.split('::')[1]);
 return parent;
}
// Library entry: every export (incl. re-exports and export *) is API surface → root units.
export function exportRoots(g,file,seen=new Set()){
 const f=g.files.get(file);if(!f||seen.has(file))return [];seen.add(file);const out=[file+'::<top>'];
 for(const u of f.units.values())if(u.name!=='<top>')out.push(u.id);
 for(const name of f.exports.keys())for(const t of targetsOf(g,'file:'+file+'|'+(name?'.'+name:'')))out.push(t);
 for(const s of f.star??[]){const t=f.lang==='python'?resolvePy(g,file,s):resolveImport(g,file,s);if(t.type==='file')out.push(...exportRoots(g,t.file,seen));}
 // an exported class: its methods are callable by the user
 const extra=[];for(const id of out){const u=findUnit(g,id);if(u?.cls&&u.name===u.cls)for(const v of g.files.get(u.file).units.values())if(v.cls===u.cls)extra.push(v.id);}
 return [...new Set([...out,...extra])];
}
export function findUnit(g,id){const f=g.files.get(id.split('::')[0]);return f?.units.get(id)??null;}
export function pathTo(parent,id){const out=[];let cur=id,guard=0;while(cur&&guard++<60){const p=parent.get(cur);if(!p)break;out.unshift({unit:cur,...p});cur=p.from;}return out;}
// All capability touches in the repo, split by whether the route reaches their unit.
const AGENT_CLI=/(spawn\w*|exec\w*|findSpawnableCli|which|cliCommand|command|bin|cli)\b[^\n]{0,40}?['"`](claude|codex|gemini|cursor-agent|aider|opencode|copilot)['"`]/i;
const AGENT_CLI_STRONG=/findSpawnableCli|cliCommand\s*:/;
export function touches(g,parent){
 const out=[];
 for(const f of g.files.values())for(const c of f.calls){if(!c.cap)continue;const line=f.lines[c.line-1]??'';
  out.push({cap:c.cap,label:CAP_LABEL[c.cap],canon:c.canon,file:f.rel,line:c.line,unit:c.unit,text:c.text,arg0:c.arg0,ctx:c.ctx,envName:c.envName,reached:parent?parent.has(c.unit):null,lineSha256:sha256(line)});}
 const seen=new Set();for(let i=out.length-1;i>=0;i--){const k=out[i].cap+'|'+out[i].file+'|'+out[i].line;if(seen.has(k))out.splice(i,1);else seen.add(k);}
 // Launching an AI agent CLI (claude, codex …) runs on the user's own login and quota: a real-account touch, not just a subprocess.
 for(const f of g.files.values()){if(!f.calls.some(c=>c.cap==='subprocess')&&!AGENT_CLI_STRONG.test(f.lines.join('\n')))continue;const i=f.lines.findIndex(l=>AGENT_CLI.test(l)&&!/^\s*(\/\/|\*|#)/.test(l));if(i<0)continue;
  const near=f.calls.filter(c=>c.cap==='subprocess').sort((a,b)=>Math.abs(a.line-i-1)-Math.abs(b.line-i-1))[0];const unit=near?.unit??[...f.units.keys()][0];
  out.push({cap:'real-account',label:'啟動 AI 代理 CLI（'+f.lines[i].match(AGENT_CLI)[2]+'，用你的登入與額度）',agentCli:f.lines[i].match(AGENT_CLI)[2],file:f.rel,line:i+1,unit,text:f.lines[i].trim().slice(0,120),reached:parent?(parent.has(unit)||[...f.units.keys()].some(u=>parent.has(u))):null,lineSha256:sha256(f.lines[i])});}
 for(const f of g.files.values())for(const d of f.dynamic)out.push({cap:d.call?'dynamic-call':'dynamic',label:CAP_LABEL[d.call?'dynamic-call':'dynamic'],file:f.rel,line:d.line,unit:d.unit,text:d.why,reached:parent?parent.has(d.unit):null,lineSha256:sha256(f.lines[d.line-1]??'')});
 return out;
}
// External packages actually called on the route (not followed into node_modules).
export function externalCalls(g,parent){const m=new Map();for(const f of g.files.values())for(const c of f.calls){if(!c.canon?.startsWith('pkg:')||c.cap||parent&&!parent.has(c.unit))continue;const name=c.canon.slice(4).split(/[.#(]/)[0];if(!m.has(name))m.set(name,{name,file:f.rel,line:c.line,count:0});m.get(name).count++;}return [...m.values()];}
export function stats(g){let units=0,calls=0;for(const f of g.files.values()){units+=f.units.size;calls+=f.calls.length;}return {files:g.files.size,failed:g.failed.length,units,calls,partial:[...g.files.values()].filter(f=>f.errors).length};}
