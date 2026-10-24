import {normalizeGap} from './gap-shape.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const norm=p=>p.replaceAll('\\','/').toLowerCase();
function location(frame){
 if(typeof frame==='object')return frame;
 const m=frame.match(/(?:\(|\s)((?:file:\/\/\/|[A-Za-z]:[\\/]|\/).+):(\d+):(\d+)\)?$/);
 if(!m)return null;
 return {file:m[1].startsWith('file:')?fileURLToPath(m[1]):m[1],line:Number(m[2]),column:Number(m[3])};
}
export function instrumentEvidence(c,table,raw,gaps){
 const collected=JSON.parse(fs.readFileSync(c.instrumentCollect,'utf8'));
 if(collected.schema!=='instrument-collect-v1')throw Error('Invalid instrument collect schema');
 gaps.push(...collected.gaps.map(normalizeGap));
 const roots=c.roots.map(r=>({...r,root:norm(r.root)})).sort((a,b)=>b.root.length-a.root.length);
 const logical=p=>{const n=norm(p),r=roots.find(r=>n.startsWith(r.root+'/'));return r?norm((r.prefix?r.prefix+'/':'')+n.slice(r.root.length+1)):n;};
 const coverage=new Map(),sourceCache=new Map(),proofCache=new Map();
 for(const r of raw){
 const d=JSON.parse(fs.readFileSync(r.file,'utf8'));
 if(d.schema==='python-settrace-v1'){for(const f of d.files){const key=logical(f.path);(coverage.get(key)??coverage.set(key,[]).get(key)).push({python:f.lines,physical:f.path,raw:r.file});}}
 else for(const s of d.result??[]){if(!s.url.startsWith('file:'))continue;const p=fileURLToPath(s.url),key=logical(p);(coverage.get(key)??coverage.set(key,[]).get(key)).push({script:s,physical:p,raw:r.file});}
 }
 function positive(w){
 const cacheKey=JSON.stringify(w);if(proofCache.has(cacheKey))return proofCache.get(cacheKey);
 const proofs=[];
 for(const r of coverage.get(logical(w.file))??[]){
 if(r.python){const l=r.python.find(x=>x.line===w.line&&x.count>0);if(l)proofs.push({coverage:r.raw,path:r.physical,line:w.line,count:l.count});continue;}
 try{
 if(!sourceCache.has(r.physical)){const source=fs.readFileSync(r.physical,'utf8'),lines=source.split('\n'),offsets=[0];for(const l of lines)offsets.push(offsets.at(-1)+l.length+1);sourceCache.set(r.physical,{source,lines,offsets});}
 const {source,lines,offsets}=sourceCache.get(r.physical);if(w.line<1||w.line>lines.length)continue;
 const offset=offsets[w.line-1]+(w.column? w.column-1:lines[w.line-1].search(/\S|$/));
 const ranges=r.script.functions.flatMap(f=>f.ranges).filter(x=>x.startOffset<=offset&&x.endOffset>offset).sort((a,b)=>(a.endOffset-a.startOffset)-(b.endOffset-b.startOffset));
 if(ranges[0]?.count>0)proofs.push({coverage:r.raw,url:r.script.url,...ranges[0],line:w.line});
 }catch(error){gaps.push(normalizeGap({kind:'WRITER_SOURCE_UNKNOWN',file:w.file,detail:error.message}));}
 }proofCache.set(cacheKey,proofs);return proofs;
 }
 const used=new Set();
 const endpoints=table.endpoints.map(t=>{
 if(/^(?:LOCAL_CONTAINER_MUTATION|CONTAINER_MUTATION_CANDIDATE|DB_READ)$/.test(t.operation??''))return {...t,status:'NOT_A_PERSISTENCE_WITNESS',writerEvidence:[],writeEvents:[],evidenceBasis:'Container mutation or database read excluded from persistence reconciliation'};
 const writers=t.writers??(t.writer&&t.line?[{file:t.writer,line:t.line}]:[]);
 const proofs=writers.flatMap(positive);
 const matches=collected.writes.filter(e=>{
 const target=t.observedPaths?.length?e.paths?.some(p=>p&&t.observedPaths.some(q=>norm(p)===norm(q))):
 t.targetPattern?e.paths?.some(p=>p&&new RegExp(t.targetPattern,'i').test(p.replaceAll('\\','/'))):false;
 if(!target||!e.snapshotEvidence?.length||!e.writeIntent)return false;
  if(t.receiptIds&&(!t.receiptIds.includes(e.id)||!e.receipt||e.receipt.writeClass!=='business'||!e.receipt.changed))return false;
 return e.stack?.map(location).filter(Boolean).some(loc=>writers.some(w=>logical(loc.file)===logical(w.file)&&loc.line>=w.line&&loc.line<=(w.endLine??w.line)));
 });
 if(proofs.length)for(const e of matches)used.add(e.id);
 return {...t,status:proofs.length?(matches.length?'WRITTEN_OBSERVED':'RANGE_ONLY'):'UNKNOWN',
 writerEvidence:proofs,writeEvents:proofs.length?matches:[],evidenceBasis:'Runtime write intent plus changed before/after snapshot, bound target and executed static writer range'};
 });
 const unmatched=collected.writes.filter(e=>!used.has(e.id));
 const grouped=new Map();
 for(const e of unmatched)for(const p of e.paths??[]){if(!p)continue;const k=norm(p);if(!grouped.has(k))grouped.set(k,{id:'LOG-'+(grouped.size+1),status:'LOG_ONLY',path:p,writeEvents:[]});grouped.get(k).writeEvents.push(e);}
 return {endpoints,logOnly:[...grouped.values()],collected};
}
