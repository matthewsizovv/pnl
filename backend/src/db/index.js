import Database from 'better-sqlite3';
import path from 'path';
import { SCHEMA } from './schema.js';

let _db;

export function getDb() {
  if (!_db) {
    const dbPath = process.env.DB_PATH || './data/pnl.db';
    _db = new Database(dbPath);
    _db.exec(SCHEMA);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
