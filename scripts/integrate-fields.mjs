const filled=x=>typeof x==='string'&&x.trim().length>0;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const routingKeys=['consumes','produces','executionClass','maturity','avoidWhen','unknownReason'];
export const integrateFillFlags={
 '--knowhow':{key:'knowhow',format:'kind|rule|toolDetail|verification',enums:{kind:['preflight','invariant','verification','guardrail','policy']}},
 '--compat-pin':{key:'compatPins',format:'surface|target|expectation|probe',enums:{surface:['local-process','mcp','cli','http','library']}},
 '--routing':{key:'routing',enums:{executionClass:['deterministic','hybrid','unknown'],maturity:['experimental','bounded','certified','legacy','unknown']}},
};

function validate(flag,row,anchorKeys=[]){
 const {format,enums}=integrateFillFlags[flag];
 if(!object(row))throw Error('期望物件');
 const keys=format?format.split('|'):routingKeys;
 for(const key of Object.keys(row))if(!keys.includes(key)&&!anchorKeys.includes(key))throw Error('未知欄位：'+key);
 for(const [key,values] of Object.entries(enums)){
  if(!values.includes(row[key]))throw Error(key+' 無效：'+String(row[key])+'；可用：'+values.join('、'));
 }
 if(format){
  for(const key of keys)if(!filled(row[key]))throw Error(key+' 不可空白');
  return;
 }
 for(const key of ['consumes','produces','avoidWhen']){
  const a=row[key];
  if(!Array.isArray(a)||!a.every(filled)||(key==='avoidWhen'&&!a.length))throw Error(key+' 須為'+(key==='avoidWhen'?'非空':'')+'字串陣列（各項不可空白）');
 }
 if((row.executionClass==='unknown'||row.maturity==='unknown'||row.unknownReason!==undefined)&&!filled(row.unknownReason))throw Error('路由有 UNKNOWN 時須提供非空的 unknownReason');
}

export function parseIntegrateField(flag,value){
 const {format}=integrateFillFlags[flag];let row;
 if(format){
  const keys=format.split('|'),values=value.split('|').map(x=>x.trim());
  if(values.length!==keys.length||!values.every(filled))throw Error('期望 '+format+'（各欄不可空白）');
  row=Object.fromEntries(keys.map((k,i)=>[k,values[i]]));
 }else{
  try{row=JSON.parse(value);}catch{throw Error('期望 JSON 物件');}
 }
 validate(flag,row);
 return row;
}

// Used by card inspection, rendering and export, including cards authored without fill.
export function reviewIntegrateFields(integration,check){
 const fields={},issues=[];
 for(const [flag,{key,format}] of Object.entries(integrateFillFlags)){
  const value=integration?.[key];if(value===undefined)continue;
  if(format&&!Array.isArray(value)){issues.push(key+'：期望陣列');continue;}
  const rows=(format?value:[value]).map((row,i)=>{
   const location='integration.'+key+(format?'['+i+']':'');
   try{validate(flag,row,['anchor','anchors']);}catch(e){issues.push(location+'：'+e.message);return null;}
   const {anchor,anchors,...rest}=row;
   let aa=anchors??(anchor?[anchor]:[]);
   if(!Array.isArray(aa)){issues.push(location+'：anchors 須為陣列');aa=[null];}
   if(format&&!aa.length)aa=[null];
   const checked=aa.map((a,n)=>check(a,location+'.anchors['+n+']'));
   if(checked.some(a=>a.status!=='PASS'))issues.push(location+'：缺少可核對的來源錨點或錨點不符');
   return {...rest,anchors:checked};
  }).filter(Boolean);
  if(rows.length)fields[key]=format?rows:rows[0];
 }
 return {fields,issues};
}

export function integrateSections(r={}){
 const list=a=>a.length?a.join('、'):'無';
 return [
  {id:'knowhow',title:'領域知識與驗證規則',rows:(r.knowhow??[]).map(x=>({row:x,heading:x.kind,details:[['可移植規則',x.rule],['工具細節',x.toolDetail],['驗證方式',x.verification]]}))},
  {id:'compat-pins',title:'轉接介面與相容性釘選',rows:(r.compatPins??[]).map(x=>({row:x,heading:x.surface+' · '+x.target,details:[['釘選預期',x.expectation],['漂移檢查',x.probe]]}))},
  {id:'routing-boundary',title:'能力與路由邊界',rows:r.routing?[{row:r.routing,heading:r.routing.executionClass+' · '+r.routing.maturity,details:[
   ['接收',list(r.routing.consumes)],['產出',list(r.routing.produces)],['不適用時機',list(r.routing.avoidWhen)],
   ...(r.routing.unknownReason?[['UNKNOWN 原因',r.routing.unknownReason]]:[]),
   ...(!r.routing.anchors?.length?[['依據','未附來源錨點的路由建議']]:[]),
  ]}]:[]},
 ].filter(s=>s.rows.length);
}
