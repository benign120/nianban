import {todayString,occursOn,isDone} from './tasks.js';

// Deliberate allowlist: raw speech, history, private notes and keys never enter cloud payloads.
export function sharedTasks(tasks,ids){return tasks.filter(t=>ids.includes(t.id)&&t.status!=='archived').slice(0,10).map(t=>({localId:t.id,title:t.title,dueDate:t.dueDate||'',dueTime:t.dueTime||'',recurrence:t.recurrence||'none',weekDay:t.weekDay??null,status:t.status==='done'?'done':'todo',completedDates:(t.completedDates||[]).slice(-90)}));}

export function createBuddy(h){
  const {esc,icon,toast,openModal,closeModal}=h;
  let error='',busy=false,invite=null,chain=Promise.resolve(),dirtyTimer,published='',serial=0;
  const waits=new Map();
  const state=()=>h.getState();
  const local=()=>state().buddy||(state().buddy={sharedIds:[],linkId:'',cache:null,lastSyncAt:''});
  const info=()=>{try{return window.NativeBridge?.buddyStatus?JSON.parse(NativeBridge.buddyStatus()):{configured:false};}catch{return {configured:false};}};
  function accept(data){
    if(data.deleted){state().buddy={sharedIds:[],linkId:'',cache:null,lastSyncAt:''};published='';invite=null;h.persist();h.render();return;}
    if(data.schema!==1||!data.me||!Array.isArray(data.ownShares)||!Array.isArray(data.friendTasks))throw new Error('搭子同步数据无效');
    const b=local();if(b.linkId!==(data.linkId||'')){b.sharedIds=data.ownShares.map(t=>t.localId).filter(id=>state().tasks.some(t=>t.id===id));b.linkId=data.linkId||'';published='';invite=null;}
    const {inviteCode,inviteExpiresAt,...cache}=data;b.cache=cache;b.lastSyncAt=data.serverTime;error='';h.persist();
  }
  function request(action,body={}){
    const work=()=>new Promise((resolve,reject)=>{
      if(!info().configured)return reject(new Error('先创建搭子身份'));
      const requestId='buddy_'+(++serial)+'_'+Date.now();const timer=setTimeout(()=>{waits.delete(requestId);reject(new Error('同步超时，稍后可刷新确认，手机任务已保留'));},35000);
      waits.set(requestId,{resolve,reject,timer});try{NativeBridge.buddyRequest(requestId,JSON.stringify({action,...body}));}catch(e){clearTimeout(timer);waits.delete(requestId);reject(e);}
    });
    const next=chain.then(work,work);chain=next.catch(()=>{});return next;
  }
  function event(e){
    if(e.type==='buddy-status'){sync(true);return true;}
    if(!['buddy-result','buddy-error'].includes(e.type))return false;
    const waiting=waits.get(e.requestId);if(waiting){clearTimeout(waiting.timer);waits.delete(e.requestId);if(e.type==='buddy-error')waiting.reject(new Error(e.message));else waiting.resolve(e.data);}
    else if(e.requestId==='register'){
      if(e.type==='buddy-error'){error=e.message;toast(error);}else{try{accept(e.data);toast('搭子身份已创建，可以邀请朋友了');}catch(err){error=err.message;}}
      h.render();
    }return true;
  }
  async function publish(){
    const b=local();if(!info().configured||!b.linkId)return;
    const tasks=sharedTasks(state().tasks,b.sharedIds),signature=JSON.stringify({linkId:b.linkId,tasks});
    if(signature===published)return;
    const data=await request('publish',{linkId:b.linkId,tasks});accept(data);published=signature;
  }
  async function sync(manual=false){
    if(!info().configured||busy)return;busy=true;error='';if(manual)h.render();
    try{accept(await request('snapshot'));await publish();if(manual)toast('搭子进度已更新');}
    catch(e){error=e.message;if(manual)toast(error);}finally{busy=false;h.render();}
  }
  function changed(){clearTimeout(dirtyTimer);dirtyTimer=setTimeout(()=>sync(false),700);}
  function timeLabel(at){try{return new Date(at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});}catch{return '尚未同步';}}
  function taskMarkup(t){
    const date=todayString(),done=isDone(t,date),applicable=occursOn(t,date),overdue=t.recurrence==='none'&&t.dueDate&&t.dueDate<date&&!done;
    const label=done?'已打卡':applicable?'今天待完成':overdue?'逾期未完成':t.dueDate?'尚未到计划日期':'未安排日期';
    return '<article class="card buddy-task"><div class="buddy-task-top"><span class="buddy-task-mark '+(done?'done':'')+'">'+icon(done?'check':'leaf')+'</span><div><h3>'+esc(t.title)+'</h3><p>'+esc(t.dueDate||'未定日期')+(t.dueTime?' · '+esc(t.dueTime):'')+' · '+esc({daily:'每天',weekly:'每周',weekdays:'工作日',none:'单次'}[t.recurrence]||'')+'</p></div><span class="tag '+(done?'':'grey')+'">'+label+'</span></div><div class="buddy-task-bottom"><span>对方 '+timeLabel(t.updatedAt)+' 更新</span>'+(done?'<button class="chip" data-action="buddy-cheer" data-id="'+esc(t.id)+'">'+icon('leaf')+' 给你加油</button>':applicable||overdue?'<button class="chip" data-action="buddy-nudge" data-id="'+esc(t.id)+'">'+icon('bell')+' 轻轻提醒</button>':'')+'</div></article>';
  }
  function page(){
    const b=local(),cache=b.cache,friend=cache?.friend,configured=info().configured;
    const title='<div class="eyebrow">A LITTLE COMPANY, A LITTLE PROGRESS</div><section class="hero buddy-hero"><h1>一起，<em>把小事做好。</em></h1><p class="subtitle">不用一个人坚持。找一位愿意陪你的搭子。</p><div class="buddy-orbs" aria-hidden="true"><span>'+icon('leaf')+'</span><span>'+icon('sun')+'</span></div></section>';
    if(!configured)return title+'<section class="card buddy-welcome"><div class="buddy-welcome-icon">'+icon('buddies')+'</div><h2>你的计划，有人惦记。</h2><p>分享一件想坚持的事，<br>收下提醒，也为对方的一小步鼓掌。</p><div class="buddy-steps"><span><b>01</b>邀请一位朋友</span><span><b>02</b>各自选择任务</span><span><b>03</b>打卡与鼓励</span></div><button class="primary" data-action="buddy-connect">创建搭子身份</button><p class="tiny-note">私人任务默认只属于你</p></section><section class="card"><h3>轻一点，也可以坚持。</h3><p class="config-help">双方同意后才建立关系。只分享你选中的任务，可随时停止分享或结束搭子关系。第一版每人一位搭子，最多分享 10 项任务。</p></section>';
    let html=title+'<div class="buddy-sync"><span>'+(b.lastSyncAt?'最近同步 '+timeLabel(b.lastSyncAt):'尚未同步')+'</span><button class="text-button" data-action="buddy-sync" '+(busy?'disabled':'')+'>'+ (busy?'同步中…':'刷新')+'</button></div>'+(error?'<p class="notice error">'+esc(error)+'<br>下方可能是上次同步的记录。</p><button class="text-button" data-action="buddy-endpoint">检查服务地址</button>':'');
    if(!cache)return html+'<section class="card"><h3>连接后，就能开始。</h3><p class="config-help">首次创建需要联网。网络恢复后点刷新，继续完成身份创建。</p></section>';
    html+='<section class="card buddy-profile"><div class="buddy-avatar">'+esc(cache.me.nickname.slice(0,1))+'</div><div><strong>'+esc(cache.me.nickname)+'</strong><p>'+ (friend?'正在和 '+esc(friend.nickname)+' 一起坚持':'等一位搭子，走一小段路')+'</p></div><span class="tag">'+(friend?'已成为搭子':'尚未配对')+'</span></section>';
    if(!friend){
      html+='<section class="card"><h3>邀请一个熟悉的人</h3><p class="config-help">发出邀请码，对方申请后由你确认。邀请码有效 24 小时。</p><button class="primary" data-action="buddy-invite">生成邀请码</button><button class="text-button buddy-join" data-action="buddy-join">我收到邀请码了</button></section>';
      for(const r of cache.incoming)html+='<section class="card"><h3>'+esc(r.nickname)+' 想成为你的搭子</h3><p class="config-help">接受后，双方可以主动选择要分享的任务。</p><div class="action-row"><button class="secondary" data-action="buddy-decline" data-id="'+esc(r.id)+'">暂不接受</button><button class="primary" data-action="buddy-accept" data-id="'+esc(r.id)+'">接受邀请</button></div></section>';
      for(const r of cache.outgoing)html+='<section class="card"><h3>等待 '+esc(r.nickname)+' 接受</h3><p class="config-help">对方打开搭子页刷新后可以处理申请。</p><button class="text-button" data-action="buddy-decline" data-id="'+esc(r.id)+'">取消申请</button></section>';
    }else{
      html+='<div class="section-heading"><h2>'+esc(friend.nickname)+' 的小目标</h2><span>仅对方分享的任务</span></div>'+(cache.friendTasks.length?cache.friendTasks.map(taskMarkup).join(''):'<section class="card buddy-empty"><span>'+icon('leaf')+'</span><p>搭子还没有分享任务。<br>可以先分享自己的第一件小事。</p></section>');
      const selected=sharedTasks(state().tasks,b.sharedIds),cloud=cache.ownShares;
      const same=JSON.stringify(selected)===JSON.stringify(cloud.map(t=>sharedTasks([{...t,id:t.localId}],[t.localId])[0]));
      html+='<div class="section-heading"><h2>我让搭子监督的事</h2><button class="text-button" data-action="buddy-select">选择任务</button></div><section class="card">'+(selected.length?selected.map(t=>'<div class="buddy-shared-line"><span>'+esc(t.title)+'</span><span class="tag '+(isDone(t,todayString())?'':'grey')+'">'+(isDone(t,todayString())?'已打卡':'进行中')+'</span></div>').join(''):'<p class="config-help">你的清单默认不分享。选择一件想坚持的事，让搭子陪你完成。</p>')+(!same?'<p class="notice">分享变更待同步。成功前，对方仍可能看到上次分享的内容。</p>':'')+'</section>';
      html+='<div class="section-heading"><h2>收到的小小心意</h2><span>最近 7 天</span></div><section class="card">'+(cache.events.length?cache.events.map(e=>'<div class="buddy-event">'+icon(e.kind==='cheer'?'leaf':'bell')+'<div><strong>'+esc(e.from)+(e.kind==='cheer'?' 为你加油':' 轻轻提醒了你')+'</strong><p>'+esc(e.title)+'</p><small>'+timeLabel(e.at)+'</small></div></div>').join(''):'<p class="config-help">完成后的一句鼓励，也是一份动力。</p>')+'</section><button class="text-button danger-button" data-action="buddy-unlink">结束搭子关系</button>';
    }
    return html+'<p class="config-help buddy-boundary">进度在打开应用、返回应用和点击刷新时同步；前台每分钟检查一次。提醒与鼓励在搭子页查看，本版没有关闭应用后的即时推送。打卡表示本人声明完成。</p><button class="text-button danger-button" data-action="buddy-delete">删除我的搭子身份</button>';
  }
  function selectTasks(preselect){
    if(!local().cache?.friend){toast('先邀请一位搭子');h.navigate();return;}
    const tasks=state().tasks.filter(t=>t.status!=='archived'),ids=new Set(local().sharedIds);if(preselect)ids.add(preselect);
    openModal('<h2>选择让搭子监督的事</h2><p class="config-help">只分享任务名称、计划日期、重复规则和打卡状态。原话与其他任务留在手机上。</p><div class="buddy-choices">'+(tasks.length?tasks.map(t=>'<label class="buddy-choice"><input type="checkbox" name="buddy-task" value="'+esc(t.id)+'" '+(ids.has(t.id)?'checked':'')+'><span>'+esc(t.title)+'<small>'+esc(t.dueDate||'未安排日期')+' '+esc(t.dueTime||'')+'</small></span></label>').join(''):'<p>先在「今天」记下一件事，再来分享。</p>')+'</div><button class="primary" data-action="buddy-save-shares">保存分享选择</button><p class="tiny-note">最多 10 项 · 取消勾选即可停止分享</p>');
  }
  async function action(button){
    const a=button.dataset.action;if(!a?.startsWith('buddy-'))return false;
    const taskId=button.dataset.id;
    if(a==='buddy-connect'){if(window.NativeBridge?.configureBuddy)NativeBridge.configureBuddy();else toast('请在安卓安装版中创建搭子身份');return true;}
    if(a==='buddy-endpoint'){window.NativeBridge?.editBuddyEndpoint?.();return true;}
    if(a==='buddy-copy'){if(invite&&window.NativeBridge?.copyBuddyInvite)NativeBridge.copyBuddyInvite(invite);else toast('长按邀请码即可复制');return true;}
    if(a==='buddy-sync'){await sync(true);return true;}
    if(a==='buddy-select'){selectTasks(taskId);return true;}
    if(a==='buddy-join'){openModal('<h2>接住朋友的邀请</h2><p class="config-help">粘贴朋友发给你的 32 位邀请码，申请后等待对方确认。</p><div class="field"><label for="buddy-code">邀请码</label><input id="buddy-code" autocomplete="off" maxlength="40" placeholder="粘贴完整邀请码"></div><button class="primary" data-action="buddy-send-request">申请成为搭子</button>');return true;}
    if(a==='buddy-unlink'||a==='buddy-delete'){
      openModal('<h2>'+(a==='buddy-unlink'?'结束这段搭子关系？':'删除我的搭子身份？')+'</h2><p class="config-help">双方共享任务与互动会从云端移除，个人手机清单保留。对方已有的离线缓存将在下次同步时更新。'+(a==='buddy-delete'?'此身份无法恢复，之后需要重新邀请搭子。':'')+'</p><div class="action-row"><button class="secondary" data-action="close">保留</button><button class="secondary danger-button" data-action="'+a+'-confirm">确认'+(a==='buddy-delete'?'删除':'结束')+'</button></div>');return true;
    }
    if(busy){toast('正在同步，稍等一下');return true;}busy=true;error='';button.disabled=true;
    try{
      if(a==='buddy-invite'){const data=await request('invite');accept(data);invite=data.inviteCode;openModal('<h2>邀请一位监督搭子</h2><p class="config-help">把下面的邀请码发给朋友。对方在念办「搭子」中输入后，你还需要接受申请。</p><div class="source-text mono buddy-code">'+esc(invite)+'</div><button class="primary" data-action="buddy-copy">复制邀请码</button><p class="config-help">有效至 '+timeLabel(data.inviteExpiresAt)+'。再次生成会使旧邀请码失效。长按邀请码即可选择并复制。</p>');}
      if(a==='buddy-send-request'){const code=document.querySelector('#buddy-code').value.trim();accept(await request('request',{code}));closeModal();toast('申请已发送，等待朋友确认');}
      if(a==='buddy-accept'||a==='buddy-decline'){accept(await request(a==='buddy-accept'?'accept':'decline',{requestId:taskId}));toast(a==='buddy-accept'?'你们已经成为搭子':'申请已处理');}
      if(a==='buddy-save-shares'){
        const selected=[...document.querySelectorAll('input[name="buddy-task"]:checked')].map(x=>x.value);if(selected.length>10)throw new Error('先选最重要的 10 项就好');
        local().sharedIds=selected;h.persist();closeModal();await publish();toast('分享选择已更新');
      }
      if(a==='buddy-nudge'||a==='buddy-cheer'){accept(await request('signal',{taskId,kind:a==='buddy-nudge'?'nudge':'cheer'}));toast(a==='buddy-nudge'?'已留下提醒，对方同步后可看到':'鼓励已送出，对方同步后可看到');}
      if(a==='buddy-unlink-confirm'){accept(await request('unlink'));closeModal();toast('已结束搭子关系，个人任务保留');}
      if(a==='buddy-delete-confirm'){accept(await request('deleteAccount'));closeModal();toast('搭子身份已删除，个人任务保留');}
    }catch(e){error=e.message;toast(error);}finally{busy=false;button.disabled=false;h.render();}return true;
  }
  return {page,event,action,sync,changed,info};
}
