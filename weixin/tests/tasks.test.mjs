import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.mjs';
import { createTaskHandler, understand, clock } from '../tasks.mjs';
import { validateInput, normalizeOutput } from '../../web/agent.js';
import { mergeWeixinInbox } from '../../web/weixin.js';
const now=()=>new Date('2026-10-21T02:00:00Z');
const input=text=>validateInput({text,...clock(now()),existingTasks:[]});
function setup(options={}){const store=new Store(':memory:');return {store,handle:createTaskHandler({store,enabled:()=>true,now,...options})};}
test('connection-test mode creates no tasks and calls no AI',async()=>{
 const {store,handle}=setup({enabled:()=>false,parse:()=>{throw Error('must not parse')}});assert.match(await handle({id:'1',text:'明天下午三点交报告'}),/尚未创建/);assert.equal(store.existing().length,0);store.close();
});
test('simple instruction does not need a key or model request',async()=>{
 const r=await understand(input('明天下午三点提醒我修改简历'),'',()=>{throw Error('network forbidden')});assert.equal(r.mode,'local');assert.equal(r.tasks[0].dueTime,'15:00');assert.equal(r.tasks[0].dueDate,'2026-10-22');
});
test('task persists once, and repeated delivery returns same reply without parsing',async()=>{
 let calls=0;const {store,handle}=setup({parse:async(i,k)=>{calls++;return understand(i,k)}});const m={id:'1',text:'明天下午三点修改简历'};const a=await handle(m),b=await handle(m);assert.equal(a,b);assert.match(a,/手机同步后/);assert.equal(calls,1);assert.equal(store.existing().length,1);assert.equal(store.inbox().items[0].task.origin,'weixin');store.close();
});
test('a resent same task with a different message id is not duplicated',async()=>{
 const {store,handle}=setup();await handle({id:'1',text:'明天下午三点修改简历'});assert.match(await handle({id:'2',text:'明天下午三点修改简历'}),/没有重复添加/);assert.equal(store.existing().length,1);store.close();
});
test('ambiguous clock stays pending and creates no alarm-ready task',async()=>{
 const {store,handle}=setup();assert.match(await handle({id:'1',text:'明天三点交报告'}),/需要确认/);assert.ok(store.pending());assert.equal(store.existing().length,0);await handle({id:'2',text:'取消待确认'});assert.equal(store.pending(),null);store.close();
});
test('supplement preserves original reference clock and saves only confirmed tasks',async()=>{
 const {store,handle}=setup({parse:async i=>i.text.startsWith('上一条')?normalizeOutput({summary:'',questions:[],tasks:[{title:'交报告',dueDate:'2026-10-22',dueTime:'15:00',dateText:'明天',timeText:'下午三点',sourceQuote:'明天三点交报告',questions:[],recurrence:'none'}]},i):understand(i,'')});
 await handle({id:'1',text:'明天三点交报告'});assert.match(await handle({id:'2',text:'补充 下午三点'}),/已记下/);assert.equal(store.existing()[0].dueTime,'15:00');assert.equal(store.pending(),null);store.close();
});
test('change/delete requests do not create a replacement or call the model',async()=>{
 const {store,handle}=setup({parse:()=>{throw Error('must not parse')}});assert.match(await handle({id:'1',text:'把交报告改到后天'}),/没有新增/);assert.equal(store.existing().length,0);store.close();
});
test('model failure preserves stored tasks, does not cache success, and permits resend',async()=>{
 const {store,handle}=setup({parse:async()=>{throw Error('DeepSeek 暂时不可用')}});assert.match(await handle({id:'1',text:'明天下午三点交报告'}),/尚未新增/);assert.equal(store.message('1'),undefined);assert.equal(store.existing().length,0);store.close();
});
test('task and message result are atomic when commit fails',async()=>{
 const store=new Store(':memory:'),r=await understand(input('明天下午三点交报告'),'');assert.throws(()=>store.commit('1',r.tasks,{text:input('明天下午三点交报告').text,sourceId:r.sourceId,at:now().toISOString()},null,()=>{throw Error('reply failed')}));assert.equal(store.existing().length,0);assert.equal(store.message('1'),undefined);store.close();
});
test('complex expressions use the model and never send unrelated existing tasks',async()=>{
 const text='明天下午三点交报告，然后晚上八点读书';let body;const i={...input(text),existingTasks:[{id:'private',title:'私人事项'}]};const result=await understand(i,'dummy',async(u,o)=>{body=JSON.parse(o.body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({tasks:[],questions:['请确认两项安排'],summary:''})}}]})}});assert.equal(result.mode,'direct');assert.deepEqual(JSON.parse(body.messages[1].content).existingTasks,[]);
});
test('inbox import preserves completed local task and original input state',async()=>{
 const {store,handle}=setup();await handle({id:'1',text:'明天下午三点交报告'});const payload=store.inbox(),remote=payload.items[0].task,local={...remote,status:'done'};const state={tasks:[local],history:[]};const result=mergeWeixinInbox(state,payload);assert.equal(result.added,0);assert.equal(result.state.tasks[0].status,'done');assert.equal(state.weixin,undefined);store.close();
});
test('import is idempotent and a locally deleted task is not recreated',async()=>{
 const {store,handle}=setup();await handle({id:'1',text:'明天下午三点交报告'});const payload=store.inbox(),first=mergeWeixinInbox({tasks:[],history:[]},payload).state;assert.equal(first.tasks.length,1);first.tasks=[];first.weixin.cursor=0;const second=mergeWeixinInbox(first,payload);assert.equal(second.added,0);assert.equal(second.state.tasks.length,0);store.close();
});
test('malformed remote task aborts entire import and leaves local state unchanged',async()=>{
 const {store,handle}=setup();await handle({id:'1',text:'明天下午三点交报告'});const payload=store.inbox();payload.items[0].task.dueTime='99:99';const original={tasks:[],history:[]};assert.throws(()=>mergeWeixinInbox(original,payload));assert.deepEqual(original,{tasks:[],history:[]});store.close();
});
test('bad cursor or unconfirmed task cannot silently advance inbox cursor',async()=>{
 const {store,handle}=setup();await handle({id:'1',text:'明天下午三点交报告'});const payload=store.inbox();assert.throws(()=>mergeWeixinInbox({tasks:[],history:[]},{...payload,nextCursor:1000}));payload.items[0].task.questions=['待确认'];assert.throws(()=>mergeWeixinInbox({tasks:[],history:[]},payload));assert.throws(()=>store.inbox(-1));store.close();
});
test('parallel arrivals do not invoke two model operations',async()=>{
 let release,calls=0;const gate=new Promise(r=>release=r);const {store,handle}=setup({parse:async i=>{calls++;await gate;return understand(i,'')}});const a=handle({id:'1',text:'明天下午三点交报告'});assert.match(await handle({id:'2',text:'明天下午四点交报告'}),/上一条/);release();await a;assert.equal(calls,1);store.close();
});
test('delayed delivery resolves relative date from send time and asks about expired reminder',async()=>{
 const {store,handle}=setup();const reply=await handle({id:'delayed',text:'十分钟后提醒我喝水',sentAt:'2026-10-20T01:00:00Z'});assert.match(reply,/已经过去/);assert.equal(store.existing().length,0);store.close();
});
test('global clarification blocks saving otherwise apparently ready tasks',async()=>{
 const {store,handle}=setup({parse:async i=>{const r=await understand(i,'');return {...r,questions:['请确认这项安排是否执行']};}});assert.match(await handle({id:'global',text:'明天下午三点交报告'}),/需要确认/);assert.equal(store.existing().length,0);store.close();
});
