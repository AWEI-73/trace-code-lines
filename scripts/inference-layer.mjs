import {normalizeGap,dataGapIdentity,identityData} from './gap-shape.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {safeName,sha256} from './walker.mjs';
import {contract} from './contract.mjs';
import {legacyGapIdentity} from './gap-shape.mjs';
export {legacyGapIdentity};

export function validLocation(value,from=false){
  if(!value||typeof value!=='object'||Array.isArray(value))return 'Location must be an object';
  try{safeName(value.file);}catch{return 'file must be a safe repository-relative path';}
  if(from&&(!Number.isInteger(value.line)||value.line<1))return 'from.line must be a positive integer';
  if(!from&&value.function!==undefined&&(typeof value.function!=='string'||!value.function.trim()))return 'to.function must be a nonempty string';
  return null;
}
export const targetKinds=['FILE','EXTERNAL_BINARY','EXTERNAL_PACKAGE','PROJECT_SCRIPT','NO_FILE'];
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
// Target normalization never reads outside the bound repository inventory or traverses an edge.
export function normalizeTarget(value,{repo,inventory=[],pythonSourceRoots=['.','src']}={}){
  if(!value||typeof value!=='object'||Array.isArray(value))return {error:'Target must be an object'};
  let to={...value},resolution;
  const kind=to.kind??'FILE';
  if(!targetKinds.includes(kind))return {error:'Unsupported to.kind'};
  if(to.value!==undefined&&!(nonempty(to.value)||(Array.isArray(to.value)&&to.value.length>0&&to.value.every(nonempty))))return {error:'to.value must be a nonempty string or string argv array'};
  if(kind==='FILE'&&!to.file&&to.module!==undefined){
    if(!nonempty(to.module)||! /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(to.module))return {error:'to.module must be an absolute Python module name'};
    const known=new Set(inventory.map(s=>path.relative(repo,s.path).replaceAll('\\','/')));
    const candidates=[...new Set(pythonSourceRoots.flatMap(root=>[path.posix.join(root,to.module.replaceAll('.','/'),'__init__.py'),path.posix.join(root,to.module.replaceAll('.','/')+'.py')]).filter(p=>known.has(p)))];
    if(candidates.length===1){to={...to,kind:'FILE',file:candidates[0]};resolution={reason:'MODULE_RESOLVED_IN_PYTHON_SOURCE_ROOTS',module:to.module,candidates};}
    else {to={...to,kind:'EXTERNAL_PACKAGE'};resolution={reason:candidates.length?'MODULE_AMBIGUOUS_IN_PYTHON_SOURCE_ROOTS':'MODULE_NOT_FOUND_IN_PYTHON_SOURCE_ROOTS',module:to.module,candidates};}
  }else to.kind=kind;
  const actual=to.kind??'FILE';
  if(actual==='FILE'){const error=validLocation(to);if(error)return {error};to.kind='FILE';}
  else {
    if(to.file!==undefined)return {error:'External targets cannot contain to.file; use to.value for outside paths'};
    const identity={EXTERNAL_BINARY:'name',EXTERNAL_PACKAGE:'module',NO_FILE:'description'}[actual];
    if(identity&&to[identity]===undefined){const v=Array.isArray(to.value)&&actual==='EXTERNAL_BINARY'?to.value[0]:to.value;if(nonempty(v))to[identity]=v;}
    if(actual==='EXTERNAL_BINARY'&&to.value!==undefined&&(Array.isArray(to.value)?to.value[0]:to.value)!==to.name)return {error:'Binary value executable must equal name'};
    if(actual==='EXTERNAL_PACKAGE'&&to.value!==undefined&&to.value!==to.module)return {error:'Package value must equal module'};
    if(to.function!==undefined&&!nonempty(to.function))return {error:'to.function must be a nonempty string'};
    const fields={EXTERNAL_BINARY:['name'],EXTERNAL_PACKAGE:['module'],PROJECT_SCRIPT:['configFile','name'],NO_FILE:['description']}[actual];
    if(fields.some(k=>!nonempty(to[k])))return {error:'Missing target identity: '+fields.join(',')};
    if(actual==='PROJECT_SCRIPT'){try{safeName(to.configFile);}catch{return {error:'configFile must be a safe repository-relative path'};}}
  }
  return {to,resolution};
}
export function sameTarget(observed,inferred){
  const kind=inferred.kind??'FILE';if((observed.kind??'FILE')!==kind)return false;
  const fields={FILE:['file'],EXTERNAL_BINARY:['name'],EXTERNAL_PACKAGE:['module'],PROJECT_SCRIPT:['configFile','name'],NO_FILE:['description']}[kind];
  if(!fields||fields.some(k=>observed[k]!==inferred[k]))return false;
  if(inferred.function&&observed.function!==inferred.function)return false;
  return inferred.value===undefined||JSON.stringify(observed.value)===JSON.stringify(inferred.value);
}
export function readRecords(file){
  const bytes=fs.readFileSync(file),source={path:path.resolve(file),sha256:sha256(bytes)},body=bytes.toString('utf8').replace(/^\uFEFF/,'');
  if(path.extname(file).toLowerCase()==='.jsonl')return {source,records:body.split(/\r?\n/).flatMap((s,i)=>{
    if(!s.trim())return [];try{return [{record:JSON.parse(s),line:i+1}];}catch(e){return [{line:i+1,error:e.message}];}
  })};
  try{const data=JSON.parse(body);return {source,records:(Array.isArray(data)?data:[data]).map((record,index)=>({record,index}))};}
  catch(e){return {source,records:[{error:e.message}]};}
}
export const gapSites=g=>[...new Set([g.line,...(g.callSites??[]).map(s=>s.line)].filter(n=>Number.isInteger(n)&&n>0))];
// G50: explicit identity fields; appended annotations never enter the frozen hash.
export const gapIdentity=(g,repo)=>dataGapIdentity(g,repo,identityData(g.data));

// Identity depends only on the canonical source site, target identity and edge kind.
// File names, record order, version strings and confidence/provenance are not identity.
export function inferenceIdentity(edge){
  const to=edge.to,kind=to.kind??'FILE';
  const fields={FILE:['file'],EXTERNAL_BINARY:['name'],EXTERNAL_PACKAGE:['module'],PROJECT_SCRIPT:['configFile','name'],NO_FILE:['description']}[kind]??[];
  return 'inferred-'+sha256(JSON.stringify(['INFERRED_EDGE',edge.from.file,edge.from.line,kind,
    ...fields.map(k=>to[k]??null),to.function??null,to.value??null])).slice(0,24);
}

export function attachInferenceLayer(result,{file,inventory=[]}={}){
  const gaps=new Map();
  for(const c of result.closures??[])for(const g of c.gaps){
    g.legacyIds??=normalizeGap(g).legacyIds;
    g.legacyIds['1.7.0']=g.legacyId??g.legacyIds['1.7.0'];g.legacyId=g.legacyIds['1.7.0'];
    for(const version of ['1.8.0','1.9.0'])if(!(version in g.legacyIds))g.legacyIds[version]=dataGapIdentity(g,result.repo);
    g.gapId=gapIdentity(g,result.repo);g.inferredEdges=[];
    if(!('1.12.0' in g.legacyIds))g.legacyIds['1.12.0']=g.gapId;
    if(!('1.12.1' in g.legacyIds))g.legacyIds['1.12.1']=g.gapId;
    if(!('1.13.0' in g.legacyIds))g.legacyIds['1.13.0']=g.gapId;
    if(!g.resolution&&['DYNAMIC_COMPUTED','REGISTRY_DISPATCH','FACTORY_DISPATCH','PYTHON_SYS_PATH_MUTATION','TEXT_REFERENCE_COMPUTED'].includes(g.code))g.resolution='UNRESOLVABLE_STATICALLY';
    if(!gaps.has(g.gapId))gaps.set(g.gapId,[]);gaps.get(g.gapId).push(g);
  }
  const imported=file?readRecords(file):null,edges=[],byId=new Map(),unmatched=[],rejected=[];
  for(const entry of imported?.records??[]){
    const r=entry.record,normalized=normalizeTarget(r?.to,{repo:result.repo,inventory,pythonSourceRoots:result.scope?.pythonSourceRoots}),reason=entry.error??validLocation(r?.from,true)??normalized.error??
      (typeof r?.confidence!=='number'||!Number.isFinite(r.confidence)||r.confidence<0||r.confidence>1?'confidence must be in [0,1]':null)??
      (typeof r?.evidence!=='string'||!r.evidence.trim()?'evidence must be a nonempty string':null)??
      (r?.verified!==undefined&&typeof r.verified!=='boolean'?'verified must be boolean':null);
    if(reason){rejected.push({...entry,reason,source:imported.source});continue;}
    const matched=[...gaps].filter(([id,gs])=>(r.gapId===undefined||r.gapId===id)&&gs[0].path===r.from.file&&gapSites(gs[0]).includes(r.from.line)).sort((a,b)=>Number(b[1][0].code==='SUBPROCESS_TARGET_UNKNOWN')-Number(a[1][0].code==='SUBPROCESS_TARGET_UNKNOWN')); 
    if(!matched.length){unmatched.push({...entry,reason:'NO_GAP_AT_EXACT_FROM_FILE_LINE',source:imported.source});continue;}
    const edge={id:inferenceIdentity({from:r.from,to:normalized.to}),kind:'INFERRED_EDGE',
      from:{file:r.from.file,line:r.from.line},to:normalized.to,...(normalized.resolution?{targetResolution:normalized.resolution}:{}),
      inferred:true,candidate:true,confidence:r.confidence,evidence:r.evidence,source:imported.source,
      declaredVerified:r.verified??false,runtimeVerified:false,status:'NOT_OBSERVED',gapIds:matched.map(([id])=>id)};
    const recordSource={...imported.source,line:entry.line??null,index:entry.index??null,evidence:r.evidence,confidence:r.confidence,declaredVerified:r.verified??false};
    const existing=byId.get(edge.id);
    if(existing){
      existing.provenance.push(recordSource);
      existing.declaredVerified=existing.declaredVerified&&edge.declaredVerified;
      existing.confidence=Math.min(existing.confidence,edge.confidence);
      continue;
    }
    edge.provenance=[recordSource];byId.set(edge.id,edge);
    edges.push(edge);
    // Keep all gap associations on the edge; attach it once per closure through one gapId.
    for(const c of result.closures??[]){const g=c.gaps.find(g=>g.gapId===matched[0][0]);if(g&&!g.inferredEdges.some(e=>e.id===edge.id))g.inferredEdges.push(edge);}
  }
  for(const c of result.closures??[]){const ids=new Set(c.gaps.map(g=>g.gapId));c.inferredEdges=edges.filter(e=>e.gapIds.some(id=>ids.has(id)));}
  for(const c of result.zeroCoverageCandidates??[]){
    c.inferredReferences=edges.filter(e=>e.to.kind==='FILE'&&e.to.file===c.path);
    c.runtimeObserved=c.inferredReferences.some(e=>e.runtimeVerified===true);
  }
  result.inferredEdges=edges;result.unmatchedInferences=unmatched;result.rejectedInferences=rejected;
  if(result.endpointTable)result.endpointTable.inferredEdges=edges;
  result.counts={dataReadComputed:(result.closures??[]).reduce((n,c)=>n+(c.dataReadComputed??0),0),staticEdges:(result.closures??[]).reduce((n,c)=>n+c.edges.length,0),inferredEdges:edges.length,
    inferredEdgesByKind:Object.fromEntries(targetKinds.map(kind=>[kind,edges.filter(e=>e.to.kind===kind).length])),
    gaps:gaps.size,gapsWithInferences:[...gaps.values()].filter(gs=>gs[0].inferredEdges.length).length,
    unmatchedInferences:unmatched.length,rejectedInferences:rejected.length};
  result.contract=contract('STATIC_WITH_SEPARATE_INFERENCE',[...inventory,...(imported?[imported.source]:[])],
    [{id:'static-edges',semantics:'STATIC_DECLARED',definition:'Existing lexical edge occurrences summed across closures, unchanged by imports'},
      {id:'inferred-edges',semantics:'EXTERNAL_INFERENCE',definition:'Unique accepted inference identities; separate from static closure traversal'},
      {id:'gaps',semantics:'STATIC_DECLARED',definition:'Unique gap identities across closures'}],
    [{selector:'counts.staticEdges',population:'static-edges',unit:'edge occurrences'},
      {selector:'counts.inferredEdges',population:'inferred-edges',unit:'unique edge identities'},
      {selector:'counts.gaps|counts.gapsWithInferences',population:'gaps',unit:'unique gaps'}]);
  // This pure snapshot has no execution timestamp; repeated analysis stays byte-comparable.
  result.contract.measuredAt=null;result.contract.timeBasis='STATIC_SNAPSHOT_NO_EXECUTION_TIME';
  result.limitations.push('Imported verified is only a source declaration, never runtime proof. Inferences do not expand static files, edges or endpoints.');
  return result;
}
