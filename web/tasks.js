export function todayString() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); }
export function dateOffset(date, days) { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + days); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); }
export function occursOn(t, date) {
  if (!t.dueDate || date < t.dueDate) return false;
  if (t.recurrence === 'daily') return true;
  const weekday = new Date(date + 'T12:00:00').getDay();
  if (t.recurrence === 'weekdays') return weekday >= 1 && weekday <= 5;
  if (t.recurrence === 'weekly') return weekday === t.weekDay;
  return t.dueDate === date;
}
export function isDone(t, date) { return t.recurrence === 'none' ? t.status === 'done' : (t.completedDates || []).includes(date); }
export function toggleDone(task, date) {
  const t = structuredClone(task);
  if (t.recurrence !== 'none') { const set = new Set(t.completedDates || []); set.has(date) ? set.delete(date) : set.add(date); t.completedDates = [...set]; }
  else t.status = t.status === 'done' ? 'todo' : 'done';
  return t;
}
export function normalizeTitle(v) { return String(v).replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase(); }
export function commitTasks(tasks, drafts, source, makeId) {
  const next = structuredClone(tasks), changes = []; let skipped = 0;
  for (const d of drafts) {
    if (!d.title?.trim()) throw new Error('任务名称不能为空');
    if (d.intent === 'update') {
      const index = next.findIndex(t => t.id === d.targetTaskId);
      if (index < 0) throw new Error('未找到要修改的任务');
      const old = next[index];
      next[index] = { ...old, ...d, id: old.id, sourceText: source.text, sourceId: source.sourceId, updatedAt: source.at, versions: [...(old.versions || []), { ...old, versions: [] }] };
      changes.push({ kind: 'update', id: old.id, title: d.title });
    } else {
      const duplicate = next.some(t => t.status !== 'archived' && normalizeTitle(t.title) === normalizeTitle(d.title) && t.dueDate === d.dueDate && t.dueTime === d.dueTime && t.recurrence === d.recurrence);
      if (duplicate) { skipped++; continue; }
      const task = { ...d, id: makeId(), status: 'todo', completedDates: [], sourceText: source.text, sourceId: source.sourceId, createdAt: source.at, updatedAt: source.at, versions: [] };
      next.unshift(task); changes.push({ kind: 'create', id: task.id, title: task.title });
    }
  }
  return { tasks: next, changes, skipped };
}
export function exportMarkdown(tasks) { return '# 念办 · 我的清单\n\n' + tasks.map(t => '- [' + (t.status === 'done' ? 'x' : ' ') + '] ' + t.title + '｜' + (t.dueDate || '未安排日期') + ' ' + (t.dueTime || '') + (t.recurrence !== 'none' ? '｜重复：' + t.recurrence : '') + '\n  原话：' + (t.sourceText || '')).join('\n\n'); }
