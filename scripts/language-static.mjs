// Lexical dependency and writer candidates. Never evaluates target code.
import {posix} from 'node:path';
import {jsResolver,resolveJsFile} from './js-resolution.mjs';
import {isBuiltin} from 'node:module';
import {projectCommandGap} from './project-config.mjs';
import {normalizeGap,gapList,legacyGapIdentity,dataGapIdentity,GAP_CONFIG_ANNOTATION_FIELDS,LEGACY_RAW_SHAPE} from './gap-shape.mjs';
export function tokens(source,python=false,{regexLiterals=false}={}) {
  const out=[];let i=0,line=1;
  while(i<source.length) {
    const start=i,l=line,c=source[i];
    if(python&&c==='\\'&&/^\\\r?\n/.test(source.slice(i))){const n=source[i+1]==='\r'?3:2;i+=n;line++;continue;}
    if(/\s/.test(c)){if(c==='\n'){out.push({v:'\n',start:i,end:i+1,line});line++;}i++;continue;}
    if((python&&c==='#')||(!python&&source.startsWith('//',i))){while(i<source.length&&source[i]!=='\n')i++;continue;}
    if(!python&&source.startsWith('/*',i)){i+=2;while(i<source.length&&!source.startsWith('*/',i)){if(source[i++]==='\n')line++;}i+=2;continue;}
    // Opt-in for output-only JS scanning; preserved closure parsing is unchanged.
    if(!python&&regexLiterals&&c==='/'){
      const previous=out.findLast(x=>x.v!=='\n');
      if(!previous||['=','(','[','{',',',':',';','!','?','|','&','return','throw','case','yield','>'].includes(previous.v)){
        let end=i+1,inClass=false,closed=false;
        for(;end<source.length&&source[end]!=='\n';end++){
          if(source[end]==='\\'){end++;continue;}
          if(source[end]==='[')inClass=true;else if(source[end]===']')inClass=false;
          else if(source[end]==='/'&&!inClass){end++;while(/[a-z]/i.test(source[end]??'')&&end<source.length)end++;closed=true;break;}
        }
        if(closed){out.push({v:source.slice(i,end),kind:'regex',start:i,end,line});i=end;continue;}
      }
    }
    let prefix='';
    if(python&&/[rbuf]/i.test(c)){const m=source.slice(i).match(/^([rbuf]{1,2})(?=['"])/i);if(m){prefix=m[1];i+=prefix.length;}}
    const q=source[i];
    if(q==="'"||q==='"'||(!python&&q?.charCodeAt(0)===96)){
      const triple=python&&source.slice(i,i+3)===q.repeat(3),delim=triple?q.repeat(3):q;i+=delim.length;const begin=i;
      while(i<source.length&&!source.startsWith(delim,i)){if(source[i]==='\\'){if(source[i+1]==='\n')line++;else if(source[i+1]==='\r'&&source[i+2]==='\n'){line++;i++;}i+=2;continue;}if(source[i]==='\n')line++;i++;}
      const v=source.slice(begin,i);i+=delim.length;
      out.push({v,kind:'string',literal:!/[f]/i.test(prefix)&&!(q.charCodeAt(0)===96&&v.includes('$'+'{')),start,end:i,line:l});continue;
    }
    i=start;
    const m=source.slice(i).match(/^[A-Za-z_$][\w$]*|^\d+(?:\.\d+)?/);
    if(m){i+=m[0].length;out.push({v:m[0],kind:'name',start,end:i,line:l});}
    else {out.push({v:c,start,end:++i,line:l});}
  }
  return out;
}
const compact=t=>t.filter(x=>x.v!=='\n');
export function callArgs(t,open) {
  const args=[[]];let depth=0;
  for(let j=open+1;j<t.length;j++){
    const v=t[j].v;
    if(!depth&&v===')')return {args:args.map(compact),end:j};
    if(!depth&&v===','){args.push([]);continue;}
    if(['(','[','{'].includes(v))depth++;
    if([')',']','}'].includes(v))depth--;
    args.at(-1).push(t[j]);
  }
  return {args:args.map(compact),end:t.length-1,unclosed:true};
}
const literal=t=>t?.length===1&&t[0].kind==='string'&&t[0].literal?t[0].v:null;
const expression=(source,t)=>t?.length?source.slice(t[0].start,t.at(-1).end):'UNKNOWN';
const dotted=(t,start)=>{let name=t[start]?.v??'',end=start;while(t[end+1]?.v==='.'&&t[end+2]?.kind==='name'){end+=2;name+='.'+t[end].v;}return {name,end};};

// A small whitelist evaluator for file-relative path syntax; never runs Python.
function filePathExpression(ts,file,bindings){
  const t=compact(ts);let i=0;
  const parent=v=>(v==='.'||v==='..'||/^(?:\.\.\/)+\.\.$/.test(v))?posix.join(v,'..'):posix.dirname(v);
  const fail=()=>{throw Error('Not a bounded __file__ path expression');};
  const combine=(a,b)=>{if(!a?.rooted||!b||b.rooted||/^(?:[A-Za-z]:|[\\/])/.test(b.value))return fail();return {value:posix.normalize(posix.join(a.value,b.value.replaceAll('\\','/'))),rooted:true,evidence:a.evidence??[]};};
  function atom(){
    let result;const token=t[i++];
    if(!token)return fail();
    if(token.v==='('){result=expr();if(t[i++]?.v!==')')return fail();}
    else if(token.kind==='string'&&token.literal)result={value:token.v,rooted:false};
    else if(token.v==='__file__')result={value:file,rooted:true,evidence:[]};
    else if(token.kind==='name'){
      let name=token.v;
      while(t[i]?.v==='.'&&['path','Path','dirname','abspath','normpath','join'].includes(t[i+1]?.v)){name+='.'+t[i+1].v;i+=2;}
      if(t[i]?.v==='('){
        i++;const args=[];if(t[i]?.v!==')'){args.push(expr());while(t[i]?.v===','){i++;args.push(expr());}}
        if(t[i++]?.v!==')')return fail();
        if(['Path','pathlib.Path','str','os.path.abspath','os.path.normpath'].includes(name)&&args.length===1)result=args[0];
        else if(name==='os.path.dirname'&&args.length===1&&args[0].rooted)result={...args[0],value:parent(args[0].value)};
        else if(name==='os.path.join'&&args.length>1)result=args.slice(1).reduce(combine,args[0]);
        else return fail();
      }else {result=bindings.get(name);if(!result)return fail();}
    }else return fail();
    while(t[i]?.v==='.'){
      const method=t[i+1]?.v;i+=2;
      if(method==='parent'&&result.rooted)result={...result,value:parent(result.value)};
      else if(method==='parents'&&result.rooted&&t[i++]?.v==='['){
        const n=Number(t[i++]?.v);if(!Number.isInteger(n)||n<0||n>100||t[i++]?.v!==']')return fail();
        for(let k=0;k<=n;k++)result={...result,value:parent(result.value)};
      }else if(['resolve','absolute'].includes(method)&&t[i++]?.v==='('&&t[i++]?.v===')'&&result.rooted){}
      else return fail();
    }
    return result;
  }
  function expr(){let a=atom();while(t[i]?.v==='/'){i++;a=combine(a,atom());}return a;}
  try{const result=expr();return i===t.length&&result.rooted?result:null;}catch{return null;}
}
function fileRelativeRoots(path,source,t,add,gap){
  const bindings=new Map(),resolved=new Map();
  resolved.bindingsAt=new Map();
  for(let i=0;i<t.length;i++){
    const first=i===0||['\n',';'].includes(t[i-1].v);
    if(first&&t[i].kind==='name'&&t[i+1]?.v==='='){
      let j=i+2,depth=0;for(;j<t.length;j++){const v=t[j].v;if(!depth&&['\n',';'].includes(v))break;if(['(','[','{'].includes(v))depth++;if([')',']','}'].includes(v))depth--;}
      const ts=t.slice(i+2,j),value=filePathExpression(ts,path,bindings);
      if(value)bindings.set(t[i].v,{...value,evidence:[...(value.evidence??[]),{path,line:t[i].line,expression:expression(source,ts),resolvedPath:value.value}]});else bindings.delete(t[i].v);
    }
    resolved.bindingsAt.set(t[i].line,new Map(bindings));
    if(t[i].kind!=='name'||t[i-1]?.v==='.')continue;
    const {name,end}=dotted(t,i);if(!/^sys\.path\.(append|insert|extend)$/.test(name)||t[end+1]?.v!=='(')continue;
    const a=callArgs(t,end+1),arg=a.args[name.endsWith('insert')?1:0]??[];
    let expressions=[arg];
    if(name.endsWith('extend')){
      if(arg[0]?.v!=='['||arg.at(-1)?.v!==']'){continue;}
      const fake=[{v:'('},...arg.slice(1,-1),{v:')'}];expressions=callArgs(fake,0).args;
    }
    const values=expressions.map(ts=>filePathExpression(ts,path,bindings));
    if(!values.length||values.some(v=>!v))continue;
    if(values.some(v=>v.value==='..'||v.value.startsWith('../')||posix.isAbsolute(v.value)||v.value.includes(':'))){
      gap('PYTHON_SYS_PATH_OUTSIDE_ROOT',t[i].line,expression(source,arg));continue;
    }
    const roots=values.map(v=>v.value==='.'?'':v.value);
    resolved.set(t[i].line,roots);
    add('PYTHON_SOURCE_ROOT',t[i].line,expression(source,arg),[],{sourceRoots:roots.map(r=>r||'.'),basis:'FILE_RELATIVE_LITERAL',evidence:values.flatMap(v=>v.evidence??[]),conditional:true,limitation:'Static candidate; branch truth and runtime path precedence not evaluated.'});
  }
  return resolved;
}


// Bounded local definitions only: never execute code or cross files.
const functionCache=new WeakMap();
export function localFunctions(t,source,python,parameterSeparators=false){
  const cacheKey=python+":"+parameterSeparators;
  if(functionCache.get(t)?.has(cacheKey))return functionCache.get(t).get(cacheKey);
  const lines=source.split('\n'),indent=line=>{let n=0;for(const c of lines[line-1].match(/^[ \t]*/)[0])n=c==='\t'?n+8-n%8:n+1;return n;};
  const functions=[];
  for(let i=0;i<t.length;i++){
    let nameAt;
    if(python){if(t[i].v!=='def'||t[i+1]?.kind!=='name')continue;nameAt=i+1;}
    else if(t[i].v==='function'&&t[i+1]?.kind==='name')nameAt=i+1;
    else if(t[i].kind==='name'&&t[i+1]?.v==='('&&!['if','for','while','switch','catch','with'].includes(t[i].v)&&['{','}',';','async','\n'].includes(t[i-1]?.v))nameAt=i;
    else continue;
    if(t[nameAt+1]?.v!=='(')continue;
    const a=callArgs(t,nameAt+1);let start=a.end+1;
    if(python){while(t[start]&&t[start].v!==':'&&t[start].v!=='\n')start++;if(t[start]?.v!==':')continue;}
    else {while(t[start]?.v==='\n')start++;if(t[start]?.v!=='{')continue;}
    let end=start+1;
    if(python){
      if(t[end]?.v!=='\n'){while(end<t.length&&t[end].v!=='\n')end++;}
      else {for(end++;end<t.length;end++)if(t[end].v!=='\n'&&indent(t[end].line)<=indent(t[i].line))break;}
    }else {let depth=1;for(;end<t.length;end++){if(t[end].kind==='string')continue;if(t[end].v==='{')depth++;if(t[end].v==='}'&&!--depth)break;}}
    const params=a.args.filter(arg=>arg.length&&!(python&&parameterSeparators&&arg.length===1&&['*','/'].includes(arg[0].v))).map(arg=>{let k=0;while(['*','.'].includes(arg[k]?.v))k++;return {name:arg[k]?.v,rest:k>0};});
    if(params.some(x=>!x.name))continue;
    functions.push({name:t[nameAt].v,nameAt,start:start+1,end,params,line:t[i].line,method:!python&&nameAt===i});
  }
  if(!functionCache.has(t))functionCache.set(t,new Map());
  functionCache.get(t).set(cacheKey,functions);
  return functions;
}
// G34: one same-file lexical function, one unconditional return, all-string literal list.
// It is a source substitution, never execution, parameter evaluation or a second hop.
export function sameFileLiteralReturn(t,source,arg,at){
  const ts=compact(arg);
  if(ts.length!==3||ts[0].kind!=='name'||ts[1].v!=='('||ts[2].v!==')')return null;
  const functions=localFunctions(t,source,true,true),matches=functions.filter(f=>f.name===ts[0].v);
  if(matches.length!==1)return null;
  const f=matches[0],lines=source.split('\n');
  if(/^\s/.test(lines[f.line-1])||t[f.nameAt-2]?.v==='async'||at>=f.start&&at<f.end)return null;
  let previous=f.nameAt-2;while(t[previous]?.v==='\n')previous--;
  // Unknown decorators, rebinding, imports and parameter shadowing prevent lexical resolution.
  if(previous>=0&&lines[t[previous].line-1]?.trim().startsWith('@'))return null;
  if(functions.some(n=>at>=n.start&&at<n.end&&n.params.some(p=>p.name===f.name)))return null;
  if(t.some((x,k)=>x.v===f.name&&k!==f.nameAt&&(t[k+1]?.v==='='&&t[k+2]?.v!=='='||['as','import','global','nonlocal','del','class'].includes(t[k-1]?.v))))return null;
  const body=t.slice(f.start,f.end),returns=body.filter(x=>x.v==='return'&&x.kind==='name');
  if(returns.length!==1||body.some(x=>['yield','def','class'].includes(x.v)&&x.kind==='name'))return null;
  const ret=returns[0],first=body.find(x=>x.v!=='\n');
  const indent=line=>lines[line-1].match(/^[ \t]*/)[0];
  if(!first||indent(ret.line)!==indent(first.line))return null;
  const index=t.indexOf(ret),value=compact(t.slice(index+1,f.end));
  if(value[0]?.v!=='['||value.at(-1)?.v!==']')return null;
  const parts=callArgs([{v:'('},...value.slice(1,-1),{v:')'}],0).args.filter(x=>x.length);
  if(!parts.length||parts.some(x=>literal(x)===null))return null;
  return {command:parts.map(literal),function:f.name,definitionLine:f.line,returnLine:ret.line};
}
// A single local assignment or exhaustive simple if/elif/else assignments inform config hints.
// This does not feed the static subprocess resolver or establish a runtime edge.
function localProjectCommands(t,source,at,arg,parameterHops=0){
  const functions=localFunctions(t,source,true,true),scopeOf=i=>functions.filter(f=>i>=f.start&&i<f.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
  const f=scopeOf(at),lines=source.split('\n');
  const indent=line=>{let n=0;for(const c of lines[line-1].match(/^[ \t]*/)[0])n=c==='\t'?n+8-n%8:n+1;return n;};
  // Indentation suites are used only as a dominance guard, never to evaluate a condition.
  const suites=[];
  if(f)for(let k=f.start;k<f.end;k++){
    if(scopeOf(k)!==f||!['if','elif','else','try','except','finally','with','for','while','match','case'].includes(t[k].v)||t[k-1]?.v!=='\n')continue;
    let colon=k+1,depth=0;
    for(;colon<f.end;colon++){const v=t[colon].v;if(!depth&&(v===':'||v==='\n'))break;if(['(','[','{'].includes(v))depth++;if([')',']','}'].includes(v))depth--;}
    if(t[colon]?.v!==':'||t[colon+1]?.v!=='\n')continue;
    let end=colon+2;for(;end<f.end;end++)if(t[end].v!=='\n'&&indent(t[end].line)<=indent(t[k].line))break;
    suites.push({kind:t[k].v,start:colon+2,end});
  }
  const dominates=(write,call)=>suites.filter(b=>write>=b.start&&write<b.end).every(b=>!['for','while','match','case'].includes(b.kind)&&call>=b.start&&call<b.end);
  function binding(name,before,appendOnly=false){
    if(!f||f.params.some(p=>p.name===name))return null;
    const indices=[];for(let k=f.start;k<f.end;k++)if(scopeOf(k)===f&&t[k].v===name&&t[k].kind==='name')indices.push(k);
    // Reject rebinding, item/attribute mutation, nonlocal/global, and unusual assignments.
    if(indices.some(k=>['global','nonlocal','del','as','for','import','def','class'].includes(t[k-1]?.v)||['.', '[', ':'].includes(t[k+1]?.v)&&!(appendOnly&&t[k+1]?.v==='.'&&['append','extend'].includes(t[k+2]?.v)&&t[k+3]?.v==='('&&k<before)))return null;
    const writes=indices.filter(k=>t[k+1]?.v==='='&&t[k+2]?.v!=='='||['+','-','*','/','|','&','%','^'].includes(t[k+1]?.v)&&t[k+2]?.v==='=');
    if(writes.length!==1)return branchBinding(name,before,indices,writes);
    const k=writes[0];if(k>=before||t[k+1]?.v!=='='||!['\n',';'].includes(t[k-1]?.v))return null;
    const first=t.slice(f.start,f.end).find(x=>x.v!=='\n');
    if(!first||!dominates(k,before))return null;
    // Do not borrow across a nested function/class or a closure write.
    if(t.slice(f.start,f.end).some(x=>['nonlocal','global','class'].includes(x.v)))return null;
    let end=k+2,depth=0;
    for(;end<f.end;end++){const v=t[end].v;if(!depth&&['\n',';'].includes(v))break;if(['(','[','{'].includes(v))depth++;if([')',']','}'].includes(v))depth--;}
    return {variants:[{tokens:compact(t.slice(k+2,end)),index:k}],uses:indices.filter(i=>i!==k)};
  }
  function branchBinding(name,before,indices,writes){
    if(!writes.length||writes.some(k=>k>=before||t[k+1]?.v!=='='))return null;
    if(t.slice(f.start,f.end).some(x=>['nonlocal','global','class'].includes(x.v)))return null;
    const first=t.slice(f.start,f.end).find(x=>x.v!=='\n');if(!first)return null;
    const base=indent(first.line);
    if(indent(t[at].line)!==base)return null;
    // Restrict each arm to a single assignment. No missing else, nested flow or side effects.
    for(let start=f.start;start<before;start++){
      if(t[start].v!=='if'||indent(t[start].line)!==base)continue;
      let cursor=start,hasElse=false;const variants=[];
      while(cursor<before&&['if','elif','else'].includes(t[cursor]?.v)){
        const kind=t[cursor].v;let colon=cursor+1,depth=0;
        for(;colon<before;colon++){const v=t[colon].v;if(v===':'&&!depth)break;if(['(','[','{'].includes(v))depth++;if([')',']','}'].includes(v))depth--;}
        if(colon>=before)break;
        let end=colon+1;
        if(t[end]?.v==='\n'){
          for(end++;end<before;end++)if(t[end].v!=='\n'&&indent(t[end].line)<=base)break;
        }else {while(end<before&&t[end].v!=='\n')end++;}
        const body=compact(t.slice(colon+1,end)),index=t.indexOf(body[0]);
        if(body[0]?.v!==name||body[1]?.v!=='='||body.slice(2).some(x=>x.v===';'||x.v==='='))break;
        variants.push({tokens:body.slice(2),index});hasElse=kind==='else';
        cursor=end;while(t[cursor]?.v==='\n')cursor++;
        if(hasElse||!['elif','else'].includes(t[cursor]?.v)||indent(t[cursor].line)!==base)break;
      }
      if(hasElse&&variants.length===writes.length&&writes.every(k=>variants.some(v=>v.index===k)))return {variants,uses:indices.filter(i=>!writes.includes(i))};
    }
    return null;
  }
  const parameterEvidence=[];
  function parameterUv(name){
    if(parameterHops||!f)return null;
    const position=f.params.findIndex(p=>p.name===name);if(position<0||f.params[position].rest)return null;
    if(t.slice(f.start,f.end).some((x,j,a)=>x.v===name&&(['global','nonlocal','del','as','for','import','def','class'].includes(a[j-1]?.v)||a[j+1]?.v==='='&&a[j+2]?.v!=='='||['+','-','*','/','|','&','%','^',':'].includes(a[j+1]?.v))))return null;
    // One same-file caller only. A method must use self in the same lexical class.
    const classOf=fn=>{
      for(let k=fn.nameAt;k>=0;k--)if(t[k].v==='class'&&(k===0||t[k-1]?.v==='\n')&&indent(t[k].line)<indent(t[fn.nameAt].line)){
        let end=k+1;while(end<t.length&&(t[end].line===t[k].line||t[end].v==='\n'||indent(t[end].line)>indent(t[k].line)))end++;
        if(fn.nameAt<end)return k;
      }
      return null;
    };
    const method=f.params[0]?.name==='self',lexicalClass=classOf(f),calls=[];
    if(functions.filter(n=>n.name===f.name&&classOf(n)===lexicalClass).length!==1)return null;
    if(t.some((x,k)=>x.v===f.name&&t[k+1]?.v==='='&&t[k+2]?.v!=='='))return null;
    for(let k=0;k<t.length;k++)if(t[k].v===f.name&&t[k+1]?.v==='('&&k!==f.nameAt){
      const caller=scopeOf(k);if(!caller||caller===f)return null;
      if(method){if(lexicalClass===null||classOf(caller)!==lexicalClass||t[k-2]?.v!=='self'||t[k-1]?.v!=='.'||caller.params[0]?.name!=='self')return null;}
      else if(t[k-1]?.v==='.'||lexicalClass!==null)return null;
      const a=callArgs(t,k+1),value=a.args[position-(method?1:0)];if(!value?.length)return null;
      // Reuse the same bounded local binding proof; disable further parameter forwarding.
      const probe=localProjectCommands(t,source,k,[{v:'['},...value,{v:','},{v:'run',kind:'string',literal:true},{v:']'}],parameterHops+1);
      if(!probe||probe[0]?.[0]!=='uv')return null;
      calls.push({line:t[k].line,expression:expression(source,value),caller:caller.name,parameter:name});
    }
    if(calls.length!==1)return null;
    parameterEvidence.push(...calls);return 'uv';
  }
  function uv(ts,before){
    if(literal(ts)==='uv')return 'uv';
    if(ts.map(x=>x.v).join('')==='shutil.which(uv)'&&ts.length===6&&literal([ts[4]])==='uv')return 'uv';
    if(ts.length!==1||ts[0].kind!=='name')return null;
    if(f?.params.some(p=>p.name===ts[0].v))return parameterUv(ts[0].v);
    const b=binding(ts[0].v,before);if(!b||b.variants.length!==1)return null;
    const value=b.variants[0].tokens;
    return literal(value)==='uv'||value.map(x=>x.v).join('')==='shutil.which(uv)'&&value.length===6&&literal([value[4]])==='uv'?'uv':null;
  }
  const ts=compact(arg);let variants=[{tokens:ts,index:at}],appendEvidence=[];
  if(ts.length===1&&ts[0].kind==='name'){
    const b=binding(ts[0].v,at,true);if(!b)return null;
    // A mutable argv passed to any other operation is not a stable local literal.
    const permitted=new Set();
    for(let k=f.start;k<f.end;k++){if(scopeOf(k)!==f||t[k].v!=='subprocess')continue;const d=dotted(t,k);if(!/^subprocess\.(run|call|Popen|check_call|check_output)$/.test(d.name)||t[d.end+1]?.v!=='(')continue;const a=callArgs(t,d.end+1).args[0];if(a?.length===1&&a[0].v===ts[0].v)permitted.add(t.indexOf(a[0]));}
    for(const k of b.uses){
      if(t[k+1]?.v!=='.'||!['append','extend'].includes(t[k+2]?.v)||t[k+3]?.v!=='(')continue;
      const call=callArgs(t,k+3);
      if(k>=at||b.variants.length!==1||k<=b.variants[0].index||call.args.length!==1||call.args[0].some(x=>x.kind==='name'&&x.v===ts[0].v))return null;
      // Only standalone tail operations; no aliases, item writes or unknown mutators.
      if(t[k-1]?.v!=='\n'||!['\n',';'].includes(t[call.end+1]?.v))return null;
      permitted.add(k);appendEvidence.push({line:t[k].line,operation:t[k+2].v,expression:expression(source,call.args[0])});
    }
    if(b.uses.some(i=>!permitted.has(i)))return null;
    variants=b.variants;
  }
  const returned=variants.map(v=>sameFileLiteralReturn(t,source,v.tokens,at));
  if(!appendEvidence.length&&returned.length===1&&returned[0]){
    const commands=[returned[0].command];commands.literalReturn=returned[0];return commands;
  }
  const commands=variants.map(({tokens:ts,index:before})=>{
    if(!['[','('].includes(ts[0]?.v)||ts.at(-1)?.v!==(ts[0].v==='['?']':')'))return null;
    const groups=callArgs([{v:'('},...ts.slice(1,-1),{v:')'}],0).args;
    if(uv(groups[0]??[],before)!=='uv')return null;
    return ['uv',...groups.slice(1).map(literal)];
  });
  if(!commands.every(c=>c&&['run','sync','lock'].includes(c[1])))return null;
  if(appendEvidence.length){for(const c of commands)c.push(null);commands.appendEvidence=appendEvidence;}
  if(parameterEvidence.length)commands.parameterEvidence=parameterEvidence;
  return commands;
}
function wrapperEdges(path,source,t,python,context,bindingsAt,add,gap){
  if(!python&&!t.some(x=>x.kind==='string'&&/^(?:node:)?child_process$/.test(x.v)))return;
  const functions=localFunctions(t,source,python),wrappers=[];
  for(const f of functions){
    const calls=[];
    for(let i=f.start;i<f.end;i++){
      if(t[i].kind!=='name'||t[i-1]?.v==='.'||functions.some(n=>n!==f&&n.start>f.start&&n.end<=f.end&&i>=n.start&&i<n.end))continue;
      const d=dotted(t,i);
      if(t[d.end+1]?.v!=='(')continue;
      const direct=python?/^subprocess\.(run|call|Popen|check_call|check_output)$/.test(d.name):/(?:^|\.)(spawn|spawnSync|execFile|execFileSync|fork)$/.test(d.name);
      if(direct)calls.push({start:i,end:callArgs(t,d.end+1).end,line:t[i].line});
    }
    if(calls.length)wrappers.push({...f,calls,depth:1});
  }
  const directWrappers=[...wrappers];
  for(const f of functions.filter(f=>!directWrappers.some(w=>w.nameAt===f.nameAt))){
    const calls=[];
    for(let i=f.start;i<f.end;i++){
      if(t[i].kind!=='name'||t[i-1]?.v==='.'||functions.some(n=>n!==f&&n.start>f.start&&n.end<=f.end&&i>=n.start&&i<n.end))continue;
      const d=dotted(t,i);if(t[d.end+1]?.v!=='(')continue;
      const matches=directWrappers.filter(w=>(d.name===w.name||!python&&w.method&&d.name==='this.'+w.name)&&w.method===f.method);
      if(matches.length!==1)continue;
      const via=matches[0],enclosing=functions.filter(n=>n.nameAt!==via.nameAt&&via.nameAt>=n.start&&via.end<=n.end);
      if(enclosing.some(n=>f.nameAt<n.start||f.end>n.end)||f.params.some(p=>p.name===via.name)||t.some((x,k)=>x.v===via.name&&t[k+1]?.v==='='&&t[k+2]?.v!=='='))continue;
      calls.push({start:i,end:callArgs(t,d.end+1).end,line:t[i].line,via});
    }
    if(calls.length)wrappers.push({...f,calls,depth:2});
  }
  function render(call,values){
    let rendered='';
    for(let k=call.start;k<=call.end;k++){
      const tk=t[k],stars=python?1:3,spread=t.slice(k,k+stars).every(x=>x.v===(python?'*':'.'))&&values.has(t[k+stars]?.v);
      if(spread){const v=values.get(t[k+stars].v);if(v.rest)rendered+=v.rest.join(', ');else if(v.arg?.[0]?.v==='['&&v.arg.at(-1)?.v===']')rendered+=expression(v.source??source,v.arg.slice(1,-1));else rendered+=(python?'*':'...')+v.text;k+=stars;}
      else if(tk.kind==='name'&&t[k-1]?.v!=='.'&&values.has(tk.v)){const v=values.get(tk.v);rendered+=v.rest?'['+v.rest.join(', ')+']':v.text;}
      else rendered+=source.slice(tk.start,tk.end);
      rendered+=' ';
    }
    return rendered;
  }
  for(let i=0;i<t.length;i++){
    if(t[i].kind!=='name'||t[i-1]?.v==='.')continue;
    const d=dotted(t,i);if(t[d.end+1]?.v!=='(')continue;
    const matches=wrappers.filter(f=>(d.name===f.name||(!python&&f.method&&d.name==='this.'+f.name))&&i!==f.nameAt&&!(i>=f.start&&i<f.end));
    if(matches.length!==1)continue;
    // A local function cannot be resolved through an unrelated nested scope or rebinding.
    const candidate=matches[0],enclosing=functions.filter(n=>n!==candidate&&candidate.nameAt>=n.start&&candidate.end<=n.end);
    const shadowed=functions.some(n=>i>=n.start&&i<n.end&&n.params.some(p=>p.name===candidate.name))||t.some((x,k)=>x.v===candidate.name&&t[k+1]?.v==='='&&t[k+2]?.v!=='=');
    if(shadowed||enclosing.some(n=>i<n.start||i>=n.end)){gap('SUBPROCESS_TARGET_UNKNOWN',t[i].line,{wrapper:candidate.name,reason:'Wrapper binding or lexical scope is unresolved.'});continue;}
    const f=matches[0],a=callArgs(t,d.end+1),values=new Map();
    const value=arg=>{
      if(python){const rooted=filePathExpression(arg,path,bindingsAt?.get(t[i].line)??new Map());if(rooted)return 'os.path.join(os.path.dirname(__file__), '+JSON.stringify(posix.relative(posix.dirname(path),rooted.value))+')';}
      return expression(source,arg);
    };
    for(let k=0;k<f.params.length;k++){const param=f.params[k];values.set(param.name,param.rest?{rest:a.args.slice(k).map(value)}:{arg:a.args[k],text:value(a.args[k]??[])});}
    for(const call of f.calls){
      let rendered=render(call,values);
      if(call.via){
        const forwarded=tokens(rendered,python),open=forwarded.findIndex(x=>x.v==='('),args=callArgs(forwarded,open).args,inner=new Map();
        for(let k=0;k<call.via.params.length;k++){const p=call.via.params[k];inner.set(p.name,p.rest?{rest:args.slice(k).map(arg=>expression(rendered,arg))}:{arg:args[k],text:expression(rendered,args[k]),source:rendered});}
        rendered=call.via.calls.map(c=>render(c,inner)).join('\n');
      }
      const code=python?rendered:"import 'node:child_process';\n"+rendered;
      const parsed=languageEdges(path,code,{...context,followWrappers:false});
      for(const edge of parsed.edges.filter(e=>e.kind==='SUBPROCESS_ARG'))add(edge.kind,t[i].line,edge.specifier,edge.targets,{...edge,path,line:t[i].line,wrapper:f.name,wrapperDepth:f.depth,wrapperDefinitionLine:f.line,subprocessLine:call.via?.calls[0]?.line??call.line});
      if(!parsed.targets.length)for(const arg of a.args){
        const joinAt=arg.findIndex((x,k)=>x.v==='join'&&arg[k+1]?.v==='(');
        const pathTail=python&&arg.some((x,k)=>x.v==='Path'&&arg[k+1]?.v==='(')&&arg.at(-2)?.v==='/'?literal(arg.slice(-1)):null;
        const tail=(literal(arg)??(joinAt<0?pathTail:literal(callArgs(arg,joinAt+1).args.at(-1))))?.replaceAll('\\','/');
        if(tail&&/\.(?:py|mjs|cjs|js|ps1)$/.test(tail)&&!tail.startsWith('../')&&!posix.isAbsolute(tail)&&!tail.includes(':')){
          const targets=[...context.rows.keys()].filter(p=>p===tail||p.endsWith('/'+tail));
          if(targets.length)add('SUBPROCESS_ARG',t[i].line,expression(source,arg),targets,{wrapper:f.name,wrapperDepth:f.depth,wrapperDefinitionLine:f.line,subprocessLine:call.via?.calls[0]?.line??call.line,candidate:true,basis:'TAIL_PATH_MATCH',runtimeVerified:false});
        }
      }
      for(const g of parsed.gaps.filter(g=>g.code.startsWith('SUBPROCESS_'))){
        const metadata={};for(const key of ['resolution','configHint','configCandidates','target'])if(g[key]!==undefined)metadata[key]=g[key];
        const detail={wrapper:f.name,wrapperDefinitionLine:f.line,subprocessLine:call.line,call:expression(source,t.slice(i,a.end+1)),reason:g.detail};
        const raw=g[LEGACY_RAW_SHAPE]??{code:g.code,detail:g.detail};
        const old={code:raw.code,path,line:t[i].line,detail:{...detail,reason:raw.detail}};
        const oldId=legacyGapIdentity(old);
        gap(g.code,t[i].line,detail,{...metadata,legacyIds:{'1.5.0':oldId,'1.6.0':oldId},[LEGACY_RAW_SHAPE]:{code:old.code,detail:old.detail}});
      }
      if(!parsed.gaps.some(g=>g.code.startsWith('SUBPROCESS_')))gap('SUBPROCESS_CWD_ENV_UNKNOWN',t[i].line,{wrapper:f.name,wrapperDefinitionLine:f.line,subprocessLine:call.line,call:expression(source,t.slice(i,a.end+1)),reason:'Wrapper invocation retained; runtime executable, cwd/env and effects are not verified.'});
    }
  }
  // A third hop remains unresolved; do not infer across the depth boundary.
  for(const f of functions.filter(f=>!wrappers.some(w=>w.nameAt===f.nameAt))){
    const forward=t.slice(f.start,f.end).some((x,k,a)=>wrappers.some(w=>w.name===x.v)&&a[k+1]?.v==='(');
    if(!forward)continue;
    for(let i=0;i<t.length;i++)if(t[i].v===f.name&&t[i+1]?.v==='('&&i!==f.nameAt&&!(i>=f.start&&i<f.end))gap('SUBPROCESS_TARGET_UNKNOWN',t[i].line,{wrapper:f.name,call:expression(source,t.slice(i,callArgs(t,i+1).end+1)),reason:'Same-file wrapper exceeds the two-hop limit or has unresolved scope; no target inferred.'});
  }
}

export function languageEdges(path,source,{rows,read,sourceRoots=['.'],followWrappers=true,resolutionCache=new Map()}={}) {
  const python=path.endsWith('.py'),t=tokens(source,python),edges=[],gaps=gapList(),external=[];
  const gap=(code,line,detail,metadata={})=>gaps.push({code,path,line,detail,...metadata});
  const add=(kind,line,specifier,targets=[],extra={})=>{edges.push({kind,path,line,specifier,targets,...extra});return targets;};
  const ext=(kind,line,specifier)=>{const builtin=!python&&isBuiltin(specifier);if(builtin)specifier='node:'+specifier.replace(/^node:/,'');external.push({kind,path,line,specifier,builtin:python?null:builtin,classification:python?'STDLIB_OR_THIRD_PARTY':builtin?'NODE_BUILTIN':'EXTERNAL_PACKAGE'});add(kind,line,specifier,[],{external:true,...(builtin?{builtin:true}:{})});};
  const valid=p=>p!=='.'&&!p.startsWith('../')&&p!=='..'&&!posix.isAbsolute(p)&&!p.includes(':');
  function jsResolve(base,visited=new Set()) {
    base=posix.normalize(base);
    if(!valid(base)||visited.has(base))return null;visited.add(base);
    const resolved=resolveJsFile(base,rows);if(resolved)return resolved;
    const pkg=base+'/package.json';
    if(rows.has(pkg)){
      try{const data=JSON.parse(read(pkg));if(typeof data.main==='string'){const target=posix.normalize(posix.join(base,data.main));if(!valid(target)){gap('UNSAFE_PACKAGE_MAIN',null,pkg);return null;}const found=jsResolve(target,visited);if(found)return found;}}
      catch(e){gap('INVALID_PACKAGE_MAIN',null,pkg+': '+e.message);}
    }
    return ['.js','.cjs','.mjs','.json'].map(e=>base+'/index'+e).find(p=>rows.has(p))??null;
  }
  function jsEdge(kind,line,spec,extra={}) {
    if(!spec.startsWith('.')){ext(kind,line,spec);return;}
    const base=posix.normalize(posix.join(posix.dirname(path),spec));
    if(!valid(base)){gap('CORE_PIN_UNSAFE_IMPORT',line,spec);return;}
    const target=jsResolve(base);add(kind,line,spec,target?[target]:[],extra);
    if(!target)gap('CORE_PIN_CLOSURE_MISSING',line,spec);
  }
  const resolvedPathMutations=python?fileRelativeRoots(path,source,t,add,gap):new Map();
  const roots=[...new Set([...sourceRoots.map(p=>p==='.'?'':p.replace(/\/$/,'')),...[...resolvedPathMutations.values()].flat()])];
  function pyAt(base) {const key='py:'+base;if(!resolutionCache.has(key))resolutionCache.set(key,[base+'/__init__.py',base+'.py'].find(p=>rows.has(p)));return resolutionCache.get(key);}
  function localModule(root,top){const key='local:'+root+':'+top;if(!resolutionCache.has(key)){const base=posix.join(root,top);resolutionCache.set(key,[...rows.keys()].some(p=>p===base+'.py'||p.startsWith(base+'/')));}return resolutionCache.get(key);}
  function parents(target,root='') {
    const parts=posix.dirname(target).split('/'),out=[];
    for(let i=1;i<=parts.length;i++){const p=parts.slice(0,i).join('/')+'/__init__.py';if((!root||p.startsWith(root+'/'))&&p!==target&&rows.has(p))out.push(p);}
    return out;
  }
  function pyResolve(spec,line,kind='STATIC_IMPORT',optional=false) {
    let bases,root='';
    if(spec.startsWith('.')){
      const dots=spec.match(/^\.+/)[0].length;
      root=[...roots].filter(r=>!r||path.startsWith(r+'/')).sort((a,b)=>b.length-a.length)[0]??'';
      let dir=posix.dirname(path);for(let n=1;n<dots;n++)dir=posix.dirname(dir);
      if(dots>posix.relative(root||'.',posix.dirname(path)).split('/').filter(p=>p&&p!=='.').length){if(!optional)gap('PYTHON_RELATIVE_ESCAPE',line,spec);return [];}
      bases=[posix.join(dir,spec.slice(dots).replaceAll('.','/'))];
    }else bases=roots.map(r=>posix.join(r,spec.replaceAll('.','/')));
    const found=bases.map(b=>({base:b,target:pyAt(b)})).filter(x=>x.target);
    if(found.length>1&&!optional)gap('PYTHON_AMBIGUOUS_SOURCE_ROOT',line,{specifier:spec,candidates:found.map(x=>x.target),chosen:found[0].target});
    if(found.length){const target=found[0].target;return add(kind,line,spec,[...parents(target,root),target]);}
    if(!optional){
      const top=spec.split('.')[0],local=roots.some(r=>localModule(r,top));
      if(spec.startsWith('.')||local)gap('PYTHON_IMPORT_UNRESOLVED',line,spec);
      else ext(kind,line,spec);
    }
    return [];
  }
  if(!python) {
    const childProcess=t.some(x=>x.kind==='string'&&/^(?:node:)?child_process$/.test(x.v));
    if(childProcess)for(let i=0;i<t.length;i++){
      if(t[i].kind!=='name'||!['spawn','spawnSync','execFile','execFileSync','fork'].includes(t[i].v)||t[i+1]?.v!=='(')continue;
      const a=callArgs(t,i+1),fork=t[i].v==='fork',program=literal(a.args[0]);
      if(!fork&&program!==null){
        const argv=a.args[1]?.[0]?.v==='['&&a.args[1].at(-1)?.v===']'?callArgs([{v:'('},...a.args[1].slice(1,-1),{v:')'}],0).args.map(literal):[];
        const configured=projectCommandGap([program,...argv],path,t[i].line,{rows,read,sourceRoots});if(configured)gaps.push(configured);
      }
      if(!fork&&program!==null&&!/(?:^|[/\\])(?:python(?:\d+(?:\.\d+)*)?|py|node)(?:\.exe)?$/i.test(program))continue;
      let args=[];
      if(fork)args=[a.args[0]??[]];
      else if(a.args[1]?.[0]?.v==='['&&a.args[1].at(-1)?.v===']')args=callArgs([{v:'('},...a.args[1].slice(1,-1),{v:')'}],0).args;
      let found=false,unknown=program===null&&!fork;
      for(const arg of args){
        const value=literal(arg);
        if(value!==null){
          if(!/\.(?:py|mjs|cjs|js)$/.test(value))continue;
          const candidates=[...new Set([posix.normalize(value),posix.normalize(posix.join(posix.dirname(path),value))])].filter(p=>valid(p)&&rows.has(p));
          add('SUBPROCESS_ARG',t[i].line,value,candidates,{operation:t[i].v,basis:'LITERAL_PATH',runtimeVerified:false});
          found ||= candidates.length>0;if(!candidates.length)unknown=true;
        }else{
          unknown=true;
          // A join tail is only a filename candidate, even with a single match.
          const joinAt=arg.findIndex((x,k)=>x.v==='join'&&arg[k+1]?.v==='(');
          const tail=joinAt<0?null:literal(callArgs(arg,joinAt+1).args.at(-1))?.replaceAll('\\','/');
          if(tail&&/\.(?:py|mjs|cjs|js)$/.test(tail)&&valid(tail)){
            const candidates=[...rows.keys()].filter(p=>p===tail||p.endsWith('/'+tail));
            add('SUBPROCESS_ARG',t[i].line,expression(source,arg),candidates,{operation:t[i].v,candidate:true,basis:'TAIL_PATH_MATCH',runtimeVerified:false});
            found ||= candidates.length>0;
          }
        }
      }
      if(unknown||!found)gap('SUBPROCESS_TARGET_UNKNOWN',t[i].line,expression(source,t.slice(i,a.end+1)));
      gap('SUBPROCESS_CWD_ENV_UNKNOWN',t[i].line,'Literal and tail candidates do not prove runtime cwd/env or execution. '+expression(source,t.slice(i,a.end+1)));
    }
    // Exclude lexically scoped, explicitly declared local assertion functions named require.
    const blocks=[{start:0,end:t.length}],stack=[blocks[0]],scopeAt=[];
    for(let k=0;k<t.length;k++){scopeAt[k]=stack.at(-1);if(t[k].kind==='string')continue;if(t[k].v==='{'){const b={start:k,end:t.length};blocks.push(b);stack.push(b);}else if(t[k].v==='}'&&stack.length>1)stack.pop().end=k;}
    const locals=[];
    for(let k=0;k<t.length;k++)if(['const','let','var'].includes(t[k].v)&&t[k+1]?.v==='require'&&t[k+2]?.v==='='){
      const rhs=t.slice(k+3,k+45);const stop=rhs.findIndex(x=>x.v===';');const body=stop<0?rhs:rhs.slice(0,stop);
      if(!body.some(x=>x.v==='createRequire')&&(body.some((x,j)=>x.v==='='&&body[j+1]?.v==='>')||body[0]?.v==='function'))locals.push(scopeAt[k]);
    }
    for(let i=0;i<t.length;i++){
      if(t[i].kind!=='name'||t[i-1]?.v==='.')continue;
      const {name,end}=dotted(t,i);
      if((name==='require'||name==='require.resolve')&&locals.some(b=>i>b.start&&i<b.end))continue;
      if(['require','require.resolve','module.require'].includes(name)&&t[end+1]?.v==='('){
        const a=callArgs(t,end+1),spec=literal(a.args[0]);
        if(spec!==null)jsEdge('STATIC_IMPORT',t[i].line,spec,{operation:name,resolutionOnly:name==='require.resolve'});
        else {add('DYNAMIC_COMPUTED',t[i].line,expression(source,a.args[0]),[],{operation:name});gap('DYNAMIC_COMPUTED',t[i].line,name+'('+expression(source,a.args[0])+')');}
      }
      if((name==='module.createRequire'||name==='createRequire')&&t[end+1]?.v==='('){
        const a=callArgs(t,end+1),spec=literal(a.args[0]);
        add(spec===null?'DYNAMIC_COMPUTED':'DYNAMIC_LITERAL',t[i].line,expression(source,a.args[0]),[],{operation:name});
        gap('CREATE_REQUIRE_BASE_UNRESOLVED',t[i].line,expression(source,a.args[0]));
      }
    }
  }else{
    for(let i=0;i<t.length;i++){
      if(t[i].kind==='string'||!['import','from'].includes(t[i].v)||t[i-1]?.v==='.')continue;
      if(i>0&&!['\n',';',':'].includes(t[i-1].v))continue; // yield-from and exception chaining are not import statements.
      let j=i+1,depth=0,body=[];
      for(;j<t.length;j++){const v=t[j].v;if(depth===0&&(v===';'||(v==='\n'&&t[j-1]?.v!=='\\')))break;if(v==='(')depth++;if(v===')')depth--;if(v!=='\n'&&v!=='\\')body.push(t[j]);}
      if(t[i].v==='import'){
        const groups=[[]];for(const x of body){if(x.v===',')groups.push([]);else groups.at(-1).push(x);}
        for(const g of groups){const at=g.findIndex(x=>x.v==='as'),spec=(at<0?g:g.slice(0,at)).map(x=>x.v).join('');if(spec)pyResolve(spec,t[i].line);}
      }else{
        const at=body.findIndex(x=>x.v==='import');if(at<0){gap('PYTHON_IMPORT_SYNTAX',t[i].line,expression(source,body));continue;}
        const spec=body.slice(0,at).map(x=>x.v).join(''),base=pyResolve(spec,t[i].line);
        const rest=body.slice(at+1).filter(x=>!['(',')'].includes(x.v));
        let next=true;for(const x of rest){if(x.v===','){next=true;continue;}if(next){if(x.v==='*')gap('PYTHON_STAR_IMPORT',x.line,spec);else if(base.length)pyResolve(spec+(spec.endsWith('.')?'':'.')+x.v,x.line,'STATIC_IMPORT',true);next=false;}}
      }
      i=j-1;
    }
    for(let i=0;i<t.length;i++){
      if(t[i].kind!=='name'||t[i-1]?.v==='.')continue;
      const {name,end}=dotted(t,i);
      if(t[end+1]?.v==='('&&(/(?:^|\.)(?:spec_from_file_location|load_source|SourceFileLoader)$/.test(name)||['exec','compile','runpy.run_path','runpy.run_module'].includes(name))){
        const a=callArgs(t,end+1);
        gap('DYNAMIC_COMPUTED',t[i].line,expression(source,t.slice(i,a.end+1)),{data:{operation:name,expression:expression(source,t.slice(i,a.end+1))}});
      }
      if(['importlib.import_module','__import__'].includes(name)&&t[end+1]?.v==='('){
        const a=callArgs(t,end+1),spec=literal(a.args[0]);
        if(spec===null){
          add('DYNAMIC_COMPUTED',t[i].line,expression(source,a.args[0]));gap('DYNAMIC_COMPUTED',t[i].line,name+'('+expression(source,a.args[0])+')');
          const arg=a.args[0],prefix=arg?.length===1&&arg[0].kind==='string'&&!arg[0].literal?arg[0].v.match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.\{[^{}]+\}$/)?.[1]:null;
          if(prefix){
            const targets=new Set();
            for(const root of roots){
              const dir=posix.join(root,prefix.replaceAll('.','/'))+'/';
              for(const p of rows.keys())if(p.startsWith(dir)&&/^(?:[A-Za-z_]\w*\.py|[A-Za-z_]\w*\/__init__\.py)$/.test(p.slice(dir.length))){
                for(const parent of parents(p,root))targets.add(parent);targets.add(p);
              }
            }
            if(targets.size)add('DYNAMIC_COMPUTED',t[i].line,expression(source,arg),[...targets].sort(),{candidate:true,basis:'FIXED_MODULE_PREFIX',runtimeVerified:false});
          }
        }
        else if(spec.startsWith('.')){add('DYNAMIC_LITERAL',t[i].line,spec);gap('PYTHON_DYNAMIC_PACKAGE_CONTEXT',t[i].line,spec);}
        else pyResolve(spec,t[i].line,'DYNAMIC_LITERAL');
      }
      if((/^subprocess\.(run|call|Popen|check_call|check_output)$/.test(name)||name==='os.system')&&t[end+1]?.v==='('){
        const a=callArgs(t,end+1),arg=a.args[0]??[];let command;const rootedPaths=new Set();
        if(literal(arg)!==null)command=literal(arg).trim().match(/"[^"]*"|'[^']*'|\S+/g)?.map(x=>x.replace(/^['"]|['"]$/g,''));
        else if(arg[0]?.v==='['&&arg.at(-1)?.v===']'){
          const groups=callArgs([{v:'('},...arg.slice(1,-1),{v:')'}],0).args;
          command=groups.map(g=>{const text=literal(g);if(text!==null)return text;if(g.map(x=>x.v).join('')==='sys.executable')return 'python';const value=filePathExpression(g,path,resolvedPathMutations.bindingsAt.get(t[i].line)??new Map())?.value;if(value!==undefined)rootedPaths.add(value);return value??null;});
        }
        const projectCommands=localProjectCommands(t,source,i,arg)??(command?[command]:[]);
        if(projectCommands.literalReturn)command=projectCommands[0];
        const annotations=projectCommands.map(c=>projectCommandGap(c,path,t[i].line,{rows,read,sourceRoots}));
        if(annotations.length&&annotations.every(Boolean)){
          const configured=annotations[0];
          if(projectCommands.literalReturn)configured.literalReturn=projectCommands.literalReturn;
          if(projectCommands.appendEvidence)configured.configHint={...configured.configHint,argvSuffixUnknown:true,appendOnlyEvidence:projectCommands.appendEvidence,limitation:'Only the initial argv prefix is established; conditional appended/extended arguments are not fully known.'};
          if(projectCommands.parameterEvidence)configured.configHint={...configured.configHint,parameterEvidence:projectCommands.parameterEvidence,limitation:'One same-file lexical caller supplies uv; other runtime callers, dispatch, executable selection and cwd/env remain unverified.'};
          if(annotations.length>1){configured.configHint={...configured.configHint,name:null,alternatives:annotations.map(g=>g.configHint)};configured.configCandidates=annotations.flatMap(g=>g.configCandidates);configured.data.commands=projectCommands;}
          gaps.push(configured);
        }
        if(command?.[0]&&!/(?:^|[/\\])(?:python(?:\d+(?:\.\d+)*)?|py)(?:\.exe)?$/i.test(command[0])){
          const interpreter=annotations.length===1&&annotations[0]?.target;
          const program=interpreter?.name??command[0];external.push({kind:interpreter?'EXTERNAL_BINARY':'EXTERNAL_COMMAND',path,line:t[i].line,program,specifier:program,classification:interpreter?'INTERPRETER':'EXTERNAL_COMMAND',expression:expression(source,arg),basis:'LITERAL_EXECUTABLE',runtimeVerified:false});
          add('EXTERNAL_COMMAND',t[i].line,program,[],{external:true,program,...(interpreter?{targetKind:'EXTERNAL_BINARY',interpreter:true}:{}),expression:expression(source,arg)});continue;
        }
        if(!command?.[0]||!/(?:^|[/\\])(?:python(?:\d+(?:\.\d+)*)?|py)(?:\.exe)?$/i.test(command[0])){
          add('SUBPROCESS_ARG',t[i].line,expression(source,arg));gap('SUBPROCESS_TARGET_UNKNOWN',t[i].line,expression(source,arg));continue;
        }
        const mi=command.indexOf('-m');
        if(mi>=0&&command[mi+1])pyResolve(command[mi+1],t[i].line,'SUBPROCESS_ARG');
        else {
          const file=command.slice(1).find(x=>x&&!x.startsWith('-')&&x.endsWith('.py'));
          if(file){const candidates=[...new Set(rootedPaths.has(file)?[posix.normalize(file)]:[posix.normalize(file),posix.normalize(posix.join(posix.dirname(path),file))])].filter(p=>valid(p)&&rows.has(p));add('SUBPROCESS_ARG',t[i].line,file,candidates,{basis:rootedPaths.has(file)?'FILE_RELATIVE_LITERAL':'LITERAL_PATH'});if(!candidates.length)gap('SUBPROCESS_TARGET_UNKNOWN',t[i].line,expression(source,arg));}
          else {add('SUBPROCESS_ARG',t[i].line,expression(source,arg));gap('SUBPROCESS_TARGET_UNKNOWN',t[i].line,expression(source,arg));}
        }
        gap('SUBPROCESS_CWD_ENV_UNKNOWN',t[i].line,'Candidates assume repo/source roots or caller directory; runtime cwd/env not evaluated. '+expression(source,a.args.flat()));
      }
      if(/^sys\.path\.(?:append|insert|extend)$/.test(name)&&!resolvedPathMutations.has(t[i].line))gap('PYTHON_SYS_PATH_MUTATION',t[i].line,name);
    }
  }
  if(followWrappers)wrapperEdges(path,source,t,python,{rows,read,sourceRoots},resolvedPathMutations.bindingsAt,add,gap);
  if(followWrappers){
    const addCandidate=(kind,line,specifier,targets,extra)=>{if(!edges.some(e=>e.kind===kind&&e.line===line&&targets.every(p=>e.targets.includes(p))))add(kind,line,specifier,targets,extra);};
    const bounded=boundedPathCandidates(path,source,t,python,rows,resolvedPathMutations.bindingsAt,addCandidate);
    if(!python)runtimeFlagEdges(path,source,t,rows,add,gap,bounded.value);
    else lazyModuleCandidates(path,source,t,pyResolve,edges);
  }
  if(python){const typeLines=typeCheckingLines(source);for(const e of [...edges,...external])if(e.kind==='STATIC_IMPORT'&&typeLines.has(e.line))e.typeOnly=true;}
  const clickGroups=new Set(),clickRegistrations=new Set();
  if(python&&t.some((x,i)=>x.v==='import'&&t[i+1]?.v==='click'&&['\n',';'].includes(t[i+2]?.v))&&!t.some((x,i)=>x.v==='click'&&t[i+1]?.v==='=')){
    const functions=localFunctions(t,source,true),unique=name=>functions.filter(f=>f.name===name).length+t.filter((x,i)=>x.v===name&&t[i+1]?.v==='=').length<=1;
    const inFunction=i=>functions.some(f=>i>=f.start&&i<f.end);
    for(let i=0;i<t.length;i++){
      if(inFunction(i))continue;
      if(t[i].kind==='name'&&t[i+1]?.v==='='&&dotted(t,i+2).name==='click.group'&&t[i+5]?.v==='('&&unique(t[i].v))clickGroups.add(t[i].v);
      if(t[i].v!=='@')continue;
      const d=dotted(t,i+1),parts=d.name.split('.');
      if(parts.length!==2||!['command','group'].includes(parts[1])||!(parts[0]==='click'||clickGroups.has(parts[0])))continue;
      let end=d.end+1;if(t[end]?.v==='(')end=callArgs(t,end).end+1;
      while(t[end]?.v==='\n')end++;
      // Known click option decorators preserve the command/group binding.
      while(t[end]?.v==='@'){
        const option=dotted(t,end+1);if(!/^click\.(?:option|argument|version_option|pass_context|pass_obj)$/.test(option.name))break;
        end=option.end+1;if(t[end]?.v==='(')end=callArgs(t,end).end+1;while(t[end]?.v==='\n')end++;
      }
      if(t[end]?.v!=='def'||!unique(t[end+1]?.v))continue;
      clickRegistrations.add(i);
      if(parts[1]==='group')clickGroups.add(t[end+1].v);
    }
  }
  const factoryMaps=new Set();
  for(let i=0;i<t.length;i++){
    if(t[i].kind==='name'&&t[i+1]?.v==='='&&t[i+2]?.v==='{'){
      let j=i+3;while(j<t.length&&t[j].v!=='}')j++;
      if(t.slice(i+3,j).some((x,k,a)=>x.kind==='string'&&a[k+1]?.v===':'&&a[k+2]?.kind==='name'))factoryMaps.add(t[i].v);
    }
    if(t[i].v==='@'&&t[i+1]?.kind==='name'){
      const d=dotted(t,i+1);
      if(clickRegistrations.has(i))add('CLI_COMMAND_REGISTRATION',t[i].line,expression(source,t.slice(i,d.end+1)),[],{informational:true,runtimeVerified:false});
      else if(/(?:^|\.)(?:tool|register\w*|action|command|group|route)$/.test(d.name))gap('REGISTRY_DISPATCH',t[i].line,expression(source,t.slice(i,d.end+1)));
    }
    if(t[i].kind==='name'&&t[i+1]?.v==='['){
      let j=i+2,depth=1;for(;j<t.length;j++){if(t[j].v==='[')depth++;if(t[j].v===']'&&!--depth)break;}
      // Annotations and capitalized generic class names are not registry lookups.
      let statement=i-1;while(statement>=0&&!['\n',';'].includes(t[statement].v))statement--;
      const prefix=t.slice(statement+1,i),def=prefix.findIndex(x=>x.v==='def'),colon=prefix.findIndex(x=>x.v===':');
      let annotation=false;
      if(def>=0&&prefix[def+2]?.v==='('){
        const header=callArgs(t,statement+1+def+2);
        if(i<header.end)annotation=prefix.slice(def+3).some(x=>x.v===':')&&!prefix.slice(prefix.map(x=>x.v).lastIndexOf(':')+1).some(x=>x.v==='=');
        else {const tail=t.slice(header.end+1,i);annotation=tail.some(x=>x.v==='>')&&!tail.some(x=>x.v===':');}
      }else if(colon>0)annotation=prefix.slice(0,colon).every((x,k)=>k%2===0?x.kind==='name'&&!['if','else','elif','while','for','try','except','with','lambda','return','case','class'].includes(x.v):x.v==='.')&&!prefix.slice(colon+1).some(x=>x.v==='=');
      const generic=/^[A-Z]/.test(t[i].v)&&t.slice(i+2,j).every(x=>x.kind==='name'?/^[A-Z]/.test(x.v)||['str','int','float','bool','list','dict','set','tuple','type'].includes(x.v):['.',',','[',']','|'].includes(x.v));
      if(/registry/i.test(t[i].v)&&!annotation&&!generic)gap('REGISTRY_DISPATCH',t[i].line,expression(source,t.slice(i,j+1)));
      if((factoryMaps.has(t[i].v)||t[i].v==='classes')&&t[j+1]?.v==='(')gap('FACTORY_DISPATCH',t[i].line,expression(source,t.slice(i,callArgs(t,j+1).end+1)));
    }
  }
  if(python&&followWrappers)annotateMultiReturns(path,source,t,gaps,{rows,read,sourceRoots});
  // Configuration is metadata on the original gap, never a second problem at a site.
  const annotated=[];
  for(const g of gaps){
    if(g.resolution&&g.code.startsWith('SUBPROCESS_')&&!g.data?.wrapper){
      const original=gaps.find(other=>other!==g&&!other.resolution&&other.code===g.code&&other.path===g.path&&other.line===g.line&&!other.data?.wrapper);
      if(original){
        const {code,path:ignoredPath,line,detail,data,legacyIds,legacyId,...metadata}=g;
        const oldData={...(original.data??{}),...(data??{})};
        // 1.8 lacked the append-only and parameter-forwarding annotations introduced in 1.9.
        const lateHint=g.configHint?.appendOnlyEvidence||g.configHint?.parameterEvidence;
        original.legacyIds={...original.legacyIds,'1.8.0':dataGapIdentity(original,undefined,lateHint?original.data??null:oldData),'1.9.0':dataGapIdentity(original,undefined,oldData)};
        const annotationFields=GAP_CONFIG_ANNOTATION_FIELDS.filter(k=>k in (data??{})&&!(k in (original.data??{})));
        Object.assign(original,metadata);
        original.data={...oldData,...(annotationFields.length?{annotationFields}:{})};
        continue;
      }
    }
    annotated.push(g);
  }
  const grouped=[],byWrapper=new Map(),legacyWrapperHeads=new Map();
  for(const g of annotated){
    if(!g.code.startsWith('SUBPROCESS_')){grouped.push(g);continue;}
    const call=g.data?.call??g.detail;
    const site={line:g.line,call,...(g.resolution?{resolution:g.resolution,...(g.configHint?{configHint:g.configHint}:{}),...(g.target?{target:g.target}:{})}:{})},key=g.data?.wrapper?JSON.stringify([path,g.data.wrapper,g.data.wrapperDefinitionLine??null]):null;
    if(!key){grouped.push({...g,callSites:[site]});continue;}
    // A split wrapper group maps back to the actual 1.7.0 merged output, not a never-emitted ID.
    const legacyKey=path+'\0'+g.data.wrapper;
    if(!legacyWrapperHeads.has(legacyKey))legacyWrapperHeads.set(legacyKey,g);
    const legacyHead=legacyWrapperHeads.get(legacyKey);
    let merged=byWrapper.get(key);
    if(!merged){merged={...g,legacyIds:{...legacyHead.legacyIds,'1.7.0':legacyGapIdentity(legacyHead)},legacyId:legacyGapIdentity(legacyHead),legacyIdBasis:'V1_7_WRAPPER_GROUP_REPRESENTATIVE',callSites:[],codes:[],occurrences:[]};byWrapper.set(key,merged);grouped.push(merged);}
    if(!merged.callSites.some(s=>s.line===site.line&&s.call===site.call))merged.callSites.push(site);
    // Retain the original code/detail/data. Per-call annotations remain on occurrences and callSites.
    if(g.resolution&&!merged.resolution){for(const key of ['resolution','configHint','configCandidates','target'])if(g[key]!==undefined)merged[key]=g[key];merged.resolutionSite=g.line;}
    if(!merged.codes.includes(g.code))merged.codes.push(g.code);
    merged.occurrences.push(g);
  }
  // Keep one independent cwd/env occurrence at the first configured call in each wrapper group.
  // Configuration resolution never discharges runtime cwd/env uncertainty; existing codes stay intact.
  for(const g of byWrapper.values()){
    const configured=g.occurrences.find(o=>o.resolution==='PROJECT_CONFIG_DEPENDENT');
    if(!configured||g.occurrences.some(o=>o.line===configured.line&&o.code==='SUBPROCESS_CWD_ENV_UNKNOWN'))continue;
    const restored=normalizeGap({code:'SUBPROCESS_CWD_ENV_UNKNOWN',path,line:configured.line,
      detail:{...configured.data,reason:'Wrapper invocation retained; runtime executable, cwd/env and effects are not verified.'},
      resolution:configured.resolution,configHint:configured.configHint,configCandidates:configured.configCandidates});
    g.occurrences.push(restored);
    if(!g.codes.includes(restored.code))g.codes.push(restored.code);
    // An occurrence alone was invisible to consumers selecting top-level gap.code.
    if(!grouped.some(o=>o.line===restored.line&&o.code===restored.code)){
      restored.legacyIds=Object.fromEntries(['1.5.0','1.6.0','1.7.0','1.8.0','1.9.0'].map(v=>[v,null]));
      restored.legacyId=null;restored.legacyIdBasis='NEW_INDEPENDENT_CWD_ENV_GAP';
      grouped.push({...restored,callSites:[{line:restored.line,call:restored.data.call,resolution:restored.resolution,configHint:restored.configHint}]});
    }
  }
  return {edges,gaps:grouped,external,targets:[...new Set(edges.flatMap(e=>e.targets))],calibration:{status:'UNCALIBRATED'},confidence:'PROVISIONAL_STATIC'};
}

// A positive local-container proof is intentionally narrower than name guessing.
function localContainers(t,source,python){
  const functions=localFunctions(t,source,python),functionAt=t.map((_,i)=>functions.filter(f=>i>=f.start&&i<f.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]);
  const assignments=new Map(),invalid=new Set(),key=(f,name)=>f.nameAt+':'+name;
  for(let i=0;i<t.length;i++){
    const f=functionAt[i];if(!f||t[i].kind!=='name'||t[i-1]?.v==='.')continue;
    const name=t[i].v,k=key(f,name);
    let start=i;while(start>f.start&&!['\n',';'].includes(t[start-1].v))start--;
    if(['global','nonlocal','del','import','from'].includes(t[start]?.v)){invalid.add(k);continue;}
    if([',',']','}',')'].includes(t[i+1]?.v)){
      let end=i+1;while(end<t.length&&!['\n',';'].includes(t[end].v))end++;
      if(t.slice(i+1,end).some((x,j,a)=>x.v==='in'||x.v==='='&&!['=','>'].includes(a[j+1]?.v))){invalid.add(k);continue;}
    }
    if(f.params.some(p=>p.name===name)||['global','nonlocal','del','as','def','class','function','import'].includes(t[i-1]?.v)||t[i+1]?.v==='in'){invalid.add(k);continue;}
    let eq=i+1;
    if(t[eq]?.v===':'){while(t[eq]&&!['=','\n',';'].includes(t[eq].v))eq++;}
    if(['+','-','*','/','|','&',':'].includes(t[eq]?.v)&&t[eq+1]?.v==='='){invalid.add(k);continue;}
    if(t[eq]?.v!=='='||['=','>'].includes(t[eq+1]?.v))continue;
    // Assignment targets must be simple statements/declarations, not kwargs or object properties.
    if(!['\n',';','{','const','let','var'].includes(t[i-1]?.v)&&i!==f.start){invalid.add(k);continue;}
    let end=eq+1,depth=0;
    for(;end<t.length;end++){const v=t[end].v;if(!depth&&['\n',';'].includes(v))break;if(t[end].kind==='string')continue;if(['(','[','{'].includes(v))depth++;if([')',']','}'].includes(v)){if(!depth)break;depth--;}}
    const rhs=compact(t.slice(eq+1,end));
    const enclosed=(open,close)=>{if(rhs[0]?.v!==open||rhs.at(-1)?.v!==close)return false;let depth=0;for(let k=0;k<rhs.length;k++){if(rhs[k].kind==='string')continue;if(rhs[k].v===open)depth++;if(rhs[k].v===close&&!--depth)return k===rhs.length-1;}return false;};
    const container=enclosed('[',']')||enclosed('{','}')||
      (python&&['set','dict','list'].includes(rhs[0]?.v)&&rhs[1]?.v==='('&&callArgs(rhs,1).end===rhs.length-1)||
      (!python&&rhs[0]?.v==='new'&&['Map','Set'].includes(rhs[1]?.v)&&rhs[2]?.v==='('&&callArgs(rhs,2).end===rhs.length-1);
    if(!container)invalid.add(k);
    else assignments.set(k,true);
  }
  return (i,name)=>{const f=functionAt[i];if(!f||name.includes('.'))return false;const k=key(f,name);return !invalid.has(k)&&assignments.has(k);};
}

export function writerCandidates(path,source) {
  const py=path.endsWith('.py'),t=tokens(source,py),out=[],isLocalContainer=localContainers(t,source,py),database=py?databaseBindings(t,source):null;
  for(let i=0;i<t.length;i++){
    if(t[i].kind!=='name'||t[i-1]?.v==='.')continue;
    const {name,end}=dotted(t,i);if(t[end+1]?.v!=='(')continue;
    const a=callArgs(t,end+1);let operation=null,target=null,db=null;
    if(py){
      if(/(?:^|\.)open$/.test(name)){
        const mode=a.args.find(x=>x[0]?.v==='mode'&&x[1]?.v==='=')?.slice(2)??a.args[1];
        if(mode&&/[wax+]/.test(literal(mode)??'')){operation='PYTHON_OPEN_WRITE';target=a.args[0];}
        else if(mode&&literal(mode)===null){operation='PYTHON_OPEN_MODE_UNKNOWN';target=a.args[0];}
      }else if(/\.(write_text|write_bytes)$/.test(name)){operation='PATH_WRITE';target=t.slice(i,end-1);}
      else if(name==='json.dump'){operation='JSON_DUMP';target=a.args[1];}
      else if(/^shutil\.(?:copy\w*|move)$/.test(name)||/^os\.(?:replace|rename)$/.test(name)){operation=name;target=a.args[1];}
      else if(/\.(?:execute|executemany|executescript)$/.test(name)){
        operation='DB_OPERATION_UNKNOWN';target=a.args[0];
      }else if(/\.(?:commit|bulk_insert_mappings|bulk_save_objects|add|add_all|update)$/.test(name)){operation='DB_MUTATION_CANDIDATE';target=a.args[0];}
    }else if(/(?:^|\.)(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|rename(?:Sync)?|copyFile(?:Sync)?)$/.test(name)){
      operation=name;target=/rename|copyFile/.test(name)?a.args[1]:a.args[0];
    }
    const receiver=name.slice(0,name.lastIndexOf('.')),mutation=/\.(?:commit|bulk_insert_mappings|bulk_save_objects|add|add_all|update|append|extend|insert|set|push)$/.test(name);
    const dbLike=/(?:^|[._])(?:session|db|cursor|conn|connection|collection|uow|repo|tx)(?:$|[._])/i.test(receiver);
    const local=mutation&&isLocalContainer(i,receiver);
    if(local){operation='LOCAL_CONTAINER_MUTATION';target=a.args[0];}
    // Retain uncertain container verbs for inspection without inflating DB candidates.
    else if(!operation&&(/\.(?:add|update)$/.test(name)||py&&/\.(?:append|extend)$/.test(name))){operation=dbLike?'DB_MUTATION_CANDIDATE':'CONTAINER_MUTATION_CANDIDATE';target=a.args[0];}
    if(py&&(/^DB_/.test(operation??'')||/\.(?:execute|executemany|executescript)$/.test(name))){
      db=database(receiver,i,a.args[0],name.split('.').at(-1));
      operation=db?(db.access==='READ'?'DB_READ':db.access==='WRITE'?'DB_WRITE_CANDIDATE':'DB_OPERATION_UNKNOWN'):'CONTAINER_MUTATION_CANDIDATE';
    }
    if(operation)out.push({id:path+':'+t[i].line+':'+t[i].start,writer:path,line:t[i].line,operation,
      ...(local?{receiverHint:'LOCAL_CONTAINER'}:/^(?:DB|CONTAINER)_MUTATION_CANDIDATE$/.test(operation)?{receiverHint:dbLike?'DB_LIKE_NAME':'UNKNOWN_RECEIVER'}:{}),
      targetExpression:expression(source,target),literalTarget:literal(target),resolvedEndpoint:db?{databaseFile:db.databaseFile,tables:db.tables}:'UNKNOWN',...(db?{access:db.access,sql:db.sql,connection:db.connection}:{}),status:'STATIC_CANDIDATE',
      snippet:source.slice(t[i].start,t[a.end]?.end??source.length).slice(0,1200),files:[],
      limitations:local?'Lexical local-container mutation; retained for inspection, not a database endpoint or runtime effect proof.':'Lexical writer candidate; receiver binding, root/cwd, readers and successful effects are not proven.'});
  }
  if(py)for(let i=0;i<t.length;i++)if(t[i].v===')'&&t[i+1]?.v==='.'&&['write_text','write_bytes','open'].includes(t[i+2]?.v)&&t[i+3]?.v==='('){
    const a=callArgs(t,i+3),method=t[i+2].v,mode=a.args.find(x=>x[0]?.v==='mode'&&x[1]?.v==='=')?.slice(2)??a.args[0];
    if(method==='open'&&!/[wax+]/.test(literal(mode)??''))continue;
    out.push({id:path+':'+t[i].line+':'+t[i].start,writer:path,line:t[i].line,operation:'PATH_'+method.toUpperCase(),targetExpression:'UNKNOWN receiver expression',literalTarget:null,resolvedEndpoint:'UNKNOWN',status:'STATIC_CANDIDATE',snippet:source.slice(Math.max(0,t[i].start-100),t[a.end].end),files:[],limitations:'Receiver/root not resolved; no execution claim.'});
  }
  return out;
}

// Supplemental JavaScript dependencies. Only resolved quoted relative import() targets enter the closure.
export function jsSupplementalEdges(path,source,rows,read,resolutionCache){
  const resolver=jsResolver(path,rows,read,resolutionCache);
  const t=tokens(source,false,{regexLiterals:true}),edges=[],external=[],gaps=gapList();
  const add=(kind,line,specifier)=>{
    if(isBuiltin(specifier)){
      specifier='node:'+specifier.replace(/^node:/,'');
      edges.push({kind,path,line,specifier,targets:[],external:true,builtin:true});
      external.push({kind,path,line,specifier,builtin:true,classification:'NODE_BUILTIN'});return;
    }
    const resolved=resolver.resolve(specifier);if(!resolved.local)return;
    const base=resolved.base;
    if(base==='..'||base.startsWith('../')||posix.isAbsolute(base)||base.includes(':'))return;
    const target=resolved.target??base; // Keep unresolved DATA_READ and DYNAMIC_IMPORT evidence.
    edges.push({kind,path,line,specifier,targets:[target],exists:rows.has(target),...(kind==='DYNAMIC_IMPORT'?{literalPath:true}:{} )});
  };
  for(let i=0;i<t.length;i++){
    if(t[i].kind==='string'||t[i-1]?.v==='.')continue;
    if(t[i].v==='import'&&t[i+1]?.v==='('){
      const a=callArgs(t,i+1),specifier=literal(a.args[0]);
      if(specifier!==null&&source[a.args[0][0].start].charCodeAt(0)!==96)add('DYNAMIC_IMPORT',t[i].line,specifier);
      else gaps.push({code:'DYNAMIC_COMPUTED',path,line:t[i].line,detail:'import('+expression(source,a.args[0])+')'});
    }else if(['import','export'].includes(t[i].v)&&t[i+1]?.v!=='.'){
      let spec=t[i+1]?.kind==='string'?t[i+1]:null;
      for(let j=i+1;!spec&&j<t.length&&t[j].v!==';';j++){
        if(t[j].v==='from'&&t[j+1]?.kind==='string'){spec=t[j+1];break;}
        if(t[j].v==='\n'&&!t.slice(i+1,j).some(x=>x.v==='{'))break;
      }
      if(spec?.literal&&isBuiltin(spec.v))add('STATIC_IMPORT',t[i].line,spec.v);
    }
    if(t[i].v==='new'&&t[i+1]?.v==='URL'&&t[i+2]?.v==='('){
      const a=callArgs(t,i+2),specifier=literal(a.args[0]);
      if(specifier?.endsWith('.json')&&a.args[1]?.map(x=>x.v).join('')==='import.meta.url')add('DATA_READ',t[i].line,specifier);
    }
  }
  return {edges,external,gaps};
}

// Bounded candidates supplement the legacy gap pass so existing identities survive.
function statementValue(t,start){
  let end=start,depth=0;
  for(;end<t.length;end++){const x=t[end];if(x.kind==='string')continue;if(!depth&&['\n',';'].includes(x.v))break;if(['(','[','{'].includes(x.v))depth++;if([')',']','}'].includes(x.v)){if(!depth)break;depth--;}}
  return compact(t.slice(start,end));
}
function typeCheckingLines(source){
  const lines=source.split('\n'),active=[],out=new Set();
  for(let i=0;i<lines.length;i++){
    const line=lines[i],trim=line.trim();if(!trim||trim.startsWith('#'))continue;
    const indent=line.match(/^[ \t]*/)[0].replaceAll('\t','        ').length;
    while(active.length&&indent<=active.at(-1))active.pop();
    if(active.length)out.add(i+1);
    if(/^if\s+(?:typing\.)?TYPE_CHECKING\s*:/.test(trim)){active.push(indent);if(trim.split(':').slice(1).join(':').trim())out.add(i+1);}
  }
  return out;
}
function literalBindings(t,source,python){
  const functions=localFunctions(t,source,python,true),scope=i=>functions.filter(f=>i>=f.start&&i<f.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]??null;
  const assignments=new Map();
  for(let i=0;i<t.length;i++){
    if(t[i].kind!=='name'||t[i-1]?.v==='.')continue;
    if(i&& !['\n',';','const','let','var'].includes(t[i-1]?.v))continue;
    let eq=i+1;if(t[eq]?.v===':'){let depth=0;while(eq<t.length){const v=t[eq].v;if(!depth&&['=','\n'].includes(v))break;if(['[','('].includes(v))depth++;if([']',')'].includes(v))depth--;eq++;}}
    if(t[eq]?.v!=='='||['=','>'].includes(t[eq+1]?.v))continue;
    const binding={name:t[i].v,index:i,scope:scope(i),value:statementValue(t,eq+1)},key=(binding.scope?.nameAt??'module')+':'+binding.name;
    if(!assignments.has(key))assignments.set(key,[]);assignments.get(key).push(binding);
  }
  function get(name,at){
    const scopes=functions.filter(f=>at>=f.start&&at<f.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start));
    for(const f of [...scopes,null]){
      if(f?.params.some(p=>p.name===name))return null;
      const bs=assignments.get((f?.nameAt??'module')+':'+name);if(!bs)continue;
      if(bs.length!==1||bs[0].index>=at)return null;
      const b=bs[0];
      // Item assignment or augmented assignment invalidates a constant/prefix.
      for(let k=b.index+1;k<at;k++)if(t[k].v===name&&scope(k)===b.scope){
        if(['+','-','*','/','|'].includes(t[k+1]?.v)&&t[k+2]?.v==='=')return null;
        if(t[k+1]?.v==='['){let j=k+2;while(j<at&&t[j].v!==']')j++;if(t[j+1]?.v==='=')return null;}
      }
      return b;
    }
    return null;
  }
  return {get,assignments,functions,scope};
}
function boundedPathCandidates(path,source,t,python,rows,bindingsAt,add){
  const bindings=literalBindings(t,source,python),functions=bindings.functions;
  const valid=p=>p&&p!=='.'&&p!=='..'&&!p.startsWith('../')&&!posix.isAbsolute(p)&&!p.includes(':')&&rows.has(p);
  function value(arg,at,depth=0){
    const ts=compact(arg??[]);if(depth>8||!ts.length)return [];
    if(python){const rooted=filePathExpression(ts,path,new Map());if(rooted)return [{path:rooted.value,basis:'FILE_RELATIVE_LITERAL'}];}
    if(ts.length===1&&ts[0].kind==='name'){
      const b=bindings.get(ts[0].v,at);if(!b)return [];
      if(python){
        // Unknown mutations can remove or replace the prefix. Append/extend cannot.
        for(let k=b.index+1;k<at;k++)if(t[k].v===b.name&&bindings.scope(k)===b.scope&&t[k+1]?.v==='.'&&t[k+3]?.v==='('&&!['append','extend'].includes(t[k+2]?.v))return [];
        // A binding in a conditional suite is usable only while still in that suite.
        const lines=source.split('\n'),indent=n=>(lines[n-1].match(/^[ \t]*/)[0].replaceAll('\t','        ').length);
        let level=indent(t[b.index].line);
        for(let line=t[b.index].line-1;line>=(b.scope?.line??1);line--){
          const text=lines[line-1].trim();if(!text||text.startsWith('#'))continue;
          const n=indent(line);if(n>=level)continue;level=n;
          if(/^(?:if|elif|else|try|except|finally|with|for|while)\b/.test(text)){
            for(let next=t[b.index].line+1;next<=t[at].line;next++)if(lines[next-1].trim()&&!lines[next-1].trim().startsWith('#')&&indent(next)<=n)return [];
          }
        }
      }
      return value(b.value,b.index,depth+1);
    }
    if(ts[0]?.v==='['&&ts.at(-1)?.v===']')return callArgs([{v:'('},...ts.slice(1,-1),{v:')'}],0).args.flatMap(a=>value(a,at,depth+1));
    if(!python){
      if(ts.slice(-2).map(x=>x.v).join('')==='.href')return value(ts.slice(0,-2),at,depth+1);
      const d=dotted(ts,0);
      if(['fileURLToPath','url.fileURLToPath'].includes(d.name)&&ts[d.end+1]?.v==='('){const a=callArgs(ts,d.end+1);if(a.end===ts.length-1)return value(a.args[0],at,depth+1);}
      if(ts[0]?.v==='new'&&ts[1]?.v==='URL'&&ts[2]?.v==='('){
        const a=callArgs(ts,2),s=literal(a.args[0]);if(a.end===ts.length-1&&s!==null&&a.args[1]?.map(x=>x.v).join('')==='import.meta.url'&&s.startsWith('.'))return [{path:posix.normalize(posix.join(posix.dirname(path),s)),basis:'MODULE_RELATIVE_URL'}];
      }
      if(['path.join','join'].includes(d.name)&&ts[d.end+1]?.v==='('){const a=callArgs(ts,d.end+1);if(a.end===ts.length-1&&a.args[0]?.map(x=>x.v).join('')==='__dirname'&&a.args.slice(1).every(x=>literal(x)!==null))return [{path:posix.join(posix.dirname(path),...a.args.slice(1).map(literal)),basis:'DIRNAME_LITERAL'}];}
    }
    const s=literal(ts);return s&&/\.(?:py|mjs|cjs|js|ts|tsx|jsx)$/.test(s)?[...new Set([posix.normalize(s),posix.join(posix.dirname(path),s)])].map(p=>({path:p,basis:'LITERAL_PATH'})):[];
  }
  const isDirect=name=>python?/^subprocess\.(?:run|call|Popen|check_call|check_output)$/.test(name):/(?:^|\.)(?:spawn|spawnSync|execFile|execFileSync|fork)$/.test(name);
  const wrappers=[];
  for(const f of functions){const params=new Set();for(let i=f.start;i<f.end;i++){if(bindings.scope(i)!==f)continue;if(t[i].kind!=='name'||t[i-1]?.v==='.')continue;const d=dotted(t,i);if(!isDirect(d.name)||t[d.end+1]?.v!=='(')continue;const a=callArgs(t,d.end+1);const relevant=python?a.args[0]:a.args[d.name.endsWith('fork')?0:1];for(const p of f.params)if(relevant?.some(x=>x.kind==='name'&&x.v===p.name))params.add(p.name);}if(params.size)wrappers.push({...f,forwarded:params});}
  function emit(values,line,extra={}){for(const v of values)if(valid(v.path))add('SUBPROCESS_ARG',line,v.path,[v.path],{candidate:true,runtimeVerified:false,basis:v.basis,...(python?{introducedIn:'1.12.0'}:{}),...extra});}
  if(python||t.some(x=>x.kind==='string'&&/^(?:node:)?child_process$/.test(x.v)))for(let i=0;i<t.length;i++){
    if(t[i].kind!=='name'||t[i-1]?.v==='.')continue;const d=dotted(t,i);if(t[d.end+1]?.v!=='(')continue;
    const a=callArgs(t,d.end+1);
    if(!python&&isDirect(d.name))emit(value(a.args[d.name.endsWith('fork')?0:1],i),t[i].line);
    const ws=wrappers.filter(f=>(d.name===f.name||!python&&f.method&&d.name==='this.'+f.name)&&i!==f.nameAt&&!(i>=f.start&&i<f.end));
    if(ws.length===1){const f=ws[0],enclosing=functions.filter(n=>n!==f&&f.nameAt>=n.start&&f.end<=n.end);if(enclosing.some(n=>i<n.start||i>=n.end)||functions.some(n=>i>=n.start&&i<n.end&&n.params.some(p=>p.name===f.name))||t.some((x,k)=>x.v===f.name&&t[k+1]?.v==='='&&t[k+2]?.v!=='='))continue;for(let k=0;k<f.params.length;k++)if(f.forwarded.has(f.params[k].name))emit(value(a.args[k],i),t[i].line,{wrapper:f.name,wrapperDepth:1,wrapperDefinitionLine:f.line});}
  }
  // Declarative stdio launch objects are candidates, not proof of a spawn.
  if(!python)for(let i=0;i<t.length;i++)if(t[i].v==='command'&&t[i+1]?.v===':'){
    let j=i+2,depth=0;for(;j<t.length;j++){const v=t[j].v;if(!depth&&v===',')break;if(['(','[','{'].includes(v))depth++;if([')',']','}'].includes(v)){if(!depth)break;depth--;}}
    const command=t.slice(i+2,j).map(x=>x.v).join('');
    if(!/^(?:process.execPath|node|python3?)$/.test(command))continue;
    while(t[++j]?.v==='\n'){}if(t[j]?.v!=='args'||t[j+1]?.v!==':'||t[j+2]?.v!=='[')continue;
    let end=j+3,nesting=1;for(;end<t.length;end++){if(t[end].v==='[')nesting++;if(t[end].v===']'&&!--nesting)break;}
    emit(value(t.slice(j+2,end+1),j),t[j].line,{basis:'DECLARED_COMMAND_ARG',operation:'command/args',runtimeVerified:false});
  }
  return {value,bindings};
}
function runtimeFlagEdges(path,source,t,rows,add,gap,pathValue){
  for(let i=0;i<t.length;i++){
    if(t[i].v!=='NODE_OPTIONS')continue;
    let start=i+1;if(![':', '='].includes(t[start]?.v))continue;start++;
    let end=start,depth=0;for(;end<t.length;end++){const x=t[end];if(x.kind==='string')continue;if(!depth&&['\n',';',',','}'].includes(x.v))break;if(['[','(','{'].includes(x.v))depth++;if([']',')','}'].includes(x.v)){if(!depth)break;depth--;}}
    let found=false;
    for(let k=start;k<end;k++)if(t[k].kind==='string'&&t[k].literal){
      for(const m of t[k].v.matchAll(/--(import|require|loader)(?:=|\s+)([^\s]*)/g)){
        let targets=[];
        if(m[2]){const spec=m[2].replace(/^['"]|['"]$/g,'');targets=[...new Set([posix.normalize(spec),posix.join(posix.dirname(path),spec)])].filter(p=>!p.startsWith('../')&&rows.has(p));}
        else if(t[k+1]?.v==='+'){
          let finish=k+2,n=0;for(;finish<end;finish++){const v=t[finish].v;if(!n&&[',',']'].includes(v))break;if(v==='(')n++;if(v===')')n--;}
          targets=pathValue(t.slice(k+2,finish),i).map(v=>v.path).filter(p=>rows.has(p));
        }
        if(targets.length){found=true;add('RUNTIME_FLAG_REFERENCE',t[i].line,m[0],targets,{candidate:true,runtimeVerified:false,flag:'--'+m[1]});}
      }
    }
    if(!found&&t.slice(start,end).some(x=>x.kind==='string'&&/--(?:import|require|loader)/.test(x.v)))gap('RUNTIME_FLAG_UNRESOLVED',t[i].line,expression(source,t.slice(start,end)));
  }
  // A literal shell command carrying NODE_OPTIONS is a disclosed lexical candidate.
  for(const tk of t)if(tk.kind==='string'&&tk.literal&&/NODE_OPTIONS\s*=/.test(tk.v))for(const m of tk.v.matchAll(/--(import|require|loader)(?:=|\s+)([^\s'";]+)/g)){
    const targets=[...new Set([posix.normalize(m[2]),posix.join(posix.dirname(path),m[2])])].filter(p=>rows.has(p));if(targets.length)add('RUNTIME_FLAG_REFERENCE',tk.line,m[0],targets,{candidate:true,runtimeVerified:false,flag:'--'+m[1]});
  }
}
function lazyModuleCandidates(path,source,t,pyResolve,edges){
  const bindings=literalBindings(t,source,true),getter=bindings.functions.find(f=>f.name==='__getattr__'&&!/^\s/.test(source.split('\n')[f.line-1]));if(!getter)return;
  for(let i=getter.start;i<getter.end;i++){
    if(t[i-1]?.v==='.')continue;
    const d=dotted(t,i);if(!['importlib.import_module','import_module'].includes(d.name)||t[d.end+1]?.v!=='(')continue;
    const a=callArgs(t,d.end+1);let arg=a.args[0],mapName,tuple=false;
    if(arg?.length===4&&arg[1].v==='['&&arg[3].v===']')mapName=arg[0].v;
    if(arg?.length===1){
      for(let k=getter.start;k<i;k++)if(t[k].v===arg[0].v&&t[k+1]?.v===','&&t[k+3]?.v==='='&&t[k+5]?.v==='['){mapName=t[k+4].v;tuple=true;}
      const b=bindings.get(arg[0].v,i);if(b?.value[1]?.v==='[')mapName=b.value[0].v;
    }
    if(!mapName)continue;const b=bindings.get(mapName,i);if(!b||b.scope||b.value[0]?.v!=='{'||b.value.at(-1)?.v!=='}')continue;
    const entries=callArgs([{v:'('},...b.value.slice(1,-1),{v:')'}],0).args.filter(x=>x.length),modules=[];
    for(const entry of entries){if(entry[0]?.kind!=='string'||entry[1]?.v!==':'){modules.length=0;break;}const v=entry.slice(2),module=tuple&&v[0]?.v==='('?literal(callArgs(v,0).args[0]):literal(v);if(!module){modules.length=0;break;}modules.push(module);}
    for(const module of modules){const before=edges.length;pyResolve(module,t[i].line,'DYNAMIC_LITERAL');for(const e of edges.slice(before))Object.assign(e,{candidate:true,runtimeVerified:false,basis:'PEP562_LITERAL_MAP',lazyExport:true});}
  }
  // One PEP 562 edge per source/target/kind; retain every original occurrence.
  const unique=new Map(),compacted=[];
  for(const edge of edges){
    if(edge.basis!=='PEP562_LITERAL_MAP'){compacted.push(edge);continue;}
    for(const target of edge.targets){
      const key=JSON.stringify([edge.path,target,edge.kind]);let saved=unique.get(key);
      if(!saved){saved={...edge,targets:[target],occurrences:0,sites:[]};unique.set(key,saved);compacted.push(saved);}
      saved.occurrences++;
      const site=saved.sites.find(s=>s.line===edge.line&&s.specifier===edge.specifier);
      if(site)site.occurrences++;else saved.sites.push({line:edge.line,specifier:edge.specifier,occurrences:1});
    }
  }
  edges.splice(0,edges.length,...compacted);
}

function databaseBindings(t,source){
  const lex=literalBindings(t,source,true),scopes=lex.functions;
  const imports=new Map();
  for(const line of source.split('\n')){
    let m=line.match(/^\s*import\s+(sqlite3|aiosqlite|sqlalchemy)(?:\s+as\s+(\w+))?/);if(m)imports.set(m[2]??m[1],m[1]);
    m=line.match(/^\s*from\s+(sqlite3|aiosqlite|sqlalchemy(?:\.\w+)*)\s+import\s+(.+)/);if(m)for(const p of m[2].split(',')){const a=p.trim().match(/^(\w+)(?:\s+as\s+(\w+))?/);if(a)imports.set(a[2]??a[1],m[1]+'.'+a[1]);}
  }
  const qualified=name=>{const [first,...rest]=name.split('.');return imports.has(first)?[imports.get(first),...rest].join('.'):null;};
  const records=[];
  function stringValue(ts,at){
    ts=compact(ts??[]);while(ts[0]?.v==='('&&ts.at(-1)?.v===')')ts=ts.slice(1,-1);
    if(ts.length&&ts.every(x=>x.kind==='string'&&x.literal))return ts.map(x=>x.v).join('');
    if(ts.length===1){const b=lex.get(ts[0].v,at);if(b&&!b.scope&&b.value.every(x=>x.kind==='string'&&x.literal))return b.value.map(x=>x.v).join('');if(b&&b.value[0]?.v==='(')return stringValue(b.value,b.index);}
    return null;
  }
  function find(receiver,at){const f=lex.scope(at);const matches=records.filter(r=>r.name===receiver&&r.scope===f&&r.index<at);return matches.at(-1)??null;}
  function origin(ts,at){
    ts=compact(ts??[]);if(ts[0]?.v==='await')ts=ts.slice(1);while(ts[0]?.v==='(')ts=ts.slice(1);
    const d=dotted(ts,0),q=qualified(d.name);
    if(d.name==='closing'&&ts[d.end+1]?.v==='(')return origin(callArgs(ts,d.end+1).args[0],at);
    if(ts[d.end+1]?.v==='('){
      const a=callArgs(ts,d.end+1);
      if(q&&/^(?:sqlite3|aiosqlite)\.connect$/.test(q))return {databaseFile:stringValue(a.args[0],at)??'UNKNOWN',connectionExpression:expression(source,a.args[0]),origin:q,originLine:t[at].line};
      if(q&&/^sqlalchemy(?:\.\w+)*\.(?:create_engine|Session|sessionmaker)$/.test(q))return {databaseFile:q.endsWith('create_engine')?(stringValue(a.args[0],at)??'UNKNOWN'):'UNKNOWN',connectionExpression:expression(source,a.args[0]),origin:q,originLine:t[at].line};
      if(d.name.endsWith('.cursor'))return find(d.name.slice(0,-7),at);
      const callable=find(d.name,at);if(callable&&/Session|sessionmaker|create_engine/.test(callable.origin))return callable;
    }
    return find(d.name,at);
  }
  for(let i=0;i<t.length;i++){
    if(t[i].kind!=='name'||t[i-1]?.v==='.')continue;
    const d=dotted(t,i),scope=lex.scope(i);
    if(t[d.end+1]?.v==='='){
      const o=origin(statementValue(t,d.end+2),i);records.push({name:d.name,index:i,scope,...(o??{invalid:true})});
    }
    if(t[i].v==='with'){
      // Split context managers before binding: the first item need not be a connection.
      let items;
      if(t[i+1]?.v==='(')items=callArgs(t,i+1).args;
      else {
        items=[[]];let depth=0;
        for(let k=i+1;k<t.length;k++){
          const x=t[k];if(!depth&&[':', '\n'].includes(x.v))break;
          if(!depth&&x.v===','){items.push([]);continue;}
          items.at(-1).push(x);
          if(x.kind!=='string'){if(['(','[','{'].includes(x.v))depth++;if([')',']','}'].includes(x.v))depth--;}
        }
      }
      for(const item of items){const a=item.findIndex(x=>x.v==='as');if(a<0||item[a+1]?.kind!=='name')continue;
        const o=origin(item.slice(0,a),i);if(o)records.push({name:item[a+1].v,index:t.indexOf(item[a+1]),scope,...o});
      }
    }
    if(t[i+1]?.v===':'){
      const ty=dotted(t,i+2),q=qualified(ty.name);
      if(q&&/^(?:sqlite3\.Connection|sqlite3\.Cursor|sqlalchemy(?:\.\w+)*\.Session)$/.test(q))records.push({name:t[i].v,index:i,scope:scopes.find(f=>i>f.nameAt&&i<f.start)??scope,databaseFile:'UNKNOWN',connectionExpression:ty.name,origin:q,originLine:t[i].line,declaredConnectionType:true});
    }
  }
  return (receiver,at,sqlTokens,method)=>{
    const binding=find(receiver,at),sql=stringValue(sqlTokens,at);
    const proven=binding&&!binding.invalid;
    const normalized=sql?.replace(/^\s*(?:--[^\n]*\n\s*)*/,'').trim();
    let access='UNKNOWN';
    if(/^(?:SELECT|COUNT|SHOW)\b/i.test(normalized??''))access='READ';
    else if(/^(?:INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|DROP|ALTER)\b/i.test(normalized??'')||proven&&['add','add_all','bulk_insert_mappings','bulk_save_objects','commit','update'].includes(method))access='WRITE';
    if(!proven&&(!['execute','executemany','executescript'].includes(method)||access==='UNKNOWN'))return null;
    const tables=sql?[...new Set([...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?)\s+["`\[]?([A-Za-z_]\w*(?:\.\w+)?)/gi)].map(m=>m[1]))]:[];
    return {access,sql:sql??'UNKNOWN',databaseFile:proven?binding.databaseFile:'UNKNOWN',tables:tables.length?tables:['UNKNOWN'],connection:proven?{origin:binding.origin,line:binding.originLine,expression:binding.connectionExpression,declaredConnectionType:binding.declaredConnectionType??false}:'UNKNOWN'};
  };
}

function annotateMultiReturns(path,source,t,gaps,context){
  const lex=literalBindings(t,source,true);
  for(let i=0;i<t.length;i++){
    if(t[i].v!=='subprocess'||t[i+1]?.v!=='.'||!['run','call','Popen','check_call','check_output'].includes(t[i+2]?.v)||t[i+3]?.v!=='(')continue;
    const a=callArgs(t,i+3);let arg=a.args[0];
    if(arg?.length===1){const b=lex.get(arg[0].v,i);if(!b||b.scope!==lex.scope(i))continue;arg=b.value;}
    if(arg?.length!==3||arg[1]?.v!=='('||arg[2]?.v!==')')continue;
    const matches=lex.functions.filter(f=>f.name===arg[0].v&&!/^\s/.test(source.split('\n')[f.line-1]));if(matches.length!==1)continue;
    const f=matches[0],body=t.slice(f.start,f.end);
    if(body.some(x=>x.kind==='name'&&['yield','def','class','global','nonlocal'].includes(x.v)))continue;
    if(lex.functions.some(n=>i>=n.start&&i<n.end&&n.params.some(p=>p.name===f.name)))continue;
    if(t.some((x,k)=>x.v===f.name&&k!==f.nameAt&&(t[k+1]?.v==='='||['as','import','del','class'].includes(t[k-1]?.v))))continue;
    let prior=f.nameAt-2;while(t[prior]?.v==='\n')prior--;if(source.split('\n')[t[prior]?.line-1]?.trim().startsWith('@'))continue;
    const returns=body.filter(x=>x.kind==='name'&&x.v==='return');if(!returns.length)continue;
    const commands=[];let valid=true;
    for(const ret of returns){
      const index=t.indexOf(ret),v=statementValue(t,index+1);if(v[0]?.v!=='['||v.at(-1)?.v!==']'){valid=false;break;}
      const parts=callArgs([{v:'('},...v.slice(1,-1),{v:')'}],0).args.filter(x=>x.length),command=[];
      for(const p of parts){let value=literal(p);if(value===null&&p.length===1){const b=lex.get(p[0].v,index);if(b&&!b.scope){value=literal(b.value);if(value===null&&b.value.length===5&&b.value[0].kind==='string'&&b.value[0].literal&&b.value.slice(1).map(x=>x.v).join('')==='.strip()')value=b.value[0].v.trim();}}if(value===null){valid=false;break;}command.push(value);}
      if(!valid)break;commands.push({argv:command,returnLine:ret.line});
    }
    if(!valid||!commands.length)continue;
    const gs=gaps.filter(g=>g.line===t[i].line&&g.code==='SUBPROCESS_TARGET_UNKNOWN'&&!g.data?.wrapper);
    if(!gs.length)continue;
    const annotations=commands.map(c=>projectCommandGap(c.argv,path,t[i].line,context));
    if(annotations.some(x=>!x))continue;
    for(const g of gs){
      g.resolution='PROJECT_CONFIG_DEPENDENT';
      g.configHint={file:'pyproject.toml',name:null,sections:[],basis:'Literal return alternatives; launcher/branch selection is not evaluated',alternatives:commands.map(c=>({command:c.argv,returnLine:c.returnLine,interpreter:c.argv.includes('python')?'python':null,codeMode:c.argv.includes('-c')}))};
      g.configCandidates=annotations.flatMap(x=>x.configCandidates??[]);
      g.literalReturn={function:f.name,definitionLine:f.line,returnLines:returns.map(r=>r.line),candidate:true,runtimeVerified:false};
    }
  }
}
