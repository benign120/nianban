'use strict';
const cloudbase=require('@cloudbase/node-sdk');
const {initialize,dispatch}=require('./core.cjs');
const app=cloudbase.init({env:cloudbase.SYMBOL_CURRENT_ENV});
const db=app.database();
exports.main=async event=>{
  const headers={};for(const [k,v]of Object.entries(event.headers||{}))headers[k.toLowerCase()]=v;
  const reply=(statusCode,value)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(value),isBase64Encoded:false});
  if(event.httpMethod!=='POST')return reply(405,{error:'只支持 POST 请求'});
  if(!String(headers['content-type']||'').startsWith('application/json'))return reply(415,{error:'请求格式无效'});
  try{
    const body=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):event.body||'';
    if(typeof body!=='string'||Buffer.byteLength(body)>64000)return reply(413,{error:'请求过长'});
    let input;try{input=JSON.parse(body);}catch{return reply(400,{error:'请求格式无效'});}
    const auth=String(headers.authorization||'').replace(/^Bearer /,'');
    const result=await db.runTransaction(async tx=>{
      const ref=tx.collection('nianban_buddy').doc('private_state');const stored=await ref.get();
      if(stored.code)throw new Error('Database read failed');
      // CloudBase transactional doc.get returns an object; older SDK versions use an array.
      const row=Array.isArray(stored.data)?stored.data[0]:stored.data;
      const state=row?.payload||initialize();
      const value=dispatch(state,input,auth,Date.now(),event.requestContext?.sourceIp||'gateway');
      if(Buffer.byteLength(JSON.stringify(state))>750000){const e=new Error('内测空间已满，请联系维护者');e.status=429;throw e;}
      const written=await ref.set({payload:state});if(written.code)throw new Error('Database write failed');return value;
    });
    return reply(200,{data:result});
  }catch(e){return reply(e.status||503,{error:e.status?e.message:'同步服务暂不可用，请稍后重试'});}
};
