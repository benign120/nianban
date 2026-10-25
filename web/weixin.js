import { isISODate } from './agent.js';
import { normalizeTitle } from './tasks.js';

function validateTask(t) {
  if(!t||!/^wx-[a-f0-9-]{36}$/.test(t.id||'')||typeof t.title!=='string'||!t.title.trim()||t.title.length>100||t.origin!=='weixin'||t.status!=='todo')throw new Error('微信任务格式无效');
  if(t.dueDate&&!isISODate(t.dueDate)||t.dueTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.dueTime)||t.dueTime&&!t.dueDate)throw new Error('微信任务时间格式无效');
  if(!['none','daily','weekdays','weekly'].includes(t.recurrence)||t.recurrence!=='none'&&!t.dueDate||t.recurrence==='weekly'&&(!Number.isInteger(t.weekDay)||t.weekDay<0||t.weekDay>6))throw new Error('微信任务重复规则无效');
  if(!['work','study','life','health'].includes(t.category)||!['normal','high'].includes(t.priority)||!Array.isArray(t.questions)||t.questions.length)throw new Error('微信任务尚未确认');
  if(typeof t.sourceText!=='string'||t.sourceText.length>4000||typeof t.createdAt!=='string'||!Number.isFinite(Date.parse(t.createdAt)))throw new Error('微信任务来源无效');
  return {id:t.id,title:t.title.trim(),dueDate:t.dueDate||'',dueTime:t.dueTime||'',recurrence:t.recurrence,weekDay:t.recurrence==='weekly'?t.weekDay:null,category:t.category,priority:t.priority,status:'todo',completedDates:[],versions:[],origin:'weixin',sourceText:t.sourceText,sourceId:String(t.sourceId||'').slice(0,100),sourceQuote:String(t.sourceQuote||'').slice(0,4000),createdAt:t.createdAt,updatedAt:t.createdAt,questions:[],intent:'create'};
}
export function mergeWeixinInbox(state,payload) {
  if(payload?.schemaVersion!==1||!/^[-a-f0-9]{36}$/.test(payload.bridgeId||'')||!Array.isArray(payload.items)||payload.items.length>100||!Number.isSafeInteger(payload.nextCursor)||payload.nextCursor<0)throw new Error('微信同步数据格式无效');
  const next=structuredClone(state),old=next.weixin||{cursor:0,importedIds:[]};
  const initial=old.bridgeId===payload.bridgeId?old.cursor||0:0;
  let cursor=initial;const incoming=[];
  for(const row of payload.items){if(!Number.isSafeInteger(row.seq)||row.seq<=cursor)throw new Error('微信同步顺序无效');incoming.push(validateTask(row.task));cursor=row.seq;}
  if(payload.nextCursor!==cursor)throw new Error('微信同步游标无效');
  const ids=new Set(old.importedIds||[]);let added=0,skipped=0;
  for(const t of incoming){
    if(ids.has(t.id)||next.tasks.some(old=>old.id===t.id||normalizeTitle(old.title)===normalizeTitle(t.title)&&old.dueDate===t.dueDate&&old.dueTime===t.dueTime&&old.recurrence===t.recurrence&&old.weekDay===t.weekDay)){skipped++;ids.add(t.id);continue;}
    next.tasks.unshift(t);ids.add(t.id);added++;
    next.history.unshift({id:'history-'+t.id,text:t.sourceText,at:t.createdAt,result:'从微信同步：'+t.title,kind:'weixin'});
  }
  next.history=next.history.slice(0,200);
  next.weixin={bridgeId:payload.bridgeId,cursor,importedIds:[...ids],lastSyncAt:new Date().toISOString()};
  return {state:next,added,skipped,hasMore:payload.hasMore===true};
}
