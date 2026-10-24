#!/usr/bin/env node
import {gapList} from './gap-shape.mjs';
import {contract,configSource,classificationBinding} from './contract.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const own = (obj, key) => obj != null && Object.hasOwn(obj, key);
function get(obj, selector) {
  for (const key of Array.isArray(selector) ? selector : selector.split('.')) {
    if (!own(obj, key)) return undefined;
    obj = obj[key];
  }
  return obj;
}
const scalar = value => value !== null && ['string', 'number', 'boolean'].includes(typeof value);
const bucket = value => scalar(value) ? JSON.stringify(value) : 'UNKNOWN';
const increment = (map, key) => { map[key] = (map[key] ?? 0) + 1; };
const inside = (root, file) => {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
};
function validate(c) {
  if (!path.isAbsolute(c.root ?? '')) throw Error('root must be absolute');
  for (const k of ['recordPattern', 'eventsDirectory', 'eventFilePattern', 'typeKey']) {
    if (!c[k] || (typeof c[k] !== 'string' && !(k === 'typeKey' && Array.isArray(c[k])))) throw Error('Missing/invalid ' + k);
  }
  if (!['one-json-per-file', 'jsonl'].includes(c.mode)) throw Error('Unsupported mode');
  if (c.crossFields!==undefined&&!Array.isArray(c.crossFields)) throw Error('crossFields must be an array when supplied');
  if(c.recordVersion){if(!Array.isArray(c.recordVersion.keys)||!c.recordVersion.keys.length)throw Error('recordVersion.keys required');}
  else if (c.binding!==undefined&&(!c.binding?.relativePath || !c.binding.key || path.isAbsolute(c.binding.relativePath))) throw Error('binding requires relativePath and key');
  if (path.isAbsolute(c.eventsDirectory)) throw Error('eventsDirectory must be relative');
  if (c.trigger!==undefined&&(!c.trigger||typeof c.trigger!=='object'||Array.isArray(c.trigger)||!Object.keys(c.trigger).length)) throw Error('trigger must explicitly select events when supplied');
  if(c.codeBinding!==undefined){
    const b=c.codeBinding,commit=v=>typeof v==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(v);
    if(!b||typeof b!=='object'||Array.isArray(b))throw Error('codeBinding must be an object');
    if(b.versions!==undefined){if(!b.versions||typeof b.versions!=='object'||Array.isArray(b.versions)||!Object.keys(b.versions).length||!Object.values(b.versions).every(commit))throw Error('codeBinding.versions must map versions to full commit hashes');}
    else if(!commit(b.head)||typeof b.dirty!=='boolean')throw Error('codeBinding requires head and dirty, or versions');
  }
}
export function census(c,{progress=()=>{}}={}) {
  validate(c);
  progress('census: discovery');
  const root = path.resolve(c.root), gaps=gapList(), records = [], bindings = new Map(), sources=new Map();
  const read=file=>{const bytes=fs.readFileSync(safe(file));sources.set(path.resolve(file),{path:path.resolve(file),sha256:hash(bytes)});return bytes;};
  const recordPattern = new RegExp(c.recordPattern), eventPattern = new RegExp(c.eventFilePattern);
  const excluded = new Set(c.excludeDirectories ?? []);
  const addGap = (kind, file, detail) => gaps.push({kind, path:file, detail});
  if(!c.codeBinding)addGap('CODE_BINDING_UNKNOWN',root,'No caller-supplied code binding; current HEAD is never substituted for historical records.');
  if(!c.crossFields?.length)addGap('CROSS_FIELDS_UNKNOWN',root,'Cross statistics are unavailable without crossFields.');
  if(!c.trigger)addGap('TRIGGER_UNKNOWN',root,'Trigger statistics are unavailable without trigger.');
  // Resolve each component: do not follow links, including a linked ancestor.
  function safe(file) {
    if (!inside(root, file)) throw Error('Path escapes record root');
    const parsed = path.parse(file);
    let at = parsed.root;
    for (const part of file.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      at = path.join(at, part);
      if (fs.lstatSync(at).isSymbolicLink()) throw Error('Symbolic link refused: ' + at);
    }
    return file;
  }
  function discover(dir) {
    let entries;
    try { entries = fs.readdirSync(safe(dir), {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)); }
    catch (e) { addGap('DISCOVERY', dir, e.message); return; }
    const markers = entries.filter(e=>e.isFile() && recordPattern.test(path.relative(root,path.join(dir,e.name)).split(path.sep).join('/')));
    if (markers.length) {
      if (markers.length > 1) addGap('MULTIPLE_RECORD_MARKERS',dir,markers.map(e=>e.name).join(','));
      records.push({directory:dir, marker:path.join(dir,markers[0].name)});
      return; // A record is one leaf unit; nested directories are its contents.
    }
    for (const e of entries) {
      const file = path.join(dir,e.name);
      if (e.isSymbolicLink()) addGap('SYMLINK_SKIPPED',file,'Not followed');
      else if (e.isDirectory() && !excluded.has(e.name)) discover(file);
    }
  }
  const populationInventory = [];
  try { for (const e of fs.readdirSync(safe(root),{withFileTypes:true})) {
    if (e.isDirectory()) populationInventory.push({directory:e.name,label:c.populations?.[e.name]??'UNKNOWN'});
  }} catch(e) { addGap('POPULATION_DISCOVERY',root,e.message); }
  discover(root);
  progress('census: records and events');
  const classification=classificationBinding(c.classificationOutput,records.map(r=>r.marker));
  if(classification)sources.set(classification.path,{path:classification.path,sha256:classification.sha256});
  const typeCounts = Object.create(null), crossCounts = Object.create(null), groups = new Map(), jobs = [];
  let eventFiles = 0, parsedEvents = 0, triggerEvents = 0;
  function bindingFor(dir,marker) {
    if(c.recordVersion){
      try{
        const bytes=read(marker),record=JSON.parse(bytes.toString('utf8')),value=Object.fromEntries(c.recordVersion.keys.map(key=>[Array.isArray(key)?key.join('.'):key,get(record,key)??null]));
        const missing=Object.values(value).some(v=>v===null);if(missing)addGap('RECORDED_VERSION_UNKNOWN',marker,c.recordVersion.keys);
        return {path:marker,value:missing?null:value,recordedValues:value,sha256:hash(bytes),versionSource:'RECORDED'};
      }catch(e){addGap('RECORDED_VERSION_UNKNOWN',marker,e.message);return {path:marker,value:null,sha256:null,versionSource:'RECORDED'};}
    }
    if(!c.binding){
      addGap('RECORDED_VERSION_UNKNOWN',marker,'Neither recordVersion nor binding supplied; version remains UNKNOWN.');
      return {path:marker,value:null,sha256:null,versionSource:'UNKNOWN'};
    }
    const file = path.resolve(dir,c.binding.relativePath);
    if (!bindings.has(file)) {
      try {
        const bytes = read(file);
        const value = get(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')), c.binding.key);
        if (!scalar(value) || value === '') throw Error('Missing/non-scalar binding key');
        bindings.set(file,{path:file,value,sha256:hash(bytes),versionSource:'CURRENT_BINDING_MUTABLE'});
      } catch (e) {
        addGap('BINDING_UNKNOWN',file,e.message);
        bindings.set(file,{path:file,value:null,sha256:null,versionSource:'CURRENT_BINDING_MUTABLE'});
      }
    }
    return bindings.get(file);
  }
  for (const record of records) {
    read(record.marker);
    const population = path.relative(root,record.directory).split(path.sep)[0] || '.';
    const binding = bindingFor(record.directory,record.marker), groupKey = JSON.stringify([population,binding.value]);
    if (!groups.has(groupKey)) groups.set(groupKey,{population,populationLabel:c.populations?.[population]??'UNKNOWN',version:binding.value,versionSource:binding.versionSource,records:0,recordsWithTrigger:0,eventFiles:0,parsedEvents:0,triggerEvents:0,typeCounts:Object.create(null),crossCounts:Object.create(null)});
    const group = groups.get(groupKey); group.records++;
    const row = {...record,versionSource:binding.versionSource,classification:classification?.rows.get(path.resolve(record.marker))?.classification??null,population,populationLabel:c.populations?.[population]??'UNKNOWN',binding,eventFiles:0,parsedEvents:0,triggerEvents:0,events:[]};
    const dir = path.resolve(record.directory,c.eventsDirectory);
    let entries = [];
    try {
      if (!inside(record.directory,dir)) throw Error('eventsDirectory escapes record');
      entries = fs.readdirSync(safe(dir),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
    } catch(e) { addGap('EVENT_DIRECTORY_UNKNOWN',dir,e.message); }
    for (const entry of entries) {
      if (!eventPattern.test(entry.name)) continue;
      const file = path.join(dir,entry.name);
      if (!entry.isFile() || entry.isSymbolicLink()) { addGap('EVENT_NOT_REGULAR',file,'Not read'); continue; }
      eventFiles++; row.eventFiles++; group.eventFiles++;
      let text;
      try { text = read(file).toString('utf8').replace(/^\uFEFF/,''); }
      catch(e) { addGap('EVENT_READ',file,e.message); continue; }
      const units = c.mode === 'one-json-per-file' ? [{text,line:null}] :
        text.split(/\r?\n/).map((text,i)=>({text,line:i+1})).filter(u=>u.text.trim());
      if (!units.length) addGap('EMPTY_EVENT_FILE',file,'No event objects');
      for (const unit of units) {
        let event;
        try {
          event = JSON.parse(unit.text);
          if (!event || typeof event !== 'object' || Array.isArray(event)) throw Error('Event must be a JSON object');
        } catch(e) { addGap('EVENT_PARSE',file,{line:unit.line,message:e.message}); continue; }
        if(c.retainEvents) row.events.push({file,line:unit.line,value:event});
        parsedEvents++; row.parsedEvents++; group.parsedEvents++;
        const type = get(event,c.typeKey), tk = bucket(type);
        if (!scalar(type)) addGap('TYPE_UNKNOWN',file,{line:unit.line,key:c.typeKey});
        increment(typeCounts,tk); increment(group.typeCounts,tk);
        if (c.crossFields?.length&&(c.crossType === undefined || type === c.crossType)) {
          const values = c.crossFields.map(key=>get(event,key));
          if (values.some(v=>!scalar(v))) addGap('CROSS_FIELD_UNKNOWN',file,{line:unit.line,keys:c.crossFields});
          const key = JSON.stringify(values.map(v=>scalar(v)?v:null));
          increment(crossCounts,key); increment(group.crossCounts,key);
        }
        if (c.trigger&&Object.entries(c.trigger).every(([key,value])=>get(event,key) === value)) {
          triggerEvents++; row.triggerEvents++; group.triggerEvents++;
        }
      }
    }
    if (row.triggerEvents) group.recordsWithTrigger++;
    jobs.push(row);
  }
  if (!records.length) addGap('EMPTY_RECORD_DISTRIBUTION',root,'Inspect discovery scope; absence is not non-use');
  if (!parsedEvents) addGap('EMPTY_EVENT_DISTRIBUTION',root,'Inspect storage/parse mode before concluding anything');
  const versions = [...groups.values()];
  for(const group of versions){
    const value=group.version,key=value&&typeof value==='object'?(Object.keys(value).length===1?String(Object.values(value)[0]):JSON.stringify(value)):String(value);
    const commit=c.codeBinding?.versions&&Object.hasOwn(c.codeBinding.versions,key)?c.codeBinding.versions[key]:null;
    group.codeBinding=commit?{commit,basis:'CALLER_SUPPLIED_VERSION_MAP',verified:false}:{status:'UNKNOWN'};
    if(c.codeBinding?.versions&&!commit)addGap('CODE_BINDING_UNKNOWN',root,{version:group.version,reason:'Version absent from supplied map'});
  }
  progress('census: summarize');
  const result={
    contract:contract('RECORD',[...sources.values()], [{id:'ALL_POPULATIONS',semantics:classification?'CLASSIFIED':'NAME_ONLY_UNVERIFIED',classificationOutput:classification?{path:classification.path,sha256:classification.sha256,measuredAt:classification.measuredAt}:null,definition:'Union of matching retained record markers; directory names do not prove purpose.'},...populationInventory.map(p=>({id:p.directory,semantics:classification?'CLASSIFIED':'NAME_ONLY_UNVERIFIED',classificationOutput:classification?.path??null,definition:'Direct child directory; per-record class is separate.'}))], [{selector:'totals.*',population:'ALL_POPULATIONS',unit:'field-specific retained counts'},{selector:'typeCounts.*',population:'ALL_POPULATIONS',unit:'events'},{selector:'crossCounts.*',population:'ALL_POPULATIONS',unit:'events'},{selector:'populations[*].*',populationFrom:'population',unit:'field-specific retained counts'},{selector:'versions[*].*',populationFrom:'population',unit:'records and events within version'},{selector:'jobs[*].eventFiles|parsedEvents|triggerEvents',populationFrom:'population',unit:'events/files'}]),
    schema:'record-census-v2',measuredAt:new Date().toISOString(),config:c,
    codeBinding:c.codeBinding?{...c.codeBinding,basis:'CALLER_SUPPLIED',verified:false,historicalAssociation:c.codeBinding.versions?'VERSION_MAP':'UNKNOWN'}:{status:'UNKNOWN'},
    statisticsStatus:{crossFields:c.crossFields?.length?'PASS':'UNKNOWN',trigger:c.trigger?'PASS':'UNKNOWN'},
    status:gaps.length?'PARTIAL':'PASS',typeCounts,crossCounts,
    populationInventory,
    populations:[...new Set([...populationInventory.map(p=>p.directory),...jobs.map(j=>j.population)])].map(population=>{
      const subset=jobs.filter(j=>j.population===population);
      return {population,label:c.populations?.[population]??'UNKNOWN',records:subset.length,
        eventFiles:subset.reduce((n,j)=>n+j.eventFiles,0),parsedEvents:subset.reduce((n,j)=>n+j.parsedEvents,0),
        triggerEvents:subset.reduce((n,j)=>n+j.triggerEvents,0),recordsWithTrigger:subset.filter(j=>j.triggerEvents>0).length};
    }),
    totals:{population:'ALL_POPULATIONS',records:records.length,eventFiles,parsedEvents,triggerEvents,
      recordsWithTrigger:jobs.filter(r=>r.triggerEvents>0).length,
      knownVersionsWithTrigger:versions.filter(g=>g.version!==null && g.recordsWithTrigger>0).length,
      unknownVersionRecordsWithTrigger:versions.filter(g=>g.version===null).reduce((n,g)=>n+g.recordsWithTrigger,0)},
    versions,jobs,gaps,
    limitations:[
      'Counts describe retained parsed events, not feature correctness, coverage of unrecorded actions, or user value.',
      'Current binding files are read-back evidence, not independently immutable historical execution proof.',
      'Version grouping does not establish instrumentation presence: inspect each bound code root separately.',
      'Discovery stops at each matching record marker; eventsDirectory is scanned non-recursively.',
      'No timestamps, retries, or duplicate event records are deduplicated; each parsed object is counted.'
    ]
  };
  if(!c.crossFields?.length){result.crossCounts=null;for(const group of versions)group.crossCounts=null;}
  if(!c.trigger){
    for(const obj of [result.totals,...result.populations,...versions,...jobs])for(const key of ['triggerEvents','recordsWithTrigger','knownVersionsWithTrigger','unknownVersionRecordsWithTrigger'])if(own(obj,key))obj[key]=null;
  }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node record-census.mjs --config file");process.exit(0);}

  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--config') throw Error('Usage: node record-census.mjs --config /absolute/config.json');
    const bytes = fs.readFileSync(process.argv[3]);
    const result = census(JSON.parse(bytes.toString('utf8')),{progress:message=>process.stderr.write(message+'\n')});
    result.configurationSha256 = hash(bytes);
    configSource(result,process.argv[3]);
    result.command = [process.execPath,...process.argv.slice(1)];
    console.log(JSON.stringify(result,null,2));
    if (result.gaps.some(g=>g.kind!=='CROSS_FIELDS_UNKNOWN')) process.exitCode = 2;
  } catch(e) { console.error(e.message); process.exitCode = 1; }
}
