// Repository-bounded lexical module resolution; never loads packages or executes config.
import {posix} from 'node:path';
const valid=p=>p!=='.'&&p!=='..'&&!p.startsWith('../')&&!posix.isAbsolute(p)&&!p.includes(':');
const extensions=['.ts','.tsx','.js','.jsx','.mjs','.cjs','.json'];
export function resolveJsFile(base,rows,read,seen=new Set()){
  base=posix.normalize(base);if(!valid(base)||seen.has(base))return null;seen.add(base);
  if(rows.has(base))return base;
  const suffix=posix.extname(base);
  if(['.js','.jsx','.mjs','.cjs'].includes(suffix)){
    for(const e of ['.ts','.tsx','.mts','.cts']){const p=base.slice(0,-suffix.length)+e;if(rows.has(p))return p;}
  }
  if(!suffix)for(const e of extensions)if(rows.has(base+e))return base+e;
  if(rows.has(base+'/package.json')&&read){try{
    const pkg=JSON.parse(read(base+'/package.json'));
    if(typeof pkg.main==='string'){const p=resolveJsFile(posix.join(base,pkg.main),rows,read,seen);if(p)return p;}
  }catch{}}
  return extensions.map(e=>base+'/index'+e).find(p=>rows.has(p))??null;
}
function jsonc(body){
  let clean='',quote=false,escaped=false;
  for(let i=0;i<body.length;i++){
    const c=body[i];
    if(quote){clean+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quote=false;continue;}
    if(c==='"'){quote=true;clean+=c;continue;}
    if(body.slice(i,i+2)==='//'){while(i<body.length&&body[i]!=='\n')i++;clean+='\n';continue;}
    if(body.slice(i,i+2)==='/*'){i+=2;while(i<body.length&&body.slice(i,i+2)!=='*/'){if(body[i]==='\n')clean+='\n';i++;}i++;continue;}
    clean+=c;
  }
  // Remove trailing commas outside strings only.
  return JSON.parse(clean.replace(/"(?:\\.|[^"\\])*"|(,)\s*(?=[}\]])/g,(m,comma)=>comma?'':m));
}
export function jsResolver(file,rows,read,cache=new Map()){
  let dir=posix.dirname(file),config;
  while(true){config=['tsconfig.json','jsconfig.json'].map(n=>posix.join(dir,n)).find(p=>rows.has(p));if(config||dir==='.')break;dir=posix.dirname(dir);}
  function load(p,stack=new Set()){
    const key='tsconfig:'+p;if(cache.has(key))return cache.get(key);
    if(stack.has(p))return {issues:[{config:p,reason:'Relative extends cycle'}]};stack.add(p);
    let out={issues:[]};
    try{
      const data=jsonc(read(p));
      for(const ext of Array.isArray(data.extends)?data.extends:data.extends?[data.extends]:[]){
        if(typeof ext!=='string'||!ext.startsWith('.')){out.issues.push({config:p,extends:ext,reason:'Package extends not read; dependencies are not installed'});continue;}
        const base=posix.normalize(posix.join(posix.dirname(p),ext)),target=[base,base+'.json',base+'/tsconfig.json'].find(n=>valid(n)&&rows.has(n));
        if(!target){out.issues.push({config:p,extends:ext,reason:'Relative extends missing or outside repository'});continue;}
        const parent=load(target,new Set(stack));out={...out,...parent,issues:[...out.issues,...parent.issues]};
      }
      const co=data.compilerOptions??{};
      if(typeof co.baseUrl==='string')out.baseUrl=posix.normalize(posix.join(posix.dirname(p),co.baseUrl));
      if(co.paths&&typeof co.paths==='object'){out.paths=co.paths;out.pathsBase=out.baseUrl??posix.dirname(p);}
    }catch(e){out.issues.push({config:p,reason:'Config is not readable JSON/JSONC: '+e.message});}
    cache.set(key,out);return out;
  }
  const settings=config?load(config):{issues:[]};
  return {issues:settings.issues,resolve(spec){
    if(spec.startsWith('.')){const base=posix.normalize(posix.join(posix.dirname(file),spec));return {base,unsafe:!valid(base),local:true,target:resolveJsFile(base,rows,read)};}
    const paths=Object.entries(settings.paths??{}).sort(([a],[b])=>Number(b===spec)-Number(a===spec)||b.indexOf('*')-a.indexOf('*'));
    for(const [pattern,values] of paths){
      const star=pattern.indexOf('*'),prefix=star<0?pattern:pattern.slice(0,star),suffix=star<0?'':pattern.slice(star+1);
      if(star<0?pattern!==spec:!spec.startsWith(prefix)||!spec.endsWith(suffix))continue;
      const wildcard=star<0?'':spec.slice(prefix.length,suffix? -suffix.length:undefined);
      const bases=(Array.isArray(values)?values:[]).filter(v=>typeof v==='string').map(v=>posix.normalize(posix.join(settings.pathsBase,v.replace('*',wildcard))));
      const target=bases.map(base=>resolveJsFile(base,rows,read)).find(Boolean);
      return {local:true,base:bases[0]??spec,target:target??null,unsafe:bases.length>0&&bases.every(b=>!valid(b))};
    }
    if(settings.baseUrl){const base=posix.join(settings.baseUrl,spec),target=resolveJsFile(base,rows,read);if(target)return {local:true,base,target};}
    return {local:false,target:null};
  }};
}
