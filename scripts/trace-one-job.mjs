import {gapList} from './gap-shape.mjs';
import {validateTraceConfig} from './trace-job-config.mjs';
import {reader} from './evidence.mjs';
import {contract,configSource,classificationBinding} from './contract.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const get=(v,k)=>(Array.isArray(k)?k:k.split('.')).reduce((v,p)=>v?.[p],v);
const within=(root,p)=>{const r=path.relative(root,p);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
// Parse validated JSON text a second time only for exact property locators.
// Duplicate keys are ambiguous evidence even though JSON.parse retains the last value.
function jsonLines(text){
  let at=0,line=1;const locations=new Map();
  const advance=()=>{if(text[at++]==='\n')line++;},ws=()=>{while(/\s/.test(text[at]??'')&&at<text.length)advance();};
  function string(){const start=at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"')return JSON.parse(text.slice(start,at));}throw Error('Unclosed JSON string');}
  function value(keys){
    ws();
    if(text[at]==='{'){
      advance();ws();if(text[at]==='}'){advance();return;}
      while(at<text.length){ws();const keyLine=line,key=string();ws();if(text[at++]!==':')throw Error('Missing colon');const next=[...keys,key],id=JSON.stringify(next);locations.set(id,locations.has(id)?null:keyLine);value(next);ws();if(text[at]==='}'){advance();return;}if(text[at++]!==',')throw Error('Missing comma');}
    }else if(text[at]==='['){advance();ws();let index=0;if(text[at]===']'){advance();return;}while(at<text.length){value([...keys,String(index++)]);ws();if(text[at]===']'){advance();return;}if(text[at++]!==',')throw Error('Missing comma');}}
    else if(text[at]==='"')string();
    else {while(at<text.length&&!/[\s,}\]]/.test(text[at]))advance();}
  }
  try{value([]);return locations;}catch{return new Map();}
}
export function trace(c) {
  const validation=validateTraceConfig(c);if(validation.status!=='PASS')throw Error(JSON.stringify(validation));
  if(!path.isAbsolute(c.root??'')||!c.job?.relativePath||!Array.isArray(c.stores)||!Array.isArray(c.joins))throw Error('root, job.relativePath, stores, joins required');
  const root=path.resolve(c.root),job=path.resolve(root,c.job.relativePath),gaps=gapList(),stores=new Map();
  if(!within(root,job))throw Error('Job escapes record root');
  function safe(file,allowed) {
    if(!within(allowed,file))throw Error('Store escapes root');
    let at=path.parse(file).root;
    for(const p of file.slice(at.length).split(path.sep).filter(Boolean)){at=path.join(at,p);if(fs.lstatSync(at).isSymbolicLink())throw Error('Symbolic link refused');}
    return file;
  }
  for(const spec of c.stores) {
    if(stores.has(spec.id))throw Error('Duplicate store id');
    const allowed=spec.root?path.resolve(spec.root):root;
    if(spec.root&&!path.isAbsolute(spec.root))throw Error('External store root must be absolute');
    const start=path.resolve(spec.root??job,spec.path??'.'),rows=[];
    const pattern=new RegExp(spec.filePattern??'\.json$');
    if(!['one-json-per-file','jsonl'].includes(spec.mode))throw Error('Unsupported event/store mode');
    function read(file){
      try{
        const bytes=fs.readFileSync(safe(file,allowed)),text=bytes.toString('utf8').replace(/^﻿/,'');
        const units=spec.mode==='jsonl'?text.split(/\r?\n/).map((text,i)=>({text,line:i+1})).filter(u=>u.text.trim()):[{text,line:null}];
        if(!units.length)gaps.push({store:spec.id,file,reason:'EMPTY_FILE'});
        for(const u of units)try{
          const value=JSON.parse(u.text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected object');
          if(spec.where&&!Object.entries(spec.where).every(([k,v])=>get(value,k)===v))continue;
          const row={value,file,line:u.line,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
          Object.defineProperty(row,'keyLines',{value:u.line===null?jsonLines(u.text):null});
          rows.push(row);
        }catch(e){gaps.push({store:spec.id,file,line:u.line,reason:e.message});}
      }catch(e){gaps.push({store:spec.id,file,reason:e.message});}
    }
    function visit(file){
      try {const stat=fs.statSync(safe(file,allowed));if(stat.isFile()){read(file);return;}
        for(const e of fs.readdirSync(file,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
          const child=path.join(file,e.name);
          if(e.isSymbolicLink())gaps.push({store:spec.id,file:child,reason:'SYMLINK_SKIPPED'});
          else if(e.isDirectory()&&spec.recursive)visit(child);
          else if(e.isFile()&&pattern.test(e.name))read(child);
        }
      }catch(e){gaps.push({store:spec.id,file,reason:e.message});}
    }
    visit(start);stores.set(spec.id,rows);
  }
  const classification=classificationBinding(c.classificationOutput,[path.join(job,c.recordFile??'job.json')]);
  const writerIO=reader(c.writerRoots??[root],gaps);
  const pathConventions=(c.pathConventions??[]).map(link=>{
    if(link.kind!=='PATH_CONVENTION'||!stores.has(link.from)||!stores.has(link.to))throw Error('PATH_CONVENTION requires existing from/to stores');
    const row={...link,sourceFiles:stores.get(link.from).map(r=>r.file),targetFiles:stores.get(link.to).map(r=>r.file),status:'UNKNOWN',countedAsJoin:false};
    try{if(!Number.isInteger(link.writer?.line)||link.writer.line<1)throw Error('Writer file and positive line required');const bytes=writerIO.read(link.writer.file),lines=bytes.toString('utf8').split(/\r?\n/);if(link.writer.line>lines.length)throw Error('Writer line absent');row.writer={...link.writer,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),text:lines[link.writer.line-1]};row.status=row.sourceFiles.length&&row.targetFiles.length?'LOCATED':'UNKNOWN';}
    catch(e){gaps.push({code:'PATH_CONVENTION_UNKNOWN',id:link.id,detail:e.message});}return row;
  });
  function locator(row,key){
    if(row.line!==null)return {file:row.file,line:row.line};
    const parts=Array.isArray(key)?key.map(String):key.split('.');
    const line=row.keyLines.get(JSON.stringify(parts))??null;
    const ambiguous=parts.some((_,i)=>row.keyLines.has(JSON.stringify(parts.slice(0,i+1)))&&row.keyLines.get(JSON.stringify(parts.slice(0,i+1)))===null);
    return {file:row.file,line:ambiguous?null:line,...(ambiguous||line===null?{lineReason:ambiguous?'AMBIGUOUS_DUPLICATE_JSON_KEY':'JOIN_KEY_LOCATION_UNAVAILABLE'}:{})};
  }
  const joins=c.joins.map(j=>{
    if(j.kind==='PATH_CONVENTION')throw Error('Put PATH_CONVENTION in pathConventions, not joins');
    if(!stores.has(j.from.store)||!stores.has(j.to.store))throw Error('Unknown join store');
    const source=stores.get(j.from.store),target=stores.get(j.to.store),checks=[];
    if(!source.length)checks.push({status:'FAIL',reason:'SOURCE_EMPTY',source:null,matches:[]});
    for(const s of source){
      const key=get(s.value,j.from.key);
      const missing=key===undefined||key===null||typeof key==='object';
      const matches=missing?[]:target.filter(t=>get(t.value,j.to.key)===key);
      const status=!missing&&(j.cardinality==='one-to-many'?matches.length>0:matches.length===1)?'PASS':'FAIL';
      checks.push({status,reason:missing?'JOIN_KEY_MISSING':!matches.length?'NO_MATCH':status==='FAIL'?'AMBIGUOUS_MATCH':'MATCH',key:key??null,
        source:locator(s,j.from.key),matches:matches.map(t=>locator(t,j.to.key))});
    }
    const incomplete=gaps.some(g=>g.store===j.from.store||g.store===j.to.store);
    return {id:j.id,kind:j.kind??'recorded',from:j.from,to:j.to,status:incomplete||checks.some(r=>r.status==='FAIL')?'FAIL':'PASS',incomplete,checks};
  });
  return {contract:contract('RECORD',[...writerIO.sources.values(),...[...stores.values()].flat().map(r=>({path:r.file,sha256:r.sha256})),...(classification?[{path:classification.path,sha256:classification.sha256}]:[])],[{id:'selected-job',semantics:classification?'CLASSIFIED':'NAME_ONLY_UNVERIFIED',classificationOutput:classification?.path??null,definition:'Caller-selected retained job and configured stores'}],[{selector:'joins[*].checks.length',population:'selected-job',unit:'recorded field comparisons'}]),schema:'trace-one-job-v1',layer:'retained-records',measuredAt:new Date().toISOString(),root,job,population:c.population??path.relative(root,job).split(path.sep)[0],
    stores:Object.fromEntries(stores),joins,pathConventions,gaps,anomalies:joins.filter(j=>j.status==='FAIL').map(j=>j.id),evaluation:'DEFERRED_UNTIL_ALL_LAYERS_READ'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node trace-one-job.mjs [validate] --config file");process.exit(0);}

 try{
  const args=process.argv.slice(2),validate=args[0]==='validate';if(validate)args.shift();
  if(args[0]!=='--config'||args.length!==2)throw Error('Usage: trace-one-job.mjs [validate] --config file');
  const c=JSON.parse(fs.readFileSync(args[1],'utf8'));
  if(validate){const r=validateTraceConfig(c);console.log(JSON.stringify(r,null,2));if(r.status!=='PASS')process.exitCode=1;}
  else{const r=trace(c);configSource(r,args[1]);console.log(JSON.stringify(r,null,2));if(r.gaps.length||r.anomalies.length)process.exitCode=2;}
 }catch(e){console.error(e.message);process.exitCode=1;}
}
