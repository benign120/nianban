import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes,X509Certificate } from 'node:crypto';
import { interfaces } from '../weixin/lan.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'.local/weixin');fs.mkdirSync(dir,{recursive:true,mode:0o700});
const addresses=interfaces().map(r=>r.address).sort();
if(!addresses.length)throw Error('没有找到可用的局域网 IPv4 地址，请先连接 Wi-Fi 或有线网络');
const file=path.join(dir,'lan-certificate.json');
let config;try{config=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
let reuse=false;try{const cert=new X509Certificate(fs.readFileSync(path.join(dir,config.certificate)));reuse=JSON.stringify(config.addresses)===JSON.stringify(addresses)&&Date.parse(cert.validTo)>Date.now()+30*86400000&&fs.existsSync(path.join(dir,config.pfx));}catch{}
if(!reuse){
  const id=Date.now().toString(36),pfx=`lan-${id}.p12`,certificate=`lan-${id}.der`,password=randomBytes(32).toString('hex');
  const keytool=process.platform==='win32'?'C:/JAVA/bin/keytool.exe':'keytool';
  const env={...process.env,NIANBAN_LAN_CERT_PASSWORD:password};
  const run=args=>{const r=spawnSync(keytool,args,{env,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error('无法准备本机加密证书，未启动局域网同步');};
  run(['-genkeypair','-noprompt','-alias','nianban-lan','-keyalg','RSA','-keysize','2048','-validity','825','-dname','CN=Nianban LAN','-ext','SAN=ip:127.0.0.1,dns:localhost,'+addresses.map(ip=>'ip:'+ip).join(','),'-keystore',path.join(dir,pfx),'-storetype','PKCS12','-storepass:env','NIANBAN_LAN_CERT_PASSWORD']);
  run(['-exportcert','-alias','nianban-lan','-keystore',path.join(dir,pfx),'-storetype','PKCS12','-storepass:env','NIANBAN_LAN_CERT_PASSWORD','-file',path.join(dir,certificate)]);
  config={addresses,pfx,certificate,password,createdAt:new Date().toISOString()};
  fs.writeFileSync(file,JSON.stringify(config,null,2),{mode:0o600});
}
console.log(JSON.stringify({ready:true,certificateReused:reuse,addresses,port:8793}));
