import { getDb } from '../db/index.js';

export function upsertUser({ tg_id, username, first_name }) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tg_id);
  if (!existing) {
    db.prepare('INSERT INTO users(tg_id, username, first_name, created_at) VALUES(?,?,?,?)')
      .run(tg_id, username || null, first_name || null, Date.now());
    return { isNew: true };
  }
  db.prepare('UPDATE users SET username=?, first_name=? WHERE tg_id=?')
    .run(username || null, first_name || null, tg_id);
  return { isNew: false };
}

export function getUser(tg_id) {
  return getDb().prepare('SELECT * FROM users WHERE tg_id = ?').get(tg_id);
}
