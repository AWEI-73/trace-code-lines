import {gapList} from './gap-shape.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {get,reader,sha256} from './evidence.mjs';
import {contract,configSource} from './contract.mjs';
export function versionChain(c){
  if(!c.allowedRoots?.length||c.allowedRoots.some(r=>!path.isAbsolute(r)))throw Error('Absolute allowedRoots required');
  const gaps=gapList(),io=reader(c.allowedRoots,gaps),globals={},hops=[],chains=[];
  const interpolate=(text,ctx)=>String(text).replace(/\$\{([^}]+)\}/g,(_,key)=>{
    const v=get(ctx,key);if(v===undefined||v===null||typeof v==='object')throw Error('UNKNOWN_TEMPLATE_VALUE: '+key);return String(v);
  });
  function run(spec,ctx,out,location={rowIndex:null,branchIndex:null}){
    let file=null,hash=null,value=null;
    try{
      file=path.resolve(interpolate(spec.file,ctx));
      const bytes=io.read(file);hash=sha256(bytes);
      const expected=spec.expectedSha256?interpolate(spec.expectedSha256,ctx):null;
      if(expected&&hash!==expected)throw Error('HASH_MISMATCH expected '+expected+' actual '+hash);
      const text=bytes.toString('utf8');
      let data=spec.format==='sha256'?hash:spec.format==='text'?text:JSON.parse(text.replace(/^\uFEFF/,''));
      if(spec.select){
        const array=get(data,spec.select.array);if(!Array.isArray(array))throw Error('SELECT_NOT_ARRAY');
        const matches=array.filter(r=>Object.entries(spec.select.where).every(([k,v])=>get(r,k)===interpolate(v,ctx)));
        if(matches.length!==1)throw Error('SELECT_NOT_UNIQUE: '+matches.length);data=matches[0];
      }
      if(spec.regex){const m=new RegExp(spec.regex,spec.flags??'m').exec(data);if(!m)throw Error('KEY_NOT_FOUND');value=m[spec.group??1];}
      else value=spec.key==null?data:get(data,spec.key);
      if(value===undefined)throw Error('KEY_NOT_FOUND: '+spec.key);
      ctx[spec.id]=value;out.push({id:spec.id,file,sha256:hash,valueType:spec.valueType??(spec.format==='sha256'?'content-sha256':spec.key&&/hash|sha256/i.test(spec.key)?'config-hash':spec.key&&/commit/i.test(spec.key)?'git-commit':'unspecified'),key:spec.key??spec.regex??'$',select:spec.select??null,value,status:'PASS'});
    }catch(e){ctx[spec.id]=undefined;const code=e.message.startsWith('OUTSIDE_ALLOWED_ROOTS')?'PATH_REFUSED':'HOP_UNKNOWN';gaps.push({code,hop:spec.id,file,detail:e.message,...location});out.push({id:spec.id,file,sha256:hash,key:spec.key??spec.regex??'$',value:null,status:'UNKNOWN',reason:e.message,...location});}
  }
  for(const spec of c.hops??[])run(spec,globals,hops);
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
  for(const [branchIndex,branch] of (c.branches??[]).entries()){
    const values=get(globals,branch.items);
    if(!Array.isArray(values)){gaps.push({code:'BRANCH_UNKNOWN',items:branch.items});continue;}
    for(const [rowIndex,item] of values.entries()){
      const ctx={...globals,item},local=[];for(const spec of branch.hops)run(spec,ctx,local,{rowIndex,branchIndex});
      const checks=(branch.checks??[]).map(check=>{
        const left=get(ctx,check.left),right=get(ctx,check.right),status=left!==undefined&&right!==undefined&&JSON.stringify(left)===JSON.stringify(right)?'PASS':'UNKNOWN';
        if(status!=='PASS')gaps.push({code:'BINDING_MISMATCH',left:check.left,right:check.right,item});
        return {...check,leftValue:left??null,rightValue:right??null,status};
      });
       chains.push({id:'chain-'+sha256(JSON.stringify(canonical({branch,item}))),declaredId:get(item,branch.idKey??'id')??null,rowIndex,branchIndex,item,hops:local,checks});
    }
  }
  return {schema:'version-chain-v1',contract:contract('VERSION',[...io.sources.values()],[{id:'declared-chains',semantics:'READ_BACK_BINDING',definition:'Declared file/key chain at measurement time; not historical execution proof.'}],[{selector:'chains.length|hops.length|chains[*].hops.length',population:'declared-chains',unit:'declared chains/hops'}]),status:gaps.length?'PARTIAL':'PASS',hops,chains,gaps,config:c};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node version-chain.mjs --config file");process.exit(0);}

  try{if(process.argv[2]!=='--config'||process.argv.length!==4)throw Error('Usage: version-chain.mjs --config file');const r=versionChain(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));configSource(r,process.argv[3]);console.log(JSON.stringify(r,null,2));if(r.gaps.length)process.exitCode=2;}catch(e){console.error(e.message);process.exitCode=1;}
}
