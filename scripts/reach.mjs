// Reverse static file reachability. Never imports or executes analyzed code.
import fs from 'node:fs';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {safeName,noLinks,readBounded,sha256} from './walker.mjs';
import {tokens} from './language-static.mjs';
import {toolVersion} from './derive-map.mjs';

const unique=rows=>[...new Map(rows.map(r=>[JSON.stringify(r),r])).values()];
const within=(root,p)=>{const r=relative(root,p);return r===''||(!r.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&r!=='..'&&!isAbsolute(r));};
const guardNote='Static syntax cannot determine whether this condition holds. Ask the agent to read declarations/configuration; this is not execution or deletion evidence.';
function population(row){
 if(typeof row.population==='string')return {name:row.population,basis:'map'};
 const p=row.root??row.path;
 const name=/(?:^|\/)fixtures?(?:\/|$)/.test(p)?'fixtures':/(?:^|\/)tests?(?:\/|$)|(?:^|\/)test[_-]|\.(?:test|spec)\./.test(p)?'tests':/(?:^|\/)docs?(?:\/|$)|\.md$/.test(p)?'docs':/\.(?:[cm]?[jt]sx?|py|ps1|sh|gs|html)$/.test(p)?'source':'unknown';
 return {name,basis:'conventional-path-heuristic; original classification rules are absent from legacy maps'};
}
function lex(source){
 const raw=tokens(source,false,{regexLiterals:true}).filter(t=>t.v!=='\n'),out=[];
 for(let i=0;i<raw.length;i++){
  const a=raw[i],b=raw[i+1];
  if(b&&a.end===b.start&&['??','||','?.','=>','!=','==','&&'].includes(a.v+b.v)){out.push({...a,v:a.v+b.v,end:b.end});i++;}else out.push(a);
 }
 return out;
}
function pairs(t){
 const map=new Map(),stack=[];
 for(let i=0;i<t.length;i++){if(['(','[','{'].includes(t[i].v))stack.push(i);else if([')',']','}'].includes(t[i].v)){const a=stack.pop();if(a!==undefined&&'([{'.indexOf(t[a].v)===')]}'.indexOf(t[i].v)){map.set(a,i);map.set(i,a);}}}
 return map;
}
function expressionEnd(t,at,pair){
 for(let i=at;i<t.length;i++){
  if(i>at&&t[i].line>t[i-1].line&&!['??','||','&&','?','=',':','+','-','*','/','.','?.','return','throw','await'].includes(t[i-1].v)&&!['(', '[', '.', '?.','??','||','&&','?',':','+','-','*','/'].includes(t[i].v))return i;
  if([';',',',')',']','}',':'].includes(t[i].v))return i;if(['(','[','{'].includes(t[i].v)&&pair.has(i))i=pair.get(i);
 }
 return t.length;
}
function guards(t,pair,source){
 const out=[];
 const add=(start,end,kind,at)=>out.push({start,end,kind,line:t[at].line,snippet:source.slice(t[at].start,t[Math.max(at,end-1)]?.end??source.length)});
 for(let i=0;i<t.length;i++){
  if(['??','||'].includes(t[i].v))add(i+1,expressionEnd(t,i+1,pair),t[i].v,i);
  if(t[i].v==='?'){
   let nesting=0;
   for(let j=i+1;j<t.length;j++){
    if(['(','[','{'].includes(t[j].v)&&pair.has(j)){j=pair.get(j);continue;}
    if([';',')',']','}'].includes(t[j].v))break;
    if(t[j].v==='?')nesting++;
    if(t[j].v===':'){if(nesting){nesting--;continue;}add(j+1,expressionEnd(t,j+1,pair),'ternary-false-branch',i);break;}
   }
  }
  if(t[i].v==='if'&&t[i+1]?.v==='('&&pair.has(i+1)){
   const close=pair.get(i+1),start=close+1,end=t[start]?.v==='{'?pair.get(start)+1:expressionEnd(t,start,pair);
   // The explicit negation is a syntactic hint, not a semantic proof of fallback.
   if(t[i+2]?.v==='!'&&Number.isInteger(end))add(start,end,'if-negated',i);
  }
 }
 return out;
}

// Names are recovered only from the declaration at an existing map edge.
// Old maps do not store local aliases. Unsupported imports remain visible gaps.
export function importUses(edge,source){
 const t=lex(source),pair=pairs(t),gaps=[],names=[];
 const at=t.findIndex((x,i)=>x.line===edge.line&&['import','export'].includes(x.v)&&t.slice(i+1,i+100).find(y=>y.kind==='string')?.v===edge.specifier);
 if(at<0||edge.kind!=='STATIC_IMPORT')return {names,callSites:[],gaps:[{code:'IMPORT_NAMES_UNSUPPORTED',path:edge.path,line:edge.line,kind:edge.kind}]};
 let end=at+1;while(end<t.length&&!(t[end].kind==='string'&&t[end].v===edge.specifier))end++;
 if(end===t.length)return {names,callSites:[],gaps:[{code:'IMPORT_ANCHOR_MISMATCH',path:edge.path,line:edge.line}]};
 const reexport=t[at].v==='export';
 const clause=t.slice(at+1,end),from=clause.findIndex(x=>x.v==='from'),body=from<0?clause:clause.slice(0,from);
 if(body.length&&body[0].kind==='name'&&!['type'].includes(body[0].v))names.push({imported:'default',local:body[0].v});
 const open=body.findIndex(x=>x.v==='{'),close=body.findIndex(x=>x.v==='}');
 if(open>=0&&close>open){
  const groups=[[]];for(const x of body.slice(open+1,close)){if(x.v===',')groups.push([]);else groups.at(-1).push(x);}
  for(const g of groups){if(!g.length)continue;const a=g.findIndex(x=>x.v==='as');names.push({imported:g[0].v,local:reexport?null:(a>=0?g[a+1]?.v:g[0].v)});}
 }
 const star=body.findIndex(x=>x.v==='*');if(star>=0)names.push({imported:'*',local:reexport?null:(body[star+1]?.v==='as'?body[star+2]?.v:null)});
 if(reexport)gaps.push({code:'REEXPORT_USES_UNKNOWN',path:edge.path,line:edge.line});
 if(edge.typeOnly||body[0]?.v==='type')gaps.push({code:'TYPE_ONLY_IMPORT',path:edge.path,line:edge.line});
 if(!names.length)gaps.push({code:'SIDE_EFFECT_OR_UNSUPPORTED_IMPORT',path:edge.path,line:edge.line});
 for(let i=0;i<t.length;i++){
  if(t[i].v==='('&&pair.has(i)){
   const end=pair.get(i),parameterList=t[end+1]?.v==='=>'||t[i-1]?.v==='function'||t[i-2]?.v==='function';
   if(parameterList)for(const n of names)if(n.local&&t.slice(i+1,end).some(x=>x.v===n.local))gaps.push({code:'BINDING_SHADOW_OR_PARAMETER_USE',path:edge.path,line:t[i].line,name:n.local});
  }
  if(t[i+1]?.v==='=>'&&names.some(n=>n.local===t[i].v))gaps.push({code:'BINDING_SHADOW_OR_PARAMETER_USE',path:edge.path,line:t[i].line,name:t[i].v});
 }
 const ranges=guards(t,pair,source),lines=source.split(/\r?\n/),callSites=[];
 for(let i=0;i<t.length;i++){
  if(i>=at&&i<=end||t[i].kind!=='name'||!names.some(n=>n.local===t[i].v)||['.','?.'].includes(t[i-1]?.v))continue;
  const name=t[i].v,snippet=lines[t[i].line-1],guard=ranges.filter(g=>i>=g.start&&i<g.end).map(({start,end,...g})=>({...g,snippetSha256:sha256(g.snippet)}));
  if(['const','let','var','function','class'].includes(t[i-1]?.v))gaps.push({code:'BINDING_SHADOW_OR_REASSIGNMENT',path:edge.path,line:t[i].line,name});
  callSites.push({path:edge.path,line:t[i].line,column:t[i].start-(source.lastIndexOf('\n',t[i].start-1)+1)+1,name,kind:t[i+1]?.v==='('?'CALL':'REFERENCE',snippet,snippetSha256:sha256(snippet),guarded:guard.length?'FALLBACK_GUARD':null,guards:guard,conditionStatus:guard.length?'UNKNOWN':null,...(guard.length?{note:guardNote}:{})});
 }
 if(names.some(n=>n.local)&&!callSites.length)gaps.push({code:'NO_LEXICAL_USE_FOUND',path:edge.path,line:edge.line});
 return {names:unique(names),namesBasis:'source declaration anchored by existing map edge',callSites:unique(callSites),gaps};
}

function snapshot(repo){
 const git=args=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:16*1024*1024});
 return {head:git(['rev-parse','HEAD']).trim(),status:git(['status','--porcelain','--untracked-files=all'])};
}
export function reach(map,targets){
 if(!map||map.schema!=='trace-code-lines-v1'||!isAbsolute(map.repo??'')||!Array.isArray(map.closures))throw Error('Expected a trace-code-lines map with repo and closures');
 if(!Array.isArray(targets)||!targets.length)throw Error('At least one target required');
 const repo=noLinks(resolve(map.repo)),globalGaps=[],cache=new Map();let before;
 try{before=snapshot(repo);if(before.head!==map.head)globalGaps.push({code:'MAP_HEAD_MISMATCH',mapHead:map.head??null,currentHead:before.head});if(before.status)globalGaps.push({code:'REPO_DIRTY',status:before.status});}catch(e){globalGaps.push({code:'REPO_SNAPSHOT_UNKNOWN',message:e.message});}
 if(map.readOnly?.status!=='PASS'||map.status?.startsWith('STOPPED'))globalGaps.push({code:'MAP_INTEGRITY_UNCONFIRMED'});
 const read=p=>{if(!cache.has(p))cache.set(p,readBounded(repo,p));return cache.get(p).toString('utf8');};
 const closures=map.closures,edges=unique(closures.flatMap(c=>c.edges??[])),results=[];
 for(const value of [...new Set(targets)]){
  const target=safeName(isAbsolute(value)?relative(repo,value).replaceAll('\\','/'):value.replaceAll('\\','/'));
  const gaps=[],roots={},rootDetails=[];
  try{read(target);}catch(e){gaps.push({code:'TARGET_UNREADABLE',message:e.message});}
  for(const c of closures.filter(c=>c.files?.includes(target))){const p=population(c),root=c.root??c.path;(roots[p.name]??=[]).push(root);rootDetails.push({root,population:p.name,populationBasis:p.basis});}
  for(const key of Object.keys(roots))roots[key]=[...new Set(roots[key])].sort();
  const rootList=[...new Set(rootDetails.map(r=>r.root))],onlySelfRoot=rootList.length===1&&rootList[0]===target;
  const incoming=edges.filter(e=>e.targets?.includes(target)),importers=[],callSites=[];
  for(const edge of incoming){
   if(!/IMPORT|REQUIRE|EXPORT/.test(edge.kind??''))continue;
   try{const source=read(safeName(edge.path)),uses=importUses(edge,source);importers.push({...edge,...uses,callSites:undefined,sourceSha256:sha256(source)});callSites.push(...uses.callSites);gaps.push(...uses.gaps);}catch(e){gaps.push({code:'IMPORTER_UNREADABLE',path:edge.path,message:e.message});importers.push({...edge,names:[]});}
  }
  const sourceRoots=roots.source??[],sourceImporters=importers.filter(e=>closures.some(c=>population(c).name==='source'&&c.files?.includes(e.path))),sourcePaths=new Set(sourceImporters.map(e=>e.path)),sourceSites=unique(callSites).filter(s=>sourcePaths.has(s.path));
  const known=closures.some(c=>c.files?.includes(target))||(map.zeroCoverageCandidates??[]).some(c=>c.path===target);
  if(!known)gaps.push({code:'TARGET_NOT_IN_MAP'});
  if(roots.unknown?.length)gaps.push({code:'ROOT_POPULATION_UNKNOWN'});
  const allGuarded=sourceSites.length>0&&sourceSites.every(s=>s.guarded==='FALLBACK_GUARD')&&sourceImporters.every(e=>e.names.length&&sourceSites.some(s=>s.path===e.path))&&!incoming.some(e=>!/IMPORT|REQUIRE|EXPORT/.test(e.kind??'')&&closures.some(c=>population(c).name==='source'&&c.files?.includes(e.path)))&&!sourceRoots.includes(target);
  let verdictHint=globalGaps.length||gaps.length?'UNKNOWN':!sourceRoots.length||sourceRoots.every(r=>r===target)?'ORPHAN_CANDIDATE':allGuarded?'REACHABLE_ONLY_BEHIND_GUARD':'REACHABLE';
  results.push({target,roots,rootDetails,onlySelfRoot,importers,callSites:unique(callSites),guarded:unique(callSites).filter(s=>s.guarded==='FALLBACK_GUARD').map(s=>({path:s.path,line:s.line,name:s.name,classification:'FALLBACK_GUARD',conditionStatus:'UNKNOWN',note:guardNote})),verdictHint,gaps,sourceSha256:cache.has(target)?sha256(cache.get(target)):null,mapGapCount:unique(closures.filter(c=>c.files?.includes(target)).flatMap(c=>c.gaps??[])).length});
 }
 let after;try{after=snapshot(repo);if(JSON.stringify(before)!==JSON.stringify(after))globalGaps.push({code:'REPO_CHANGED_DURING_READ'});}catch(e){globalGaps.push({code:'REPO_READBACK_UNKNOWN',message:e.message});}
 for(const [p,b] of cache){try{if(sha256(readBounded(repo,p))!==sha256(b))globalGaps.push({code:'SOURCE_CHANGED_DURING_READ',path:p});}catch(e){globalGaps.push({code:'SOURCE_READBACK_UNKNOWN',path:p,message:e.message});}}
 if(globalGaps.length)for(const r of results){r.verdictHint='UNKNOWN';r.gaps.push(...globalGaps);}
 return {schema:'trace-reach-v1',toolVersion:toolVersion(),repo,mapHead:map.head,currentHead:before?.head??null,status:results.some(r=>r.verdictHint==='UNKNOWN')?'UNKNOWN':'PASS',readOnly:{status:!before||!after||globalGaps.some(g=>/CHANGED|READBACK/.test(g.code))?'UNKNOWN':'PASS',before,after,hashedFiles:cache.size},targets:results,limitations:['File closure is not a function call graph or runtime proof. Hints never authorize deletion.','Roots/importers are restricted to existing map closures/edges; absent edges and incomplete root selection remain unmeasured. mapGapCount discloses gaps, not target-specific failures.','Legacy maps omit population rules: conventional path grouping is heuristic, explicit population takes precedence.','Call sites are lexical identifier uses (including value references), not full AST/binding/data-flow analysis. Comments, strings and regex bodies are skipped; template interpolations, shadowing, callbacks and aliases may be missed or ambiguous.','FALLBACK_GUARD means RHS of ?? or ||, ternary false branch, or explicit if (!...) body. Early-return dominance and cross-function fallback are not inferred.','REACHABLE_ONLY_BEHIND_GUARD describes observed source importer uses, not conditional module loading or absence of module side effects.']};
}

const usage='Usage: node reach.mjs --map file --target path [--target path ...] [--targets-file file] [--out file]';
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2);if(args.length===1&&args[0]==='--help'){console.log(usage);process.exit(0);}
  let mapFile,out,targetsFile;const targets=[];
  for(let i=0;i<args.length;i++){const k=args[i],v=args[++i];if(!v||v.startsWith('--'))throw Error(usage);if(k==='--target')targets.push(v);else if(k==='--map'&&!mapFile)mapFile=resolve(v);else if(k==='--out'&&!out)out=resolve(v);else if(k==='--targets-file'&&!targetsFile)targetsFile=resolve(v);else throw Error(usage);}
  if(!mapFile)throw Error(usage);
  if(targetsFile){noLinks(targetsFile);const text=fs.readFileSync(targetsFile,'utf8');const list=text.trimStart().startsWith('[')?JSON.parse(text):text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!Array.isArray(list)||list.some(v=>typeof v!=='string'))throw Error('targets-file must contain a JSON string array or one path per line');targets.push(...list);}
  noLinks(mapFile);const bytes=fs.readFileSync(mapFile),map=JSON.parse(bytes);
  if(out){noLinks(out);if(within(resolve(map.repo),out)||[mapFile,targetsFile].includes(out)||fs.existsSync(out))throw Error('Output must be a new file outside repo and inputs');}
  const result=reach(map,targets);result.mapSource={path:mapFile,sha256:sha256(bytes)};
  if(sha256(fs.readFileSync(mapFile))!==sha256(bytes))throw Error('Map changed during read');
  if(out){fs.mkdirSync(dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{encoding:'utf8',flag:'wx'});console.log(JSON.stringify({schema:result.schema,status:result.status,outputs:{reach:out}}));}else console.log(JSON.stringify(result,null,2));
 }catch(e){console.error(JSON.stringify({status:'ERROR',message:e.message}));process.exitCode=1;}
}
