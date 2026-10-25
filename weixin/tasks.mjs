import { validateInput, normalizeOutput, SYSTEM_PROMPT } from '../web/agent.js';
import { tryLocalParse } from '../web/local-parser.js';

export function clock(date=new Date()) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
  return {referenceDate:`${p.year}-${p.month}-${p.day}`,referenceTime:`${p.hour}:${p.minute}`};
}
export async function understand(body,key,fetcher=fetch) {
  const input=validateInput({...body,existingTasks:[]}),local=tryLocalParse(input);
  if(local)return local;
  if(!key)throw new Error('复杂表达需要配置 DeepSeek；请先用完整的一句话描述一项任务。');
  const res=await fetcher('https://api.deepseek.com/chat/completions',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:'deepseek-flash',thinking:{type:'disabled'},temperature:0.1,max_tokens:5000,response_format:{type:'json_object'},messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:JSON.stringify(input)}]}),signal:AbortSignal.timeout(65000)});
  if(!res.ok)throw new Error(({401:'DeepSeek 密钥无效',402:'DeepSeek 余额不足',429:'DeepSeek 暂时繁忙'})[res.status]||'DeepSeek 暂时不可用');
  const raw=await res.json(),choice=raw.choices?.[0];
  if(choice?.finish_reason!=='stop'||!choice?.message?.content)throw new Error('AI 理解结果不完整');
  return {...normalizeOutput(JSON.parse(choice.message.content),input),mode:'direct'};
}
export function createTaskHandler({store,key=()=>'',parse=understand,now=()=>new Date(),enabled=()=>false}) {
  let active=false;const recent=[];
  return async item=>{
    const text=item.text.trim();if(!text||text.length>4000)return '请用不超过 4,000 字的一句话描述任务。';
    const previous=store.message(item.id);if(previous!==undefined)return previous;
    if(text==='测试连接')return store.remember(item.id,'念办微信连接正常。'+(enabled()?'可以发一句要做的事，例如：明天下午三点修改简历。任务先保存在微信接入服务，手机同步后才设置提醒。':'当前只验证收发，暂未创建任务或设置提醒。'));
    if(!enabled())return store.remember(item.id,'消息已收到。当前只验证微信收发，任务创建和手机同步还未启用，尚未创建任务。');
    if(text==='帮助')return store.remember(item.id,'直接发任务：明天下午三点修改简历。\n“查看待办”：查看微信创建的任务记录。\n“补充 下午三点”：补齐上一条不明确的信息。\n“取消待确认”：放弃上一条待补充内容。\n当前仅支持新增；完成、修改、删除请在念办中操作。手机同步后才会设置本地提醒。');
    if(text==='查看待办') {const list=store.existing().slice(0,20);return store.remember(item.id,list.length?'微信创建记录（完成状态请以手机为准）：\n'+list.map((t,i)=>`${i+1}. ${t.title}｜${t.dueDate||'未安排日期'} ${t.dueTime||''}`).join('\n'):'还没有从微信创建的任务。');}
    if(text==='取消待确认'){store.set('pending','');return store.remember(item.id,'已取消待补充内容，已保存的任务保留。');}
    if(/改到|改成|修改.{0,20}(?:任务|提醒)|删除|取消.{0,30}(?:任务|提醒)|标记.{0,10}完成/.test(text))return store.remember(item.id,'微信入口暂只支持新增任务。修改、完成或删除请在念办中操作，本次没有新增任务。');
    if(active)return '上一条还在处理中，请稍后重新发送这条任务。';
    while(recent.length&&now().getTime()-recent[0]>60000)recent.shift();
    if(recent.length>=10)return '消息较多，请一分钟后重新发送。';
    recent.push(now().getTime());active=true;
    try{
      const pending=store.pending(),supplement=text.startsWith('补充 ');
      if(supplement&&!pending)return store.remember(item.id,'目前没有待补充的任务，请重新发一句完整的话。');
      const original=supplement?`上一条待办：${pending.text}\n补充说明：${text.slice(3)}`:text;
      const reference=supplement?pending.reference:clock(item.sentAt&&Number.isFinite(Date.parse(item.sentAt))?new Date(item.sentAt):now());
      const input=validateInput({text:original,...reference,existingTasks:[]});
      const result=await parse(input,key());
      if(result.tasks.some(t=>t.intent!=='create'))throw new Error('微信入口暂不支持修改任务');
      const current=clock(now());
      for(const t of result.tasks){if(t.recurrence==='none'&&t.dueDate&&t.dueTime&&(t.dueDate<current.referenceDate||t.dueDate===current.referenceDate&&t.dueTime<=current.referenceTime))t.questions.push('这条消息的提醒时间已经过去，请补充新的日期和时刻');}
      const uncertain=result.tasks.filter(t=>t.questions.length),ready=result.questions.length?[]:result.tasks.filter(t=>!t.questions.length);
      const questions=[...new Set([...result.questions,...uncertain.flatMap(t=>t.questions)])];
      return store.commit(item.id,ready,{text:original,sourceId:result.sourceId,at:now().toISOString()},questions.length?{text:original,reference}:null,saved=>{
        let reply=saved.length?`已记下 ${saved.length} 项：\n`+saved.map(t=>`• ${t.title}｜${t.dueDate||'未安排日期'} ${t.dueTime||''}`).join('\n'):ready.length?'相同任务已存在，没有重复添加。':'';
        if(questions.length)reply+=(reply?'\n\n':'')+'还需要确认：'+questions.join('；')+'。请发“补充 …”，或“取消待确认”。';
        if(!reply)reply='没有找到明确的待办，请说出你要做什么。';
        if(saved.length)reply+='\n已保存在微信接入服务。手机同步后才设置本地提醒。';
        return reply;
      });
    }catch(e){return /^(DeepSeek|复杂表达需要|AI 理解|微信入口)/.test(e.message||'')?e.message+'。本次尚未新增任务，可稍后重发。':'这句话暂未处理成功，本次尚未新增任务，请稍后重发。';}
    finally{active=false;}
  };
}
