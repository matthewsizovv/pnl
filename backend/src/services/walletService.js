import { getDb } from '../db/index.js';

export function getWallets(userId) {
  return getDb().prepare('SELECT * FROM wallets WHERE user_id = ? ORDER BY created_at ASC').all(userId);
}

export function getWallet(id) {
  return getDb().prepare('SELECT * FROM wallets WHERE id = ?').get(id);
}

export function getWalletByAddress(userId, address) {
  return getDb().prepare('SELECT * FROM wallets WHERE user_id = ? AND address = ?').get(userId, address.toLowerCase());
}

export function countWallets(userId) {
  return getDb().prepare('SELECT COUNT(*) as c FROM wallets WHERE user_id = ?').get(userId).c;
}

export function addWallet({ userId, address, label }) {
  const db = getDb();
  const now = Date.now();
  const result = db.prepare(
    'INSERT INTO wallets(user_id, address, label, created_at) VALUES(?,?,?,?)'
  ).run(userId, address.toLowerCase(), label || null, now);
  return db.prepare('SELECT * FROM wallets WHERE id = ?').get(result.lastInsertRowid);
}

export function updateWalletLabel(id, label) {
  getDb().prepare('UPDATE wallets SET label = ? WHERE id = ?').run(label, id);
}

export function deleteWallet(id) {
  getDb().prepare('DELETE FROM wallets WHERE id = ?').run(id);
}

export function updateSyncedBlock(id, chain, blockNumber) {
  const col = chain === 'eth' ? 'last_synced_block_eth' : 'last_synced_block_base';
  getDb().prepare(`UPDATE wallets SET ${col} = ?, last_synced_at = ? WHERE id = ?`)
    .run(blockNumber, Date.now(), id);
}

export function getUserWallet(userId, walletId) {
  return getDb().prepare('SELECT * FROM wallets WHERE id = ? AND user_id = ?').get(walletId, userId);
}
