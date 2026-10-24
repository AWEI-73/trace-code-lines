// Pure layout and offline viewer. Coordinates are derived from the accepted routes.
export function layoutRoutes(model,width=720,selected=null){
 const route=model.routes.find(r=>r.id===selected),mobile=width<600,large=mobile&&model.stations.length>18;
 const mode=route?'single':large?'blocks':'network';
 let stations=model.stations,hops=model.routes.flatMap(r=>r.hops),sequences=model.routes.map(r=>r.hops.length?[r.hops[0].from,...r.hops.map(h=>h.to)]:[]);
 if(mode==='single'){sequences=[route.hops.length?[route.hops[0].from,...route.hops.map(h=>h.to)]:[]];stations=[...new Set(sequences[0])].map(id=>model.stations.find(s=>s.id===id));hops=route.hops;}
 if(mode==='blocks'){
  const names=[...new Set(stations.map(s=>s.block))],block=new Map(stations.map(s=>[s.id,'block-'+names.indexOf(s.block)])),aggregated=new Map();
  for(const h of hops){const from=block.get(h.from),to=block.get(h.to);if(from===to)continue;const key=from+'|'+to,old=aggregated.get(key);if(old)old.count++;else aggregated.set(key,{from,to,manual:false,count:1});}
  hops=[...aggregated.values()];
  sequences=sequences.map(seq=>seq.map(id=>block.get(id)).filter((id,i,ids)=>i===0||id!==ids[i-1]));
  stations=names.map((name,i)=>({id:'block-'+i,name,block:'',inferred:false,files:model.stations.filter(s=>s.block===name).map(s=>s.file),issues:model.stations.filter(s=>s.block===name).flatMap(s=>s.issues),isolated:!hops.some(h=>h.from==='block-'+i||h.to==='block-'+i)}));
 }
 // Logical depth is the earliest occurrence in any accepted route. Visual
 // layers additionally split wide rows; they never change the route data.
 const depth=new Map();for(const seq of sequences)seq.forEach((id,i)=>depth.set(id,Math.min(depth.get(id)??Infinity,i)));
 const layers=[];for(const s of stations){const d=depth.get(s.id)??0;(layers[d]??=[]).push(s);}
 // Stable barycentre sweeps keep connected stations near one another.
 const position=()=>new Map(layers.flatMap(row=>(row??[]).map((s,i)=>[s.id,(i+.5)/row.length])));
 if(mode!=='single')for(let sweep=0;sweep<4;sweep++){
  const pos=position(),order=sweep%2?[...layers.keys()].reverse():[...layers.keys()];
  for(const d of order)if(layers[d]){const score=s=>{const neighbors=hops.flatMap(h=>h.to===s.id&&(depth.get(h.from)??0)<d?[h.from]:h.from===s.id&&(depth.get(h.to)??0)>d?[h.to]:[]);return neighbors.length?neighbors.reduce((n,id)=>n+(pos.get(id)??.5),0)/neighbors.length:pos.get(s.id);};layers[d]=layers[d].map((s,i)=>({s,i,score:score(s)})).sort((a,b)=>a.score-b.score||a.i-b.i).map(x=>x.s);}
 }
 const columns=mode==='single'?1:3,gap=12;
 const maxWidth=mode==='single'?width*.8:Math.min(width*.8,(width-20-gap*(columns-1))/columns);
 const rows=[];
 if(mode==='single')stations.forEach(s=>rows.push([s]));
 else for(const row of layers){if(!row)continue;let part=[];for(const s of row){
  // A same-row connection must be adjacent to stay horizontal and avoid boxes.
  if(part.length===columns||part.slice(0,-1).some(n=>hops.some(h=>h.from===n.id&&h.to===s.id||h.to===n.id&&h.from===s.id))){rows.push(part);part=[];}
  part.push(s);
 }if(part.length)rows.push(part);}
 // Conservative glyph widths keep text readable without requiring browser fonts.
 const measure=(value,size)=>[...value].reduce((sum,c)=>sum+size*(/[^\x00-\xff]/.test(c)?1:/[MW@%]/.test(c)?1:.65),0);
 const wrap=(value,size,available)=>{const lines=[];let line='';for(const c of value){if(line&&measure(line+c,size)>available){lines.push(line);line='';}line+=c;}if(line)lines.push(line);return lines;};
 const nodes=[];let y=mode==='single'?16:28;
 rows.forEach((row,layer)=>{
  const prepared=row.map(s=>{const name=s.name+(s.inferred?'\uff08\u63a8\u6e2c\uff09':''),w=Math.min(maxWidth,Math.max(96,Math.ceil(Math.max(measure(name,15),measure(s.block??'',12))+(s.issues.length?26:16))));
   const inner=w-(s.issues.length?26:16),lines=wrap(name,15,inner),blockLines=wrap(s.block??'',12,inner),noteLines=s.isolated?wrap('\u9019\u689d\u8def\u7dda\u6c92\u6709\u63a5\u5230\u5176\u4ed6\u5340\u584a',12,w-16):[];
   return {...s,depth:depth.get(s.id)??0,layer,w,h:Math.max(40,8+lines.length*18+blockLines.length*14),lines,blockLines,noteLines,noteHeight:noteLines.length?noteLines.length*16+8:0};});
  const height=Math.max(...prepared.map(s=>s.h+s.noteHeight));
  let x=(width-prepared.reduce((sum,s)=>sum+s.w,0)-(row.length-1)*gap)/2;
  prepared.forEach(s=>{nodes.push({...s,x,y});x+=s.w+gap;});y+=height+(mode==='single'?24:64);
 });
 const byId=new Map(nodes.map(n=>[n.id,n]));
 // Cubics are represented explicitly so geometry checks measure the curve,
 // rather than mistaking its control polygon for the rendered path.
 const sample=segments=>segments.flatMap((s,j)=>Array.from({length:s.length===2?2:81},(_,k)=>{const t=k/(s.length===2?1:80),u=1-t;return s.length===2?[u*s[0][0]+t*s[1][0],u*s[0][1]+t*s[1][1]]:[0,1].map(axis=>u**3*s[0][axis]+3*u*u*t*s[1][axis]+3*u*t*t*s[2][axis]+t**3*s[3][axis]);}).slice(j?1:0));
 const intersects=(segments,a,b)=>sample(segments).some(([x,y])=>nodes.some(n=>n!==a&&n!==b&&x>n.x-3&&x<n.x+n.w+3&&y>n.y-3&&y<n.y+n.h+n.noteHeight+3));
 const edges=hops.map((h,i)=>{const a=byId.get(h.from),b=byId.get(h.to);if(!a||!b)return null;
  const ax=a.x+a.w/2,bx=b.x+b.w/2,ay=a.y+a.h,by=b.y;let segments,kind;
  if(a.layer===b.layer&&a!==b){kind='horizontal';segments=[a.x<b.x?[[a.x+a.w,a.y+a.h/2],[b.x,b.y+b.h/2]]:[[a.x,a.y+a.h/2],[b.x+b.w,b.y+b.h/2]]];}
  else if(mode==='single'){
   if(b.layer===a.layer+1){kind='single';segments=[[[ax,ay],[bx,by]]];}
   else{
    // A return stays in the side margin, including a self-return. A later
    // departure from a revisited station uses the same corridor if it skips
    // stations already drawn; no segment crosses an unrelated station.
    kind=b.layer>a.layer?'single-skip':a===b?'loop':'backward';
    const side=width-10-(i%3)*3,startY=a.y+a.h/2,endY=a===b?a.y+a.h/4:b.y+b.h/2,dir=endY>startY?1:-1;
    const turn=Math.min(12,Math.abs(endY-startY)/3),right=a.x+a.w,target=b.x+b.w;
    segments=[[[right,startY],[side-6,startY],[side,startY],[side,startY+dir*turn]],[[side,startY+dir*turn],[side,endY-dir*turn]],[[side,endY-dir*turn],[side,endY],[side-6,endY],[target,endY]]];
   }
  }
  else{
   kind=b.layer>a.layer?'forward':a===b?'loop':'backward';
   const middle=(ay+by)/2;segments=[[[ax,ay],[ax,middle],[bx,middle],[bx,by]]];
   // Try broad interior bows before taking an exterior detour. Unlike a
   // shared bus, each accepted curve follows the free space between boxes.
   if(kind==='forward'&&intersects(segments,a,b)){
    const candidates=[],distance=by-ay;
    for(let step=-8;step<=24;step++)for(const bend of [.15,.3,.45]){
     const control=width*step/16,curve=[[[ax,ay],[control,ay+distance*bend],[control,by-distance*bend],[bx,by]]],points=sample(curve);
     if(points.every(([x])=>x>=5&&x<=width-5)&&!intersects(curve,a,b))candidates.push({curve,length:points.slice(1).reduce((sum,p,j)=>sum+Math.hypot(p[0]-points[j][0],p[1]-points[j][1]),0)});
    }
    if(candidates.length)segments=candidates.sort((a,b)=>a.length-b.length)[0].curve;
   }
   if(kind==='forward'&&intersects(segments,a,b)){
    // Follow open gaps in the intervening layers, with vertical tangents at
    // every join. This keeps long edges inside the diagram when space exists.
    const between=[...new Set(nodes.filter(n=>n.layer>a.layer&&n.layer<b.layer).map(n=>n.layer))].sort((a,b)=>a-b),via=[];let current=[ax,ay];
    const join=next=>{const delta=(next[1]-current[1])/2;via.push([current,[current[0],current[1]+delta],[next[0],next[1]-delta],next]);current=next;};
    for(const layer of between){
     const row=nodes.filter(n=>n.layer===layer).sort((a,b)=>a.x-b.x),top=row[0].y,bottom=Math.max(...row.map(n=>n.y+n.h+n.noteHeight));
     const slots=[];let left=5;for(const n of row){if(n.x-4>=left)slots.push([left,n.x-4]);left=n.x+n.w+4;}if(left<=width-5)slots.push([left,width-5]);
     const desired=current[0]+(bx-current[0])*(top-current[1])/(by-current[1]),options=slots.map(([lo,hi])=>Math.max(lo,Math.min(hi,desired)));
     options.sort((x,z)=>Math.abs(x-desired)-Math.abs(z-desired));const x=options[0];join([x,top-4]);join([x,bottom+4]);
    }
    join([bx,by]);if(!intersects(via,a,b))segments=via;
   }
   if(kind!=='forward'||intersects(segments,a,b)){
    const side=ax+bx<width?10+(i%3)*3:width-10-(i%3)*3;
    const sy=kind==='forward'?ay:a.y,band=kind==='forward'?sy+32:sy-32,targetBand=kind==='forward'?by-32:by-16,sign=kind==='forward'?1:-1;
    segments=[[[ax,sy],[ax,sy+sign*24],[side,band-sign*24],[side,band]],[[side,band],[side,band+(targetBand-band)/3],[side,band+2*(targetBand-band)/3],[side,targetBand]],[[side,targetBand],[side,kind==='forward'?by-8:by-24],[bx,by-24],[bx,by]]];
   }
  }
  if(kind==='loop'&&mode!=='single')segments=[[[a.x+a.w*.7,a.y],[a.x+a.w*.7,a.y-24],[a.x+a.w*.3,a.y-24],[a.x+a.w*.3,a.y]]];
  const points=sample(segments),d='M'+segments[0][0].join(',')+segments.map(s=>(s.length===2?' L':' C')+s.slice(1).map(p=>p.join(',')).join(' ')).join('');
  return {...h,index:i,kind,segments,points,d,strokeWidth:mode==='blocks'?(h.count>=4?4:h.count>=2?3:2):2};
 }).filter(Boolean);
 return {mode,width,height:Math.max(160,y-(mode==='single'?8:28)),nodes,edges};
}

function boot(model,layout){
 const $=s=>document.querySelector(s),svgNS='http://www.w3.org/2000/svg',chips=$('.chips'),map=$('#map'),steps=$('#steps'),panel=$('#station-detail');
 let selected=null,timers=[],generation=0,frame=0,transition=0,drawnSelection=null;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const stop=()=>{generation++;timers.forEach(clearTimeout);timers=[];$('#play').textContent='\u25b6 \u8d70\u4e00\u6b21';};
 const el=(tag,attrs={},text='')=>{const e=document.createElementNS(svgNS,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));e.textContent=text;return e;};
 const text=(tag,value,parent,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;parent.append(e);return e;};
 const detail=n=>{panel.replaceChildren();panel.hidden=false;text('h3',n.name+(n.inferred?'\uff08\u63a8\u6e2c\uff09':''),panel);text('p',n.file??n.files.join('\n'),panel,'technical');if(!n.issues.length)text('p','\u672c\u6b21\u6c92\u6709\u76f8\u95dc\u554f\u984c\u5361\u3002',panel);for(const issue of n.issues){const box=text('section','',panel,'issue-note');text('strong',issue.name,box);text('p',issue.description,box);if(issue.risk)text('p',issue.risk,box);}panel.scrollIntoView({block:'nearest',behavior:'smooth'});};
 const render=(animate=false)=>{
  cancelAnimationFrame(frame);const token=++transition,fromSelection=drawnSelection;drawnSelection=selected;
  const samplePath=p=>{const length=p.getTotalLength();return Array.from({length:61},(_,i)=>{const q=p.getPointAtLength(length*i/60);return [q.x,q.y];});};
  const previous=new Map([...map.querySelectorAll('.station')].map(g=>{const m=g.getCTM(),box=g.querySelector('.station-box');return [g.dataset.station,{g,x:m.e,y:m.f,w:+box.getAttribute('width'),h:+box.getAttribute('height'),opacity:+getComputedStyle(g).opacity}];}));
  const oldEdges=[...map.querySelectorAll('.connection')].map(g=>({g,key:g.dataset.key,points:samplePath(g.querySelector('.edge')),opacity:+getComputedStyle(g).opacity}));
  const oldHeight=map.querySelector('svg')?.viewBox.baseVal.height??0;
  const motion=animate&&!reduced.matches,collapse=fromSelection===null&&selected!==null,expand=fromSelection!==null&&selected===null;
  const moveStart=collapse?200:0,moveEnd=moveStart+350,fadeStart=expand?350:0,total=collapse||expand?550:350;
  const moves=[],fades=[],edgeMoves=[],retired=[];
  const blockId=station=>'block-'+[...new Set(model.stations.map(s=>s.block))].indexOf(station?.block);
  const priorNode=n=>previous.get(n.id)??previous.get(blockId(n));
  // Block overview nodes represent several stations. Deform new/retired
  // paths from their endpoint boxes so lines travel with their stations.
  const deform=(points,a,b,da,db)=>{
   const shift=(p,n,d)=>n&&d?[d.x+(p[0]-n.x)*(d.w??n.w)/n.w-p[0],d.y+(p[1]-n.y)*(d.h??n.h)/n.h-p[1]]:[0,0];
   const start=shift(points[0],a,da),end=shift(points.at(-1),b,db);
   return points.map((p,i)=>p.map((v,axis)=>v+start[axis]*(1-i/60)+end[axis]*i/60));
  };
  stop();panel.hidden=true;map.replaceChildren();const r=model.routes.find(r=>r.id===selected),width=map.getBoundingClientRect().width,l=layout(model,width,selected);map.dataset.mode=l.mode;map.dataset.phase=motion?(collapse?'fade-out':expand?'move-back':'switch'):'settled';
  const svg=el('svg',{viewBox:'0 0 '+l.width+' '+l.height,role:'img','aria-label':'\u8def\u7dda\u9023\u7dda\u5716'});map.append(svg);
  const defs=el('defs'),marker=el('marker',{id:'arrow',viewBox:'0 0 10 10',refX:10,refY:5,markerUnits:'userSpaceOnUse',markerWidth:8,markerHeight:8,orient:'auto-start-reverse'});marker.append(el('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'var(--accent)'}));defs.append(marker);svg.append(defs);
  const active=new Set(r?r.hops.flatMap(h=>[h.from,h.to]):model.stations.map(s=>s.id));
  for(const h of l.edges){const key=h.from+'|'+h.to+'|'+(h.anchor?.line??'');const prior=oldEdges.find(e=>e.key===key&&!e.used);if(prior)prior.used=true;const on=!r||r.hops.some(x=>x.from===h.from&&x.to===h.to&&x.anchor?.line===h.anchor?.line);const group=el('g',{'data-from':h.from,'data-to':h.to,'data-edge':h.index,'data-key':key,class:'connection'+(on?' on':' dim')});group.append(el('path',{d:h.d,style:'stroke-width:'+h.strokeWidth,class:'edge'+(h.manual?' manual':''),'marker-end':on?'url(#arrow)':''}));if(on&&r){const dot=el('circle',{r:3.3,class:'flow-dot'}),motion=el('animateMotion',{dur:'2.4s',repeatCount:'indefinite',path:h.d});dot.append(motion);group.append(dot);}svg.append(group);if(motion){const points=samplePath(group.querySelector('.edge')),a=l.nodes.find(n=>n.id===h.from),b=l.nodes.find(n=>n.id===h.to),oa=priorNode(a),ob=priorNode(b);
   if(prior||oa&&ob)edgeMoves.push({g:group,p:group.querySelector('.edge'),from:prior?.points??deform(points,a,b,oa,ob),to:points,d:h.d});
   const start=prior?0:collapse&&oa&&ob?moveStart:fadeStart;fades.push({g:group,from:prior?.opacity??0,to:1,start,end:prior?total:start+200});group.querySelectorAll('.flow-dot').forEach(e=>e.style.visibility='hidden');}}
  for(const n of l.nodes){const pad=8;const prior=previous.get(n.id),origin=prior??previous.get('block-'+[...new Set(model.stations.map(s=>s.block))].indexOf(n.block));const g=prior?.g??el('g');g.getAnimations().forEach(a=>a.cancel());g.replaceChildren();Object.entries({transform:'translate('+n.x+' '+n.y+')',class:'station'+(r&&!active.has(n.id)?' dim':''),'data-station':n.id,role:'button',tabindex:0,'aria-label':n.name+(n.issues.length?'\uff0c\u6709\u554f\u984c':'' )}).forEach(([key,value])=>g.setAttribute(key,value));g.append(el('rect',{class:'station-box',width:n.w,height:n.h,rx:8}));g.append(el('rect',{class:'tap-area',x:0,y:Math.min(0,(n.h-44)/2),width:n.w,height:Math.max(44,n.h)}));n.lines.forEach((line,i)=>g.append(el('text',{x:pad,y:18+i*18,class:'station-name'},line)));n.blockLines.forEach((line,i)=>g.append(el('text',{x:pad,y:18+n.lines.length*18+i*14-4,class:'block-name'},line)));n.noteLines.forEach((line,i)=>g.append(el('text',{x:pad,y:n.h+20+i*16,class:'block-name isolated-note'},line)));if(n.issues.length)g.append(el('circle',{cx:n.w-9,cy:9,r:5,class:'issue-dot'}));g.onclick=()=>detail(n);g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();detail(n);}};svg.append(g);
   g.style.opacity='1';g.style.pointerEvents='';g.removeAttribute('aria-hidden');if(motion){if(origin)moves.push({g,n,origin});fades.push({g,from:prior?.opacity??0,to:1,start:prior?0:collapse&&origin?moveStart:fadeStart,end:prior?total:(collapse&&origin?moveStart:fadeStart)+200});}
  }
  if(motion){
   const destination=id=>l.nodes.find(n=>n.id===id)??l.nodes.find(n=>n.id===blockId(model.stations.find(s=>s.id===id)));
   for(const [id,old] of previous)if(!l.nodes.some(n=>n.id===id)){
    const target=expand?destination(id):null;old.g.setAttribute('aria-hidden','true');old.g.setAttribute('tabindex','-1');old.g.style.pointerEvents='none';svg.append(old.g);retired.push(old.g);
    if(target)moves.push({g:old.g,n:target,origin:old});fades.push({g:old.g,from:old.opacity,to:0,start:target?350:0,end:target?550:200});
   }
   for(const old of oldEdges)if(!old.used){
    svg.insertBefore(old.g,svg.children[1]??null);retired.push(old.g);const from=old.g.dataset.from,to=old.g.dataset.to,a=previous.get(from),b=previous.get(to),da=expand?destination(from):null,db=expand?destination(to):null;
    if(da&&db){const points=deform(old.points,a,b,da,db),d=points.map((p,i)=>(i?' L':'M')+p.join(',')).join('');edgeMoves.push({g:old.g,p:old.g.querySelector('.edge'),from:old.points,to:points,d});}
    fades.push({g:old.g,from:old.opacity,to:0,start:da&&db?350:0,end:da&&db?550:200});old.g.querySelectorAll('.flow-dot').forEach(e=>e.style.visibility='hidden');
   }
   const progress=(t,start,end)=>Math.max(0,Math.min(1,(t-start)/(end-start))),mix=(a,b,t)=>a+(b-a)*t;
   const started=performance.now(),tick=now=>{
    if(token!==transition)return;const elapsed=now-started,p=progress(elapsed,moveStart,moveEnd),ease=p*p*(3-2*p);
    map.dataset.phase=elapsed>=total?'settled':collapse?(elapsed<200?'fade-out':'move-in'):expand?(elapsed<350?'move-back':'fade-in'):'switch';
    svg.setAttribute('viewBox','0 0 '+l.width+' '+mix(oldHeight||l.height,l.height,ease));
    for(const {g,n,origin:o} of moves){g.setAttribute('transform','translate('+mix(o.x,n.x,ease)+' '+mix(o.y,n.y,ease)+')');const box=g.querySelector('.station-box');box.setAttribute('width',mix(o.w??n.w,n.w,ease));box.setAttribute('height',mix(o.h??n.h,n.h,ease));}
    for(const e of edgeMoves)e.p.setAttribute('d',p===1?e.d:e.from.map((q,i)=>(i?' L':'M')+mix(q[0],e.to[i][0],ease)+','+mix(q[1],e.to[i][1],ease)).join(''));
    for(const f of fades)f.g.style.opacity=String(mix(f.from,f.to,progress(elapsed,f.start,f.end)));
    if(elapsed<total)frame=requestAnimationFrame(tick);else{retired.forEach(g=>g.remove());svg.querySelectorAll('.flow-dot').forEach(e=>e.style.visibility='');svg.querySelectorAll('.station,.connection').forEach(g=>{g.style.opacity='';g.style.pointerEvents='';g.removeAttribute('aria-hidden');});}
   };tick(started);
  }
  $('#expand-all').hidden=!r;$('#progress').textContent='';
  $('#route-title').textContent=r?r.name:l.mode==='blocks'?'\u5340\u584a\u7e3d\u89bd':'\u5168\u90e8\u8def\u7dda';$('#description').textContent=r?r.description:'\u9078\u64c7\u4e00\u689d\u8def\u7dda\uff0c\u770b\u5b83\u4e00\u7ad9\u4e00\u7ad9\u5f80\u54ea\u88e1\u8d70\u3002';$('#mode-note').textContent=r?'\u53ea\u986f\u793a\u9019\u689d\u8def\u7dda\u7684 '+l.nodes.length+' \u7ad9\uff0c\u56de\u5230\u300c\u5168\u90e8\u300d\u770b\u6574\u5f35\u5716\u3002':l.mode==='blocks'?'\u7ad9\u9ede\u8d85\u904e\u5341\u516b\u500b\uff0c\u624b\u6a5f\u5148\u770b\u5340\u584a\u3002\u9078\u8def\u7dda\u53ef\u770b\u55ae\u7dda\u3002':l.mode==='single'?'\u624b\u6a5f\u55ae\u7dda\u95b1\u8b80':'\u9ede\u7ad9\u540d\u67e5\u770b\u6a94\u6848\u8207\u554f\u984c';
  steps.replaceChildren();$('#play').disabled=!r;
  if(r)r.hops.forEach((h,i)=>{const li=document.createElement('li'),button=text('button','',li);button.type='button';button.dataset.step=i;text('span',String(i+1).padStart(2,'0'),button,'step-number');const body=text('span','',button,'step-body');text('strong',h.action,body);const from=model.stations.find(s=>s.id===h.from),to=model.stations.find(s=>s.id===h.to);text('span',from.name+' \u2192 '+to.name,body);text('small',h.anchor.file+':'+h.anchor.line,body,'technical');if(h.manual)text('span','\u4eba\u5de5\u5224\u8b80',body,'manual-label');button.onclick=()=>play(i,true);steps.append(li);});
  else text('li','\u4e0a\u65b9\u6bcf\u500b\u6309\u9215\u662f\u4e00\u689d\u8def\u7dda\u3002\u7d05\u9ede\u8868\u793a\u9014\u4e2d\u6709\u9700\u8981\u7559\u610f\u7684\u554f\u984c\u3002',steps,'empty');
 };
 const select=id=>{selected=id&&id===selected?null:id;id=selected;for(const b of chips.children){const on=(b.dataset.route||null)===id;b.setAttribute('aria-pressed',String(on));if(on)b.scrollIntoView({block:'nearest',inline:'nearest'});}render(true);};
 function play(index=0,single=false){
  stop();const r=model.routes.find(r=>r.id===selected);if(!r)return;const token=generation;$('#play').textContent='\u25b6 \u91cd\u8d70\u4e00\u6b21';map.querySelectorAll('.station').forEach(e=>e.classList.remove('visited'));
  const run=i=>{if(token!==generation||i>=r.hops.length)return;const h=r.hops[i];map.querySelectorAll('.connection').forEach(e=>e.classList.toggle('playing',e.dataset.from===h.from&&e.dataset.to===h.to));map.querySelectorAll('.station').forEach(e=>{if(e.dataset.station===h.from)e.classList.add('visited');});steps.querySelectorAll('button').forEach((e,j)=>{e.classList.toggle('now',j===i);e.setAttribute('aria-current',j===i?'step':'false');});$('#progress').textContent='\u7b2c '+(i+1)+' \u6b65\uff1a'+h.action;timers.push(setTimeout(()=>{if(token!==generation)return;map.querySelectorAll('.station').forEach(e=>{if(e.dataset.station===h.to)e.classList.add('visited');});},500));if(!single&&i+1<r.hops.length)timers.push(setTimeout(()=>run(i+1),1300));};run(index);
 }
 for(const r of [{id:'',name:'\u5168\u90e8'},...model.routes]){const b=text('button',r.name,chips,'chip');b.type='button';b.dataset.route=r.id;b.setAttribute('aria-pressed',String(!r.id));if(r.hasIssues){const d=text('span','',b,'badge');d.setAttribute('aria-label','\u6709\u554f\u984c');}b.onclick=()=>select(r.id||null);}
 $('#expand-all').onclick=()=>select(null);reduced.addEventListener('change',()=>render());
 $('#play').onclick=()=>play();$('#close-detail').onclick=()=>panel.hidden=true;
 let lastWidth=0;new ResizeObserver(()=>{const width=Math.floor(map.clientWidth);if(width!==lastWidth){lastWidth=width;render();}}).observe(map);
 render();
}
const css=`
:root{color-scheme:light dark;--bg:#f5f4f0;--paper:#fff;--ink:#24332f;--muted:#66756f;--line:#dce3dd;--accent:#20795e;--soft:#eaf3ed;--red:#bc3b44;--dim:#aab8b0}
@media(prefers-color-scheme:dark){:root{--bg:#131d19;--paper:#1c2a23;--ink:#ecf2ed;--muted:#b0c2b6;--line:#3a5144;--accent:#81d9ad;--soft:#293e31;--red:#ff9aa5;--dim:#6d8776}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,"Microsoft JhengHei",sans-serif}main{max-width:1200px;margin:auto;padding:28px 24px 48px;min-width:0}h1{font-size:28px;letter-spacing:-.04em;margin:6px 0}h2{font-size:20px;margin:0}h3{font-size:18px;margin:0}p{margin:8px 0}.eyebrow{font-size:13px;letter-spacing:.15em;color:var(--accent);font-weight:700}.intro,.muted{color:var(--muted)}.chips{display:flex;gap:8px;overflow-x:auto;max-width:100%;padding:12px 0 18px;scrollbar-width:thin}.chip{flex:none;border:1px solid var(--line);border-radius:24px;background:var(--paper);color:var(--ink);padding:10px 16px;min-height:44px;font:inherit;cursor:pointer}.chip[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--paper);font-weight:700}.badge{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);margin-left:7px;box-shadow:0 0 0 2px var(--paper)}.workspace{display:grid;grid-template-columns:minmax(0,1fr);gap:20px}.mapcard,.sidebar{min-width:0;background:var(--paper);border:1px solid var(--line);border-radius:16px}.maphead{padding:16px 18px 0}#expand-all{font:inherit;font-size:14px;min-height:44px;padding:6px 12px;margin-top:6px;border:1px solid var(--line);border-radius:9px;color:var(--accent);background:var(--paper);cursor:pointer}.maphead p{font-size:14px;color:var(--muted);margin:4px 0}#map{width:100%;min-width:0}svg{display:block;width:100%;height:auto}.edge{fill:none;stroke:var(--dim);stroke-width:2}.connection.on .edge{stroke:var(--accent)}.connection.playing .edge{stroke-width:4}.manual{stroke-dasharray:7 5}.dim{opacity:.22}.flow-dot{fill:var(--accent);stroke:var(--paper);stroke-width:1.4}.station{cursor:pointer}.station rect{fill:var(--paper);stroke:var(--accent);stroke-width:1.6}.station .tap-area{fill:transparent;stroke:none;pointer-events:all}.station text{fill:var(--ink);font-family:inherit}.station-name{font-size:15px;font-weight:650}.block-name{font-size:12px;fill:var(--muted)!important}.station.visited rect{fill:var(--soft);stroke-width:3}.issue-dot{fill:var(--red)}.legend{display:flex;flex-wrap:wrap;gap:6px 18px;padding:8px 18px 16px;color:var(--muted);font-size:14px}.legend span:before{content:'';display:inline-block;width:20px;margin-right:6px;border-top:2px solid var(--accent);vertical-align:middle}.legend .dashed:before{border-top-style:dashed}.legend .red:before{width:8px;height:8px;border:0;border-radius:50%;background:var(--red)}.sidebar{padding:20px;align-self:start}.bar{display:flex;align-items:center;gap:12px;margin:16px 0}.play{border:0;border-radius:10px;background:var(--accent);color:var(--paper);font:inherit;font-weight:700;padding:10px 15px;cursor:pointer;min-height:44px}.play:disabled{opacity:.5;cursor:default}#progress{font-size:14px;color:var(--muted)}ol{padding:0;list-style:none;margin:0}#steps button{display:flex;gap:12px;width:100%;text-align:left;border:1px solid transparent;border-bottom-color:var(--line);background:transparent;color:var(--ink);padding:14px 8px;font:inherit;cursor:pointer;border-radius:10px}.step-number{color:var(--accent);font-size:14px;flex:none}.step-body{min-width:0;display:flex;flex-direction:column;gap:3px}.step-body>span{font-size:14px;color:var(--muted)}.technical{font-size:12px;color:var(--muted);overflow-wrap:anywhere;white-space:pre-wrap}.step-body .manual-label{font-size:13px;color:var(--accent)}#steps button.now{background:var(--soft);border-color:var(--accent)}.empty{color:var(--muted);font-size:15px}.detail-wrap{margin:14px 0}.detail{background:var(--soft);padding:18px;border-radius:12px;overflow-wrap:anywhere}.issue-note{border-left:3px solid var(--red);padding-left:12px;margin-top:16px;font-size:14px}#close-detail{font:inherit;border:1px solid var(--line);color:var(--ink);background:var(--paper);border-radius:8px;padding:8px 12px;margin-top:8px}.limit{font-size:14px;color:var(--muted);padding-top:20px}button:focus-visible,.station:focus-visible{outline:3px solid var(--accent);outline-offset:3px}#map:not([data-mode=blocks]) .connection.playing .edge{stroke-width:4!important}.station:hover rect{stroke-width:3}[hidden]{display:none!important}
@media(min-width:900px){.workspace{grid-template-columns:minmax(0,1.65fr) minmax(280px,1fr)}}
@media(max-width:599px){main{padding:20px 12px 36px}h1{font-size:25px}.sidebar{padding:16px}.workspace{gap:14px}.intro{font-size:14px}.block-name{font-size:12px}}
@media(prefers-reduced-motion:reduce){.flow-dot{display:none}*{scroll-behavior:auto!important}}
`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderRouteMap(model){
 const data=JSON.stringify(model).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
 return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; connect-src \'none\'; base-uri \'none\'"><title>'+esc(model.title)+'</title><style>'+css+'</style></head><body><main><header><div class="eyebrow">\u7a0b\u5f0f\u8108\u7d61 \u00b7 \u8def\u7dda\u95b1\u8b80</div><h1>'+esc(model.title)+'</h1><p class="intro">\u9078\u4e00\u689d\u8def\u7dda\uff0c\u8ddf\u8457\u5149\u9ede\u8d70\u3002\u9ede\u4e00\u500b\u7ad9\uff0c\u770b\u5b83\u7684\u4f86\u6e90\u8207\u554f\u984c\u3002</p></header><nav class="chips" aria-label="\u9078\u64c7\u8def\u7dda"></nav><div class="workspace"><section class="mapcard"><div class="maphead"><h2>\u8def\u7dda\u52d5\u614b\u5716</h2><p id="mode-note"></p><button id="expand-all" type="button" hidden>\u5c55\u958b\u5168\u90e8</button></div><div id="map"></div><div class="legend"><span>\u539f\u78bc\u5f15\u7528</span><span class="dashed">\u4eba\u5de5\u5224\u8b80</span><span class="red">\u76f8\u95dc\u554f\u984c</span></div></section><aside class="sidebar"><h2 id="route-title"></h2><p id="description" class="muted"></p><div class="bar"><button class="play" id="play">\u25b6 \u8d70\u4e00\u6b21</button><span id="progress" aria-live="polite"></span></div><ol id="steps"></ol><div class="detail-wrap"><section id="station-detail" class="detail" hidden></section><button id="close-detail">\u6536\u5408\u7ad9\u9ede\u8aaa\u660e</button></div></aside></div><p class="limit">\u7dda\u8868\u793a\u7a0b\u5f0f\u78bc\u88e1\u6709\u9019\u689d\u5f15\u7528\uff0c\u4e0d\u4ee3\u8868\u5be6\u969b\u57f7\u884c\u904e\u3002\u865b\u7dda\u70ba\u4eba\u5de5\u5224\u8b80\uff0c\u50c5\u78ba\u8a8d\u539f\u6587\u4f4d\u7f6e\u3002</p>'+model.limits.map(s=>'<p class="limit">'+esc(s)+'</p>').join('')+'</main><script id="route-data" type="application/json">'+data+'</script><script>('+boot.toString()+')(JSON.parse(document.getElementById("route-data").textContent),'+layoutRoutes.toString()+');</script></body></html>\n';
}
