// Shared, advisory UNKNOWN review. Never changes an evidence verdict.
export const unknownClasses=['not-run','model-choice','one-off','evidence-lost','owner-only','out-of-scope'];
const filled=x=>typeof x==='string'&&x.trim().length>0;
export function reviewUnknowns(items=[]){
 const rows=items.map((item,index)=>{
  const row=typeof item==='string'?{question:item}:item??{},flags=[];
  if(!filled(row.class)||!filled(row.cause))flags.push('未交代原因');
  if(filled(row.class)&&!unknownClasses.includes(row.class))flags.push('UNKNOWN_CLASS_INVALID');
  const affects=['yes','no','unsure'].includes(row.affects)?row.affects:'unsure';
  if(filled(row.affects)&&!['yes','no','unsure'].includes(row.affects))flags.push('UNKNOWN_AFFECTS_INVALID');
  if(affects!=='no'&&row.class==='not-run'&&['免費讀取','隔離試跑'].includes(row.next?.cost))flags.push('應先補做');
  const missing=(affects==='no'?['class','cause','understanding']:['class','cause','tried','understanding']).filter(k=>!filled(row[k]));
  if(!filled(row.affects))missing.push('affects');
  if(affects!=='no'&&(!filled(row.next?.action)||!filled(row.next?.cost)))missing.push('next');
  return {...row,index,flags,missing};
 });
 return {items:rows,counts:{total:rows.length,affecting:rows.filter(r=>r.affects!=='no').length,recordOnly:rows.filter(r=>r.affects==='no').length,unexplained:rows.filter(r=>r.flags.includes('未交代原因')).length,
  shouldDoFirst:rows.filter(r=>r.flags.includes('應先補做')).length,invalidClass:rows.filter(r=>r.flags.includes('UNKNOWN_CLASS_INVALID')).length,incomplete:rows.filter(r=>r.missing.length).length}};
}
export function collectUnknowns(value){
 const rows=[];
 function visit(x,location){
  if(!x||typeof x!=='object')return;
  if(x.status==='UNKNOWN'){rows.push({location,...x});return;}
  for(const [k,v] of Object.entries(x)){
   if(k==='unknowns'&&Array.isArray(v))rows.push(...v.map((r,i)=>({location:location+'.unknowns['+i+']',...(typeof r==='string'?{question:r}:r)})));
   else visit(v,location+'.'+k);
  }
 }
 visit(value,'card');return reviewUnknowns(rows);
}
// Rendered text is read by people: no field names, class codes or JSON here.
// Machine-readable values stay in the card JSON.
const fieldLabels={affects:'會不會改變本題結論',class:'類別',cause:'原因',tried:'試過',next:'下一步',understanding:'目前最好的解釋'};
const classLabels={'not-run':'沒去跑','model-choice':'由模型決定','one-off':'單次異常','evidence-lost':'資料沒了','owner-only':'要負責人判斷','out-of-scope':'範圍或授權外'};
const placeLabels={entries:'入口',inputs:'輸入',outputs:'輸出',sideEffects:'副作用',cost:'費用',tools:'工具',runnability:'能否執行',declarations:'宣告對照',water:'執行證據',evidence:'證據',limits:'限制',unknowns:'未知清單'};
const flagLabels={UNKNOWN_CLASS_INVALID:'類別無效',UNKNOWN_AFFECTS_INVALID:'是否影響結論的選項無效'};
function placeLabel(location){
 const part=String(location??'').split('.')[1]?.replace(/\[\d+\]$/,'');
 return placeLabels[part]?'卡片的「'+placeLabels[part]+'」':'卡片的其他欄位';
}
function fieldText(r,k){
 if(k==='affects')return {yes:'會',no:'不會',unsure:'不確定'}[r.affects]??'不確定';
 if(k==='class')return filled(r.class)?(classLabels[r.class]??'類別無效'):'未填';
 if(k==='next')return filled(r.next?.action)?r.next.action+(filled(r.next.cost)?'（'+r.next.cost+'）':''):'未填';
 return filled(r[k])?r[k]:'未填';
}
export function unknownSummary(review){
 const c=review.counts;return `影響結論的未知 ${c.affecting} 項（含不確定；其中應先補做 ${c.shouldDoFirst} 項）；不影響結論、僅記錄 ${c.recordOnly} 項`;
}
export function renderUnknowns(review){
 return review.items.map(r=>['- '+(r.question??placeLabel(r.location))+(r.affects==='no'?' — 僅記錄':'')+(r.flags.length?' — '+r.flags.map(f=>flagLabels[f]??f).join('、'):''),
  ...Object.keys(fieldLabels).filter(k=>r.affects!=='no'||!['tried','next'].includes(k)).map(k=>'  - '+fieldLabels[k]+'：'+fieldText(r,k)),
  ...(r.missing.length?['  - 欄位未齊：'+r.missing.map(k=>fieldLabels[k]).join('、')]:[])].join('\n')).join('\n');
}
