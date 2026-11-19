// 1.37 prototype: preflight stage before `trace.mjs start`.
// Read-only. Detects environment capabilities and target items the agent cannot define or authorize,
// then emits a short question list for the 負責人. Never installs, downloads, or runs target code.
// Dogfood round 2: questions the scan can settle are settled by the scan (shown as "已由掃描決定"),
// the rest are one-tap (甲乙丙) with safe defaults; `answersFrom` turns a reply into the answers file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const SCANNERS=['gitleaks','osv-scanner','semgrep','zizmor','actionlint','trivy','pip-audit'];
const RUNTIMES=[['node',['--version']],['python3',['--version']],['git',['--version']],['docker',['--version']],['npm',null]];
export const LETTERS=['甲','乙','丙','丁','戊','己','庚','辛'];
function onPath(name){
 for(const d of (process.env.PATH??'').split(path.delimiter).filter(Boolean))for(const ext of process.platform==='win32'?['.exe','.cmd','.bat','']:['']){
  const p=path.join(d,name+ext);try{if(fs.statSync(p).isFile())return p;}catch{}
 }return null;
}
export function scanEnvironment(){
 const runtimes=RUNTIMES.map(([name,args])=>{const p=onPath(name);if(!p)return {name,found:false,version:null};
  // Only well-known runtimes are probed with --version; npm and external scanners are detected by path only.
  let version='UNKNOWN（只偵測路徑，不執行）';if(args)try{version=execFileSync(p,args,{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']}).trim().split(/\r?\n/)[0].slice(0,80);}catch{version='UNKNOWN';}
  return {name,found:true,path:p,version};});
 const scanners=SCANNERS.map(name=>{const p=onPath(name);return {name,found:!!p,path:p,version:p?'UNKNOWN（只偵測路徑，不執行）':null};});
 return {runtimes,scanners,nodeExecPath:process.execPath,platform:process.platform};
}
const SECRET_NAME=/(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*|credentials.*|.*\.local\.json)$/i;
export const TEST_PATH=/(^|\/)(tests?|__tests__|spec|fixtures?|e2e)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.py$/i;
// Type declarations only describe an API (e.g. `exec(handle): Response`); they are listed but never count as a capability need.
const TYPE_DECL=/\.d\.(ts|mts|cts)$|(^|\/)(typings|@types)\//;
const RETIRED_DIR=/^(.*?(?:^|\/)(?:history|retired[^/]*|archive[sd]?|legacy|deprecated|vendor|third_party|old)\/)/i;
const COMMENT=/^\s*(\/\/|#|\*|\/\*|<!--)/;
function listFiles(root){
 try{const out=execFileSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8',maxBuffer:256*1024*1024,stdio:['ignore','pipe','pipe']});return {git:true,files:out.split('\0').filter(Boolean)};}
 catch{const files=[];const walk=(d,rel)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['.git','node_modules','dist','build'].includes(e.name)||e.isSymbolicLink())continue;const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())walk(path.join(d,e.name),r);else if(e.isFile()&&files.length<10000)files.push(r);}};walk(root,'');return {git:false,files};}
}
const CODE=/\.(m?js|cjs|tsx?|py)$/;
const RULES=[
 {kind:'ci',label:'自動化流程（CI）設定',file:/^\.github\/workflows\/.+\.ya?ml$|^\.gitlab-ci\.yml$|^azure-pipelines\.yml$/,line:/pull_request_target|workflow_run|secrets\.|permissions:/},
 {kind:'container',label:'容器設定',file:/(^|\/)(Dockerfile|Containerfile)[^/]*$|(^|\/)(docker-)?compose[^/]*\.ya?ml$/,line:/\|\s*(ba)?sh\b|privileged|network_mode|USER\s+root|^FROM/i},
 {kind:'agent-instructions',label:'寫給 agent 的指令檔',file:/(^|\/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|\.mcp\.json|copilot-instructions\.md)$|(^|\/)\.(claude|cursor)\//,line:null},
 {kind:'install-scripts',label:'安裝時會自動跑的腳本',file:/(^|\/)package\.json$|(^|\/)setup\.py$|(^|\/)pyproject\.toml$/,line:/"(pre|post)?install"\s*:|cmdclass/},
 // Tightened in dogfood round 2: `McpServer` inside an error-message regex is not a tool server.
 {kind:'mcp-tools',label:'提供給模型的工具（工具協定）',file:CODE,line:/new\s+(Mcp)?Server\(|\bserver\.tool\(|\.registerTool\(|@mcp\.tool|FastMCP\(|\.setRequestHandler\(\s*CallToolRequestSchema/},
 // Calls, imports or CLI model runs only; comments, URLs and env-name blocklists are not paid calls.
 {kind:'paid',label:'付費呼叫',file:CODE,line:/new\s+(OpenAI|Anthropic|Stripe|Twilio)\b|from\s+['"](openai|@anthropic-ai\/sdk|stripe|twilio|@sendgrid\/mail)['"]|require\(\s*['"](openai|@anthropic-ai\/sdk|stripe|twilio|@sendgrid\/mail)['"]|^\s*(import|from)\s+(openai|anthropic|stripe|twilio)\b|completions\.create\(|messages\.create\(|charges\.create\(/},
 {kind:'real-account',label:'用真帳號的呼叫',file:CODE,line:/from\s+['"]nodemailer['"]|require\(\s*['"]nodemailer['"]|^\s*(import|from)\s+smtplib\b|smtplib\.SMTP\(|['"]--model['"]|\b(keyring\.get_password|os\.environ\[['"][A-Z_]*(API_KEY|TOKEN)['"]\])/},
 // Dogfood ext round: `regex.exec(` and `plugins.exec(` are not subprocesses; only bare calls or child_process members count.
 {kind:'subprocess',label:'執行其他程式',file:CODE,line:/^\s*import\s+(?!type\b)[^;]*from\s+['"](node:)?child_process['"]|require\(\s*['"](node:)?child_process['"]\s*\)|(?<![.\w$])(spawn|spawnSync|execFile|execFileSync|execSync|exec|fork)\(|\b(child_process|childProcess|cp)\.(spawn|spawnSync|execFile|execFileSync|execSync|exec|fork)\(|subprocess\.(run|Popen|call|check_output)\(|os\.system\(/},
 // Star round (axios): an HTTP client only showed `transport.request(`; importing http/https/net or new XMLHttpRequest counts too.
 {kind:'network',label:'網路呼叫',file:CODE,line:/^\s*import\s+(?!type\b)[^;]*from\s+['"](node:)?(http|https|http2|net|dgram|tls)['"]|require\(\s*['"](node:)?(http|https|http2|net|dgram|tls)['"]\s*\)|new\s+(XMLHttpRequest|WebSocket)\(|^\s*(import|from)\s+(requests|httpx|aiohttp|urllib\.request)\b|\bfetch\(|\bhttps?\.(get|request)\(|net\.(connect|createConnection)\(|dgram\.createSocket|dns\.(lookup|resolve)|requests\.(get|post|put|delete)\(|urlopen\(|socket\.socket\(/},
 {kind:'listen',label:'開放連線埠或通道',file:CODE,line:/\.listen\(|createServer\(|app\.run\(|uvicorn\.run\(/},
 {kind:'secret-files',label:'機密檔名',file:SECRET_NAME,line:null}
];
const inFocus=(f,paths)=>!paths?.length||paths.some(p=>{p=p.replaceAll('\\','/').replace(/\/$/,'');return f===p||f.startsWith(p+'/');});
export function scanTarget(root,{paths=[]}={}){
 root=path.resolve(root);const all=listFiles(root),files=all.files.filter(f=>inFocus(f,paths)),found=[],retired=new Map();let tests=0;
 for(const f of files){
  const test=TEST_PATH.test(f);if(test)tests++;
  const rm=f.match(RETIRED_DIR);if(rm)retired.set(rm[1],(retired.get(rm[1])??0)+1);
  for(const r of RULES){if(!r.file.test(f))continue;
   const base={kind:r.kind,label:r.label,file:f,test,retired:!!rm,...(TYPE_DECL.test(f)?{typesOnly:true}:{})};
   if(r.kind==='secret-files'||r.kind==='agent-instructions'){found.push({...base,line:null,note:'只列檔名，不讀內容'});continue;}
   if(!r.line){found.push({...base,line:null});continue;}
   let body;try{const st=fs.statSync(path.join(root,f));if(st.size>8*1024*1024)continue;body=fs.readFileSync(path.join(root,f),'utf8');}catch{continue;}
   const lines=body.split(/\r?\n/);const hit=lines.findIndex(l=>!COMMENT.test(l)&&r.line.test(l));
   if(hit>=0)found.push({...base,line:hit+1,lineSha256:sha256(lines[hit])});
  }
 }
 if(!all.git)found.push({kind:'no-git',label:'沒有版本控制',file:'.',line:null,note:'無法固定提交；分診需加 --no-git'});
 const byKind={};for(const x of found)(byKind[x.kind]??=[]).push(x);
 const retiredDirs=[...retired].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([dir,count])=>({dir,count}));
 return {root,git:all.git,fileCount:files.length,totalFiles:all.files.length,focus:paths,testFiles:tests,retiredDirs,findings:found,byKind};
}
const opt=(value,label)=>({value,label});
// A local socket or pipe listener is not outbound network; it is reported as a finding, not a capability need.
const CAP_NEED={subprocess:'exec',network:'network',paid:'paid','real-account':'real-account'};
export function buildQuestions(env,target,{mode='integrate'}={}){
 const k=target.byKind,live=x=>(k[x]??[]).filter(f=>!f.test&&!f.retired&&!f.typesOnly),has=x=>live(x).length>0,ev=x=>live(x).slice(0,5).map(f=>f.file+(f.line?':'+f.line:''));
 const available=env.scanners.filter(s=>s.found).map(s=>s.name),missing=env.scanners.filter(s=>!s.found).map(s=>s.name);
 const q=[],settled=[];
 q.push({id:'run',decide:'能不能實際跑這份程式，看它真的做了什麼？',why:'不跑就只能讀程式碼猜；跑也只在隔離副本、限時、不碰你的帳號。'+(has('install-scripts')?'這份程式有安裝時自動跑的腳本，試跑也不會執行它。':''),default:'none',scope:'只影響這次查線',
  options:[opt('none','不跑，只讀程式碼'),opt('deny','在隔離副本跑，網路全關（只攔常見寫法）'),opt('loopback','在隔離副本跑，只開本機'),opt('container','在你準備好的無網路容器裡跑')],evidence:[...ev('install-scripts'),...ev('network')].slice(0,5)});
 if(has('paid')||has('real-account'))q.push({id:'paidCalls',decide:'跑的時候碰到付費或真帳號呼叫怎麼辦？',why:'查線不會替你花錢；預設一律擋下或換成假的。',default:'stub',scope:'只在試跑',options:[opt('stub','一律擋下或換成假的'),opt('account','用你另外提供的測試帳號')],evidence:[...ev('paid'),...ev('real-account')].slice(0,5),dependsOn:{run:['deny','loopback','container']}});
 if(available.length)q.push({id:'scanners',decide:'要不要用你電腦上已裝的掃描工具？',why:'查線本身不查已知弱點；掃描工具要你自己跑，結果交給我核對。',default:'skip',scope:'我只建議，不安裝也不替你跑',options:[opt('skip','不用，相關項目寫成未知'),opt('import-existing','你自己跑，把結果檔交給我')],available,missing,evidence:[]});
 else settled.push({id:'scanners',value:'skip',reason:'電腦上沒有可用的掃描工具，相關項目寫成未知；需要時再請你自行安裝。',missing});
 if(mode==='integrate'){
  const needs=[...new Set(Object.entries(CAP_NEED).filter(([kind])=>has(kind)).map(([,cap])=>cap))];
  q.push({id:'capabilities',decide:'接進來之後，你願意讓它做哪些事？（可多選）',why:'沒勾的就是不准；程式需要但你沒給的，會寫進結論的條件。'+(needs.length?'掃描看到它可能需要：'+needs.map(v=>CAP_LABEL[v]).join('、')+'。':''),default:['fs-read'],scope:'最小授權，逐項勾選',
   options:CAPS.map(([v,,long])=>opt(v,long)),multi:true,needs,evidence:[...ev('subprocess'),...ev('paid'),...ev('real-account')].slice(0,5)});
  if(has('mcp-tools'))q.push({id:'mcpTools',decide:'它提供的工具，會交給你的模型直接呼叫嗎？',why:'會的話，模型給的參數一律當成不可信；有危險工具就會建議不要接。',default:'yes',scope:'只讀',options:[opt('yes','會'),opt('no','不會'),opt('unknown','還不確定')],evidence:ev('mcp-tools')});
  else settled.push({id:'mcpTools',value:'none-found',reason:'掃描沒看到提供給模型的工具。'});
 }
 settled.push({id:'agentInstructions',value:'names-only',reason:'寫給 agent 的指令檔一律只列檔名、不讀內容（可能藏注入文字）。'});
 if(has('ci')||has('container'))settled.push({id:'ciContainer',value:'in-scope',reason:'自動化流程與容器設定只讀不跑，預設一起查；不想查就在「不查的部分」排除。'});
 if(target.retiredDirs.length)q.push({id:'outOfScope',decide:'這些看起來是退役或封存的部分，要排除不查嗎？（可多選）',why:'排除的部分在報告寫明「沒查」，不算查過沒問題。測試程式不用排除，報告會自動分開放。',default:target.retiredDirs.map(r=>r.dir),scope:'路徑前綴',options:target.retiredDirs.map(r=>opt(r.dir,r.dir+'（'+r.count+' 檔）')),multi:true,freeform:true,evidence:target.retiredDirs.map(r=>r.dir)});
 if(!target.git)q.push({id:'noGit',decide:'沒有版本控制，要用目前內容當快照嗎？',why:'無法固定版本，結論只對這次內容有效。',default:'snapshot',scope:'只讀',options:[opt('snapshot','用目前內容當快照'),opt('stop','先停，等你給版本')],evidence:['.']});
 return {questions:q,settled};
}
// Fixed capability options shared by the preflight question and the card's --permission field.
// [value, short label, long label, aliases]
export const CAPS=[['fs-read','讀檔','讀檔',['讀檔','讀取檔案']],['fs-write','寫檔','寫檔（限指定資料夾）',['寫檔','寫入','寫入檔案','刪檔']],['exec','執行其他程式','執行其他程式',['執行其他程式','跑程式','執行','子程序']],
 ['network','連外網','連外網',['連外網','連網','網路','對外連線']],['real-account','用真帳號','用你的真帳號登入外部服務',['用真帳號','真帳號','帳號']],['paid','花錢','花錢（付費服務或模型）',['花錢','付費','付費服務','付費模型']],
 ['secrets','讀機密','讀機密（金鑰、憑證、密碼）',['讀機密','機密','金鑰','憑證']],['mcp-shell','讓模型下系統指令','讓模型直接下系統指令',['讓模型下系統指令','讓模型直接下系統指令']]];
const CAP_LABEL=Object.fromEntries(CAPS.map(([v,l])=>[v,l]));
// "執行其他程式|只跑釘選的 codex 執行檔" → {capability:'exec',refine:'只跑釘選的 codex 執行檔'}; unmatched heads stay free text (needs a human).
export function parseCapability(value){
 const [head,...rest]=String(value??'').split(/[|｜]/),h=head.trim(),refine=rest.join('|').trim()||null;
 const hit=CAPS.find(([v,l,long,al])=>v===h||l===h||long===h||al.includes(h));
 return hit?{capability:hit[0],refine,text:hit[1]+(refine?(/[（）()]/.test(refine)?'：'+refine:'（'+refine+'）'):'')}:{capability:null,refine:null,text:String(value??'').trim()};
}
export const capLabel=v=>CAP_LABEL[v]??v;
export function preflight(root,{paths=[],mode='integrate'}={}){
 const environment=scanEnvironment(),target=scanTarget(root,{paths}),{questions,settled}=buildQuestions(environment,target,{mode});
 const body={schema:'trace-preflight-questions-v2',createdAt:new Date().toISOString(),root:target.root,mode,focus:paths,environment,
  target:{git:target.git,fileCount:target.fileCount,totalFiles:target.totalFiles,testFiles:target.testFiles,retiredDirs:target.retiredDirs,findings:target.findings},questions,settled,
  rules:['只讀；不安裝、不下載、不執行受查程式。','agent 只提議；負責人決定。','未回覆的項目一律視為未授權；接入結論最多「有條件可接」。','問題只在開卡前問，查到一半不再追問；中途發現的新項目記未知（只有負責人能答）。']};
 body.questionsSha256=sha256(JSON.stringify(body.questions));return body;
}
const applies=(q,a)=>!q.dependsOn||Object.entries(q.dependsOn).every(([k,v])=>[].concat(v).includes(a[k]));
const safePrefix=x=>typeof x==='string'&&x.trim()&&!x.split(/[\\/]/).includes('..')&&!path.isAbsolute(x);
function validAnswer(q,v){
 if(v===undefined)return false;
 if(q.multi&&q.freeform)return Array.isArray(v)&&v.every(safePrefix);
 if(q.multi)return Array.isArray(v)&&v.every(x=>q.options.some(o=>o.value===x));
 return q.options.some(o=>o.value===v);
}
// Turn a reply into an answers file. `set` keys may be question ids or shown numbers; values may be option values or 甲乙丙.
export function answersFrom(qs,{acceptDefaults=false,set={},by,simulated=false,at=new Date().toISOString()}={}){
 const shown=qs.questions,answers={},errors=[];
 const pick=(q,raw)=>{const one=s=>{const i=LETTERS.indexOf(s);return i>=0?q.options[i]?.value:s;};
  if(q.multi){const parts=[...String(raw).split(/[,，、]/).map(s=>s.trim()).filter(Boolean)].flatMap(s=>/^[甲乙丙丁戊己庚辛]+$/.test(s)?[...s]:[s]);return raw===''||raw==='無'?[]:parts.map(one);}
  return one(String(raw).trim());};
 for(const [key,raw] of Object.entries(set)){
  const q=/^\d+$/.test(key)?shown[Number(key)-1]:shown.find(x=>x.id===key);
  if(!q){if(key==='outOfScope'){answers.outOfScope=pick({multi:true,options:[]},raw);continue;}errors.push('沒有第 '+key+' 題');continue;}
  const v=pick(q,raw);if(!validAnswer(q,v)){errors.push('第 '+(shown.indexOf(q)+1)+' 題的回答不在選項內：'+raw);continue;}answers[q.id]=v;
 }
 if(acceptDefaults)for(const q of shown)if(!(q.id in answers)&&applies(q,{...Object.fromEntries(shown.map(x=>[x.id,x.default])),...answers}))answers[q.id]=q.default;
 return {answers:{schema:'trace-preflight-answers-v2',simulated:simulated===true,answeredBy:by??'UNKNOWN',answeredAt:at,acceptedDefaults:acceptDefaults,questionsSha256:qs.questionsSha256,answers},errors};
}
// Resolve answers into a scope header. Unanswered items stay unauthorized.
export function resolveScope(qs,ans){
 const a=ans?.answers??{},pending=[],answered={};
 for(const q of qs.questions){
  if(!applies(q,a)){answered[q.id]={value:null,status:'not-applicable'};continue;}
  const v=a[q.id];
  if(!validAnswer(q,v)){pending.push(q.id);answered[q.id]={value:null,status:v===undefined?'unanswered':'invalid',fallback:'unauthorized'};}
  else answered[q.id]={value:v,status:'answered'};
 }
 for(const s of qs.settled??[])answered[s.id]={value:s.value,status:'settled',reason:s.reason};
 const val=id=>['answered','settled'].includes(answered[id]?.status)?answered[id].value:null;
 const run=val('run');
 const extraOut=!qs.questions.some(q=>q.id==='outOfScope')&&Array.isArray(a.outOfScope)?a.outOfScope.filter(safePrefix):[];
 const scope={depth:run&&run!=='none'?'full':run==='none'?'light':'light-unauthorized',isolatedRun:!!run&&run!=='none',network:run&&run!=='none'?run:'none',
  scanners:val('scanners')??'skip',capabilities:val('capabilities')??[],outOfScope:[...(val('outOfScope')??[]),...extraOut],focus:qs.focus??[],
  mcpToolsToModel:val('mcpTools'),agentInstructions:'names-only',paidCalls:val('paidCalls')??'stub',capabilityNeeds:qs.questions.find(q=>q.id==='capabilities')?.needs??[]};
 return {schema:'trace-preflight-scope-v2',mode:qs.mode??null,pendingLabels:pending.map(id=>qs.questions.find(q=>q.id===id)?.decide??id),questionsSha256:qs.questionsSha256,questionsMatch:ans?.questionsSha256===qs.questionsSha256,answeredBy:ans?.answeredBy??'UNKNOWN',simulated:ans?.simulated===true,answeredAt:ans?.answeredAt??null,acceptedDefaults:ans?.acceptedDefaults===true,answers:answered,pending,scope,
  decisionCap:pending.length||ans?.questionsSha256!==qs.questionsSha256?'有條件可接':null};
}
// The text an agent relays to the 負責人 as-is: numbered, one tap per question, plain Chinese.
export function relayText(qs){
 const q=qs.questions,dep=q.filter(x=>x.dependsOn).length,out=['開卡前請負責人決定 '+(q.length-dep)+' 件事'+(dep?'（另有 '+dep+' 題只在前一題選了跑時才要答）':'')+'。直接回「照建議」，或只回要改的題號和選項，例如「1乙」或「3甲丙」：'];
 q.forEach((x,i)=>{const d=[].concat(x.default);
  out.push((x.dependsOn?'　'+(i+1)+'.（前一題選了跑才要答）':(i+1)+'. ')+x.decide);
  out.push('　'+x.options.map((o,j)=>LETTERS[j]+' '+o.label+(d.includes(o.value)?'〔建議〕':'')).join('　'));
  out.push('　為什麼：'+x.why);});
 if(qs.settled?.length){out.push('已由掃描或安全規則決定（不用回）：');for(const s of qs.settled)out.push('　・'+s.reason);}
 return out.join('\n');
}
const ZH={full:'完整',light:'輕量','light-unauthorized':'未授權（只能讀碼）',deny:'全關',loopback:'只開本機',container:'容器內',none:'不試跑',skip:'不用','import-existing':'匯入你跑的結果',stub:'擋下或換成假的',account:'用測試帳號'};
export const zh=v=>ZH[v]??v;
export const pendingText=p=>(p?.pendingLabels??p?.pending??[]).join('、');
export function scopeLine(p){if(!p?.scope)return null;const s=p.scope;return '授權範圍：'+(s.isolatedRun?'可在隔離副本試跑（網路'+zh(s.network)+'）':s.depth==='light'?'只讀程式碼，不試跑':'未授權，只讀程式碼')+'；外部掃描工具'+zh(s.scanners)+(p.mode&&p.mode!=='integrate'?'':'；准許：'+(s.capabilities.length?s.capabilities.map(capLabel).join('、'):'無'))+((p.pending??[]).length?'；負責人未回覆 '+p.pending.length+' 項':'');}
export function scopeNotes(c,stepId){
 const p=c?.preflight;if(!p?.scope)return [];const n=[],s=p.scope;
 if(stepId==='D7'&&!s.isolatedRun)n.push('負責人未授權試跑：本步請跳過並記未知（超出範圍），不用靜態代替實測。');
 if(stepId==='D7'&&s.isolatedRun)n.push('已授權試跑；網路'+zh(s.network)+'；這個攔截只攔常見寫法，漏掉的通道要寫成未知。');
 if(stepId==='D5'&&s.scanners==='skip')n.push('沒有外部掃描工具結果：已知弱點版本記未知（超出範圍）。');
 if(stepId==='D2'&&s.outOfScope.length)n.push('負責人排除不查的路徑 '+s.outOfScope.length+' 個（列在卡片開頭）；報告會寫明沒查，不算查過。');
 if(stepId==='D6'){n.push('需要授權的能力請填固定選項（'+CAPS.map(x=>x[1]).join('、')+'），範圍再用「|」後面一句話補充；系統會自動對照負責人准了什麼。');const miss=(s.capabilityNeeds??[]).filter(x=>!s.capabilities.includes(x));if(miss.length)n.push('掃描看到它可能需要、但負責人沒准：'+miss.map(capLabel).join('、')+'；確認後填進需要授權的能力，或寫明為何不需要。');}
 if(p.decisionCap&&stepId==='D8'&&!['有條件可接','不建議'].includes(c.integration?.decision))n.push('負責人仍有未回覆項目（'+pendingText(p)+'），結論最多「有條件可接」。');
 return n;
}
