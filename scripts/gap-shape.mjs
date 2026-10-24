import {createHash} from 'node:crypto';
import path from 'node:path';
// Top-level identity is an allowlist. These data keys are annotation namespaces.
export const GAP_ANNOTATION_FIELDS=Object.freeze(['resolution','configHint','configCandidates','inferredEdges','inference','reconciliation','runtimeVerified','declaredVerified','confidence','provenance','legacyIds','legacyId','legacyIdBasis','annotationFields']);
// Added config payload is retained for consumers, but explicitly marked as annotation.
export const GAP_CONFIG_ANNOTATION_FIELDS=Object.freeze(['command','commands','reason']);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export function identityData(data){
  if(data==null)return null;
  const excluded=new Set(GAP_ANNOTATION_FIELDS),appended=new Set((Array.isArray(data.annotationFields)?data.annotationFields:[]).filter(k=>GAP_CONFIG_ANNOTATION_FIELDS.includes(k)));
  const filter=(v,top=false)=>Array.isArray(v)?v.map(x=>filter(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!excluded.has(k)&&!(top&&appended.has(k))).map(([k,x])=>[k,filter(x)])):v;
  const value=filter(data,true);
  // Removing the last annotation may leave {}; empty identity data has the same meaning as absent data.
  return !Array.isArray(value)&&typeof value==='object'&&Object.keys(value).length===0?null:value;
}
// The frozen serialization and hashing stay unchanged; old versions retain their data snapshot.
export function dataGapIdentity(g,repo,data=g.data??null){
  let file=(g.path??g.file??'').replaceAll('\\','/');
  if(repo&&(path.isAbsolute(file)||path.win32.isAbsolute(file)))file=path.relative(repo,file).replaceAll('\\','/');
  file=path.posix.normalize(file).replace(/^\.\//,'');
  return 'gap-'+createHash('sha256').update(JSON.stringify([g.code??g.kind,file,g.line??null,canonical(data)])).digest('hex').slice(0,24);
}
// Internal raw history survives object spreads but is never serialized as current evidence.
export const LEGACY_RAW_SHAPE=Symbol('legacyRawShape');
// Common wire shape; preserve all evidence and existing problem codes.
export function normalizeGap(g){
  const structured=g.detail!==null&&typeof g.detail==='object';
  const data=structured?{...g.detail,...(g.data??{})}:g.data;
  if(data?.reason!==undefined&&typeof data.reason!=='string')data.reason=JSON.stringify(data.reason);
  const detail=structured?(typeof data.reason==='string'?data.reason:JSON.stringify(g.detail)):
    typeof g.detail==='string'?g.detail:String(g.detail??g.reason??g.message??g.code??g.kind??'Unresolved evidence');
  const normalized={...g,line:g.line??null,detail,...(data?{data}:{})};
  normalized[LEGACY_RAW_SHAPE]=g[LEGACY_RAW_SHAPE]??{code:g.code??g.kind,detail:g.detail??null};
  // Preserve pre-normalization detail before metadata enrichment. The old formulas serialize it verbatim.
  const rawId=legacyGapIdentity(g),normalizedId=legacyGapIdentity(normalized);
  normalized.legacyIds={ '1.5.0':rawId,'1.6.0':rawId,'1.7.0':normalizedId,...(g.legacyIds??{}) };
  normalized.legacyId=g.legacyId??normalized.legacyIds['1.7.0'];
  return normalized;
}
export function gapList(){
  const list=[];
  Object.defineProperty(list,'push',{value:function(...gaps){return Array.prototype.push.apply(this,gaps.map(normalizeGap));}});
  return list;
}

// Exact 1.7.0 ID formula, also used for the old wrapper-group representative.
export const legacyGapIdentity=g=>'gap-'+createHash('sha256').update(JSON.stringify([g.path??g.file,g.code??g.kind,g.line??null,g.detail??null])).digest('hex').slice(0,24);
