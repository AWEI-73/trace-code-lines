import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {hash} from './cassette.mjs';
import {tokens} from './language-static.mjs';
// options.mcpToolTables: pluggable patterns for tools declared as data rather than registerTool/.tool calls.
// Each {rowPattern, flags?, files?, requireText?} — rowPattern needs a named group `name` (optionally `description`);
// files is a path regex, requireText must appear in the file (e.g. 'tools/list'). Default none: behaviour unchanged.
export function tableTools(rel,body,tables=[]){
 const out=[];
 for(const [n,t] of tables.entries()){
  if(typeof t?.rowPattern!=='string')throw Error('mcpToolTables['+n+'].rowPattern required');
  if(t.files&&!new RegExp(t.files).test(rel))continue;
  if(t.requireText&&![].concat(t.requireText).every(x=>body.includes(x)))continue;
  const re=new RegExp(t.rowPattern,(t.flags??'').replace(/[gy]/g,'')+'g');
  for(const m of body.matchAll(re)){if(!m.groups?.name)continue;out.push({name:m.groups.name,description:m.groups.description,line:body.slice(0,m.index).split('\n').length,table:t.id??n});}
 }
 return out;
}
export function discoverEntries(root,{mcpToolTables=[]}={}){
 const entries=[],documents=[],files=[],skipped=[];
 function scan(dir){
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
   const p=path.join(dir,e.name),rel=path.relative(root,p).replaceAll('\\','/');
   if(e.isSymbolicLink()){skipped.push({file:rel,reason:'LINK'});continue;}
   if(e.isDirectory()){if(!['.git','node_modules','.venv','__pycache__'].includes(e.name))scan(p);continue;}
   if(!/\.(?:[cm]?js|tsx?|jsx|py|gs|html|md|json)$/i.test(e.name))continue;
   if(fs.statSync(p).size>2*1024*1024){skipped.push({file:rel,reason:'SIZE_LIMIT'});continue;}
   const body=fs.readFileSync(p,'utf8'),sha256=hash(body),lines=body.split(/\r?\n/);files.push({file:rel,sha256});
   if(/(?:^|\/)(?:readme|skill)\.md$/i.test(rel))documents.push({file:rel,sha256});
   const add=(kind,line,signature)=>entries.push({kind,signature,arguments:'UNKNOWN: agent must read the implementation',anchor:{file:rel,line,expect:lines[line-1].trim().slice(0,240),sha256},status:'STATIC_CANDIDATE'});
   lines.forEach((line,i)=>{
    if(/(?:argparse|add_argument|process\.argv|commander|\.command\(|click\.command|__main__)/.test(line))add('command-line',i+1,line.trim());
    if(/(?:app|router)\.(?:get|post|put|patch|delete|route)\s*\(/.test(line))add('web-route',i+1,line.trim());
    if(/^\s*export\s+(?:(?:async\s+)?function|(?:const|class)\s)/.test(line))add('exported-function',i+1,line.trim());
    if(/@.*\.tool/.test(line))add('mcp-tool',i+1,line.trim());
    if(/\.gs$/.test(rel)&&/^\s*function\s+(?:api\w*|doGet|doPost)\s*\(/.test(line))add('gas-api',i+1,line.trim());
    if(/(?:^|\/)SKILL\.md$/i.test(rel)&&/(?:scripts\/|\.py\b|\.mjs\b|\.cjs\b)/.test(line))add('skill-script',i+1,line.trim());
   });
   if(/\.(?:[cm]?[jt]sx?)$/i.test(rel)){
    const t=tokens(body,false,{regexLiterals:true}).filter(t=>t.v!=='\n');
    for(let i=0;i<t.length;i++)if(t[i].kind==='name'&&(t[i].v==='registerTool'||t[i].v==='tool'&&t[i-1]?.v==='.')&&t[i+1]?.v==='('&&t[i+2]?.kind==='string'&&t[i+2].literal&&t[i+3]?.v===','){
     add('mcp-tool',t[i].line,t[i+2].v);
     entries.at(-1).name=t[i+2].v;
     entries.at(-1).registration=t[i].v;
    }
   }
   for(const x of tableTools(rel,body,mcpToolTables)){add('mcp-tool',x.line,x.name);Object.assign(entries.at(-1),{name:x.name,registration:'table',table:x.table,...(x.description?{description:x.description}:{})});}
   if(e.name==='package.json')try{const p=JSON.parse(body);for(const [name,command] of Object.entries(p.scripts??{}))entries.push({kind:'package-script',signature:name,arguments:command,anchor:{file:rel,line:lines.findIndex(l=>l.includes(JSON.stringify(name)))+1,expect:JSON.stringify(name),sha256},status:'STATIC_CANDIDATE'});}catch{}
  }
 }
 scan(root);return {schema:'entry-inventory-v1',root,entries,documents,files,skipped,coverage:'Lexical candidates only. Agent reads README, SKILL and source, adds missed entries and explicit argument formats; computed registrations remain UNKNOWN.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){if(process.argv.length===3&&process.argv[2]==='--help'){console.log('Usage: node discover-entries.mjs repo [--mcp-tables patterns.json]');process.exit(0);}
const i=process.argv.indexOf('--mcp-tables'),mcpToolTables=i>0?JSON.parse(fs.readFileSync(process.argv[i+1],'utf8')):[];
console.log(JSON.stringify(discoverEntries(path.resolve(process.argv[2]),{mcpToolTables:Array.isArray(mcpToolTables)?mcpToolTables:mcpToolTables.mcpToolTables??[]}),null,2));}
