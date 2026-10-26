// Read-only, configured dependency-direction evidence. Never imports target code.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isBuiltin} from 'node:module';
import {walk,readBounded,noLinks,sha256} from './walker.mjs';
import {tokens,callArgs,localFunctions} from './language-static.mjs';
import {toolVersion} from './derive-map.mjs';

const codeFile=p=>/\.(?:[cm]?[jt]s|tsx|jsx|py|gs)$/i.test(p);
const compact=t=>t.filter(x=>x.v!=='\n');
const unique=xs=>[...new Set(xs)];
const within=(root,p)=>{const r=relative(root,p);return r===''||(!r.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&r!=='..'&&!isAbsolute(r));};
const git=(repo,args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},windowsHide:true,maxBuffer:64*1024*1024});
function glob(pattern){
 if(typeof pattern!=='string'||!pattern||pattern.startsWith('/')||pattern.includes('\\')||pattern.split('/').includes('..')||/[\x00-\x1f]/.test(pattern))throw Error('Invalid zone include');
 let out='^';for(let i=0;i<pattern.length;i++){
  if(pattern.slice(i,i+3)==='**/'){out+='(?:.*/)?';i+=2;}
  else if(pattern.slice(i,i+2)==='**'){out+='.*';i++;}
  else if(pattern[i]==='*')out+='[^/]*';
  else if(pattern[i]==='?')out+='[^/]';
  else out+=pattern[i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 }return new RegExp(out+'$');
}
function configuration(config){
 if(!Array.isArray(config?.zones)||!config.zones.length||!Array.isArray(config.rules))throw Error('zones and rules required');
 const names=new Set();
 const zones=config.zones.map(z=>{
  if(typeof z.name!=='string'||!z.name||names.has(z.name))throw Error('Unique zone names required');names.add(z.name);
  if(typeof z.repo!=='string'||!isAbsolute(z.repo))throw Error('Zone repo must be absolute');
  const repo=noLinks(resolve(z.repo));if(!fs.statSync(repo).isDirectory())throw Error('Zone repo must be a directory');
  if(!Array.isArray(z.include)||!z.include.length)throw Error('Zone include required');
  return {...z,repo,patterns:z.include.map(glob)};
 });
 const directions=new Set();
 const rules=config.rules.map((r,index)=>{
  if(!names.has(r.from)||!names.has(r.to)||r.from===r.to||![true,false,'declared'].includes(r.allow))throw Error('Invalid direction rule');
  const key=JSON.stringify([r.from,r.to]);if(directions.has(key))throw Error('Duplicate direction rule');directions.add(key);
  if(!Array.isArray(r.markers)||r.markers.some(m=>typeof m!=='string'||!m.trim()))throw Error('Rule markers must be strings');
  return {...r,index,markers:unique(r.markers)};
 });return {zones,rules};
}
function endExpression(t,start){
 let depth=0,i=start;
 for(;i<t.length;i++){
  const x=t[i];if(x.kind==='string'||x.kind==='regex')continue;
  if(!depth&&[';',',','\n',')',']','}'].includes(x.v))break;
  if(['(','[','{'].includes(x.v))depth++;
  if([')',']','}'].includes(x.v))depth--;
 }return i;
}
function functionRanges(t,source,py){
 const ranges=localFunctions(t,source,py,true).map(f=>({...f}));
 if(py)return ranges;
 // Include anonymous functions and arrows so assignments never leak from siblings.
 for(let i=0;i<t.length;i++){
  let start,params=[];
  if(t[i].v==='function'){
   const open=t[i+1]?.v==='('?i+1:i+2;if(t[open]?.v!=='(')continue;
   const a=callArgs(t,open);start=a.end+1;while(t[start]?.v==='\n')start++;params=a.args.map(a=>({name:a[0]?.v}));
  }else if(t[i].v==='='&&t[i+1]?.v==='>'){
   start=i+2;while(t[start]?.v==='\n')start++;
   if(t[i-1]?.v===')'){let depth=1,k=i-2;for(;k>=0;k--){if(t[k].v===')')depth++;if(t[k].v==='('&&!--depth)break;}if(k>=0)params=callArgs(t,k).args.map(a=>({name:a[0]?.v}));}
   else params=[{name:t[i-1]?.v}];
  }else continue;
  if(ranges.some(f=>f.start===start+1))continue;
  let end;
  if(t[start]?.v==='{'){let depth=1;end=start+1;for(;end<t.length;end++){if(t[end].kind==='string'||t[end].kind==='regex')continue;if(t[end].v==='{')depth++;if(t[end].v==='}'&&!--depth)break;}start++;}
  else end=endExpression(t,start);
  ranges.push({name:'<anonymous>',start,end,params,line:t[i].line});
 }return ranges;
}
function markerHits(ts,markers){
 const t=compact(ts),hits=[];
 for(const marker of markers){
  let found=t.some(x=>x.kind==='string'&&x.v.includes(marker));
  if(!found&&/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(marker)){
   const parts=marker.split('.');
   found=t.some((x,i)=>x.kind==='name'&&x.v===parts[0]&&parts.every((v,k)=>k===0||t[i+k*2-1]?.v==='.'&&t[i+k*2]?.kind==='name'&&t[i+k*2].v===v));
  }
  if(found)hits.push(marker);
 }return hits;
}
function anchor(file,source,start,end){
 const snippet=source.slice(start,end),line=source.slice(0,start).split('\n').length;
 return {file,line,endLine:line+(snippet.match(/\n/g)||[]).length,column:start-(source.lastIndexOf('\n',start-1)+1)+1,snippet,snippetSha256:sha256(snippet),sourceSha256:sha256(source)};
}

export function pathSites(file,source){
 const py=file.endsWith('.py'),t=tokens(source,py,{regexLiterals:true}),ranges=functionRanges(t,source,py);
 const scopes=i=>ranges.filter(f=>i>=f.start&&i<f.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start));
 const scope=i=>scopes(i)[0]??null,assignments=new Map(),writes=new Map();
 for(let i=0;i<t.length;i++){
  if(t[i].kind!=='name'||t[i-1]?.v==='.')continue;
  const next=t[i+1]?.v,after=t[i+2]?.v;
  const simple=next==='='&&!['=','>'].includes(after)&&!['=','!','<','>'].includes(t[i-1]?.v);
  const mutation=simple||['+','-','*','/','|','&','?'].includes(next)&&['=','+','-'].includes(after);
  if(!mutation)continue;
  const key=t[i].v,entry={at:i,scope:scope(i),tokens:simple?t.slice(i+2,endExpression(t,i+2)):[],simple};
  if(!writes.has(key))writes.set(key,[]);writes.get(key).push(entry);
  if(simple){if(!assignments.has(key))assignments.set(key,[]);assignments.get(key).push(entry);}
 }
 function expand(arg,at){
  const expanded=[...arg],bindings=[],gaps=[],visited=new Set();
  function visit(ts,before,depth){
   if(depth>8){gaps.push('BINDING_DEPTH_LIMIT');return;}
   for(let k=0;k<ts.length;k++){
    const x=ts[k];if(x.kind!=='name'||ts[k-1]?.v==='.'||ts[k+1]?.v==='('||ts[k+1]?.v===':'||ts[k+1]?.v==='.')continue;
    const chain=[...scopes(before),null];let chosen;
    for(const owner of chain){
     if(owner?.params.some(p=>p.name===x.v)){gaps.push('PARAMETER_OR_CAPTURE_UNKNOWN:'+x.v);break;}
     const defs=(assignments.get(x.v)??[]).filter(a=>a.scope===owner);
     const changes=(writes.get(x.v)??[]).filter(a=>a.scope===owner);
     if(defs.length||changes.length){
      if(defs.length===1&&changes.length===1&&defs[0].at<before)chosen=defs[0];
      else gaps.push('MULTIPLE_OR_FORWARD_ASSIGNMENT:'+x.v);
      break;
     }
    }
    if(!chosen)continue;
    if(chosen.tokens.some((x,j,a)=>x.v==='function'||x.v==='='&&a[j+1]?.v==='>')||chosen.tokens[0]?.v==='{'){gaps.push('UNSUPPORTED_BINDING_VALUE:'+x.v);continue;}
    const key=chosen.at;if(visited.has(key))continue;visited.add(key);
    expanded.push(...chosen.tokens);bindings.push({...anchor(file,source,t[chosen.at].start,chosen.tokens.at(-1)?.end??t[chosen.at].end),name:x.v,captured:scope(before)!==chosen.scope});
    visit(chosen.tokens,chosen.at,depth+1);
   }
  }visit(arg,at,0);return {expanded,bindings,gaps:unique(gaps)};
 }
 const sites=[];
 const add=(i,end,kind,args)=>{
  const parts=args.map(arg=>expand(arg,i));
  sites.push({...anchor(file,source,t[i].start,t[end]?.end??t[i].end),kind,expression:args.map(a=>a.length?source.slice(a[0].start,a.at(-1).end):'').join(' | '),tokens:parts.flatMap(p=>p.expanded),bindings:parts.flatMap(p=>p.bindings),gaps:unique(parts.flatMap(p=>p.gaps))});
 };
 for(let i=0;i<t.length;i++){
  if(t[i].kind!=='name'||t[i-1]?.v==='.')continue;
  let name=t[i].v,end=i;while(t[end+1]?.v==='.'&&t[end+2]?.kind==='name'){end+=2;name+='.'+t[end].v;}
  if(t[end+1]?.v==='('){
   const a=callArgs(t,end+1);let kind,argIndices;
   if(!py&&name==='import'){kind='DYNAMIC_IMPORT';argIndices=[0];}
   else if(!py&&name==='require'){kind='REQUIRE';argIndices=[0];}
   else if(!py&&/(?:^|\.)(?:readFileSync|readFile)$/.test(name)){kind='DATA_READ';argIndices=[0];}
   else if(!py&&/(?:^|\.)(?:spawn|spawnSync|execFile|execFileSync|fork)$/.test(name)){kind='SPAWN';argIndices=[0,1];}
   else if(py&&/^importlib\.(?:import_module|util\.spec_from_file_location)$/.test(name)){kind='PY_IMPORTLIB';argIndices=[name.endsWith('spec_from_file_location')?1:0];}
   else if(py&&/^sys\.path\.(?:insert|append|extend)$/.test(name)){kind='PY_SYS_PATH';argIndices=[name.endsWith('insert')?1:0];}
   if(kind&&!ranges.some(f=>f.nameAt===i))add(i,a.end,kind,argIndices.map(k=>a.args[k]??[]));
  }else if(py&&name==='sys.path'){
   let eq=end+1;while(eq<t.length&&!['=','\n',';'].includes(t[eq].v))eq++;
   if(t[eq]?.v==='='){const finish=endExpression(t,eq+1);add(i,finish-1,'PY_SYS_PATH',[t.slice(eq+1,finish)]);}
  }
 }
 return sites;
}

export function boundary(config){
 const {zones,rules}=configuration(config),repos=new Map(),results=[],skipped=[],parserGaps=[];
 const owner=(repo,file)=>zones.filter(z=>z.repo===repo&&z.patterns.some(p=>p.test(file)));
 for(const repo of unique(zones.map(z=>z.repo))){
  const head=git(repo,['rev-parse','HEAD']).trim(),status=git(repo,['status','--porcelain','--untracked-files=all']);
  const tracked=git(repo,['ls-files','-z']).split('\0').filter(Boolean).sort(),rows=new Map(),cache=new Map();
  const read=file=>{if(!cache.has(file))cache.set(file,readBounded(repo,file));return cache.get(file);};
  for(const file of tracked){
   const owners=owner(repo,file);if(owners.length>1)throw Error('Ambiguous zone membership: '+file);
   // All readable tracked paths form the existing resolver's inventory.
   try{rows.set(file,{path:file,sha256:sha256(read(file))});}
   catch(e){skipped.push({repo,file,zone:owners[0]?.name??null,reason:e.code??e.message});continue;}
   if(!owners.length)skipped.push({repo,file,zone:null,reason:'OUTSIDE_ZONE_INCLUDE'});
   else if(!codeFile(file))skipped.push({repo,file,zone:owners[0].name,reason:'UNSUPPORTED_LANGUAGE'});
  }
  for(const file of git(repo,['ls-files','--others','--exclude-standard','-z']).split('\0').filter(Boolean))skipped.push({repo,file,zone:owner(repo,file)[0]?.name??null,reason:'UNTRACKED'});
  const selected=[...rows.keys()].filter(file=>codeFile(file)&&owner(repo,file).length);
  const walked=selected.length?walk(repo,selected,rows,{read,parserCache:new Map(),resolutionCache:new Map()}):{edges:[],gaps:[],files:[]};
  parserGaps.push(...walked.gaps.map(g=>({repo,...g})));
  repos.set(repo,{repo,head,status,tracked,rows,cache,selected,walked});
 }
 function record(from,site,to,matched,rule,basis,gaps=[],extra={}){
  const classification=gaps.includes('AMBIGUOUS_MARKER_TARGET')?'UNKNOWN':!rule?'UNKNOWN':rule.allow===false?'VIOLATION':rule.allow===true?'ALLOWED':matched.length?'DECLARED':'UNKNOWN';
  const reason=!rule?'NO_DIRECTION_RULE':rule.allow==='declared'&&!matched.length?'DECLARATION_MARKER_NOT_FOUND':null;
  results.push({id:'boundary-'+sha256(JSON.stringify([from.repo,from.name,site.file,site.line,site.column,site.kind,to,basis,extra.target])).slice(0,20),from:from.name,to:to??null,repo:from.repo,...site,classification,matchedMarkers:matched,rule:rule?.index??null,basis,gaps:unique([...site.gaps??[],...gaps,...(reason?[reason]:[])]),severity:classification==='VIOLATION'?'needs-attention':classification==='UNKNOWN'?'uncertain':'informational',runtimeVerified:false,...extra});
 }
 for(const z of zones){
  const repo=repos.get(z.repo),outgoing=rules.filter(r=>r.from===z.name);
  for(const file of repo.selected.filter(f=>owner(z.repo,f)[0]===z)){
   const source=repo.cache.get(file).toString('utf8'),sites=pathSites(file,source),edges=repo.walked.edges.filter(e=>e.path===file),resolvedCalls=new Set();
   for(const e of edges.filter(e=>['STATIC_IMPORT','DYNAMIC_IMPORT'].includes(e.kind)&&!e.resolutionOnly)){
    const call=sites.find(s=>s.kind===(e.kind==='DYNAMIC_IMPORT'?'DYNAMIC_IMPORT':e.operation==='require'?'REQUIRE':null)&&s.line===e.line&&compact(s.tokens).length===1&&compact(s.tokens)[0].kind==='string'&&compact(s.tokens)[0].v===e.specifier);
    if(call&&(e.targets??[]).length)resolvedCalls.add(call.line+':'+call.column);
    for(const target of e.targets??[]){
     const targetZone=owner(z.repo,target)[0];
     if(!targetZone||targetZone===z)continue;
     const lineStart=source.split('\n').slice(0,e.line-1).join('\n').length+(e.line>1?1:0),lineEnd=source.indexOf('\n',lineStart);
     const {tokens:ignored,...callSite}=call??{};
     const site=call?callSite:{...anchor(file,source,lineStart,lineEnd<0?source.length:lineEnd),kind:e.kind,bindings:[]};
     const rule=outgoing.find(r=>r.to===targetZone.name),matched=markerHits([{kind:'string',v:e.specifier??''}],rule?.markers??[]);
     record(z,site,targetZone.name,matched,rule,'WALKER_RESOLVED',[],{target,specifier:e.specifier,typeOnly:!!e.typeOnly});
    }
   }
   for(const raw of sites){
    const {tokens:ts,...site}=raw,matches=outgoing.map(rule=>({rule,markers:markerHits(ts,rule.markers)})).filter(m=>m.markers.length);
    if(resolvedCalls.has(site.line+':'+site.column))continue;
    if(matches.length){for(const m of matches)record(z,site,m.rule.to,m.markers,m.rule,'CONFIGURED_MARKER',matches.length>1?['AMBIGUOUS_MARKER_TARGET']:[]);}
    else {
     const literal=compact(ts);if(literal.length===1&&literal[0].kind==='string'&&isBuiltin(literal[0].v)&&['REQUIRE','DYNAMIC_IMPORT'].includes(site.kind))continue;
     record(z,site,null,[],null,'UNRESOLVED_PATH',['PATH_MARKER_NOT_FOUND']);
    }
   }
  }
 }
 // Stable deduplication preserves different columns and independent target directions.
 const findings=[...new Map(results.map(r=>[r.id,r])).values()].sort((a,b)=>a.repo.localeCompare(b.repo)||a.file.localeCompare(b.file)||a.line-b.line||a.column-b.column||String(a.to).localeCompare(String(b.to)));
 const integrity=[];
 for(const r of repos.values()){
  const changed=[];for(const [file,bytes] of r.cache)try{if(sha256(readBounded(r.repo,file))!==sha256(bytes))changed.push(file);}catch{changed.push(file);}
  const headAfter=git(r.repo,['rev-parse','HEAD']).trim(),statusAfter=git(r.repo,['status','--porcelain','--untracked-files=all']);
  integrity.push({repo:r.repo,headBefore:r.head,headAfter,statusBefore:r.status,statusAfter,hashedFiles:r.cache.size,changed,status:r.head===headAfter&&r.status===statusAfter&&!changed.length?'PASS':'FAIL'});
 }
 const counts=Object.fromEntries(['VIOLATION','DECLARED','ALLOWED','UNKNOWN'].map(k=>[k,findings.filter(r=>r.classification===k).length]));
 const scope={population:'Git tracked files; no target execution; ignored paths are not enumerated',fileCount:[...repos.values()].reduce((n,r)=>n+r.selected.length,0),zones:zones.map(z=>({name:z.name,repo:z.repo,include:z.include,files:repos.get(z.repo).selected.filter(f=>owner(z.repo,f)[0]===z)})),skippedFiles:skipped,parserGaps};
 return {schema:'trace-boundary-v1',toolVersion:toolVersion(),configurationSha256:sha256(JSON.stringify(config)),status:integrity.some(r=>r.status==='FAIL')?'STOPPED_INTEGRITY_FAILURE':counts.UNKNOWN||parserGaps.length?'PARTIAL':'PASS',counts,findings,scope,readOnly:{status:integrity.every(r=>r.status==='PASS')?'PASS':'FAIL',repos:integrity},negativeConclusion:counts.VIOLATION===0?{text:'No configured violation observed in the reported scope; gaps and skips limit this observation.',fileCount:scope.fileCount,skippedFiles:skipped.length,unknownFindings:counts.UNKNOWN,parserGaps:parserGaps.length}:null,limitations:['Static lexical evidence only; markers are configured routing signals, not evaluated paths or proof of declaration validity.','Only Git tracked source files are scanned. The existing walker supplies same-repo static resolution; cross-repo computed paths use markers.','Single-assignment lexical bindings are traced backward up to eight hops, including enclosing captures; no cross-file or interprocedural dataflow. Conditional assignment, syntax aliases, destructuring, runtime mutation and full AST semantics are not resolved.','Python recognizes literal importlib and sys.path spellings; aliases and unsupported computations remain parser gaps. Templates are lexical marker signals; embedded expressions are not fully parsed.','Findings can support maintenance/check-card evidence at most needs-attention; existing broken counts are unchanged. No deletion or safety verdict is supplied.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2);if(args.length===1&&args[0]==='--help'){console.log('Usage: node boundary.mjs --config file [--out file]');process.exit(0);}
  if(args[0]!=='--config'||!args[1]||![2,4].includes(args.length)||args.length===4&&(args[2]!=='--out'||!args[3]))throw Error('Usage: node boundary.mjs --config file [--out file]');
  const config=JSON.parse(fs.readFileSync(noLinks(resolve(args[1])),'utf8')),validated=configuration(config),out=args[3]?noLinks(resolve(args[3])):null;
  if(out&&(validated.zones.some(z=>within(z.repo,out))||fs.existsSync(out)))throw Error('Output must be new and outside every zone repo');
  const result=boundary(config);
  if(out){noLinks(out);fs.mkdirSync(dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{encoding:'utf8',flag:'wx'});console.log(JSON.stringify({schema:result.schema,status:result.status,counts:result.counts,outputs:{boundary:out}}));}
  else console.log(JSON.stringify(result,null,2));
  if(result.readOnly.status==='FAIL')process.exitCode=2;
 }catch(e){console.error(JSON.stringify({status:'ERROR',message:e.message}));process.exitCode=1;}
}
