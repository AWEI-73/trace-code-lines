import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {pathToFileURL} from 'node:url';
export const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const get=(v,p)=>String(p??'').split('.').filter(Boolean).reduce((a,k)=>a?.[k],v);
export function snapshot(root) {
 const files=[];function walk(p){const s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('Linked boundary input: '+p);
 if(s.isDirectory())for(const n of fs.readdirSync(p).sort())walk(path.join(p,n));
 else if(s.isFile()){const b=fs.readFileSync(p);files.push({path:path.relative(root,p).replaceAll('\\','/'),bytes:b.length,sha256:hash(b)});}}
 if(!fs.existsSync(root))return {root,exists:false,files:[],sha256:hash('MISSING')};walk(root);
 return {root,exists:true,files,sha256:hash(JSON.stringify(files))};
}
export function minimal(schema,root=schema,depth=0) {
 if(depth>30)throw Error('Recursive schema cannot be minimized');
 if(schema===true)return null;if(!schema||schema===false||typeof schema!=='object')throw Error('No supported output schema');
 const known=new Set(['$schema','$id','$defs','definitions','$ref','title','description','default','examples','type','const','enum','properties','required','additionalProperties','items','minItems','maxItems','minLength','maxLength','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','anyOf','oneOf']);
 for(const k of Object.keys(schema))if(!known.has(k))throw Error('Unsupported schema keyword: '+k);
 if(schema.$ref){if(!schema.$ref.startsWith('#/'))throw Error('External schema ref');const s=schema.$ref.slice(2).split('/').reduce((a,k)=>a?.[k.replaceAll('~1','/').replaceAll('~0','~')],root);return minimal(s,root,depth+1);}
 if(Object.hasOwn(schema,'const'))return schema.const;
 if(schema.enum?.length)return schema.enum[0];
 if(schema.oneOf||schema.anyOf){for(const s of schema.oneOf??schema.anyOf){try{const v=minimal(s,root,depth+1);if(valid(v,schema,root))return v;}catch{}}throw Error('No satisfiable alternative');}
 const t=Array.isArray(schema.type)?schema.type[0]:schema.type??(schema.properties?'object':undefined);let v;
 if(t==='object'){v={};for(const k of schema.required??[]){const s=schema.properties?.[k]??schema.additionalProperties;if(s===undefined||s===true)v[k]=null;else v[k]=minimal(s,root,depth+1);}}
 else if(t==='array')v=Array.from({length:schema.minItems??0},()=>minimal(schema.items??true,root,depth+1));
 else if(t==='string')v='x'.repeat(schema.minLength??0);
 else if(t==='boolean')v=false;
 else if(t==='null')v=null;
 else if(t==='number'||t==='integer'){v=schema.minimum??0;if(schema.exclusiveMinimum!==undefined)v=Math.max(v,schema.exclusiveMinimum+1);if(t==='integer')v=Math.ceil(v);if(schema.multipleOf)v=Math.ceil(v/schema.multipleOf)*schema.multipleOf;}
 else throw Error('Output type is undeclared');
 if(!valid(v,schema,root))throw Error('No supported minimal value satisfies schema');return v;
}
export function valid(v,s,root=s) {
 if(s===true)return true;if(!s||s===false)return false;
 if(s.$ref)return valid(v,s.$ref.slice(2).split('/').reduce((a,k)=>a?.[k.replaceAll('~1','/').replaceAll('~0','~')],root),root);
 if(Object.hasOwn(s,'const')&&JSON.stringify(v)!==JSON.stringify(s.const))return false;
 if(s.enum&&!s.enum.some(x=>JSON.stringify(x)===JSON.stringify(v)))return false;
 if(s.anyOf&&!s.anyOf.some(x=>valid(v,x,root)))return false;
 if(s.oneOf&&s.oneOf.filter(x=>valid(v,x,root)).length!==1)return false;
 const types=Array.isArray(s.type)?s.type:s.type?[s.type]:[];
 const match=t=>t==='null'?v===null:t==='array'?Array.isArray(v):t==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):t==='integer'?Number.isInteger(v):typeof v===t;
 if(types.length&&!types.some(match))return false;
 if(typeof v==='string'&&(v.length<(s.minLength??0)||v.length>(s.maxLength??Infinity)))return false;
 if(typeof v==='number'&&(v<(s.minimum??-Infinity)||v>(s.maximum??Infinity)||v<=(s.exclusiveMinimum??-Infinity)||v>=(s.exclusiveMaximum??Infinity)||s.multipleOf&&Math.abs(v/s.multipleOf-Math.round(v/s.multipleOf))>1e-9))return false;
 if(Array.isArray(v)){if(v.length<(s.minItems??0)||v.length>(s.maxItems??Infinity)||s.items&&v.some(x=>!valid(x,s.items,root)))return false;}
 else if(v&&typeof v==='object'){if((s.required??[]).some(k=>!Object.hasOwn(v,k)))return false;for(const [k,x] of Object.entries(v)){const sub=s.properties?.[k];if(sub&&!valid(x,sub,root))return false;if(!sub&&(s.additionalProperties===false||typeof s.additionalProperties==='object'&&!valid(x,s.additionalProperties,root)))return false;}}
 return true;
}
export function choose(boundary,schema) {
 if(Object.hasOwn(boundary,'replay'))return {source:'REPLAY',...boundary.replay};
 try{const value=minimal(schema??boundary.schema??(boundary.type?{type:boundary.type}:null));return {source:'SCHEMA_MINIMAL',value,exitCode:0};}
 catch(e){return {source:'BOUNDARY_STUB_FAILED',exitCode:boundary.failure?.exitCode??70,stderr:boundary.failure?.message??'BOUNDARY_STUB_FAILED',reason:e.message};}
}
function inputs(argv,declared,cwd) {
 const candidates=[...declared,...argv.filter(x=>typeof x==='string'&&!x.startsWith('-')).map(x=>path.resolve(cwd,x))],files=[],directories=[],seen=new Set();
 for(const p0 of candidates){const p=path.resolve(cwd,p0);if(seen.has(p)||!fs.existsSync(p))continue;seen.add(p);const s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('Linked boundary input: '+p);
 if(s.isDirectory())directories.push(snapshot(p));else if(s.isFile()){const b=fs.readFileSync(p);files.push({path:p,sha256:hash(b),bytes:b.length,contentBase64:b.toString('base64')});}}
 return {files,directories};
}
export async function main() {
 const c=JSON.parse(fs.readFileSync(process.env.INSTRUMENT_CONFIG,'utf8'));
 const invocation=JSON.parse(Buffer.from(process.env.TRACE_BOUNDARY_CALL,'base64').toString('utf8'));
 const boundary=c.boundaries.find(b=>b.id===invocation.boundaryId);if(!boundary)throw Error('Boundary declaration missing');
 const started=Date.now(),sessionId=crypto.randomUUID(),destination=path.join(c.eventsDirectory,'boundary-'+process.pid+'.jsonl');
  const received={schema:'boundary-snapshot-v1',id:boundary.id,sessionId,pid:process.pid,argv:invocation.argv,cwd:invocation.cwd,envNames:invocation.envNames,startedAt:new Date().toISOString(),state:'WAITING_INPUT',responses:[],messages:[],exitCode:null,productFailure:false};
  fs.appendFileSync(destination,JSON.stringify({kind:'boundary-lifecycle',phase:'received',decision:'STUB',receipt:received})+'\n');
  const before=inputs(invocation.argv.slice(1),[...(boundary.inputPaths??[]),...(boundary.snapshotDirectories??[]),...(boundary.snapshotCwd?[invocation.cwd]:[])],invocation.cwd);
 const receipt={...received,schema:'boundary-snapshot-v1',id:boundary.id,argv:invocation.argv,cwd:invocation.cwd,envNames:invocation.envNames,
 startedAt:new Date().toISOString(),before,stdin:'',messages:[],responses:[],exitCode:null,elapsedMs:null,internalStepsObserved:false};
 const checkpoint=phase=>fs.appendFileSync(destination,JSON.stringify({kind:'boundary-lifecycle',phase,decision:'STUB',receipt})+'\n');
 let saved=false,callerEnded=false,threadNumber=0,turnNumber=0,threadId=null;
 const finish=code=>{if(saved)return;saved=true;receipt.exitCode=code;receipt.terminationStatus=callerEnded?'CALLER_ENDED':receipt.terminationStatus??'STUB_EXIT';receipt.prematureExit=boundary.sessionMode==='caller'&&!callerEnded;receipt.productFailure=false;receipt.elapsedMs=Date.now()-started;receipt.after=before.directories.map(d=>snapshot(d.root));
 fs.appendFileSync(destination,JSON.stringify({kind:'boundary',phase:'success',decision:'STUB',receipt})+'\n');};
 process.on('exit',code=>finish(code));process.on('SIGTERM',()=>{receipt.observedState=receipt.state;receipt.state='FORCED_TERMINATION';receipt.terminationStatus='SIGNAL_TERMINATION';finish(143);process.exit(143);});
 const outputPath=boundary.outputFileFlag?invocation.argv[invocation.argv.indexOf(boundary.outputFileFlag)+1]:null;
 if(boundary.protocol==='jsonl'){
 const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 for await(const line of rl){receipt.stdin+=line+'\n';let request;try{request=JSON.parse(line);}catch{receipt.responses.push({source:'BOUNDARY_STUB_FAILED',reason:'Invalid JSONL'});continue;}
 receipt.messages.push(request);if(request.params?.cwd&&fs.existsSync(request.params.cwd)){const snap=snapshot(request.params.cwd);if(!receipt.before.directories.some(d=>d.root===snap.root))receipt.before.directories.push(snap);}const rule=boundary.methods?.[request.method];
 if(!rule){if(request.id!==undefined){process.stdout.write(JSON.stringify({id:request.id,error:{code:-32601,message:'BOUNDARY_STUB_FAILED'}})+'\n');receipt.responses.push({source:'BOUNDARY_STUB_FAILED',method:request.method});}continue;}
 const response=choose(rule,rule.schemaFrom?get(request,rule.schemaFrom):undefined);
 receipt.responses.push({method:request.method,...response});
 if(request.method==='thread/start')threadId=sessionId+':thread:'+ ++threadNumber;
  if(request.method==='thread/resume')threadId=request.params?.threadId??threadId??sessionId+':thread:'+ ++threadNumber;
  const turnId=sessionId+':turn:'+ ++turnNumber;
  const context={request,value:response.value,valueJson:JSON.stringify(response.value),result:response.value,sessionId,threadId,turnId};
 const expand=v=>typeof v==='string'&&/^\$\{.+\}$/.test(v)?get(context,v.slice(2,-1)):Array.isArray(v)?v.map(expand):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,expand(x)])):v;
 if(request.id!==undefined){const result=rule.result===undefined?response.value:expand(rule.result);process.stdout.write(JSON.stringify(response.source==='BOUNDARY_STUB_FAILED'?{id:request.id,error:{code:-32000,message:response.stderr}}:{id:request.id,result})+'\n');}
 for(const event of rule.notifications??[])process.stdout.write(JSON.stringify(expand(event))+'\n');
 receipt.state='RESPONDED';checkpoint('responded');
  if(rule.finish&&boundary.sessionMode!=='caller'){receipt.terminationStatus='DECLARED_EARLY_EXIT';finish(response.exitCode??0);setTimeout(()=>process.exit(response.exitCode??0),50);break;}
 }
 callerEnded=true;finish(0);return;
 }
 if(boundary.stdinMode!=='ignore')for await(const chunk of process.stdin)receipt.stdin+=chunk.toString('utf8');
 let schema=boundary.schema;
 if(boundary.schemaFileFlag&&invocation.argv.includes(boundary.schemaFileFlag))schema=JSON.parse(fs.readFileSync(path.resolve(invocation.cwd,invocation.argv[invocation.argv.indexOf(boundary.schemaFileFlag)+1]),'utf8'));
 const response=choose(boundary,schema);receipt.responses.push(response);
 const stdout=response.stdout??(Object.hasOwn(response,'value')?(boundary.rawString&&typeof response.value==='string'?response.value:JSON.stringify(response.value))+'\n':'');
 if(boundary.outputArtifacts){const spec=boundary.outputArtifacts,index=invocation.argv.indexOf(spec.rootFlag);if(index<0)throw Error('Output root flag missing');const root=path.resolve(invocation.cwd,invocation.argv[index+1]);for(const row of spec.files){const file=path.resolve(root,row.path);if(path.relative(root,file).startsWith('..')||path.isAbsolute(row.path))throw Error('Output artifact escape');const chosen=choose(row);receipt.responses.push({artifact:row.path,...chosen});if(chosen.source==='BOUNDARY_STUB_FAILED')throw Error(chosen.stderr);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(chosen.value)+'\n','utf8');}}
 if(outputPath&&invocation.argv.includes(boundary.outputFileFlag))fs.writeFileSync(path.resolve(invocation.cwd,outputPath),stdout,'utf8');
 if(response.stderr)process.stderr.write(response.stderr+'\n');process.stdout.write(stdout);
 receipt.state='RESPONDED';checkpoint('responded');callerEnded=true;finish(response.exitCode??0);process.exitCode=response.exitCode??0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node boundary-stub.mjs (INSTRUMENT_CONFIG and TRACE_BOUNDARY_CALL environment required)");process.exit(0);}
try{await main();}catch(e){console.error(e.message);process.exitCode=1;}}

