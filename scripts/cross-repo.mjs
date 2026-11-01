// Multi-repo static tracing for derive-map. Extra repos (config.repos: [{name,root,package?,reason?}]) join the inventory
// under the key prefix "@name/"; the primary repo keeps plain repo-relative keys. Nothing is executed or imported.
// Hops into another repo come from (1) relative imports that leave one repo and land on a tracked file of another,
// (2) bare package specifiers that equal a repo's declared package name, (3) anchored declaredEdges whose targets name
// another repo, directly ("@name/path") or through a JSON pointer in that repo ({repo,configFile,pointer,base}).
// Every edge whose source and target sit in different repos is labelled crossRepo and classified with the same
// zone/direction rules as boundary.mjs (config.crossRepoRules: {zones:[{name,repo,include}],rules:[...]}).
import fs from 'node:fs';
import cp from 'node:child_process';
import {resolve,relative,isAbsolute,posix,sep} from 'node:path';
import {noLinks,readBounded,sha256} from './walker.mjs';
import {configuration} from './boundary-rules.mjs';
import {tokens} from './language-static.mjs';
import {isBuiltin} from 'node:module';

const PREFIX=/^@([A-Za-z0-9_-]+)\/(.+)$/;
export function repoOf(key,names){const m=PREFIX.exec(key);return m&&names.has(m[1])?m[1]:null;}
export function splitKey(key,ctx){const m=PREFIX.exec(key);return m&&ctx.extra.has(m[1])?{name:m[1],root:ctx.extra.get(m[1]).root,path:m[2]}:{name:ctx.primary,root:ctx.repo,path:key};}
const keyFor=(name,p,ctx)=>name===ctx.primary?p:'@'+name+'/'+p;
const git=(root,args)=>cp.execFileSync('git',['-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});

// Validates config.repos and adds each extra repo's tracked files to rows. Returns the context used by the other helpers.
export function loadRepos(config,{repo,rows,inventoryGaps,commands,readCache}){
  const ctx={primary:config.primaryRepoName??'primary',repo,extra:new Map(),rows,heads:[]};
  if(config.repos===undefined)return ctx;
  if(!Array.isArray(config.repos))throw Error('repos must be an array');
  for(const r of config.repos){
    if(typeof r?.name!=='string'||!/^[A-Za-z0-9_-]+$/.test(r.name)||r.name===ctx.primary||ctx.extra.has(r.name))throw Error('repos[].name must be unique [A-Za-z0-9_-]+');
    if(typeof r.root!=='string'||!isAbsolute(r.root))throw Error('repos[].root must be absolute');
    const root=noLinks(resolve(r.root));
    if(root===repo||root.startsWith(repo+sep)||repo.startsWith(root+sep))throw Error('repos[].root must not overlap the primary repo: '+r.name);
    commands.push({bin:'git',args:['-C',root,'status','--porcelain']});
    const head=git(root,['rev-parse','HEAD']).trim(),status=git(root,['status','--porcelain']);
    if(status!=='')throw Error('Repository is not clean; no analysis performed: '+r.name);
    const tracked=git(root,['ls-files','-z']).split('\0').filter(Boolean).sort();
    ctx.extra.set(r.name,{name:r.name,root,package:r.package??null,reason:r.reason??null,head,status,tracked});
    for(const p of tracked){const k='@'+r.name+'/'+p;
      try{const b=readBounded(root,p);readCache.set(k,b);rows.set(k,{path:k,sha256:sha256(b),repo:r.name});}
      catch(e){rows.set(k,{path:k,sha256:null,repo:r.name});inventoryGaps.push({path:k,error:e.message});}}
  }
  return ctx;
}
export function readKey(key,ctx){const s=splitKey(key,ctx);return readBounded(s.root,s.path);}

function resolveFile(name,p,ctx){
  const n=posix.normalize(p);if(n.startsWith('../')||n==='..'||posix.isAbsolute(n))return null;
  for(const c of [n,n+'.mjs',n+'.js',n+'.cjs',n+'.ts',n+'.json',n+'/index.mjs',n+'/index.js',n+'/index.cjs']){const k=keyFor(name,c,ctx);if(ctx.rows.has(k))return k;}
  return null;
}
function repoAt(abs,ctx){
  for(const [name,root] of [[ctx.primary,ctx.repo],...[...ctx.extra.values()].map(r=>[r.name,r.root])]){
    const rel=relative(root,abs);if(rel&&!rel.startsWith('..')&&!isAbsolute(rel))return {name,path:rel.split(sep).join('/')};}
  return null;
}
// Literal module specifiers (import/export from, import(), require()) of one JS file, with lines.
export function specifiers(source){
  const t=tokens(source,false,{regexLiterals:true}),out=[];
  for(let i=0;i<t.length;i++){
    if(t[i].kind!=='name'||t[i-1]?.v==='.')continue;
    if((t[i].v==='import'||t[i].v==='require')&&t[i+1]?.v==='('&&t[i+2]?.kind==='string'&&t[i+2].literal&&t[i+3]?.v===')'){out.push({spec:t[i+2].v,line:t[i].line,dynamic:true});continue;}
    if(!['import','export'].includes(t[i].v)||t[i+1]?.v==='(')continue;
    let spec=t[i+1]?.kind==='string'?t[i+1]:null;
    if(!spec)for(let j=i+1;j<t.length;j++){if(t[j].v===';'||['import','export','const','let','function','class'].includes(t[j].v))break;if(t[j].v==='from'&&t[j+1]?.kind==='string'){spec=t[j+1];break;}}
    if(spec?.literal)out.push({spec:spec.v,line:t[i].line,dynamic:false});
  }
  return out;
}
// Hops a single-repo walk cannot follow: relative specifiers that leave the file's repo and bare package names of a configured repo.
export function crossHops(r,ctx,read=k=>readKey(k,ctx)){
  const hops=[];if(!ctx.extra.size)return hops;
  for(const f of r.files){
    if(!/\.(?:cjs|mjs|js)$/.test(f.path))continue;
    let source;try{source=read(f.path).toString('utf8');}catch{continue;}
    const from=splitKey(f.path,ctx);
    for(const {spec,line,dynamic} of specifiers(source)){
      if(isBuiltin(spec))continue;
      if(spec.startsWith('.')){
        const abs=resolve(from.root,posix.dirname(from.path),spec),at=repoAt(abs,ctx);
        if(!at||at.name===from.name)continue;const target=resolveFile(at.name,at.path,ctx);
        if(target)hops.push({edge:{kind:'CROSS_REPO_IMPORT',path:f.path,line,specifier:spec,targets:[target],basis:'RELATIVE_PATH_INTO_CONFIGURED_REPO',dynamic}});
        continue;
      }
      for(const repo of ctx.extra.values()){
        if(!repo.package||repo.name===from.name||(spec!==repo.package&&!spec.startsWith(repo.package+'/')))continue;
        const sub=spec.slice(repo.package.length+1);let target=null;
        if(sub)target=resolveFile(repo.name,sub,ctx);
        else{try{const pkg=JSON.parse(readKey(keyFor(repo.name,'package.json',ctx),ctx).toString('utf8'));const main=typeof pkg.exports==='string'?pkg.exports:pkg.exports?.['.']??pkg.main??'index';target=resolveFile(repo.name,typeof main==='string'?main:'index',ctx);}catch{target=resolveFile(repo.name,'index',ctx);}}
        if(target)hops.push({edge:{kind:'CROSS_REPO_PACKAGE',path:f.path,line,specifier:spec,targets:[target],basis:'PACKAGE_NAME_OF_CONFIGURED_REPO',dynamic}});
      }
    }
  }
  return hops;
}
// declaredEdges target forms: "path", "@repo/path", {repo,file} or {repo,configFile,pointer,base:'file'|'repo'}.
export function declaredTarget(t,ctx){
  if(typeof t==='string')return {target:t};
  if(!t||typeof t!=='object')return {error:'target must be a string or object'};
  const name=t.repo??ctx.primary;if(name!==ctx.primary&&!ctx.extra.has(name))return {error:'unknown repo '+name};
  if(t.file)return withLine({target:keyFor(name,t.file,ctx)},t,ctx);
  if(!t.configFile)return {error:'target needs file or configFile'};
  const cfgKey=keyFor(name,t.configFile,ctx);if(!ctx.rows.has(cfgKey))return {error:'configFile not tracked: '+cfgKey};
  let doc;try{doc=JSON.parse(readKey(cfgKey,ctx).toString('utf8'));}catch(e){return {error:'configFile unreadable: '+e.message};}
  let v=doc;for(const k of String(t.pointer??'').split('/').slice(1).map(x=>x.replaceAll('~1','/').replaceAll('~0','~'))){if(v==null||!(k in Object(v)))return {error:'pointer unresolved: '+t.pointer};v=v[k];}
  if(typeof v!=='string')return {error:'pointer is not a string: '+t.pointer};
  const p=t.base==='repo'?v:posix.join(posix.dirname(t.configFile),v);
  return withLine({target:keyFor(name,posix.normalize(p),ctx),via:{configFile:cfgKey,pointer:t.pointer,value:v}},t,ctx);
}
// Optional target anchor {line,expect}: the target line must still contain expect, else the edge is stale.
function withLine(r,t,ctx){
  if(t.line===undefined)return r;
  let text;try{text=readKey(r.target,ctx).toString('utf8');}catch(e){return {error:'target unreadable: '+r.target};}
  const got=text.split(/\r?\n/)[t.line-1]??'';if(t.expect!==undefined&&!got.includes(t.expect))return {error:'target line '+t.line+' no longer contains expect'};
  return {...r,via:{...(r.via??{}),targetAnchor:{file:splitKey(r.target,ctx).path,repo:splitKey(r.target,ctx).name,line:t.line,text:got.trim().slice(0,240),sha256:sha256(Buffer.from(text))}}};
}
// Zone/direction rules from boundary.mjs; zone.repo may be a configured repo name or an absolute root.
export function crossRules(config,ctx){
  if(!config.crossRepoRules)return null;
  const roots=new Map([[ctx.primary,ctx.repo],...[...ctx.extra.values()].map(r=>[r.name,r.root])]);
  const c=configuration({...config.crossRepoRules,zones:config.crossRepoRules.zones.map(z=>({...z,repo:roots.get(z.repo)??z.repo}))});
  return {...c,roots};
}
function zoneOf(key,rules,ctx){const s=splitKey(key,ctx);return rules.zones.find(z=>z.repo===s.root&&z.patterns.some(p=>p.test(s.path)))??null;}
export function classifyCross(e,target,rules,ctx){
  if(!rules)return {classification:'UNKNOWN',reason:'NO_CROSS_REPO_RULES'};
  const fz=zoneOf(e.path,rules,ctx),tz=zoneOf(target,rules,ctx);
  if(!fz||!tz)return {classification:'UNKNOWN',reason:'OUTSIDE_ZONE_INCLUDE',fromZone:fz?.name??null,toZone:tz?.name??null};
  const rule=rules.rules.find(r=>r.from===fz.name&&r.to===tz.name);
  if(!rule)return {classification:'UNKNOWN',reason:'NO_DIRECTION_RULE',fromZone:fz.name,toZone:tz.name};
  const declared=String(e.kind).startsWith('DECLARED_')||rule.markers.some(m=>String(e.specifier??'').includes(m));
  return {classification:rule.allow===false?'VIOLATION':rule.allow===true?'ALLOWED':declared?'DECLARED':'UNKNOWN',...(rule.allow==='declared'&&!declared?{reason:'DECLARATION_MARKER_NOT_FOUND'}:{}),fromZone:fz.name,toZone:tz.name,rule:rule.index};
}
// Labels cross-repo edges in place and returns the flat summary rows.
export function markCross(edges,rules,ctx){
  const rows=[];if(!ctx.extra.size)return rows;
  for(const e of edges){const from=splitKey(e.path,ctx).name;
    // A relative import inside "@repo/" that climbs past the prefix would resolve to a primary key; drop that target.
    if(typeof e.specifier==='string'&&e.specifier.startsWith('.')&&!String(e.kind).startsWith('CROSS_REPO')&&e.targets?.length){
      const s=splitKey(e.path,ctx),abs=resolve(s.root,posix.dirname(s.path),e.specifier);
      const bad=e.targets.filter(t=>{const q=splitKey(t,ctx),tAbs=resolve(q.root,q.path);return q.name!==from&&!(tAbs===abs||tAbs.startsWith(abs+'.')||tAbs.startsWith(abs+sep));});
      if(bad.length){e.targets=e.targets.filter(t=>!bad.includes(t));e.crossRepoMisresolved=bad;}}
    for(const t of e.targets??[]){const to=splitKey(t,ctx).name;if(to===from)continue;
      const cls=classifyCross(e,t,rules,ctx);e.crossRepo={from,to,...cls};
      rows.push({kind:e.kind,from:{repo:from,file:splitKey(e.path,ctx).path,line:e.line??null},to:{repo:to,file:splitKey(t,ctx).path},specifier:e.specifier??null,basis:e.basis??null,...(e.via?{via:e.via}:{}),runtimeVerified:false,...cls});}}
  return rows;
}
const mid=s=>'n'+sha256(s).slice(0,10),lab=s=>String(s).replace(/["<>]/g,'');
// Mermaid flowchart of one closure; nodes are grouped per repo and cross-repo edges are dashed and labelled.
export function closureMermaid(closure,ctx){
  const lines=['flowchart LR'],groups=new Map();
  for(const f of closure.files){const s=splitKey(f,ctx);if(!groups.has(s.name))groups.set(s.name,[]);groups.get(s.name).push([f,s.path]);}
  for(const [name,files] of groups){lines.push('  subgraph '+mid('repo:'+name)+'["repo: '+lab(name)+'"]');for(const [k,p] of files)lines.push('    '+mid(k)+'["'+lab(p)+'"]');lines.push('  end');}
  const seen=new Set();
  for(const e of closure.edges)for(const t of e.targets??[]){if(!closure.files.includes(e.path)||!closure.files.includes(t))continue;const id=e.path+'>'+t;if(seen.has(id))continue;seen.add(id);
    lines.push(e.crossRepo?'  '+mid(e.path)+' -. "cross-repo '+lab(e.crossRepo.classification)+(e.line?' :'+e.line:'')+'" .-> '+mid(t):'  '+mid(e.path)+' --> '+mid(t));}
  lines.push('  classDef cross stroke-dasharray:4 3');
  return lines.join('\n')+'\n';
}
