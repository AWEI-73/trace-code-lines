// Literal references only. Reads declared roots; never writes or executes target code.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {noLinks,sha256} from './walker.mjs';
import {displayGroups,renderGroups,renderGroupsMarkdown} from './display-groups.mjs';

export const retainedAdvice='\u8981\u8655\u7406\uff1a\u7559\u5b58\u7269\u4ecd\u5f15\u7528\uff1b\u9700\u57f7\u884c\u8b49\u64da\u78ba\u8a8d\u65b0\u7248\u4ecd\u63a5\u53d7\u5b83';
const defaults={maxFileBytes:4*1024**2,maxTotalBytes:256*1024**2,maxFiles:100000,maxEntries:250000,maxMatches:100000};
const within=(a,b)=>{const r=path.relative(a,b);return !r||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
const relativeName=p=>{
 if(typeof p!=='string'||!p||/[\0-\x1f:]/.test(p)||/^[\\/]/.test(p))throw Error('Use repository-relative paths');
 p=p.replaceAll('\\','/');if(p.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe relative path');return p;
};
function glob(value){
 relativeName(value);let out='^';
 for(let i=0;i<value.length;i++){
  if(value[i]==='*'){if(value[i+1]==='*'){i++;if(value[i+1]==='/'){i++;out+='(?:.*/)?';}else out+='.*';}else out+='[^/]*';}
  else if(value[i]==='?')out+='[^/]';else out+=value[i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 }return new RegExp(out+'$');
}
function declarations(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('unusedExclusions must be an object');
 const rules=[];
 for(const [kind,values] of Object.entries(value)){
  if(!['conventionLoaded','staticDirectories','historyDirectories'].includes(kind)||!Array.isArray(values))throw Error('Invalid unusedExclusions');
  for(let v of values){if(typeof v==='string'&&kind!=='conventionLoaded')v=v.replace(/\/$/,'');relativeName(v);if(kind!=='conventionLoaded'&&/[*?]/.test(v))throw Error('Use literal exclusion directories');const pattern=kind==='conventionLoaded'?v:v+'/**';rules.push({kind,pattern,match:glob(pattern)});}
 }return rules;
}
const program=p=>/\.(?:[cm]?js|[cm]?ts|jsx|tsx|py|ps1|sh|bash|cmd|bat|gs|html?|css|scss|sql|go|rs|java|[ch](?:pp)?|cs|rb|php|swift|kt|vue|svelte)$/i.test(p);
function selectedPaths(c,repo){
 if((c.paths!==undefined)===(c.gitRange!==undefined))throw Error('Supply exactly one of paths or gitRange');
 if(c.paths!==undefined){if(!Array.isArray(c.paths)||!c.paths.length)throw Error('paths must be a nonempty array');return [...new Set(c.paths.map(relativeName))].map(p=>({path:p,change:'DECLARED'}));}
 if(typeof c.gitRange!=='string'||!c.gitRange.includes('..')||c.gitRange.includes('...'))throw Error('Use base..head');
 const refs=c.gitRange.split('..');if(refs.length!==2||refs.some(r=>!r||r.startsWith('-')||/[\s\0]/.test(r)))throw Error('Invalid gitRange');
 const git=args=>execFileSync('git',['--no-optional-locks','-C',repo,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:16*1024**2,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
 const commits=refs.map(r=>git(['rev-parse','--verify',r+'^{commit}']).trim());
 const parts=git(['diff','--no-ext-diff','--no-textconv','--name-status','-z','-M','--diff-filter=DR',commits.join('..'),'--']).split('\0');
 const rows=[];for(let i=0;i<parts.length&&parts[i];){const change=parts[i++],old=relativeName(parts[i++]);if(change==='D')rows.push({path:old,change:'DELETED'});else if(/^R\d+$/.test(change))rows.push({path:old,change:'RENAMED',renamedTo:relativeName(parts[i++])});else throw Error('Unexpected git diff status');}
 return rows;
}
function boundedRead(file,budget){
 noLinks(file);const before=fs.lstatSync(file);if(!before.isFile())return {skip:'NOT_REGULAR_FILE'};
 if(before.size>budget.limits.maxFileBytes)return {skip:'MAX_FILE_BYTES',bytes:before.size};
 if(budget.filesRead>=budget.limits.maxFiles)return {skip:'MAX_FILES',bytes:before.size};
 if(budget.bytesRead+before.size>budget.limits.maxTotalBytes)return {skip:'MAX_TOTAL_BYTES',bytes:before.size};
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
 try{
  const first=fs.fstatSync(fd);if(first.ino!==before.ino||first.size!==before.size||first.mtimeMs!==before.mtimeMs)throw Error('SOURCE_CHANGED');
  const b=Buffer.alloc(first.size);let at=0;
  while(at<b.length){const n=fs.readSync(fd,b,at,b.length-at,null);if(!n)break;at+=n;}
  budget.filesRead++;budget.bytesRead+=at;
  const after=fs.fstatSync(fd);noLinks(file);const current=fs.lstatSync(file);
  if(at!==first.size||after.size!==first.size||after.mtimeMs!==first.mtimeMs||current.ino!==first.ino||current.mtimeMs!==first.mtimeMs)throw Error('SOURCE_CHANGED');
  if(b.includes(0))return {skip:'BINARY_FILE',bytes:at};
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{return {skip:'BINARY_OR_NON_UTF8',bytes:at};}
  if(/[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(text))return {skip:'BINARY_FILE',bytes:at};
  return {text,sha256:sha256(b)};
 }finally{fs.closeSync(fd);}
}
export function deletionImpact(config,{base=process.cwd()}={}){
 const started=performance.now();if(!config||typeof config!=='object')throw Error('Configuration required');
 if(typeof config.repo!=='string'||!config.repo)throw Error('repo required');
 const repo=noLinks(path.resolve(base,config.repo));if(!fs.lstatSync(repo).isDirectory())throw Error('repo must be a directory');
 const limits={...defaults,...config.limits};for(const [k,v] of Object.entries(limits))if(!(k in defaults)||!Number.isSafeInteger(v)||v<1)throw Error('Invalid limit: '+k);
 const rules=declarations(config.unusedExclusions),excludes=(config.exclude??[]);if(!Array.isArray(excludes))throw Error('exclude must be an array');const excluded=excludes.map(glob);
 const rows=selectedPaths(config,repo).sort((a,b)=>a.path.localeCompare(b.path));
 const retainedRoots=config.retainedRoots??[];if(!Array.isArray(retainedRoots))throw Error('retainedRoots must be an array');
 const roots=retainedRoots.map(r=>{
  if(!r||typeof r.path!=='string'||!r.path||typeof r.label!=='string'||!r.label)throw Error('Each retained root requires path and label');
  const root=path.resolve(base,r.path);if(within(repo,root)||within(root,repo))throw Error('Retained roots must be outside and disjoint from repo');return {root,label:r.label};
 });
 if(new Set(roots.map(r=>r.label)).size!==roots.length||roots.some((r,i)=>roots.slice(0,i).some(s=>within(r.root,s.root)||within(s.root,r.root))))throw Error('Retained roots must have unique labels and not overlap');
 const budget={limits,filesRead:0,bytesRead:0,entries:0,matches:0};
 const items=rows.map(r=>({...r,repo:{program:[],data:[],history:[]},retained:[],gaps:[]}));
 const scopes=[];
 function scan(root,label,kind){
  const scope={root,label,kind,status:'PASS',filesRead:0,bytesRead:0,entries:0,skipped:[]};scopes.push(scope);
  const initial={files:budget.filesRead,bytes:budget.bytesRead,entries:budget.entries};
  const skip=(file,reason,detail={})=>{scope.skipped.push({file,reason,...detail});if(!['BINARY_FILE','BINARY_OR_NON_UTF8','DECLARED_EXCLUSION','GIT_METADATA'].includes(reason))scope.status='UNKNOWN';};
  try{noLinks(root);if(!fs.lstatSync(root).isDirectory())throw Error('NOT_DIRECTORY');}catch(e){skip('.',e.code==='ENOENT'?'ROOT_MISSING':e.code??e.message);scope.status='UNKNOWN';return scope;}
  function walk(dir,rel=''){
   if(budget.entries>=limits.maxEntries){skip(rel||'.','MAX_ENTRIES_SUBTREE');return;}
   let entries;try{noLinks(dir);entries=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);}catch(e){skip(rel||'.','DIRECTORY_UNREADABLE',{detail:e.code??e.message});return;}
   for(let i=0;i<entries.length;i++){
    if(budget.entries>=limits.maxEntries){skip(rel||'.','MAX_ENTRIES_REMAINDER',{remainingEntries:entries.length-i,firstUnscanned:entries[i].name});break;}
    const entry=entries[i],file=rel?rel+'/'+entry.name:entry.name,absolute=path.join(dir,entry.name);budget.entries++;
    if(entry.isSymbolicLink()){skip(file,'SYMLINK_NOT_FOLLOWED');continue;}
    if(entry.name==='.git'){skip(file,'GIT_METADATA');continue;}
    if(excluded.some(re=>re.test(file))){skip(file,'DECLARED_EXCLUSION');continue;}
    if(entry.isDirectory()){walk(absolute,file);continue;}
    if(!entry.isFile()){skip(file,'NOT_REGULAR_FILE');continue;}
    let source;try{source=boundedRead(absolute,budget);}catch(e){skip(file,'FILE_UNREADABLE',{detail:e.code??e.message});continue;}
    if(source.skip){skip(file,source.skip,{bytes:source.bytes});continue;}
    const matches=rules.filter(r=>r.match.test(file)).map(({kind,pattern})=>({kind,pattern}));
    const category=matches.some(r=>r.kind==='historyDirectories')?'history':program(file)?'program':'data';
    // Normalize literal slash forms, including JSON-escaped Windows separators.
    const normalizedText=source.text.replace(/\\+/g,'/'),lines=source.text.split('\n');
    for(const item of items){
     if(!normalizedText.includes(item.path))continue;
     const anchors=[];let count=0,incomplete=false;
     for(let line=0;line<lines.length;line++){
      const normalized=lines[line].replace(/\\+/g,'/');let at=0;
      while((at=normalized.indexOf(item.path,at))>=0){
       if(budget.matches>=limits.maxMatches){incomplete=true;break;}
       budget.matches++;count++;anchors.push({file,line:line+1,column:at+1,snippet:lines[line].slice(0,240),snippetTruncated:lines[line].length>240,snippetSha256:sha256(lines[line])});at+=item.path.length;
      }
      if(incomplete)break;
     }
     if(incomplete)skip(file,'MAX_MATCHES',{deletedPath:item.path});
     if(!count)continue;
     const found={file,count,sourceSha256:source.sha256,declaredExclusions:matches,anchors:anchors.slice(0,3),locations:anchors};
     if(kind==='repo')item.repo[category].push(found);
     else {let group=item.retained.find(g=>g.label===label);if(!group){group={root,label,files:[],fileCount:0,occurrences:0};item.retained.push(group);}group.files.push(found);group.fileCount++;group.occurrences+=count;}
    }
   }
  }
  walk(root);scope.filesRead=budget.filesRead-initial.files;scope.bytesRead=budget.bytesRead-initial.bytes;scope.entries=budget.entries-initial.entries;return scope;
 }
 // Retained evidence receives the budget before repository contents.
 for(const r of roots)scan(r.root,r.label,'retained');scan(repo,'repo','repo');
 const gaps=[];if(!roots.length)gaps.push('RETAINED_ROOTS_NOT_DECLARED');for(const s of scopes)if(s.status!=='PASS')gaps.push('INCOMPLETE_SCOPE:'+s.label);
 for(const item of items){item.gaps=[...gaps];item.status=item.retained.length?'NEEDS_ATTENTION':gaps.length?'UNKNOWN':'NO_RETAINED_MATCH';item.reason=item.retained.length?retainedAdvice:gaps.length?'UNKNOWN\uff1a\u7559\u5b58\u6839\u7f3a\u6f0f\u6216\u6383\u63cf\u4e0d\u5b8c\u6574':'\u5df2\u6383\u63cf\u7bc4\u570d\u672a\u898b\u7559\u5b58\u5f15\u7528\uff1b\u4e0d\u662f\u53ef\u522a\u9664\u6216\u76f8\u5bb9\u8b49\u660e';}
 const result={schema:'deletion-impact-v1',repo,selection:config.gitRange?{gitRange:config.gitRange}:{paths:rows.map(r=>r.path)},limits,display:config.display??{},status:items.some(i=>i.status==='NEEDS_ATTENTION')?'NEEDS_ATTENTION':gaps.length?'UNKNOWN':'NO_RETAINED_MATCH',gaps,items,scopes,stats:{deletedPaths:items.length,filesRead:budget.filesRead,bytesRead:budget.bytesRead,entries:budget.entries,matches:budget.matches,retainedFiles:scopes.filter(s=>s.kind==='retained').reduce((n,s)=>n+s.filesRead,0),limitExceeded:scopes.some(s=>s.skipped.some(k=>k.reason.startsWith('MAX_'))),elapsedSeconds:(performance.now()-started)/1000},limitations:['Literal full-path string occurrences only; no basename, computed-path, UTF-16 or runtime compatibility inference.','Columns refer to slash-normalized text; snippets are bounded to 240 characters, complete line hashes and all collected locations remain in JSON.','Scopes and skips describe the inspected population; absence never authorizes deletion.']};
 result.groups=deletionGroups(result);return result;
}
export function deletionGroups(r){
 const limit=r.display?.maxGroupsPerCategory??20;
 return r.items.map(item=>({path:item.path,status:item.status,reason:item.reason,repo:Object.fromEntries(Object.entries(item.repo).map(([k,files])=>[k,displayGroups(files.map(f=>({...f,category:k,reason:'LITERAL_PATH_REFERENCE',locations:f.locations})),{limit})])),retained:item.retained.map(g=>({root:g.root,label:g.label,fileCount:g.fileCount,occurrences:g.occurrences,display:displayGroups(g.files.map(f=>({...f,category:'handling',reason:retainedAdvice,locations:f.locations})),{limit})}))}));
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderDeletionMarkdown(r,json='health.json'){
 if(!r)return '';const lines=['## \u522a\u9664\u5f71\u97ff','',r.status+'\uff1b'+r.stats.filesRead+' files / '+r.stats.bytesRead+' bytes; limits exceeded: '+r.stats.limitExceeded,''];
 for(const gap of r.gaps)lines.push('- UNKNOWN: '+gap);
 for(const s of r.scopes)lines.push('- '+s.label+': '+s.status+'; skipped '+s.skipped.length+' (full list: JSON)');
 for(const item of r.groups){lines.push('### '+esc(item.path),'',item.status+' '+item.reason,'');for(const [kind,s] of Object.entries(item.repo))if(s.items)lines.push('Repo: '+kind,'',renderGroupsMarkdown(s,{json}));for(const g of item.retained)lines.push('Retained: '+esc(g.label)+' / '+esc(g.root)+'; '+g.fileCount+' files / '+g.occurrences+' occurrences','',renderGroupsMarkdown(g.display,{json}));}
 return lines.join('\n')+'\n';
}
export function renderDeletionHTML(r,json='health.json',id='deletion-impact'){
 if(!r)return '';return '<section id="'+esc(id)+'" style="overflow-wrap:anywhere"><h2>\u522a\u9664\u5f71\u97ff</h2><p>'+esc(r.status)+'; '+r.stats.filesRead+' files / '+r.stats.bytesRead+' bytes; limits exceeded: '+r.stats.limitExceeded+'</p>'+r.gaps.map(g=>'<p>UNKNOWN: '+esc(g)+'</p>').join('')+r.scopes.map(s=>'<p>'+esc(s.label)+': '+s.status+'; skipped '+s.skipped.length+' (full list: JSON)</p>').join('')+r.groups.map(item=>'<details><summary>'+esc(item.path)+' / '+esc(item.status)+'</summary><p>'+esc(item.reason)+'</p>'+Object.entries(item.repo).filter(([,s])=>s.items).map(([k,s])=>'<h3>Repo: '+k+'</h3>'+renderGroups(s,{json})).join('')+item.retained.map(g=>'<h3>'+esc(g.label)+' / '+esc(g.root)+'</h3><p>'+g.fileCount+' files / '+g.occurrences+' occurrences</p>'+renderGroups(g.display,{json})).join('')+'</details>').join('')+'<p><a href="'+esc(json)+'">\u5b8c\u6574\u6e05\u55ae\u8207\u7565\u904e\u7bc4\u570d</a></p></section>';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const args=process.argv.slice(2);if(args.length===1&&args[0]==='--help')console.log('Usage: node deletion-impact.mjs --config file (read-only; full JSON on stdout)');
 else{if(args.length!==2||args[0]!=='--config')throw Error('Use --help');const file=noLinks(path.resolve(args[1]));if(fs.statSync(file).size>1024**2)throw Error('Configuration exceeds 1 MiB');console.log(JSON.stringify(deletionImpact(JSON.parse(fs.readFileSync(file,'utf8')),{base:path.dirname(file)})));}}
 catch(e){console.error(JSON.stringify({status:'ERROR',message:e.message}));process.exitCode=1;}
}
