import {configSource} from './contract.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {census} from './record-census.mjs';
const get=(v,k)=> (Array.isArray(k)?k:k.split('.')).reduce((v,p)=>v?.[p],v);
export function skeletons(config) {
  const result=census({...config,retainEvents:true}), routes=new Map();
  const keys=config.skeletonFields??[config.typeKey];
  for(const job of result.jobs) {
    const events=[...job.events];
    if(config.sequenceKey) {
      if(events.some(e=>typeof get(e.value,config.sequenceKey)!=='number')) result.gaps.push({kind:'SEQUENCE_UNKNOWN',path:job.directory});
      else events.sort((a,b)=>get(a.value,config.sequenceKey)-get(b.value,config.sequenceKey));
    }
    const steps=events.map(e=>keys.map(k=>get(e.value,k)??null));
    const skeleton=steps.filter((s,i)=>!i||JSON.stringify(s)!==JSON.stringify(steps[i-1]));
    const key=JSON.stringify([job.population,skeleton]);
    if(!routes.has(key))routes.set(key,{population:job.population,label:job.populationLabel,skeleton,runs:0,versions:{},jobs:[]});
    const row=routes.get(key);row.runs++;const version=JSON.stringify(job.binding.value);row.versions[version]=(row.versions[version]??0)+1;
    row.jobs.push({directory:job.directory,events:events.length,binding:job.binding});
  }
  result.contract.metrics.push({layer:'RECORD',selector:'routes[*].runs|versions.*|jobs[*].events',populationFrom:'population',unit:'records per skeleton/version; events per job'});
  return {...result,schema:'route-skeletons-v1',status:result.gaps.length?'PARTIAL':'PASS',routes:[...routes.values()].sort((a,b)=>b.runs-a.runs),
    limitations:[...result.limitations,'Adjacent identical steps collapse; runs count records, not event repetitions. Ordering uses sequenceKey or sorted file/line order.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node route-skeletons.mjs --config file");process.exit(0);}

  try{if(process.argv[2]!=='--config'||process.argv.length!==4)throw Error('Usage: route-skeletons.mjs --config file');
    const r=skeletons(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));configSource(r,process.argv[3]);console.log(JSON.stringify(r,null,2));if(r.gaps.length)process.exitCode=2;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
