import {normalizeGap} from './gap-shape.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {contract,configSource} from './contract.mjs';
import {loadManifest} from './instrument.mjs';
import {readRecords,validLocation,normalizeTarget,sameTarget,gapSites,gapIdentity,inferenceIdentity} from './inference-layer.mjs';
import {tokens,localFunctions} from './language-static.mjs';
import {sha256,noLinks,readBounded} from './walker.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const source=p=>({path:path.resolve(p),sha256:sha256(fs.readFileSync(p))});
const norm=p=>p.replaceAll('\\','/').replace(/\/$/,'');
const statuses=['VERIFIED','CO_OCCURRED','SITE_EXECUTED_TARGET_UNKNOWN','SITE_NOT_EXECUTED','UNKNOWN'];
const labels={VERIFIED:'\u5df2\u7531\u57f7\u884c\u8b49\u5be6',CO_OCCURRED:'\u540c\u6b21\u57f7\u884c\u6709\u8dd1\u5230\uff08\u4e0d\u662f\u908a\u7684\u8b49\u64da\uff09',SITE_EXECUTED_TARGET_UNKNOWN:'\u6709\u8dd1\u5230\u4f46\u4e0d\u77e5\u9053\u53bb\u54ea',SITE_NOT_EXECUTED:'\u9019\u6b21\u6c92\u8dd1\u5230',UNKNOWN:'\u4ecd\u672a\u77e5'};

export function gapReconcile(c){
  if(!c.staticMap||(!c.coverageDirectory&&!c.instrumentCollect&&!c.observations))throw Error('staticMap and coverageDirectory, instrumentCollect or observations required');
  const map=read(c.staticMap);if(!Array.isArray(map.closures)||map.readOnly?.status==='FAIL'||map.status?.startsWith('STOPPED'))throw Error('Usable derive-map closures required');
  const sources=[source(c.staticMap)],issues=[],coverage=[],observations=[],rejectedObservations=[],headers=[],taintedRuns=new Set();let unassignedMalformed=false;
  const repo=path.resolve(c.repo??map.repo),roots=(c.roots??[{root:repo}]).map(r=>({...r,root:norm(path.resolve(r.root))})).sort((a,b)=>b.root.length-a.root.length);
  const unique=new Map();for(const closure of map.closures)for(const g of closure.gaps??[]){const id=g.gapId??gapIdentity(g);if(!unique.has(id))unique.set(id,g);}
  const legacy=new Map();
  for(const [id,g] of unique)for(const [version,oldId] of Object.entries(g.legacyIds??{}).sort(([a],[b])=>b.localeCompare(a,undefined,{numeric:true})))if(typeof oldId==='string'){
    if(!legacy.has(oldId))legacy.set(oldId,[]);legacy.get(oldId).push({id,version});
  }
  function observationIdentity(r){
    if(r?.gapId===undefined)return {};
    if(typeof r.gapId!=='string')return {error:'gapId must identify an existing gap'};
    if(unique.has(r.gapId))return {id:r.gapId};
    let candidates=legacy.get(r.gapId)??[];
    if(r.from)candidates=candidates.filter(c=>{const g=unique.get(c.id);return r.from.file===(g.path??g.file)&&gapSites(g).includes(r.from.line);});
    const ids=[...new Set(candidates.map(c=>c.id))];
    if(ids.length!==1)return {error:ids.length?'legacy gapId is ambiguous; exact from location required':'gapId must identify an existing gap'};
    return {id:ids[0],matchedVia:'legacyId:'+candidates.find(c=>c.id===ids[0]).version,observedGapId:r.gapId};
  }
  const physicalToLogical=p=>{const s=norm(path.resolve(p)),r=roots.find(r=>process.platform==='win32'?s.toLowerCase().startsWith(r.root.toLowerCase()+'/'):s.startsWith(r.root+'/'));return r?norm((r.prefix?r.prefix+'/':'')+s.slice(r.root.length+1)):null;};
  let directory=c.coverageDirectory,defaultRun=c.runId??null,manifestFiles=null;
  if(c.instrumentCollect){
    const collected=read(c.instrumentCollect);if(collected.schema!=='instrument-collect-v1')throw Error('Invalid instrument collect schema');
    const manifest=loadManifest(path.resolve(collected.manifest)),binding=source(c.instrumentCollect);
    if(!manifest.files.some(f=>path.resolve(f.path)===binding.path&&f.sha256===binding.sha256))throw Error('Collect manifest integrity failure');
    manifestFiles=new Map(manifest.files.map(f=>[path.resolve(f.path),f.sha256]));
    sources.push(binding,source(collected.manifest));defaultRun??='instrument-'+sha256(JSON.stringify(manifest.command)+manifest.startedAt+binding.sha256).slice(0,24);
    directory??=path.join(manifest.config.outputDirectory,'coverage');
    if(manifest.exitCode!==0||collected.exitCode!==0)issues.push({kind:'RUN_FAILED',exitCode:manifest.exitCode});
    issues.push(...(collected.gaps??[]));
  }
  if(directory){
    noLinks(directory);defaultRun??='coverage-directory-'+sha256(path.resolve(directory)).slice(0,24);
    for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.json')).sort()){
      const file=path.join(directory,name);noLinks(file);const binding=source(file);
      if(manifestFiles&&manifestFiles.get(binding.path)!==binding.sha256)throw Error('Coverage manifest integrity failure: '+name);
      sources.push(binding);
      try{
        const data=read(file),runId=typeof data.runId==='string'&&data.runId?data.runId:defaultRun;
        if(data.schema==='python-settrace-v1'){
          if(!Array.isArray(data.files))throw Error('Invalid Python coverage files');
          for(const f of data.files){
            if(typeof f.path!=='string'||!path.isAbsolute(f.path)||!Array.isArray(f.lines)||f.lines.some(l=>!Number.isInteger(l.line)||l.line<1||!Number.isInteger(l.count)||l.count<0))throw Error('Invalid Python line coverage');
            const logical=physicalToLogical(f.path);if(logical)coverage.push({file:logical,physical:f.path,runId,python:f.lines,source:binding});
          }
        }else if(Array.isArray(data.result))for(const s of data.result){
          if(typeof s.url!=='string'||!s.url.startsWith('file:'))continue;
          const physical=fileURLToPath(s.url),logical=physicalToLogical(physical);if(!logical)continue;
          if(!Array.isArray(s.functions)||s.functions.some(f=>!Array.isArray(f.ranges)||f.ranges.some(r=>!Number.isInteger(r.startOffset)||!Number.isInteger(r.endOffset)||r.startOffset<0||r.endOffset<=r.startOffset||!Number.isFinite(r.count)||r.count<0)))throw Error('Invalid V8 coverage ranges');
          coverage.push({file:logical,physical,runId,functions:s.functions,source:binding});
        }else throw Error('Unsupported coverage schema');
      }catch(e){issues.push({kind:'COVERAGE_UNKNOWN',file,reason:e.message});}
    }
    if(!sources.some(s=>path.dirname(s.path)===path.resolve(directory)))issues.push({kind:'NO_COVERAGE_FILES',directory});
  }
  if(c.observations){
    const parsed=readRecords(c.observations);sources.push(parsed.source);
    let activeRun=null;
    for(const entry of parsed.records){
      const r=entry.record;
      const explicitRun=typeof r?.runId==='string'&&r.runId.trim()?r.runId:null;
      if(explicitRun)activeRun=explicitRun;
      if(!entry.error&&r?.schema==='observation-header-v1'){headers.push(r);continue;}
      const normalized=normalizeTarget(r?.to,{repo:map.repo,inventory:map.contract?.sources,pythonSourceRoots:map.scope?.pythonSourceRoots});
      const identity=observationIdentity(r);
      const reason=entry.error??identity.error??
        (r?.from===undefined&&r?.gapId?null:validLocation(r?.from,true))??normalized.error??
        (typeof r?.runId!=='string'||!r.runId.trim()?'runId must be a nonempty string':null)??
        (r?.complete!==undefined&&typeof r.complete!=='boolean'?'complete must be boolean':null);
      if(reason){
        // A broken JSONL record can use its enclosing run header/preceding run segment.
        const runId=explicitRun??(entry.error&&entry.line?activeRun:null);
        if(runId)taintedRuns.add(runId);else unassignedMalformed=true;
        rejectedObservations.push({...entry,reason,runId,runIdBasis:explicitRun?'RECORD':runId?'PRECEDING_JSONL_RUN_SEGMENT':'UNASSIGNED',source:parsed.source});
      }
      else observations.push({...r,...(identity.id?{gapId:identity.id}:{}),...(identity.matchedVia?{matchedVia:identity.matchedVia,observedGapId:identity.observedGapId}:{}),to:normalized.to,source:{...parsed.source,line:entry.line??null,index:entry.index??null}});
    }
  }
  const sourceCache=new Map(),sourceBindings=new Map((map.contract?.sources??[]).map(s=>[path.resolve(s.path),s.sha256]));
  function bodyFor(row){
    if(sourceCache.has(row.physical))return sourceCache.get(row.physical);
    try{
      noLinks(row.physical);const body=fs.readFileSync(row.physical,'utf8'),original=readBounded(repo,row.file),expected=sourceBindings.get(path.resolve(repo,row.file));
      if(sha256(body)!==sha256(original)||(expected&&sha256(original)!==expected))throw Error('Source bytes do not match derive-map binding');
      sourceCache.set(row.physical,body);return body;
    }catch(e){issues.push({kind:'SOURCE_BINDING_UNKNOWN',file:row.file,reason:e.message});sourceCache.set(row.physical,null);return null;}
  }
  function site(row,line){
    if(!Number.isInteger(line)||line<1)return null;
    // Coverage offsets and line events are meaningful only for unchanged source bytes.
    const body=bodyFor(row);if(body===null)return null;
    const lines=body.split('\n');if(line>lines.length)return null;
    if(row.python)return row.python.some(l=>l.line===line&&l.count>0);
    const offset=lines.slice(0,line-1).reduce((n,s)=>n+s.length+1,0)+lines[line-1].search(/\S|$/);
    const ranges=row.functions.flatMap(f=>f.ranges).filter(r=>r.startOffset<=offset&&offset<r.endOffset).sort((a,b)=>(a.endOffset-a.startOffset)-(b.endOffset-b.startOffset));
    return ranges.length?ranges[0].count>0:null;
  }
  function target(row,to){
    if((to.kind??'FILE')!=='FILE'||row.file!==to.file||bodyFor(row)===null)return false;
    // Python settrace has no function identity; file activity cannot prove a requested function.
    if(row.python)return !to.function&&row.python.some(l=>l.count>0);
    return row.functions.some(f=>(!to.function||f.functionName===to.function)&&f.ranges[0]?.count>0);
  }
  const functionCache=new Map();
  function importInFunction(file,importLine,siteLine){
    if(!file.endsWith('.py'))return false;
    if(!functionCache.has(file)){
      const body=bodyFor({file,physical:path.resolve(repo,file)});
      if(body===null)functionCache.set(file,null);
      else {const ts=tokens(body,true);functionCache.set(file,{ts,functions:localFunctions(ts,body,true)});}
    }
    const parsed=functionCache.get(file);if(!parsed)return false;
    const {ts,functions}=parsed,at=ts.findIndex(t=>t.line===importLine&&t.v!=='\n');
    if(at<0||!['import','from'].includes(ts[at].v))return false;
    const containing=line=>functions.filter(f=>ts.slice(f.start,f.end).some(t=>t.line===line&&t.v!=='\n')).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
    const a=containing(importLine),b=containing(siteLine);return !!a&&a===b;
  }
  function importedAt(o,g){
    const file=g.path??g.file;
    return o.from?.file===file&&['REGISTRY_DISPATCH','FACTORY_DISPATCH','DYNAMIC_COMPUTED'].includes(g.code??g.kind)&&
      gapSites(g).some(line=>importInFunction(file,o.from.line,line));
  }
  function observationAt(o,gapId,g){
    const file=g.path??g.file;
    if(o.gapId!==undefined)return o.gapId===gapId&&(!o.from||o.from.file===file&&(gapSites(g).includes(o.from.line)||importedAt(o,g)));
    if(o.from.file===file&&gapSites(g).includes(o.from.line))return true;
    // An import is usable only for a unique, same-function, matching inference.
    const matches=[...unique].filter(([,candidate])=>importedAt(o,candidate)&&(candidate.inferredEdges??[]).some(e=>sameTarget(o.to,e.to)));
    return matches.length===1&&matches[0][0]===gapId;
  }
  const rows=[...unique].map(([gapId,g])=>{
    const file=g.path??g.file,lines=gapSites(g),at=observations.filter(o=>observationAt(o,gapId,g));
    const measured=coverage.filter(r=>r.file===file);
    const siteEvidence=lines.flatMap(line=>measured.map(r=>({line,runId:r.runId,executed:site(r,line),source:r.source})));
    const siteExecuted=at.length||siteEvidence.some(e=>e.executed===true)?true:
      lines.length&&lines.every(line=>siteEvidence.some(e=>e.line===line&&e.executed===false)&&!siteEvidence.some(e=>e.line===line&&e.executed===null))?false:null;
    const inferredEdges=(g.inferredEdges??[]).map(edge=>{
      const from=edge.from??{file,line:g.line},observed=at.filter(o=>o.gapId===gapId||o.from.file===from.file&&(o.from.line===from.line||importInFunction(file,o.from.line,from.line)));
      const exact=observed.filter(o=>sameTarget(o.to,edge.to));
      const byRun=new Map();for(const o of observed){if(!byRun.has(o.runId))byRun.set(o.runId,[]);byRun.get(o.runId).push(o);}
      const completeRuns=[...byRun].filter(([runId,os])=>!taintedRuns.has(runId)&&!unassignedMalformed&&
        os.some(o=>o.complete===true&&(o.gapId===gapId||o.from?.line===from.line))&&
        !os.some(o=>sameTarget(o.to,{...edge.to,function:undefined,value:undefined})&&(edge.to.function&&!o.to.function||edge.to.value!==undefined&&o.to.value===undefined))).map(([runId])=>runId);
      const complete=completeRuns.length>0;
      const co=siteEvidence.filter(e=>e.line===from.line&&e.executed===true).flatMap(s=>coverage.filter(r=>r.runId===s.runId&&target(r,edge.to)).map(t=>({site:s,target:{source:t.source,runId:t.runId,file:t.file,function:edge.to.function??null}})));
      const status=exact.length?'VERIFIED':complete?'REFUTED':observed.length?'NOT_OBSERVED':co.length?'CO_OCCURRED':'NOT_OBSERVED';
      return {...edge,declaredVerified:edge.declaredVerified??false,status,runtimeVerified:status==='VERIFIED',runtimeEvidence:{observations:exact.length?exact:observed,coOccurrence:co,completeObservation:complete,completeRuns}};
    });
    const status=at.length?'VERIFIED':inferredEdges.some(e=>e.status==='CO_OCCURRED')?'CO_OCCURRED':siteExecuted===true?'SITE_EXECUTED_TARGET_UNKNOWN':siteExecuted===false?'SITE_NOT_EXECUTED':'UNKNOWN';
    return {gapId,kind:g.code??g.kind,file,line:g.line??null,detail:normalizeGap(g).detail,...(g.data?{data:g.data}:{}),siteExecuted,status,resolution:g.resolution??null,inferredEdges,
      evidence:{sites:siteEvidence,observations:at,reason:siteExecuted===null?'No usable source-bound line evidence for this site':null},originalGap:g};
  });
  // Old maps may repeat one identity within or across gaps. Reconcile once, retain provenance.
  const edgeMap=new Map(),rank={NOT_OBSERVED:0,CO_OCCURRED:1,REFUTED:2,VERIFIED:3};
  for(const row of rows)for(const edge of row.inferredEdges){
    const id=edge.id??inferenceIdentity(edge),previous=edgeMap.get(id);
    if(!previous)edgeMap.set(id,{...edge,id,gapIds:[...new Set([...(edge.gapIds??[]),row.gapId])]});
    else {
      previous.gapIds=[...new Set([...previous.gapIds,...(edge.gapIds??[]),row.gapId])];
      previous.declaredVerified=previous.declaredVerified&&edge.declaredVerified;
      if(rank[edge.status]>rank[previous.status]){previous.status=edge.status;previous.runtimeVerified=edge.runtimeVerified;previous.runtimeEvidence=edge.runtimeEvidence;}
    }
  }
  const attached=new Set();
  for(const row of rows)row.inferredEdges=row.inferredEdges.flatMap(edge=>{
    const id=edge.id??inferenceIdentity(edge);if(attached.has(id))return [];attached.add(id);return [edgeMap.get(id)];
  });
  const inferredEdges=[...edgeMap.values()];
  const counts=Object.fromEntries(statuses.map(s=>[s,rows.filter(r=>r.status===s).length]));
  const edgeStatuses=['VERIFIED','REFUTED','CO_OCCURRED','NOT_OBSERVED'];
  return {schema:'gap-reconcile-v1',layer:'PER_GAP_RUNTIME_RECONCILIATION',status:issues.length||rejectedObservations.length?'PARTIAL':'PASS',
    evidenceClass:headers.some(h=>h.evidenceClass==='MANUAL_DEMONSTRATION')?'MANUAL_DEMONSTRATION':'SUPPLIED_RUNTIME_EVIDENCE',observationHeaders:headers,
    contract:contract('EXECUTION_WITH_SEPARATE_INFERENCE',sources,[{id:'gaps',semantics:'STATIC_DECLARED',definition:'Unique derive-map gaps by gapId'},{id:'inference-associations',semantics:'EXTERNAL_INFERENCE',definition:'Unique inference identities across all gap associations'}],[{selector:'counts.*',population:'gaps',unit:'gaps'},{selector:'inferredEdgeCounts.*',population:'inference-associations',unit:'unique edge identities'}]),
    counts,inferredEdges,inferredEdgeCounts:Object.fromEntries(edgeStatuses.map(s=>[s,inferredEdges.filter(e=>e.status===s).length])),gaps:rows,issues,rejectedObservations,negativeProof:{taintedRuns:[...taintedRuns],unassignedMalformed},
    limitations:['Coverage proves only line/function activity, never a call edge. Same-run co-occurrence is not causation.',
      'A coverage directory without per-file runId is caller-declared to contain one run; do not mix runs. No cross-run co-occurrence is accepted.',
      'V8 uses the narrowest range at the first non-whitespace character of the gap line; multiple calls/branches on one line are not individually distinguished.',
      'Python traces have line counts, not function identity. Function-specific Python targets stay NOT_OBSERVED without explicit edges.',
      'VERIFIED requires matching observation from file/line and target file/function; imported verified flags have no effect.',
      'REFUTED is limited to supplied complete observation runs; malformed observations disable negative proof for their run. Unassignable malformed input disables negative proof conservatively. Refuted inferences remain present.',
      'Malformed JSONL is assigned to the preceding explicit run segment/header; interleaved runs must use valid records with runId. REFUTED reports only the listed completeRuns, not universal impossibility.',
      'Grouped wrapper gaps aggregate all retained callSites; edge reconciliation always uses its exact from.line.',
      'Manual demonstration observations demonstrate the format only and are not automatically captured runtime evidence.']};
}

export function gapSummary(result){
  const lines=['# Gap \u57f7\u884c\u5c0d\u5e33','',`\u8b49\u64da\u985e\u578b\uff1a${result.evidenceClass}`,'','| \u72c0\u614b | \u7b46\u6578 |','| --- | ---: |',
    ...statuses.map(s=>`| ${labels[s]} (${s}) | ${result.counts[s]} |`),'',
    '\u8986\u84cb\u8cc7\u6599\u53ea\u8b49\u660e\u8a72\u6b21\u884c\uff0f\u51fd\u5f0f\u6709\u8dd1\u5230\uff0c\u4e0d\u8b49\u660e\u547c\u53eb\u908a\u3002\u624b\u5beb\u793a\u7bc4\u4e0d\u662f\u771f\u5be6\u81ea\u52d5\u89c0\u6e2c\u3002','',
    '## \u4ecd\u672a\u77e5\u7684\u524d 20 \u7b46','',
    '| gapId | \u7a2e\u985e | \u4f4d\u7f6e |','| --- | --- | --- |',
    ...result.gaps.filter(g=>g.status==='UNKNOWN').slice(0,20).map(g=>`| ${g.gapId} | ${g.kind} | ${g.file}:${g.line??'UNKNOWN'} |`),''];
  if(result.issues.length)lines.push(`\u8b49\u64da\u7f3a\u53e3\uff1a${result.issues.length}\uff0c\u8acb\u8b80 JSON issues\u3002`,'');
  return lines.join('\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log('Usage: node gap-reconcile.mjs --config file [--summary file.md] [--out file.json]');process.exit(0);}
  try{
    const args=process.argv.slice(2),options={};
    for(let i=0;i<args.length;i+=2){if(!['--config','--summary','--out'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||options[args[i]])throw Error('Usage: node gap-reconcile.mjs --config file [--summary file.md] [--out file.json]');options[args[i]]=path.resolve(args[i+1]);}
    if(!options['--config'])throw Error('--config required');
    const config=read(options['--config']);
    const outputs={result:options['--out']??null,summary:options['--summary']??null};
    const inputs=[options['--config'],config.staticMap,config.observations,config.instrumentCollect].filter(Boolean).map(p=>path.resolve(p));
    const destinations=Object.values(outputs).filter(Boolean);
    const pathKey=p=>process.platform==='win32'?p.toLowerCase():p;
    if(new Set(destinations.map(pathKey)).size!==destinations.length||destinations.some(p=>inputs.some(i=>pathKey(i)===pathKey(p))))throw Error('Output paths must be distinct from inputs and each other');
    const r=gapReconcile(config);configSource(r,options['--config']);r.outputs=outputs;
    if(outputs.summary){const body=gapSummary(r);fs.writeFileSync(outputs.summary,body,'utf8');const back=fs.readFileSync(outputs.summary,'utf8');if(back!==body||/[\r\uFFFD]/.test(back))throw Error('Summary readback failed');process.stderr.write(JSON.stringify({summary:outputs.summary,cjk:(back.match(/[\u3400-\u9fff]/g)??[]).length,questionMarks:(back.match(/\?/g)??[]).length,replacementCharacters:(back.match(/\uFFFD/g)??[]).length,cr:(back.match(/\r/g)??[]).length})+'\n');}
    if(outputs.result){const body=JSON.stringify(r,null,2)+'\n';fs.writeFileSync(outputs.result,body,'utf8');if(fs.readFileSync(outputs.result,'utf8')!==body)throw Error('Result readback failed');}
    console.log(JSON.stringify(r,null,2));if(r.status==='PARTIAL')process.exitCode=2;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
