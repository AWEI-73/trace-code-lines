import fs from 'node:fs';
import assert from 'node:assert/strict';
import {join,relative,resolve,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildChainCard,renderChainCard} from './chain-card.mjs';
import {startTrace,inspectTrace,playbooks,fillTrace} from './trace.mjs';
import {buildReport as buildTraceReport} from './trace-report-html.mjs';
import {sha256} from './walker.mjs';

export function integrateHandoffChecks(root){
 const checks=[],area=join(root,'integrate-handoff'),repo=join(area,'tool'),source=join(repo,'contract.md'),file=join(area,'card.json');
 fs.mkdirSync(repo,{recursive:true});
 const contents='Keep asset identity and range.\ncompile_clip requires assetId and in/out.\nWorks with supplied MP4 files.\n';
 fs.writeFileSync(source,contents);
 const cli=fileURLToPath(new URL('./trace.mjs',import.meta.url));
 const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',windowsHide:true});
 const ok=(...args)=>{const r=run(...args);assert.equal(r.status,0,r.stderr+r.stdout);return r;};
 const fill=(...args)=>['fill','--card',file,'--step','6',...args];
 const rejectFill=(reason,...args)=>{
  const before=fs.readFileSync(file),r=run(...fill(...args));
  assert.equal(r.status,1,r.stderr);assert.match(r.stderr,reason);assert.equal(r.stdout,'');
  assert(!/\n\s+at /.test(r.stderr));assert.deepEqual(fs.readFileSync(file),before);
 };
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
 const check=(name,fn)=>{fn();checks.push('integrate handoff: '+name);};
 const route={consumes:['mp4'],produces:['mp4'],executionClass:'unknown',maturity:'experimental',avoidWhen:['No readable source','Request is text-to-video <script>'],unknownReason:'The live engine has not been observed'};
 const know='invariant|Keep source identity|Tool uses assetId and in/out|Compare every clip to its source';
 const pin='mcp|compile_clip|Requires assetId and in/out|Read the live schema and compare required fields';
 const a1='contract.md:1:Keep asset identity',a2='contract.md:2:requires assetId',a3='contract.md:3:supplied MP4';
 const report=card=>buildTraceReport({card,triage:[],generatedAt:'2026-11-19T01:00:00Z'});
 ok('start','--mode','integrate','--question','Can this editor be integrated?','--root',repo,'--out',file);
 check('legacy integrate retains its section shape and renders without new headings',()=>{
  const c=read(file);assert.equal(c.steps.length,8);
  for(const [id,flag] of [['D2','--compat-pin'],['D6','--knowhow'],['D6','--routing'],['D8','export-integrate']])assert(JSON.stringify(playbooks.modes.integrate.steps.find(s=>s.id===id)).includes(flag));
  const card=buildChainCard(c),{html,machine}=report(c);
  assert.equal(card.anchorReview.status,'PASS');
  assert(!Object.hasOwn(inspectTrace(c),'integrateFields'));
  assert.deepEqual(Object.keys(card.integration),['decision','anchors','conditions','permissions','interfaces']);
  assert.match(renderChainCard(card),/⑥ 接入結論/);assert(!Object.hasOwn(machine,'integration'));
  for(const title of ['領域知識與驗證規則','轉接介面與相容性釘選','能力與路由邊界']){
   assert(!html.includes(title));assert(!renderChainCard(card).includes(title));
  }
  const out=join(area,'legacy.json');ok('export-integrate','--card',file,'--out',out);
  const data=read(out);assert.deepEqual([data.knowhow,data.compatPins,data.routing,data.unknowns],[[],[],null,[]]);
 });
 check('fill rolls back a valid note and skip when routing JSON or a normal anchor fails',()=>{
  // Preserve noncanonical whitespace too, so parsing and rewriting cannot pass this check.
  fs.writeFileSync(file,' \r\n'+fs.readFileSync(file,'utf8'));
  rejectFill(/--routing.*JSON/,'--note','Must not save','--routing','{bad','--skip');
  rejectFill(/--anchor.*ANCHOR_MISMATCH/,'--note','Must not save','--anchor','contract.md:1:absent');
  assert.equal(read(file).steps[5].status,'pending');
 });
 check('fill verifies multiple anchors, appends each record, and keeps routing arrays',()=>{
  ok(...fill('--knowhow',know,'--anchor','contract.md:2:Keep asset identity','--anchor',a2,
   '--knowhow',know.replace('invariant','verification'),'--anchor',a1,
   '--compat-pin',pin,'--anchor',a2,'--routing',JSON.stringify(route),'--anchor',a3,
   '--unknown','Live engine version|not-run|Local engine not launched|Read saved schema|Probe the live engine|隔離試跑|Saved schema describes its snapshot|yes'));
  const c=read(file),r=c.integration;
  assert.equal(r.knowhow.length,2);assert.equal(r.knowhow[0].anchors.length,2);
  assert.equal(r.knowhow[0].anchors[0].line,1);assert.equal(r.knowhow[0].anchors[0].requestedLine,2);
  assert.equal(r.knowhow[0].anchors[0].sha256,sha256(Buffer.from(contents)));assert.equal(r.compatPins[0].surface,'mcp');
  assert.deepEqual(r.routing.avoidWhen,route.avoidWhen);
  assert.equal(c.steps[5].sectionAnchors,5);assert.equal(inspectTrace(c).anchors.length,3);
  assert.match(ok('status','--card',file).stdout,/錨點通過 3／3 個/);
 });
 check('routing file accepts UTF-8 BOM, spaces and trailing flags and is exclusive with inline JSON',()=>{
  const routing=join(area,'routing with spaces.json'),json=JSON.stringify(route);
  fs.writeFileSync(routing,'\uFEFF'+json+'\r\n','utf8');
  const inline=['--routing',json],fromFile=['--routing-file',routing];
  rejectFill(/--routing-file.*--routing.*擇一/,...fromFile,...inline);
  rejectFill(/--routing-file.*--routing.*擇一/,...inline,...fromFile);
  rejectFill(/--routing-file.*ENOENT/,'--routing-file',join(area,'missing routing.json'),'--note','Must not save');
  rejectFill(/--routing-file.*路徑/,'--routing-file','--note','Must not save');
  const bad=join(area,'bad routing.json');fs.writeFileSync(bad,JSON.stringify({...route,avoidWhen:[]}));
  rejectFill(/--routing-file.*avoidWhen/,'--routing-file',bad,'--anchor',a3);
  ok(...fill(...fromFile,'--note','Read routing file','--anchor',a3));
  const c=read(file);
  assert.deepEqual(c.integration.routing,{...route,anchors:[{file:'contract.md',line:3,expect:'supplied MP4',sha256:sha256(Buffer.from(contents)),status:'PASS'}]});
  assert.equal(c.steps[5].notes,'Read routing file');assert.deepEqual(c.steps[5].anchors,[]);
 });
 check('fill rejects missing, forged, malformed and out-of-root anchors and invalid enums without saving any fields',()=>{
  for(const [flag,value,anchor,reason] of [
   ['--knowhow',know,null,/--anchor/],['--compat-pin',pin,null,/--anchor/],
   ['--knowhow',know,'contract.md:2:absent',/錨點不符/],
   ['--compat-pin',pin,'../contract.md:1:Keep asset identity',/錨點不符/],
   ['--compat-pin',pin,'contract.md:0:assetId',/正整數/],
   ['--knowhow',know.replace('invariant','invalid'),a1,/kind 無效.*preflight/],
   ['--compat-pin',pin.replace('mcp','invalid'),a2,/surface 無效.*local-process/],
   ['--routing',JSON.stringify({...route,executionClass:'invalid'}),null,/executionClass 無效/],
   ['--routing',JSON.stringify({...route,maturity:'invalid'}),null,/maturity 無效/],
   ['--routing',JSON.stringify({...route,avoidWhen:[]}),null,/avoidWhen/],
   ['--routing',JSON.stringify({...route,consumes:'mp4'}),null,/consumes/],
   ['--routing',JSON.stringify({...route,unknownReason:''}),null,/unknownReason/],
   ['--routing','{bad',null,/JSON/],
  ]){
   rejectFill(reason,flag,value,...(anchor?['--anchor',anchor]:[]));
  }
  // The CLI now discards valid claims on either side of an error in the same fill.
  rejectFill(/--knowhow.*ANCHOR_MISMATCH/,'--compat-pin',pin,'--anchor',a2,'--knowhow',know,'--anchor',a1,'--anchor','contract.md:1:forged','--routing',JSON.stringify({...route,executionClass:'hybrid',unknownReason:undefined}));
 });
 check('new sections are integrate-only',()=>{
  const other=startTrace('change','Other question',repo),errors=[];
  fillTrace(other,['--step','1','--knowhow',know,'--anchor',a1,'--compat-pin',pin,'--anchor',a2,'--routing',JSON.stringify(route)],errors);
  assert.equal(errors.filter(e=>e.includes('期望接入情境')).length,3);
  assert.equal(other.integration,undefined);assert.equal(other.steps[0].status,'pending');
  const out=join(area,'other-export.json'),otherFile=join(area,'other-card.json');fs.writeFileSync(otherFile,JSON.stringify(other));
  assert.equal(run('export-integrate','--card',otherFile,'--out',out).status,1);assert(!fs.existsSync(out));
 });
 check('report CLI writes Markdown and HTML and export retains source, pins and UNKNOWN',()=>{
  const out=join(area,'report.html'),handoff=join(area,'handoff.json');
  ok('report','--card',file,'--out',out);ok('export-integrate','--card',file,'--out',handoff);
  const md=fs.readFileSync(join(area,'report-evidence','chain','chain-card.md'),'utf8'),html=fs.readFileSync(out,'utf8');
  for(const value of ['可移植規則','工具細節','驗證方式','釘選預期','漂移檢查','不適用時機','No readable source','UNKNOWN 原因','contract.md:2','Local engine not launched']){
   assert(md.includes(value),value);assert(html.includes(value),value);
  }
  assert(md.includes('text-to-video &lt;script&gt;'));assert(html.includes('text-to-video &lt;script&gt;'));
  const machine=JSON.parse(html.match(/<script[^>]*id="trace-report"[^>]*>([\s\S]*?)<\/script>/)[1]),data=read(handoff),raw=read(file);
  assert.deepEqual(Object.keys(data),['schema','source','knowhow','compatPins','routing','unknowns']);
  assert.equal(data.schema,'trace-integrate-handoff-v1');
  assert.equal(data.source.root,repo);assert.equal(data.source.version.running,'UNKNOWN');assert(data.source.version.runningCause);
  assert.deepEqual(data.knowhow,machine.integration.knowhow);assert.deepEqual(data.compatPins,machine.integration.compatPins);
  assert.deepEqual(data.knowhow[0].anchors[1],data.compatPins[0].anchors[0]);
  assert.deepEqual(machine.anchors,{pass:3,total:3});
  assert.deepEqual(data.routing,{...route,anchors:raw.integration.routing.anchors});
  assert.deepEqual(data.unknowns,[{...raw.unknowns[0],status:'UNKNOWN'}]);
  assert.equal(run('export-integrate','--card',file,'--out',handoff).status,1);
  assert.equal(run('export-integrate','--card',file,'--out',join(repo,'handoff.json')).status,1);
  assert.deepEqual(read(handoff),data);
 });
 check('card-verified anchors are read back and drift or invalid hand-edited fields prevent export',()=>{
  const c=read(file),verified=c.integration.compatPins[0].anchors[0];
  c.integration.compatPins[0].anchor=verified;delete c.integration.compatPins[0].anchors;
  assert.equal(buildChainCard(c).integration.compatPins[0].anchors[0].status,'PASS');
  const tampered=join(area,'tampered.json'),out=join(area,'rejected.json');
  c.integration.knowhow[0].kind='invented';fs.writeFileSync(tampered,JSON.stringify(c));
  assert.match(run('export-integrate','--card',tampered,'--out',out).stderr,/kind 無效/);
  fs.writeFileSync(source,contents.replace('requires assetId','changed schema'));
  assert.equal(buildChainCard(read(file)).anchorReview.status,'ANCHOR_MISMATCH');
  assert.match(report(read(file)).html,/錨點不符/);
  assert.match(run('export-integrate','--card',file,'--out',out).stderr,/來源錨點或錨點不符/);
  assert(!fs.existsSync(out));
 });
 return checks;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.length===3&&process.argv[2]==='--help'){console.log('Usage: node integrate-self-test.mjs (equal external TEMP/TMP required)');process.exit(0);}
 const temp=process.env.TEMP;
 assert(temp&&process.env.TMP===temp,'Set TEMP and TMP to the same external directory');
 const root=fs.mkdtempSync(join(temp,'integrate-self-test-'));
 try{console.log(JSON.stringify({status:'PASS',synthetic:true,checks:integrateHandoffChecks(root)}));}
 finally{const r=relative(resolve(temp),resolve(root));assert(r&&!r.startsWith('..')&&!isAbsolute(r)&&r.startsWith('integrate-self-test-'));fs.rmSync(resolve(root),{recursive:true,force:true});}
}
