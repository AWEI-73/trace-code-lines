import {gapList,normalizeGap} from './gap-shape.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {inside,noLinks,digest} from './instrument.mjs';
import {runOnce} from './run-once.mjs';
import {contract} from './contract.mjs';
import {execFileSync} from 'node:child_process';
import {readBounded} from './walker.mjs';
import {languageEdges} from './language-static.mjs';
const save=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n','utf8');
const expand=(v,bindings)=>typeof v==='string'?Object.entries(bindings).reduce((s,[k,x])=>s.split(String.fromCharCode(36,123)+k+'}').join(x),v):Array.isArray(v)?v.map(x=>expand(x,bindings)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,expand(x,bindings)])):v;
function copy(source,dest){noLinks(source);fs.cpSync(source,dest,{recursive:true,filter:p=>{if(fs.lstatSync(p).isSymbolicLink())throw Error('Linked trial source');return true;}});}
export async function removalTrial(c,{enable=false,evaluate}={}) {
 for(const p of [c.sourceClone,c.trialsRoot,c.output])noLinks(p);
 if(!path.isAbsolute(c.sourceClone)||!path.isAbsolute(c.trialsRoot)||inside(c.sourceClone,c.trialsRoot)||inside(c.trialsRoot,c.sourceClone))throw Error('Trial clones require a disjoint absolute root');
 const paths=c.candidates.map(x=>typeof x==='string'?x:x.path);
 if(new Set(paths).size!==paths.length)throw Error('Duplicate removal candidate');
 for(const p of paths){if(path.isAbsolute(p)||!inside(c.sourceClone,path.resolve(c.sourceClone,p))||p==='.'||p==='')throw Error('Candidate escaped clone');noLinks(path.resolve(c.sourceClone,p));}
 if(!c.validations?.length)throw Error('Disclosed nonempty validation set required');
  const rows=paths.map(p=>({path:p,status:'NOT_TRIED'})),attempts=[];
 const report={schema:'removal-trial-v1',contract:{...contract('EXECUTION',[],[{name:'REMOVAL_TRIAL',semantics:'DISCLOSED_VALIDATION_SET_ONLY'}]),mode:'RUN_ONCE_STUBBED'},candidates:rows,validations:c.validations,attempts,
  claim:'Removal trial passed only under the disclosed validation set; no deletion authorization or universal safety claim.'};
  report.referrerScan={status:'PASS',scope:'git tracked files; filename/relative-path literals and lexical Python imports',gaps:gapList()};
  for(const row of rows)row.knownReferrers=[];
  try{
    const tracked=execFileSync('git',['-C',c.sourceClone,'ls-files','-z'],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},stdio:['ignore','pipe','pipe']}).split('\0').filter(Boolean);
    const inventory=new Map(tracked.map(p=>[p,{}]));
    const covered=file=>c.validations.filter(v=>(v.coveredFiles??[]).includes(file)||(v.runOnce?.command??[]).some(arg=>arg===file||arg==='${CLONE}/'+file||arg===path.join(c.sourceClone,file))).map(v=>v.id);
    for(const file of tracked){
      let text;try{text=readBounded(c.sourceClone,file).toString('utf8');}catch(e){report.referrerScan.gaps.push({path:file,message:e.message});continue;}
      if(file.endsWith('.py')){
        const parsed=languageEdges(file,text,{rows:inventory,read:p=>readBounded(c.sourceClone,p).toString('utf8'),sourceRoots:c.pythonSourceRoots??['.','src']});
        for(const edge of parsed.edges.filter(e=>['STATIC_IMPORT','DYNAMIC_LITERAL'].includes(e.kind)))for(const row of rows){
          if(file===row.path||!edge.targets.includes(row.path))continue;
          const coveredBy=covered(file);row.knownReferrers.push({path:file,line:edge.line,literal:edge.specifier,kind:edge.kind,coveredBy,coverageBasis:coveredBy.length?'DECLARED_FILE_OR_DIRECT_COMMAND':'UNKNOWN'});
        }
        for(const g of parsed.gaps.filter(g=>/^(?:DYNAMIC_COMPUTED|PYTHON_(?:DYNAMIC|IMPORT|RELATIVE|STAR|SYS_PATH|AMBIGUOUS))/.test(g.code))){
          const coveredBy=covered(file);report.referrerScan.gaps.push({...g,coveredBy});
          if(!coveredBy.length)for(const row of rows)if(file!==row.path)row.knownReferrers.push({path:file,line:g.line,kind:'UNRESOLVED_PYTHON_IMPORT',candidate:true,detail:g.detail,coveredBy:[],coverageBasis:'UNKNOWN'});
        }
      }
      for(const [index,line] of text.split(/\r?\n/).entries())for(const literal of line.matchAll(/(['"`])([^'"`\r\n]+)\1/g)){
        const value=literal[2].replaceAll('\\','/');
        for(const row of rows){
          if(file===row.path)continue;
          const rel=path.posix.relative(path.posix.dirname(file),row.path);
          if(![row.path,path.posix.basename(row.path),rel,'./'+rel].includes(value))continue;
          const coveredBy=c.validations.filter(v=>(v.coveredFiles??[]).includes(file)||(v.runOnce?.command??[]).some(arg=>arg===file||arg==='${CLONE}/'+file||arg===path.join(c.sourceClone,file))).map(v=>v.id);
          row.knownReferrers.push({path:file,line:index+1,literal:value,coveredBy,coverageBasis:coveredBy.length?'DECLARED_FILE_OR_DIRECT_COMMAND':'UNKNOWN'});
        }
      }
    }
  }catch(e){report.referrerScan.gaps.push({message:e.message});}
  if(report.referrerScan.gaps.length)report.referrerScan.status='UNKNOWN';
  for(const row of rows){row.uncoveredReferrers=row.knownReferrers.filter(r=>!r.coveredBy.length);row.validationStrength=row.uncoveredReferrers.length?'WEAK_VALIDATION_SET':report.referrerScan.status==='UNKNOWN'?'UNKNOWN':'DISCLOSED_VALIDATION_SET_ONLY';}
 if(!enable)return report;
 fs.mkdirSync(c.trialsRoot,{recursive:true});let number=0;
 const suite=async group=>{
 if(number>=(c.maxTrials??32))return null;
 const id=++number,base=path.join(c.trialsRoot,'trial-'+id),clone=path.join(base,'clone'),temp=path.join(base,'temp');
 if(fs.existsSync(base))throw Error('Trial path exists');fs.mkdirSync(base);copy(c.sourceClone,clone);fs.mkdirSync(temp);
 const removed=[];for(const p of group){const q=path.resolve(clone,p);noLinks(q);if(!inside(clone,q)||q===clone)throw Error('Unsafe removal');
 if(!fs.existsSync(q))return {id,group,status:'UNKNOWN',reason:'Candidate missing from source: '+p,results:[]};
 if(!fs.statSync(q).isFile())throw Error('Only regular-file candidates supported');removed.push({path:p,sha256:digest(fs.readFileSync(q))});fs.unlinkSync(q);}
 const results=[];
 for(let i=0;i<c.validations.length;i++){
 const validation=c.validations[i],bindings={CLONE:clone,TEMP:temp,HOME:path.join(temp,'home-'+i),OUTPUT:path.join(temp,'evidence-'+i)};
 let r;try{
 if(evaluate)r=await evaluate({clone,temp,group,validation,index:i});
 else {const config=expand(validation.runOnce,bindings);const out=await runOnce({...config,clone,tempRoot:temp,isolationRoot:bindings.HOME,outputDirectory:bindings.OUTPUT},{enable:true});
 r={status:out.status==='FAIL'?'FAIL':out.processStatus,resultJudgment:out.resultJudgment,validationBasis:'Declared validation command exit and boundary evidence only',gaps:out.gaps,exitCode:out.target.exitCode,stderr:out.target.stderr,evidence:bindings.OUTPUT+'.result.json'};}
 }catch(e){r={status:'FAIL',gaps:[normalizeGap({kind:'VALIDATION_EXCEPTION',message:e.message})],stderr:e.stack};}
 const locator=String(r.stderr??'').match(/(?:file:\/\/\/)?([A-Za-z]:[\\/][^\r\n()]+?\.(?:mjs|cjs|js|py)):(\d+)/);
 results.push({id:validation.id,...r,firstLocation:r.firstLocation??(locator?{file:locator[1],line:Number(locator[2])}:null)});
 }
 const attempt={id,group,clone,removed,results,status:results.every(r=>r.status==='PASS')?'PASS':'FAIL'};attempts.push(attempt);save(path.join(base,'receipt.json'),attempt);return attempt;
 };
 const baseline=await suite([]);report.baseline=baseline;
 if(!baseline||baseline.status!=='PASS'){report.status='UNKNOWN';report.reason='Baseline validation did not pass; candidates remain NOT_TRIED';save(c.output,report);return report;}
 const baselineGaps=new Map(baseline.results.map(r=>[r.id,new Set((r.gaps??[]).map(g=>JSON.stringify(g)))]));
 async function test(group){
 const attempt=await suite(group);if(!attempt)return;
 const first=attempt.results.find(r=>r.status!=='PASS'||(r.gaps??[]).some(g=>!baselineGaps.get(r.id).has(JSON.stringify(g))));
  if(!first&&attempt.status==='PASS'){for(const p of group){const row=rows.find(r=>r.path===p);Object.assign(row,{status:row.uncoveredReferrers.length?'WEAK_VALIDATION_SET':'REMOVAL_TRIAL_PASS',trial:attempt.id,validationSet:c.validations.map(v=>v.id)});}return;}
 if(group.length>1){const mid=Math.ceil(group.length/2);await test(group.slice(0,mid));await test(group.slice(mid));}
 else Object.assign(rows.find(r=>r.path===group[0]),{status:'REMOVAL_TRIAL_BREAKS',trial:attempt.id,firstFailure:first??{reason:attempt.reason},location:first?.firstLocation??null,locationStatus:first?.firstLocation?'PASS':'UNKNOWN'});
 }
 if(paths.length)await test(paths);
  report.processStatus=rows.some(r=>r.status==='NOT_TRIED')?'UNKNOWN':'PASS';report.candidateStatus=rows.some(r=>r.status==='REMOVAL_TRIAL_BREAKS')?'FAIL':rows.some(r=>r.status!=='REMOVAL_TRIAL_PASS')?'UNKNOWN':'PASS';report.status=report.candidateStatus==='FAIL'?'FAIL':rows.some(r=>r.status==='WEAK_VALIDATION_SET')?'WEAK_VALIDATION_SET':report.candidateStatus;save(c.output,report);return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node removal-trial.mjs --config file [--enable]");process.exit(0);}
const a=process.argv.slice(2);try{console.log(JSON.stringify(await removalTrial(JSON.parse(fs.readFileSync(a[a.indexOf('--config')+1],'utf8')),{enable:a.includes('--enable')}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
