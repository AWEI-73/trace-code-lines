import fs from 'node:fs';
import path from 'node:path';
import {noLinks} from './walker.mjs';

export const summaryLine=value=>String(value??'').replace(/[\r\n\x00-\x1f\x7f-\x9f]/g,' ').slice(0,260);
export function readOptions(args){
 const options={};
 for(let i=0;i<args.length;i++){
  const key=args[i].replace(/^--/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
  options[key]=key==='summary'||key==='help'?true:args[++i];
 }
 return options;
}
export function printReport(report,options,summary){
 if(options.out){
  const target=noLinks(options.out),rel=path.relative(path.resolve(options.root??'.'),target);
  if(!rel||rel==='.'||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel))throw Error('輸出須在受查根目錄外。');
  fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n','utf8');
 }
 console.log(options.summary?summary(report).map(summaryLine).slice(0,20).join('\n'):JSON.stringify(report,null,2));
}
