// Declaration comparison only. Lexical candidates never authorize a hard block.
import {tokens,localFunctions,callArgs} from './language-static.mjs';
import {sha256,readBounded} from './walker.mjs';
const unique=xs=>[...new Set(xs)];
const codeFile=p=>/\.(?:[cm]?[jt]s|tsx|jsx|py)$/i.test(p);
const words=s=>String(s).replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z0-9\u3400-\u9fff]+/).filter(Boolean);
const stem=s=>s.replace(/(?:ations?|tion|ments?|ing|ies|ed|s)$/,'');
const norm=s=>words(s).map(stem).join(' ');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const stopLabels={baseline:'\u5e95\u7dda','needs-attention':'\u8981\u8655\u7406',uncertain:'\u4e0d\u78ba\u5b9a'};
const anchor=(file,line,expect)=>({file,line,expect,snippetSha256:sha256(expect)});
function pattern(s,fallback){return new RegExp(s??fallback,'i');}
function matching(text,keys=[]){const n=norm(text);return keys.filter(k=>n.includes(norm(k)));}
function ranges(t,body,py){
 const fs=localFunctions(t,body,py,true).map(f=>({...f,definition:f.nameAt}));
 if(!py)for(let i=0;i<t.length;i++){
  // Named arrows and typed TS functions. Unknown anonymous scopes stay explicit.
  let nameAt=-1,open=-1;
  if(t[i].v==='function'&&t[i+1]?.kind==='name'){nameAt=i+1;open=i+2;}
  else if(t[i].kind==='name'&&t[i+1]?.v==='='&&t[i+2]?.v==='('){nameAt=i;open=i+2;}
  else if(t[i].kind==='name'&&t[i+1]?.v==='='&&t[i+2]?.kind==='name'&&t[i+3]?.v==='='&&t[i+4]?.v==='>'){
   if(t[i+5]?.v==='{'){let end=i+6,d=1;for(;end<t.length;end++){if(t[end].kind==='string')continue;if(t[end].v==='{')d++;if(t[end].v==='}'&&!--d)break;}fs.push({name:t[i].v,nameAt:i,definition:i,start:i+6,end,params:[{name:t[i+2].v}],line:t[i].line});}continue;
  }
  if(open<0||t[open]?.v!=='(')continue;
  const args=callArgs(t,open);let b=args.end+1;
  for(;b<t.length&&b<args.end+45;b++)if(t[b].v==='{'||t[b].v===';')break;
  if(t[b]?.v!=='{'||fs.some(f=>f.nameAt===nameAt))continue;
  let end=b+1,d=1;for(;end<t.length;end++){if(t[end].kind==='string')continue;if(t[end].v==='{')d++;if(t[end].v==='}'&&!--d)break;}
  fs.push({name:t[nameAt].v,nameAt,definition:nameAt,start:b+1,end,params:args.args.map(a=>({name:a[0]?.v})),line:t[nameAt].line});
 }
 return fs;
}
function expressionEnd(t,i,py){
 let depth=0,j=i+1;
 for(;j<t.length;j++){
  const x=t[j];if(x.kind==='string'||x.kind==='regex')continue;
  if(depth===0&&(x.v===';'||x.v==='}'||x.v==='\n'))break;
  if(['(','[','{'].includes(x.v))depth++;
  if([')',']','}'].includes(x.v)){if(depth===0)break;depth--;}
 }
 return j;
}
function returnProperties(ts){
 const t=ts.filter(x=>x.v!=='\n'),fields={};
 if(t.length===1&&t[0].kind==='string')return {literal:t[0].v};
 if(t[0]?.v!=='{')return fields;
 let depth=0;
 for(let i=0;i<t.length;i++){
  const x=t[i];if(x.kind!=='string'&&x.kind!=='regex'){if(['{','[','('].includes(x.v))depth++;if(['}',']',')'].includes(x.v))depth--;}
  if(depth===1&&['{',','].includes(t[i-1]?.v)&&t[i+1]?.v===':'&&t[i+2]){
   const v=t[i+2];if(v.kind==='string'&&v.literal||['true','false','True','False'].includes(v.v))fields[x.v]=v.v;
  }
 }
 return fields;
}
function catchBoundary(t,at,py,lines){
 if(py){
  const indent=n=>(lines[n-1]?.match(/^\s*/)?.[0]??'').replaceAll('\t','        ').length;
  for(let i=at-1;i>=0;i--)if(t[i].v==='try'&&indent(t[i].line)<indent(t[at].line)){
   const level=indent(t[i].line);
   for(let j=at+1;j<t.length;j++)if(t[j].v!=='\n'&&indent(t[j].line)<=level)return ['except','finally'].includes(t[j].v);
  }return false;
 }
 const stack=[];
 for(let i=0;i<at;i++){if(t[i].kind==='string'||t[i].kind==='regex')continue;if(t[i].v==='{')stack.push(i);if(t[i].v==='}')stack.pop();}
 for(const open of stack){let prev=open-1;while(t[prev]?.v==='\n')prev--;if(t[prev]?.v!=='try')continue;let depth=1,end=open+1;for(;end<t.length;end++){if(t[end].kind==='string'||t[end].kind==='regex')continue;if(t[end].v==='{')depth++;if(t[end].v==='}'&&!--depth)break;}let next=end+1;while(t[next]?.v==='\n')next++;if(t[next]?.v==='catch'||t[next]?.v==='finally')return true;}
 return false;
}
export function scanStopSites(file,body,config={}){
 if(!codeFile(file))return [];
 const py=file.endsWith('.py'),t=tokens(body,py,{regexLiterals:true}),lines=body.split(/\r?\n/),funcs=ranges(t,body,py),sites=[];
 const scope=i=>funcs.filter(f=>i>=f.start&&i<f.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
 const codeRx=pattern(config.reasonCodePattern,'^[A-Z][A-Z0-9_]{2,}$'),statusRx=pattern(config.statusPattern,'^(?:error|failed|failure|denied|rejected|refused|blocked|invalid)$');
 function record(i,kind,end=expressionEnd(t,i,py),helper=null){
  const ts=t.slice(i,end),f=scope(i),snippet=body.slice(t[i].start,t[Math.max(i,end-1)].end),strings=ts.filter(x=>x.kind==='string'&&x.literal).map(x=>x.v);
  let code=null;
  for(let n=0;n<ts.length-2;n++)if(['code','reasonCode','reason_code','reason'].includes(ts[n].v)&&[':', '='].includes(ts[n+1].v)&&ts[n+2].kind==='string')code=ts[n+2].v;
  code??=strings.find(s=>codeRx.test(s))??helper?.reasonCode??null;
  if(helper?.codeParam){const args=callArgs(t,i+1).args,p=helper.params.indexOf(helper.codeParam);if(p>=0&&args[p]?.length===1&&args[p][0].kind==='string')code=args[p][0].v;}
  const message=strings.filter(s=>s!==code&&!statusRx.test(s)).join(' | ')||helper?.message||null;
  // Only the immediately controlling condition is used, not a whole function's words.
  let start=i-1,d=0;
  for(;start>=0;start--){const x=t[start];if(x.kind==='string'||x.kind==='regex')continue;if(x.v===')')d++;if(x.v==='(')d--;if(d===0&&[';','}'].includes(x.v))break;if(t[i].line-x.line>12)break;if(d===0&&x.v==='if')break;}
  const contextTokens=t.slice(start>=0&&t[start]?.v==='if'?start:i,i),condition=contextTokens.map(x=>x.v).join(' ');
  const conditionText=contextTokens.length?body.slice(contextTokens[0].start,t[i].start):'';
  sites.push({id:'stop-'+sha256(file+'\0'+t[i].start+'\0'+kind).slice(0,20),file,path:file,symbol:f?.name??'<module>',locator:file+'#'+(f?.name??'<module>'),line:t[i].line,column:t[i].start-(body.lastIndexOf('\n',t[i].start-1)+1)+1,kind,snippet,snippetSha256:sha256(snippet),sourceSha256:sha256(body),anchor:anchor(file,t[i].line,lines[t[i].line-1]),message,reasonCode:code,condition:conditionText,scope:{name:f?.name??null,line:f?.line??null,private:!!f&&/^_|^#/.test(f.name)},internalGuard:/\btypeof\b|\bisinstance\b|\bTypeError\b|\bAssertionError\b/.test(condition+' '+snippet),mixedCondition:/\|\s*\||&\s*&|\bor\b|\band\b/.test(condition),catchBoundary:catchBoundary(t,i,py,lines),helper:helper?{name:helper.name,line:helper.line,oneHop:true}:null,_at:i,_scope:f});
 }
 for(let i=0;i<t.length;i++){
  if(t[i].kind!=='name'||['.','?'].includes(t[i-1]?.v))continue;
  if((t[i].v==='throw'&&!py||t[i].v==='raise'&&py)&&!funcs.some(f=>f.nameAt===i))record(i,t[i].v);
  else if(['process','sys'].includes(t[i].v)&&t[i+1]?.v==='.'&&t[i+2]?.v==='exit'&&t[i+3]?.v==='(')record(i,t[i].v+'.exit',callArgs(t,i+3).end+1);
  else if(t[i].v==='return'){
   const end=expressionEnd(t,i,py),fields=returnProperties(t.slice(i+1,end));
   const status=['status','state','kind','result','literal'].some(k=>fields[k]&&statusRx.test(fields[k]));
   const code=['code','reasonCode','reason_code','reason'].some(k=>fields[k]&&codeRx.test(fields[k]));
   const success=['true','True'].includes(fields.ok)||['status','state'].some(k=>/^(?:ok|success|passed|complete|completed)$/i.test(fields[k]??''));
   if(!success&&(status||code))record(i,'return-status',end);
  }
 }
 // Bounded same-file throw/raise wrappers. No transitive flow, imported helper or alias guessing.
 const helpers=[];
 for(const f of funcs){
  const stops=sites.filter(s=>s._scope===f&&['throw','raise'].includes(s.kind));
  const ft=t.slice(f.start,f.end);
  if(stops.length!==1||ft.some(x=>['if','try','catch','except','return'].includes(x.v)))continue;
  const s=stops[0],params=f.params.map(p=>p.name),codeIndex=ft.findIndex((x,n)=>x.v==='code'&&ft[n+1]?.v===':'&&params.includes(ft[n+2]?.v)),codeParam=codeIndex>=0?ft[codeIndex+2].v:params.includes('code')?'code':null;
  s.internalGuard=true;s.helperDefinition=true;
  helpers.push({name:f.name,line:f.line,definition:f.nameAt,reasonCode:s.reasonCode,message:s.message,params,codeParam});
 }
 for(let i=0;i<t.length-1;i++)if(t[i].kind==='name'&&t[i+1].v==='('&&!['.','function','def','new'].includes(t[i-1]?.v)){
  const found=helpers.filter(h=>h.name===t[i].v&&h.definition!==i);
  if(found.length===1&&!sites.some(s=>s._at===i))record(i,'throw-helper',callArgs(t,i+1).end+1,found[0]);
 }
 return sites.sort((a,b)=>a.line-b.line||a.column-b.column).map(({_at,_scope,...s})=>s);
}
function splitCategories(s){
 let depth=0,at=0,out=[];
 for(let i=0;i<s.length;i++){if('('.includes(s[i]))depth++;if(')'.includes(s[i]))depth--;if(!depth&&/[,;\u3001\uff1b]/.test(s[i])){out.push(s.slice(at,i));at=i+1;}}
 out.push(s.slice(at));return out.map(x=>x.trim().replace(/^(?:and\s+|\u4ee5\u53ca|\u8207)/i,'').replace(/[.\u3002]\s*$/,'')).filter(Boolean);
}
export function readStopPolicy(config={},read){
 const ref=config.policy;if(!ref)return {status:'ABSENT',categories:[],mappings:[],repairable:{},missing:['NO_DECLARATION']};
 const file=typeof ref==='string'?ref:ref.file,body=String(read(file));
 if(ref.sha256&&ref.sha256!==sha256(body))throw Error('STOP_POLICY_INTEGRITY');
 let categories=[],mappings=config.mappings??[],repairable=config.repairable??{};
 if(/\.json$/i.test(file)){
  const value=JSON.parse(body);mappings=[...(value.mappings??[]),...mappings];repairable={reasonCodes:unique([...(value.repairable?.reasonCodes??[]),...(repairable.reasonCodes??[])]),keywords:unique([...(value.repairable?.keywords??[]),...(repairable.keywords??[])])};
  categories=(value.categories??[]).map(c=>{
   if(!c.id||!c.anchor?.file||!Number.isInteger(c.anchor.line)||!c.anchor.expect)throw Error('STOP_POLICY_ANCHOR_REQUIRED');
   const source=String(read(c.anchor.file)),line=source.split(/\r?\n/)[c.anchor.line-1];if(!line?.includes(c.anchor.expect))throw Error('STOP_POLICY_ANCHOR_MISMATCH');
   return {...c,label:c.label??c.id,anchor:anchor(c.anchor.file,c.anchor.line,line),sourceSha256:sha256(source)};
  });
 }else{
  body.split(/\r?\n/).forEach((line,i)=>{
   const m=line.match(/(?:hard[ -]block\s+only|allowed\s+hard[ -]blocks?|\u5141\u8a31\u786c\u64cb(?:\u985e\u5225)?|\u786c\u64cb\u50c5\u9650)\s*[:\uff1a]\s*(.+)/i);
   if(m)for(const label of splitCategories(m[1].split(/\.\s+[A-Z]/)[0]))categories.push({id:label,label,anchor:anchor(file,i+1,line),sourceSha256:sha256(body)});
  });
 }
 for(const m of mappings)if(!categories.some(c=>c.id===m.category))throw Error('STOP_POLICY_MAPPING_CATEGORY');
 return {status:categories.length?'DECLARED':'ABSENT',file,sha256:sha256(body),categories,mappings,repairable,missing:categories.length?[]:['NO_DECLARATION'],sourceReads:[{file,sha256:sha256(body)},...categories.map(c=>({file:c.anchor.file,sha256:c.sourceSha256}))]};
}
function categoryMatches(site,policy){
 const text=[site.reasonCode,site.message,site.condition].filter(Boolean).join(' '),n=norm(text);
 return policy.categories.filter(c=>{
  const rules=policy.mappings.filter(m=>m.category===c.id);
  if(rules.some(m=>(m.reasonCodes??[]).includes(site.reasonCode)||matching(text,m.keywords).length))return true;
  const phrase=c.label.split('(')[0].trim(),ws=words(phrase).filter(w=>!['at','the','and','or','a','an','only'].includes(w));
  return ws.length>0&&ws.every(w=>n.includes(stem(w)));
 });
}
export function compareStopSites({root,files=[],config={},read=file=>readBounded(root,file).toString('utf8'),routes=[],water={runs:[]}}){
 const policy=readStopPolicy(config,read),sourceReads=[...(policy.sourceReads??[])],readFailures=[],sites=[];
 for(const file of unique(files).filter(codeFile).sort()){
  let body;try{body=String(read(file));}catch(e){readFailures.push({file,reason:e.message});continue;}
  sourceReads.push({file,sha256:sha256(body)});
  for(const s of scanStopSites(file,body,config)){
   const productionRoutes=routes.filter(c=>c.role!=='tests'&&(c.files??[]).includes(file)).map(c=>c.root);
   const observations=(water.runs??[]).filter(r=>r.sourceBound&&(r.executedSites??[]).some(p=>p.file===file&&p.line===s.line));
   const reach={static:productionRoutes.length?'FILE_REACHABLE':'UNKNOWN',routes:unique(productionRoutes),siteObserved:observations.length>0,observations:observations.map(o=>({id:o.id,source:o.source})),basis:'File closure is an upper bound; only bound line evidence observes a site. Neither proves the stop branch was taken.'};
   const baseline=categoryMatches(s,policy),repairText=[s.reasonCode,s.message,s.condition].filter(Boolean).join(' '),repairCodes=policy.repairable?.reasonCodes??[];
   const repair=repairCodes.includes(s.reasonCode)||matching(repairText,policy.repairable?.keywords).length>0||/\b(?:input|format|schema|malformed)\b|\b(?:missing|required|invalid)\s+(?:field|data|argument|parameter)\b|\u683c\u5f0f|\u8f38\u5165/.test(words(repairText).join(' '));
   let classification='uncertain',reason='NO_CLASSIFICATION_EVIDENCE',missing=[];
   if(policy.status==='ABSENT'){reason='NO_DECLARATION';missing.push('No declaration to compare; inventory only.');}
   else if(s.scope.private||s.internalGuard){reason='INTERNAL_GUARD';missing.push('Caller contract and evidence that this is a user-facing refusal, rather than a private/type invariant.');}
   else if(s.catchBoundary){reason='CATCH_BOUNDARY_UNKNOWN';missing.push('Read the exception handler and caller propagation; this throw may be recovered before reaching an entry boundary.');}
   else if(s.mixedCondition||baseline.length>1||baseline.length&&repair){reason='MIXED_CONDITION';missing.push('Separate the triggering subcondition and its lifecycle/boundary; mixed conditions cannot be judged as one stop.');}
   else if(baseline.length===1){classification='baseline';reason='DECLARED_CATEGORY_MATCH';}
   else if(repair&&(productionRoutes.length||observations.length)){classification='needs-attention';reason='REPAIRABLE_REACHABLE_STOP';}
   else {reason=repair?'ROUTE_EVIDENCE_MISSING':'SEMANTIC_EVIDENCE_MISSING';missing.push(repair?'Production closure or source-bound site observation.':'Declared category mapping, caller context and the actual triggering condition.');}
   const verification=(water.runs??[]).filter(r=>r.sourceBound).flatMap(r=>(r.perTest??[]).filter(t=>t.coveredFiles?.includes(file)).map(t=>({command:t.command,file:t.file,source:'bound-test'})));
   for(const v of config.verificationCommands??[])if(v.file===file&&Array.isArray(v.command)&&v.command.length&&v.command.every(a=>typeof a==='string'))verification.push({...v,source:'configured-unexecuted',status:'NOT_EXECUTED'});
   sites.push({...s,classification,label:stopLabels[classification],reason,missing,reach,declarationAnchors:classification==='baseline'?baseline.map(c=>({category:c.id,...c.anchor})):[],candidateCategories:baseline.map(c=>c.id),repairDirection:classification==='needs-attention'?'\u6539\u6210 finding\u3001\u88dc\u8cc7\u6599\uff0c\u6216\u964d\u7d1a\u4ea4\u4ed8\u4e26\u8a18\u9304\u9650\u5236\uff1b\u4fdd\u7559\u5ba3\u544a\u5e95\u7dda\u3002':null,verification,comparisonCommands:config.comparisonCommands??[],verificationMethod:'Exercise this exact stop with repairable input and a declared hard-block counterexample; rerun the affected entry tests. A static re-scan checks classification, not corrected runtime behavior.',verificationMissing:verification.length?[]:['No source-bound test command; supply an affected-entry test/scenario command.']});
  }
 }
 const groups=new Map();
 for(const s of sites){const cause=s.reasonCode??norm(s.message??s.snippet),key=JSON.stringify([s.file,cause,s.classification]);if(!groups.has(key))groups.set(key,{id:'stop-repair-'+sha256(key).slice(0,16),file:s.file,reasonCode:s.reasonCode,cause,classification:s.classification,label:s.label,sites:[]});groups.get(key).sites.push(s);}
 return {schema:'stop-site-comparison-v1',status:readFailures.length?'UNKNOWN':'PASS',declarationCheck:true,inventoryOnly:policy.status==='ABSENT',policy,counts:Object.fromEntries(Object.keys(stopLabels).map(c=>[c,sites.filter(s=>s.classification===c).length])),sites,groups:[...groups.values()],readFailures,sourceReads:[...new Map(sourceReads.map(s=>[s.file,s])).values()],limits:['Lexical JS/TS/Python candidates, not a complete AST or interprocedural proof.','Only one-hop same-file throw helpers; imported, aliased and computed refusals may be missed.','Internal/type guards and mixed conditions remain uncertain. No reason code reduces matching accuracy.','No declaration means inventory only. Labels are diagnostic suggestions; no decisions or broken counts are inferred.']};
}
const diagnosticReasons={"NO_DECLARATION":"沒有宣告可對照；僅列出候選，不判對錯。","INTERNAL_GUARD":"可能是內部或型別防呆；需核對呼叫端合約。","CATCH_BOUNDARY_UNKNOWN":"例外可能被接住；需核對處理器及向外傳播的結果。","MIXED_CONDITION":"混合條件或多個宣告類別，無法整站安全判定。","DECLARED_CATEGORY_MATCH":"單一宣告類別吻合，請核對所附政策原文與實際觸發條件。","REPAIRABLE_REACHABLE_STOP":"正式路線可達的輸入或格式問題，卻直接拒絕；建議修復或降級交付。","ROUTE_EVIDENCE_MISSING":"可修復問題候選，但缺少正式路線或站點觀測。","SEMANTIC_EVIDENCE_MISSING":"缺少宣告類別對照及實際觸發條件的證據。"};
export function stopMaintenanceItems(comparison){
 return (comparison?.groups??[]).map(g=>{
  const s=g.sites[0],mark=g.classification==='needs-attention'?'handling':g.classification==='baseline'?'fine':'unsure',observed=g.sites.flatMap(s=>s.reach.observations),execution=observed.some(o=>o.source==='agent-api')?'ran':observed.length?'tests':'read';
  return {id:g.id,kind:'stop-site-comparison',mark,label:g.label,count:g.sites.length,title:'\u5ba3\u544a\u5c0d\u7167\uff1a\u963b\u64cb\u9ede',reason:diagnosticReasons[s.reason]??s.reason,cause:{category:'stop-site',file:g.file,line:s.line},locations:g.sites.map(s=>({file:s.file,line:s.line,symbol:s.symbol,snippetSha256:s.snippetSha256})),targets:[],items:g.sites,anchors:g.sites.map(s=>({...s.anchor,status:'PASS'})),anchorStatus:'PASS',demotions:[],missing:unique(g.sites.flatMap(s=>[...(s.missing.length?[diagnosticReasons[s.reason]]:[]),...(s.verificationMissing.length?['\u7f3a\u53d7\u5f71\u97ff\u5165\u53e3\u7684\u6e2c\u8a66\u6216\u60c5\u5883\u9a57\u8b49\u6307\u4ee4']:[])])).join(' '),execution,executionLabel:execution==='ran'?'\u8dd1\u904e':execution==='tests'?'\u53ea\u6709\u6e2c\u8a66\u8dd1\u904e':'\u53ea\u8b80\u904e\u7a0b\u5f0f',observations:observed,fixes:g.sites.filter(s=>s.repairDirection).map(s=>({...s.anchor,change:s.repairDirection})),verification:g.sites.flatMap(s=>s.verification).concat([...new Map(g.sites.flatMap(s=>s.comparisonCommands).map(command=>[JSON.stringify(command),{file:g.file,command,source:'comparison-rescan',status:'NOT_EXECUTED'}])).values()]),verificationMethod:s.verificationMethod,uncoveredFiles:g.sites.some(s=>!s.verification.length)?[g.file]:[],references:[],affectedRoutes:unique(g.sites.flatMap(s=>s.reach.routes)),stopComparison:g};
 });
}
export function renderStopComparison(c,id='stop-site-comparison'){
 if(!c)return '';
 return '<section id="'+esc(id)+'"><h2>\u5ba3\u544a\u5c0d\u7167\uff1a\u963b\u64cb\u9ede</h2><p>'+(c.inventoryOnly?'\u6c92\u6709\u5ba3\u544a\u53ef\u5c0d\u7167\uff1b\u53ea\u5217\u6e05\u55ae\u3002':Object.entries(c.counts).map(([k,v])=>esc(stopLabels[k])+' '+v).join(' / '))+'</p><p>\u975c\u614b\u9589\u5305\u53ea\u662f\u6a94\u6848\u53ef\u9054\u4e0a\u754c\uff0c\u4e0d\u4ee3\u8868\u7ad9\u9ede\u5df2\u7d93\u57f7\u884c\u3002</p>'+c.sites.map(s=>'<details><summary>'+esc(s.label)+' '+esc(s.locator)+':'+s.line+'</summary><p>'+esc(s.reason)+' '+esc(s.missing.join(' '))+'</p><pre>'+esc(JSON.stringify({anchor:s.anchor,reasonCode:s.reasonCode,message:s.message,reach:s.reach,declarationAnchors:s.declarationAnchors,repairDirection:s.repairDirection,verification:s.verification,comparisonCommands:s.comparisonCommands,verificationMissing:s.verificationMissing},null,2))+'</pre></details>').join('')+'</section>';
}
