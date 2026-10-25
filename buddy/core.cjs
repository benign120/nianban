'use strict';
const crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const token=()=>crypto.randomBytes(16).toString('hex');
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const dateAt=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
function validDate(v){try{return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}catch{return false;}}
function cleanTask(t,now){
  if(!t||typeof t.localId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(t.localId))fail('任务标识无效');
  const title=typeof t.title==='string'?t.title.trim():'';if(!title||title.length>100)fail('任务名称需要 1–100 字');
  const date=t.dueDate||'',time=t.dueTime||'',recurrence=t.recurrence||'none';
  if(date&&!validDate(date)||time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||time&&!date)fail('任务时间无效');
  if(!['none','daily','weekly','weekdays'].includes(recurrence)||recurrence!=='none'&&!date||recurrence==='weekly'&&(!Number.isInteger(t.weekDay)||t.weekDay<0||t.weekDay>6))fail('重复规则无效');
  if(!['todo','done'].includes(t.status)||!Array.isArray(t.completedDates)||t.completedDates.length>370)fail('打卡记录无效');
  if(t.completedDates.some(d=>!validDate(d)||d<date||d>dateAt(now)))fail('打卡日期无效');
  return {localId:t.localId,title,dueDate:date,dueTime:time,recurrence,weekDay:recurrence==='weekly'?t.weekDay:null,status:t.status,completedDates:[...new Set(t.completedDates)].sort().slice(-90)};
}
function occurs(t,date){if(!t.dueDate||date<t.dueDate)return false;const day=new Date(date+'T12:00:00Z').getUTCDay();return t.recurrence==='daily'||t.recurrence==='weekdays'&&day>=1&&day<=5||t.recurrence==='weekly'&&day===t.weekDay||t.recurrence==='none'&&t.dueDate===date;}
function done(t,date){return t.recurrence==='none'?t.status==='done':t.completedDates.includes(date);}
function initialize(){return {schema:1,users:{},requests:{},links:{},tasks:{},events:[],rates:{}};}
function active(s,u){const link=s.links[u.linkId];return link&&link.users.includes(u.id)?link:null;}
function partner(s,u){const link=active(s,u);return link?s.users[link.users.find(id=>id!==u.id)]:null;}
function unlink(s,u){const link=active(s,u);if(!link)return;for(const uid of link.users)if(s.users[uid])s.users[uid].linkId='';for(const [id,t]of Object.entries(s.tasks))if(t.linkId===link.id)delete s.tasks[id];s.events=s.events.filter(e=>e.linkId!==link.id);delete s.links[link.id];}
function snapshot(s,u,now){
  const friend=partner(s,u),link=active(s,u);
  const shares=Object.values(s.tasks).filter(t=>link&&t.linkId===link.id);
  const publicTask=t=>({...t,ownerId:t.ownerId});
  return {schema:1,serverTime:new Date(now).toISOString(),me:{id:u.id,nickname:u.nickname},linkId:link?.id||'',friend:friend?{id:friend.id,nickname:friend.nickname}:null,
    incoming:Object.values(s.requests).filter(r=>r.to===u.id&&r.expires>now).map(r=>({id:r.id,nickname:s.users[r.from]?.nickname||'搭子',expiresAt:new Date(r.expires).toISOString()})),
    outgoing:Object.values(s.requests).filter(r=>r.from===u.id&&r.expires>now).map(r=>({id:r.id,nickname:s.users[r.to]?.nickname||'搭子'})),
    ownShares:shares.filter(t=>t.ownerId===u.id).map(publicTask),friendTasks:shares.filter(t=>t.ownerId!==u.id).map(publicTask),
    events:s.events.filter(e=>e.to===u.id&&e.linkId===link?.id).slice(-30).reverse().map(e=>({id:e.id,kind:e.kind,title:e.title,from:friend?.nickname||'搭子',at:new Date(e.at).toISOString()}))};
}
function rate(s,key,now,limit,window){const r=s.rates[key];if(!r||now-r.start>=window)s.rates[key]={start:now,count:1};else if(++r.count>limit)fail('操作有些频繁，请稍后再试',429);}
/** All mutations execute under the caller's transaction. No user data or credentials are logged. */
function dispatch(s,input,auth,now=Date.now(),network='local'){
  if(!input||typeof input.action!=='string')fail('请求无效');
  if(typeof auth!=='string'||!/^[-_A-Za-z0-9]{40,100}$/.test(auth))fail('身份凭据无效，请重新连接',401);
  const userId=hash(auth),action=input.action;
  for(const [id,r]of Object.entries(s.requests))if(r.expires<now)delete s.requests[id];
  for(const [key,r]of Object.entries(s.rates))if(now-r.start>86400000)delete s.rates[key];
  s.events=s.events.filter(e=>now-e.at<7*86400000);
  let u=s.users[userId];
  if(action==='register'){
    if(!u){rate(s,'ip-'+hash(network),now,8,86400000);if(Object.keys(s.users).length>=50)fail('内测名额已满，请联系维护者',429);
      const name=typeof input.nickname==='string'?input.nickname.trim():'';if(!name||name.length>16)fail('昵称需要 1–16 字');
      u=s.users[userId]={id:userId,nickname:name,createdAt:now,linkId:''};}
    return snapshot(s,u,now);
  }
  if(!u)fail('身份已失效，请重新连接',401);
  rate(s,userId,now,60,60000);
  let extra={};
  switch(action){
    case 'snapshot':break;
    case 'invite':{
      if(active(s,u))fail('你已有一位搭子');
      const code=token();u.inviteHash=hash(code);u.inviteExpires=now+86400000;
      extra={inviteCode:code,inviteExpiresAt:new Date(u.inviteExpires).toISOString()};break;
    }
    case 'request':{
      rate(s,userId+'-invite',now,10,3600000);
      if(active(s,u))fail('请先结束当前搭子关系');
      if(typeof input.code!=='string'||!/^\w{32}$/.test(input.code))fail('请粘贴完整的 32 位邀请码');
      const to=Object.values(s.users).find(x=>x.inviteHash===hash(input.code)&&x.inviteExpires>now);
      if(!to)fail('邀请码无效或已过期');if(to.id===u.id)fail('不能添加自己');if(active(s,to))fail('对方已有搭子');
      if(Object.values(s.requests).some(r=>r.from===u.id&&r.to!==to.id))fail('已有待处理申请，可先取消');
      if(Object.values(s.requests).filter(r=>r.to===to.id).length>=5)fail('对方待处理申请较多，请稍后再试');
      const requestId=hash(u.id+':'+to.id);s.requests[requestId]={id:requestId,from:u.id,to:to.id,expires:now+86400000};break;
    }
    case 'accept':{
      const r=s.requests[input.requestId];if(!r||r.to!==u.id)fail('申请已失效');const other=s.users[r.from];
      if(!other||active(s,u)||active(s,other))fail('一方已有搭子，请刷新');const linkId=token();
      s.links[linkId]={id:linkId,users:[u.id,other.id],createdAt:now};u.linkId=other.linkId=linkId;
      delete u.inviteHash;delete other.inviteHash;
      for(const [id,v]of Object.entries(s.requests))if([u.id,other.id].includes(v.from)||[u.id,other.id].includes(v.to))delete s.requests[id];break;
    }
    case 'decline':{const r=s.requests[input.requestId];if(r&&(r.to===u.id||r.from===u.id))delete s.requests[r.id];else fail('申请已失效');break;}
    case 'publish':{
      const link=active(s,u);if(!link||input.linkId!==link.id)fail('搭子关系已变更，请刷新后重新选择分享');
      if(!Array.isArray(input.tasks)||input.tasks.length>10)fail('第一版最多分享 10 项任务');
      const tasks=input.tasks.map(t=>cleanTask(t,now));if(new Set(tasks.map(t=>t.localId)).size!==tasks.length)fail('重复的任务标识');
      for(const [id,t]of Object.entries(s.tasks))if(t.ownerId===u.id)delete s.tasks[id];
      for(const t of tasks){const id=hash(u.id+':'+t.localId);s.tasks[id]={...t,id,ownerId:u.id,linkId:link.id,updatedAt:new Date(now).toISOString()};}break;
    }
    case 'signal':{
      const link=active(s,u),friend=partner(s,u),t=s.tasks[input.taskId],kind=input.kind;
      if(!link||!friend||!t||t.linkId!==link.id||t.ownerId!==friend.id)fail('任务已取消分享，请刷新');
      if(!['nudge','cheer'].includes(kind))fail('不支持此操作');const date=dateAt(now),completed=done(t,date);
      if(kind==='nudge'&&(completed||!occurs(t,date)&&!(t.recurrence==='none'&&t.dueDate&&t.dueDate<date)))fail('仅能提醒今天待办或逾期未完成的任务');
      if(kind==='cheer'&&!completed)fail('对方打卡后再送上鼓励吧');
      const recent=s.events.filter(e=>e.from===u.id&&e.taskId===t.id&&e.kind===kind);
      if(recent.some(e=>now-e.at<(kind==='nudge'?6:24)*3600000))fail(kind==='nudge'?'已经提醒过了，留一点空间，6 小时后可再提醒':'今天已经为这件事鼓励过了',429);
      if(s.events.filter(e=>e.from===u.id&&dateAt(e.at)===date).length>=10)fail('今天的互动已够多，明天再继续吧',429);
      s.events.push({id:token(),linkId:link.id,from:u.id,to:friend.id,taskId:t.id,title:t.title,kind,at:now});break;
    }
    case 'unlink':unlink(s,u);break;
    case 'deleteAccount':{
      unlink(s,u);for(const [id,r]of Object.entries(s.requests))if(r.from===u.id||r.to===u.id)delete s.requests[id];
      delete s.users[u.id];return {deleted:true};
    }
    default:fail('不支持的操作');
  }
  return {...snapshot(s,u,now),...extra};
}
module.exports={initialize,dispatch,cleanTask,occurs,done,dateAt};
