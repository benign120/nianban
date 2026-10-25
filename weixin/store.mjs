import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { normalizeTitle } from '../web/tasks.js';

export class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,reply TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tasks(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,data TEXT NOT NULL);');
    if (!this.get('bridgeId')) this.set('bridgeId', randomUUID());
  }
  get(k) { return this.db.prepare('SELECT v FROM meta WHERE k=?').get(k)?.v || ''; }
  set(k,v) { this.db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k,String(v)); }
  message(id) { return this.db.prepare('SELECT reply FROM messages WHERE id=?').get(id)?.reply; }
  existing() { return this.db.prepare('SELECT data FROM tasks ORDER BY seq DESC LIMIT 1000').all().map(r=>JSON.parse(r.data)); }
  pending() { try { return JSON.parse(this.get('pending')); } catch { return null; } }
  commit(id, drafts, source, pending, makeReply) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.message(id);
      if (previous !== undefined) { this.db.exec('ROLLBACK'); return previous; }
      const saved=[];
      for (const draft of drafts) {
        if (draft.intent !== 'create' || draft.questions?.length) throw new Error('只允许保存已确定的新增任务');
        const duplicate=this.existing().find(t=>normalizeTitle(t.title)===normalizeTitle(draft.title)&&t.dueDate===draft.dueDate&&t.dueTime===draft.dueTime&&t.recurrence===draft.recurrence&&t.weekDay===draft.weekDay);
        if (duplicate) continue;
        const task={...draft,id:'wx-'+randomUUID(),status:'todo',completedDates:[],versions:[],origin:'weixin',sourceText:source.text,sourceId:source.sourceId,createdAt:source.at,updatedAt:source.at};
        this.db.prepare('INSERT INTO tasks(id,data) VALUES(?,?)').run(task.id,JSON.stringify(task));saved.push(task);
      }
      this.set('pending',pending?JSON.stringify(pending):'');
      const reply=makeReply(saved);
      this.db.prepare('INSERT INTO messages(id,reply) VALUES(?,?)').run(id,reply);
      this.db.exec('COMMIT');return reply;
    } catch(e) { this.db.exec('ROLLBACK');throw e; }
  }
  remember(id,reply) { this.db.prepare('INSERT OR IGNORE INTO messages(id,reply) VALUES(?,?)').run(id,reply);return this.message(id); }
  inbox(after=0) {
    if (!Number.isSafeInteger(after)||after<0) throw new Error('同步游标无效');
    const items=this.db.prepare('SELECT seq,data FROM tasks WHERE seq>? ORDER BY seq LIMIT 100').all(after).map(r=>({seq:r.seq,task:JSON.parse(r.data)}));
    return { schemaVersion:1,bridgeId:this.get('bridgeId'),items,nextCursor:items.at(-1)?.seq||after,hasMore:items.length===100 };
  }
  close() { this.db.close(); }
}
