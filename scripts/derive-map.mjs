import {gapList} from './gap-shape.mjs';
import {buildFrameworkGraph} from './gas-framework.mjs';
// Parameterized packaging of MAP-2; target code is read, never imported.
import fs from 'node:fs';
import cp from 'node:child_process';
import {resolve,relative,isAbsolute,join,dirname} from 'node:path';
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
// JSON.parse sometimes omits positions. Locate syntax without evaluating input,
// using an iterative grammar so deeply nested malformed configs do not recurse.
function configErrorOffset(source){
  let i=0;const states=['value'],fail=()=>{throw i;};
  const space=()=>{while(i<source.length&&/[ \t\r\n]/.test(source[i]))i++;};
  const string=()=>{
    if(source[i++]!=='"'){i--;fail();}
    while(i<source.length){const c=source[i++];if(c==='"')return;
      if(c.charCodeAt(0)<32){i--;fail();}
      if(c==='\\'){if(i>=source.length)fail();const escape=source[i++];
        if(escape==='u'){for(let n=0;n<4;n++){if(!/[0-9a-fA-F]/.test(source[i]??'')||i>=source.length)fail();i++;}}
        else if(!'"\\/bfnrt'.includes(escape)){i--;fail();}
      }
    }fail();
  };
  try{
    while(states.length){space();const state=states.pop(),c=source[i];
      if(state==='value'){
        if(c==='{'){i++;states.push('objectFirst');}
        else if(c==='['){i++;states.push('arrayFirst');}
        else if(c==='"')string();
        else {const literal=['true','false','null'].find(v=>source.startsWith(v,i));
          if(literal)i+=literal.length;
          else {const number=source.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);if(!number)fail();i+=number[0].length;}
        }
      }else if(state==='objectFirst'&&c==='}'||state==='objectAfter'&&c==='}'||state==='arrayFirst'&&c===']'||state==='arrayAfter'&&c===']')i++;
      else if(state==='objectFirst'||state==='objectPair'){string();space();if(source[i]!==':')fail();i++;states.push('objectAfter','value');}
      else if(state==='arrayFirst'||state==='arrayValue')states.push('arrayAfter','value');
      else if(state==='objectAfter'||state==='arrayAfter'){if(c!==',')fail();i++;states.push(state==='objectAfter'?'objectPair':'arrayValue');}
    }
    space();if(i!==source.length)fail();return source.length;
  }catch(offset){if(typeof offset!=='number')throw offset;return offset;}
}
export function parseConfigJSON(source,file='config') {
  try{return JSON.parse(source);}catch(error){
    const location=error.message.match(/line (\d+) column (\d+)/),position=error.message.match(/position (\d+)/);
    const offset=position?Number(position[1]):configErrorOffset(source);
    const prefix=source.slice(0,offset),line=location?Number(location[1]):prefix.split('\n').length;
    const column=location?Number(location[2]):offset-prefix.lastIndexOf('\n');
    throw Error(`${file}: JSON parse failed at line ${line}, column ${column}: ${error.message}. Windows paths must use / or escaped backslashes (\\\\).`);
  }
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

// Declared edges (config.declaredEdges) cover hops a lexical walk cannot prove, e.g. spawn(process.execPath,args)
// where args come from runtime data. Each edge is anchored ({from:{file,line,expect?,sha256?},to:[files],kind?,basis}).
// Only edges whose anchor still matches join the closure; they stay labelled DECLARED and never count as static proof.
export function declaredEdges(list,rows,read){
  if(list===undefined)return {edges:[],gaps:[]};
  if(!Array.isArray(list))throw Error('declaredEdges must be an array');
  const edges=[],gaps=[];
  for(const [i,e] of list.entries()){
    const id=e.id??'declared-'+(i+1),from=e.from??{},to=Array.isArray(e.to)?e.to:[e.to];
    const fail=reason=>gaps.push({id,code:'DECLARED_EDGE_ANCHOR_STALE',path:from.file??null,line:from.line??null,reason});
    if(typeof from.file!=='string'||!rows.has(from.file)){fail('from.file is not a tracked file');continue;}
    const text=read(from.file).toString('utf8');
    if(from.sha256&&sha256(Buffer.from(text))!==from.sha256){fail('from.sha256 changed');continue;}
    if(from.line!==undefined&&from.expect!==undefined&&!(text.split(/\r?\n/)[from.line-1]??'').includes(from.expect)){fail('from.line no longer contains expect');continue;}
    const missing=to.filter(t=>!rows.has(t));if(missing.length){fail('target not tracked: '+missing.join(', '));continue;}
    edges.push({id,kind:'DECLARED_'+(e.kind??'EDGE').toUpperCase(),path:from.file,line:from.line??null,targets:to,basis:e.basis??'declared',runtimeVerified:false});
  }
  return {edges,gaps};
}
export function expandDeclared(r,declared,walkTargets){
  if(!declared.edges.length)return r;
  const files=new Map(r.files.map(f=>[f.path,f])),used=[],added=new Set();
  for(let changed=true;changed;){changed=false;
    for(const e of declared.edges){if(used.includes(e)||!files.has(e.path))continue;used.push(e);changed=true;
      const w=walkTargets(e.targets);for(const f of w.files)if(!files.has(f.path)){files.set(f.path,f);added.add(f.path);}
      r.edges.push(e,...w.edges.filter(x=>!r.edges.includes(x)));r.gaps.push(...w.gaps);r.external.push(...w.external);}}
  return {...r,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),declaredExpansion:used.length?{edges:used.map(e=>e.id),files:[...added].sort()}:undefined};
}
export function analyze(config,{calibrateOnly=false,progress=()=>{},inferredEdges=config.inferredEdges}={}) {
  progress('map: inventory');
  if(typeof config.repo!=='string'||!isAbsolute(config.repo))throw Error('repo must be absolute');
  if(typeof config.temp!=='string'||!isAbsolute(config.temp))throw Error('temp must be absolute');
  const {repo,temp,scratch}=tempLayout(config);
  if((process.env.TEMP&&resolve(process.env.TEMP)!==temp)||(process.env.TMP&&resolve(process.env.TMP)!==temp))throw Error('Keep process TEMP/TMP fixed. Set config.temp to the current TEMP and put clone/scratch in separate subdirectories. '+JSON.stringify({'config.temp':config.temp,'process TEMP':process.env.TEMP??null,'process TMP':process.env.TMP??null}));
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
  const defaultClassification=config.classification===undefined;
  const classification=defaultClassification?{rules:[],fallback:'unclassified'}:config.classification;
  const rules=classification?.rules,fallback=classification?.fallback;
  if(!Array.isArray(rules)||typeof fallback!=='string'||!fallback)throw Error('classification rules/fallback required');
  for(const rule of rules) {
    if(typeof rule.name!=='string'||typeof rule.pattern!=='string'||/[gy]/.test(rule.flags??''))throw Error('Invalid classification rule');
    new RegExp(rule.pattern,rule.flags??'');
  }
  const result={
    schema:'trace-code-lines-v1',tool:'trace-code-lines',toolVersion:toolVersion(),repo,head,temp,scratch,tmp:process.env.TMP,
    command:{bin:process.execPath,args:process.argv.slice(1)},
    configurationSha256:sha256(JSON.stringify(config)),
    classification:{...classification,usedDefault:defaultClassification,basis:defaultClassification?'DEFAULT_SINGLE_POPULATION':'CALLER_SUPPLIED'},
    scope:{population:'git tracked files',parser:'Lexical ESM/JSON, CJS, Python and Rust',pythonSourceRoots,
      completeRuntimeClosure:false,referenceFunnelPerformed:false},
    calibration:null,confidence:null,status:null,inventoryGaps,
    limitations:[
      'Static file closure, not a function call graph or runtime execution proof.',
      'CJS relative file/package-main/index, Python source roots, TS extension substitution and tsconfig/jsconfig baseUrl/paths with repo-local relative extends are supported. Package extends, arbitrary aliases, bundler settings, namespace packages and runtime sys.path changes are not resolved.',
      'Regex matching can include comments/generated strings and can miss other syntax.',
      'Rust module/use scanning is lexical. cfg conditions are not evaluated, unsupported syntax remains a gap, and subprocess binaries are not bound to Rust source. Explicit Rust roots do not prove a TS-to-Rust runtime connection.',
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
    const declared=declaredEdges(config.declaredEdges,rows,readCached);result.declaredEdges=declared;
    const closures=roots.map(root=>{
      const r=expandDeclared(walk(repo,[root.path],rows,walkOptions),declared,targets=>walk(repo,targets,rows,walkOptions));
      return {...root,root:root.path,files:r.files.map(f=>f.path),gaps:r.gaps,edges:r.edges,externalDependencies:r.external,
        ...closureKinds(root.path,r),...(r.declaredExpansion?{declaredExpansion:r.declaredExpansion}:{}),
        parserScope:/\.(?:ts|tsx|jsx|mts|cts)$/.test(root.path)?(r.edges.some(e=>e.path===root.path&&e.targets?.length)?'STATIC_LEXICAL':'TS_RESOLUTION_UNSUPPORTED'):/\.(?:mjs|js|cjs|py|rs)$/.test(root.path)?'STATIC_LEXICAL':r.edges.some(e=>e.path===root.path&&e.kind==='TEXT_REFERENCE')?'TEXT_REFERENCE':'UNSUPPORTED_LANGUAGE_ROOT_ONLY'};
    });
    const covered=new Set(closures.flatMap(c=>c.files));
    result.roots=roots;result.closures=closures;
    // Optional reverse-import inventory: same snapshot, parsers and resolvers as closures.
    // A target's forward closure cannot reveal callers outside the selected roots.
    if(config.importTargets?.length){
      const targets=[...new Set(config.importTargets.map(safeName))],wanted=new Set(targets),edges=[],gaps=[],scannedFiles=[];
      for(const file of tracked.filter(p=>/\.(?:cjs|mjs|js|ts|tsx|jsx|mts|cts|gs|py)$/.test(p))){
        const r=walk(repo,[file],rows,{...walkOptions,directOnly:true});
        if(r.files.some(f=>f.path===file))scannedFiles.push(file);
        gaps.push(...r.gaps);
        edges.push(...r.edges.filter(e=>['STATIC_IMPORT','DYNAMIC_IMPORT'].includes(e.kind)&&!e.resolutionOnly&&e.targets?.some(t=>wanted.has(t))));
      }
      result.incomingImports={targets,scannedFiles,edges,gaps,scope:'Direct lexical imports across readable Git-tracked program files; no execution or complete runtime guarantee.'};
    }
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
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node derive-map.mjs --config file [--calibrate-only] [--inferred-edges file] [--calibration file] [--out file]");process.exit(0);}

  try {
    const args=process.argv.slice(2);
    if(args[0]!=='--config'||!args[1])throw Error('Usage: node derive-map.mjs --config file [--calibrate-only] [--inferred-edges file] [--calibration file] [--out file]');
    let calibrateOnly=false,inferredEdges,calibration,out;
    for(let i=2;i<args.length;i++){
      if(args[i]==='--calibrate-only'&&!calibrateOnly)calibrateOnly=true;
      else if(args[i]==='--out'&&args[i+1]&&!args[i+1].startsWith('--')&&out===undefined)out=resolve(args[++i]);
      else if(args[i]==='--calibration'&&args[i+1]&&calibration===undefined)calibration=resolve(args[++i]);
      else if(args[i]==='--inferred-edges'&&args[i+1]&&inferredEdges===undefined)inferredEdges=resolve(args[++i]);
      else throw Error('Unknown, duplicate or incomplete argument: '+args[i]);
    }
    const config=parseConfigJSON(fs.readFileSync(args[1],'utf8'),args[1]);
    if(calibration)config.calibration={...(config.calibration??{}),roots:config.calibration?.roots??config.roots,baseline:{path:calibration}};
    if(out){
      noLinks(out);
      const within=(root,p)=>{const r=relative(resolve(root),p).replaceAll('\\','/');return r===''||(!r.startsWith('../')&&r!=='..'&&!isAbsolute(r));};
      if([config.repo,...(config.protectedRoots??[])].some(root=>within(root,out)))throw Error('Output must be outside repo/protected roots');
      if(fs.existsSync(out))throw Error('Output already exists');
    }
    const result=analyze(config,{calibrateOnly,inferredEdges,progress:message=>process.stderr.write(message+'\n')});
    if(out){
      fs.mkdirSync(dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{encoding:'utf8',flag:'wx'});
      process.stdout.write(JSON.stringify({schema:result.schema,status:result.status,toolVersion:result.toolVersion,outputs:{map:out}})+'\n');
    }else process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result.status.startsWith('STOPPED'))process.exitCode=2;
  } catch(error) {
    process.stderr.write(JSON.stringify({status:'ERROR',message:error.message})+'\n');
    process.exitCode=1;
  }
}
