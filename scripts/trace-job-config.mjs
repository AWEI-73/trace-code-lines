import path from 'node:path';
export function validateTraceConfig(c){
 const errors=[],bad=(at,message)=>errors.push({at,message}),object=v=>v&&typeof v==='object'&&!Array.isArray(v);
 if(!object(c))return {schema:'trace-one-job-config-validation-v1',status:'FAIL',errors:[{at:'$',message:'Expected object'}],readsTargetFiles:false};
 if(!path.isAbsolute(c.root??''))bad('root','Absolute record root required');
 if(typeof c.job?.relativePath!=='string'||!c.job.relativePath||path.isAbsolute(c.job.relativePath)||c.job.relativePath.split(/[\\/]/).includes('..'))bad('job.relativePath','Non-escaping relative job path required');
 const stores=new Set();
 if(!Array.isArray(c.stores)||!c.stores.length)bad('stores','Nonempty store array required');
 for(const [i,s]of (Array.isArray(c.stores)?c.stores:[]).entries()){
  if(!object(s)){bad('stores.'+i,'Store object required');continue;}
  if(typeof s.id!=='string'||!s.id||stores.has(s.id))bad('stores.'+i+'.id','Unique store id required');stores.add(s.id);
  if(s.root!==undefined&&!path.isAbsolute(s.root))bad('stores.'+i+'.root','Explicit external root must be absolute');
  if(s.path!==undefined&&(typeof s.path!=='string'||path.isAbsolute(s.path)||s.path.split(/[\\/]/).includes('..')))bad('stores.'+i+'.path','Non-escaping relative store path required');
  if(!['one-json-per-file','jsonl'].includes(s.mode))bad('stores.'+i+'.mode','Expected one-json-per-file or jsonl');
  if(s.recursive!==undefined&&typeof s.recursive!=='boolean')bad('stores.'+i+'.recursive','Expected boolean');
  try{if(s.filePattern!==undefined)new RegExp(s.filePattern);}catch{bad('stores.'+i+'.filePattern','Invalid regular expression');}
  if(s.where!==undefined&&!object(s.where))bad('stores.'+i+'.where','Expected selector object');
 }
 if(!Array.isArray(c.joins))bad('joins','Join array required');
 const ids=new Set(),key=k=>typeof k==='string'&&k.length>0||Array.isArray(k)&&k.length>0&&k.every(v=>typeof v==='string'||Number.isInteger(v));
 for(const [i,j]of (Array.isArray(c.joins)?c.joins:[]).entries()){
  if(!object(j)){bad('joins.'+i,'Join object required');continue;}
  if(!j.id||ids.has(j.id))bad('joins.'+i+'.id','Unique join id required');ids.add(j.id);
  for(const side of ['from','to'])if(!stores.has(j[side]?.store)||!key(j[side]?.key))bad('joins.'+i+'.'+side,'Existing store and nonempty key path required');
  if(j.kind!==undefined&&j.kind!=='recorded')bad('joins.'+i+'.kind','Only recorded joins; use pathConventions for inferred paths');
  if(j.cardinality!==undefined&&!['one-to-one','one-to-many'].includes(j.cardinality))bad('joins.'+i+'.cardinality','Unsupported cardinality');
 }
 for(const [i,p]of (c.pathConventions??[]).entries())if(p.kind!=='PATH_CONVENTION'||!stores.has(p.from)||!stores.has(p.to)||!p.writer?.file||!Number.isInteger(p.writer.line)||p.writer.line<1)bad('pathConventions.'+i,'Existing stores and file:line writer required');
 return {schema:'trace-one-job-config-validation-v1',status:errors.length?'FAIL':'PASS',errors,readsTargetFiles:false};
}
