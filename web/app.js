import { createBuddy } from './buddy.js';
import { apiStatus, extractDirect, handleAiEvent, testDirect } from './ai.js';
import { todayString, dateOffset, occursOn, isDone, toggleDone, commitTasks, exportMarkdown } from './tasks.js';
import { mergeWeixinInbox } from './weixin.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  buddies: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 21v-3a6 6 0 0 1 12 0v3m2-6a5 5 0 0 1 6 5v1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 4h2"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7m2-4v6l4 2"/>',
  settings: '<path d="M4 7h10m4 0h2M4 17h2m4 0h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  mic: '<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', back: '<path d="m14 5-7 7 7 7"/>',
  leaf: '<path d="M19 3C8 2 3 7 5 15c8 5 17-1 14-12ZM5 20 16 8"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>', bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Zm4 12h4"/>',
  text: '<path d="M4 5h16M12 5v15M8 20h8"/>', edit: '<path d="m4 16-1 5 5-1L20 8l-4-4L4 16Zm10-10 4 4"/>',
  link: '<path d="m10 13 4-4m-7 5-2 2a4 4 0 0 0 6 6l3-3m-1-9 2-2a4 4 0 0 0-6-6L6 5"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>'
};
function icon(name) { return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] || icons.check) + '</svg>'; }
const id = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
let state = { tasks: [], history: [], settings: {} };
try { const saved = window.NativeBridge ? NativeBridge.loadState() : localStorage.getItem('nianban-v1'); if (saved) state = { ...state, ...JSON.parse(saved) }; } catch {}
// 0.1.x connection settings are obsolete. Credentials never enter this state.
state.settings = {};
let page = ['today', 'all', 'buddy', 'history', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
let selectedDate = todayString(), inputText = '', busy = false, listening = false, partial = '', errorMessage = '', latest = null, pending = null, connection = { ok: false, configured: false }, toastTimer, lastUndo = null;
let weixinBusy=false,weixinError='',weixinManual=false,weixinResetting=false;
function weixinInfo(){try{return window.NativeBridge?.weixinStatus?JSON.parse(NativeBridge.weixinStatus()):{configured:false};}catch{return {configured:false};}}
function syncWeixin(manual=false){
  if(!weixinInfo().configured||weixinBusy)return;
  weixinBusy=true;weixinManual=manual;weixinError='';weixinResetting=false;
  if(page==='settings')render();
  try{NativeBridge.pullWeixinTasks(state.weixin?.cursor||0);}catch{weixinBusy=false;weixinError='无法开始同步，请重新打开念办';if(manual)toast(weixinError);if(page==='settings')render();}
}
function weixinSettings(){const w=weixinInfo();return '<section class="card"><div class="api-card-title"><h3>从微信，记到念办</h3><span class="tag '+(w.configured?'':'grey')+'">'+(w.configured?'已连接电脑':'可选连接')+'</span></div><p class="config-help">给微信助手发一句话，电脑先记下任务。<br>手机与电脑在同一局域网时，打开念办同步并设置提醒。</p><div class="setting-row">同步方式<span>打开应用 / 手动同步</span></div>'+(state.weixin?.lastSyncAt?'<div class="setting-row">最近同步<span>'+esc(new Date(state.weixin.lastSyncAt).toLocaleString('zh-CN',{hour12:false}))+'</span></div>':'')+(weixinError?'<p class="notice error">'+esc(weixinError)+'</p>':'')+(window.NativeBridge?.configureWeixin?'<button class="secondary" data-action="configure-weixin">'+(w.configured?'更换电脑连接码':'连接我的电脑')+'</button>'+(w.configured?'<div class="action-row"><button class="primary" data-action="sync-weixin" '+(weixinBusy?'disabled':'')+'>'+(weixinBusy?'正在同步…':'立即同步')+'</button><button class="text-button danger-button" data-action="clear-weixin">断开同步</button></div>':''):'<p class="notice">微信同步需要安卓安装包，以及电脑上运行的微信服务。</p>')+'<p class="config-help small-help">电脑需要开机、联网并运行微信服务，不要求开热点。手机关闭应用后不会继续拉取；尚未同步的任务不会提醒。已保存到手机的提醒可独立运行。微信暂支持新增，修改与完成请在手机中操作。</p></section>';}
function persist() {
  const value = JSON.stringify(state);
  if (window.NativeBridge) { if(NativeBridge.saveStateV2){const saved=NativeBridge.saveStateV2(value);if(!saved)throw new Error('保存失败，请检查手机存储空间');state=JSON.parse(saved);}else{const ok = NativeBridge.saveState(value); if (!ok) throw new Error('保存失败，请检查手机存储空间');} }
  else localStorage.setItem('nianban-v1', value);
}
function syncReminders() {
  if (!window.NativeBridge) return;
  try { NativeBridge.syncReminders(JSON.stringify(state.tasks)); } catch { toast('任务已保存，系统提醒暂未成功同步'); }
}
function saveAndSync() { persist(); syncReminders(); buddy.changed(); }
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('show'); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3500); }
function setPage(next) { page = next; location.hash = next; errorMessage = ''; render(); window.scrollTo(0, 0); }
function dateLabel(date) { if (!date) return '未安排'; const today = todayString(); if (date === today) return '今天'; if (date === dateOffset(today, 1)) return '明天'; return date.slice(5).replace('-', '月') + '日'; }
function recurrenceLabel(t) { return ({ none: '', daily: '每天', weekdays: '工作日', weekly: '每周' + '日一二三四五六'[t.weekDay ?? 1] })[t.recurrence] || ''; }
const categoryLabels = { work: '工作', study: '学习', life: '生活', health: '健康' };
function reminderInfo() { try { if (window.NativeBridge) return JSON.parse(NativeBridge.reminderStatus()); } catch {} return { native: false, notifications: false, exact: false }; }
function updateConnectionBadge() {
  const badge = $('#connectionBadge'); badge.className = 'connection-badge ready';
  badge.innerHTML = '<i></i><span>' + (page==='buddy'?'指定任务共享':connection.configured ? '本地优先 · AI 已配置' : '离线可用') + '</span>';
}
async function checkConnection() {
  const status = apiStatus(); connection = { ...connection, ok: status.native, configured: status.configured };
  updateConnectionBadge();
}
function taskCard(t, date = selectedDate) {
  const done = isDone(t, date), overdue = t.recurrence === 'none' && t.dueDate && t.dueDate < todayString() && !done;
  return '<article class="card task-card ' + (done ? 'done' : '') + '"><button class="task-check" data-action="toggle" data-id="' + esc(t.id) + '" data-date="' + esc(date) + '" aria-label="' + (done ? '标记未完成' : '完成任务') + '">' + (done ? icon('check') : '') + '</button><div class="task-content"><button class="task-open" data-action="edit" data-id="' + esc(t.id) + '"><div class="task-line"><h3>' + esc(t.title) + '</h3><span class="task-time ' + (overdue ? 'late' : '') + '">' + esc(t.dueTime || '待办') + '</span></div><div class="task-meta"><span class="category-dot ' + esc(t.category) + '"></span><span>' + esc(categoryLabels[t.category] || '生活') + '</span>' + (recurrenceLabel(t) ? '<span>' + icon('repeat') + esc(recurrenceLabel(t)) + '</span>' : '') + (overdue ? '<span class="overdue">已过期</span>' : '') + (!t.dueDate ? '<span>未安排日期</span>' : '') + '</div></button></div></article>';
}
function composer() {
  return '<section class="card composer"><div class="input-head"><span class="section-label">' + (listening ? '正在听你说…' : busy ? '正在理解这句话…' : '把想做的事，交给念办') + '</span><span class="tag grey">一句话添加</span></div><textarea id="taskInput" class="editor" rows="3" maxlength="4000" placeholder="例如：明天下午三点提醒我修改简历">' + esc(inputText) + '</textarea>' + (listening ? '<div class="live-transcript">' + esc(partial || '靠近手机，用自然的语速说就好') + '</div>' : '') + '<div class="compose-actions"><button class="text-button" data-action="manual">' + icon('plus') + '手动添加</button><button class="voice-button ' + (listening ? 'listening' : '') + '" data-action="voice" ' + (busy ? 'disabled' : '') + ' aria-label="' + (listening ? '结束录音' : '说一句话添加任务') + '">' + (listening ? '<span class="voice-stop"></span>' : icon('mic')) + '</button><button class="send-button" data-action="extract" ' + (busy || listening ? 'disabled' : '') + '>' + (busy ? '<span class="spinner"></span>' : icon('arrow')) + '<span class="screen-reader">生成任务</span></button></div><p class="tiny-note">说一句或输入后点箭头 · 常见指令支持离线</p></section>';
}
function latestBanner() {
  if (!latest) return '';
  return '<section class="result-note"><span class="result-check">' + icon('check') + '</span><div><strong>' + esc(latest.title) + '</strong><p>' + esc(latest.detail) + '</p></div>' + (lastUndo ? '<button class="text-button" data-action="undo">撤销</button>' : '') + '</section>';
}
function todayPage() {
  const today = todayString(), tasks = state.tasks.filter(t => occursOn(t, selectedDate)), done = tasks.filter(t => isDone(t, selectedDate)).length;
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][new Date(selectedDate + 'T12:00:00').getDay()];
  const heading = tasks.length ? (selectedDate === today ? '今天，<em>慢慢完成。</em>' : '这一天，<em>已有安排。</em>') : selectedDate === today ? '留一点轻松，<br><em>给今天的自己。</em>' : '一步一步，<br><em>把日子过好。</em>';
  const anchor = selectedDate < dateOffset(today, -1) || selectedDate > dateOffset(today, 5) ? selectedDate : today; const week = Array.from({ length: 7 }, (_, i) => dateOffset(anchor, i - 1));
  return '<div class="eyebrow">' + esc(selectedDate.replaceAll('-', '.')) + ' · ' + weekday + '</div><section class="hero"><h1>' + heading + '</h1><p class="subtitle">想到什么，说一句。念办帮你记住。</p><span class="hero-ornament" aria-hidden="true">' + icon('leaf') + '</span></section>' + composer() + (errorMessage ? '<div class="notice error" role="alert">' + esc(errorMessage) + '</div>' : '') + latestBanner() + '<div class="examples"' + (state.tasks.length ? ' hidden' : '') + '><button class="chip" data-example="明天下午三点提醒我修改简历">修改简历</button><button class="chip" data-example="每天晚上十点提醒我读书二十分钟">每天读书</button><button class="chip" data-example="十分钟后提醒我喝水">喝杯水</button></div><div class="week-strip">' + week.map(date => '<button data-action="date" data-date="' + date + '" class="day ' + (date === selectedDate ? 'active' : '') + '"><span>' + (date === today ? '今' : '日一二三四五六'[new Date(date + 'T12:00:00').getDay()]) + '</span><b>' + Number(date.slice(-2)) + '</b><i></i></button>').join('') + '</div><div class="section-heading"><h2>' + dateLabel(selectedDate) + '的清单 <small>' + tasks.length + '</small></h2><span>' + done + ' / ' + tasks.length + ' 已完成</span></div>' + (tasks.length ? '<div class="completion-track"><i style="width:' + (100 * done / tasks.length) + '%"></i></div>' + [...tasks].sort((a,b) => Number(isDone(a, selectedDate)) - Number(isDone(b, selectedDate)) || (a.dueTime || '99').localeCompare(b.dueTime || '99')).map(t => taskCard(t)).join('') : '<div class="empty compact"><div class="empty-illustration">' + icon('sun') + '</div><h2>给今天留一点空白</h2><p>这里还没有安排。说出第一件想做的事，<br>就从小小的一步开始。</p></div>');
}
function allPage() {
  const tasks = [...state.tasks].sort((a,b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.dueTime || '').localeCompare(b.dueTime || ''));
  const groups = new Map(); for (const t of tasks) { const key = t.recurrence !== 'none' ? '重复的好习惯' : t.status === 'done' ? '已经完成' : t.dueDate || '未安排日期'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(t); }
  return '<div class="eyebrow">A LITTLE PLAN, A LIGHTER DAY</div><h1>慢慢来，<br><em>都有安排。</em></h1><p class="subtitle">' + state.tasks.length + ' 件事，都在这里。</p><button class="primary" data-action="manual">' + icon('plus') + '添加任务</button>' + (!tasks.length ? '<div class="empty"><div class="empty-illustration">' + icon('calendar') + '</div><h2>还没有安排</h2><p>从今天的一件小事开始。</p></div>' : [...groups].map(([group, list]) => '<div class="section-heading"><h2>' + esc(/^\d{4}/.test(group) ? dateLabel(group) : group) + '</h2><span>' + list.length + ' 件</span></div>' + list.map(t => taskCard(t, todayString())).join('')).join('')) + '<div class="action-row"><button class="secondary" data-action="export">导出我的清单</button></div>';
}
function historyPage() {
  return '<div class="eyebrow">WORDS TURN INTO LITTLE STEPS</div><h1>说过的话，<br><em>都有回响。</em></h1><p class="subtitle">保留原话和理解结果，随时回来核对。</p>' + (state.history.length ? '<div class="card flush">' + state.history.map(h => '<article class="history-item"><div class="history-date"><span>' + esc(new Date(h.at).toLocaleString('zh-CN', { hour12: false })) + '</span><span class="tag ' + (h.kind === 'manual' ? 'grey' : '') + '">' + (h.kind === 'manual' ? '手动添加' : h.kind === 'local' ? '本地处理' : h.kind === 'weixin' ? '微信同步' : 'DeepSeek') + '</span></div><h3>' + esc(h.text) + '</h3><p>' + esc(h.result) + '</p>' + (h.elapsedMs ? '<p>' + (h.elapsedMs / 1000).toFixed(1) + ' 秒 · ' + esc(h.model || '') + '</p>' : '') + '</article>').join('') + '</div>' : '<div class="empty"><div class="empty-illustration">' + icon('history') + '</div><h2>第一句话，值得记住</h2><p>添加任务后，可以在这里看到原话和结果。</p></div>');
}
function widgetSettings(){return '<section class="card"><h3>把今天，放在桌面上</h3><p class="config-help">看一眼待办，点圆圈直接打卡。点击「记一句」打开念办，快速添加新任务。</p><div class="widget-preview"><strong>念办 · 今日清单</strong><p>样式示意，安装后显示你的真实任务</p><span>○ 读书二十分钟</span><span>○ 为明天准备一件小事</span></div><button class="secondary" data-action="add-widget">添加桌面小组件</button><p class="config-help small-help">若桌面未弹出添加窗口：长按桌面空白处 → 窗口小工具 → 念办。小组件打卡会立即保存；分享状态在下次打开念办联网同步后更新给搭子。</p></section>';}
function handleWidgetAction(action){if(!action)return;setPage('today');selectedDate=todayString();render();if(action==='add')document.querySelector('#taskInput')?.focus();}
function settingsPage() {
  const r = reminderInfo(), a = apiStatus(), disabled = connection.testing ? 'disabled' : '';
  return '<div class="eyebrow">YOUR PHONE. YOUR LITTLE PLANS.</div><h1>让念办，<br><em>更懂你的节奏。</em></h1><section class="card api-card"><div class="api-card-title"><h3>复杂表达，交给 DeepSeek</h3><span class="tag ' + (a.configured ? '' : 'grey') + '">' + (a.configured ? 'AI 已配置' : '可选配置') + '</span></div><p class="config-help">常见任务在手机本地处理，不需要 API Key。<br>多件事、复杂修改等表达，再交给 AI 理解。</p><div class="setting-row">密钥状态<span>' + (a.configured ? '已加密保存在本机' : '尚未填写') + '</span></div><div class="setting-row">使用模型<span>DeepSeek Flash</span></div>' + (a.native ? '<button class="primary" data-action="configure-api" ' + disabled + '>' + (a.configured ? '更换 API Key' : '填写 API Key') + '</button>' + (a.configured ? '<div class="action-row"><button class="secondary" data-action="test-api" ' + disabled + '>' + (connection.testing ? '正在测试…' : '测试连接') + '</button><button class="text-button danger-button" data-action="clear-api" ' + disabled + '>移除本机密钥</button></div>' : '') : '<p class="notice">常见指令可直接离线使用。复杂表达请在安卓安装版中配置密钥。</p>') + '<p class="config-help small-help">仅使用 AI 理解时发送文字至 DeepSeek。密钥保存在本机。点击测试连接会发起一次真实请求。</p></section>' + widgetSettings() + weixinSettings() + '<section class="card"><h3>提醒与语音</h3><div class="setting-row">系统通知<span>' + (r.native ? (r.notifications ? '已开启' : '尚未允许') : '安装版可用') + '</span></div><div class="setting-row">准时提醒<span>' + (r.native ? (r.exact ? '可用' : '需要系统授权') : '浏览器仅预览界面') + '</span></div><div class="setting-row">语音识别<span>中文离线 · Vosk</span></div>' + (r.native ? '<div class="action-row"><button class="secondary" data-action="notification-settings">开启通知</button><button class="secondary" data-action="exact-settings">准时提醒</button></div><button class="text-button test-notification" data-action="test-notification">发送一条测试通知</button>' : '') + '<p class="config-help">录音在手机上转成文字。常见指令离线处理，复杂表达需要联网。任务和系统提醒保存在手机上。工作日指周一至周五。</p></section><section class="card"><h3>关于念办</h3><p class="config-help">说一句，记一件。<br>为自己的每一天，少记一点，多做一点。</p><div class="setting-row">版本<span>0.6.0 · 搭子与桌面</span></div><div class="setting-row">数据位置<span>私人任务本地 · 分享任务云端</span></div><button class="text-button" data-action="licenses">开源组件说明</button></section><p class="footnote">念办 NIANBAN<br>ONE THOUGHT. ONE SMALL STEP.</p>';
}
function render() {
  $('#main').innerHTML = page === 'today' ? todayPage() : page === 'all' ? allPage() : page === 'buddy' ? buddy.page() : page === 'history' ? historyPage() : settingsPage();
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('[data-icon]').forEach(e => e.innerHTML = icon(e.dataset.icon)); updateConnectionBadge();
}
function openModal(content) { $('#modal').hidden = false; $('#modal').innerHTML = '<section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div></div><button class="close" data-action="close" aria-label="关闭">' + icon('x') + '</button></div>' + content + '</section>'; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; pending = null; }
function taskForm(t, title, isPending = false) {
  const field = (key, label, type = 'text') => '<div class="field"><label for="edit-' + key + '">' + label + '</label><input id="edit-' + key + '" type="' + type + '" value="' + esc(t[key] || '') + '" ' + (key === 'title' ? 'maxlength="100"' : '') + '></div>';
  const options = (key, values) => '<select id="edit-' + key + '">' + values.map(([v,l]) => '<option value="' + v + '" ' + (t[key] === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select>';
  return '<h2>' + title + '</h2>' + (t.questions?.length ? '<div class="notice"><strong>有一点需要你确认</strong><ul>' + t.questions.map(q => '<li>' + esc(q) + '</li>').join('') + '</ul></div>' : '') + field('title', '要做什么') + '<div class="draft-grid">' + field('dueDate', '哪一天', 'date') + field('dueTime', '几点提醒（可不设）', 'time') + '</div><div class="draft-grid"><div class="field"><label>重复</label>' + options('recurrence', [['none','不重复'],['daily','每天'],['weekdays','工作日'],['weekly','每周']]) + '</div><div class="field"><label>分类</label>' + options('category', [['work','工作'],['study','学习'],['life','生活'],['health','健康']]) + '</div></div><div class="field"><label>每周的哪一天（仅每周重复生效）</label><select id="edit-weekDay">' + ['日','一','二','三','四','五','六'].map((d,i) => '<option value="' + i + '" ' + ((t.weekDay ?? 1) === i ? 'selected' : '') + '>星期' + d + '</option>').join('') + '</select></div>' + (t.sourceText || t.sourceQuote ? '<details class="evidence"><summary>我当时说了什么</summary><blockquote>' + esc(t.sourceText || t.sourceQuote) + '</blockquote></details>' : '') + '<div class="action-row"><button class="primary" data-action="save-task" data-id="' + esc(t.id || '') + '" data-pending="' + isPending + '">保存任务</button></div>' + (t.id ? '<button class="text-button" data-action="buddy-select" data-id="'+esc(t.id)+'">'+icon('buddies')+' 让搭子监督这件事</button><div class="action-row"><button class="secondary danger-button" data-action="delete-task" data-id="' + esc(t.id) + '">删除任务</button></div>' : '');
}
function formValues() {
  const v = key => $('#edit-' + key)?.value || '';
  return { title: v('title').trim(), dueDate: v('dueDate'), dueTime: v('dueTime'), recurrence: v('recurrence'), category: v('category'), weekDay: v('recurrence') === 'weekly' ? Number(v('weekDay')) : null };
}
async function extract() {
  if (busy || listening || connection.testing) return;
  inputText = $('#taskInput')?.value.trim() || inputText.trim();
  if (inputText.length < 2) return toast('说出或输入一件想做的事吧');
  
  const text = inputText, now = new Date(), at = now.toISOString(), referenceDate = todayString(), referenceTime = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
  busy = true; errorMessage = ''; render();
  try {
    const result = await extractDirect({ text, referenceDate, referenceTime, existingTasks: state.tasks.filter(t => t.status !== 'done') });
    const source = { text, at, sourceId: result.sourceId };
    if (!result.tasks?.length) { errorMessage = result.questions?.join('；') || '这句话里没有找到明确的待办，可以换个说法。'; state.history.unshift({ id:id(), text, at, result:errorMessage, kind:result.mode==='local'?'local':'live', model:result.model, elapsedMs:result.elapsedMs, usage:result.usage }); state.history=state.history.slice(0,200); persist(); return; }
    const ready = result.tasks.filter(t => !t.questions?.length), uncertain = result.tasks.filter(t => t.questions?.length);
    lastUndo = structuredClone(state);
    const applied = commitTasks(state.tasks, ready, source, id); state.tasks = applied.tasks;
    if (applied.changes.length) { const savedTask = state.tasks.find(t => t.id === applied.changes[0].id); if (savedTask && savedTask.dueDate) selectedDate = savedTask.dueDate; }
    const resultText = applied.changes.length ? '已' + (applied.changes.some(c => c.kind === 'update') ? '更新 / 添加 ' : '添加 ') + applied.changes.length + ' 项任务' : applied.skipped ? '已在清单中，没有重复添加' : '等待确认';
    state.history.unshift({ id: id(), text, at, result: resultText + (uncertain.length ? '，另有 ' + uncertain.length + ' 项待确认' : ''), kind: result.mode === 'local' ? 'local' : 'live', model: result.model, elapsedMs: result.elapsedMs, usage: result.usage }); state.history = state.history.slice(0, 200);
    saveAndSync(); latest = { title: resultText, detail: ready.some(t => t.dueTime) ? (window.NativeBridge ? '可以点开任务核对提醒时间。' : '安装到安卓手机后可设置系统提醒。') : '没有具体时刻的任务，仅加入清单。' }; inputText = '';
    if (uncertain.length) { pending = { drafts: uncertain, source, index: 0 }; }
  } catch (error) { if (error.code === 'NEEDS_API_KEY') { setPage('settings'); toast(error.message); return; } errorMessage = error.name === 'TimeoutError' ? '理解这句话超时了，原话还在，可以重试。' : error.message || '连接失败，请检查服务'; }
  finally { busy = false; render(); if (pending) openPending(); }
}
function openPending() {
  const p = pending; if (!p) return;
  const t = p.drafts[p.index];
  openModal(taskForm({ ...t, sourceText: p.source.text }, '确认一下，再交给念办', true)); pending = p;
}
function startVoice() {
  if (busy || connection.testing) return;
  if (window.NativeBridge) { if (listening) NativeBridge.stopVoice(); else { listening = true; partial = ''; errorMessage = ''; render(); NativeBridge.startVoice(); } return; }
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) { toast('浏览器不支持语音。安卓安装版内置中文离线识别。'); $('#taskInput')?.focus(); return; }
  const recognition = new Speech(); recognition.lang = 'zh-CN'; recognition.interimResults = true;
  listening = true; render();
  recognition.onresult = e => { const result = e.results[e.results.length - 1]; partial = result[0].transcript; const live = $('.live-transcript'); if (live) live.textContent = partial; if (result.isFinal) { inputText = partial; recognition.stop(); } };
  recognition.onerror = () => { listening = false; toast('没有听清，可以再说一次或使用文字输入'); render(); };
  recognition.onend = () => { listening = false; render(); if (inputText) extract(); };
  recognition.start();
}
window.onNativeEvent = event => {
  if(buddy.event(event))return;
  if(event.type==='state-resume'){try{const saved=NativeBridge.loadState();if(saved){state={...state,...JSON.parse(saved)};if(!busy&&!listening)render();}}catch{}buddy.sync(false);return;}
  if(event.type==='widget-open'){handleWidgetAction(event.message);return;}
  if(event.type==='weixin-status'){
    const old=state.weixin||{};state.weixin={cursor:0,bridgeId:'',importedIds:old.importedIds||[]};persist();
    weixinError='';if(page==='settings')render();if(event.message)toast(event.message);syncWeixin(false);return;
  }
  if(event.type==='weixin-resume'){syncWeixin(false);return;}
  if(event.type==='weixin-error'){weixinBusy=false;weixinResetting=false;weixinError=event.message||'微信同步失败';if(weixinManual)toast(weixinError);if(page==='settings')render();return;}
  if(event.type==='weixin-result'){
    if(!weixinInfo().configured){weixinBusy=false;return;}
    try{
      const payload=event.data;
      if(state.weixin?.bridgeId&&state.weixin.bridgeId!==payload.bridgeId&&(state.weixin.cursor||0)>0&&!weixinResetting){weixinResetting=true;NativeBridge.pullWeixinTasks(0);return;}
      const merged=mergeWeixinInbox(state,payload),previous=state;state=merged.state;
      try{persist();}catch(e){state=previous;throw e;}
      syncReminders();if(merged.added){lastUndo=null;latest={title:'从微信同步了 '+merged.added+' 件事',detail:'已进入手机清单；有明确时刻的任务按系统权限安排提醒。'};}
      weixinBusy=false;weixinError='';weixinResetting=false;
      if(page==='settings'||merged.added&&!busy&&!listening)render();if(weixinManual)toast(merged.added?'微信任务已同步到手机':'已同步，没有新增任务');
      if(merged.hasMore)setTimeout(()=>syncWeixin(false),100);
    }catch(e){weixinBusy=false;weixinResetting=false;weixinError=e.message||'微信同步数据有误，尚未保存';if(weixinManual)toast(weixinError);if(page==='settings')render();}return;
  }
  if (handleAiEvent(event)) return;
  if (event.type === 'api-status') { checkConnection(); if (page === 'settings') render(); if (event.message) toast(event.message); return; }
  if (event.type === 'voice-partial') { partial = event.text; const live = $('.live-transcript'); if (live) live.textContent = partial; }
  else if (event.type === 'voice-status') { partial = event.message; const live = $('.live-transcript'); if (live) live.textContent = partial; }
  else if (event.type === 'voice-result') { listening = false; inputText = event.text; render(); if (inputText) extract(); }
  else if (event.type === 'voice-error') { listening = false; errorMessage = event.message; render(); }
  else if (event.type === 'reminder-status') { if (page === 'settings') render(); }
};
document.addEventListener('input', e => { if (e.target.id === 'taskInput') inputText = e.target.value; });
document.addEventListener('click', async e => {
  const pageButton = e.target.closest('[data-page]'); if (pageButton) { if (listening) return toast('先结束这次录音'); setPage(pageButton.dataset.page); return; }
  const example = e.target.closest('[data-example]'); if (example) { inputText = example.dataset.example; render(); $('#taskInput')?.focus(); return; }
  const button = e.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action, taskId = button.dataset.id;
  try {
    if(await buddy.action(button))return;
    if(action==='add-widget'){if(window.NativeBridge?.addWidget)NativeBridge.addWidget();else toast('安装安卓版后，可以添加到手机桌面');return;}
    if (action === 'close') closeModal();
    if (action === 'extract') await extract();
    if (action === 'voice') startVoice();
    if (action === 'date') { selectedDate = button.dataset.date; render(); }
    if (action === 'manual') openModal(taskForm({ title: '', dueDate: selectedDate, dueTime: '', recurrence: 'none', category: 'life' }, '记下一件小事'));
    if (action === 'edit') { const t = state.tasks.find(t => t.id === taskId); if (t) openModal(taskForm(t, '调整这件事')); }
    if (action === 'toggle') { const target=state.tasks.find(t=>t.id===taskId),day=button.dataset.date||todayString();if(target?.recurrence!=='none'&&(!target||!occursOn(target,day)||day>todayString()))return toast('请在这项重复任务的实际日期打卡'); state.tasks = state.tasks.map(t => t.id === taskId ? toggleDone(t, button.dataset.date || todayString()) : t); saveAndSync(); render(); }
    if (action === 'save-task') {
      const values = formValues(); if (!values.title) return toast('任务名称还没填');
      if (values.dueTime && !values.dueDate) return toast('设置提醒时间前，请先选择日期');
      if (values.recurrence !== 'none' && !values.dueDate) return toast('请为重复任务选择开始日期');
      if (values.dueDate && values.dueTime && new Date(values.dueDate + 'T' + values.dueTime) <= new Date()) return toast('这个提醒时间已过去，请调整或清除提醒时刻');
      lastUndo = structuredClone(state);
      const now = new Date().toISOString();
      if (button.dataset.pending === 'true' && pending) {
        const p = pending, d = { ...p.drafts[p.index], ...values, questions: [] };
        if (d.intent === 'update' && !d.targetTaskId) return toast('无法确定修改对象，请关闭后手动编辑对应任务');
        state.tasks = commitTasks(state.tasks, [d], p.source, id).tasks; p.index++;
        const record=state.history.find(h=>h.at===p.source.at&&h.text===p.source.text);
        if(record)record.result=p.index<p.drafts.length?'已补充确认 '+p.index+' 项，另有 '+(p.drafts.length-p.index)+' 项待确认':'补充确认已完成，任务已保存在清单';
        saveAndSync(); if (p.index < p.drafts.length) { pending = p; openPending(); } else closeModal();
      } else if (taskId) { state.tasks = state.tasks.map(t => t.id === taskId ? { ...t, ...values, updatedAt: now, versions: [...(t.versions || []), { ...t, versions: [] }] } : t); saveAndSync(); closeModal(); }
      else { const d = { ...values, priority: 'normal', intent: 'create', questions: [], sourceQuote: values.title }; const source = { text: values.title, sourceId: 'manual-' + id(), at: now }; const applied = commitTasks(state.tasks, [d], source, id); state.tasks = applied.tasks; state.history.unshift({ id: id(), text: values.title, at: now, result: applied.skipped ? '任务已存在，没有重复添加' : '已手动添加任务', kind: 'manual' }); saveAndSync(); closeModal(); }
      latest = { title: '已记下这件事', detail: values.dueTime ? dateLabel(values.dueDate) + ' ' + values.dueTime + ' · 可随时调整' : '已加入清单，未设置具体时刻提醒' }; render(); toast('已保存');
    }
    if (action === 'delete-task') { const t = state.tasks.find(t => t.id === taskId); if (!t) return; openModal('<h2>移除这件事？</h2><p>' + esc(t.title) + '</p><p class="config-help">对应的提醒也会取消。保存后可用“撤销”恢复。</p><div class="action-row"><button class="secondary" data-action="close">保留</button><button class="secondary danger-button" data-action="confirm-delete" data-id="' + esc(taskId) + '">移除任务</button></div>'); }
    if (action === 'confirm-delete') { lastUndo = structuredClone(state); state.tasks = state.tasks.filter(t => t.id !== taskId); saveAndSync(); closeModal(); latest = { title: '已移除任务', detail: '对应的系统提醒已同步取消。' }; render(); }
    if (action === 'undo' && lastUndo) { state = {...lastUndo,buddy:state.buddy,widgetRevision:state.widgetRevision,widgetChanges:state.widgetChanges}; lastUndo = null; saveAndSync(); latest = { title: '已撤销刚才的修改', detail: '任务已恢复到修改前。' }; render(); }
    if (action === 'configure-api' && window.NativeBridge) NativeBridge.configureApiKey();
    if(action==='configure-weixin'&&window.NativeBridge?.configureWeixin)NativeBridge.configureWeixin();
    if(action==='clear-weixin'&&window.NativeBridge?.clearWeixin)NativeBridge.clearWeixin();
    if(action==='sync-weixin')syncWeixin(true);
    if (action === 'clear-api' && window.NativeBridge) NativeBridge.clearApiKey();
    if (action === 'test-api' && !connection.testing) {
      connection.testing = true; render();
      try { const result = await testDirect(); toast('DeepSeek 连接成功 · ' + (result.elapsedMs / 1000).toFixed(1) + ' 秒'); }
      catch (error) { toast(error.message || '连接失败，请检查手机网络与密钥'); }
      finally { connection.testing = false; await checkConnection(); render(); }
    }
    if (action === 'notification-settings' && window.NativeBridge) NativeBridge.requestNotifications();
    if (action === 'exact-settings' && window.NativeBridge) NativeBridge.requestExactAlarms();
    if (action === 'test-notification' && window.NativeBridge) { NativeBridge.testNotification(); toast('已请求发送测试通知，请查看通知栏'); }
    if (action === 'export') { const text = exportMarkdown(state.tasks); if (window.NativeBridge) NativeBridge.exportText(text); else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); a.download = '念办_我的清单.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); } }
    if (action === 'licenses') openModal('<h2>开源组件</h2><p class="config-help">Vosk Android 0.3.75 / Apache-2.0<br>中文模型 vosk-model-small-cn-0.22 / Apache-2.0<br>JNA 5.18.1 / 采用 Apache-2.0 许可<br><br>完整许可和组件来源随 APK 一并提供。语音识别在设备本地完成，不上传录音；常见指令本地处理，仅复杂表达发送文字给 DeepSeek。</p>');
  } catch (error) { toast(error.message || '操作没有完成，请重试'); }
});
$('#connectionBadge').addEventListener('click', () => setPage('settings'));
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
window.addEventListener('hashchange', () => { const next = location.hash.slice(1); if (['today','all','buddy','history','settings'].includes(next) && next !== page) { page = next; render(); } });
window.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
const buddy=createBuddy({getState:()=>state,persist,render:()=>{if(page==='buddy')render();},toast,openModal,closeModal,esc,icon,navigate:()=>setPage('buddy')});
async function init() {
  render(); await checkConnection(); persist(); syncReminders();
  syncWeixin(false); buddy.sync(false);
  if(window.NativeBridge?.widgetAction)handleWidgetAction(NativeBridge.widgetAction());
}
init();
document.addEventListener('visibilitychange',()=>{if(!document.hidden){syncWeixin(false);buddy.sync(false);}});
setInterval(()=>{if(!document.hidden){syncWeixin(false);buddy.sync(false);}},60000);
