import {gapList} from './gap-shape.mjs';
import {buildFrameworkGraph} from './gas-framework.mjs';
// Parameterized packaging of MAP-2; target code is read, never imported.
import fs from 'node:fs';
import cp from 'node:child_process';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writerCandidates} from './language-static.mjs';
import {attachInferenceLayer} from './inference-layer.mjs';
import {walk,safeName,noLinks,sha256,readBounded} from './walker.mjs';

export function toolVersion(){
  const skill=fs.readFileSync(new URL('../SKILL.md',import.meta.url),'utf8');
  const frontmatter=skill.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const version=frontmatter?.match(/^version:\s*(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\s*$/m)?.[1];
  if(!version)throw Error('SKILL.md requires a version field');
  return version;
}

export function classify(path,rules,fallback) {
  return rules.find(rule=>new RegExp(rule.pattern,rule.flags??'').test(path))?.name??fallback;
}
export function compareSets(actual,expected,gaps=[]) {
  const a=new Set(actual),e=new Set(expected);
  const missing=[...e].filter(p=>!a.has(p)).sort();
  const extra=[...a].filter(p=>!e.has(p)).sort();
  return {status:missing.length||extra.length?'FAIL':'PASS',
    expectedCount:e.size,actualCount:a.size,missing,extra,gaps,disclosedGaps:gaps};
}
function rootsOf(values,label) {
  if(!Array.isArray(values)||!values.length)throw Error(label+' must be a nonempty array');
  return values.map(value=>{
    const row=typeof value==='string'?{path:value,reason:'caller-selected root'}:value;
    safeName(row?.path);
    if(typeof row.reason!=='string'||!row.reason.trim())throw Error(label+' requires root reasons');
    return row;
  });
}
function overlaps(a,b) {
  // path.relative uses the native separator; normalize before the containment check.
  const within=(x,y)=>{const p=relative(x,y).replace(/\\/g,'/');return p===''||(!p.startsWith('../')&&p!=='..'&&!isAbsolute(p));};
  return within(a,b)||within(b,a);
}
export function tempLayout(config){
  const repo=noLinks(resolve(config.repo)),temp=noLinks(resolve(config.temp)),scratch=noLinks(resolve(config.scratch??config.temp));
  if(![repo,temp,scratch].every(p=>fs.statSync(p).isDirectory()))throw Error('repo/temp/scratch must exist');
  const within=(a,b)=>{const r=relative(a,b).replace(/\\/g,'/');return r===''||(!r.startsWith('../')&&r!=='..'&&!isAbsolute(r));};
  if(!within(temp,scratch))throw Error('Set scratch below fixed TEMP: TEMP=X, repo=X/clone, scratch=X/scratch.');
  if(within(repo,temp))throw Error('TEMP must not be inside repo. Use TEMP=X, repo=X/clone, scratch=X/scratch.');
  for(const root of [repo,...(config.protectedRoots??[])]){
    if(!isAbsolute(root))throw Error('protectedRoots must be absolute');
    if(overlaps(scratch,noLinks(resolve(root))))throw Error('Scratch overlaps clone/protected root. Keep TEMP=X; set repo=X/clone and scratch=X/scratch (neither may contain the other).');
  }
  return {repo,temp,scratch};
}

function closureKinds(root,r){
  const runtime=new Set(),pending=[root],byPath=new Map();
  for(const e of r.edges){if(!byPath.has(e.path))byPath.set(e.path,[]);byPath.get(e.path).push(e);}
  const all=new Set(r.files.map(f=>f.path));
  while(pending.length){const p=pending.pop();if(runtime.has(p)||!all.has(p))continue;runtime.add(p);for(const e of byPath.get(p)??[])if(!e.typeOnly)pending.push(...e.targets);}
  const runtimeFiles=[...runtime].sort(),typeOnlyFiles=[...all].filter(p=>!runtime.has(p)).sort();
  return {runtimeFiles,typeOnlyFiles,dataReadFiles:r.dataReadFiles??[],dataReadComputed:r.dataReadComputed??0,dataReadComputedSamples:r.dataReadComputedSamples??[],closureCounts:{all:all.size,runtime:runtimeFiles.length,typeOnly:typeOnlyFiles.length,dataRead:(r.dataReadFiles??[]).length},edgeCounts:{runtime:r.edges.filter(e=>!e.typeOnly).length,typeOnly:r.edges.filter(e=>e.typeOnly).length}};
}

export function analyze(config,{calibrateOnly=false,progress=()=>{},inferredEdges=config.inferredEdges}={}) {
  progress('map: inventory');
  if(typeof config.repo!=='string'||!isAbsolute(config.repo))throw Error('repo must be absolute');
  if(typeof config.temp!=='string'||!isAbsolute(config.temp))throw Error('temp must be absolute');
  const {repo,temp,scratch}=tempLayout(config);
  if((process.env.TEMP&&resolve(process.env.TEMP)!==temp)||(process.env.TMP&&resolve(process.env.TMP)!==temp))throw Error('Keep process TEMP/TMP fixed. Set config.temp to the current TEMP and put clone/scratch in separate subdirectories.');
  const commands=[];
  const git=args=>{
    commands.push({bin:'git',args:['-C',repo,...args]});
    return cp.execFileSync('git',['-C',repo,...args],{
      encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:64*1024*1024,
      stdio:['ignore','pipe','pipe']});
  };
  const head=git(['rev-parse','HEAD']).trim(),before=git(['status','--porcelain']);
  if(before!=='')throw Error('Repository is not clean; no analysis performed');
  const tracked=git(['ls-files','-z']).split('\0').filter(Boolean).sort();
  const rows=new Map(),inventoryGaps=gapList(),readCache=new Map();
  // Cache only this analysis snapshot; the final integrity pass always reads disk again.
  const readCached=name=>{if(!readCache.has(name))readCache.set(name,readBounded(repo,name));return readCache.get(name);};
  for(const path of tracked) {
    try {rows.set(path,{path,sha256:sha256(readCached(path))});}
    catch(error) {rows.set(path,{path,sha256:null});inventoryGaps.push({path,error:error.message});}
  }
  const frameworkGraph=buildFrameworkGraph(rows,readCached,config);
  const roots=config.roots==='auto-gas'? [...new Set(frameworkGraph.entryPoints.map(e=>e.file))].map(path=>({path,reason:'auto-gas entry point'})):rootsOf(config.roots,'roots');
  const pythonSourceRoots=config.pythonSourceRoots??['.','src'];
  if(!Array.isArray(pythonSourceRoots)||!pythonSourceRoots.length)throw Error('pythonSourceRoots must be nonempty');
  for(const p of pythonSourceRoots)if(p!=='.')safeName(p);
  const walkOptions={frameworkGraph,pythonSourceRoots,parserCache:new Map(),resolutionCache:new Map(),read:readCached,progress};
  const rules=config.classification?.rules,fallback=config.classification?.fallback;
  if(!Array.isArray(rules)||typeof fallback!=='string'||!fallback)throw Error('classification rules/fallback required');
  for(const rule of rules) {
    if(typeof rule.name!=='string'||typeof rule.pattern!=='string'||/[gy]/.test(rule.flags??''))throw Error('Invalid classification rule');
    new RegExp(rule.pattern,rule.flags??'');
  }
  const result={
    schema:'trace-code-lines-v1',tool:'trace-code-lines',toolVersion:toolVersion(),repo,head,temp,scratch,tmp:process.env.TMP,
    command:{bin:process.execPath,args:process.argv.slice(1)},
    configurationSha256:sha256(JSON.stringify(config)),
    scope:{population:'git tracked files',parser:'Lexical ESM/JSON, CJS and Python',pythonSourceRoots,
      completeRuntimeClosure:false,referenceFunnelPerformed:false},
    calibration:null,confidence:null,status:null,inventoryGaps,
    limitations:[
      'Static file closure, not a function call graph or runtime execution proof.',
      'CJS relative file/package-main/index, Python source roots, TS extension substitution and tsconfig/jsconfig baseUrl/paths with repo-local relative extends are supported. Package extends, arbitrary aliases, bundler settings, namespace packages and runtime sys.path changes are not resolved.',
      'Regex matching can include comments/generated strings and can miss other syntax.',
      'Zero coverage candidates require the documented four-scope and template-family funnel.',
      'Unsupported-language entries are retained as roots; regex literals and unusual syntax may be misread; computed dependencies remain gaps except ordinary JS computed data reads, which are counted.',
      'Unreadable, linked or oversized inventory files are disclosed, never treated as absent.',
      'JS content reads: literal paths try repo cwd then nearest package cwd; __dirname join/resolve and import.meta.url URL paths are file-relative. Only existing inventory targets resolve. Same-file single-layer literal arrays and literal conditional branches are candidates; DATA_READ_TARGET_UNKNOWN is limited to missing literal/expanded targets, or unresolved expressions with visible .js/.mjs/.cjs/.ts/.tsx/.gs/.html/.css string fragments, src/ lib/ scripts/ directory prefixes (also ./ or ../), or immediate executes:true evaluation.',
      'DATA_READ code targets enter the closure and are counted separately; data targets are edge-only. Historical standalone JSON URL pin traversal is retained for compatibility. executes:true is a lexical read-to-evaluation hint, never runtime proof. Mutable arrays, nested iteration, cross-file values and general computation are unsupported. Other unresolved content-read calls are counted once in dataReadComputed per root; dataReadComputedSamples contains the first 20 locations in traversal order. counts.dataReadComputed sums root occurrences (shared calls count in each root); top-level samples include roots and are capped at 20. These counts are not gaps or resolved dependencies.'
    ]
  };
  result.gasEntryPoints=frameworkGraph.entryPoints;
  result.gasAnalysis={implicitClientProjects:frameworkGraph.implicitClientProjects,projects:frameworkGraph.projects,scopes:frameworkGraph.scopes,edges:frameworkGraph.edges.filter(e=>e.kind.startsWith('GAS_')),gaps:frameworkGraph.gaps.filter(g=>g.code.startsWith('GAS_'))};
  result.frameworkPathLoads={edges:frameworkGraph.edges.filter(e=>e.kind==='FRAMEWORK_PATH_LOAD'),gaps:frameworkGraph.gaps.filter(g=>g.code.startsWith('FRAMEWORK_'))};
  result.limitations.push(...frameworkGraph.limitations);
  if(config.calibration) {
    progress('map: calibration');
    const cal=config.calibration,calRoots=rootsOf(cal.roots,'calibration.roots');
    const baselinePath=cal.baseline?.path;
    let bytes;
    if(isAbsolute(baselinePath??'')){const p=noLinks(baselinePath),stat=fs.statSync(p);if(!stat.isFile()||stat.size>8*1024*1024)throw Error('Baseline must be a bounded regular file');bytes=fs.readFileSync(p);}
    else {safeName(baselinePath);bytes=readCached(baselinePath);}
    let expected=JSON.parse(bytes.toString('utf8'));
    for(const key of cal.baseline.selector??[])expected=expected?.[key];
    if(!Array.isArray(expected)||!expected.length)throw Error('Baseline selector must name a nonempty array');
    expected=expected.map(row=>cal.baseline.entryKey?row?.[cal.baseline.entryKey]:row);
    expected.forEach(safeName);
    if(new Set(expected).size!==expected.length)throw Error('Duplicate baseline paths');
    const walked=walk(repo,calRoots.map(r=>r.path),rows,walkOptions);
    const actual=walked.files.map(r=>r.path).sort();
    result.calibration={...compareSets(actual,expected,walked.gaps),roots:calRoots,
      baseline:{...cal.baseline,sha256:sha256(bytes)},files:actual,
      basis:'Independent baseline from this checkout; path sets, not a fixed file count'};
    result.confidence=result.calibration.status==='PASS'?'CALIBRATED_STATIC':'INVALID_TRAVERSAL';
  } else {
    result.calibration={status:'UNCALIBRATED',reason:config.uncalibratedReason??'No independent baseline supplied'};
    result.confidence='PROVISIONAL_STATIC';
  }
  if(result.calibration.status==='FAIL') {
    result.status='STOPPED_CALIBRATION_FAILURE';
    result.stopped=true; // Deliberately omit closures and candidates.
  } else if(calibrateOnly) {
    result.status=result.calibration.status==='PASS'?'PASS':'UNKNOWN';
  } else {
    const closures=roots.map(root=>{
      const r=walk(repo,[root.path],rows,walkOptions);
      return {...root,root:root.path,files:r.files.map(f=>f.path),gaps:r.gaps,edges:r.edges,externalDependencies:r.external,
        ...closureKinds(root.path,r),
        parserScope:/\.(?:ts|tsx|jsx|mts|cts)$/.test(root.path)?(r.edges.some(e=>e.path===root.path&&e.targets?.length)?'STATIC_LEXICAL':'TS_RESOLUTION_UNSUPPORTED'):/\.(?:mjs|js|cjs|py)$/.test(root.path)?'STATIC_LEXICAL':r.edges.some(e=>e.path===root.path&&e.kind==='TEXT_REFERENCE')?'TEXT_REFERENCE':'UNSUPPORTED_LANGUAGE_ROOT_ONLY'};
    });
    const covered=new Set(closures.flatMap(c=>c.files));
    result.roots=roots;result.closures=closures;
    result.dataReadComputedSamples=closures.flatMap(c=>c.dataReadComputedSamples.map(sample=>({root:c.root,...sample}))).slice(0,20);
    result.endpointTable={schema:'static-endpoints-v1',layer:'static',confidence:result.confidence,completeInventory:false,endpoints:[]};
    progress('map: writer candidates');
    for(const file of [...covered].sort())if(/\.(?:py|cjs|mjs|js|ts|tsx|jsx)$/.test(file)){
      try {for(const e of writerCandidates(file,readCached(file).toString('utf8')))result.endpointTable.endpoints.push({...e,roots:closures.filter(c=>c.files.includes(file)).map(c=>c.path)});}
      catch(e){inventoryGaps.push({path:file,error:e.message,phase:'endpoint-scan'});}
    }
    result.endpointTable.receiverHintCounts=Object.fromEntries(['DB_LIKE_NAME','UNKNOWN_RECEIVER','LOCAL_CONTAINER'].map(h=>[h,result.endpointTable.endpoints.filter(e=>e.receiverHint===h).length]));
    result.zeroCoverageCandidates=tracked.filter(p=>!covered.has(p)).map(path=>({
      path,population:classify(path,rules,fallback),staticCoverage:0,
      referenceStatus:'NOT_CHECKED',confidence:result.confidence
    }));
    result.populationStats=Object.fromEntries([...new Set([...rules.map(r=>r.name),fallback])].map(name=>[
      name,{total:tracked.filter(p=>classify(p,rules,fallback)===name).length,
        covered:tracked.filter(p=>classify(p,rules,fallback)===name&&covered.has(p)).length,
        zeroCoverage:result.zeroCoverageCandidates.filter(p=>p.population===name).length}
    ]));
    result.status=inventoryGaps.length||frameworkGraph.gaps.length||closures.some(c=>c.gaps.length)?'PARTIAL':'PASS';
    attachInferenceLayer(result,{file:inferredEdges,inventory:[...rows.values()].filter(r=>r.sha256).map(r=>({path:join(repo,r.path),sha256:r.sha256}))});
  }
  progress('map: integrity readback');
  const after=git(['status','--porcelain']),headAfter=git(['rev-parse','HEAD']).trim();
  const changed=[];
  for(const [path,row] of rows)if(row.sha256!==null) {
    try {if(sha256(readBounded(repo,path))!==row.sha256)changed.push(path);}
    catch {changed.push(path);}
  }
  result.readOnly={status:before===after&&head===headAfter&&!changed.length?'PASS':'FAIL',
    before,after,headBefore:head,headAfter,hashedFiles:[...rows.values()].filter(r=>r.sha256!==null).length,
    changed,unhashed:inventoryGaps.map(g=>g.path)};
  result.commands=commands;
  if(result.readOnly.status==='FAIL')result.status='STOPPED_INTEGRITY_FAILURE';
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node derive-map.mjs --config file [--calibrate-only] [--inferred-edges file] [--calibration file]");process.exit(0);}

  try {
    const args=process.argv.slice(2);
    if(args[0]!=='--config'||!args[1])throw Error('Usage: node derive-map.mjs --config file [--calibrate-only] [--inferred-edges file] [--calibration file]');
    let calibrateOnly=false,inferredEdges,calibration;
    for(let i=2;i<args.length;i++){
      if(args[i]==='--calibrate-only'&&!calibrateOnly)calibrateOnly=true;
      else if(args[i]==='--calibration'&&args[i+1]&&calibration===undefined)calibration=resolve(args[++i]);
      else if(args[i]==='--inferred-edges'&&args[i+1]&&inferredEdges===undefined)inferredEdges=resolve(args[++i]);
      else throw Error('Unknown, duplicate or incomplete argument: '+args[i]);
    }
    const config=JSON.parse(fs.readFileSync(args[1],'utf8'));
    if(calibration)config.calibration={...(config.calibration??{}),roots:config.calibration?.roots??config.roots,baseline:{path:calibration}};
    const result=analyze(config,{calibrateOnly,inferredEdges,progress:message=>process.stderr.write(message+'\n')});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result.status.startsWith('STOPPED'))process.exitCode=2;
  } catch(error) {
    process.stderr.write(JSON.stringify({status:'ERROR',message:error.message})+'\n');
    process.exitCode=1;
  }
}
