// Static, inventory-bound GAS and framework references. Never executes target code.
import {posix} from 'node:path';
import {tokens} from './language-static.mjs';
import {normalizeGap,dataGapIdentity,identityData} from './gap-shape.mjs';

const scriptFile=p=>/\.(?:gs|js|mjs|cjs|ts|mts|cts|jsx|tsx)$/i.test(p);
const entryNames=new Set(['doGet','doPost','onOpen','onEdit','onInstall','onFormSubmit','onSelectionChange']);
const handlers=new Set(['withSuccessHandler','withFailureHandler','withUserObject']);
const versions=['1.5.0','1.6.0','1.7.0','1.8.0','1.9.0','1.10.0','1.11.0','1.12.0','1.12.1'];
const within=(base,p)=>base==='.'||p.startsWith(base+'/');
const safe=p=>p&&p!=='.'&&p!=='..'&&!p.startsWith('../')&&!/^(?:[A-Za-z]:|\/)/.test(p)&&!/[\\:<>"|?*\x00-\x1f]/.test(p);
const unique=xs=>[...new Set(xs)];
function glob(pattern){
  if(typeof pattern!=='string'||pattern.startsWith('/')||pattern.includes('..')||/[\\:]/.test(pattern))throw Error('gasScopes files require repo-relative globs');
  let out='^';for(let i=0;i<pattern.length;i++){
    const c=pattern[i];if(c==='*'){if(pattern[i+1]==='*'){i++;if(pattern[i+1]==='/'){i++;out+='(?:.*/)?';}else out+='.*';}else out+='[^/]*';}
    else if(c==='?')out+='[^/]';else out+=c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  }return new RegExp(out+'$');
}
function literal(t){
  if(t?.kind!=='string'||!t.literal)return null;
  let invalid=false;const value=t.v.replace(/\\(?:u([0-9a-f]{4})|x([0-9a-f]{2})|([\s\S]))/gi,(_,u,x,c)=>{
    if(u||x)return String.fromCharCode(parseInt(u||x,16));
    if(/[1-9]/.test(c))invalid=true;
    return ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'})[c]??c;
  });return invalid?null:value;
}
function htmlCode(source){
  // Keep offsets/lines; prose, HTML comments and string attributes are not code.
  const chars=source.replace(/[^\r\n]/g,' ').split('');
  const uncommented=source.replace(/<!--[\s\S]*?-->/g,m=>m.replace(/[^\r\n]/g,' '));
  for(const m of uncommented.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>|<\?(?:!=|=)?([\s\S]*?)\?>/gi)){
    const body=m[1]??m[2],start=m.index+m[0].indexOf(body);for(let i=0;i<body.length;i++)chars[start+i]=body[i];
  }
  for(const tag of uncommented.matchAll(/<[A-Za-z](?:[^>"']|"[^"]*"|'[^']*')*>/g))for(const attr of tag[0].matchAll(/\bon[a-z]+\s*=\s*(["'])([\s\S]*?)\1/gi)){
    const body=attr[2],start=tag.index+attr.index+attr[0].indexOf(attr[1])+1;
    if(!/&(?:#\d+|#x[\da-f]+|quot|apos|amp|lt|gt);/i.test(body))for(let i=0;i<body.length;i++)chars[start+i]=body[i];
  }
  return chars.join('');
}

function syntax(file,source){
  const code=/\.html?$/i.test(file)?htmlCode(source):source;
  const t=tokens(code,false,{regexLiterals:true}).filter(x=>x.v!=='\n'),pairs=new Map(),stack=[],scopeAt=[],scopes=[{start:-1,end:t.length,bindings:new Set(),parent:null,functionScope:true}],scopeStack=[0];
  const punct=(i,v)=>t[i]&&t[i].kind!=='string'&&t[i].kind!=='regex'&&t[i].v===v;
  for(let i=0;i<t.length;i++){
    scopeAt[i]=scopeStack.at(-1);
    if(t[i].kind==='string'||t[i].kind==='regex')continue;
    if(['(','[','{'].includes(t[i].v)){
      stack.push(i);if(punct(i,'{')){scopes.push({start:i,end:t.length,bindings:new Set(),parent:scopeStack.at(-1)});scopeStack.push(scopes.length-1);}
    }else if([')',']','}'].includes(t[i].v)){
      const a=stack.pop();if(a!==undefined&&'([{'.indexOf(t[a].v)===')]}'.indexOf(t[i].v)){pairs.set(a,i);pairs.set(i,a);}
      if(punct(i,'}')&&scopeStack.length>1){scopes[scopeStack.pop()].end=i;}
    }
  }
  const split=(a,b,sep=',')=>{const result=[];let start=a;for(let i=a;i<b;i++){if(punct(i,sep)){result.push([start,i]);start=i+1;}else if(pairs.get(i)>i)i=pairs.get(i);}result.push([start,b]);return result;};
  const text=(a,b)=>a<b?code.slice(t[a].start,t[b-1].end):'';
  const definitions=[],declarationIndices=new Set(),functionRows=[],expressionScopes=[];
  const binding=(name,index,scope,kind,exported=false)=>{
    if(!/^[A-Za-z_$][\w$]*$/.test(name??''))return;
    scopes[scope].bindings.add(name);declarationIndices.add(index);
    if(scope===0)definitions.push({name,line:t[index].line,index,kind,exported});
  };
  const pattern=(a,b,scope,kind)=>{
    for(let j=a;j<b;j++){
      if(punct(j,'='))break;
      if(t[j].kind!=='name'||['public','private','readonly'].includes(t[j].v)||punct(j+1,':'))continue;
      binding(t[j].v,j,scope,kind);
      if(!punct(a,'{')&&!punct(a,'['))break;
    }
  };
  const bodyScope=body=>scopes.findIndex(s=>s.start===body);
  // Parameters are local to the function body; nested functions remain nested.
  for(let i=0;i<t.length;i++)if(punct(i,'(')&&pairs.has(i)){
    const close=pairs.get(i);let body=close+1;
    if(punct(body,':')){body++;while(body<t.length&&!punct(body,'{')&&!punct(body,';')&&!punct(body,'='))body++;}
    const arrow=punct(body,'=')&&punct(body+1,'>');if(arrow)body+=2;
    const prior=t[i-1]?.v,fn=prior==='function'||t[i-2]?.v==='function'||t[i-3]?.v==='function'&&t[i-2]?.v==='*';
    const method=punct(body,'{')&&t[i-1]?.kind==='name'&&!['if','for','while','switch','with'].includes(prior);
    if(!fn&&!arrow&&!method)continue;
    const scope=bodyScope(body);
    if(scope>0){scopes[scope].functionScope=prior!=='catch';for(const [a,b] of split(i+1,close))pattern(a,b,scope,'parameter');}
    else if(arrow){let end=body;while(end<t.length&&!punct(end,';')&&!punct(end,',')){if(pairs.get(end)>end)end=pairs.get(end);end++;}expressionScopes.push({start:body,end,names:t.slice(i+1,close).filter(x=>x.kind==='name').map(x=>x.v)});}
    if(fn){const nameIndex=t[i-1]?.kind==='name'&&prior!=='function'?i-1:null;functionRows.push({index:nameIndex,open:i,body,end:pairs.get(body)});}
  }
  for(let i=0;i<t.length;i++){
    if(t[i].kind!=='name'||punct(i-1,'.'))continue;
    let scope=scopeAt[i];const v=t[i].v;
    if(v==='function'||v==='class'){
      const n=punct(i+1,'*')?i+2:i+1;
      // Named expressions bind only in their own body, not in the enclosing global scope.
      const declaration=!['=','(',':',',','return'].includes(t[i-1]?.v);
      if(t[n]?.kind==='name'&&declaration)binding(t[n].v,n,scope,v,t[i-1]?.v==='export'||t[i-2]?.v==='export');
    }
    if(['const','let','var'].includes(v)){
      if(v==='var')while(scope&& !scopes[scope].functionScope)scope=scopes[scope].parent;
      let end=i+1;for(;end<t.length;end++){if([';',')','of','in'].includes(t[end].v))break;if(pairs.get(end)>end)end=pairs.get(end);}
      for(const [a,b] of split(i+1,end))pattern(a,b,scope,v);
    }
    if(punct(i+1,'=')&&punct(i+2,'>')){
      const b=i+3,s=bodyScope(b);if(s>0){scopes[s].functionScope=true;binding(v,i,s,'parameter');}
      else {let end=b;while(end<t.length&&!punct(end,';')&&!punct(end,',')){if(pairs.get(end)>end)end=pairs.get(end);end++;}expressionScopes.push({start:b,end,names:[v]});}
    }
    if(v==='import'&&!['(','.'].includes(t[i+1]?.v)){
      for(let j=i+1;j<t.length&&!['from',';'].includes(t[j].v);j++)if(t[j].kind==='name'&&!['as','type'].includes(t[j].v)&&t[j+1]?.v!=='as')binding(t[j].v,j,scope,'import');
    }
  }
  const shadowed=(name,i)=>{for(let s=scopeAt[i];s;s=scopes[s].parent)if(scopes[s].bindings.has(name))return true;return expressionScopes.some(s=>s.start<=i&&i<s.end&&s.names.includes(name));};
  return {t,pairs,punct,split,text,definitions,scopeAt,scopes,shadowed,declarationIndices,functionRows};
}

export function buildFrameworkGraph(rows,read,config={}){
  const paths=[...rows.keys()].sort(),projects=[],scopes=[],edges=[],gaps=[],entryPoints=[],parsed=new Map();
  const get=file=>{if(!parsed.has(file))parsed.set(file,syntax(file,read(file).toString('utf8')));return parsed.get(file);};
  const addGap=(code,path,line,detail,data={})=>{
    const g=normalizeGap({code,path,line,detail,data,introducedIn:'1.13.0',legacyIds:Object.fromEntries(versions.map(v=>[v,null])),legacyId:null});g.gapId=dataGapIdentity(g,undefined,identityData(g.data));g.legacyIds['1.13.0']=g.gapId;gaps.push(g);return g;
  };
  const addEdge=(kind,path,line,targets,extra={})=>edges.push({kind,path,line,targets:unique(targets).sort(),candidate:true,runtimeVerified:false,introducedIn:'1.13.0',...extra});
  const json=file=>{try{return JSON.parse(read(file).toString('utf8'));}catch(error){addGap('GAS_CONFIG_INVALID',file,null,'GAS configuration could not be read or parsed',{reason:error.message});return null;}};
  const manifests=paths.filter(p=>posix.basename(p)==='appsscript.json');
  const clasps=manifests.length?paths.filter(p=>/(^|\/)\.clasp\.json(?:\.example)?$/.test(p)).map(file=>({file,base:posix.dirname(file),value:json(file)})):[];
  for(const manifest of manifests){
    const dir=posix.dirname(manifest),clasp=clasps.filter(c=>within(c.base,manifest)).sort((a,b)=>b.base.length-a.base.length||a.file.length-b.file.length)[0];
    const base=clasp?.base??dir,raw=clasp?.value?.rootDir;
    let rootDir=typeof raw!=='string'?dir:posix.normalize(posix.join(base,raw.replaceAll('\\','/')));
    if(raw!==undefined&&(typeof raw!=='string'||/^(?:[A-Za-z]:|[\\/])/.test(raw)||!safe(rootDir)&&rootDir!=='.')){
      addGap('GAS_ROOT_DIR_UNSUPPORTED',clasp.file,null,'Deployment root is outside the checked inventory; manifest directory retained',{manifest});rootDir=dir;
    }
    let project=projects.find(p=>p.base===base);
    if(!project){project={name:base,base,rootDirs:[],manifests:[],configured:false};projects.push(project);}
    project.rootDirs=unique([...project.rootDirs,rootDir]);project.manifests.push(manifest);
    const files=paths.filter(p=>within(rootDir,p)&&/\.(?:gs|js)$/i.test(p));
    scopes.push({name:'deployment:'+rootDir,project:base,files});
  }
  if(config.gasScopes!==undefined&&!Array.isArray(config.gasScopes))throw Error('gasScopes must be an array');
  for(const s of config.gasScopes??[]){
    if(typeof s.name!=='string'||!s.name||!Array.isArray(s.files)||!s.files.length)throw Error('gasScopes requires name and nonempty files');
    const patterns=s.files.map(glob),files=paths.filter(p=>scriptFile(p)&&patterns.some(re=>re.test(p)));
    const matching=projects.filter(p=>files.every(f=>within(p.base,f))).sort((a,b)=>b.base.length-a.base.length);let project=matching[0];
    if(!project){project={name:'.',base:'.',rootDirs:[],manifests:[],configured:true};projects.push(project);}
    scopes.push({name:s.name,project:project.base,files});
    if(!files.length)addGap('GAS_SCOPE_EMPTY','.',null,'Configured global scope has no matching script files',{name:s.name});
  }
  const projectOf=file=>projects.filter(p=>within(p.base,file)).sort((a,b)=>b.base.length-a.base.length)[0];
  const sourceFiles=paths.filter(p=>scriptFile(p)||/\.html?$/i.test(p));
  // Avoid parsing unrelated JS in ordinary repositories unless a framework marker exists.
  for(const file of sourceFiles){try{if(projectOf(file)||/\b(?:preload|loadFile|webPreferences)\b/.test(read(file).toString('utf8')))get(file);}catch(error){addGap('FRAMEWORK_SCAN_UNREADABLE',file,null,'Static scan unavailable',{reason:error.message});}}
  // Configured source scopes do not own every client under their synthetic repo project.
  // Fallback is client-only: it must not broaden global scopes or framework resolution.
  const clientProjects=new Map(),implicitProjects=new Map();
  const explicitlyOwned=file=>projects.some(p=>p.manifests.length&&within(p.base,file))||scopes.some(s=>s.files.some(p=>p===file||within(posix.dirname(p),file)));
  for(const file of sourceFiles){
    if(!/\.(?:html?|js|mjs|cjs)$/i.test(file)||explicitlyOwned(file))continue;
    if(!/google\s*\.\s*script\s*\.\s*run\b/.test(read(file).toString('utf8')))continue;
    for(let dir=posix.dirname(file);;dir=posix.dirname(dir)){
      const files=paths.filter(p=>posix.dirname(p)===dir&&/\.gs$/i.test(p));
      if(files.length){
        const project={base:dir,files,projectBasis:'NEAREST_GS_DIRECTORY',candidate:true};
        clientProjects.set(file,project);implicitProjects.set(dir,project);get(file);for(const p of files)get(p);break;
      }
      if(dir==='.')break;
    }
  }
  const definitions=new Map();for(const [file,s] of parsed)definitions.set(file,s.definitions);
  const definitionsIn=files=>{const names=new Map();for(const file of files)for(const d of definitions.get(file)??[])if(d.kind!=='import'){if(!names.has(d.name))names.set(d.name,[]);names.get(d.name).push({file,...d});}return names;};
  for(const scope of scopes){
    const names=definitionsIn(scope.files);
    for(const [name,defs] of names)if(unique(defs.map(d=>d.file)).length>1)addGap('GAS_GLOBAL_AMBIGUOUS',defs[0].file,defs[0].line,'Multiple files define the same global name',{scope:scope.name,name,definitions:defs.map(d=>({file:d.file,line:d.line}))});
    for(const file of scope.files){const s=parsed.get(file);if(!s)continue;const own=new Set(s.definitions.map(d=>d.name)),byTarget=new Map();
      for(let i=0;i<s.t.length;i++){
        const token=s.t[i],name=token.v,defs=names.get(name);if(token.kind!=='name'||!defs||own.has(name)||s.declarationIndices.has(i)||s.shadowed(name,i)||s.punct(i-1,'.')||s.punct(i+1,':'))continue;
        const files=unique(defs.map(d=>d.file));if(files.length!==1||files[0]===file)continue;
        const target=files[0];if(!byTarget.has(target))byTarget.set(target,[]);byTarget.get(target).push({name,line:token.line});
      }
      for(const [target,sites] of byTarget)addEdge('GAS_GLOBAL_REFERENCE',file,sites[0].line,[target],{scope:scope.name,names:unique(sites.map(s=>s.name)).sort(),sites});
    }
  }
  const globalDefinitions=project=>definitionsIn(unique(scopes.filter(s=>s.project===project.base).flatMap(s=>s.files)));
  const exportsIn=project=>{
    const map=new Map();for(const [file,defs] of definitions)if(projectOf(file)===project&&!scopes.some(s=>s.project===project.base&&s.name.startsWith('deployment:')&&s.files.includes(file)))for(const d of defs)if(d.exported&&d.kind==='function'){if(!map.has(d.name))map.set(d.name,[]);map.get(d.name).push({file,...d});}return map;
  };
  for(const [file,s] of parsed){
    const project=projectOf(file),{t,pairs,punct,split,text}=s,globals=project?globalDefinitions(project):new Map();
    const clientProject=clientProjects.get(file);
    const globalFile=scopes.some(scope=>scope.files.includes(file));
    if(project)for(const d of s.definitions)if(entryNames.has(d.name)&&(globalFile||file.endsWith('.gs')||d.exported))entryPoints.push({name:d.name,file,line:d.line,basis:'TOP_LEVEL_DEFINITION',project:project.base});
    const resolveName=(kind,index,name,extra={})=>{
      let defs=globals.get(name)??[],targetBasis='DECLARED_GLOBAL_SCOPE';
      if(!defs.length){targetBasis='SOURCE_EXPORT_NOT_DEPLOYMENT';defs=[...definitions].filter(([p])=>projectOf(p)===project).flatMap(([p,ds])=>ds.filter(d=>d.exported&&d.name===name).map(d=>({file:p,...d})));}
      const targets=unique(defs.map(d=>d.file));
      if(targets.length===1){if(kind==='GAS_TRIGGER')for(const d of defs)entryPoints.push({name,file:d.file,line:d.line,basis:'SCRIPT_APP_TRIGGER',project:project.base,trigger:{file,line:t[index].line}});else addEdge(kind,file,t[index].line,targets,{names:[name],targetBasis,...extra});}
      else addGap(targets.length?'GAS_GLOBAL_AMBIGUOUS':kind+'_TARGET_UNKNOWN',file,t[index].line,targets.length?'Name resolves to multiple files':'No top-level server definition in this GAS project',{name,targets,...extra});
    };
    const expressionEnd=start=>{let end=start;while(end<t.length&&![';',',','}'].some(c=>punct(end,c))){if(pairs.get(end)>end)end=pairs.get(end);end++;}return end;};
    const evalPath=(a,b,depth=0)=>{
      if(depth>1)return null;
      if(b===a+1){const lit=literal(t[a]);if(lit!==null)return {value:lit,relative:false};
        const defs=s.definitions.filter(d=>d.name===t[a]?.v&&d.kind==='const');if(defs.length!==1)return null;const d=defs[0];
        // Reject any rebinding, even syntactically invalid const assignments.
        if(t.some((v,j)=>v.v===d.name&&j!==d.index&&punct(j+1,'=')&&!punct(j+2,'=')))return null;
        if(!punct(d.index+1,'='))return null;return evalPath(d.index+2,expressionEnd(d.index+2),depth+1);
      }
      if(t[a]?.v==='path'&&punct(a+1,'.')&&['join','resolve'].includes(t[a+2]?.v)&&punct(a+3,'(')&&pairs.get(a+3)===b-1){
        const args=split(a+4,b-1);if(args.length<2||text(...args[0])!=='__dirname')return null;
        const lits=args.slice(1).map(([x,y])=>y===x+1?literal(t[x]):null);if(lits.some(v=>v===null||/^(?:[A-Za-z]:|[\\/])/.test(v)))return null;
        return {value:posix.join(posix.dirname(file),...lits),relative:true};
      }return null;
    };
    const framework=(index,a,b,call,gas=false)=>{
      const value=gas?(b===a+1&&literal(t[a])!==null?{value:literal(t[a]),relative:false}:null):evalPath(a,b),expr=text(a,b);
      if(!value){addGap('FRAMEWORK_PATH_LOAD_UNKNOWN',file,t[index].line,'Computed or unsupported framework path',{call,expression:expr});return;}
      let targets=[];
      if(gas){const name=/\.html$/i.test(value.value)?value.value:value.value+'.html';
        if(safe(name)){targets=project.rootDirs.map(dir=>posix.join(dir,name)).filter(p=>rows.has(p));
          const sibling=posix.join(posix.dirname(file),name);if(!targets.length&&rows.has(sibling))targets=[sibling];
          if(!targets.length)targets=paths.filter(p=>projectOf(p)===project&&/\.html$/i.test(p)&&(p===name||p.endsWith('/'+name)));}
      }else{const raw=value.value.replaceAll('\\','/');if(!/^(?:[A-Za-z]:|\/)/.test(raw)){const candidate=value.relative?posix.normalize(raw):posix.normalize(raw);if(safe(candidate)&&rows.has(candidate))targets=[candidate];}}
      targets=unique(targets);if(targets.length===1)addEdge('FRAMEWORK_PATH_LOAD',file,t[index].line,targets,{call,specifier:value.value,expression:expr,resolvedFrom:gas?'gas-project-html':value.relative?'file-relative':'cwd-repo-root'});
      else addGap('FRAMEWORK_PATH_LOAD_UNKNOWN',file,t[index].line,targets.length?'Multiple HTML targets; no target selected':'No existing inventory target',{call,expression:expr,targets});
    };
    for(let i=0;i<t.length;i++){
      if(t[i].kind!=='name'||punct(i-1,'.'))continue;
      if(project&&t[i].v==='ScriptApp'&&punct(i+1,'.')&&t[i+2]?.v==='newTrigger'&&punct(i+3,'(')){
        const end=pairs.get(i+3),name=end===i+5?literal(t[i+4]):null;if(name!==null)resolveName('GAS_TRIGGER',i,name);else addGap('GAS_TRIGGER_TARGET_UNKNOWN',file,t[i].line,'Trigger name is computed');
      }
      if((project||clientProject)&&t[i].v==='google'&&punct(i+1,'.')&&t[i+2]?.v==='script'&&punct(i+3,'.')&&t[i+4]?.v==='run'){
        let j=i+5,last=null,computed=false;
        while(j<t.length){
          if(punct(j,'[')){computed=true;break;}
          if(!punct(j,'.')||t[j+1]?.kind!=='name'||!punct(j+2,'(')||!pairs.has(j+2))break;
          if(!handlers.has(t[j+1].v))last=t[j+1].v;j=pairs.get(j+2)+1;
        }
        if(computed){const g=addGap('GAS_CLIENT_CALL_COMPUTED',file,t[i].line,'Computed client method cannot be resolved');if(!project){g.introducedIn='1.14.0';g.legacyIds['1.13.0']=null;}}
        else if(last){
          if(!clientProject)resolveName('GAS_CLIENT_CALL',i,last);
          else {
            const defs=(definitionsIn(clientProject.files).get(last)??[]).filter(d=>d.kind==='function'),targets=unique(defs.map(d=>d.file));
            if(targets.length===1)addEdge('GAS_CLIENT_CALL',file,t[i].line,targets,{names:[last],targetBasis:'NEAREST_GS_DIRECTORY',projectBasis:'NEAREST_GS_DIRECTORY',project:clientProject.base,definitions:defs.map(d=>({file:d.file,line:d.line})),introducedIn:'1.14.0'});
            else {
              const g=addGap(targets.length?'GAS_GLOBAL_AMBIGUOUS':'GAS_CLIENT_CALL_TARGET_UNKNOWN',file,t[i].line,targets.length?'Name resolves to multiple files':'No top-level server definition in this GAS project',{name:last,targets});
              if(!project){g.introducedIn='1.14.0';g.legacyIds['1.13.0']=null;}
            }
          }
        }
      }
      if(project&&t[i].v==='HtmlService'&&punct(i+1,'.')&&['createHtmlOutputFromFile','createTemplateFromFile'].includes(t[i+2]?.v)&&punct(i+3,'(')&&pairs.has(i+3)){
        const args=split(i+4,pairs.get(i+3));framework(i,...args[0],'HtmlService.'+t[i+2].v,true);
      }
      if(project&&t[i].v==='include'&&punct(i+1,'(')&&pairs.has(i+1)&&t[i-1]?.v!=='function'&&!punct(pairs.get(i+1)+1,'{'))framework(i,...split(i+2,pairs.get(i+1))[0],'include',true);
      if(t[i].v==='preload'&&punct(i+1,':'))framework(i,i+2,expressionEnd(i+2),'webPreferences.preload');
      if(t[i].v==='webPreferences'&&punct(i+1,':')&&!punct(i+2,'{'))addGap('FRAMEWORK_WEB_PREFERENCES_UNKNOWN',file,t[i].line,'Object supplied by helper or binding; cross-file return dataflow is not inferred',{expression:text(i+2,expressionEnd(i+2))});
    }
    // loadFile is a method call; comments and string lookalikes have been removed.
    for(let i=1;i<t.length;i++)if(t[i].v==='loadFile'&&punct(i-1,'.')&&punct(i+1,'(')&&pairs.has(i+1))framework(i,...split(i+2,pairs.get(i+1))[0],'loadFile');
    if(project&&scopes.some(scope=>scope.name.startsWith('deployment:')&&scope.files.includes(file))){
      const exports=exportsIn(project);
      for(const d of s.definitions.filter(d=>d.kind==='function')){
        const f=s.functionRows.find(f=>f.index===d.index);if(!f||f.end===undefined)continue;
        const body=t.slice(f.body+1,f.end).map(x=>x.v).join('');
        if(!new RegExp('^return[A-Za-z_$][\\w$]*\\.'+d.name+'\\.apply\\(null,([A-Za-z_$][\\w$]*)\\);?$').test(body))continue;
        const defs=exports.get(d.name)??[],targets=unique(defs.map(d=>d.file));
        if(targets.length===1)addEdge('GAS_EXPORT_BRIDGE',file,d.line,targets,{names:[d.name],basis:'UNIQUE_EXPORTED_FUNCTION_NAME',definitions:defs.map(d=>({file:d.file,line:d.line}))});
        else addGap(targets.length?'GAS_GLOBAL_AMBIGUOUS':'GAS_EXPORT_BRIDGE_TARGET_UNKNOWN',file,d.line,'Bundle forwarding function has no unique source export',{name:d.name,targets});
      }
    }
  }
  const dedup=(xs,key)=>[...new Map(xs.map(x=>[key(x),x])).values()];
  const result={projects,scopes,implicitClientProjects:[...implicitProjects.values()],edges:dedup(edges,e=>JSON.stringify([e.kind,e.path,e.line,e.targets,e.names,e.scope])),gaps:dedup(gaps,g=>g.gapId),entryPoints:dedup(entryPoints,e=>JSON.stringify(e)).sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line),
    limitations:projects.length?['GAS scopes are lexical file groups, not execution proof. Simple parameter, block, catch and arrow bindings are excluded; complex destructuring, TypeScript type grammar, template interpolation, eval, with and computed global access are not fully resolved.','HTML script blocks, GAS scriptlets and literal event attributes are scanned. Entity-encoded event attributes and external DOM scripts are not resolved.','Bundle bridges are unique-name candidates, not source maps. SOURCE_EXPORT_NOT_DEPLOYMENT client targets do not prove a callable deployed function. Framework return-object dataflow across files is not inferred; helper-valued webPreferences is a gap.']:[]};
  result.byPath=new Map();for(const item of [...result.edges,...result.gaps]){if(!result.byPath.has(item.path))result.byPath.set(item.path,{edges:[],gaps:[]});result.byPath.get(item.path)[item.targets?'edges':'gaps'].push(item);}
  return result;
}
