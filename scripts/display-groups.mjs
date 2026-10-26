// Presentation only: preserve original rows and verdict counters in the JSON model.
const unique=xs=>[...new Set(xs)];
export const evidenceNeeds={
 caller:'\u9700\u6838\u5c0d\u547c\u53eb\u7aef\u5408\u7d04',
 execution:'\u9700\u57f7\u884c\u8b49\u64da',
 propagation:'\u9700\u6838\u5c0d\u4f8b\u5916\u50b3\u64ad',
 condition:'\u9700\u62c6\u5206\u89f8\u767c\u689d\u4ef6',
 declaration:'\u9700\u88dc\u5ba3\u544a\u8207\u985e\u5225\u5c0d\u7167',
 anchor:'\u9700\u88dc\u539f\u78bc\u9328\u9ede',
 path:'\u9700\u88dc\u8def\u5f91\u4f86\u6e90\u8207\u65b9\u5411\u5ba3\u544a',
 review:'\u9700\u8b80\u78bc\u8207\u8a9e\u610f\u8b49\u64da'
};
const state=r=>r.mark??r.classification??r.status??r.category??'UNKNOWN';
const anchors=r=>r.locations??(r.sites?r.sites.map(s=>s.anchor??s):r.files?r.files.map(file=>({file,line:null})):[r.anchor??r.implemented?.anchor??r.declared?.anchor??r.cause??r]);
const source=r=>r.cause?.file??r.file??r.anchor?.file??r.implemented?.anchor?.file??r.declared?.anchor?.file??'.';
export function reasonKey(r){
 if(r.category==='UNKNOWN'&&(r.declared||r.implemented)){
  const needs=['declared','implemented'].flatMap(k=>{const side=r[k];if(side?.status==='PASS')return [];return [k.toUpperCase()+':'+(side?.reason??side?.anchor?.reason??(side?.anchor?.status==='FAIL'?'ANCHOR_CHECK_FAILED':side?.scope?'SEARCH_SCOPE_REQUIRED':'MISSING_SIDE'))];});
  if(needs.length)return needs.join('|');
 }
 if(r.stopComparison)return unique(r.stopComparison.sites.map(s=>s.reason)).sort().join('|');
 if(r.gaps?.length)return unique(r.gaps.map(s=>String(s).split(':')[0])).sort().join('|');
 return r.reason||r.category||(r.demotions?.length?r.demotions.slice().sort().join('|'):'EVIDENCE_MISSING');
}
export function evidenceNeed(r){
 const reason=reasonKey(r);
 if(/INTERNAL_GUARD|PARAMETER|CALLER|CALL_LEVEL|HELPER|RETURN|BINDING/.test(reason))return evidenceNeeds.caller;
 if(/CATCH_BOUNDARY/.test(reason))return evidenceNeeds.propagation;
 if(/MIXED_CONDITION/.test(reason))return evidenceNeeds.condition;
 if(/ROUTE_EVIDENCE|RUN_MISSING|FAILURE_EVIDENCE|COVERAGE/.test(reason))return evidenceNeeds.execution;
 if(/NO_DECLARATION|SEMANTIC_EVIDENCE|MISSING_SIDE|VALUE_MISMATCH|SEARCH_SCOPE/.test(reason))return evidenceNeeds.declaration;
 if(/ANCHOR|EXPECT|FILE_UNREADABLE/.test(reason))return evidenceNeeds.anchor;
 if(/PATH_|MARKER|DIRECTION|ASSIGNMENT/.test(reason))return evidenceNeeds.path;
 return evidenceNeeds.review;
}
export function displayGroups(rows,{limit=20,productionFiles=[]}={}){
 if(!Number.isInteger(limit)||limit<1)throw Error('display.maxGroupsPerCategory must be a positive integer');
 const prod=new Set(productionFiles),groups=new Map();
 rows.forEach((r,index)=>{
  const category=state(r),reason=reasonKey(r),file=source(r),key=JSON.stringify([category,reason,file,r.repo??'',r.from??'',r.to??'']);
  if(!groups.has(key))groups.set(key,{category,reason,file,need:['unsure','uncertain','UNKNOWN','limitation'].includes(category)?evidenceNeed(r):null,count:0,occurrences:0,production:false,anchors:[],indices:[]});
  const g=groups.get(key);g.count++;g.occurrences+=Number.isFinite(r.count)?r.count:r.files?.length??1;
  g.production ||= prod.has(file)||!!r.affectedRoutes?.length||!!r.reach?.routes?.length||r.scope==='production';
  g.indices.push(index);
  for(const a of anchors(r))if(a?.file&&!g.anchors.some(x=>x.file===a.file&&x.line===a.line)&&g.anchors.length<3)g.anchors.push({file:a.file,line:a.line??null,...(a.target?{target:a.target}:{})});
 });
 const all=[...groups.values()].sort((a,b)=>Number(b.production)-Number(a.production)||b.occurrences-a.occurrences||b.count-a.count||a.file.localeCompare(b.file)||a.reason.localeCompare(b.reason));
 const categories=unique(rows.map(state)).map(category=>{
  const gs=all.filter(g=>g.category===category),selected=gs.slice(0,limit),needs={};
  for(const g of gs)if(g.need){needs[g.need]??={items:0,occurrences:0,groups:0};needs[g.need].items+=g.count;needs[g.need].occurrences+=g.occurrences;needs[g.need].groups++;}
  return {category,items:gs.reduce((n,g)=>n+g.count,0),occurrences:gs.reduce((n,g)=>n+g.occurrences,0),groups:gs.length,shown:selected.length,omitted:gs.length-selected.length,needs,selected};
 });
 return {limit,items:rows.length,groups:all.length,shown:categories.reduce((n,c)=>n+c.shown,0),categories};
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderGroups(summary,{labels={},json='health.json'}={}){
 return summary.categories.map(c=>'<section class="display-category" data-category="'+esc(c.category)+'"><h3>'+esc(labels[c.category]??c.category)+'</h3><p>'+c.items+' \u4ef6 / '+c.occurrences+' \u8655\uff1b'+c.groups+' \u7d44\uff0c\u986f\u793a '+c.shown+' \u7d44\uff0c\u7701\u7565 '+c.omitted+' \u7d44\u3002</p>'+Object.entries(c.needs).map(([need,n])=>'<p>'+esc(need)+'\uff1a'+n.items+' \u4ef6 / '+n.groups+' \u7d44</p>').join('')+c.selected.map(g=>'<article class="display-group"><p><b>'+esc(g.need??g.reason)+'</b>\uff1b'+g.count+' \u4ef6 / '+g.occurrences+' \u8655'+(g.production?'\uff1b\u5728\u6b63\u5f0f\u8def\u7dda\u4e0a':'')+'</p><p>'+esc(g.reason)+'</p><p>'+g.anchors.map(a=>'<code>'+esc(a.file)+(a.line?':'+a.line:'')+'</code>').join(' / ')+'</p></article>').join('')+'</section>').join('')+'<p><a href="'+esc(json)+'">\u5b8c\u6574\u6e05\u55ae\u8207\u4f9d\u64da</a></p>';
}
export function preview(value,limit=3){
 if(Array.isArray(value))return value.slice(0,limit).map(v=>preview(v,limit)).concat(value.length>limit?[{omitted:value.length-limit,fullList:'JSON'}]:[]);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,preview(v,limit)]));
 return value;
}

export function renderGroupsMarkdown(summary,{labels={},json='health.json'}={}){
 const tick=String.fromCharCode(96),nl=String.fromCharCode(10);
 const md=s=>String(s??'').replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;').split(nl).join(' ').split(String.fromCharCode(13)).join(' ').split(tick).join("'");
 const lines=[];
 for(const c of summary.categories){
  lines.push('### '+md(labels[c.category]??c.category),'',c.items+' 件 / '+c.occurrences+' 處；'+c.groups+' 組，顯示 '+c.shown+' 組，省略 '+c.omitted+' 組。','');
  for(const [need,n] of Object.entries(c.needs))lines.push('- '+md(need)+'：'+n.items+' 件 / '+n.groups+' 組');
  lines.push('');
  for(const g of c.selected){lines.push('- **'+md(g.need??g.reason)+'**：'+g.count+' 件 / '+g.occurrences+' 處'+(g.production?'；在正式路線上':''),'  '+md(g.reason),'  '+g.anchors.map(a=>tick+md(a.file)+(a.line?':'+a.line:'')+tick).join(' / '),'');}
 }
 lines.push('[完整清單與依據]('+encodeURI(json).replaceAll('(','%28').replaceAll(')','%29')+')','');
 return lines.join(nl);
}
