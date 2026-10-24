// Bounded lexical content-read candidates. Never evaluates or imports target code.
import {posix} from 'node:path';
import {tokens} from './language-static.mjs';
import {gapList} from './gap-shape.mjs';

export const dataReadCodeFile=p=>/\.(?:js|mjs|cjs|ts|tsx|jsx|mts|cts|gs|html|css)$/i.test(p);
const methods=new Set(['readFileSync','readFile','createReadStream']);
const historicalNull=()=>Object.fromEntries(['1.5.0','1.6.0','1.7.0','1.8.0','1.9.0','1.10.0','1.11.0','1.12.0'].map(v=>[v,null]));
const safe=p=>p&&p!=='.'&&p!=='..'&&!p.startsWith('../')&&!/^(?:[A-Za-z]:|\/)/.test(p)&&!/[\\:<>"|?*\x00-\x1f]/.test(p);

function stringValue(token){
  if(token?.kind!=='string'||!token.literal)return null;
  let invalid=false;
  const value=token.v.replace(/\\(?:u\{([0-9a-f]+)\}|u([0-9a-f]{4})|x([0-9a-f]{2})|(\r?\n)|([\s\S]))/gi,(_,wide,u,x,newline,c)=>{
    if(wide||u||x){const n=parseInt(wide||u||x,16);if(n>0x10ffff){invalid=true;return '';}return String.fromCodePoint(n);}
    if(newline)return '';
    const escapes={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'};
    if(/[1-9]/.test(c))invalid=true;
    return escapes[c]??c;
  });
  return invalid?null:value;
}

export function jsDataReadEdges(path,source,rows){
  const t=tokens(source,false,{regexLiterals:true}).filter(x=>x.v!=='\n'),pairs=new Map(),stack=[];
  const edges=[],gaps=gapList(),calls=[],readRanges=[],dataReadComputedSamples=[];let dataReadComputed=0;
  const punct=(i,v)=>t[i]?.kind!=='string'&&t[i]?.kind!=='regex'&&t[i]?.v===v;
  for(let i=0;i<t.length;i++){
    if(t[i].kind==='string'||t[i].kind==='regex')continue;
    if(['(','[','{'].includes(t[i].v))stack.push(i);
    else if([')',']','}'].includes(t[i].v)){const a=stack.pop();if(a!==undefined&&'([{'.indexOf(t[a].v)===')]}'.indexOf(t[i].v)){pairs.set(a,i);pairs.set(i,a);}}
  }
  const split=(a,b,separator=',')=>{const parts=[];let start=a;for(let i=a;i<b;i++){if(punct(i,separator)){parts.push([start,i]);start=i+1;}else if(pairs.get(i)>i)i=pairs.get(i);}parts.push([start,b]);return parts;};
  const text=(a,b)=>a<b?source.slice(t[a].start,t[b-1].end):'UNKNOWN';
  const unwrap=(a,b)=>{while(punct(a,'(')&&pairs.get(a)===b-1){a++;b--;}return [a,b];};
  const array=(a,b)=>{if(!punct(a,'[')||pairs.get(a)!==b-1)return null;const values=[];for(const [x,y] of split(a+1,b-1)){if(x===y&&y===b-1)continue;const v=y===x+1?stringValue(t[x]):null;if(v===null)return null;values.push(v);}return values.length<=512?values:null;};
  const arrays=new Map(),declarations=new Map();
  for(let i=0;i<t.length;i++)if(['const','let','var'].includes(t[i].v)&&t[i+1]?.kind==='name'){
    const name=t[i+1].v;declarations.set(name,(declarations.get(name)??0)+1);
    if(t[i].v==='const'&&punct(i+2,'=')&&punct(i+3,'[')&&pairs.has(i+3)){
      const end=pairs.get(i+3),values=array(i+3,end+1);
      if(values)arrays.set(name,{values,start:i,end,scope:[...pairs].filter(([a,b])=>a<i&&b>i&&punct(a,'{')).sort((a,b)=>b[0]-a[0])[0]??[-1,t.length]});
    }
  }
  // A mutable, repeated, or escaped array binding is not a literal source.
  for(const [name,binding] of arrays){
    if(declarations.get(name)!==1){arrays.delete(name);continue;}
    for(let i=0;i<t.length;i++)if(t[i].v===name&&i!==binding.start+1){
      if(punct(i+1,'=')||punct(i+1,'[')||punct(i+1,'.')&&!['map','length'].includes(t[i+2]?.v)||['(','=',',','return'].includes(t[i-1]?.v)&&!punct(i+1,'.')&&t[i-1]?.v!=='of'){arrays.delete(name);break;}
    }
  }
  // A real caller may pass the literal array to a same-file helper. Follow exactly
  // one parameter hop, only when every lexical call supplies a literal array.
  const functions=[];
  for(let i=0;i<t.length;i++)if(t[i].v==='function'&&t[i+1]?.kind==='name'&&punct(i+2,'(')){
    const close=pairs.get(i+2),body=close+1,end=pairs.get(body);
    if(close!==undefined&&punct(body,'{')&&end!==undefined)functions.push({name:t[i+1].v,nameIndex:i+1,params:split(i+3,close),body,end});
  }
  const parameterArray=(a,b)=>{
    if(b!==a+1||t[a]?.kind!=='name')return null;
    const name=t[a].v,owners=functions.filter(f=>f.body<a&&a<f.end).sort((x,y)=>y.body-x.body),f=owners[0];
    if(!f||functions.filter(g=>g.name===f.name).length!==1)return null;
    const index=f.params.findIndex(([x,y])=>y===x+1&&t[x].v===name);if(index<0)return null;
    for(let i=f.body+1;i<f.end;i++)if(t[i].v===name&&(punct(i+1,'=')&&!punct(i+2,'=')||punct(i+1,'[')||punct(i+1,'.')&&!['map','length'].includes(t[i+2]?.v)||['const','let','var'].includes(t[i-1]?.v)))return null;
    const values=[];let count=0;
    for(let i=0;i<t.length;i++)if(t[i].kind==='name'&&t[i].v===f.name&&i!==f.nameIndex){
      if(punct(i-1,'.')||!punct(i+1,'(')||!pairs.has(i+1))return null;
      const args=split(i+2,pairs.get(i+1)),arg=args[index],items=arg?array(...arg):null;
      if(!items)return null;values.push(...items);count++;
    }
    return count&&values.length<=512?[...new Set(values)]:null;
  };
  const arrayAt=(a,b)=>{const direct=array(a,b);if(direct)return direct;const v=b===a+1?arrays.get(t[a]?.v):null;return v&&v.end<a&&v.scope[0]<a&&a<v.scope[1]?v.values:parameterArray(a,b);};
  const contexts=[];
  for(let i=0;i<t.length;i++){
    if(punct(i,'.')&&t[i+1]?.v==='map'&&punct(i+2,'(')&&pairs.has(i+2)){
      const start=punct(i-1,']')?pairs.get(i-1):i-1,values=arrayAt(start,i),end=pairs.get(i+2);
      let arg=i+3,name;
      if(punct(arg,'(')&&pairs.get(arg)===arg+2){name=t[arg+1]?.v;arg+=3;}
      else if(t[arg]?.kind==='name'){name=t[arg].v;arg++;}
      if(values&&name&&punct(arg,'=')&&punct(arg+1,'>'))contexts.push({name,values,start:arg+2,end});
    }
    if(t[i].v==='for'&&punct(i+1,'(')&&['const','let'].includes(t[i+2]?.v)&&t[i+3]?.kind==='name'&&t[i+4]?.v==='of'){
      const close=pairs.get(i+1);if(close===undefined)continue;
      const values=arrayAt(i+5,close);if(!values)continue;
      let end=close+1;if(punct(end,'{'))end=pairs.get(end);else {for(;end<t.length&&!punct(end,';');end++)if(pairs.get(end)>end)end=pairs.get(end);}
      contexts.push({name:t[i+3].v,values,start:close+1,end});
    }
  }
  const bindingsAt=index=>{
    const bindings=new Map(),active=contexts.filter(c=>c.start<=index&&index<c.end);
    // One array iteration layer only; nested expansion remains explicitly unknown.
    if(active.length!==1)return bindings;
    const c=active[0];let valid=true;
    for(let i=c.start;i<c.end;i++)if(t[i].v===c.name&&(punct(i+1,'=')&&!punct(i+2,'=')&&!punct(i+2,'>')||['const','let','var','function'].includes(t[i-1]?.v)||punct(i+1,'+')&&punct(i+2,'+')||punct(i+1,'-')&&punct(i+2,'-'))){valid=false;break;}
    if(valid)bindings.set(c.name,c.values);
    return bindings;
  };
  const namespaces=new Set(['fs']),readNames=new Set(methods),pathNames=new Set(['path']),urlNames=new Set(['fileURLToPath']);
  // Accept the usual spellings and explicit ESM aliases from Node's fs/path/url modules.
  for(let i=0;i<t.length;i++)if(t[i].v==='import'&&!punct(i+1,'(')&&!punct(i+1,'.')){
    let end=i+1;while(end<t.length&&!punct(end,';')&&t[end].v!=='from')end++;
    const module=stringValue(t[end+1]);if(!module||! /^(?:node:)?(?:fs(?:\/promises)?|path|url)$/.test(module))continue;
    const isFs=/^(?:node:)?fs/.test(module);
    if(t[i+1]?.kind==='name')(isFs?namespaces:pathNames).add(t[i+1].v);
    for(let j=i+1;j<end;j++){
      if(t[j].v==='*'&&t[j+1]?.v==='as')(isFs?namespaces:pathNames).add(t[j+2]?.v);
      if(isFs&&methods.has(t[j].v))readNames.add(t[j+1]?.v==='as'?t[j+2]?.v:t[j].v);
      if(/url$/.test(module)&&t[j].v==='fileURLToPath')urlNames.add(t[j+1]?.v==='as'?t[j+2]?.v:t[j].v);
    }
  }
  const bounded=values=>values&&values.length<=512?values:null;
  const uncertain=(values,unknown)=>values?Object.assign(values,{unresolved:Boolean(unknown)}):null;
  function evaluate(a,b,bindings,depth=0){
    if(depth>24)return null;
    [a,b]=unwrap(a,b);if(a>=b)return null;
    if(b===a+1){const v=stringValue(t[a]);if(v!==null)return [{value:v,relative:false}];return bindings.get(t[a].v)?.map(value=>({value,relative:false}))??null;}
    for(let i=a;i<b;i++){
      if(pairs.get(i)>i){i=pairs.get(i);continue;}
      if(punct(i,'?')){let nested=0,j=i+1;for(;j<b;j++){if(pairs.get(j)>j){j=pairs.get(j);continue;}if(punct(j,'?'))nested++;if(punct(j,':')){if(!nested)break;nested--;}}
        const left=evaluate(i+1,j,bindings,depth+1),right=evaluate(j+1,b,bindings,depth+1);return uncertain(bounded([...(left??[]),...(right??[])]),!left||!right||left.unresolved||right.unresolved);}
    }
    const plus=split(a,b,'+');
    if(plus.length>1){let unknown=false,values=[{value:'',relative:false}];for(const [x,y] of plus){const next=evaluate(x,y,bindings,depth+1);if(!next||next.some(v=>v.relative)||values.length*next.length>512)return null;unknown||=next.unresolved;values=values.flatMap(v=>next.map(w=>({value:v.value+w.value,relative:false})));}return uncertain(values,unknown);}
    let open=a,name='';if(t[open]?.v==='new')open++;
    while(open<b&&!punct(open,'(')){name+=t[open].v;open++;}
    if(pairs.get(open)!==b-1)return null;
    const args=split(open+1,b-1);
    if(urlNames.has(name)&&args.length===1)return evaluate(...args[0],bindings,depth+1);
    if(name==='URL'&&t[a].v==='new'&&args.length===2&&text(...args[1]).replace(/\s/g,'')==='import.meta.url'){
      const values=evaluate(...args[0],bindings,depth+1);
      if(!values||values.some(v=>v.relative||/^(?:[A-Za-z][A-Za-z0-9+.-]*:|[\\/])/.test(v.value)))return null;
      try{return uncertain(values.map(v=>({value:posix.join(posix.dirname(path),decodeURIComponent(v.value.split(/[?#]/)[0])),relative:true})),values.unresolved);}catch{return null;}
    }
    if((/^(?:join|resolve)$/.test(name)||[...pathNames].some(p=>name===p+'.join'||name===p+'.resolve'))&&args.length>=2&&text(...args[0])==='__dirname'){
      let unknown=false,values=[{value:posix.dirname(path),relative:true}];
      for(const arg of args.slice(1)){const next=evaluate(...arg,bindings,depth+1);if(!next||next.some(v=>v.relative||/^(?:[A-Za-z]:|[\\/])/.test(v.value))||values.length*next.length>512)return null;unknown||=next.unresolved;values=values.flatMap(v=>next.map(w=>({value:posix.join(v.value,w.value.replaceAll('\\','/')),relative:true})));}
      return uncertain(values,unknown);
    }
    return null;
  }
  // Visible path strings only; no variable names, comments or dataflow guesses.
  function literalFragments(token,depth=0){
    if(token.kind!=='string'||depth>24)return [];
    if(token.literal)return [stringValue(token)??token.v];
    const fragments=[];let at=0;
    while(at<token.v.length){
      let open=at;
      while(open<token.v.length){if(token.v[open]==='\\'){open+=2;continue;}if(token.v.startsWith('$'+'{',open))break;open++;}
      fragments.push(token.v.slice(at,open));
      if(open>=token.v.length)break;
      const inner=tokens(token.v.slice(open+2),false,{regexLiterals:true});let nesting=1,close;
      for(const item of inner){
        if(item.kind==='string'){fragments.push(...literalFragments(item,depth+1));continue;}
        if(item.kind==='regex')continue;
        if(item.v==='{')nesting++;else if(item.v==='}'&&!--nesting){close=item;break;}
      }
      if(!close)break;
      at=open+2+close.end;
    }
    return fragments;
  }
  const codeHint=arg=>t.slice(...arg).flatMap(token=>literalFragments(token)).some(fragment=>{
    const value=fragment.replaceAll('\\','/');
    return /\.(?:js|mjs|cjs|ts|tsx|gs|html|css)(?=$|[^A-Za-z0-9_])/i.test(value)||/^(?:\.{1,2}\/)*(?:src|lib|scripts)\//i.test(value);
  });
  const executesRead=(start,end)=>calls.some(c=>c.args.some(([a,b],index)=>(c.name==='Function'?index===c.args.length-1:index===0)&&a<b&&t[a].start<=start&&end<=t[b-1].end));
  let packageRoot=posix.dirname(path);while(!rows.has(posix.join(packageRoot,'package.json'))&&packageRoot!=='.')packageRoot=posix.dirname(packageRoot);
  for(let i=0;i<t.length;i++)if(t[i].kind==='name'&&!punct(i-1,'.')){
    let end=i,name=t[i].v;while(punct(end+1,'.')&&t[end+2]?.kind==='name'){end+=2;name+='.'+t[end].v;}
    if(!punct(end+1,'(')||!pairs.has(end+1))continue;
    const close=pairs.get(end+1),args=split(end+2,close),parts=name.split('.');
    const isRead=parts.length===1?readNames.has(name):namespaces.has(parts[0])&&methods.has(parts.at(-1))&&(parts.length===2||parts.length===3&&parts[1]==='promises');
    if(!isRead){if(/^vm\.runIn(?:Context|NewContext|ThisContext)$/.test(name)||name==='Function'&&t[i-1]?.v==='new')calls.push({start:i,end:close,args,name});continue;}
    // Exclude function/method declarations, not merely calls sharing a method name.
    if(t[i-1]?.v==='function'||punct(close+1,'{'))continue;
    readRanges.push({start:t[i].start,end:t[close].end});
    const arg=args[0]??[end+2,end+2],expr=text(...arg),values=evaluate(...arg,bindingsAt(i));
    const gap=(reason,value,candidates=[])=>gaps.push({code:'DATA_READ_TARGET_UNKNOWN',path,line:t[i].line,detail:expr,data:{reason,call:name,expression:expr,...(value===undefined?{}:{value}),candidates},legacyIds:historicalNull(),legacyId:null,introducedIn:'1.12.1'});
    const executes=executesRead(t[i].start,t[close].end);
    const computed=reason=>{
      if(codeHint(arg)||executes){gap(reason);if(executes)gaps.at(-1).executes=true;}
      else{
        dataReadComputed++;
        if(dataReadComputedSamples.length<20)dataReadComputedSamples.push({path,line:t[i].line,column:t[i].start-source.lastIndexOf('\n',t[i].start-1),call:name,expression:expr,reason});
      }
    };
    if(!values){computed('COMPUTED_OR_UNSUPPORTED_PATH');continue;}
    if(values.unresolved)computed('COMPUTED_CONDITIONAL_BRANCH');
    for(const value of new Map(values.map(v=>[JSON.stringify(v),v])).values()){
      const raw=value.value.replaceAll('\\','/');
      const candidates=value.relative?[{target:posix.normalize(raw),resolvedFrom:'file-relative'}]:[{target:posix.normalize(raw),resolvedFrom:'cwd-repo-root'},...(packageRoot!=='.'?[{target:posix.normalize(posix.join(packageRoot,raw)),resolvedFrom:'cwd-package-root'}]:[])];
      const acceptable=candidates.filter(c=>! /^(?:[A-Za-z]:|[\\/])/.test(raw)&&safe(c.target));
      // Relative parent segments are legitimate for __dirname/URL, after containment normalization.
      const found=acceptable.find(c=>rows.has(c.target)&&rows.get(c.target)?.sha256!==null);
      if(!found){gap('NO_EXISTING_INVENTORY_TARGET',value.value,acceptable);continue;}
      edges.push({kind:'DATA_READ',path,line:t[i].line,specifier:value.value,targets:[found.target],exists:true,resolvedFrom:found.resolvedFrom,call:name,expression:expr,candidate:true,runtimeVerified:false,introducedIn:'1.12.1',readStart:t[i].start,readEnd:t[close].end});
    }
  }
  for(const edge of edges){
    if(executesRead(edge.readStart,edge.readEnd))edge.executes=true;
    delete edge.readStart;delete edge.readEnd;
  }
  return {edges,gaps,readRanges,dataReadComputed,dataReadComputedSamples};
}
