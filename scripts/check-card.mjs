import {displayGroups,renderGroups,renderGroupsMarkdown,preview} from './display-groups.mjs';
import {compareStopSites,renderStopComparison} from './stop-sites.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {hash,anchor,canonical} from './cassette.mjs';
import {writeUTF8} from './report.mjs';
const esc=s=>String(s??'UNKNOWN').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function compareDeclarations(root,items=[]){
 return items.map(item=>{
  const sides={};
  for(const name of ['declared','implemented']){
   const side=item[name];
   if(!side){sides[name]={status:'UNKNOWN',reason:'MISSING_SIDE'};continue;}
   const checked=anchor(root,side.anchor);
   if(checked.status!=='PASS'){sides[name]={...side,status:'UNKNOWN',anchor:checked};continue;}
   if(side.absent){
    if(!side.search?.files?.length||!side.search.pattern){sides[name]={...side,status:'UNKNOWN',reason:'SEARCH_SCOPE_REQUIRED'};continue;}
    const scope=side.search.files.map(a=>anchor(root,a)),hits=[];
    if(scope.some(a=>a.status!=='PASS')){sides[name]={...side,status:'UNKNOWN',scope};continue;}
    for(const a of scope){const body=fs.readFileSync(path.resolve(root,a.file),'utf8');for(const [i,line] of body.split(/\r?\n/).entries())if(new RegExp(side.search.pattern).test(line))hits.push({file:a.file,line:i+1});}
    sides[name]={...side,anchor:checked,scope,hits,status:hits.length?'UNKNOWN':'PASS'};
   }else sides[name]={...side,anchor:checked,status:'PASS'};
  }
  let category='UNKNOWN',status='UNKNOWN';
  if(Object.values(sides).every(s=>s.status==='PASS')){
   const d=sides.declared,i=sides.implemented;
   if(!d.absent&&i.absent)category='SAID_NOT_DONE';
   else if(d.absent&&!i.absent)category='DONE_NOT_SAID';
   else if(!d.absent&&!i.absent&&item.kind==='sequence'&&canonical(d.value)!==canonical(i.value))category='FLOW_MISMATCH';
   else category=canonical(d.value)===canonical(i.value)?'MATCH':'VALUE_MISMATCH';
   status=['MATCH'].includes(category)?'PASS':'FAIL';
  }
  return {id:item.id,description:item.description??'',kind:item.kind??'capability',status,category,...sides,
   basis:'Anchors and disclosed absence searches checked mechanically; semantic extraction remains an attributed agent interpretation.'};
 });
}
export function buildCard(c,options={}){
 const allowed=['entries','inputs','outputs','sideEffects','cost','tools','runnability'];
 const fields=Object.fromEntries(allowed.map(k=>[k,c[k]??{status:'UNKNOWN'}]));
 const scenarios=c.water?.results??[];
 const cleanupUnknown=scenarios.length>0&&scenarios.some(r=>r.status==='UNKNOWN')&&scenarios.every(r=>r.status==='PASS'||r.status==='UNKNOWN'&&r.verdict?.status==='PASS'&&r.cassetteComplete===true&&r.cleanup?.status!=='PASS'&&r.cleanup?.status!=='FAIL');
 if(scenarios.some(r=>r.status==='FAIL'||r.cleanup?.status==='FAIL'))fields.runnability={...fields.runnability,status:'FAIL'};
 if(cleanupUnknown&&fields.runnability.status!=='FAIL')fields.runnability={...fields.runnability,status:'UNKNOWN',cleanupUnverified:true,description:'\u60c5\u5883\u901a\u904e\uff0c\u7a0b\u5e8f\u6e05\u7406\u7121\u6cd5\u5728\u6b64\u5e73\u53f0\u6838\u5c0d'};
 const walk=x=>{if(!x||typeof x!=='object')return;for(const k of Object.keys(x)){if(/^(?:deploymentId|operation|entryId|pathId|profileId|organizationId|instanceId|selector)$/i.test(k))throw Error('NON_GENERIC_CARD_FIELD '+k);walk(x[k]);}};walk(fields);
 return {schema:'check-card-v1',title:c.title??'Repository check',...fields,declarations:compareDeclarations(c.root,c.declarations),
  ...(c.stopSites?{stopSites:compareStopSites({root:c.root,files:c.stopSites.files??[],config:c.stopSites,read:options.read,routes:c.stopSites.routes??[],water:c.maintenanceWater})}:{}),
  evidenceLevel:c.water?.evidenceLevel??'STATIC_ONLY',waterSource:c.water?.source??'none',coveredFiles:c.water?.coveredFiles??[],additionalFlowFiles:c.water?.additionalFlowFiles??0,
  removalTrials:c.removalTrials??[],limits:c.limits??[],boundaries:{instrument:'API hooks, not an operating-system sandbox',python:'Python audit cannot rewrite child argv; child coverage may be incomplete',paidCalls:'Stand-ins only; never live',network:'Denied during execution',credentials:'Removed from child environment',externalActions:'Deployment, publishing, mail and production writes are forbidden'},
  evidence:c.evidence??[],extractionBasis:'Agent-read source with explicit anchors; coverage is observation, not business acceptance'};
}
const labels={entries:'入口',inputs:'輸入',outputs:'輸出',sideEffects:'副作用',cost:'會不會花錢',tools:'需要的工具',runnability:'能不能跑',declarations:'宣告對照',removalTrials:'拆除試驗',limits:'限制',boundaries:'邊界'};
const levels={STATIC_ONLY:'只有靜態',TEST_EXECUTED:'測試跑過',AGENT_DRIVEN_STUBBED:'情境試跑（外部服務用替身）',REAL_USE:'真實使用'};
export function renderCardMarkdown(c){
 const lines=['# '+c.title+'：體檢卡','','證據等級：'+(levels[c.evidenceLevel]??c.evidenceLevel)+'；觀測到 '+c.coveredFiles.length+' 個檔案，比只讀原碼多 '+c.additionalFlowFiles+' 個實跑檔案。','','儀器是在程式的 API 上掛記錄器，不是作業系統沙盒。Python 記錄器不能改寫子程序參數；該部分可能缺少覆蓋。',''];
 for(const [key,label] of Object.entries(labels).filter(([key])=>key!=='declarations')){lines.push('## '+label,'','~~~json',JSON.stringify(preview(c[key]),null,2),'~~~','');}
 lines.push(renderGroupsMarkdown(displayGroups(c.declarations),{json:'check-card.json'}));
 if(c.stopSites)lines.push('## \u963b\u64cb\u9ede\u5c0d\u7167','',renderGroupsMarkdown(displayGroups(c.stopSites.sites),{json:'check-card.json'}));
 return lines.join('\n');
}
export function renderCardSection(c){
 const state={PASS:'所列情境通過',FAIL:'所列情境有未通過項目',UNKNOWN:'仍缺證據'};
 const summaries={entries:'入口與參數格式請展開查看；未確認的入口保持未知。',inputs:c.inputs.summary??c.inputs.description??'輸入格式仍待確認。',outputs:c.outputs.summary??c.outputs.description??'輸出與位置仍待確認。',sideEffects:c.sideEffects.description??'程序、網路及寫入需依本次紀錄判讀。',cost:'本次只准使用替身；未執行的外部服務費用仍未知。',tools:'工具版本與檔案指紋請展開查看。',runnability:(c.runnability.cleanupUnverified?c.runnability.description:state[c.runnability.status])??'仍缺證據',declarations:'已核對 '+c.declarations.length+' 條宣告；其中 '+c.declarations.filter(d=>d.status==='FAIL').length+' 條不一致，'+c.declarations.filter(d=>d.status==='UNKNOWN').length+' 條缺證據。',removalTrials:c.removalTrials.length?'各候選結果列於下方。':'本次沒有執行拆除試驗。',limits:'覆蓋僅表示路徑曾執行，不表示所有功能均正確。',boundaries:'網路預設拒絕、移除金鑰、禁止真實付費與部署。'};
 const candidateRows=c.removalTrials.flatMap(t=>t.candidates??[t]).slice(0,3).map(t=>'<p>'+esc(t.path??t.id??'候選')+'：'+esc(t.status??'UNKNOWN')+'</p>').join('');
 const sections=Object.entries(labels).filter(([k])=>k!=='declarations').map(([k,l])=>'<div><h3>'+l+'</h3><p>'+esc(summaries[k])+'</p>'+(k==='removalTrials'?candidateRows:'')+'<details><summary>查看依據</summary><pre>'+esc(JSON.stringify(preview(c[k]),null,2))+'</pre></details></div>').join('');
 return '<section id="check-card"><style>#check-card{font-family:system-ui;line-height:1.6;margin:16px auto;max-width:900px;padding:16px;box-sizing:border-box;color:var(--fg,#202632);background:var(--card,#fff);border:1px solid #7b8494;border-radius:12px}#check-card a{color:inherit;text-decoration:underline}#check-card pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}#check-card summary{font-weight:700;padding:12px 0}#check-card details{border-top:1px solid #7b8494}#check-card p{overflow-wrap:anywhere}@media(prefers-color-scheme:dark){#check-card{color:#e8edf4;background:#151c28}}</style><h2>體檢卡</h2><details><summary>受查對象</summary><p>'+esc(c.title)+'</p></details><p>證據等級：'+esc(levels[c.evidenceLevel]??c.evidenceLevel)+'。觀測 '+c.coveredFiles.length+' 個檔案；比靜態多 '+c.additionalFlowFiles+' 個實跑檔案。</p><p>記錄器只在程式介面上掛勾，不是作業系統沙盒。部分子程序參數不能改寫，覆蓋可能不完整。</p>'+sections+renderGroups(displayGroups(c.declarations),{json:'check-card.json'})+renderStopComparison(c.stopSites,'card-stop-site-comparison')+'</section>';
}
export function writeCard(c,out,healthFile){
 const card=buildCard(c);fs.mkdirSync(out,{recursive:true});const receipts=[];
 receipts.push(writeUTF8(path.join(out,'check-card.json'),JSON.stringify(card,null,2)+'\n'),writeUTF8(path.join(out,'check-card.md'),renderCardMarkdown(card)));
 const section=renderCardSection(card);
 const html=healthFile?fs.readFileSync(healthFile,'utf8').replace('</body>',section+'</body>'):'<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(card.title)+'</title><body>'+section+'</body></html>';
 if(healthFile&&!html.includes(section))throw Error('HEALTH_BODY_REQUIRED');
 receipts.push(writeUTF8(path.join(out,'health.html'),html));writeUTF8(path.join(out,'check-card-receipt.json'),JSON.stringify(receipts,null,2)+'\n');return card;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.length===3&&process.argv[2]==='--help'){console.log('Usage: node check-card.mjs --config file');process.exit(0);}
 try{const a=process.argv.slice(2);if(a.length!==2||a[0]!=='--config')throw Error('Use --help');const c=JSON.parse(fs.readFileSync(a[a.indexOf('--config')+1],'utf8'));console.log(JSON.stringify(writeCard(c,c.outDir,c.healthFile)));}catch(e){console.error(e.stack);process.exitCode=1;}
}
