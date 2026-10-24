import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import {Writable,Readable} from 'node:stream';
import {syncBuiltinESMExports} from 'node:module';
import {requestKey,validateCassette} from './cassette.mjs';
export function installCassette(c,emit){
 const cassette=c.cassette?validateCassette(c.cassette):null;
 const read=fs.readFileSync.bind(fs),write=fs.writeFileSync.bind(fs),open=fs.openSync.bind(fs),close=fs.closeSync.bind(fs),unlink=fs.unlinkSync.bind(fs);
 const state=c.cassetteState;
 function consume(kind,request){
  const key=requestKey(kind,request);let lock,index=0;
  if(!cassette){emit({kind:'cassette',decision:'DENY',requestKind:kind,key});throw Error('BOUNDARY_DENIED '+kind);}
  try{
   lock=open(state+'.lock','wx');
   try{index=JSON.parse(read(state,'utf8')).index;}catch(e){if(e.code!=='ENOENT')throw e;}
   const row=cassette.calls[index];
   if(!row||row.kind!==kind||row.key!==key){emit({kind:'cassette',decision:'DENY',phase:'mismatch',index,requestKind:kind,key});throw Error('CASSETTE_ORDER_MISMATCH '+index);}
   write(state,JSON.stringify({index:index+1}));
   emit({kind:'cassette',decision:'ALLOW',phase:'success',index,requestKind:kind,key,source:row.source,request:row.request,response:row.response,paid:row.paid===true,live:false});
   return row.response;
  }finally{if(lock!==undefined){close(lock);unlink(state+'.lock');}}
 }
 const httpRequest=(input,options={})=>{
  const u=typeof input==='string'||input instanceof URL?new URL(input):new URL((input.protocol??'http:')+'//'+(input.hostname??input.host??'localhost')+(input.port?':'+input.port:'')+(input.path??'/'));
  return {url:u.href,method:String(options.method??input?.method??'GET').toUpperCase(),body:options.body==null?'':String(options.body)};
 };
 globalThis.fetch=async(input,options={})=>{
  let req;
  if(input instanceof Request)req={url:input.url,method:options.method??input.method,body:options.body??(input.method==='GET'||input.method==='HEAD'?'':await input.clone().text())};
  else req=httpRequest(input,options);
  const r=consume('http',req);return new Response(r.body??'',{status:r.status??200,headers:r.headers??{}});
 };
 for(const [module,protocol] of [[http,'http:'],[https,'https:']]){
  module.request=(input,options,callback)=>{
   if(typeof options==='function'){callback=options;options={};}
   if(!(typeof input==='string'||input instanceof URL))input={protocol,...input};
   const req=httpRequest(input,options),chunks=[];
   const w=new Writable({write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done();}});
   if(callback)w.on('response',callback);
   w.setHeader=()=>w;w.getHeader=()=>undefined;w.removeHeader=()=>{};w.setTimeout=()=>w;w.abort=()=>w.destroy();
   w.on('finish',()=>{try{req.body=Buffer.concat(chunks).toString();const r=consume('http',req),res=Readable.from([r.body??'']);res.statusCode=r.status??200;res.headers=r.headers??{};w.emit('response',res);}catch(e){w.destroy(e);}});
   return w;
  };
  module.get=(...args)=>{const r=module.request(...args);r.end();return r;};
 }
 globalThis[Symbol.for('trace.modelStub')]=(provider,method,input)=>consume('model-sdk',{provider,method,input});
 syncBuiltinESMExports();
 return {consume,hasSubprocess:(exe,argv)=>cassette?.calls.some(r=>r.kind==='subprocess'&&r.key===requestKey('subprocess',{executable:exe,argv}))??false};
}
export const modelStub=(provider,method,input)=>{
 const fn=globalThis[Symbol.for('trace.modelStub')];if(!fn)throw Error('MODEL_STAND_IN_NOT_INSTALLED');return fn(provider,method,input);
};
