// Source-bound route authoring: independent of the existing report outputs.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {readBounded,noLinks,sha256} from './walker.mjs';
import {humanIssues} from './report-html.mjs';
import {writeUTF8} from './report.mjs';
import {renderRouteMap} from './route-map-html.mjs';
import {importUses} from './reach.mjs';
import {tokens} from './language-static.mjs';
const lex=JSON.parse(fs.readFileSync(new URL('../assets/plain-language.json',import.meta.url),'utf8'));
const unique=xs=>[...new Set(xs)];
const safeFile=s=>typeof s==='string'&&s.length>0&&!s.includes('\\')&&!s.includes(':')&&!s.startsWith('/')&&!s.split('/').some(x=>x==='..'||x==='.'||!x);
const plain=s=>typeof s==='string'&&s.trim().length>0&&s.length<=120&&!/[A-Za-z_<>`]/.test(s)&&!lex.forbidden.some(w=>s.toLowerCase().includes(w.toLowerCase()));
export function mapEdges(maps){
 const rows=[];
 for(const map of maps)for(const e of [...(map.closures??[]).flatMap(c=>c.edges??[]),...(map.gasAnalysis?.edges??[])]){
  if(!safeFile(e.path)||e.external||e.inClosure===false)continue;
  for(const to of e.targets??[])if(safeFile(to))rows.push({from:e.path,to,line:e.line,sites:e.sites??[],kind:e.kind,specifier:e.specifier,typeOnly:e.typeOnly,resolutionOnly:e.resolutionOnly});
 }
 return [...new Map(rows.map(e=>[JSON.stringify(e),e])).values()];
}
// These proofs describe lexical value references, never execution or control flow.
function routeTokens(source){
 const raw=tokens(source,false,{regexLiterals:true}).filter(t=>t.v!=='\n'),out=[];
 for(let i=0;i<raw.length;i++){
  const a=raw[i],b=raw[i+1];
  if(b&&a.end===b.start&&['=>','?.'].includes(a.v+b.v)){out.push({...a,v:a.v+b.v,end:b.end});i++;}else out.push(a);
 }
 return out;
}
function tokenPairs(t){
 const pairs=new Map(),stack=[];
 for(let i=0;i<t.length;i++){
  if(t[i].kind==='string'||t[i].kind==='regex')continue;
  if(['(','[','{'].includes(t[i].v))stack.push(i);
  else if([')',']','}'].includes(t[i].v)){const open=stack.pop();if(open!==undefined&&'([{'.indexOf(t[open].v)===')]}'.indexOf(t[i].v)){pairs.set(open,i);pairs.set(i,open);}}
 }
 return pairs;
}
function possibleShadow(t,pairs,name){
 for(let i=0;i<t.length;i++){
  if(t[i].kind==='string'||t[i].kind==='regex')continue;
  if(t[i].v===name&&(['const','let','var','function','class'].includes(t[i-1]?.v)||t[i+1]?.v==='=>'))return true;
  // Includes methods, catch bindings, typed parameters and parenthesized arrows.
  if(t[i].v==='('&&pairs.has(i)){
   const end=pairs.get(i),after=t[end+1]?.v,previous=t[i-1]?.v;
   if(['{',':','=>'].includes(after)&&!['if','while','for','switch','with'].includes(previous)&&t.slice(i+1,end).some(x=>x.kind==='name'&&x.v===name))return true;
  }
  // A pattern followed by assignment/type/iteration is a possible declaration;
  // reject ambiguous property keys too, rather than guess its binding roles.
  if(['{','['].includes(t[i].v)&&pairs.has(i)&&['const','let','var',','].includes(t[i-1]?.v)){
   const end=pairs.get(i);
   if(['=',':','of','in'].includes(t[end+1]?.v)&&t.slice(i+1,end).some(x=>x.kind==='name'&&x.v===name))return true;
  }
 }
 return false;
}
function valueExports(source){
 const t=routeTokens(source),pairs=tokenPairs(t),locals=new Map(),exports=new Map(),lists=[],defaults=[];let depth=0;
 const declaration=i=>{
  if(t[i-1]?.v==='declare')return null;
  const previous=t[i-1]?.v==='async'?t[i-2]?.v:t[i-1]?.v;
  if(t[i]?.kind==='name'&&t[i].v==='async')i++;
  if(t[i]?.kind!=='name'||!['function','class','const','let','var'].includes(t[i].v))return null;
  // A named function/class expression does not introduce a module-local value.
  if(['function','class'].includes(t[i].v)&&['=','(',',',':','?','[','return'].includes(previous))return null;
  let n=i+1;if(t[n]?.v==='*')n++;
  return t[n]?.kind==='name'?{name:t[n].v,line:t[i].line}:null;
 };
 for(let i=0;i<t.length;i++){
  if(t[i].kind==='string'||t[i].kind==='regex')continue;
  if(!depth){
   const local=declaration(i);if(local)locals.set(local.name,local);
   if(t[i].kind==='name'&&t[i].v==='export'){
    const next=t[i+1];
    if(next?.v==='default'){
     const expression=t[i+2],item=declaration(i+2),entry={name:'default',local:item?.name??null,line:t[i].line,kind:'DEFAULT_VALUE_EXPORT'};
     if(expression&&!['interface','type','declare'].includes(expression.v)){
      if(expression.kind==='name'&&!['function','class','async','true','false','null','undefined','new'].includes(expression.v))defaults.push({...entry,local:expression.v});
      else exports.set('default',entry);
     }
    }else if(next?.v==='{'){
     const end=pairs.get(i+1);
     if(end!==undefined&&t[end+1]?.v!=='from')lists.push({start:i+2,end,line:t[i].line});
    }else{
     const item=declaration(i+1);if(item)exports.set(item.name,{...item,local:item.name,kind:'DIRECT_VALUE_EXPORT'});
    }
   }
  }
  if(t[i].v==='{')depth++;else if(t[i].v==='}')depth--;
 }
 for(const entry of defaults)if(locals.has(entry.local))exports.set('default',entry);
 for(const list of lists){
  const groups=[[]];for(const x of t.slice(list.start,list.end)){if(x.v===',')groups.push([]);else groups.at(-1).push(x);}
  for(const group of groups){
   if(!group.length||group[0].v==='type'||!locals.has(group[0].v))continue;
   const as=group.findIndex(x=>x.v==='as'),name=as>=0?group[as+1]?.v:group[0].v;
   if(name)exports.set(name,{name,local:group[0].v,line:list.line,kind:'LOCAL_VALUE_EXPORT_LIST'});
  }
 }
 return exports;
}
function valueImport(edge,t,binding){
 const start=t.findIndex(x=>x.line===edge.line&&x.kind==='name'&&x.v==='import');if(start<0)return false;
 let end=start+1;while(end<t.length&&!(t[end].kind==='string'&&t[end].v===edge.specifier))end++;
 if(end===t.length)return false;
 const clause=t.slice(start+1,end),from=clause.findIndex(x=>x.v==='from'),body=from<0?clause:clause.slice(0,from);
 if(body[0]?.v==='type')return false;
 if(binding.imported==='default')return body[0]?.kind==='name'&&body[0].v===binding.local;
 if(binding.imported==='*'){const star=body.findIndex(x=>x.v==='*');return star>=0&&body[star+1]?.v==='as'&&body[star+2]?.v===binding.local;}
 const open=body.findIndex(x=>x.v==='{'),close=body.findIndex(x=>x.v==='}');if(open<0||close<=open)return false;
 const groups=[[]];for(const x of body.slice(open+1,close)){if(x.v===',')groups.push([]);else groups.at(-1).push(x);}
 return groups.some(g=>{if(g[0]?.v==='type')return false;const as=g.findIndex(x=>x.v==='as');return g[0]?.v===binding.imported&&(as>=0?g[as+1]?.v:g[0]?.v)===binding.local;});
}
function importCallProof(from,to,anchor,source,edges,read,cache){
 const t=routeTokens(source),pairs=tokenPairs(t),sourceSha256=sha256(source);
 for(const edge of edges.filter(e=>e.from===from&&e.to===to&&e.kind==='STATIC_IMPORT'&&typeof e.specifier==='string'&&!e.typeOnly&&!e.resolutionOnly)){
  const uses=importUses({...edge,path:from},source);
  if(uses.gaps.some(g=>/^(BINDING_SHADOW|REEXPORT|IMPORT_|TYPE_ONLY|SIDE_EFFECT)/.test(g.code)))continue;
  for(const site of uses.callSites.filter(s=>s.line===anchor.line)){
   const binding=uses.names.find(n=>n.local===site.name);if(!binding||!valueImport(edge,t,binding)||possibleShadow(t,pairs,binding.local))continue;
   const at=t.findIndex(x=>x.line===site.line&&x.v===site.name&&x.start-(source.lastIndexOf('\n',x.start-1)+1)+1===site.column);if(at<0)continue;
   let exported=binding.imported,callee=at;
   if(binding.imported==='*'){
    if(!['.','?.'].includes(t[at+1]?.v)||t[at+2]?.kind!=='name')continue;
    callee=at+2;exported=t[callee].v;
   }
   const open=t[callee+1]?.v==='('?callee+1:t[callee+1]?.v==='?.'&&t[callee+2]?.v==='('?callee+2:null;
   if(open===null||!pairs.has(open))continue;
   const after=t[pairs.get(open)+1]?.v,before=t[at-1]?.v,ternaryCall=before==='?'||before==='await'&&t[at-2]?.v==='?';
   if(['{','=>'].includes(after)||after===':'&&!ternaryCall)continue;
   let target=cache.get(to);
   if(!target){try{const body=String(read(to));target={sourceSha256:sha256(body),exports:valueExports(body)};cache.set(to,target);}catch{continue;}}
   const declaration=target.exports.get(exported);if(!declaration)continue;
   return {kind:'IMPORT_USE_EXPORT',runtimeVerified:false,sourceSha256,targetSourceSha256:target.sourceSha256,
    import:{file:from,line:edge.line,specifier:edge.specifier,names:[{...binding,...(binding.imported==='*'?{member:exported}:{})}]},
    export:{file:to,...declaration},reference:{file:from,line:site.line,column:site.column,name:binding.local,kind:binding.imported==='*'?'NAMESPACE_MEMBER_CALL':'CALL',...(binding.imported==='*'?{member:exported}:{}),snippetSha256:site.snippetSha256,guarded:site.guarded,conditionStatus:site.conditionStatus}};
  }
 }
 return null;
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
 const edges=mapEdges(maps),routes=[],rejected=[],routeIds=new Set(),exportCache=new Map();
 for(const r of input.routes){const reasons=[];if(!r||typeof r.id!=='string'||!r.id||routeIds.has(r.id)||!plain(r.name)||!plain(r.description)||!Array.isArray(r.hops)||!r.hops.length){rejected.push({id:r?.id??null,reasons:['INVALID_ROUTE']});continue;}routeIds.add(r.id);
  const hops=r.hops.map((h,i)=>{
   const from=byId.get(h.from),to=byId.get(h.to),a=h.anchor??{};let body=null,anchorPassed=false;
   if(!from||!to||!plain(h.action)||i>0&&r.hops[i-1].to!==h.from)reasons.push('INVALID_HOP:'+i);
   if(!safeFile(a.file)||!Number.isInteger(a.line)||a.line<1||typeof a.expect!=='string'||!a.expect.trim()||/[\r\n]/.test(a.expect)||a.file!==from?.file)reasons.push('INVALID_ANCHOR:'+i);
   else try{body=String(read(a.file));anchorPassed=!!body.split(/\r?\n/)[a.line-1]?.includes(a.expect);if(!anchorPassed)reasons.push('ANCHOR_MISMATCH:'+i);}catch{reasons.push('ANCHOR_UNREADABLE:'+i);}
   // Pair and site must agree; an unrelated import elsewhere cannot certify this hop.
   const matched=anchorPassed&&edges.find(e=>e.from===from?.file&&e.to===to?.file&&(e.line===a.line||e.sites.some(s=>s.line===a.line)));
   const proof=matched?{kind:'MAP_EXACT_SITE',runtimeVerified:false,sourceSha256:sha256(body),import:{file:from.file,line:matched.line,kind:matched.kind,specifier:matched.specifier??null,names:[]},export:null,reference:{file:from.file,line:a.line}}:
    anchorPassed&&from&&to?importCallProof(from.file,to.file,a,body,edges,read,exportCache):null;
   return {...h,verification:proof?'map':'manual',manual:!proof,sourceSha256:body===null?null:sha256(body),proof:proof??null};
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
