import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedTasks} from '../web/buddy.js';
test('only explicitly selected tasks and allowlisted fields leave local storage',()=>{
  const tasks=[{id:'share',title:'Read',recurrence:'daily',dueDate:'2026-10-22',sourceText:'private speech',sourceId:'private-ref',versions:[{apiKey:'secret'}],status:'todo',completedDates:[]},{id:'private',title:'private title'}];
  const result=sharedTasks(tasks,['share']);assert.equal(result.length,1);assert.equal(result[0].localId,'share');assert.equal(result[0].sourceText,undefined);assert.equal(result[0].versions,undefined);assert.equal(JSON.stringify(result).includes('private'),false);
});
test('deleted and archived tasks are not republished by old sharing IDs',()=>{assert.deepEqual(sharedTasks([{id:'a',status:'archived'}],['a','deleted']),[]);});
