import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';

export const LAN_PORT=8793;
export function privateIPv4(value){
  const parts=String(value).split('.');if(parts.length!==4||parts.some(p=>!/^\d{1,3}$/.test(p)||Number(p)>255||String(Number(p))!==p))return false;
  const [a,b]=parts.map(Number);return a===10||a===172&&b>=16&&b<=31||a===192&&b===168;
}
export function interfaces(){return Object.entries(os.networkInterfaces()).flatMap(([name,rows])=>rows.filter(r=>r.family==='IPv4'&&!r.internal&&privateIPv4(r.address)).map(r=>({name,address:r.address,netmask:r.netmask}))).sort((a,b)=>Number(/本地连接\*|hotspot|virtual|vEthernet/i.test(a.name))-Number(/本地连接\*|hotspot|virtual|vEthernet/i.test(b.name))||a.address.localeCompare(b.address));}
const toNumber=s=>s.split('.').reduce((n,v)=>(n*256+Number(v))>>>0,0);
export function sameSubnet(address,local,mask){if(!privateIPv4(address)||!privateIPv4(local))return false;const m=toNumber(mask);return (toNumber(address)&m)===(toNumber(local)&m);}
export function allowPeer(address,rows=interfaces()){
  const ip=String(address||'').replace(/^::ffff:/,'');return ip==='127.0.0.1'||rows.some(row=>sameSubnet(ip,row.address,row.netmask));
}
export function loadLan(dataDir){
  try{
    const config=JSON.parse(fs.readFileSync(path.join(dataDir,'lan-certificate.json'),'utf8'));
    const cert=new X509Certificate(fs.readFileSync(path.join(dataDir,config.certificate)));
    if(Date.parse(cert.validTo)<=Date.now())throw Error('LAN certificate expired');
    const rows=interfaces().filter(r=>config.addresses.includes(r.address));
    return {config,rows,pin:cert.fingerprint256.replaceAll(':','').toLowerCase(),pfx:fs.readFileSync(path.join(dataDir,config.pfx))};
  }catch{return null;}
}
export function pairingCode(endpoint,token,pin){return 'NB1:'+Buffer.from(JSON.stringify({v:1,endpoint,token,pin}),'utf8').toString('base64url');}
export function startLan({dataDir,authorize,inbox,onSynced}){
  const lan=loadLan(dataDir);
  if(!lan||!lan.rows.length)return {server:null,info:()=>({ready:false,addresses:[],port:LAN_PORT}),pairings:()=>[]};
  let error='';
  const server=https.createServer({pfx:lan.pfx,passphrase:lan.config.password,minVersion:'TLSv1.2'},(req,res)=>{
    const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    if(!allowPeer(req.socket.remoteAddress,lan.rows))return json(403,{error:'只允许当前局域网访问'});
    let url;try{url=new URL(req.url,'https://localhost');}catch{return json(400,{error:'请求无效'});}
    if(req.method!=='GET'||url.pathname!=='/api/device/inbox')return json(404,{error:'仅开放手机同步接口'});
    if(!authorize(req))return json(401,{error:'连接码无效'});
    try{const payload=inbox(Number(url.searchParams.get('after')||0));json(200,payload);onSynced?.();}
    catch{return json(400,{error:'同步游标无效'});}
  });
  server.on('error',()=>{error='局域网同步端口暂不可用，请检查是否重复启动';});
  server.listen(LAN_PORT,'0.0.0.0');
  return {
    server,
    info:()=>({ready:server.listening&&!error,addresses:lan.rows.map(r=>({name:r.name,address:r.address,endpoint:`https://${r.address}:${LAN_PORT}`})),port:LAN_PORT,certificateCreatedAt:lan.config.createdAt,...(error?{error}:{})}),
    pairings:token=>lan.rows.map(row=>({name:row.name,address:row.address,endpoint:`https://${row.address}:${LAN_PORT}`,code:pairingCode(`https://${row.address}:${LAN_PORT}`,token,lan.pin)}))
  };
}
