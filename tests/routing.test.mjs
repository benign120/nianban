import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractDirect,handleAiEvent} from '../web/ai.js';
const body=text=>({text,referenceDate:'2026-10-21',referenceTime:'10:00',existingTasks:[{id:'resume',title:'修改简历',dueDate:'2026-10-21',dueTime:'15:00'}]});
test('Simple instruction works without a key or native network call',async()=>{globalThis.window={};const r=await extractDirect(body('明天下午三点修改简历'));assert.equal(r.mode,'local');assert.equal(r.tasks[0].dueTime,'15:00');assert.equal(r.usage.inputTokens,0)});
test('Ambiguous hour stays local for explicit confirmation',async()=>{globalThis.window={};const r=await extractDirect(body('明天三点看书'));assert.equal(r.mode,'local');assert.equal(r.tasks[0].dueTime,'');assert.ok(r.tasks[0].questions.length)});
test('Complex instruction requests a key rather than being guessed locally',async()=>{globalThis.window={};await assert.rejects(extractDirect(body('明天下午三点交报告，晚上八点看书')),e=>e.code==='NEEDS_API_KEY')});
test('New multi-task input goes to AI once without unrelated task context',async()=>{
 let calls=0,captured;globalThis.window={NativeBridge:{}};globalThis.NativeBridge={apiStatus:()=>JSON.stringify({configured:true}),extractAI:(requestId,payload)=>{calls++;captured=JSON.parse(payload);queueMicrotask(()=>handleAiEvent({type:'ai-result',requestId,data:{content:JSON.stringify({tasks:[{title:'交报告',dueDate:'2026-10-22',dueTime:'15:00',dateText:'明天',timeText:'下午三点',recurrence:'none',sourceQuote:'明天下午三点交报告',questions:[]}]}),model:'test-fixture',elapsedMs:10}}))}};window.NativeBridge=NativeBridge;
 const r=await extractDirect(body('明天下午三点交报告，晚上八点看书'));assert.equal(calls,1);assert.equal(r.mode,'direct');assert.deepEqual(captured.input.existingTasks,[]);
});
test('Modification request keeps existing task identifiers',async()=>{
 let captured;globalThis.NativeBridge={apiStatus:()=>JSON.stringify({configured:true}),extractAI:(requestId,payload)=>{captured=JSON.parse(payload);queueMicrotask(()=>handleAiEvent({type:'ai-result',requestId,data:{content:JSON.stringify({tasks:[{title:'修改简历',dueDate:'2026-10-22',dueTime:'16:00',dateText:'明天',timeText:'下午四点',recurrence:'none',intent:'update',targetTaskId:'resume',sourceQuote:'把修改简历改到明天下午四点',questions:[]}]}),model:'test-fixture',elapsedMs:10}}))}};globalThis.window={NativeBridge};
 const r=await extractDirect(body('把修改简历改到明天下午四点'));assert.equal(captured.input.existingTasks[0].id,'resume');assert.equal(r.tasks[0].targetTaskId,'resume');
});
test('Even when AI is configured, simple commands never enter the native API bridge',async()=>{
 let calls=0;globalThis.NativeBridge={apiStatus:()=>JSON.stringify({configured:true}),extractAI:()=>{calls++}};globalThis.window={NativeBridge};await extractDirect(body('十分钟后喝水'));await extractDirect(body('每天晚上十点看书'));assert.equal(calls,0);
});
