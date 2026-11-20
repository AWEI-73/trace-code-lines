import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {tokens,callArgs} from './language-static.mjs';
import {functionRanges,endExpression} from './boundary.mjs';
import {readBounded,noLinks,sha256,safeName,walkDirectory} from './walker.mjs';
import {gitRead} from './git-evidence.mjs';
import {discoverEntries} from './discover-entries.mjs';
import {scanStopSites,scanPromptSites,effectCategory} from './stop-sites.mjs';
import {summaryLine} from './cli-output.mjs';

const codeFile=f=>/\.(?:[cm]?[jt]sx?|py)$/i.test(f);
const secretFile=f=>/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i.test(f);
const folderSecret=f=>secretFile(f)||/(?:^|\/)(?:\.env[^/]*|credentials[^/]*|secrets?[^/]*|private[-_]?key[^/]*|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.[^/]*)?|[^/]*\.local\.json)$/i.test(f);
const secretName=s=>/(?:token|secret|password|passwd|api_?key|private_?key|credential)/i.test(s);
const keyPattern=()=>/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{16,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g;
const privatePattern=()=>/-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z ]* )?PRIVATE KEY-----|$)/g;
const mask=s=>s.slice(0,4)+'…（長度 '+s.length+'）';
// All source literals are masked, not just recognized credential providers.
export function redact(text){
 return String(text).replace(privatePattern(),mask).replace(keyPattern(),mask)
  .replace(/(['"`])([^'"`\r\n]*)\1/g,(_,q,v)=>q+mask(v)+q)
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,mask)
  .replace(/([A-Z]:[\\/]Users[\\/])[^\\/\s]+/gi,'$1[帳號已遮蔽]');
}
let excerptCache={};
const excerpt=(body,line,file)=>{
 if(excerptCache.body===body&&excerptCache.file===file)return excerptCache.lines[line-1]??'';
 // Redact whole multiline secrets before selecting a line; preserve line count.
 let safe=body.replace(privatePattern(),s=>mask(s)+'\n'.repeat((s.match(/\n/g)??[]).length));
 // 1.37 prototype: comments are masked like strings so target text addressed to an agent never reaches the reader verbatim.
 const all=tokens(safe,file?.endsWith('.py'),{regexLiterals:true}),edits=all.filter(t=>t.kind==='string').map(t=>({start:t.start,end:t.end,text:mask(t.v).replace(/[\r\n]/g,' ')}));
 for(let k=0,from=0;k<=all.length;k++){const to=k<all.length?all[k].start:safe.length,gap=safe.slice(from,to);if(gap.trim())edits.push({start:from+gap.search(/\S/),end:to-(gap.length-gap.trimEnd().length),text:'〔註解已遮蔽，長度 '+gap.trim().length+'〕'});if(k<all.length)from=all[k].end;}
 for(const e of edits.sort((a,b)=>b.start-a.start)){const raw=safe.slice(e.start,e.end);safe=safe.slice(0,e.start)+e.text+'\n'.repeat((raw.match(/\n/g)??[]).length)+safe.slice(e.end);}
 const lines=safe.split(/\r?\n/).map(s=>redact(s).slice(0,260));excerptCache={body,file,lines};return lines[line-1]??'';
};
const anchor=(file,line,body)=>({file,line,lineSha256:sha256(body.split(/\r?\n/)[line-1]??''),sourceSha256:sha256(body)});
function candidate(category,file,line,body,why,confirm,extra={}){
 return {candidate:true,category,file,line,snippet:excerpt(body,line,file),why,confirm,anchor:anchor(file,line,body),...extra};
}
const literal=ts=>ts?.length===1&&ts[0].kind==='string'&&ts[0].literal?ts[0].v:null;
const syntax=ts=>ts.map(x=>x.kind==='string'?'"字面"':x.kind==='regex'?'正規式':x.v).join(' ');
function calls(t){
 const out=[];
 for(let i=0;i<t.length-1;i++)if(t[i].kind==='name'){
  let name=t[i].v,j=i;while(t[j+1]?.v==='.'&&t[j+2]?.kind==='name'){j+=2;name+='.'+t[j].v;}
  if(t[j+1]?.v==='('&&!['function','def'].includes(t[i-1]?.v)){const a=callArgs(t,j+1);out.push({name,at:i,line:t[i].line,...a});}
  i=j;
 }
 return out;
}
const readCall=n=>/(?:^|\.)(?:readFile(?:Sync)?|createReadStream|read_text|read_bytes|read|readline|readlines|readdir(?:Sync)?|stat(?:Sync)?|lstat(?:Sync)?|access(?:Sync)?|existsSync)$/.test(n);
const writeCall=n=>! /^(?:(?:process|sys)\.(?:stdout|stderr)|console)(?:\.|$)/.test(n)&&/(?:^|\.)(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|write_text|write_bytes|write|mkdir(?:Sync)?|rename(?:Sync)?|copyFile(?:Sync)?|copy|copy2|move|chmod(?:Sync)?)$/.test(n);
const deleteCall=n=>/(?:^|\.)(?:rm|unlink|rmdir|remove|rmtree)(?:Sync)?$/.test(n);
const netCall=n=>/(?:^|\.)(?:fetch|urlopen)$|^(?:https?|axios|got|requests|httpx|aiohttp|urllib\.request|urllib3|undici|http\.client)\./.test(n);
const processCall=n=>/(?:^|\.)(?:spawn|spawnSync|execSync|execFile|execFileSync)$|^(?:(?:(?:cp|child_process|childProcess)\.)?exec|subprocess\.(?:run|Popen|call|check_call|check_output)|os\.(?:system|popen|spawn\w*))$/.test(n);
function scanCode(file,body){
 const t=tokens(body,file.endsWith('.py'),{regexLiterals:true}).filter(x=>x.v!=='\n');
 return {t,calls:calls(t)};
}
function surface(file,body,lex){
 const rows=[],add=(cat,line,why,extra={})=>rows.push(candidate(cat,file,line,body,why,'讀呼叫參數、設定來源及呼叫者，確認實際權限與觸發條件。',extra));
 for(const c of lex.calls){
  const args=c.args.flat(),s=syntax(args),first=literal(c.args[0]);
  if(readCall(c.name)||c.name==='open')add('讀取檔案候選',c.line,'檔案或目錄讀取呼叫；需確認是不是本機檔案。');
  if(writeCall(c.name)||c.name==='open'&&/[wax+]/.test(literal(c.args[1])??''))add('寫入檔案候選',c.line,'寫入、建立或搬移檔案呼叫。');
  if(deleteCall(c.name))add('刪除檔案候選',c.line,'刪除呼叫；需核對範圍與可恢復性。');
  if(netCall(c.name))add('對外連線候選',c.line,'網路用戶端呼叫；目的地需從參數與設定確認。');
  if(processCall(c.name)){
   const shell=/shell\s*[:=]\s*(?:true|True)/.test(s)||/(?:^|\.)(?:exec|execSync|system|popen)$/.test(c.name)||/^(?:cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh|sh|bash)$/i.test(first??'');
   add('子程序候選',c.line,shell?'可能把整段字串交給命令殼層。':'子程序呼叫；核對執行檔、參數、環境與工作目錄。',{shell});
  }
  if(/(?:^|\.)(?:listen|bind|run|serve)$/.test(c.name)&&(/listen|bind/.test(c.name)||/host/.test(s))){
   const hostAt=args.findIndex(x=>/^(?:host|hostname)$/.test(x.v)),named=hostAt>=0?literal(args.slice(hostAt+2,hostAt+3)):null;
   const positional=/bind$/.test(c.name)?args.find(x=>x.kind==='string')?.v:literal(c.args[1]);
   const host=named??positional??null,isLocal=['127.0.0.1','::1','localhost'].includes(host),wide=['0.0.0.0','::',''].includes(host)||host===null;
   add('監聽候選',c.line,isLocal?'字面綁定本機位址。':wide?'所有介面或未指定可辨識的位址，優先核對。':'其他位址或計算值，需沿設定讀碼。',{binding:isLocal||['0.0.0.0','::',''].includes(host)?host:host===null?'未指定或計算值':mask(host),local:isLocal,broadOrUnknown:wide});
  }
  const effect=effectCategory(c.name);if(effect)add(effect,c.line,'動作名稱涉及付費、傳送、發布或刪除；名稱不證明實際發生。');
 }
 const t=lex.t;
 for(let i=0;i<t.length;i++){
  let name;
  if(t[i].v==='process'&&t[i+1]?.v==='.'&&t[i+2]?.v==='env')name=t[i+3]?.v==='.'?t[i+4]?.v:t[i+4]?.kind==='string'?t[i+4].v:'計算名稱';
  if(t[i].v==='os'&&t[i+1]?.v==='.'&&t[i+2]?.v==='environ')name=t[i+3]?.v==='['?t[i+4]?.v:t[i+3]?.v==='.'&&t[i+4]?.v==='get'?t[i+6]?.v:'整份環境';
  if(t[i].v==='getenv'&&t[i+1]?.v==='(')name=t[i+2]?.kind==='string'?t[i+2].v:'計算名稱';
  if(name)add('環境變數候選',t[i].line,'讀取環境變數名稱；不讀本機環境值。',{name:/^[\w]+$/.test(name)?name:'計算名稱或整份環境'});
 }
 for(const s of scanStopSites(file,body))add('停止與授權核對候選',s.line,'沿用停止位置清冊；讀條件確認是否真的檢查授權。');
 return rows;
}
function secrets(file,body){
 const rows=[],add=(category,line,why,value)=>rows.push(candidate(category,file,line,body,why,'讀賦值來源、用途與記錄呼叫；確認是否為示例、已撤銷值或真正機密。',value?{preview:mask(value)}:{}));
 for(const [rx,cat] of [[keyPattern(),'常見金鑰樣式候選'],[privatePattern(),'私鑰區塊候選']])for(const m of body.matchAll(rx))add(cat,body.slice(0,m.index).split('\n').length,'符合機密樣式；只保留前四字與長度。',m[0]);
 if(secretFile(file))add('已追蹤機密設定檔候選',1,'檔名符合環境或憑證設定；只讀已追蹤版本。');
 const t=tokens(body,file.endsWith('.py'),{regexLiterals:true}).filter(x=>x.v!=='\n');
 for(let i=0;i<t.length-2;i++)if(secretName(t[i].v)&&['=',':'].includes(t[i+1].v)&&t[i+2].kind==='string'&&t[i+2].v.length>=16)add('長字面機密候選',t[i].line,'像金鑰的名稱被指定長字面。',t[i+2].v);
 for(const c of calls(t))if(/(?:^|\.)(?:log|info|debug|warn|error|print|exception)$/.test(c.name)&&c.args.flat().some(x=>secretName(x.v)))add('憑證進記錄候選',c.line,'記錄參數含像憑證的名稱；確認是否已遮蔽。');
 // Environment assignments may be unquoted. Never expose their values in snippets.
 if(secretFile(file))for(const r of rows)r.snippet='設定或憑證內容已遮蔽；請在受控原檔確認。';
 return rows;
}
const flowCategories=['外部輸入到危險動作候選','外部內容進提示詞候選','模型輸出到執行工具授權候選'];
const flowLimitations=['跨函式、跨檔的流向找不到；零筆不代表安全。','只追具名賦值及一步別名／屬性；未辨識函式邊界時限前後 40 行。解構、複雜模板、控制流程、清理驗證與執行期值未完整分析。'];
function flows(file,body){
 const py=file.endsWith('.py'),t=tokens(body,py,{regexLiterals:true}),compact=t.filter(x=>x.v!=='\n');
 const ranges=functionRanges(t,body,py),indices=new Map(t.map((x,i)=>[x,i]));
 const scope=i=>ranges.filter(f=>i>=f.start&&i<f.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]??null;
 const near=(a,b)=>scope(a)===scope(b)&&(scope(a)!==null||Math.abs(t[a].line-t[b].line)<=40);
 const cs=calls(compact).map(c=>({...c,at:indices.get(compact[c.at]),end:indices.get(compact[c.end])}));
 const sources=[],model=[],sinks=[],prompts=[],rows=[],assignments=[];
 const add=(list,at,kind,extra={})=>{if(!list.some(x=>x.at===at&&x.kind===kind))list.push({at,line:t[at].line,kind,...extra});};
 const modelCall=n=>/(?:completions|responses)\.create$|(?:^|\.)(?:generate|predict|invoke)$/.test(n);
 for(let i=0;i<t.length;i++){
  if(t[i].kind!=='name')continue;
  const s=syntax(t.slice(i,i+5));
  if(/^(?:req|request) \. (?:body|query|params|headers|json|args|form|data)\b|^(?:process|sys) \. (?:argv|stdin)\b|^input \(/.test(s))add(sources,i,'請求、命令列或標準輸入');
  if(t[i-1]?.v==='.'||t[i+1]?.v!=='='||['=','>'].includes(t[i+2]?.v)||['=','!','<','>'].includes(t[i-1]?.v))continue;
  const end=endExpression(t,i+2),value=t.slice(i+2,end).filter(x=>x.v!=='\n');
  // Function-valued assignments cannot carry their body's reads into the caller.
  if(value.some((x,j)=>x.v==='function'||x.v==='='&&value[j+1]?.v==='>'))continue;
  assignments.push({at:i,end,name:t[i].v,value});
 }
 for(const c of cs){
  const arg=c.args[0]??[],dynamic=arg.some(x=>x.kind==='name'||x.kind==='string'&&!x.literal);
  if(/(?:^|\.)(?:readFile(?:Sync)?|read_text|read_bytes|read|readline|readlines)$/.test(c.name)||c.name==='open'&&!/[wax+]/.test(literal(c.args[1])??'')||netCall(c.name)||/(?:response|res)\.(?:json|text)$/.test(c.name))add(sources,c.at,'外部檔案或網路回應');
  if(modelCall(c.name)){add(model,c.at,'模型回應呼叫候選');add(prompts,c.at,'模型呼叫的提示詞引數',{args:c.args.flat()});}
  const sink=kind=>add(sinks,c.at,kind,{args:c.args.flat()});
  if(processCall(c.name)||/(?:^|\.)(?:eval|exec|Function)$/.test(c.name))sink('執行指令或動態程式');
  if(dynamic&&/(?:^|\.)(?:import|require|import_module|__import__)$/.test(c.name))sink('動態載入變數');
  if(writeCall(c.name)||deleteCall(c.name)||c.name==='open'&&/[wax+]/.test(literal(c.args[1])??''))sink('檔案寫入或刪除');
  if(/(?:^|\.)(?:query|execute|executemany|raw)$/.test(c.name)&&dynamic)sink('拼接或變數查詢');
  if(/(?:^|\.)(?:authorize|isAllowed|approve|dispatchTool|callTool|executeTool|invokeTool)$/.test(c.name))sink('工具或授權判斷');
 }
 // Reuse prompt recognition, but require a named input in the containing expression.
 for(const p of scanPromptSites(file,body)){
  const a=assignments.find(a=>a.value.some(x=>x.kind==='string'&&x.line===p.line));
  const c=cs.find(c=>c.args.flat().some(x=>x.kind==='string'&&x.line===p.line));
  if(a)add(prompts,a.at,'提示詞組合運算式',{args:a.value});
  else if(c)add(prompts,c.at,'提示詞呼叫引數',{args:c.args.flat()});
 }
 // Read identifier tokens, never text in comments, literal strings or object keys.
 const uses=(ts,name)=>{
  const hits=[];
  for(let j=0;j<ts.length;j++){
   const x=ts[j];
   if(x.kind==='name'&&x.v===name&&ts[j-1]?.v!=='.'&&ts[j+1]?.v!==':'&&ts[j+1]?.v!=='('){
    const property=['.','['].includes(ts[j+1]?.v);hits.push({at:indices.get(x),depth:property?1:0,used:name+(property?ts[j+1].v==='.'?'.'+ts[j+2]?.v:'[…]':'')});
   }
   // Bounded simple interpolation only; complex template expressions stay unknown.
   if(x.kind==='string'&&!x.literal)for(const m of x.v.matchAll(py?/\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\}/g:/\$\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\}/g))if(m[1].split('.')[0]===name)hits.push({at:indices.get(x),depth:1,used:m[1]});
  }return hits;
 };
 const unchanged=(a,b)=>!t.slice(a.at+1,b).some((x,j,ts)=>x.kind==='name'&&x.v===a.name&&ts[j-1]?.v!=='.'&&(
  ts[j+1]?.v==='='&&!['=','>'].includes(ts[j+2]?.v)||['+','-','*','/','|','&','?'].includes(ts[j+1]?.v)&&['=','+','-'].includes(ts[j+2]?.v)));
 const bindings=src=>assignments.filter(a=>a.at<src.at&&a.end>src.at&&near(a.at,src.at)).sort((a,b)=>b.at-a.at).slice(0,1);
 const cooccurrenceCounts=Object.fromEntries(flowCategories.map(c=>[c,0]));
 const pair=(ss,dd,category)=>{for(const src of ss)for(const dst of dd){
  let linked=false;
  if(src.at<dst.at&&near(src.at,dst.at))for(const a of bindings(src)){
   const alternatives=[{a,depth:0,alias:null},...assignments.filter(b=>b.at>a.end&&b.end<dst.at&&near(a.at,b.at)&&near(b.at,dst.at)&&unchanged(a,b.at)&&uses(b.value,a.name).some(h=>near(a.at,h.at))).map(b=>({a:b,depth:1,alias:b.name}))];
   for(const option of alternatives){
    if(option.a.end>dst.at||!unchanged(option.a,dst.at))continue;
    const hit=uses(dst.args,option.a.name).filter(h=>near(src.at,h.at)&&option.depth+h.depth<=1).sort((a,b)=>a.depth-b.depth)[0];if(!hit)continue;
    const depth=option.depth+hit.depth;
    rows.push(candidate(category,file,dst.line,body,'具名賦值「'+a.name+'」'+(depth?'經一步衍生':'直接')+'出現在「'+dst.kind+'」的引數或提示詞運算式。','讀來源賦值、清理驗證及呼叫條件；這是詞法關聯候選，不證明可利用。',{
     source:{kind:src.kind,identifier:a.name,line:src.line,assignmentLine:t[a.at].line,anchor:anchor(file,src.line,body),snippet:excerpt(body,src.line,file)},sink:dst.kind,
     relation:depth?'one-step':'direct',link:{identifier:a.name,used:hit.used,alias:option.alias,aliasLine:option.alias?t[option.a.at].line:null,sourceLine:src.line,sinkLine:dst.line,depth,scope:scope(src.at)?'same-function':'within-40-lines'}}));
    linked=true;break;
   }
  }
  if(!linked)cooccurrenceCounts[category]++;
 }};
 pair(sources,sinks.filter(s=>s.kind!=='工具或授權判斷'),flowCategories[0]);pair(sources,prompts,flowCategories[1]);pair(model,sinks,flowCategories[2]);
 return {rows,cooccurrenceCounts};
}
export function dependencies(file,body){
 const rows=[],add=(line,cat,why)=>rows.push(candidate(cat,file,line,body,why,'讀相鄰套件的鎖定檔、安裝設定及實際腳本；此處不查弱點資料庫。'));
 if(/(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|Pipfile\.lock|uv\.lock)$/.test(file))add(1,'鎖定檔候選','找到鎖定檔；存在不代表與宣告同步。');
 if(path.basename(file)==='package.json'){
  const p=JSON.parse(body),at=n=>Math.max(1,body.split('\n').findIndex(l=>l.includes(JSON.stringify(n)))+1);
  for(const n of Object.keys(p.scripts??{}))if(/^(?:preinstall|install|postinstall|prepare|prepublish|prepublishOnly)$/.test(n))add(at(n),'安裝腳本候選','套件生命週期腳本；不執行。');
  for(const section of ['dependencies','devDependencies','optionalDependencies','peerDependencies'])for(const [n,v] of Object.entries(p[section]??{})){
   if(/(?:https?:|git(?:\+|:)|github:|gitlab:|bitbucket:)|^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(String(v)))add(at(n),'網址或版本庫相依候選','相依直接指向網址或版本庫。');
   if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(String(v)))add(at(n),'未釘版本相依候選','不是單一確切套件版本；本機或工作區相依也需確認。');
  }
 }else if(/(?:requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.(?:py|cfg))$/.test(file)){
  const lines=body.split(/\r?\n/);let dependencySection=false;
  lines.forEach((s,i)=>{
   if(/^\s*\[/.test(s))dependencySection=/dependencies|optional-dependencies/.test(s);
   if(/https?:|git\+|git@/.test(s))add(i+1,'網址或版本庫相依候選','Python 設定含網址或版本庫來源。');
   const requirement=/requirements[^/]*\.txt$/.test(file)?s.trim():dependencySection||/dependencies|install_requires/.test(s)?s.trim():'';
   if(requirement&&!/^(?:#|\[|\]|$)/.test(requirement)&&!/(?:==\s*\d[^*\s,]*|=\s*["']\d+\.\d+\.\d+["'])/.test(requirement))add(i+1,'未釘版本相依候選','Python 相依行未辨識到確切版本；複雜設定需人工確認。');
   if(/setup\.py$/.test(file)&&/cmdclass|(?:class|def).*install/.test(s))add(i+1,'安裝腳本候選','自訂 Python 安裝行為候選。');
  });
 }
 return rows;
}
export function importSarif(root,file){
 const input=JSON.parse(readBounded(path.dirname(path.resolve(file)),path.basename(file)).toString('utf8')),rows=[];
 for(const run of input.runs??[])for(const result of run.results??[]){
  const locations=result.locations?.length?result.locations:[{}];
  for(const location of locations){
   let name=null,line=null;try{
    const p=location.physicalLocation??{},a=p.artifactLocation??{},artifact=run.artifacts?.[a.index]?.location??{},uri=a.uri??artifact.uri;
    if(a.uriBaseId||artifact.uriBaseId)throw Error();
    name=decodeURIComponent(uri);safeName(name);line=p.region?.startLine;
    const body=readBounded(root,name).toString('utf8'),lines=body.split(/\r?\n/);
    if(!Number.isInteger(line)||line<1||line>lines.length||line===lines.length&&lines.at(-1)==='')throw Error();
    const expected=p.region?.snippet?.text,matched=expected===undefined||lines.slice(line-1,line-1+expected.split(/\r?\n/).length).join('\n').includes(expected.replaceAll('\r\n','\n'));
    rows.push(candidate('外部掃描候選',name,line,body,'匯入既有掃描結果；檔與行已核對。','回讀原掃描規則、原始報告與目前原碼；匯入不認定弱點。',{anchorCheck:matched?'PASS':'ANCHOR_MISMATCH'}));
   }catch{rows.push({candidate:true,category:'外部掃描候選',file:name&&!/[\\:]|\.\./.test(name)?redact(name):null,line:Number.isInteger(line)?line:null,snippet:'外部報告內容已省略。',why:'檔案、行號或來源基底無法核對。',confirm:'修正來源根目錄、相對位置與行號後重新匯入。',anchorCheck:'UNKNOWN'});}
  }
 }
 return rows;
}
const patterns={surface:['入口沿用','檔案讀寫刪除','環境變數名稱','網路呼叫','子程序與殼層','監聽位址','付費與不可逆','停止位置沿用'],secrets:['常見金鑰樣式','私鑰區塊','長字面機密名稱','追蹤設定檔','憑證寫記錄','未追蹤機密檔名'],flows:['請求與命令列標準輸入','外部檔案網路回應','指令動態載入','變數路徑寫刪','拼接查詢','提示詞沿用','模型輸出到工具授權'],deps:['鎖定檔','安裝腳本','未釘版本','網址或版本庫來源'],'import-sarif':['外部結果','檔案與行號','附帶片段比對']};
export function scanIntegration(mode,{root='.',paths='',rev,file,safeDirectory,all=false,noGit=false}={}){
 root=path.resolve(root);noLinks(root);if(!patterns[mode])throw Error('請選擇有效的分診命令。');
 if(noGit&&(rev||mode==='import-sarif'))throw Error('--no-git 只適用四個掃描命令，且不能搭配 --rev。');
 const report={schema:'integration-candidates-v1',mode,root,candidate:true,scanned:0,patterns:patterns[mode],candidates:[],skipped:[],omitted:0};
 if(mode==='flows'){report.cooccurrenceCounts=Object.fromEntries(flowCategories.map(c=>[c,0]));report.cooccurrenceNote='僅共現，未列出';}
 if(mode==='import-sarif'){report.candidates=importSarif(root,file);report.scanned=new Set(report.candidates.filter(r=>r.anchor).map(r=>r.file)).size;}
 else{
  const selected=f=>!paths||paths.split(',').some(p=>{p=p.replaceAll('\\','/').replace(/\/$/,'');return f===p||f.startsWith(p+'/');});
  let inventory;
  if(noGit){
   const walk=walkDirectory(root,{paths,nameOnly:folderSecret});inventory=walk.files;report.skipped.push(...walk.skipped);
   Object.assign(report,{scanBasis:'未依版本控制的資料夾掃描',fileList:inventory,fileListSha256:sha256(JSON.stringify(inventory)),limits:walk.limits,nameOnlyFiles:[],contentFiles:[],readBytes:0});
  }else{
   try{report.revision=rev?gitRead(root,['rev-parse','--verify',rev+'^{commit}'],{safeDirectory}).trim():null;inventory=gitRead(root,rev?['ls-tree','-r','--name-only','-z',report.revision]:['ls-files','-z'],{safeDirectory}).split('\0').filter(f=>f&&selected(f));}
   catch(e){report.skipped.push({reason:'無法取得已追蹤清單，未退回掃描工作目錄。'});inventory=[];report.zeroScanReason=/not a git repository/i.test(e.message)?'這個資料夾不是 git repo；要掃請加 --no-git。':'無法取得 Git 檔案清單；請檢查 --root、--rev 與讀取權限，或明示加 --no-git 掃描資料夾。';}
   report.tracked=inventory.length;
  }
  const readable=[];
  for(const name of inventory){
   if(noGit&&folderSecret(name)){report.nameOnlyFiles.push(name);report.skipped.push({file:name,reason:'機密設定只列檔名，不讀取或雜湊內容。'});continue;}
   if((mode==='surface'||mode==='flows')&&!codeFile(name)||mode==='deps'&&!/(?:package\.json|lock[^/]*|requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.(?:py|cfg))$/i.test(name))continue;
   let body;try{
    if(noGit&&report.readBytes>=report.limits.maxBytes){report.skipped.push({file:name,reason:'超過合計位元組上限。'});continue;}
    const bytes=readBounded(root,name,noGit?Math.min(report.limits.maxFileBytes,report.limits.maxBytes-report.readBytes):undefined);
    if(noGit)report.readBytes+=bytes.length;
    if(bytes.includes(0)){report.skipped.push({file:name,reason:noGit?'二進位檔未分析內容。':'二進位檔未讀取內容。'});continue;}
    body=bytes.toString('utf8');report.scanned++;if(noGit)report.contentFiles.push({file:name,sha256:sha256(bytes)});
   }
   catch{report.skipped.push({file:name,reason:'檔案不存在、過大或連結，未讀取。'});continue;}
   try{
    if(mode==='surface'){readable.push(name);report.candidates.push(...surface(name,body,scanCode(name,body)));}
    if(mode==='secrets')report.candidates.push(...secrets(name,body));
    if(mode==='flows'){const r=flows(name,body);report.candidates.push(...r.rows);for(const c of flowCategories)report.cooccurrenceCounts[c]+=r.cooccurrenceCounts[c];}
    if(mode==='deps')report.candidates.push(...dependencies(name,body));
   }catch{report.skipped.push({file:name,reason:'內容無法完整解析，請人工讀碼。'});}
  }
  if(mode==='surface')for(const name of readable)try{
   const body=readBounded(root,name).toString('utf8'),r=discoverEntries(root,{inventory:[name]});report.skipped.push(...r.skipped.map(s=>({file:s.file,reason:'既有入口辨識器略過此檔。'})));
   for(const e of r.entries)report.candidates.push(candidate('入口候選',name,e.anchor.line,body,'沿用既有入口辨識器。','讀入口參數、回傳值、錯誤與重送處理；由讀碼者填介面摘要。'));
  }catch{report.skipped.push({file:name,reason:'既有入口辨識未完成。'});}
  if(mode==='secrets'&&!rev&&!noGit)try{report.untrackedNames=gitRead(root,['ls-files','--others','--exclude-standard','-z'],{safeDirectory}).split('\0').filter(f=>f&&selected(f)&&secretFile(f));report.ignoredNames=gitRead(root,['ls-files','--others','--ignored','--exclude-standard','-z'],{safeDirectory}).split('\0').filter(f=>f&&selected(f)&&secretFile(f));}catch{report.skipped.push({reason:'未追蹤檔名清單無法取得；未讀取內容。'});}
 }
 if(mode==='flows'){
  report.candidates.sort((a,b)=>a.link.depth-b.link.depth||a.file.localeCompare(b.file)||a.line-b.line||a.link.sourceLine-b.link.sourceLine);
  report.totalCandidates=report.candidates.length;report.totalCounts=Object.fromEntries(flowCategories.map(c=>[c,report.candidates.filter(r=>r.category===c).length]));
  report.limit=all?null:50;report.omitted=all?0:Math.max(0,report.candidates.length-50);if(!all)report.candidates=report.candidates.slice(0,50);
 }
 report.counts=Object.fromEntries((mode==='flows'?flowCategories:[...new Set(report.candidates.map(r=>r.category))].sort()).map(c=>[c,report.candidates.filter(r=>r.category===c).length]));
 report.limitations=['全部是詞法候選，不判定弱點；零命中不代表安全。','只讀已追蹤的有界檔案；未追蹤機密設定只列名稱。','不解析完整語法或跨檔資料流；同檔配對不證明傳遞，別名、計算呼叫與樣式外機密可能漏報。','不連網、不查弱點資料庫、不執行受查程式；未評估執行期攻擊。'];
 if(mode==='flows')report.limitations.splice(2,1,...flowLimitations);
 if(mode==='deps')report.lockfiles=report.candidates.filter(r=>r.category==='鎖定檔候選').map(r=>r.file);
 if(noGit){
  report.contentManifestSha256=sha256(JSON.stringify(report.contentFiles));
  report.limitations[1]='未依版本控制的資料夾掃描；清冊雜湊只核對檔名，內容雜湊只涵蓋本命令實際分析的檔案，機密設定只列名稱。';
  report.skippedCount=report.skipped.reduce((n,s)=>n+(s.count??1),0);
 }
 if(!report.scanned&&!report.zeroScanReason)report.zeroScanReason=mode==='import-sarif'?'沒有可核對的來源檔；請檢查 SARIF 位置、行號與 --root。':report.skipped.length?'所選範圍沒有可讀且適用本命令的檔案，部分項目已略過；請查看 skipped 並調整 --paths 或檔案格式／大小。':'所選範圍沒有適用本命令的檔案；請檢查 --root、--paths 與副檔名（預設只選 Git 清單，可明示加 --no-git）。';
 return report;
}
export function integrationSummary(r){
 const priority=x=>/私鑰|機密|監聽|子程序|付費|模型輸出/.test(x.category)?0:1;
 const shown=[...r.candidates].sort((a,b)=>priority(a)-priority(b)).slice(0,8);
 return [`共讀 ${r.scanned} 檔；共 ${r.candidates.length+r.omitted} 個候選，先看 ${shown.length} 筆；省略 ${r.candidates.length+r.omitted-shown.length} 筆，略過 ${r.skippedCount??r.skipped.length} 項。`,
  ...(r.scanBasis?[r.scanBasis]:[]),...(r.zeroScanReason?[r.zeroScanReason]:[]),
  ...shown.map(x=>`${x.file??'檔案未知'}:${x.line??'行號未知'} — ${x.category}；${x.why}`),
  ...Object.entries(r.cooccurrenceCounts??{}).map(([k,v])=>k+'：'+v+' 組（僅共現，未列出）'),
  ...(r.mode==='flows'?flowLimitations:[]),'全部待讀碼確認，未認定弱點。'
 ].map(summaryLine);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const [mode,...args]=process.argv.slice(2),get=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
  if(mode==='--help')console.log('分診用法：node scripts/integrate.mjs <surface|secrets|flows|deps|import-sarif> --root <原碼> [--paths <目錄,檔案>] [--no-git（四個掃描命令，不可搭配 --rev）] [--rev <提交>] [--file <掃描結果>] [--out <輸出>] [--summary] [--all（flows 全列）]');
  else{const r=scanIntegration(mode,{root:get('--root'),paths:get('--paths'),rev:get('--rev'),file:get('--file'),safeDirectory:get('--safe-directory'),all:args.includes('--all'),noGit:args.includes('--no-git')}),out=get('--out');
   if(out){const target=noLinks(out),rel=path.relative(r.root,target);if(!rel||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))throw Error();fs.writeFileSync(target,JSON.stringify(r,null,2)+'\n','utf8');}
   if(r.zeroScanReason&&!args.includes('--summary'))console.error(r.zeroScanReason);
   console.log(args.includes('--summary')?integrationSummary(r).join('\n'):JSON.stringify(r,null,2));
  }
 }catch{console.error('分診未完成；請確認命令、受查根目錄、資料格式與外部輸出位置。');process.exitCode=1;}
}
