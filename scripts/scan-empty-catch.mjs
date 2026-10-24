#!/usr/bin/env node
import {gapList} from './gap-shape.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tokens as languageTokens} from './language-static.mjs';

// A conservative lexical candidate scan, not an AST or runtime assertion.
export function tokens(source) {
  const out = [];
  let i = 0;
  const add = (value,start,end,kind='code') => out.push({value,start,end,kind});
  while (i < source.length) {
    const start=i, c=source[i], prev=out.at(-1)?.value;
    if (/\s/.test(c)) { i++; continue; }
    if (c==='/' && source[i+1]==='/') { i=source.indexOf('\n',i+2); if(i<0)i=source.length; continue; }
    if (c==='/' && source[i+1]==='*') { const end=source.indexOf('*/',i+2); if(end<0)throw Error('Unterminated comment'); i=end+2; continue; }
    if (c==="'" || c==='"' || c==='\`') {
      const quote=c; i++; let closed=false;
      while(i<source.length) {
        if(source[i]==='\\') {i+=2;continue;}
        if(source[i++]===quote){closed=true;break;}
      }
      if(!closed)throw Error('Unterminated string/template');
      add(source.slice(start,i),start,i,'literal'); continue;
    }
    if(c==='/' && (prev===undefined || ['(','[','{','=',':',',',';','!','?','return','=>','&&','||','??'].includes(prev))) {
      i++;let cls=false,closed=false;
      while(i<source.length && source[i]!=='\n'){
        if(source[i]==='\\'){i+=2;continue;}
        if(source[i]==='[')cls=true;
        if(source[i]===']')cls=false;
        if(source[i++]==='/'&&!cls){closed=true;break;}
      }
      if(!closed)throw Error('Unresolved regex literal');
      while(i<source.length&&/[a-z]/i.test(source[i]))i++;
      add(source.slice(start,i),start,i,'literal');continue;
    }
    if(/[A-Za-z_$]/.test(c)) { i++;while(i<source.length&&/[\w$]/.test(source[i]))i++;add(source.slice(start,i),start,i);continue; }
    const pair=source.slice(i,i+2);
    if(['=>','&&','||','??','?.'].includes(pair)){i+=2;add(pair,start,i);continue;}
    i++;add(c,start,i);
  }
  return out;
}
export function scanText(source,file) {
  const ts=tokens(source), stack=[], pairs=new Map(), gaps=gapList(), findings=[];
  const closing={')':'(',']':'[','}':'{'};
  for(let i=0;i<ts.length;i++){
    const t=ts[i];if(t.kind==='literal')continue;
    if(['(','[','{'].includes(t.value))stack.push(i);
    else if(Object.hasOwn(closing,t.value)){
      const start=stack.pop();
      if(start===undefined||ts[start].value!==closing[t.value])throw Error('Unbalanced lexical delimiters');
      pairs.set(start,i);pairs.set(i,start);
    }
  }
  if(stack.length)throw Error('Unclosed lexical delimiters');
  const line=offset=>source.slice(0,offset).split('\n').length;
  for(let i=0;i<ts.length;i++){
    if(ts[i].kind!=='code'||ts[i].value!=='catch')continue;
    let open=i+1;
    if(ts[open]?.value==='(')open=pairs.get(open)+1;
    if(ts[open]?.value!=='{')continue;
    const end=pairs.get(open), body=ts.slice(open+1,end);
    let kind;
    if(!body.length)kind='EMPTY_OR_COMMENT_ONLY';
    else if(body[0].value==='return'){
      let depth=0,extra=false;
      for(let k=1;k<body.length;k++){
        if(body[k].kind==='literal')continue;
        if(['(','[','{'].includes(body[k].value))depth++;
        if([')',']','}'].includes(body[k].value))depth--;
        if(body[k].value===';'&&depth===0&&k!==body.length-1)extra=true;
      }
      if(!extra)kind='RETURN_ONLY_REVIEW';
    }
    if(!kind)continue;
    const tryEnd=i-1, tryOpen=pairs.get(tryEnd);
    if(ts[tryEnd]?.value!=='}'||ts[tryOpen-1]?.value!=='try'){
      gaps.push({file,line:line(ts[i].start),reason:'Cannot associate catch with try'});continue;
    }
    const inner=ts.slice(tryOpen+1,tryEnd), calls=[];
    for(let k=0;k<inner.length-1;k++){
      if(inner[k].kind!=='code'||!/^[A-Za-z_$][\w$]*$/.test(inner[k].value))continue;
      if(['if','for','while','switch','catch','function','with'].includes(inner[k].value))continue;
      if(inner[k+1]?.value!=='(' && !(inner[k+1]?.value==='?.'&&inner[k+2]?.value==='('))continue;
      let name=inner[k].value,j=k-1;
      while(j>=1&&['.','?.'].includes(inner[j].value)&&inner[j-1].kind==='code'){
        name=inner[j-1].value+inner[j].value+name;j-=2;
      }
      calls.push({expression:name,line:line(inner[k].start)});
    }
    findings.push({file,line:line(ts[i].start),kind,
      swallowedOperation:{tryStartLine:line(ts[tryOpen].start),tryEndLine:line(ts[tryEnd].start),
        calls,source:source.slice(ts[tryOpen].end,ts[tryEnd].start).trim()},
      catchSource:source.slice(ts[open].end,ts[end].start).trim(),
      writeRelated:calls.some(c=>/(?:write|append|put|save|persist|retain|event|rename|mkdir)/i.test(c.expression)),
      observation:'Existence does not establish that an exception was thrown or swallowed.',
      limitation:kind==='RETURN_ONLY_REVIEW'?'Return expressions may call logging or rethrow helpers; inspect before classifying as silent.':null});
  }
  return {findings,gaps};
}
export function scanPython(source,file){
  const ts=languageTokens(source,true),lines=source.split('\n'),findings=[],gaps=gapList();
  const gap=(line,reason)=>gaps.push({file,line,code:'PYTHON_EXCEPT_UNKNOWN',reason});
  const indent=line=>{let column=0,alternate=0;for(const c of lines[line-1].match(/^[ \t]*/)[0]){column=c==='\t'?column+8-column%8:column+1;alternate++;}return {column,alternate};};
  // Python's alternate column count detects tab/space ambiguity at equal levels too.
  const levels=[{column:0,alternate:0}];let delimiterDepth=0,first=true,indentUnknown=false;
  for(const t of ts){
    if(t.v==='\n'){if(!delimiterDepth)first=true;continue;}
    if(first&&!delimiterDepth){
      first=false;const current=indent(t.line);let top=levels.at(-1);
      if(current.column>top.column){if(current.alternate<=top.alternate){gap(t.line,'Ambiguous tabs/spaces on indentation increase');indentUnknown=true;}levels.push(current);}
      else {
        while(levels.length>1&&current.column<levels.at(-1).column)levels.pop();top=levels.at(-1);
        if(current.column!==top.column||current.alternate!==top.alternate){gap(t.line,'Ambiguous or unmatched tabs/spaces indentation level');indentUnknown=true;}
      }
    }
    if(t.kind!=='string'){if(['(','[','{'].includes(t.v))delimiterDepth++;if([')',']','}'].includes(t.v))delimiterDepth--;}
  }
  if(indentUnknown)return {findings,gaps};
  for(const t of ts)if(t.kind==='string'&&t.end>source.length)
    gap(t.line,'Unterminated string makes the rest of this file opaque to this lexical scan');
  for(let i=0;i<ts.length;i++){
    const token=ts[i];if(token.kind!=='name'||token.v!=='except'||lines[token.line-1].trimStart().indexOf('except')!==0)continue;
    const headerIndent=indent(token.line);let ambiguous=false;
    let colon=i+1,depth=0;
    for(;colon<ts.length;colon++){
      const t=ts[colon];if(t.v==='\n')break;
      if(t.kind==='string')continue;
      if(t.v===':'&&!depth)break;
      if(['(','[','{'].includes(t.v))depth++;
      if([')',']','}'].includes(t.v))depth--;
    }
    if(ts[colon]?.v!==':'||depth){gap(token.line,'Multiline or unresolved except header');continue;}
    let end=colon+1;
    if(ts[end]?.v!=='\n')while(end<ts.length&&ts[end].v!=='\n')end++;
    else {
      for(end++;end<ts.length;end++){
        const t=ts[end];if(t.v==='\n')continue;
        const current=indent(t.line);
        if(Math.sign(current.column-headerIndent.column)!==Math.sign(current.alternate-headerIndent.alternate)){
          gap(token.line,'Ambiguous mixed tabs/spaces: indentation ordering changes when tabs are counted as one column');ambiguous=true;break;
        }
        if(current.column<=headerIndent.column)break;
      }
    }
    if(ambiguous)continue;
    const body=ts.slice(colon+1,end).filter(t=>t.v!=='\n');
    if(!body.length){gap(token.line,'Empty suite cannot be classified');continue;}
    if(body.some(t=>t.kind==='string')&&body.every(t=>t.kind==='string'||['pass','.',';'].includes(t.v))){gap(token.line,'String-only suite cannot be classified');continue;}
    if(body.at(-1)?.v===';')body.pop();
    const simple=body.length===1&&body[0].v==='pass',ellipsis=body.length===3&&body.every(t=>t.v==='.');
    if(!simple&&!ellipsis)continue;
    findings.push({file,line:token.line,kind:simple?'PASS_ONLY_REVIEW':'ELLIPSIS_ONLY_REVIEW',
      catchSource:source.slice(ts[colon].end,ts[end]?.start??source.length).trim(),
      observation:'Existence does not establish that an exception was thrown or swallowed.',
      limitation:'Python lexical candidate only; try association and runtime effects are not inferred.'});
  }
  return {findings,gaps};
}
function main(){
  if(process.argv.length!==4||process.argv[2]!=='--repo')throw Error('Usage: node scan-empty-catch.mjs --repo /absolute/repo');
  const repo=path.resolve(process.argv[3]);
  const git=args=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',maxBuffer:32*1024*1024});
  const before={status:git(['status','--porcelain']),head:git(['rev-parse','HEAD']).trim()};
  if(before.status)throw Error('Repository must start clean');
  const files=git(['ls-files','-z']).split('\0').filter(Boolean), findings=[],gaps=gapList();
  const sourceFiles=files.filter(f=>/\.(?:mjs|cjs|js|jsx|ts|tsx|py)$/.test(f)),unscannedExtensions={};
  const sourceExtensions=new Set('.pyw .pyi .go .rs .java .kt .kts .scala .sc .groovy .c .h .cc .cpp .cxx .hpp .hxx .cs .fs .fsx .vb .swift .m .mm .rb .rake .php .phtml .pl .pm .r .R .jl .lua .ex .exs .erl .hrl .hs .lhs .clj .cljs .cljc .edn .dart .vue .svelte .astro .ps1 .psm1 .psd1 .sh .bash .zsh .fish .bat .cmd .sql .f .f90 .f95 .for .pas .pp .d .zig .v .sv .vhd .vhdl .asm .s .lisp .lsp .scm .ss .rkt .ml .mli .nim .cr .coffee .cob .cbl .tcl .awk .sol .tf .tfvars'.toLowerCase().split(' '));
  for(const file of files){const ext=path.extname(file);if(!sourceFiles.includes(file)&&(sourceExtensions.has(ext.toLowerCase())||/\.(?:mjs|cjs|js|jsx|ts|tsx|py)$/i.test(file)))unscannedExtensions[ext]=(unscannedExtensions[ext]??0)+1;}
  if(Object.keys(unscannedExtensions).length)gaps.push({code:'UNSUPPORTED_SOURCE_LANGUAGES',extensions:unscannedExtensions});
  if(!sourceFiles.length)gaps.push({code:'NO_SOURCE_FILES',reason:'No supported tracked source files were scanned'});
  for(const file of sourceFiles){
    const target=path.join(repo,file);
    try {
      let at=repo;
      for(const part of file.split('/')){
        at=path.join(at,part);
        if(fs.lstatSync(at).isSymbolicLink())throw Error('Symlink refused');
      }
      const result=(file.endsWith('.py')?scanPython:scanText)(fs.readFileSync(target,'utf8'),file);
      findings.push(...result.findings);gaps.push(...result.gaps);
    }catch(e){gaps.push({file,reason:e.message});}
  }
  const after={status:git(['status','--porcelain']),head:git(['rev-parse','HEAD']).trim()};
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Repository state changed');
  console.log(JSON.stringify({schema:'empty-catch-candidates-v1',repo,measuredAt:new Date().toISOString(),
    calibration:{status:'UNCALIBRATED'},confidence:'PROVISIONAL_STATIC',
    status:!sourceFiles.length?'UNKNOWN':gaps.length?'PARTIAL':'PASS',command:[process.execPath,...process.argv.slice(1)],
    before,after,trackedFiles:files.length,scannedFiles:sourceFiles.length,unscannedExtensions,findings,gaps,
    observation:'存在不等於有在吞；existence does not establish active exception swallowing.',
    limitations:[
      'Tracked JS/TS and Python pass/ellipsis suites only. Masking is lexical, not a complete language parser.',
      'Python tabs expand to eight-column stops; ambiguous mixed indentation, multiline headers, unterminated strings, empty and string-only suites leave gaps; no Python runtime is invoked.',
      'Unscanned source extensions use a disclosed suffix inventory; extensionless or unknown-suffix code is not identified.',
      'Template literals are opaque, including interpolation; regex after a control-condition closing parenthesis is not reliably distinguished from division.',
      'Return-only candidates require semantic inspection; calls may themselves record or rethrow errors.',
      'Operation source and call locations are static candidates, not evidence that an operation failed.',
      'Other languages, untracked/ignored files, and catches that assign a fallback are outside this scan.'
    ]},null,2));
  if(gaps.length)process.exitCode=2;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length===3&&process.argv[2]==='--help'){console.log("Usage: node scan-empty-catch.mjs --repo absolute-repo");process.exit(0);}

  try{main();}catch(e){console.error(e.message);process.exitCode=1;}
}
