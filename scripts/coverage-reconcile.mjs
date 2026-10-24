import {gapList} from './gap-shape.mjs';
import {instrumentEvidence} from './instrument-evidence.mjs';
import {loadManifest} from './instrument.mjs';
import {contract,configSource} from './contract.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const norm=p=>p.replaceAll('\\','/').replace(/\/$/,'');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export function reconcile(c) {
  const started=performance.now();
  if(!c.coverageDirectory||!c.staticMap||!c.endpointTable||!c.roots?.length)throw Error('coverageDirectory, staticMap, endpointTable and roots required');
  const staticMap=read(c.staticMap),table=read(c.endpointTable),gaps=gapList(),files=new Map(),excluded=[],raw=[];
  const closure=new Set((staticMap.closures??staticMap.staticLayer?.closures??[]).flatMap(r=>r.files).map(r=>typeof r==='string'?r:r.path));
  if(!closure.size)throw Error('Empty/missing static closures');
  const excludeRoots=[...(c.excludeRoots??[])];
  if(c.instrumentCollect){
    try{
      const collected=read(c.instrumentCollect);
      if(collected.schema!=='instrument-collect-v1')throw Error('Invalid instrument collect schema');
      const manifest=loadManifest(path.resolve(collected.manifest));
      const listed=manifest.files.find(f=>path.resolve(f.path)===path.resolve(c.instrumentCollect));
      if(!listed||listed.sha256!==sha(c.instrumentCollect))throw Error('Collect is not hash-bound to manifest');
      excludeRoots.push(manifest.config.outputDirectory);
      if(collected.exitCode!==0||manifest.exitCode!==0)gaps.push({kind:'RUN_FAILED',exitCode:manifest.exitCode,command:manifest.command,
        signal:manifest.signal??null,error:manifest.error??null,detail:'Instrumented command did not complete successfully; coverage is retained as partial evidence.'});
    }catch(e){gaps.push({kind:'INSTRUMENT_MANIFEST_UNKNOWN',path:c.instrumentCollect,detail:e.message});}
  }
  const roots=c.roots.map(r=>({...r,root:norm(r.root)})).sort((a,b)=>b.root.length-a.root.length);
  for(const name of fs.readdirSync(c.coverageDirectory).filter(n=>n.endsWith('.json')).sort()) {
    const file=path.join(c.coverageDirectory,name),data=read(file);raw.push({file,sha256:sha(file)});
    let scripts=data.result;
    if(data.schema==='python-settrace-v1'){
      if(!Array.isArray(data.files))throw Error('Python coverage requires files');
      scripts=data.files.map(f=>{
        if(!path.isAbsolute(f.path)||!Array.isArray(f.lines)||f.lines.some(l=>!Number.isInteger(l.line)||l.line<1||!Number.isInteger(l.count)||l.count<0))throw Error('Invalid Python coverage line records');
        return {url:pathToFileURL(f.path).href,pythonLines:f.lines,functions:[]};
      });
    }
    if(!Array.isArray(scripts))throw Error('Unsupported coverage schema: '+file);
    for(const s of scripts) {
      if(!s.url.startsWith('file:')){excluded.push({file,url:s.url});continue;}
      const physical=norm(fileURLToPath(s.url));
      if(excludeRoots.some(r=>physical.toLowerCase()===norm(r).toLowerCase()||physical.toLowerCase().startsWith(norm(r).toLowerCase()+'/'))){excluded.push({file,url:s.url,reason:'INSTRUMENT_EXCLUDED'});continue;}
      if(/\/\[eval\d*\]$/.test(physical)){excluded.push({file,url:s.url});continue;}
      const mapping=roots.find(r=>physical.toLowerCase().startsWith(r.root.toLowerCase()+'/'));
      if(c.mappedOnly&&!mapping){excluded.push({file,url:s.url,reason:'OUTSIDE_DECLARED_POPULATION'});continue;}
      const logical=mapping?norm((mapping.prefix?mapping.prefix+'/':'')+physical.slice(mapping.root.length+1)):physical;
      const scope=mapping?.scope??'UNMAPPED',key=scope+':'+logical;
      if(!files.has(key))files.set(key,{path:logical,scope,executed:false,positiveNamedFunctions:0,physicalPaths:[],evidence:[]});
      const row=files.get(key),positive=s.functions.filter(f=>f.ranges.some(r=>r.count>0));
      const positiveLines=(s.pythonLines??[]).filter(l=>l.count>0);
      row.language=s.pythonLines?'python':'javascript';
      if(s.pythonLines){row.lineCounts??={};for(const l of s.pythonLines)row.lineCounts[l.line]=(row.lineCounts[l.line]??0)+l.count;}
      row.executed ||= positive.length>0||positiveLines.length>0;row.positiveNamedFunctions+=positive.filter(f=>f.functionName).length;
      if(!row.physicalPaths.includes(physical)){
        row.physicalPaths.push(physical);
        if(mapping?.sourceRoot)try{if(sha(physical)!==sha(path.join(mapping.sourceRoot,physical.slice(mapping.root.length+1))))gaps.push({kind:'COPY_HASH_MISMATCH',physical});}
        catch(e){gaps.push({kind:'COPY_HASH_UNKNOWN',physical,detail:e.message});}
      }
      row.evidence.push({file,url:s.url,positiveFunctions:positive.length,positiveLines:positiveLines.length});
    }
  }
  if(!raw.length)throw Error('No raw coverage');
  for(const row of files.values())if(row.scope==='UNMAPPED'&&row.executed)gaps.push({kind:'UNMAPPED',path:row.path,physicalPaths:row.physicalPaths});
  const rows=[...files.values()],scope=c.staticScope??'source',executed=new Set(rows.filter(r=>r.scope===scope&&r.executed).map(r=>r.path));
  const a=[...closure].filter(p=>executed.has(p)).sort(),b=[...executed].filter(p=>!closure.has(p)).sort(),cc=[...closure].filter(p=>!executed.has(p)).sort();
  // Endpoint existence alone is not write evidence. Require a fresh isolated snapshot,
  // changed-file receipt, or another explicitly supplied write witness.
  let endpoints=table.endpoints.map(t=>{
    const evidence=(t.files??[]).filter(f=>f.sha256&&f.path),proof=table.freshRootBasis||t.writeReceipt;
    return {...t,status:evidence.length&&proof?'WRITTEN':evidence.length?'UNKNOWN':table.completeInventory?'NOT_OBSERVED_ON_THIS_RUN':'UNKNOWN',
      evidenceBasis:proof??null};
  });
  for(const t of endpoints)if(t.finalEndpoint){
    const final=endpoints.find(e=>e.id===t.finalEndpoint);
    const writer=(t.writerRanges??[]).some(w=>{
      try{const s=read(w.coverage).result.find(s=>s.url===w.url);
        return s?.functions.some(f=>f.ranges.some(r=>r.startOffset===w.startOffset&&r.endOffset===w.endOffset&&r.count>0));
      }catch(e){gaps.push({kind:'WRITER_RANGE_UNKNOWN',id:t.id,detail:e.message});return false;}
    });
    if(writer&&final?.status==='WRITTEN') {t.status='WRITTEN';t.evidenceBasis='Exact writer range plus bound final endpoint; transient rename';}
  }
  let instrumentLogOnly=[];
  if(c.instrumentCollect){const observed=instrumentEvidence(c,table,raw,gaps);endpoints=observed.endpoints;instrumentLogOnly=observed.logOnly;}
  const written=endpoints.filter(e=>['WRITTEN','WRITTEN_OBSERVED'].includes(e.status)).length;
  return {contract:contract('EXECUTION',[...(c.instrumentCollect?[{path:c.instrumentCollect,sha256:sha(c.instrumentCollect)}]:[]),...raw.map(r=>({path:r.file,sha256:r.sha256})),{path:c.staticMap,sha256:sha(c.staticMap)},{path:c.endpointTable,sha256:sha(c.endpointTable)}],[{id:'raw-traces',semantics:'TRACE_OBSERVED',definition:'All raw trace files in supplied directory'},{id:'mapped-files',semantics:'TRACE_OBSERVED',definition:'Logical file plus scope across supplied processes'},{id:'static-closure',semantics:'STATIC_DECLARED',definition:'Configured static closure in '+scope},{id:'endpoints',semantics:'WITNESS_DECLARED',definition:'Entries in supplied endpoint table'}],[{selector:'counts.raw',population:'raw-traces',unit:'trace files'},{selector:'counts.executed|files[*].positiveNamedFunctions|files[*].lineCounts.*|files[*].evidence[*].positiveFunctions|files[*].evidence[*].positiveLines',population:'mapped-files',unit:'field-specific trace counts'},{selector:'counts.a|counts.c',population:'static-closure',unit:'logical files'},{selector:'counts.b',population:'mapped-files',unit:'same-scope files outside closure'},{selector:'counts.endpoints|counts.written',population:'endpoints',unit:'declared endpoints'}]),schema:'coverage-reconcile-v1',layer:'execution-coverage',measuredAt:new Date().toISOString(),status:gaps.length?'PARTIAL':'PASS',
    elapsedMs:Math.round(performance.now()-started),counts:{raw:raw.length,executed:rows.filter(r=>r.executed).length,a:a.length,b:b.length,c:cc.length,endpoints:endpoints.length,written},
    threeWay:{scope,a,b,c:cc,cJavaScript:cc.filter(p=>/\.(?:mjs|cjs|js)$/.test(p)),cOutsideV8:cc.filter(p=>!/\.(?:mjs|cjs|js)$/.test(p)),cPython:cc.filter(p=>p.endsWith('.py'))},
    external:rows.filter(r=>r.scope!==scope&&r.executed),loadedOnly:rows.filter(r=>!r.executed),anonymousOnly:rows.filter(r=>r.language==='javascript'&&r.executed&&!r.positiveNamedFunctions),
    files:rows,raw,endpoints,instrumentLogOnly,excluded,gaps,
    inputs:{staticMap:{path:c.staticMap,sha256:sha(c.staticMap)},endpointTable:{path:c.endpointTable,sha256:sha(c.endpointTable)}},
    limitations:['Positive function range includes top-level evaluation, not business correctness.','Python input records sys.settrace line events; function counts are not inferred. Absence is UNKNOWN for languages without supplied instrumentation.',
      'Endpoint witnesses supplied by caller must bind exact roots and this run; restored seeds are not new business output.',
      'Counts include all processes in the supplied directory; do not mix runs or versions.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node coverage-reconcile.mjs --config file");process.exit(0);}

  try{if(process.argv[2]!=='--config'||process.argv.length!==4)throw Error('Usage: coverage-reconcile.mjs --config file');
    const r=reconcile(read(process.argv[3]));configSource(r,process.argv[3]);console.log(JSON.stringify(r,null,2));if(r.gaps.length)process.exitCode=2;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
