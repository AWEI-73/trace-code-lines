// Zone/direction rule parsing shared by boundary.mjs and derive-map cross-repo edges.
import fs from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {noLinks} from './walker.mjs';
const unique=xs=>[...new Set(xs)];
export function glob(pattern){
 if(typeof pattern!=='string'||!pattern||pattern.startsWith('/')||pattern.includes('\\')||pattern.split('/').includes('..')||/[\x00-\x1f]/.test(pattern))throw Error('Invalid zone include');
 let out='^';for(let i=0;i<pattern.length;i++){
  if(pattern.slice(i,i+3)==='**/'){out+='(?:.*/)?';i+=2;}
  else if(pattern.slice(i,i+2)==='**'){out+='.*';i++;}
  else if(pattern[i]==='*')out+='[^/]*';
  else if(pattern[i]==='?')out+='[^/]';
  else out+=pattern[i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 }return new RegExp(out+'$');
}
export function configuration(config){
 if(!Array.isArray(config?.zones)||!config.zones.length||!Array.isArray(config.rules))throw Error('zones and rules required');
 const names=new Set();
 const zones=config.zones.map(z=>{
  if(typeof z.name!=='string'||!z.name||names.has(z.name))throw Error('Unique zone names required');names.add(z.name);
  if(typeof z.repo!=='string'||!isAbsolute(z.repo))throw Error('Zone repo must be absolute');
  const repo=noLinks(resolve(z.repo));if(!fs.statSync(repo).isDirectory())throw Error('Zone repo must be a directory');
  if(!Array.isArray(z.include)||!z.include.length)throw Error('Zone include required');
  return {...z,repo,patterns:z.include.map(glob)};
 });
 const directions=new Set();
 const rules=config.rules.map((r,index)=>{
  if(!names.has(r.from)||!names.has(r.to)||r.from===r.to||![true,false,'declared'].includes(r.allow))throw Error('Invalid direction rule');
  const key=JSON.stringify([r.from,r.to]);if(directions.has(key))throw Error('Duplicate direction rule');directions.add(key);
  if(!Array.isArray(r.markers)||r.markers.some(m=>typeof m!=='string'||!m.trim()))throw Error('Rule markers must be strings');
  return {...r,index,markers:unique(r.markers)};
 });return {zones,rules};
}
