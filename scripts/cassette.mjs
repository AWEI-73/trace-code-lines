import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export const canonical=v=>JSON.stringify(v&&typeof v==='object'?(Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))]))):v);
export const requestKey=(kind,request)=>hash(canonical({kind,request}));
export function anchor(root,a){
 if(!a||!Number.isInteger(a.line)||a.line<1||typeof a.expect!=='string'||!a.expect)return {status:'UNKNOWN',reason:'MISSING_ANCHOR'};
 const p=path.resolve(root,a.file??''),rel=path.relative(path.resolve(root),p);
 if(!rel||rel.startsWith('..')||path.isAbsolute(rel))return {status:'FAIL',reason:'ANCHOR_ESCAPE'};
 try{const b=fs.readFileSync(p),line=b.toString('utf8').split(/\r?\n/)[a.line-1];
 return {...a,sha256:hash(b),status:line?.includes(a.expect)&&(!a.sha256||hash(b)===a.sha256)?'PASS':'FAIL'};}catch(e){return {...a,status:'UNKNOWN',reason:e.code};}
}
export function validateCassette(c){
 if(c?.schema!=='boundary-cassette-v1'||!Array.isArray(c.calls)||!Array.isArray(c.anchors)||!c.anchors.length||c.anchors.some(a=>!a.sha256))throw Error('CASSETTE_SCHEMA');
 for(const [i,r] of c.calls.entries()){
  if(!['subprocess','http','model-sdk'].includes(r.kind)||!['stand-in','test-fixture','existing-recording'].includes(r.source)||r.sequence!==i||r.key!==requestKey(r.kind,r.request)||r.response===undefined)throw Error('CASSETTE_ROW '+i);
  if(r.live===true)throw Error('LIVE_BOUNDARY_FORBIDDEN');
 }
 return c;
}
export function preflight(c,plan,root){
 try{validateCassette(c);}catch(e){return {status:'STALE',step:0,reason:e.message};}
 const anchors=c.anchors.map(a=>anchor(root,a));if(anchors.some(a=>a.status!=='PASS'))return {status:'STALE',step:0,reason:'SOURCE_ANCHOR_CHANGED',anchors};
 if(!Array.isArray(plan))return {status:'UNKNOWN',reason:'CURRENT_CALL_ORDER_REQUIRED'};
 const expected=c.calls.map(r=>r.key),actual=plan.map(r=>requestKey(r.kind,r.request));
 for(let i=0;i<Math.max(expected.length,actual.length);i++)if(expected[i]!==actual[i])return {status:'STALE',step:i+1,expected:expected[i]??null,actual:actual[i]??null,reason:'CALL_ORDER_CHANGED',anchors};
 return {status:'PASS',calls:expected.length,anchors};
}
export function commandPolicy(command){
 const s=command.join(' ');
 const forbidden=/(?:^|[\\/\s])(?:clasp|gcloud|aws|az|ssh|scp|curl|wget|codex|claude|agy)(?:\.exe|\.cmd)?(?:\s|$)|\bgit\s+(?:push|send-email)\b|\b(?:deploy|publish|login|sendmail)\b/i;
 return {status:forbidden.test(s)?'FAIL':'PASS',reason:forbidden.test(s)?'MONEY_CREDENTIAL_OR_EXTERNAL_ACTION_BLOCKED':null};
}
