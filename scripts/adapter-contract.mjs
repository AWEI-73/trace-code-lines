// 接線合約: what a workflow step needs to call this route — invoke, inputs, outputs, exit/error signals,
// files touched, grants, unknowns still to trial — plus a step stub (inputs/outputs/execution_class/stop_if).
// Built only from the route model and the trial; nothing here runs anything.
const onlyIf=x=>(x.ownCtx??x.ctx??[]).some(c=>/^當 /.test(c)&&!/不成立/.test(c));
const when=x=>(x.ownCtx??x.ctx??[]).find(c=>/^當 /.test(c))?.replace(/^當 /,'')??null;
const at=x=>x.file+':'+x.line;
const short=c=>String(c??'').replace(/^global\.|^node:|^py:|^pkg:/,'').replace(/^(local|file):[^:|]*(::|\|\.?)/,'');
const GRANT={subprocess:'執行其他程式',network:'連外網',listen:'開本機連線埠','write-file':'寫檔','read-file':'讀檔',paid:'花錢','real-account':'用真帳號','mcp-tools':'模型工具'};
export function adapterContract(m){
 const e=m.entry;if(!e)return null;
 const R=m.touches?.route??[],t=m.trial?.ran?m.trial:null,c=id=>t?.cases?.find(x=>x.id===id),good=c('good'),bad=c('bad'),miss=c('missing'),empty=c('empty');
 const fmt=t?.inputs?.format??null;
 const invoke=e.kind==='bin'
  ?{kind:'command',command:(t?.display??t?.run??(e.name+' <輸入檔>')).replace('{input}','<輸入檔>').replace(/<\s*<輸入檔>/,'< <輸入檔>'),
    ...(t?.run&&t.display&&t.run!==t.display?{fromSource:t.run.replace('{input}','<輸入檔>')}:{}),stdin:!!t?.viaStdin,inferred:!!t?.inferred||!t,
    ...(m.framework?.picked?.length?{via:m.framework.picked.map(x=>x.name)}:{}),...(e.pkg?{package:e.pkg}:{})}
  :{kind:'function',import:e.lang==='python'?'import '+e.name:"require('"+e.name+"')",call:m.target?.names??null,inferred:true};
 const inputs=[{name:'輸入檔',format:fmt,how:t?.viaStdin?'標準輸入':e.kind==='bin'?'路徑參數':'函式參數'}];
 const writes=R.filter(x=>x.cap==='write-file');
 const outputs=[];
 if(good?.json?.ok)outputs.push({channel:'標準輸出',format:'JSON（'+good.json.shape+'）',checked:'試跑'});
 else if(good?.marker)outputs.push({channel:'標準輸出',format:'文字（假檔內容有帶出）',checked:'試跑'});
 else if(good?.server?.listened)outputs.push({channel:'本機 HTTP',format:good.server.gets.filter(g=>g.status<400).map(g=>new URL(g.url).pathname+(g.shape?' '+g.shape:'')).slice(0,4).join('、'),checked:'試跑'});
 else if(R.some(x=>x.cap==='stdout'))outputs.push({channel:'標準輸出',format:'未試跑',checked:'讀碼'});
 for(const w of writes.slice(0,3))outputs.push({channel:'檔案',format:short(w.canon)+' '+at(w),when:onlyIf(w)?when(w):'每次',checked:'讀碼'});
 const signals={success:good?(good.exit===0?'結束碼 0':'正常輸入回結束碼 '+good.exit)+(bad?.exit===0?'；但壞檔也回 0，成功要再檢查輸出內容':''):'未試跑',
  failure:[bad&&{case:'格式錯',exit:bad.exit,stderr:!!bad.stderr.trim(),stdoutDirty:!!bad.stdout.trim()&&!bad.json?.ok},miss&&{case:'檔案不存在',exit:miss.exit,stderr:!!miss.stderr.trim(),...(miss.changed?.length?{created:miss.changed}:{})},empty&&{case:'空輸入',exit:empty.exit}].filter(Boolean)};
 const ms=Math.max(0,...(t?.cases??[]).map(x=>x.ms??0));if(ms)signals.timeoutSuggestMs=Math.max(5000,Math.ceil(ms*5/1000)*1000);
 const files={reads:[...new Set(R.filter(x=>x.cap==='read-file').map(x=>short(x.canon)+' '+at(x)))].slice(0,4),writes:writes.slice(0,4).map(w=>({at:at(w),how:short(w.canon),when:onlyIf(w)?when(w):'每次'})),trialChanged:good?.changed??null};
 const grants=[...new Map(R.filter(x=>GRANT[x.cap]).map(x=>[x.cap,x])).values()].map(x=>{const all=R.filter(y=>y.cap===x.cap),cond=all.every(onlyIf);return {need:GRANT[x.cap],at:at(x),conditional:cond,...(cond?{when:when(x)}:{})};})
  .sort((a,b)=>a.conditional-b.conditional);
 const unknowns=(m.unknowns??[]).filter(u=>['dynamic','dynamic-call','package','unresolved-import','framework','inferred','narrow'].includes(u.kind)).map(u=>u.text.slice(0,140)).slice(0,6);
 const hard=grants.filter(g=>!g.conditional&&/連外網|花錢|用真帳號|模型工具/.test(g.need));
 const step={id:'cap.'+String(m.repo?.name??'tool').replace(/[^a-z0-9]+/gi,'_').toLowerCase()+'.'+String(e.name).replace(/^python -m /,'').replace(/[^a-z0-9]+/gi,'_').toLowerCase()+'.v1',
  inputs:[fmt?fmt+'_file':'input_file'],outputs:[good?.json?.ok?'json':good?.marker?'text':good?.server?'http':'output'],
  execution_class:hard.length?'hybrid':'deterministic',stop_if:'結束碼非 0'+(bad?.exit===0?'，或輸出不含預期內容（壞檔也回 0）':'')+(miss?.changed?.length?'，或輸入檔不存在（它會自己建檔）':'')};
 return {invoke,inputs,outputs,signals,files,grants,unknowns,step,basis:t?'讀碼＋隔離試跑':'只讀碼（未試跑）'};
}
