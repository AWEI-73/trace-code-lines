import {gapList} from './gap-shape.mjs';
import {contract,configSource} from './contract.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {get,reader,discover} from './evidence.mjs';
// Declarative rules only. Never evaluates config expressions as code.
export function classifyRecords(c){
  if(!c.records?.root||!c.records.pattern||!Array.isArray(c.classes))throw Error('records root/pattern and classes required');
  const names=c.classes.map(x=>x.name);
  if(new Set(names).size!==names.length||names.some(n=>['UNKNOWN','AMBIGUOUS'].includes(n)))throw Error('Unique non-reserved class names required');
  const roots=[c.records.root,...Object.values(c.stores??{}).flatMap(s=>s.roots??(s.root?[s.root]:[]))];
  if(roots.some(r=>!path.isAbsolute(r)))throw Error('Store roots must be absolute');
  const gaps=gapList(),io=reader(roots,gaps),cache=new Map();
  const load=file=>{try{return {file:path.resolve(file),value:io.json(file)};}catch(e){gaps.push({code:'RECORD_READ_UNKNOWN',path:file,detail:e.message});return null;}};
  const records=discover(c.records.root,c.records.pattern,gaps).map(load).filter(Boolean),results=[];
  function storeRows(name,record){
    const spec=c.stores?.[name];if(!spec)throw Error('Unknown store '+name);
    const bases=spec.roots??[spec.root??path.dirname(record.file)],base=bases[0],at=path.resolve(base,spec.path??'.');
    const key=name+':'+at;
    if(!cache.has(key)){
      const files=spec.file?[path.resolve(base,spec.file)]:bases.flatMap(b=>discover(path.resolve(b,spec.path??'.'),spec.pattern??'[.]json$',gaps));
      cache.set(key,files.map(load).filter(Boolean));
    }
    return cache.get(key);
  }
  function test(rule,row,record,evidence){
    if(rule.all){const values=rule.all.map(x=>test(x,row,record,evidence));return values.every(Boolean);}
    if(rule.any){const values=rule.any.map(x=>test(x,row,record,evidence));return values.some(Boolean);}
    if(rule.not)return !test(rule.not,row,record,evidence);
    if(rule.join){
      const j=rule.join;if(!j.on?.length)throw Error('Exact join requires on pairs');
      const found=storeRows(j.store,record).filter(r=>j.on.every(p=>{const a=get(record.value,p.record),b=get(r.value,p.foreign);return a!=null&&typeof a!=='object'&&a===b;}));
      const candidates=found.map(r=>{
        for(const p of j.on){evidence.push({file:record.file,key:p.record,value:get(record.value,p.record)},{file:r.file,key:p.foreign,value:get(r.value,p.foreign)});}
        return j.where?test(j.where,r,record,evidence):true;
      });
      if(!found.length)for(const p of j.on)evidence.push({file:record.file,key:p.record,value:get(record.value,p.record)??null,joinStore:j.store,matches:[]});
      return candidates.some(Boolean);
    }
    if(rule.existsIn){
      const rows=storeRows(rule.existsIn.store,record);
      return rows.map(r=>test(rule.existsIn.where??{key:'',op:'exists'},r,record,evidence)).some(Boolean);
    }
    const value=rule.key===''?row.value:get(row.value,rule.key);
    const one=v=>{
      switch(rule.op??'eq'){
        case 'eq':return v===rule.value;
        case 'prefix':return typeof v==='string'&&v.startsWith(rule.value);
        case 'regex':return typeof v==='string'&&new RegExp(rule.value,rule.flags??'').test(v);
        case 'exists':return v!==undefined&&v!==null;
        default:throw Error('Unsupported rule operation '+rule.op);
      }
    };
    const matched=rule.elements==='any'&&Array.isArray(value)?value.some(one):one(value);
    evidence.push({file:row.file,key:rule.key,value:value??null,missing:value===undefined,op:rule.op??'eq',expected:rule.value??null,matched});
    return matched;
  }
  for(const record of records){
    const selection=[];if(c.filter&&!test(c.filter,record,record,selection))continue;
    const evaluated=c.classes.map(rule=>{const evidence=[];return {class:rule.name,matched:test(rule.when,record,record,evidence),evidence};});
    const matches=evaluated.filter(x=>x.matched).map(x=>x.class);
    results.push({file:record.file,id:get(record.value,c.idKey??'id')??null,classification:matches.length>1?'AMBIGUOUS':matches[0]??'UNKNOWN',matches,selection,evaluated});
  }
  if(!results.length)gaps.push({code:'NO_RECORDS',path:c.records.root,detail:'No readable records selected; absence is not a completed classification.'});
  const counts=Object.fromEntries([...names,'UNKNOWN','AMBIGUOUS'].map(n=>[n,results.filter(r=>r.classification===n).length]));
  return {contract:contract('RECORD',[...io.sources.values()],[{id:'selected-records',semantics:'CLASSIFIED',classificationOutput:'SELF',definition:'Records satisfying config.filter; every matching class retained, conflicts AMBIGUOUS.'}], [{selector:'counts.*',population:'selected-records',unit:'records'},{selector:'total',population:'selected-records',unit:'records'}]),schema:'classify-records-v1',measuredAt:new Date().toISOString(),status:!results.length?'UNKNOWN':gaps.length?'PARTIAL':'PASS',counts,total:results.length,records:results,gaps,sources:[...io.sources.values()],config:c};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node classify-records.mjs --config file");process.exit(0);}

  try{if(process.argv[2]!=='--config'||process.argv.length!==4)throw Error('Usage: classify-records.mjs --config file');
    const r=classifyRecords(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));configSource(r,process.argv[3]);console.log(JSON.stringify(r,null,2));if(r.gaps.length)process.exitCode=2;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
