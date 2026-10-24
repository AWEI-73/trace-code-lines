// Source-bound route authoring: independent of the existing report outputs.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {readBounded,noLinks,sha256} from './walker.mjs';
import {humanIssues} from './report-html.mjs';
import {writeUTF8} from './report.mjs';
import {renderRouteMap} from './route-map-html.mjs';
const lex=JSON.parse(fs.readFileSync(new URL('../assets/plain-language.json',import.meta.url),'utf8'));
const unique=xs=>[...new Set(xs)];
const safeFile=s=>typeof s==='string'&&s.length>0&&!s.includes('\\')&&!s.includes(':')&&!s.startsWith('/')&&!s.split('/').some(x=>x==='..'||x==='.'||!x);
const plain=s=>typeof s==='string'&&s.trim().length>0&&s.length<=120&&!/[A-Za-z_<>`]/.test(s)&&!lex.forbidden.some(w=>s.toLowerCase().includes(w.toLowerCase()));
export function mapEdges(maps){
 const rows=[];
 for(const map of maps)for(const e of [...(map.closures??[]).flatMap(c=>c.edges??[]),...(map.gasAnalysis?.edges??[])]){
  if(!safeFile(e.path)||e.external||e.inClosure===false)continue;
  for(const to of e.targets??[])if(safeFile(to))rows.push({from:e.path,to,line:e.line,sites:e.sites??[],kind:e.kind});
 }
 return [...new Map(rows.map(e=>[JSON.stringify(e),e])).values()];
}
export function candidateRoutes(maps,read,{maxDepth=12,maxPerEntry=40}={}){
 const edges=mapEdges(maps),entries=unique(maps.flatMap(m=>[...(m.roots??[]).map(r=>typeof r==='string'?r:r.path),...(m.gasEntryPoints??[]).map(r=>r.path??r.file)]).filter(safeFile));
 const candidates=[],limits=[];
 for(const entry of entries){
  const queue=[{file:entry,files:[entry],hops:[]}],seen=new Set([entry]);let count=0;
  while(queue.length&&count<maxPerEntry){const p=queue.shift(),next=edges.filter(e=>e.from===p.file&&e.to!==p.file);
   if(p.hops.length&&(!next.some(e=>!seen.has(e.to))||p.hops.length>=maxDepth)){
    candidates.push({id:'draft-'+candidates.length,entry,files:p.files,hops:p.hops});count++;
    if(p.hops.length>=maxDepth)limits.push({entry,reason:'DEPTH_LIMIT',maxDepth});continue;
   }
   for(const e of next){if(seen.has(e.to))continue;seen.add(e.to);let expect=null;try{expect=String(read(e.from)).split(/\r?\n/)[e.line-1]?.trim()||null;}catch{}
    queue.push({file:e.to,files:[...p.files,e.to],hops:[...p.hops,{from:e.from,to:e.to,anchor:{file:e.from,line:e.line,expect},kind:e.kind}]});
   }
  }
  if(queue.length)limits.push({entry,reason:'COUNT_LIMIT',maxPerEntry});
 }
 return {schema:'route-candidates-v1',draft:true,displayable:false,method:'bounded shortest-path tree per entry; cycles and alternative paths omitted',entries,candidates,limits};
}
export function checkRoutes(input,maps,read,health=null){
 if(input.schema!=='routes-v1'||!Array.isArray(input.stations)||!Array.isArray(input.routes))throw Error('routes-v1 with stations/routes required');
 const ids=new Set(),byId=new Map();
 for(const s of input.stations){if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||!safeFile(s.file)||!plain(s.name)||s.name.length>36||!plain(s.block)||s.block.length>36||typeof s.inferred!=='boolean')throw Error('Invalid or duplicate station');ids.add(s.id);byId.set(s.id,s);}
 const edges=mapEdges(maps),routes=[],rejected=[],routeIds=new Set();
 for(const r of input.routes){const reasons=[];if(!r||typeof r.id!=='string'||!r.id||routeIds.has(r.id)||!plain(r.name)||!plain(r.description)||!Array.isArray(r.hops)||!r.hops.length){rejected.push({id:r?.id??null,reasons:['INVALID_ROUTE']});continue;}routeIds.add(r.id);
  const hops=r.hops.map((h,i)=>{
   const from=byId.get(h.from),to=byId.get(h.to),a=h.anchor??{};let body=null;
   if(!from||!to||!plain(h.action)||i>0&&r.hops[i-1].to!==h.from)reasons.push('INVALID_HOP:'+i);
   if(!safeFile(a.file)||!Number.isInteger(a.line)||a.line<1||typeof a.expect!=='string'||!a.expect.trim()||/[\r\n]/.test(a.expect)||a.file!==from?.file)reasons.push('INVALID_ANCHOR:'+i);
   else try{body=String(read(a.file));if(!body.split(/\r?\n/)[a.line-1]?.includes(a.expect))reasons.push('ANCHOR_MISMATCH:'+i);}catch{reasons.push('ANCHOR_UNREADABLE:'+i);}
   // Pair and site must agree; an unrelated import elsewhere cannot certify this hop.
   const matched=edges.find(e=>e.from===from?.file&&e.to===to?.file&&(e.line===a.line||e.sites.some(s=>s.line===a.line)));
   return {...h,verification:matched?'map':'manual',manual:!matched,sourceSha256:body===null?null:sha256(body)};
  });
  if(reasons.length)rejected.push({id:r.id,name:r.name,reasons:unique(reasons)});else routes.push({...r,hops});
 }
 const used=new Set(routes.flatMap(r=>r.hops.flatMap(h=>[h.from,h.to]))),cards=health?humanIssues(health):[];
 const stations=input.stations.filter(s=>used.has(s.id)).map(s=>{
  const issues=cards.filter(c=>c.file===s.file||c.targets.includes(s.file)||c.items.some(i=>(i.witnesses??[]).some(w=>w.file===s.file))).map(c=>({id:c.id,...lex.issues[c.category]}));
  for(const g of health?.groups??[])if(g.files.includes(s.file)){const copy=lex.issues[g.category];if(copy)issues.push({id:'group-'+g.id,name:copy.name,description:copy.description.replace('{n}',g.files.length),risk:copy.risk,advice:copy.advice});}
  return {...s,issues};
 });
 for(const r of routes)r.hasIssues=r.hops.some(h=>[h.from,h.to].some(id=>stations.find(s=>s.id===id)?.issues.length));
 return {schema:'checked-routes-v1',title:plain(input.title)?input.title:'\u7a0b\u5f0f\u8def\u7dda',status:rejected.length?'DEGRADED':'PASS',runtimeVerified:false,stations,routes,rejected,limits:[...rejected.map(r=>'\u8def\u7dda\u672a\u986f\u793a\uff1a'+(r.name??r.id)),...(health?[]:['\u672a\u63d0\u4f9b\u5065\u6aa2\u554f\u984c\u8cc7\u6599\u3002'])]};
}
const inside=(base,p)=>{const rel=path.relative(base,p);return !rel||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
export function runRoutes(configPath,mode='render'){
 const absolute=path.resolve(configPath),config=JSON.parse(fs.readFileSync(absolute,'utf8')),base=path.dirname(absolute);
 const mapPaths=(config.maps??[]).map(p=>path.resolve(base,typeof p==='string'?p:p.path)),maps=mapPaths.map(p=>JSON.parse(fs.readFileSync(p,'utf8')));if(!maps.length)throw Error('maps required');
 const repo=noLinks(path.resolve(maps[0].repo));if(maps.some(m=>path.resolve(m.repo)!==repo))throw Error('Map roots differ');
 const git=args=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
 const head=git(['rev-parse','HEAD']).trim(),status=git(['status','--porcelain']);if(status||maps.some(m=>m.head!==head))throw Error('Source snapshot changed');
 const out=noLinks(path.resolve(base,config.outDir??'routes')),inputPaths=[absolute,...mapPaths,...[config.routes,config.health].filter(Boolean).map(p=>path.resolve(base,p))];
 const outputs=(mode==='candidates'?['route-candidates.json']:['route-map.html','routes-checked.json','route-report.md']).map(f=>path.join(out,f));
 if(inside(repo,out)||outputs.some(p=>inputPaths.includes(p)))throw Error('Output overlaps source/input');for(const p of outputs)noLinks(p);
 const reads=new Map(),read=file=>{const body=readBounded(repo,file).toString('utf8');reads.set(file,sha256(body));return body;};
 let value,health=null;
 if(mode==='candidates')value=candidateRoutes(maps,read);
 else {
  if(config.health){health=JSON.parse(fs.readFileSync(path.resolve(base,config.health),'utf8'));if(path.resolve(health.repo)!==repo||health.commit!==head)throw Error('Health snapshot mismatch');}
  value=checkRoutes(JSON.parse(fs.readFileSync(path.resolve(base,config.routes),'utf8')),maps,read,health);
 }
 for(const [file,digest] of reads)if(sha256(readBounded(repo,file))!==digest)throw Error('Source changed during read');if(git(['rev-parse','HEAD']).trim()!==head||git(['status','--porcelain'])!==status)throw Error('Source integrity changed');
 fs.mkdirSync(out,{recursive:true});let receipts;
 if(mode==='candidates')receipts=[writeUTF8(outputs[0],JSON.stringify(value,null,2)+'\n')];
 else receipts=[writeUTF8(outputs[0],renderRouteMap(value)),writeUTF8(outputs[1],JSON.stringify(value,null,2)+'\n'),writeUTF8(outputs[2],'# \u8def\u7dda\u52d5\u614b\u5716\u6838\u5c0d\n\n'+value.routes.length+' \u689d\u8def\u7dda\u986f\u793a\uff1b'+value.rejected.length+' \u689d\u672a\u986f\u793a\u3002\n\n'+value.routes.map(r=>'- '+r.name+'\uff1a'+r.hops.length+' \u6bb5\uff0c'+r.hops.filter(h=>h.manual).length+' \u6bb5\u4eba\u5de5\u5224\u8b80\u3002').join('\n')+'\n\n## \u9650\u5236\n\n\u7dda\u8868\u793a\u7a0b\u5f0f\u78bc\u88e1\u7684\u5f15\u7528\uff0c\u4e0d\u4ee3\u8868\u5be6\u969b\u57f7\u884c\u904e\u3002\u865b\u7dda\u662f\u6709\u539f\u6587\u4f46\u672a\u7531\u5de5\u5177\u627e\u5230\u9023\u7dda\u7684\u4eba\u5de5\u5224\u8b80\u3002\n'+value.limits.map(x=>'- '+x).join('\n')+'\n\n```json\n'+JSON.stringify(value.rejected,null,2)+'\n```\n')];
 return {status:value.status??'DRAFT',routes:value.routes?.length,candidates:value.candidates?.length,receipts};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const args=process.argv.slice(2);if(args.length===1&&args[0]==='--help')console.log('Usage: node route-map.mjs [candidates|render] --config routes-config.json');else{if(args.length!==3||!['candidates','render'].includes(args[0])||args[1]!=='--config')throw Error('Use --help');console.log(JSON.stringify(runRoutes(args[2],args[0])));}}catch(e){console.error(e.message);process.exitCode=1;}}
