import fs from 'node:fs';
import path from 'node:path';
import {sha256,safe} from './evidence.mjs';
export function contract(layer,sources,populations,metrics=[]){
  return {schema:'trace-evidence-contract-v1',layer,measuredAt:new Date().toISOString(),
    sources:[...new Map(sources.map(s=>[path.resolve(s.path??s.file),{path:path.resolve(s.path??s.file),sha256:s.sha256}])).values()],
    populations,metrics:metrics.map(m=>({layer,...m})),
    interpretation:'Counts apply only to the declared retained/read scope at measuredAt; no claim of complete history or current execution.'};
}
export function configSource(result,file){
  const bytes=fs.readFileSync(file);result.contract.sources.push({path:path.resolve(file),sha256:sha256(bytes),role:'configuration'});return result;
}
export function classificationBinding(file,records){
  if(!file)return null;
  const bytes=fs.readFileSync(safe(file,[path.dirname(path.resolve(file))])),data=JSON.parse(bytes.toString('utf8'));
  if(data.schema!=='classify-records-v1'||!Array.isArray(data.records))throw Error('Invalid classification output');
  const sources=new Map((data.contract?.sources??data.sources??[]).map(s=>[path.resolve(s.path),s.sha256]));
  const rows=new Map();
  for(const r of data.records){const p=path.resolve(r.file);if(rows.has(p))throw Error('Duplicate classified record');rows.set(p,r);}
  for(const file of records){
    const p=path.resolve(file),r=rows.get(p);if(!r)throw Error('Classification missing record: '+p);
    if(!['UNKNOWN','AMBIGUOUS',...(data.config?.classes??[]).map(c=>c.name)].includes(r.classification))throw Error('Invalid class');
    if(sources.get(p)!==sha256(fs.readFileSync(p)))throw Error('Classification source drift: '+p);
  }
  return {path:path.resolve(file),sha256:sha256(bytes),measuredAt:data.contract?.measuredAt??data.measuredAt,rows};
}
