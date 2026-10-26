import {displayGroups,renderGroups} from './display-groups.mjs';
import {buildMaintenance,renderMaintenanceHTML} from './maintenance.mjs';
// Human-only projection. Does not mutate the agent model or static maps.
import fs from 'node:fs';
const lex=JSON.parse(fs.readFileSync(new URL('../assets/plain-language.json',import.meta.url),'utf8'));
const t=(key,args={})=>String(lex.ui[key]??key).replace(/\{(\w+)\}/g,(_,k)=>args[k]??'');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unique=xs=>[...new Set(xs)];
const plain=(s,fallback)=>{s=lex.aliases[s]??s;return typeof s==='string'&&s.trim()&&!/[A-Za-z_<>\/\\`]/.test(s)&&s.length<=40?s:fallback;};
const format=(s,args)=>s.replace(/\{(\w+)\}/g,(_,k)=>args[k]??'');
const loc=x=>esc(x.file??x.path??'')+(Number.isInteger(x.line)&&x.line>0?':'+x.line:'');
const detail=body=>'<details class="technical"><summary>'+t('detail')+'</summary><div class="detail-body">'+body+'</div></details>';
const files=xs=>'<ul class="filelist">'+xs.slice(0,3).map(p=>'<li><code>'+esc(p)+'</code></li>').join('')+'</ul>';
const clues=(cs=[],ns=[])=>cs.slice(0,3).map(c=>'<blockquote><b>'+esc(c.source)+'</b> <code>'+loc(c)+'</code><p>'+esc(c.text)+'</p></blockquote>').join('')+ns.slice(0,3).map(n=>'<blockquote><b>'+t('inference')+'</b><p>'+esc(n.reason)+'</p><code>'+n.sources.map(esc).join(' / ')+'</code></blockquote>').join('');
const blockName=(b,i)=>plain(b.name,t('genericBlock',{n:i+1}));
export function humanIssues(r){
  const roots=new Set(r.roots.filter(x=>x.role==='production').map(x=>x.file)), grouped=new Map();
  for(const f of r.issues){
    const target=r.blocks.find(b=>b.files.includes(f.target));
    // The original reason contains the exact edge kind; keep the raw model unchanged.
    const bundled=f.category==='nonproduction'&&roots.has(f.file)&&f.reason.includes('DATA_READ')&&r.issues.some(g=>g.category==='generated'&&(g.witnesses??[]).some(w=>w.file===f.file));
    const category=bundled?'bundled':f.category;
    const key=JSON.stringify([f.file,target?.id??'(outside)',category]);
    if(!grouped.has(key))grouped.set(key,{category,file:f.file,blockId:target?.id,items:[]});
    grouped.get(key).items.push(f);
  }
  const rank={broken:0,nonproduction:1,redirect:2,generated:3,bundled:4};
  return [...grouped.values()].sort((a,b)=>(rank[a.category]??9)-(rank[b.category]??9)||a.file.localeCompare(b.file)).map((c,i)=>({...c,id:'human-issue-'+i,targets:unique(c.items.map(f=>f.target).filter(Boolean))}));
}
export function humanStats(r){
 const issues=humanIssues(r);
 return {...r.stats,broken:issues.filter(x=>x.category==='broken').length,odd:issues.filter(x=>x.category!=='broken').length};
}
function issueCard(c){
 const copy=lex.issues[c.category]??lex.issues.limitation;
 const original=c.items.slice(0,3).map(f=>'<section><p><b>'+t('position')+'</b> '+f.locations.slice(0,3).map(loc).join(' / ')+'</p><p><b>'+t('target')+'</b> <code>'+esc(f.target)+'</code></p><p>'+esc(f.reason)+'</p>'+((f.witnesses??[]).length?'<p>'+t('witness')+' '+f.witnesses.slice(0,3).map(loc).join(' / ')+'</p>':'')+clues(f.clues,f.notes)+'</section>').join('');
 return '<article class="issue card" data-category="'+c.category+'" id="'+c.id+'"><div class="card-content"><div class="kicker">'+t('targetCount',{n:c.targets.length})+'</div><h3>'+copy.name+'</h3><p>'+copy.description+'</p><p class="risk"><b>'+t('risk')+'：</b>'+copy.risk+'</p><p class="advice"><b>'+t('advice')+'：</b>'+copy.advice+'</p></div>'+detail(original)+'</article>';
}
function groupCard(g,r){
 const copy=lex.issues[g.category],b=r.blocks.find(b=>b.id===g.blockId),i=r.blocks.indexOf(b);
 return '<article class="card group" data-category="'+g.category+'"><div class="card-content"><div class="kicker">'+copy.name+'</div><h3>'+blockName(b??{name:g.block},Math.max(0,i))+' · '+t('fileCount',{n:g.files.length})+'</h3><p>'+format(copy.description,{n:g.files.length})+'</p><p class="risk"><b>'+t('risk')+'：</b>'+copy.risk+'</p><p class="advice"><b>'+t('advice')+'：</b>'+copy.advice+'</p></div>'+detail('<h4>'+t('groupList')+'</h4>'+files(g.files)+clues(g.clues,g.notes))+'</article>';
}
const css=String.raw`
:root{color-scheme:light dark;--bg:#f5f6f3;--card:#fff;--ink:#24352e;--muted:#637369;--line:#dce4dd;--green:#227256;--red:#b23440;--purple:#76529d;--amber:#8a6818;--orange:#aa5529;--edge:#8b9b91;--soft:#edf2ed;--yellowbg:#fff8de;--orangebg:#fff0e5;--blue:#216ba3;--bluebg:#eaf5ff;--greenbg:#e8f5ee;--graybg:#eef0f2}
@media(prefers-color-scheme:dark){:root{--bg:#141e1a;--card:#1c2922;--ink:#e7f0e9;--muted:#b2c4b8;--line:#3d5346;--green:#83d9ac;--red:#ffa5ae;--purple:#ceaff0;--amber:#ecd180;--orange:#f5b28d;--edge:#829d8e;--soft:#27392e;--yellowbg:#393324;--orangebg:#3b2c24;--blue:#a2d3f7;--bluebg:#263947;--greenbg:#233d30;--graybg:#30373a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,"Microsoft JhengHei",sans-serif}main{max-width:1120px;margin:auto;padding:34px 28px 56px;min-width:0}h1{font-size:clamp(1.7rem,4vw,2.5rem);line-height:1.25;margin:8px 0 12px;letter-spacing:-.03em}h2{font-size:1.35rem;margin:34px 0 10px}h3{font-size:1.03rem;margin:5px 0 8px}h4{margin:12px 0 8px}p{margin:8px 0}a{color:var(--green)}a:focus-visible,summary:focus-visible{outline:3px solid var(--purple);outline-offset:4px}small,.muted,.kicker{color:var(--muted)}.eyebrow{font-size:.77rem;letter-spacing:.16em;font-weight:700;color:var(--green)}.tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:24px 0 16px}.tile{background:var(--card);border:1px solid var(--line);border-top:3px solid var(--green);border-radius:10px;padding:14px;min-width:0}.tile b{font-size:2.25rem;line-height:1.2;display:block}.tile span{font-size:.8rem}.tile:nth-child(2){border-top-color:var(--red)}.tile:nth-child(3){border-top-color:var(--purple)}.tile:nth-child(4){border-top-color:var(--amber)}.tile:nth-child(5){border-top-color:var(--orange)}.verdict{padding:14px 18px;background:var(--greenbg);border-left:3px solid var(--green);border-radius:6px}.mapwrap{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;min-width:0}.map{display:block;width:100%;height:auto}.map text{fill:var(--ink);font-family:inherit}.map .edge{fill:none;stroke:var(--edge);stroke-width:1.6}.map .node{fill:var(--card);stroke:var(--green);stroke-width:1.7}.map .testOnly{fill:var(--yellowbg);stroke:var(--amber)}.map .unused{fill:var(--orangebg);stroke:var(--orange)}.map .zone{font-size:14px;font-weight:700;fill:var(--muted)}.map .badge{fill:var(--purple)}.map .badge-text{fill:var(--card);font-size:11px;text-anchor:middle}.map .label{paint-order:stroke;stroke:var(--card);stroke-width:5px;stroke-linejoin:round;font-size:12px}.legend{margin:12px 0 0;color:var(--muted);font-size:.85rem}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:12px 0;overflow-wrap:anywhere;min-width:0}.card-content{padding:18px 20px}.issue{border-left:4px solid var(--purple)}.issue[data-category=broken]{border-left-color:var(--red)}.group[data-category=testOnly]{border-left:4px solid var(--amber)}.group[data-category=unused]{border-left:4px solid var(--orange)}.kicker{font-size:.76rem;font-weight:700}.risk{font-size:.93rem}.advice{padding:10px 12px;background:var(--soft);border-radius:8px;font-size:.93rem}.technical{border-top:1px solid var(--line)}summary{cursor:pointer;padding:12px 18px;font-size:.9rem;overflow-wrap:anywhere}.detail-body{padding:0 18px 18px;overflow-wrap:anywhere}.detail-body section+section{border-top:1px dashed var(--line);margin-top:16px;padding-top:8px}.detail-body code,pre{font-size:.82rem;overflow-wrap:anywhere;white-space:pre-wrap}blockquote{border-left:3px solid var(--line);margin:12px 0;padding:0 12px;color:var(--muted);font-size:.86rem}blockquote p{white-space:pre-wrap}.filelist{columns:2;padding-left:20px;font-size:.86rem}.filelist li{break-inside:avoid;margin:4px 0;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.grid .card{margin:0}.grid>.more{grid-column:1/-1}.mobile-module{display:none}.desktop-module{display:block}.more{border:1px solid var(--line);border-radius:10px;margin:12px 0}.more>.content{padding:0 14px 14px}.step{margin:12px 0;padding:12px;background:var(--soft);border:1px solid var(--line);border-radius:8px}.step.fail{border:3px solid var(--red)}footer{border-top:1px solid var(--line);margin-top:28px;padding-top:16px;font-size:.8rem;color:var(--muted)}.module:target,.flow-group:target{outline:3px solid var(--purple)}.flow-map{max-width:1000px;margin:auto}.flow-map .node{stroke:var(--line)}.flow-map .decision{stroke:var(--green);stroke-width:2;fill:var(--soft)}.flow-map .answer{fill:var(--greenbg);stroke:var(--green)}.flow-map .ask{fill:var(--bluebg);stroke:var(--blue)}.flow-map .handoff{fill:var(--orangebg);stroke:var(--orange)}.flow-map .decline{fill:var(--graybg);stroke:var(--muted)}.flow-map .bad{stroke:var(--red);stroke-width:3}.flow-map a:hover rect{stroke:var(--purple);stroke-width:3}.mobile-flow{display:none}.flow-group>summary{font-weight:700}.flow-context{font-size:.88rem;color:var(--muted)}
@media(max-width:600px){main{padding:24px 14px 36px}.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.tile:first-child{grid-column:1/-1}.tile b{font-size:1.9rem}.grid{grid-template-columns:1fr}.filelist{columns:1}.card-content{padding:16px}.mapwrap{padding:12px}.desktop-flow,.desktop-module{display:none}.mobile-module{display:block}.mobile-flow{display:block}.branch{border-left:3px solid var(--line);padding-left:12px;margin:10px 0 10px 5px;min-width:0}.branch-label{font-size:.8rem;color:var(--muted);display:block}.mobile-node{display:block;text-decoration:none;color:var(--ink);border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:var(--card);overflow-wrap:anywhere}.mobile-node.decision{border-left:4px solid var(--green);background:var(--soft)}.mobile-node.answer{border-left:4px solid var(--green);background:var(--greenbg)}.mobile-node.ask{border-left:4px solid var(--blue);background:var(--bluebg)}.mobile-node.handoff{border-left:4px solid var(--orange);background:var(--orangebg)}.mobile-node.decline{border-left:4px solid var(--muted);background:var(--graybg)}.mobile-node.bad{border:3px solid var(--red)}.mobile-node small{display:block;font-size:.76rem}.branch .branch .branch{margin-left:0}}
`;
const interaction=String.raw`document.addEventListener('click',e=>{const a=e.target.closest('a[data-open]');if(!a)return;const target=document.getElementById(a.dataset.open);if(!target)return;target.open=true;requestAnimationFrame(()=>{target.scrollIntoView({block:'start'});target.querySelector('summary').focus({preventScroll:true});});});`;
function page(title,body,data='',interactive=false){
 return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; connect-src \'none\'"><title>'+esc(title)+'</title><style>'+css+'</style></head><body><main>'+body+'</main>'+data+(interactive?'<script>'+interaction+'</script>':'')+'</body></html>\n';
}
function limited(items,max,label,render){return items.slice(0,20).map(render).join('')+(items.length>20?'<p><a href="health.json">\u5b8c\u6574\u8cc7\u6599\u53e6\u5217 '+(items.length-20)+' \u7d44</a></p>':'');}

const moduleMapStyle=String.raw`<style>
.module-tiles{display:none}.map-expanded[hidden]{display:none}.map-expanded{padding:14px 16px;background:var(--soft);border:1px solid var(--line);border-radius:9px;font-size:14px;overflow-wrap:anywhere;min-width:0}.map-expanded p:first-child{margin-top:0}.map-expanded p:last-child{margin-bottom:0}.map-expanded b{display:block}.map-related a{display:block;padding:8px 0;min-height:44px}.map-related a:focus-visible,.map-tile:focus-visible{outline:3px solid var(--purple);outline-offset:3px}.module-map a[aria-expanded=true] rect{stroke:var(--purple)!important;stroke-width:3}.map .tests{fill:var(--graybg)}.mapwrap .desktop-module{display:block}.issue:target{outline:3px solid var(--purple);outline-offset:2px;scroll-margin-top:16px}
@media(width < 640px){
.mapwrap .desktop-module,.desktop-map-details{display:none}.mapwrap .module-tiles{display:block}.mapwrap{font-size:14px}.mapwrap .legend,.mapwrap summary,.mapwrap .muted{font-size:14px}.map-zone{margin:0 0 20px}.map-zone:last-child{margin-bottom:0}.map-zone h3{border-left:4px solid var(--zone);padding:2px 0 2px 9px;font-size:15px;line-height:1.5;margin:0 0 10px}.map-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.map-tile{position:relative;min-width:0;min-height:88px;padding:12px 10px;text-align:left;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);font:inherit;cursor:pointer;align-self:stretch}.map-tile-name{display:block;font-size:15px;font-weight:650;line-height:1.5;overflow-wrap:anywhere;padding-right:14px}.map-tile-count{display:block;font-size:14px;color:var(--muted);margin-top:4px}.map-status{display:flex;height:6px;border-radius:3px;overflow:hidden;margin-top:10px;background:var(--line)}.map-status>span{height:100%;flex:none}.map-dot{position:absolute;top:9px;right:7px;min-width:18px;height:18px;padding:0 3px;border-radius:50%;background:var(--purple);color:var(--card);font-size:14px;line-height:18px;text-align:center}.map-tile[aria-expanded=true]{border-color:var(--purple);box-shadow:inset 0 0 0 1px var(--purple);background:var(--soft)}.map-tiles>.map-expanded,.map-empty{grid-column:1/-1}.map-empty{margin:0;color:var(--muted)}
}
</style>`;
const moduleMapInteraction=String.raw`
document.addEventListener('click',event=>{
 const trigger=event.target.closest('[data-map-open]');
 if(trigger){
  event.preventDefault();const panel=document.getElementById(trigger.dataset.mapOpen);if(!panel)return;
  const opening=panel.hidden;document.querySelectorAll('.map-expanded').forEach(p=>p.hidden=true);document.querySelectorAll('[data-map-open]').forEach(b=>b.setAttribute('aria-expanded','false'));
  if(opening){panel.hidden=false;trigger.setAttribute('aria-expanded','true');if(trigger.closest('svg'))panel.scrollIntoView({block:'nearest'});}
 }
 const link=event.target.closest('[data-map-issue]');
 if(link){const target=document.getElementById(link.dataset.mapIssue);if(!target)return;for(let p=target.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;requestAnimationFrame(()=>{target.scrollIntoView({block:'start'});target.setAttribute('tabindex','-1');target.focus({preventScroll:true});});}
});
document.addEventListener('keydown',event=>{const trigger=event.target.closest('svg [data-map-open]');if(trigger&&(event.key===' '||event.key==='Enter')){event.preventDefault();trigger.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
`;
function moduleMap(r,issues,compact=false){
 const columns=compact?1:3,mapWidth=compact?340:890,nodeWidth=compact?304:250,pitch=290,left=compact?18:22;
 const rootFiles=new Set(r.roots.map(x=>x.file));
 const rawNames=r.blocks.map(blockName),names=rawNames.map((name,i)=>rawNames.filter(x=>x===name).length>1?name+'\uff08'+(i+1)+'\uff09':name);
 const zoneKeys=['entry','production','testOnly','unused','tests'],labels=['entry','mapProduction','testOnly','unused','mapTests'];
 const nodes=r.blocks.map((b,i)=>{
  const zone=b.kind==='tests'?'tests':b.files.some(p=>rootFiles.has(p))?'entry':b.production.length?'production':b.testOnly.length?'testOnly':'unused';
  const members=new Set(b.files),cards=issues.filter(c=>members.has(c.file)||c.targets.some(p=>members.has(p)));
  const states=b.kind==='tests'?[]:[['production',b.production.length],['testOnly',b.testOnly.length],['unused',b.unused.length]].filter(([,n])=>n);
  const total=new Set([...b.programFiles,...b.production]).size,other=total-states.reduce((sum,[,n])=>sum+n,0);
  const distribution=states.length>1||other&&states.length?states.map(([key,n])=>({key,text:t('mapCount'+key,{n})})):[];
  if(other)distribution.push({key:'other',text:t(b.kind==='tests'?'mapTestPurpose':'mapUncounted',{n:other})});
  const chars=[...names[i]],titleLines=[];while(chars.length)titleLines.push(chars.splice(0,compact?18:14).join(''));
  return {b,zone,order:i,name:names[i],cards,total,states,other,distribution,titleLines,h:44+titleLines.length*20+distribution.length*18};
 });
 const groups=zoneKeys.map(zone=>nodes.filter(n=>n.zone===zone));
 const byId=new Map(nodes.map(n=>[n.b.id,n]));
 const links=r.links.filter(l=>l.production>0&&l.from!==l.to&&byId.has(l.from)&&byId.has(l.to)).sort((a,b)=>b.production-a.production).slice(0,12);
 // Stable barycentric sweeps: keep fixed zones, order only their existing boxes.
 const ranks=new Map();const rank=()=>groups.forEach(group=>group.forEach((n,i)=>ranks.set(n.b.id,(i+.5)/group.length)));
 rank();
 for(let pass=0;pass<4;pass++)for(const group of pass%2?[...groups].reverse():groups){
  const score=new Map(group.map(n=>{const adjacent=links.filter(l=>l.from===n.b.id||l.to===n.b.id).map(l=>ranks.get(l.from===n.b.id?l.to:l.from));return [n.b.id,adjacent.length?adjacent.reduce((a,b)=>a+b,0)/adjacent.length:ranks.get(n.b.id)];}));
  group.sort((a,b)=>score.get(a.b.id)-score.get(b.b.id)||a.order-b.order);rank();
 }

 const colors={entry:'blue',production:'green',testOnly:'amber',unused:'orange',tests:'muted',other:'muted'};
 const allLinks=r.links.filter(l=>l.from!==l.to&&byId.has(l.from)&&byId.has(l.to));
 const panelId=n=>'map-'+(compact?'mobile-':'desktop-')+n.b.id;
 const relations=(n,direction)=>{
  const relevant=allLinks.filter(l=>l[direction==='uses'?'from':'to']===n.b.id);
  return '<p class="map-relations" data-direction="'+direction+'"><b>'+t(direction==='uses'?'mapUses':'mapUsedBy')+'</b>'+ (relevant.length?relevant.map(l=>'<span data-from="'+esc(l.from)+'" data-to="'+esc(l.to)+'" data-count="'+l.count+'">'+esc(byId.get(l[direction==='uses'?'to':'from']).name)+'\uff08'+t('mapLinkCount',{n:l.count})+'\uff09</span>').join('\u3001'):t('mapNoLinks'))+'</p>';
 };
 const explanation=n=>{
  if(n.b.kind==='tests')return t('mapTestPurpose',{n:n.total});
  const clue=(n.b.clues??[]).map(c=>({...c,plain:plain(c.text.trim().replace(/^(?:#+|\/\/|\/\*|\*)\s*/,''),null)})).find(c=>c.plain);
  return clue?t('mapClue',{text:clue.plain}):lex.kinds[n.b.kind]?.description??t('mapNoClue');
 };
 const expanded=n=>'<p>'+esc(explanation(n))+'</p>'+relations(n,'uses')+relations(n,'usedBy')+'<p class="map-counts">'+(n.b.kind==='tests'?t('mapTestExcluded'):['production','testOnly','unused'].map(key=>t('mapCount'+key,{n:n.b[key].length})).join('\u3001')+(n.other?'\u3001'+t('mapUncounted',{n:n.other}):''))+'</p><p class="map-related"><b>'+t('mapRelated')+'</b>'+(n.cards.length?n.cards.slice(0,3).map(c=>'<a href="#health-issues" data-map-issue="health-issues">'+esc((lex.issues[c.category]??lex.issues.limitation).name)+'</a>').join(''):t('mapNoIssues'))+'</p>';
 if(compact){
  return '<div class="mobile-module module-tiles">'+groups.map((group,i)=>'<section class="map-zone" data-zone="'+zoneKeys[i]+'" style="--zone:var(--'+colors[zoneKeys[i]]+')"><h3>'+t(labels[i])+'\uff1a'+t('mapZoneCount',{n:group.length,files:group.reduce((sum,n)=>sum+n.total,0)})+'</h3><div class="map-tiles">'+group.map((n,index)=>{
   const order=Math.floor(index/2)*3,counts=[...n.states,...(n.other?[['other',n.other]]:[])],denominator=counts.reduce((sum,[,v])=>sum+v,0);
   const bar=n.b.kind==='tests'?'':'<span class="map-status" aria-label="'+esc(n.states.map(([key,v])=>t('mapCount'+key,{n:v})).join('\u3001')+(n.other?'\u3001'+t('mapUncounted',{n:n.other}):''))+'">'+counts.map(([key,v])=>'<span data-status="'+key+'" data-count="'+v+'" style="width:'+(v/denominator*100)+'%;background:var(--'+colors[key]+')"></span>').join('')+'</span>';
   return '<button type="button" class="map-tile" data-block-id="'+esc(n.b.id)+'" data-zone="'+n.zone+'" data-issue-count="'+n.cards.length+'" data-map-open="'+esc(panelId(n))+'" aria-controls="'+esc(panelId(n))+'" aria-expanded="false" style="order:'+(order+index%2)+'"><span class="map-tile-name">'+esc(n.name)+'</span><span class="map-tile-count">'+t(n.b.kind==='tests'?'mapTestPurpose':'fileCount',{n:n.total})+'</span>'+bar+(n.cards.length?'<span class="map-dot" aria-label="'+t('mapIssueCount',{n:n.cards.length})+'">'+n.cards.length+'</span>':'')+'</button><section class="map-expanded" role="region" aria-label="'+esc(n.name)+'" id="'+esc(panelId(n))+'" hidden style="order:'+(order+2)+'">'+expanded(n)+'</section>';
  }).join('')+(!group.length?'<p class="map-empty">'+t('noItems')+'</p>':'')+'</div></section>').join('')+'</div>';
 }
 let y=30;const zones=[];
 groups.forEach((list,index)=>{
  const top=y;zones.push({label:labels[index],y:top,empty:!list.length});y+=28;
  for(let i=0;i<list.length;i+=columns){const row=list.slice(i,i+columns);row.forEach((n,j)=>{n.x=left+j*pitch;n.y=y;});y+=Math.max(...row.map(n=>n.h))+36;}
  if(!list.length)y+=50;
  y+=14;
 });
 const marker=compact?'ma-mobile':'ma-desktop';
 let svg='<defs><marker id="'+marker+'" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10Z" fill="var(--edge)"/></marker></defs>';
 for(const z of zones)svg+='<line x1="10" x2="'+(mapWidth-12)+'" y1="'+(z.y-10)+'" y2="'+(z.y-10)+'" stroke="var(--line)"/><text class="zone" x="'+left+'" y="'+(z.y+8)+'">'+t(z.label)+'</text>'+(z.empty?'<text x="'+left+'" y="'+(z.y+58)+'" font-size="13">'+t('noItems')+'</text>':'');
 for(const [i,l] of links.entries()){
  const a=byId.get(l.from),b=byId.get(l.to),ax=a.x+nodeWidth/2,bx=b.x+nodeWidth/2;
  let d;
  if(a.y===b.y&&Math.abs(a.x-b.x)===pitch){const right=b.x>a.x,x=a.x+(right?nodeWidth:0),xx=b.x+(right?0:nodeWidth),ay=a.y+a.h/2,by=b.y+b.h/2,mid=(x+xx)/2;d='M'+x+','+ay+' C'+mid+','+ay+' '+mid+','+by+' '+xx+','+by;}
  else if(a.y===b.y){const top=a.y-14;d='M'+ax+','+a.y+' L'+ax+','+top+' L'+bx+','+top+' L'+bx+','+b.y;}
  else {const down=b.y>a.y,ay=down?a.y+a.h:a.y,by=down?b.y:b.y+b.h;
   const bottom=n=>Math.max(...nodes.filter(p=>p.y===n.y).map(p=>p.y+p.h));
   const sy=down?bottom(a)+12:a.y-12,ty=down?b.y-12:bottom(b)+12;
   const between=nodes.some(n=>n!==a&&n!==b&&n.y>Math.min(a.y,b.y)&&n.y<Math.max(a.y,b.y));
   if(!between){const mid=(sy+ty)/2;d='M'+ax+','+ay+' L'+ax+','+sy+' C'+ax+','+mid+' '+bx+','+mid+' '+bx+','+ty+' L'+bx+','+by;}
   else {const rail=6+(i%4)*2;d='M'+ax+','+ay+' L'+ax+','+sy+' L'+rail+','+sy+' L'+rail+','+ty+' L'+bx+','+ty+' L'+bx+','+by;}
  }
  svg+='<path class="edge" data-from="'+esc(l.from)+'" data-to="'+esc(l.to)+'" d="'+d+'" marker-end="url(#'+marker+')"/>';
 }

 for(const n of nodes){
  const badge=n.cards.length;
  svg+='<a href="#'+esc(panelId(n))+'" role="button" aria-expanded="false" aria-controls="'+esc(panelId(n))+'" data-map-open="'+esc(panelId(n))+'" data-block-id="'+esc(n.b.id)+'" data-zone="'+n.zone+'" data-issue-count="'+badge+'"><rect class="node '+n.zone+'" x="'+n.x+'" y="'+n.y+'" width="'+nodeWidth+'" height="'+n.h+'" rx="9" style="stroke:var(--'+colors[n.zone]+')"/>';
  n.titleLines.forEach((line,i)=>svg+='<text class="module-name" x="'+(n.x+14)+'" y="'+(n.y+24+i*20)+'" font-size="15">'+esc(line)+'</text>');
  const base=n.y+24+(n.titleLines.length-1)*20;
  svg+='<text class="module-total" x="'+(n.x+14)+'" y="'+(base+22)+'" font-size="13">'+t('fileCount',{n:n.total})+(n.distribution.length?'\uff1a':'')+'</text>';
  n.distribution.forEach((part,i)=>svg+='<text class="distribution" data-status="'+part.key+'" x="'+(n.x+14)+'" y="'+(base+40+i*18)+'" font-size="13" style="fill:var(--'+colors[part.key]+')">'+esc(part.text)+'</text>');
  if(badge)svg+='<circle class="badge" cx="'+(n.x+nodeWidth-4)+'" cy="'+(n.y+4)+'" r="10"/><text class="badge-text" x="'+(n.x+nodeWidth-4)+'" y="'+(n.y+8)+'">'+badge+'</text>';
  svg+='</a>';
 }
 return moduleMapStyle+'<svg class="map module-map '+(compact?'mobile-module':'desktop-module')+'" viewBox="0 0 '+mapWidth+' '+y+'" role="img" aria-label="'+t('mapTitle')+'">'+svg+'</svg><div class="desktop-map-details">'+nodes.map(n=>'<section class="map-expanded" role="region" aria-label="'+esc(n.name)+'" id="'+esc(panelId(n))+'" hidden>'+expanded(n)+'</section>').join('')+'</div><script>'+moduleMapInteraction+'</script>';
}
function renderLegacyHealth(r){
 const issues=humanIssues(r),s=humanStats(r),title=plain(r.title,t('healthTitle'));
 const keys=['productionFiles','broken','odd','testOnly','unused'];
 const data='<script id="health-stats" type="application/json">'+JSON.stringify(r.stats).replaceAll('<','\\u003c')+'</script><script id="display-stats" type="application/json">'+JSON.stringify(s)+'</script>';
 let body='<div class="eyebrow">'+t('eyebrow')+'</div><h1>'+esc(title)+'</h1><p class="muted">'+t('subtitle')+'</p><div class="tiles">'+keys.map(k=>'<div class="tile" data-stat="'+k+'"><b>'+s[k]+'</b><span>'+t(k)+'</span></div>').join('')+'</div><div class="verdict">'+t('verdict',{files:s.productionFiles,broken:s.broken,odd:s.odd})+'</div>';
 body+='<h2>'+t('mapTitle')+'</h2><p class="muted">'+t('mapIntro')+'</p><div class="mapwrap">'+moduleMap(r,issues)+moduleMap(r,issues,true)+'<p class="legend">'+t('mapLegend')+'</p>'+detail('<h4>'+t('links')+'</h4><ul>'+r.links.map(l=>'<li>'+esc(r.blocks.find(b=>b.id===l.from)?.name)+' → '+esc(r.blocks.find(b=>b.id===l.to)?.name)+' : '+l.production+' / '+l.count+'</li>').join('')+'</ul>')+'<p class="muted">'+t('mapLimit')+'</p></div>';
  body+='<h2 id="health-issues">'+t('issuesTitle')+'</h2>'+renderGroups(displayGroups(r.issues,{limit:r.display?.maxGroupsPerCategory??20,productionFiles:r.blocks.flatMap(b=>b.production)}));
  body+='<h2>'+t('groupsTitle')+'</h2>'+renderGroups(displayGroups(r.groups.flatMap(g=>g.files.map(file=>({...g,file,files:undefined,locations:[{file,line:null}]}))),{limit:r.display?.maxGroupsPerCategory??20}));
  body+='<p>依宣告排除：'+'<span data-stat="declaredExcluded"><b>'+(r.stats.declaredExcluded??0)+'</b></span> 檔；不列入沒人用。</p>';
 body+='<h2>'+t('modulesTitle')+'</h2><div class="grid">'+limited(r.blocks,8,'moreModules',b=>'<section class="module card" id="'+b.id+'"><div class="card-content"><h3>'+blockName(b,r.blocks.indexOf(b))+'</h3><p>'+lex.kinds[b.kind].name+' · '+t('moduleMeta',{n:b.programFiles.length})+'</p><p class="muted">'+t('countMeta',{p:b.production.length,t:b.testOnly.length,u:b.unused.length})+'</p></div>'+detail('<p>'+t('sourceName')+'：'+esc(b.name)+' · '+t('sourceType')+'：'+esc(b.kind)+'</p>'+files(b.files)+clues(b.clues,b.notes))+'</section>')+'</div>';
  body+='<h2>'+t('limitsTitle')+'</h2><p>'+t('limitsIntro',{n:r.limitations.length})+'</p>'+renderGroups(displayGroups(r.limitations,{limit:r.display?.maxGroupsPerCategory??20,productionFiles:r.blocks.flatMap(b=>b.production)}));
 body+='<footer>'+t('footer')+detail('<h4>'+t('scopeTitle')+'</h4><p>'+esc(r.title)+'<br>'+esc(r.repo)+'<br>'+esc(r.commit)+'<br>'+esc(r.toolVersion)+'<br>'+esc(r.configurationSha256)+'</p><h4>'+t('rawStats')+'</h4><pre>'+esc(JSON.stringify(r.stats,null,2))+'</pre>')+'</footer>';
 return page(title,body,data);
}
export function renderHumanHealth(r){
 const legacy=renderLegacyHealth(r),sheet=r.maintenance??buildMaintenance(r);
 const style='<style>.repair-counts{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.repair-counts span{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px}.repair{border-left:4px solid var(--amber)}.repair[data-mark=broken]{border-color:var(--red)}.repair[data-mark=fine]{border-left-color:var(--green)}.repair[data-mark=handling]{border-left-color:var(--orange)}.repair-label{font-weight:750;color:var(--amber)}.repair[data-mark=broken] .repair-label{color:var(--red)}.repair[data-mark=fine] .repair-label{color:var(--green)}.repair-label span{float:right;color:var(--muted);font-weight:400}.repair h2{font-size:1.15rem;margin:12px 0}.repair pre,.repair code{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.83rem}.repair pre{background:var(--soft);padding:12px;border-radius:8px}.repair h3{margin-top:20px}.repair .detail-body{max-height:70vh;overflow:auto}.legacy-report{margin-top:32px}#maintenance-sheet{max-width:800px;margin:auto;overflow-wrap:anywhere;min-width:0}#maintenance-sheet code,#maintenance-sheet pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%}</style>';
 return legacy.replace('</head>',style+'</head>').replace('<main>',()=>'<main>'+renderMaintenanceHTML(sheet)+'<details class="legacy-report technical"><summary>\u6280\u8853\u4f9d\u64da\uff1a\u539f\u59cb\u5065\u6aa2\u8cc7\u6599</summary><div class="detail-body">').replace('</main>','</div></details></main>');
}
export function mainFlow(f){
 if(f.main){return {nodes:f.main.nodes,arrows:f.main.arrows,legacy:false};}
 const grouped=f.steps.some(s=>s.group);
 if(grouped)throw Error('Grouped steps require main.nodes and main.arrows');
 const nodes=f.steps.slice(0,12).map((s,i)=>({id:s.id,label:plain(s.label,t('genericStep',{n:i+1})),type:s.type??'step',tone:s.tone})),ids=new Set(nodes.map(s=>s.id));
 return {nodes,arrows:f.arrows.filter(a=>ids.has(a.from)&&ids.has(a.to)).map(a=>({...a,when:plain(a.when,t('genericCondition'))})),legacy:f.steps.length>12};
}
export function validateMainFlow(flow){
 if(!flow.main)return;
 const {nodes,arrows}=flow.main;
 if(!Array.isArray(nodes)||!Array.isArray(arrows)||!nodes.length||nodes.length>12)throw Error('Main view requires 1..12 nodes');
 const ids=new Set();
 for(const n of nodes){if(!n.id||ids.has(n.id)||!['step','decision','end'].includes(n.type)||typeof n.label!=='string'||[...n.label].length>20||plain(n.label,null)===null)throw Error('Invalid plain main node');ids.add(n.id);if(n.type==='end'&&!['answer','ask','handoff','decline'].includes(n.tone))throw Error('Invalid end tone');}
 for(const a of arrows)if(!ids.has(a.from)||!ids.has(a.to)||!a.when||plain(a.when,null)===null||a.from===a.to)throw Error('Invalid plain main arrow');
 for(const n of nodes){const out=arrows.filter(a=>a.from===n.id);if(n.type==='decision'&&(out.length!==2||new Set(out.map(a=>a.when)).size!==2))throw Error('Decision requires two distinct exits');if(n.type==='end'&&out.length)throw Error('End cannot have exits');if(n.note&&plain(n.note,null)===null)throw Error('Main note must be plain');}
 for(const s of flow.steps)if(!ids.has(s.group))throw Error('Every detailed step requires a main group');
 for(const n of nodes)if(!flow.steps.some(s=>s.group===n.id))throw Error('Main node requires evidence');
 const reached=new Set(),active=new Set();
 const visit=id=>{if(active.has(id))throw Error('Main view must be acyclic; keep loops in details');if(reached.has(id))return;active.add(id);for(const a of arrows.filter(a=>a.from===id))visit(a.to);active.delete(id);reached.add(id);};
 const roots=nodes.filter(n=>!arrows.some(a=>a.to===n.id));if(roots.length!==1)throw Error('Main view requires one start');visit(roots[0].id);if(reached.size!==nodes.length)throw Error('Unreachable main node');
}
export function layoutFlow(nodes,arrows){
 const order=new Map(nodes.map((n,i)=>[n.id,i])),depth=new Map(nodes.map(n=>[n.id,0])),indeg=new Map(nodes.map(n=>[n.id,arrows.filter(a=>a.to===n.id).length])),queue=nodes.filter(n=>!indeg.get(n.id)).map(n=>n.id);
 // Kahn layering, then stable barycentric ordering within each layer.
 for(let i=0;i<queue.length;i++){const id=queue[i];for(const a of arrows.filter(a=>a.from===id)){depth.set(a.to,Math.max(depth.get(a.to),depth.get(id)+1));indeg.set(a.to,indeg.get(a.to)-1);if(!indeg.get(a.to))queue.push(a.to);}}
 const cyclic=queue.length!==nodes.length;
 if(cyclic)nodes.forEach((n,i)=>depth.set(n.id,i)); // Backward-compatible detailed loops are retained separately.
 const layers=[];for(const n of nodes)(layers[depth.get(n.id)]??=[]).push(n);
 const positions=new Map(),width=1000,nodeW=218,nodeH=56,gap=92;
 layers.forEach((layer,d)=>{const bary=n=>{const xs=arrows.filter(a=>a.to===n.id&&positions.has(a.from)).map(a=>{const out=arrows.filter(e=>e.from===a.from);return positions.get(a.from).x+(out.indexOf(a)-(out.length-1)/2)*100;});return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:500;};layer.sort((a,b)=>bary(a)-bary(b)||order.get(a.id)-order.get(b.id));layer.forEach((n,i)=>positions.set(n.id,{x:(width/(layer.length+1))*(i+1)-nodeW/2,y:18+d*gap,w:nodeW,h:nodeH,depth:d}));});
 return {width,height:layers.length*gap,positions,cyclic};
}
export function renderHumanFlow(f){
 const main=mainFlow(f),{nodes,arrows}=main,layout=layoutFlow(nodes,arrows),title=plain(f.title,t('flowTitle'));
 const groupSteps=id=>f.main?f.steps.filter(s=>s.group===id):f.steps.filter(s=>s.id===id);
 const failed=id=>groupSteps(id).some(s=>s.check.status==='FAIL');
 const nodeLabel=n=>plain(n.label,t('genericStep',{n:nodes.indexOf(n)+1}));
 let svg='<defs><marker id="fa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10Z" fill="var(--edge)"/></marker></defs>';
 const long=arrows.filter(a=>Math.abs(layout.positions.get(a.to).depth-layout.positions.get(a.from).depth)>1);
 for(const [i,a] of arrows.entries()){
  const p=layout.positions.get(a.from),q=layout.positions.get(a.to),siblings=arrows.filter(e=>e.from===a.from),branch=siblings.indexOf(a),isLong=Math.abs(q.depth-p.depth)>1;
  const x=p.x+p.w/2+(siblings.length>1?(branch-(siblings.length-1)/2)*60:0),y=p.y+p.h,xx=q.x+q.w/2,yy=q.y;
  let d,labelX=x,labelY=y+18;
  if(isLong){const idx=long.indexOf(a),left=branch===0,rail=left?28+idx*13:972-idx*13;d='M'+x+','+y+' C'+x+','+(y+24)+' '+rail+','+(y+24)+' '+rail+','+(y+40)+' L'+rail+','+(yy-30)+' Q'+rail+','+(yy-16)+' '+(rail+(xx>rail?16:-16))+','+(yy-16)+' L'+xx+','+(yy-16)+' Q'+xx+','+(yy-16)+' '+xx+','+yy;labelX=(x+rail)/2;labelY=y+24;}
  else d='M'+x+','+y+' C'+x+','+(y+26)+' '+xx+','+(yy-26)+' '+xx+','+yy;
  svg+='<path class="edge" d="'+d+'" marker-end="url(#fa)"/><text class="label" x="'+labelX+'" y="'+labelY+'" text-anchor="middle">'+esc(plain(a.when,t('genericCondition')))+'</text>';
 }
 for(const n of nodes){const p=layout.positions.get(n.id),cl=(n.type??'step')+' '+(n.tone??'')+(failed(n.id)?' bad':'');svg+='<a href="#flow-'+esc(n.id)+'" data-open="flow-'+esc(n.id)+'" aria-label="'+esc(nodeLabel(n))+'"><rect class="node '+cl+'" x="'+p.x+'" y="'+p.y+'" width="'+p.w+'" height="'+p.h+'" rx="'+(n.type==='end'?28:12)+'"/><text x="'+(p.x+p.w/2)+'" y="'+(p.y+27)+'" font-size="14" text-anchor="middle">'+esc(nodeLabel(n))+'</text><text x="'+(p.x+p.w/2)+'" y="'+(p.y+47)+'" font-size="11" text-anchor="middle">'+esc(failed(n.id)?t('checkFailed'):n.note??t(n.type==='end'?'flowEnd':n.type==='decision'?'flowDecision':'flowStep'))+'</text></a>';}
 const expanded=new Set();
 function mobile(id,depth=0){const n=nodes.find(n=>n.id===id),repeat=expanded.has(id);expanded.add(id);
  return '<a class="mobile-node '+(n.type??'step')+' '+(n.tone??'')+(failed(id)?' bad':'')+'" href="#flow-'+esc(id)+'" data-open="flow-'+esc(id)+'">'+esc(nodeLabel(n))+(n.note?'<small>'+esc(n.note)+'</small>':'')+'</a>'+(!repeat&&depth<12?arrows.filter(a=>a.from===id).map(a=>'<div class="branch"><span class="branch-label">'+esc(plain(a.when,t('genericCondition')))+'</span>'+mobile(a.to,depth+1)+'</div>').join(''):'');
 }
 const roots=nodes.filter(n=>!arrows.some(a=>a.to===n.id));
 const mobileHTML=(roots.length?roots:[nodes[0]]).filter(Boolean).map(n=>mobile(n.id)).join('');
 const stepHTML=s=>'<section class="step '+(s.check.status==='FAIL'?'fail':'pass')+'" data-anchor-id="'+esc(s.id)+'"><h4>'+esc(s.label)+'</h4><p>'+esc(s.source)+' · '+s.check.status+' · <code>'+loc(s.anchor)+'</code></p><p>expect: <code>'+esc(s.anchor?.expect)+'</code></p><pre>'+esc(s.check.actual??s.check.reasons.join(', '))+'</pre><ul>'+f.arrows.filter(a=>a.from===s.id).map(a=>'<li>'+esc(a.when)+' → '+esc(f.steps.find(x=>x.id===a.to)?.label)+'</li>').join('')+'</ul></section>';
 let body='<div class="eyebrow">'+t('flowEyebrow')+'</div><h1>'+esc(title)+'</h1><p class="muted">'+t('flowIntro')+'</p><p>'+t('flowStatus',{pass:f.pass,fail:f.fail})+'</p><div class="mapwrap"><div class="desktop-flow"><svg class="map flow-map" viewBox="0 0 '+layout.width+' '+layout.height+'" role="img" aria-label="'+t('flowMain')+'">'+svg+'</svg></div><div class="mobile-flow">'+mobileHTML+'</div><p class="legend">'+t('flowLegend')+'</p></div><p class="flow-context">'+t('flowBoundary')+'</p><p class="flow-context">'+t('flowLimit')+'</p>'+(main.legacy?'<p>'+t('flowLegacy')+'</p>':'')+'<h2>'+t('flowDetails')+'</h2>';
 body+=nodes.map(n=>'<details class="technical card flow-group" id="flow-'+esc(n.id)+'"><summary>'+t('detail')+' · '+esc(nodeLabel(n))+'</summary><div class="detail-body">'+groupSteps(n.id).map(stepHTML).join('')+'</div></details>').join('');
 const omitted=f.steps.filter(s=>!nodes.some(n=>n.id===(f.main?s.group:s.id)));
 if(omitted.length)body+=detail(omitted.map(stepHTML).join(''));
 body+=detail('<p>'+esc(f.scope)+'</p><ul>'+(f.limitations??[]).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><p>'+esc(f.repo)+'<br>'+esc(f.commit)+'</p>')+'<footer>'+t('footer')+'</footer>';
 return page(title,body,'',true);
}
// Text outside all details, plus their visible summaries. Used by the existing self-test.
export function primaryText(html){
 const clean=html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
 let depth=0,summary=0,out='';
 for(const token of clean.match(/<[^>]*>|[^<]+/g)??[]){
  if(/^<details\b/i.test(token)){depth++;continue;}if(/^<\/details/i.test(token)){depth--;continue;}
  if(/^<summary\b/i.test(token)){summary++;continue;}if(/^<\/summary/i.test(token)){summary--;continue;}
  if(!token.startsWith('<')&&(!depth||depth===1&&summary))out+=' '+token;
 }
 return out.replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&(?:amp|lt|gt|quot|#39);/g,' ').replace(/\s+/g,' ').trim();
}
export function jargonHits(html){
 // Executable commands and real file locations are required maintenance content,
 // not field labels. Exempt only the explicitly marked, valid shaped values.
 const visible=html.replace(/<pre data-repair-diagnostic>[\s\S]*?<\/pre>/g,'').replace(/<code data-repair-locator>(?:run-[a-f0-9]{64}|(?:repair|failure)-[a-f0-9]{16})<\/code>/g,'').replace(/<pre data-repair-command>node [^<]*<\/pre>/g,'').replace(/<code data-repair-locator>([^<]*)<\/code>/g,(all,x)=>/^[^<>]+\.[A-Za-z0-9]+(?::[1-9]\d*)?$/.test(x)&&!x.includes(':UNKNOWN')?'':all).replace(/<pre data-repair-command>([^<]*)<\/pre>/g,(all,x)=>/^node --test .+\.(?:[cm]?[jt]s|tsx)$/.test(x)?'':all);
 const text=primaryText(visible);
 return unique([...lex.forbidden.filter(word=>text.toLowerCase().includes(word.toLowerCase())),...(text.match(/[A-Za-z_][A-Za-z0-9_.:/-]*/g)??[])]);
}
