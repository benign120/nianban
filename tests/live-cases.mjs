import assert from 'node:assert/strict';
export const cases=[
 {id:'tomorrow-afternoon',text:'明天下午三点提醒我修改简历',time:'10:00',check:r=>{assert.equal(r.tasks.length,1);assert.equal(r.tasks[0].dueDate,'2026-10-21');assert.equal(r.tasks[0].dueTime,'15:00');assert.equal(r.tasks[0].questions.length,0)}},
 {id:'cross-midnight',text:'十分钟后提醒我喝水',time:'23:55',check:r=>{assert.equal(r.tasks[0].dueDate,'2026-10-21');assert.equal(r.tasks[0].dueTime,'00:05')}},
 {id:'daily-after-current-time',text:'每天晚上十点提醒我读书二十分钟',time:'23:00',check:r=>{assert.equal(r.tasks[0].recurrence,'daily');assert.equal(r.tasks[0].dueDate,'2026-10-21');assert.equal(r.tasks[0].dueTime,'22:00')}},
 {id:'date-without-time',text:'明天记得读书二十分钟',time:'10:00',check:r=>{assert.equal(r.tasks[0].dueDate,'2026-10-21');assert.equal(r.tasks[0].dueTime,'')}},
 {id:'no-made-up-time',text:'找个时间给妈妈打电话',time:'10:00',check:r=>{assert.equal(r.tasks[0].dueDate,'');assert.equal(r.tasks[0].dueTime,'')}},
 {id:'multiple-tasks',text:'明天上午九点看书，后天下午两点买牛奶',time:'10:00',check:r=>{assert.equal(r.tasks.length,2);assert.ok(r.tasks.some(t=>t.dueDate==='2026-10-21'&&t.dueTime==='09:00'));assert.ok(r.tasks.some(t=>t.dueDate==='2026-10-22'&&t.dueTime==='14:00'))}},
 {id:'negative-command',text:'不要提醒我喝水',time:'10:00',check:r=>assert.equal(r.tasks.length,0)},
 {id:'update-existing',text:'把修改简历改到明天下午四点',time:'10:00',existing:[{id:'existing-resume',title:'修改简历',dueDate:'2026-10-20',dueTime:'15:00'}],check:r=>{assert.equal(r.tasks[0].intent,'update');assert.equal(r.tasks[0].targetTaskId,'existing-resume');assert.equal(r.tasks[0].dueDate,'2026-10-21');assert.equal(r.tasks[0].dueTime,'16:00')}}
];
