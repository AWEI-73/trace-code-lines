import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {hash} from './cassette.mjs';
export function discoverEntries(root){
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
    if(/(?:registerTool|\.tool\s*\(|@.*\.tool)/.test(line))add('mcp-tool',i+1,line.trim());
    if(/\.gs$/.test(rel)&&/^\s*function\s+(?:api\w*|doGet|doPost)\s*\(/.test(line))add('gas-api',i+1,line.trim());
    if(/(?:^|\/)SKILL\.md$/i.test(rel)&&/(?:scripts\/|\.py\b|\.mjs\b|\.cjs\b)/.test(line))add('skill-script',i+1,line.trim());
   });
   if(e.name==='package.json')try{const p=JSON.parse(body);for(const [name,command] of Object.entries(p.scripts??{}))entries.push({kind:'package-script',signature:name,arguments:command,anchor:{file:rel,line:lines.findIndex(l=>l.includes(JSON.stringify(name)))+1,expect:JSON.stringify(name),sha256},status:'STATIC_CANDIDATE'});}catch{}
  }
 }
 scan(root);return {schema:'entry-inventory-v1',root,entries,documents,files,skipped,coverage:'Lexical candidates only. Agent reads README, SKILL and source, adds missed entries and explicit argument formats; computed registrations remain UNKNOWN.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(discoverEntries(path.resolve(process.argv[2])),null,2));
