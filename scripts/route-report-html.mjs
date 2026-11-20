// 1.38 usage-route report: one offline HTML page. Top = 怎麼接 answer, then the route stations with file:line,
// then what this route touches, then unknowns. Mobile-first; the full model is embedded as JSON for agents.
import {uiTrialHtml} from './ui-trial.mjs';
import {CAP_LABEL} from './ast-graph.mjs';
import {adapterContract} from './adapter-contract.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const taipei=d=>new Date(d).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})+'（台北時間）';
const md=s=>esc(s).replace(/`([^`]+)`/g,'<code>$1</code>');
const loc=x=>x.file?'<code class="loc">'+esc(x.file)+(x.line?':'+x.line:'')+'</code>':'';
const RISKY=new Set(['subprocess','network','listen','paid','real-account','write-file','worker','mcp-tools','dynamic']);
// a touch that only runs under its own `if` (not an else / 不成立 branch) is conditional, not the normal path
const onlyIf=x=>(x.ownCtx??[]).some(c=>/^當 /.test(c)&&!/不成立/.test(c));
const riskLabels=R=>{const by=new Map();for(const t of R.filter(x=>RISKY.has(x.cap)&&x.cap!=='dynamic'))(by.get(t.label)??by.set(t.label,[]).get(t.label)).push(t);return [...by].map(([l,ts])=>ts.every(onlyIf)?l+'（只在特定情況）':l);};
// route capability → the fixed preflight options the owner grants (preflight.mjs CAPS)
export const CAP_GRANT={subprocess:'exec',network:'network',listen:'network','write-file':'fs-write','read-file':'fs-read',paid:'paid','real-account':'real-account','mcp-tools':'mcp-shell'};
const GRANT_LABEL={'fs-read':'讀檔','fs-write':'寫檔',exec:'執行其他程式',network:'連外網','real-account':'用真帳號',paid:'花錢',secrets:'讀機密','mcp-shell':'讓模型下系統指令'};
const SECRET_ENV=/KEY|TOKEN|SECRET|PASS|CREDENTIAL|AUTH/i;
// What this route needs the owner to grant, one row per preflight option, with the first place it happens.
export function capNeeds(m){
 const rows=new Map();
 for(const t of m.touches?.route??[]){const g=t.cap==='env'?(SECRET_ENV.test(t.envName??'')?'secrets':null):CAP_GRANT[t.cap];if(!g)continue;
  const r=rows.get(g)??rows.set(g,{grant:g,label:GRANT_LABEL[g],at:[],cond:true}).get(g);if(r.at.length<3)r.at.push(t);if(!onlyIf(t))r.cond=false;}
 const granted=new Set(m.scope?.granted??[]);
 return [...rows.values()].map(r=>({...r,granted:granted.has(r.grant),known:!!m.scope})).sort((a,b)=>(a.grant==='fs-read')-(b.grant==='fs-read'));
}
export function verdictOf(m){
 if(!m.entry||m.engine?.name!=='tree-sitter')return {label:'待查',tone:'amber',why:!m.entry?'找不到入口':'沒有語法解析，只能文字比對'};
 const risky=(m.touches?.route??[]).filter(t=>RISKY.has(t.cap)&&t.cap!=='dynamic');
 const cav=m.answer?.parts?.caveats??[],unk=(m.unknowns??[]).filter(u=>u.kind!=='inferred');
 if(risky.some(t=>['paid','real-account'].includes(t.cap)))return {label:'不建議直接接',tone:'red',why:'這條路會花錢或用真帳號'};
 const notGranted=capNeeds(m).filter(r=>!r.granted&&r.grant!=='fs-read');
 if(m.card?.decision==='不建議')return {label:'不建議直接接',tone:'red',why:m.card.summary??'讀碼的人結論是不建議'};
 if(risky.length&&notGranted.length||cav.length||unk.length||!m.trial?.ran||m.scope?.pending?.length)return {label:'有條件可接',tone:'amber',why:[risky.length?'這條路會'+riskLabels(risky).join('、')+(m.scope?(notGranted.length?'（'+notGranted.map(r=>r.label).join('、')+' 還沒准）':'（都已准）'):''):null,cav.length?cav.length+' 個接法注意事項':null,unk.length?unk.length+' 個未知':null,!m.trial?.ran?'還沒試跑':null,m.scope?.pending?.length?'開卡前問題還有 '+m.scope.pending.length+' 題沒回':null].filter(Boolean).join('；')};
 return {label:'可接',tone:'green',why:'原碼與試跑都對得上'};
}
const css=String.raw`
main p,main li,main dd,main td{overflow-wrap:anywhere}
.wire table.kvt{width:100%;border-collapse:collapse}.wire .kvt th{width:7.5em;text-align:left;vertical-align:top;padding:.45em .5em;color:#4a5a52;font-weight:600}.wire .kvt td{padding:.45em .5em;border-top:1px solid #e3e8e4}.wire pre{white-space:pre-wrap;word-break:break-all;font-size:.78em;background:#f4f6f4;padding:.6em;border-radius:6px}
@media (max-width:600px){.wire .kvt th,.wire .kvt td{display:block;width:auto;border:0;padding:.2em 0}.wire .kvt tr{display:block;border-top:1px solid #e3e8e4;padding:.4em 0}}

:root{color-scheme:light dark;--bg:#f5f6f3;--card:#fff;--ink:#22332c;--muted:#5f6f66;--line:#dce4dd;--green:#1f6f52;--greenbg:#e6f4ec;--amber:#7d5d0c;--amberbg:#fff6da;--red:#a8303b;--redbg:#fdecee;--blue:#1f66a0;--bluebg:#e9f3fc;--soft:#eef2ee}
@media(prefers-color-scheme:dark){:root{--bg:#131c18;--card:#1b2721;--ink:#e6efe8;--muted:#a9bbb0;--line:#3a4f43;--green:#83d9ac;--greenbg:#203a2d;--amber:#ecd180;--amberbg:#373020;--red:#ffa5ae;--redbg:#3d2327;--blue:#a2d3f7;--bluebg:#22384a;--soft:#24342b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,"Noto Sans TC","Microsoft JhengHei",sans-serif}
main{max-width:960px;margin:auto;padding:28px 20px 56px}h1{font-size:clamp(1.35rem,3.6vw,2rem);line-height:1.35;margin:6px 0 10px}h2{font-size:1.2rem;margin:30px 0 10px}
.eyebrow{font-size:.78rem;letter-spacing:.14em;font-weight:700;color:var(--green)}.muted{color:var(--muted)}code{font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--soft);padding:1px 5px;border-radius:5px;overflow-wrap:anywhere}
.chip{display:inline-block;white-space:nowrap;font-size:.8rem;font-weight:700;border-radius:999px;padding:2px 10px;margin-right:6px}.green{background:var(--greenbg);color:var(--green)}.amber{background:var(--amberbg);color:var(--amber)}.red{background:var(--redbg);color:var(--red)}.blue{background:var(--bluebg);color:var(--blue)}
.answer{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--green);border-radius:12px;padding:18px 20px;margin:16px 0}.answer .lead{font-size:1.08rem;margin:6px 0 14px}
.kv{display:grid;grid-template-columns:8.5em 1fr;gap:6px 14px;margin:0}.kv dt{color:var(--muted);font-weight:600}.kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
.route{list-style:none;margin:0;padding:0;counter-reset:st}.route li{position:relative;padding:0 0 14px 40px;counter-increment:st}.route li:before{content:counter(st);position:absolute;left:0;top:2px;width:26px;height:26px;border-radius:50%;background:var(--green);color:#fff;font-size:.8rem;font-weight:700;display:grid;place-items:center}
.route li:after{content:"";position:absolute;left:12px;top:30px;bottom:0;border-left:2px solid var(--line)}.route li:last-child:after{display:none}.route .box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;min-width:0}
.route .label{font-weight:700}.route pre{margin:6px 0 2px;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--soft);border-radius:6px;padding:6px 8px}.route .cond{font-size:.86rem;color:var(--amber)}.route .via{font-size:.8rem;color:var(--muted);overflow-wrap:anywhere}
.route li.r-error:before{background:var(--red)}.route li.r-usage:before{background:var(--blue)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:.92rem}th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line)}th{background:var(--soft);white-space:nowrap}td pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:9em;overflow:auto;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;min-width:0}.card h3{font-size:1rem;margin:0 0 6px}.card ul{margin:4px 0 0;padding-left:1.1em}
details{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:10px 0}summary{cursor:pointer;font-weight:600}
.notes{background:var(--amberbg);border-radius:10px;padding:10px 14px;margin:0 0 14px}.notes b{color:var(--amber)}.notes ul{margin:4px 0 0;padding-left:1.2em}.verified{margin:12px 0 0;font-size:.92rem}
.verdict{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:16px 0}.verdict h2{margin:0 0 8px}.chip.big{font-size:1rem;padding:4px 14px}.decide{background:var(--amberbg);border-radius:10px;padding:10px 14px;margin-top:12px}.decide ol{margin:6px 0 0;padding-left:1.3em}.small{font-size:.85rem}h3{font-size:1rem;margin:12px 0 4px}
.warn{background:var(--amberbg);color:var(--amber);border-radius:10px;padding:10px 14px;margin:10px 0}
@media(max-width:600px){main{padding:18px 12px 40px}.kv{grid-template-columns:1fr}.kv dt{margin-top:6px}.answer{padding:14px}.route li{padding-left:34px}table,thead,tbody,tr,td,th{display:block}thead{display:none}td{border:0;padding:4px 10px}tr{border-bottom:1px solid var(--line);padding:6px 0}td[data-k]:before{content:attr(data-k)'：';color:var(--muted);font-weight:600}}
`;
// 接線: the adapter contract as a table you can wire from, plus the JSON to copy
// how each pick was made: top candidates with scores, runner-up visible, close calls flagged
function choicesHtml(m){const cs=(m.choices??[]).filter(c=>c.ranked?.length>1);if(!cs.length)return '';
 return '<h2>怎麼挑的</h2><p class="muted">有好幾個候選時，每一項列分數與第二名；差距小的標「接近」，換法寫在旁邊。</p><table><thead><tr><th>挑什麼</th><th>挑中</th><th>第二名</th><th>其他</th></tr></thead><tbody>'+cs.map(c=>{const [a,b,...r]=c.ranked;const cell=x=>'<code>'+esc(x.name)+'</code> <span class="chip '+(x===a?'green':'')+'">'+esc(x.score)+' 分</span>'+(x.file?' '+loc(x):'')+(x.why?.length?'<div class="small muted">'+esc(x.why.join('、'))+'</div>':'');
  return '<tr><td data-k="挑什麼">'+esc(c.what)+'<div class="small muted">依'+esc(c.how)+'</div>'+(c.close?' <span class="chip amber">接近，可能挑錯</span>':'')+'</td><td data-k="挑中">'+cell(a)+'</td><td data-k="第二名">'+cell(b)+(b.switch?'<div class="small">換這個：<code>'+esc(b.switch)+'</code></div>':'')+'</td><td data-k="其他">'+(r.length?r.map(x=>'<div class="small"><code>'+esc(x.name)+'</code> '+esc(x.score)+' 分</div>').join(''):'—')+'</td></tr>';}).join('')+'</tbody></table>';}
function otherHtml(m){const er=(m.entryRank??[]).filter(r=>!(r.kind===m.entry?.kind&&r.name===m.entry?.name)),fo=m.framework?.others??[];
 const alt=er.length?er.map(r=>'<li>'+esc(r.kind==='bin'?'命令列 '+r.name:'函式庫 '+r.name)+' '+loc(r)+' <span class="small muted">分數 '+esc(r.score)+(r.why?.length?'：'+esc(r.why.join('、')):'')+'</span>　換這條：<code>--entry '+esc(r.kind==='bin'?'bin:'+r.name:r.file)+'</code></li>').join(''):(m.candidates??[]).filter(c=>!(c.kind===m.entry?.kind&&c.name===m.entry?.name)).map(c=>'<li>'+esc(c.kind==='bin'?'命令列 '+c.name:'函式庫 '+c.name)+' '+loc(c)+'</li>').join('');
 const fr=fo.map(r=>'<li><code>'+esc(r.name)+'</code> '+loc(r)+' <span class="small muted">分數 '+esc(r.score)+(r.why?.length?'：'+esc(r.why.join('、')):'')+'</span></li>').join('');
 const n=(alt.match(/<li>/g)??[]).length+fo.length;if(!n)return '';
 return '<details id="others"><summary>其他候選（'+n+'）</summary>'+(m.framework?.pickedWhy?.length?'<p class="small">選 '+esc(m.framework.picked.map(x=>x.name).join('、'))+' 的理由：'+esc(m.framework.pickedWhy.join('、'))+'</p>':'')+(alt?'<h3>入口</h3><ul>'+alt+'</ul>':'')+(fr?'<h3>路由／指令</h3><p class="small muted">問句點名路由路徑或用 --entry 檔換。</p><ul>'+fr+'</ul>':'')+'</details>';}
function targetHtml(th){if(!th)return '';const lab={has:['green','已有'],partial:['amber','部分'],doc:['blue','只有文件提到'],gap:['red','缺口']};
 return '<h3>'+esc(th.target)+' 已有／缺口</h3><p class="small muted">'+esc(th.note)+'（搜了 '+esc(th.searched)+' 檔）</p>'+(th.uses?.length?'<p><span class="chip green">已經在用</span> '+th.uses.map(u=>'<code>'+esc(u.name)+' '+esc(u.version)+'</code> <code class="loc">'+esc(u.file)+':'+u.line+'</code>').join('、')+'</p>':'')+(th.rows.length?'<table class="kvt">'+th.rows.map(r=>'<tr><th>'+esc(r.term.toUpperCase())+(r.dir==='r'?'<div class="small muted">讀進來</div>':r.dir==='w'?'<div class="small muted">產出</div>':'')+'</th><td><span class="chip '+lab[r.status][0]+'">'+lab[r.status][1]+'</span>'+(r.evidence.length?r.evidence.map(e=>'<div class="small">'+(e.kind==='unwired'?'<span class="chip amber">定義了沒人用</span> ':e.dependency?'<span class="chip green">依賴</span> ':'')+'<code class="loc">'+esc(e.file)+':'+e.line+'</code> '+esc(e.text)+(e.usedBy?' <span class="muted">← 用到它：<code class="loc">'+esc(e.usedBy.file)+':'+e.usedBy.line+'</code></span>':'')+'</div>').join(''):r.status!=='doc'?'<span class="small muted">沒找到同功能的模組或函式</span>':'')+(r.docs?.length?'<details class="small"><summary class="muted">文件提到 '+r.counts.docs+' 處（弱證據，不算已有）</summary>'+r.docs.map(e=>'<div><code class="loc">'+esc(e.file)+':'+e.line+'</code> '+esc(e.text)+'</div>').join('')+'</details>':'')+'</td></tr>').join('')+'</table>':'');}
function wireHtml(a,th){if(!a)return '';const row=(k,v)=>v?'<tr><th>'+esc(k)+'</th><td>'+v+'</td></tr>':'';
 const inv=a.invoke.kind==='command'?'<code>'+esc(a.invoke.command)+'</code>'+(a.invoke.fromSource?'<div class="small muted">從原碼跑：<code>'+esc(a.invoke.fromSource)+'</code></div>':'')+(a.invoke.via?'<div class="small">走 '+a.invoke.via.map(x=>'<code>'+esc(x)+'</code>').join('、')+'</div>':'')+(a.invoke.inferred?' <span class="chip amber">推論</span>':''):'<code>'+esc(a.invoke.import)+'</code>'+(a.invoke.call?' → '+a.invoke.call.map(x=>'<code>'+esc(x)+'</code>').join('、'):'');
 const sig=esc(a.signals.success)+(a.signals.failure.length?'<ul class="small">'+a.signals.failure.map(f=>'<li>'+esc(f.case)+'：結束碼 '+esc(f.exit)+(f.stderr?'，錯誤在錯誤輸出':'')+(f.stdoutDirty?'，標準輸出仍有內容':'')+(f.created?'，還建了 '+esc(f.created.join('、')):'')+'</li>').join('')+'</ul>':'')+(a.signals.timeoutSuggestMs?'<div class="small muted">逾時建議 '+(a.signals.timeoutSuggestMs/1000)+' 秒（試跑最慢的 5 倍）</div>':'');
 const files=(a.files.writes.length?a.files.writes.map(w=>'寫 <code>'+esc(w.at)+'</code>（'+esc(w.how)+'，'+(w.when==='每次'?'每次':'只在「'+esc(w.when)+'」時')+'）').join('<br>'):'這條路不寫檔')+(a.files.trialChanged?'<div class="small">試跑改到：'+(a.files.trialChanged.length?esc(a.files.trialChanged.join('、')):'沒有')+'</div>':'');
 const grants=a.grants.length?a.grants.map(g=>'<span class="chip '+(g.need==='讀檔'&&!g.conditional?'green':g.conditional?'amber':'red')+'">'+esc(g.need)+(g.conditional?'（只在「'+esc(String(g.when).slice(0,30))+'」時）':'')+'</span> <code class="loc">'+esc(g.at)+'</code>').join('<br>'):'<span class="chip green">不用額外授權</span>';
 return '<section class="wire" id="wire"><h2>接線</h2><p class="muted">把這條路接成一個步驟要的東西；依據：'+esc(a.basis)+'。</p><table class="kvt">'+
  row('呼叫',inv)+row('給它',a.inputs.map(i=>esc((i.format?i.format.toUpperCase()+' ':'')+i.name+'，'+i.how)).join('<br>'))+
  row('拿回',a.outputs.length?a.outputs.map(o=>esc(o.channel+'：'+o.format+(o.when&&o.when!=='每次'?'（只在「'+o.when+'」時）':''))+' <span class="small muted">'+esc(o.checked)+'</span>').join('<br>'):'<span class="muted">未知</span>')+
  row('成功／失敗',sig)+row('動到的檔',files)+row('要准',grants)+row('還要試的',a.unknowns.length?'<ul class="small">'+a.unknowns.map(u=>'<li>'+esc(u)+'</li>').join('')+'</ul>':'')+
  row('步驟描述',esc(a.step.id)+'：'+esc(a.step.inputs.join(','))+' → '+esc(a.step.outputs.join(','))+'，'+esc(a.step.execution_class)+'；停下條件：'+esc(a.step.stop_if))+
  '</table>'+targetHtml(th)+'<details><summary>接線合約 JSON（可直接複製）</summary><pre>'+esc(JSON.stringify(a,null,1))+'</pre></details></section>';}
function decideHtml(m,v){
 const needs=capNeeds(m),c=m.card;
 const decide=[...needs.filter(r=>!r.granted&&r.grant!=='fs-read').map(r=>({text:'要不要准：'+r.label+(r.cond?'（只在特定情況）':''),at:r.at,next:m.scope?'你還沒准；不准就維持「有條件可接」':'還沒做開卡前問答（加 --preflight 答覆.json 帶入），先當作不准'})),
  ...(m.scope?.pendingLabels??[]).map(x=>({text:'開卡前問題沒回：'+x,next:'沒回覆就當作不准'})),
  ...(c?.ownerDecisions??[]).filter(x=>x.kind!=='capability'&&x.kind!=='preflight').map(x=>({text:x.text,next:x.next,anchors:x.anchors}))];
 const rows=needs.map(r=>'<tr><td data-k="能力">'+esc(r.label)+(r.cond?' <span class="chip amber">只在特定情況</span>':'')+'</td><td data-k="這條路在哪">'+r.at.map(loc).join(' ')+'</td><td data-k="授權">'+(!r.known?'<span class="chip amber">還沒問</span>':r.granted?'<span class="chip green">已准</span>':'<span class="chip red">沒准</span>')+'</td></tr>').join('');
 return '<section class="verdict" id="verdict"><h2>能不能接</h2><p><span class="chip big '+v.tone+'">'+esc(v.label)+'</span> <span class="muted">'+esc(v.why)+'</span></p>'+
  (c?'<p class="muted">讀碼結論（鏈卡）：<b>'+esc(c.decision)+'</b>'+(c.decisionCap?'，上限 '+esc(c.decisionCap):'')+(c.summary?'。'+esc(c.summary):'')+'</p>'+(c.why?.length?'<ul>'+c.why.slice(0,6).map(x=>'<li>'+esc(x.text)+' '+(x.anchors??[]).slice(0,2).map(a=>'<code class="loc">'+esc(a)+'</code>').join(' ')+'</li>').join('')+'</ul>':''):'')+
  (needs.length?'<table><thead><tr><th>這條路需要的能力</th><th>在哪</th><th>授權</th></tr></thead><tbody>'+rows+'</tbody></table>':'<p class="muted">這條路沒有需要授權的能力。</p>')+
  '<div class="decide"><b>你要決定（'+decide.length+'）</b>'+(decide.length?'<ol>'+decide.map(x=>'<li>'+esc(x.text)+' '+(x.at??[]).slice(0,2).map(loc).join(' ')+(x.anchors??[]).slice(0,2).map(a=>' <code class="loc">'+esc(a)+'</code>').join('')+'<div class="muted small">'+esc(x.next??'')+'</div></li>').join('')+'</ol>':'<p class="muted">沒有要你決定的事。</p>')+
  (m.scope?'<p class="small">你目前准的：'+((m.scope.granted??[]).length?m.scope.granted.map(g=>'<span class="chip green">'+esc(GRANT_LABEL[g]??g)+'</span>').join(''):'<span class="chip red">什麼都沒准</span>')+(m.scope.simulated?' <span class="chip amber">模擬回覆</span>':'')+'</p>':'')+'</div></section>';
}
function cardDetails(c){
 if(!c)return '';
 const cand=c.candidates??[];
 return '<details id="card"><summary>鏈卡細節（讀碼紀錄：'+esc(c.anchors?.pass??0)+'／'+esc(c.anchors?.total??0)+' 錨點核對、線索 '+esc(c.counts?.code??0)+' 筆）</summary>'+
  (c.conditions?.length?'<h3>接入條件</h3><ul>'+c.conditions.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+(c.permissions?.length?'<h3>需要的權限</h3><ul>'+c.permissions.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+
  (c.verdict?.cleared?.length?'<h3>查過、不是問題</h3><ul>'+c.verdict.cleared.map(x=>'<li>'+esc(x.text)+'</li>').join('')+'</ul>':'')+
  (c.unknowns?.length?'<h3>鏈卡上的未知</h3><ul>'+c.unknowns.map(u=>'<li>'+esc(u.question)+(u.next?.action?' <span class="muted">→ '+esc(u.next.action)+'</span>':'')+'</li>').join('')+'</ul>':'')+
  (cand.length?'<h3>掃描線索（前 30 筆；不是弱點判定）</h3><table><thead><tr><th>類別</th><th>位置</th></tr></thead><tbody>'+cand.filter(x=>!x.test).slice(0,30).map(x=>'<tr><td data-k="類別">'+esc(x.category)+(x.citedOnCard?' <span class="chip green">卡上引用</span>':'')+'</td><td data-k="位置">'+loc(x)+'</td></tr>').join('')+'</tbody></table>':'')+
  (c.flags?.length?'<h3>工具提醒</h3><ul>'+c.flags.slice(0,10).map(f=>'<li>'+esc(f)+'</li>').join('')+'</ul>':'')+
  (c.preflight?'<p class="muted small">開卡前回覆者：'+esc(c.preflight.answeredBy)+(c.preflight.simulated?'（模擬）':'')+'</p>':'')+'</details>';
}
function stationHtml(s){
 return '<li class="r-'+esc(s.role)+'"><div class="box"><div><span class="label">'+esc(s.label)+'</span> '+loc(s)+' <span class="chip '+(/推論/.test(s.status)?'amber':s.status==='文件'?'blue':'green')+'">'+esc(s.status)+'</span></div>'+
  (s.code?'<pre>'+esc(s.code)+'</pre>':'')+(s.ctx?.length?'<div class="cond">條件：'+s.ctx.map(esc).join('，且 ')+'</div>':'')+(s.via?.length>1?'<div class="via">怎麼走到：'+s.via.map(esc).join(' → ')+'</div>':'')+'</div></li>';
}
function touchCards(list,{max=6}={}){
 const by=new Map();for(const t of list)(by.get(t.cap)??by.set(t.cap,[]).get(t.cap)).push(t);
 const order=[...by.keys()].sort((a,b)=>(RISKY.has(b)-RISKY.has(a))||by.get(b).length-by.get(a).length);
 return '<div class="cards">'+order.map(k=>{const xs=by.get(k);return '<div class="card"><h3>'+(RISKY.has(k)?'<span class="chip amber">要准</span>':'')+esc(CAP_LABEL[k]??k)+' <span class="muted">'+xs.length+' 處</span></h3><ul>'+xs.slice(0,max).map(t=>'<li>'+loc(t)+(t.ctx?.length?' <span class="muted">（'+esc(t.ctx[0])+'）</span>':'')+'</li>').join('')+(xs.length>max?'<li class="muted">另有 '+(xs.length-max)+' 處（見內嵌資料）</li>':'')+'</ul></div>';}).join('')+'</div>';
}
// the UI path the trial pressed, shown under the code route: page → menu → control → file
function uiRouteHtml(u){if(!u?.ran||!u.results?.length)return '';return '<p class="muted">介面路線（介面試跑實際按過）：</p><ol class="route">'+u.results.map(r=>'<li><b>'+esc(r.term.toUpperCase())+'</b> '+esc((r.pagesTried??[]).slice(-1)[0]??'/')+' → '+esc([...(r.via??[]),r.clicked?.label??'（找不到按鈕）'].join(' → '))+' → <code>'+esc(r.file)+'</code> → '+(r.ok?'<span class="chip green">'+esc(r.output.kind.toUpperCase()+' '+r.output.note)+'</span>':'<span class="chip red">'+esc(r.error??'沒拿到檔')+'</span>')+'</li>').join('')+'</ol>';}
export function renderRouteHtml(m,{card=null}={}){
 if(card)m={...m,card:{decision:card.decision,decisionCap:card.decisionCap,summary:card.verdict?.summary??null,why:card.verdict?.why??[],ownerDecisions:card.ownerDecisions??[]}};
 const v=verdictOf(m),a=m.answer??{},p=a.parts??{},t=m.trial,R=m.touches?.route??[],E=m.touches?.elsewhere??[];
 const riskyRoute=riskLabels(R);
 const riskyElse=[...new Set(E.filter(x=>RISKY.has(x.cap)&&!R.some(r=>r.cap===x.cap)).map(x=>x.label))];
 const kv=[['入口',p.entry?.replace(/^可以先接/,'')],['給它',p.input],['拿回',p.output],['這條路會碰',riskyRoute.length?riskyRoute.join('、')+'（要准）':'沒看到連網、跑其他程式、開連線埠'+(riskyElse.length?'；repo 別處有 '+riskyElse.join('、')+'，這條路沒走到':'')]].filter(([,x])=>x);
 const edited=a.draft===false;
 const lead=edited||!p.entry?a.text:p.entry+'。'+p.input+'；'+p.output+'。'+(riskyRoute.length&&p.touches?p.touches+'。':'')+(p.offRoute?p.offRoute+'。':'')+(p.uiTrial?p.uiTrial+'。':'')+(p.agent?p.agent+'。':'')+(p.target?p.target+'。':'');
 const notes=edited?[]:(p.caveats?.length?p.caveats:p.error?[p.error]:[]);
 const trialHtml=t?.ran?'<h2>試跑（隔離副本）</h2><p class="muted">'+esc(t.isolation)+'；指令 <code>'+esc(t.run)+'</code>；'+esc(taipei(t.at))+'</p><table><thead><tr><th>情況</th><th>結束碼</th><th>標準輸出</th><th>錯誤輸出</th><th>改檔</th></tr></thead><tbody>'+
  t.cases.map(c=>'<tr><td data-k="情況">'+esc(c.label)+(c.sameStdout!==undefined?(c.sameStdout?' <span class="chip green">和第一次相同</span>':' <span class="chip amber">和第一次不同</span>'):'')+'</td><td data-k="結束碼"><span class="chip '+(c.exit===0?'green':'red')+'">'+esc(c.exit)+'</span>'+(c.timedOut?' 逾時':'')+'</td><td data-k="標準輸出">'+(c.json?.ok?'<span class="chip green">JSON</span> '+esc(c.json.shape):'<span class="chip amber">不是 JSON</span>')+'<pre>'+esc(c.stdout.slice(0,400))+'</pre></td><td data-k="錯誤輸出"><pre>'+esc(c.stderr.split('\n').slice(0,3).join('\n'))+'</pre></td><td data-k="改檔">'+(c.changed.length?esc(c.changed.join('、')):'沒有')+'</td></tr>').join('')+'</tbody></table>'
  :'<h2>試跑</h2><p class="muted">還沒試跑。要確認輸出格式與錯誤行為：<code>node scripts/trace.mjs route … --trial --run "&lt;指令 {input}&gt;"</code>（隔離副本、網路關閉、用假檔）。</p>';
 const unk=(m.unknowns??[]);
 const meta='受查：<code>'+esc(m.repo?.name)+'</code> 版本 <code>'+esc(m.repo?.version??'未知')+'</code> 提交 <code>'+esc((m.repo?.commit??'無版本控制').slice(0,12))+'</code>'+(m.repo?.dirty?' <span class="chip amber">有未提交修改</span>':'')+'<br>解析：'+(m.engine?.name==='tree-sitter'?'語法樹（tree-sitter '+esc(m.engine.version)+'），'+esc(m.stats?.files??0)+' 檔、'+esc(m.stats?.units??0)+' 個函式、這條路走到 '+esc(m.reachedUnits??0)+' 個':'<b>文字比對（沒有語法解析）</b>：'+esc(m.engine?.reason))+'<br>產生：'+esc(taipei(m.generatedAt));
 const body='<header><div class="eyebrow">查線 · 用途路線</div><h1>'+esc(m.question||'（沒有填用途）')+'</h1><span class="chip '+v.tone+'">'+esc(v.label)+'</span><span class="muted">'+esc(v.why)+'</span></header>'+
  (m.engine?.name!=='tree-sitter'?'<div class="warn">這份沒有用語法解析（'+esc(m.engine?.reason)+'），路線與能力可能漏抓或誤判。</div>':'')+
  '<section class="answer" id="how"><div class="eyebrow">怎麼接</div><p class="lead">'+md(lead)+'</p>'+(notes.length?'<div class="notes"><b>接的時候注意</b><ul>'+notes.map(x=>'<li>'+md(x)+'</li>').join('')+'</ul></div>':'')+'<dl class="kv">'+kv.map(([k,x])=>'<dt>'+esc(k)+'</dt><dd>'+md(x)+'</dd>').join('')+'</dl>'+(p.verified?'<p class="verified"><span class="chip '+(m.trial?.ran?'green':'amber')+'">'+(m.trial?.ran?'已試跑':'待試跑')+'</span>'+md(p.verified)+'</p>':'')+(a.draft?'<p class="muted" style="margin:10px 0 0;font-size:.85rem">這段由路線與試跑事實自動組成；agent 讀碼後可用 route-report --answer 改寫。</p>':'')+'</section>'+decideHtml(m,v)+wireHtml(m.adapter??adapterContract(m),m.targetHas)+
  '<h2>路線</h2><p class="muted">每一站都是原碼裡的實際位置（版本 '+esc((m.repo?.commit??'').slice(0,12)||'未知')+'）。</p><ol class="route">'+m.stations.map(stationHtml).join('')+'</ol>'+uiRouteHtml(m.uiTrial)+
  (m.conditional?.length?'<details><summary>有條件才會走的動作（'+m.conditional.length+'）</summary><ul>'+m.conditional.map(c=>'<li>'+esc(c.label)+' '+loc(c)+'：'+c.when.map(esc).join('，且 ')+'</li>').join('')+'</ul></details>':'')+
  trialHtml+uiTrialHtml(m.uiTrial,esc)+choicesHtml(m)+
  '<h2>這條路會碰到什麼</h2>'+(R.length?touchCards(R):'<p class="muted">沒有。</p>')+
  '<details><summary>repo 有、但這條路沒走到（'+E.length+' 處）</summary><p class="muted">只有這條路真的走到才算接入條件；這些列出來讓你知道 repo 別處有。</p>'+touchCards(E,{max:5})+'</details>'+
  '<h2>未知</h2>'+(unk.length?'<ul>'+unk.map(u=>'<li>'+(u.file?loc(u)+' ':'')+esc(u.text)+'</li>').join('')+'</ul>':'<p class="muted">沒有。</p>')+
  otherHtml(m)+
  cardDetails(card)+'<details class="meta"><summary>版本與來源</summary><p>'+meta+'</p></details>';
 const data='<script type="application/json" id="trace-route-data">'+JSON.stringify(m).replace(/</g,'\\u003c')+'</script>'+(card?'<script type="application/json" id="trace-report">'+JSON.stringify(card).replace(/</g,'\\u003c')+'</script>':'');
 return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'"><title>'+esc('查線：'+(m.question||m.repo?.name))+'</title><style>'+css+'</style></head><body><main>'+body+'</main>'+data+'</body></html>\n';
}
