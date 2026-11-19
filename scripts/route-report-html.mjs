// 1.38 usage-route report: one offline HTML page. Top = 怎麼接 answer, then the route stations with file:line,
// then what this route touches, then unknowns. Mobile-first; the full model is embedded as JSON for agents.
import {CAP_LABEL} from './ast-graph.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const taipei=d=>new Date(d).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})+'（台北時間）';
const md=s=>esc(s).replace(/`([^`]+)`/g,'<code>$1</code>');
const loc=x=>x.file?'<code class="loc">'+esc(x.file)+(x.line?':'+x.line:'')+'</code>':'';
const RISKY=new Set(['subprocess','network','listen','paid','real-account','write-file','worker','mcp-tools','dynamic']);
// a touch that only runs under its own `if` (not an else / 不成立 branch) is conditional, not the normal path
const onlyIf=x=>(x.ownCtx??[]).some(c=>/^當 /.test(c)&&!/不成立/.test(c));
const riskLabels=R=>{const by=new Map();for(const t of R.filter(x=>RISKY.has(x.cap)&&x.cap!=='dynamic'))(by.get(t.label)??by.set(t.label,[]).get(t.label)).push(t);return [...by].map(([l,ts])=>ts.every(onlyIf)?l+'（只在特定情況）':l);};
export function verdictOf(m){
 if(!m.entry||m.engine?.name!=='tree-sitter')return {label:'待查',tone:'amber',why:!m.entry?'找不到入口':'沒有語法解析，只能文字比對'};
 const risky=(m.touches?.route??[]).filter(t=>RISKY.has(t.cap)&&t.cap!=='dynamic');
 const cav=m.answer?.parts?.caveats??[],unk=(m.unknowns??[]).filter(u=>u.kind!=='inferred');
 if(risky.some(t=>['paid','real-account'].includes(t.cap)))return {label:'不建議直接接',tone:'red',why:'這條路會花錢或用真帳號'};
 if(risky.length||cav.length||unk.length||!m.trial?.ran)return {label:'有條件可接',tone:'amber',why:[risky.length?'這條路會'+riskLabels(risky).join('、'):null,cav.length?cav.length+' 個接法注意事項':null,unk.length?unk.length+' 個未知':null,!m.trial?.ran?'還沒試跑':null].filter(Boolean).join('；')};
 return {label:'可接',tone:'green',why:'原碼與試跑都對得上'};
}
const css=String.raw`
:root{color-scheme:light dark;--bg:#f5f6f3;--card:#fff;--ink:#22332c;--muted:#5f6f66;--line:#dce4dd;--green:#1f6f52;--greenbg:#e6f4ec;--amber:#7d5d0c;--amberbg:#fff6da;--red:#a8303b;--redbg:#fdecee;--blue:#1f66a0;--bluebg:#e9f3fc;--soft:#eef2ee}
@media(prefers-color-scheme:dark){:root{--bg:#131c18;--card:#1b2721;--ink:#e6efe8;--muted:#a9bbb0;--line:#3a4f43;--green:#83d9ac;--greenbg:#203a2d;--amber:#ecd180;--amberbg:#373020;--red:#ffa5ae;--redbg:#3d2327;--blue:#a2d3f7;--bluebg:#22384a;--soft:#24342b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,"Noto Sans TC","Microsoft JhengHei",sans-serif}
main{max-width:960px;margin:auto;padding:28px 20px 56px}h1{font-size:clamp(1.35rem,3.6vw,2rem);line-height:1.35;margin:6px 0 10px}h2{font-size:1.2rem;margin:30px 0 10px}
.eyebrow{font-size:.78rem;letter-spacing:.14em;font-weight:700;color:var(--green)}.muted{color:var(--muted)}code{font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--soft);padding:1px 5px;border-radius:5px;overflow-wrap:anywhere}
.chip{display:inline-block;font-size:.8rem;font-weight:700;border-radius:999px;padding:2px 10px;margin-right:6px}.green{background:var(--greenbg);color:var(--green)}.amber{background:var(--amberbg);color:var(--amber)}.red{background:var(--redbg);color:var(--red)}.blue{background:var(--bluebg);color:var(--blue)}
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
.warn{background:var(--amberbg);color:var(--amber);border-radius:10px;padding:10px 14px;margin:10px 0}
@media(max-width:600px){main{padding:18px 12px 40px}.kv{grid-template-columns:1fr}.kv dt{margin-top:6px}.answer{padding:14px}.route li{padding-left:34px}table,thead,tbody,tr,td,th{display:block}thead{display:none}td{border:0;padding:4px 10px}tr{border-bottom:1px solid var(--line);padding:6px 0}td[data-k]:before{content:attr(data-k)'：';color:var(--muted);font-weight:600}}
`;
function stationHtml(s){
 return '<li class="r-'+esc(s.role)+'"><div class="box"><div><span class="label">'+esc(s.label)+'</span> '+loc(s)+' <span class="chip '+(/推論/.test(s.status)?'amber':s.status==='文件'?'blue':'green')+'">'+esc(s.status)+'</span></div>'+
  (s.code?'<pre>'+esc(s.code)+'</pre>':'')+(s.ctx?.length?'<div class="cond">條件：'+s.ctx.map(esc).join('，且 ')+'</div>':'')+(s.via?.length>1?'<div class="via">怎麼走到：'+s.via.map(esc).join(' → ')+'</div>':'')+'</div></li>';
}
function touchCards(list,{max=6}={}){
 const by=new Map();for(const t of list)(by.get(t.cap)??by.set(t.cap,[]).get(t.cap)).push(t);
 const order=[...by.keys()].sort((a,b)=>(RISKY.has(b)-RISKY.has(a))||by.get(b).length-by.get(a).length);
 return '<div class="cards">'+order.map(k=>{const xs=by.get(k);return '<div class="card"><h3>'+(RISKY.has(k)?'<span class="chip amber">要准</span>':'')+esc(CAP_LABEL[k]??k)+' <span class="muted">'+xs.length+' 處</span></h3><ul>'+xs.slice(0,max).map(t=>'<li>'+loc(t)+(t.ctx?.length?' <span class="muted">（'+esc(t.ctx[0])+'）</span>':'')+'</li>').join('')+(xs.length>max?'<li class="muted">另有 '+(xs.length-max)+' 處（見內嵌資料）</li>':'')+'</ul></div>';}).join('')+'</div>';
}
export function renderRouteHtml(m){
 const v=verdictOf(m),a=m.answer??{},p=a.parts??{},t=m.trial,R=m.touches?.route??[],E=m.touches?.elsewhere??[];
 const riskyRoute=riskLabels(R);
 const riskyElse=[...new Set(E.filter(x=>RISKY.has(x.cap)&&!R.some(r=>r.cap===x.cap)).map(x=>x.label))];
 const kv=[['入口',p.entry?.replace(/^可以先接/,'')],['給它',p.input],['拿回',p.output],['這條路會碰',riskyRoute.length?riskyRoute.join('、')+'（要准）':'沒看到連網、跑其他程式、開連線埠'+(riskyElse.length?'；repo 別處有 '+riskyElse.join('、')+'，這條路沒走到':'')]].filter(([,x])=>x);
 const edited=a.draft===false;
 const lead=edited||!p.entry?a.text:p.entry+'。'+p.input+'；'+p.output+'。'+(riskyRoute.length&&p.touches?p.touches+'。':'');
 const notes=edited?[]:(p.caveats?.length?p.caveats:p.error?[p.error]:[]);
 const trialHtml=t?.ran?'<h2>試跑（隔離副本）</h2><p class="muted">'+esc(t.isolation)+'；指令 <code>'+esc(t.run)+'</code>；'+esc(taipei(t.at))+'</p><table><thead><tr><th>情況</th><th>結束碼</th><th>標準輸出</th><th>錯誤輸出</th><th>改檔</th></tr></thead><tbody>'+
  t.cases.map(c=>'<tr><td data-k="情況">'+esc(c.label)+(c.sameStdout!==undefined?(c.sameStdout?' <span class="chip green">和第一次相同</span>':' <span class="chip amber">和第一次不同</span>'):'')+'</td><td data-k="結束碼"><span class="chip '+(c.exit===0?'green':'red')+'">'+esc(c.exit)+'</span>'+(c.timedOut?' 逾時':'')+'</td><td data-k="標準輸出">'+(c.json?.ok?'<span class="chip green">JSON</span> '+esc(c.json.shape):'<span class="chip amber">不是 JSON</span>')+'<pre>'+esc(c.stdout.slice(0,400))+'</pre></td><td data-k="錯誤輸出"><pre>'+esc(c.stderr.split('\n').slice(0,3).join('\n'))+'</pre></td><td data-k="改檔">'+(c.changed.length?esc(c.changed.join('、')):'沒有')+'</td></tr>').join('')+'</tbody></table>'
  :'<h2>試跑</h2><p class="muted">還沒試跑。要確認輸出格式與錯誤行為：<code>node scripts/trace.mjs route … --trial --run "&lt;指令 {input}&gt;"</code>（隔離副本、網路關閉、用假檔）。</p>';
 const unk=(m.unknowns??[]);
 const meta='受查：<code>'+esc(m.repo?.name)+'</code> 版本 <code>'+esc(m.repo?.version??'未知')+'</code> 提交 <code>'+esc((m.repo?.commit??'無版本控制').slice(0,12))+'</code>'+(m.repo?.dirty?' <span class="chip amber">有未提交修改</span>':'')+'<br>解析：'+(m.engine?.name==='tree-sitter'?'語法樹（tree-sitter '+esc(m.engine.version)+'），'+esc(m.stats?.files??0)+' 檔、'+esc(m.stats?.units??0)+' 個函式、這條路走到 '+esc(m.reachedUnits??0)+' 個':'<b>文字比對（沒有語法解析）</b>：'+esc(m.engine?.reason))+'<br>產生：'+esc(taipei(m.generatedAt));
 const body='<header><div class="eyebrow">查線 · 用途路線</div><h1>'+esc(m.question||'（沒有填用途）')+'</h1><span class="chip '+v.tone+'">'+esc(v.label)+'</span><span class="muted">'+esc(v.why)+'</span></header>'+
  (m.engine?.name!=='tree-sitter'?'<div class="warn">這份沒有用語法解析（'+esc(m.engine?.reason)+'），路線與能力可能漏抓或誤判。</div>':'')+
  '<section class="answer" id="how"><div class="eyebrow">怎麼接</div><p class="lead">'+md(lead)+'</p>'+(notes.length?'<div class="notes"><b>接的時候注意</b><ul>'+notes.map(x=>'<li>'+md(x)+'</li>').join('')+'</ul></div>':'')+'<dl class="kv">'+kv.map(([k,x])=>'<dt>'+esc(k)+'</dt><dd>'+md(x)+'</dd>').join('')+'</dl>'+(p.verified?'<p class="verified"><span class="chip '+(m.trial?.ran?'green':'amber')+'">'+(m.trial?.ran?'已試跑':'待試跑')+'</span>'+md(p.verified)+'</p>':'')+(a.draft?'<p class="muted" style="margin:10px 0 0;font-size:.85rem">這段由路線與試跑事實自動組成；agent 讀碼後可用 route-report --answer 改寫。</p>':'')+'</section>'+
  '<h2>路線</h2><p class="muted">每一站都是原碼裡的實際位置（版本 '+esc((m.repo?.commit??'').slice(0,12)||'未知')+'）。</p><ol class="route">'+m.stations.map(stationHtml).join('')+'</ol>'+
  (m.conditional?.length?'<details><summary>有條件才會走的動作（'+m.conditional.length+'）</summary><ul>'+m.conditional.map(c=>'<li>'+esc(c.label)+' '+loc(c)+'：'+c.when.map(esc).join('，且 ')+'</li>').join('')+'</ul></details>':'')+
  trialHtml+
  '<h2>這條路會碰到什麼</h2>'+(R.length?touchCards(R):'<p class="muted">沒有。</p>')+
  '<details><summary>repo 有、但這條路沒走到（'+E.length+' 處）</summary><p class="muted">只有這條路真的走到才算接入條件；這些列出來讓你知道 repo 別處有。</p>'+touchCards(E,{max:5})+'</details>'+
  '<h2>未知</h2>'+(unk.length?'<ul>'+unk.map(u=>'<li>'+(u.file?loc(u)+' ':'')+esc(u.text)+'</li>').join('')+'</ul>':'<p class="muted">沒有。</p>')+
  (m.candidates?.length>1?'<details><summary>其他入口（'+(m.candidates.length-1)+'）</summary><ul>'+m.candidates.filter(c=>c!==m.entry&&!(c.kind===m.entry?.kind&&c.name===m.entry?.name)).map(c=>'<li>'+esc(c.kind==='bin'?'命令列 '+c.name:'函式庫 '+c.name)+' '+loc(c)+'　換這條：<code>--entry '+esc(c.kind==='bin'?'bin:'+c.name:'library')+'</code></li>').join('')+'</ul></details>':'')+
  '<details class="meta"><summary>版本與來源</summary><p>'+meta+'</p></details>';
 const data='<script type="application/json" id="trace-route-data">'+JSON.stringify(m).replace(/</g,'\\u003c')+'</script>';
 return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'"><title>'+esc('查線：'+(m.question||m.repo?.name))+'</title><style>'+css+'</style></head><body><main>'+body+'</main>'+data+'</body></html>\n';
}
