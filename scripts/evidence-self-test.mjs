import cp from 'node:child_process';
import {versionChain} from './version-chain.mjs';
import {census} from './record-census.mjs';
import {trace} from './trace-one-job.mjs';
import {analyze,tempLayout} from './derive-map.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {classifyRecords} from './classify-records.mjs';
export function evidenceChecks(root){
  fs.mkdirSync(root,{recursive:true});
  const put=(p,v)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v),'utf8');return f;};
  put('jobs/a.json',{id:'a',event:'one',text:'ordinary'});put('jobs/b.json',{id:'b',event:'two',text:'test'});
  put('intents/a.json',{job:'a',event:'WRONG',kind:'real'});put('intents/b.json',{job:'b',event:'two',kind:'test'});
  const exact={join:{store:'intents',on:[{record:'id',foreign:'job'},{record:'event',foreign:'event'}],where:{key:'kind',op:'prefix',value:'test'}}};
  const c={records:{root:path.join(root,'jobs'),pattern:'[.]json$'},stores:{intents:{root:path.join(root,'intents')}},classes:[{name:'joined',when:exact},{name:'text',when:{key:'text',op:'regex',value:'^test$'}}]};
  const r=classifyRecords(c);assert.equal(r.records.find(x=>x.id==='a').classification,'UNKNOWN');assert.equal(r.records.find(x=>x.id==='b').classification,'AMBIGUOUS');
  assert.equal(r.contract.layer,'RECORD');assert.equal(r.contract.populations[0].semantics,'CLASSIFIED');assert(r.contract.sources.every(s=>s.sha256.length===64));

  const current=put('chain/current.json',{config:'active.json'});put('chain/active.json',{version:'new'});
  const chain=versionChain({allowedRoots:[path.join(root,'chain')],hops:[{id:'pointer',file:current},{id:'active',file:path.join(root,'chain')+'/$'+'{pointer.config}',key:'version'},{id:'missing',file:path.join(root,'chain','absent.json')},{id:'refused',file:path.join(root,'jobs','a.json')}]});
  assert.equal(chain.hops[1].value,'new');assert.equal(chain.hops[2].status,'UNKNOWN');assert(chain.gaps.some(g=>g.code==='PATH_REFUSED'));assert(!chain.contract.sources.some(s=>s.path===path.join(root,'jobs','a.json')));assert.equal(chain.contract.layer,'VERSION');
  put('records/pop/a/job.json',{id:'a',basis:{config:'old',core:{version:'1'}}});put('records/pop/b/job.json',{id:'b',basis:{config:'older',core:{version:'1'}}});
  for(const id of ['a','b']){put('records/pop/'+id+'/current.json',{version:'new'});put('records/pop/'+id+'/events/one.json',{type:'read'});}
  const cc={root:path.join(root,'records'),recordPattern:'job[.]json$',eventsDirectory:'events',eventFilePattern:'[.]json$',mode:'one-json-per-file',typeKey:'type',crossFields:['type'],trigger:{type:'read'},binding:{relativePath:'current.json',key:'version'},recordVersion:{keys:['basis.config','basis.core']}};
  const history=census(cc);assert.equal(history.versions.length,2);assert(history.versions.every(v=>v.versionSource==='RECORDED'));assert.deepEqual(history.versions.map(v=>v.version['basis.config']).sort(),['old','older']);
  const now=census({...cc,recordVersion:undefined});assert.equal(now.versions.length,1);assert.equal(now.versions[0].version,'new');assert.equal(now.versions[0].versionSource,'CURRENT_BINDING_MUTABLE');
  const classified=classifyRecords({records:{root:cc.root,pattern:'job[.]json$'},classes:[{name:'real',when:{key:'id',op:'prefix',value:''}}]});
  const output=put('classes.json',classified);const bound=census({...cc,classificationOutput:output});assert.equal(bound.contract.populations[0].semantics,'CLASSIFIED');assert(bound.contract.sources.some(s=>s.path===output));
  put('records/pop/a/job.json',{id:'a',basis:{config:'changed',core:{version:'1'}}});assert.throws(()=>census({...cc,classificationOutput:output}),/drift/);
  const writer=path.join(root,'writer.txt');fs.writeFileSync(writer,'write(jobDirectory + "/events/one.json")\n','utf8');
  const traced=trace({root:cc.root,job:{relativePath:'pop/a'},stores:[{id:'job',path:'job.json',mode:'one-json-per-file'},{id:'events',path:'events',mode:'one-json-per-file'}],joins:[],writerRoots:[root],pathConventions:[{id:'path',kind:'PATH_CONVENTION',from:'job',to:'events',writer:{file:writer,line:1}}]});
  assert.equal(traced.joins.length,0);assert.equal(traced.pathConventions[0].status,'LOCATED');assert.equal(traced.pathConventions[0].countedAsJoin,false);assert.equal(traced.anomalies.length,0);
  const clone=path.join(root,'clone'),scratch=path.join(root,'scratch');fs.mkdirSync(clone);fs.mkdirSync(scratch);
  fs.writeFileSync(path.join(clone,'entry.mjs'),'export const synthetic = true;\n','utf8');
  const git=args=>cp.execFileSync('git',['-c','core.hooksPath='+scratch,'-C',clone,...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},stdio:['ignore','pipe','pipe']});
  git(['init']);git(['add','entry.mjs']);git(['-c','user.name=Synthetic','-c','user.email=synthetic.invalid','-c','commit.gpgsign=false','commit','-m','synthetic']);
  const fixedTemp=process.env.TEMP,fixedTmp=process.env.TMP;
  const mapConfig={repo:clone,temp:fixedTemp,scratch,roots:['entry.mjs'],classification:{rules:[],fallback:'source'},calibration:null};
  const map=analyze(mapConfig);assert.equal(map.readOnly.status,'PASS');assert.equal(process.env.TEMP,fixedTemp);assert.equal(process.env.TMP,fixedTmp);assert.equal(map.scratch,scratch);
  assert.throws(()=>analyze({...mapConfig,scratch:root}),/Scratch overlaps/);
  assert.throws(()=>tempLayout({...mapConfig,scratch:path.dirname(fixedTemp)}),/below fixed TEMP/);
  assert.throws(()=>analyze({...mapConfig,temp:root}),/Keep process TEMP/);
  assert.equal(process.env.TEMP,fixedTemp);assert.equal(process.env.TMP,fixedTmp);

  return ['version chain templating missing file and refused roots','recorded historical versions override current mutable binding','CLASSIFIED source binding and drift rejection','PATH_CONVENTION separate from recorded joins','fixed TEMP sibling clone and scratch; overlapping scratch refused','classify exact composite join rejects same id with wrong event','classify conflict AMBIGUOUS and unmatched UNKNOWN','classify evidence file/key/value and contract'];
}
