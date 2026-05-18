import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// Must be set before any db import
process.env.DB_PATH = ':memory:';

import { getDb } from '../../db/index.js';
import { processBuy, processSell } from '../fifoService.js';

const db = getDb();

function setup() {
  db.prepare('INSERT OR IGNORE INTO users(tg_id,first_name,created_at) VALUES(1,\'Test\',?)').run(Date.now());
  const w = db.prepare('INSERT INTO wallets(user_id,address,created_at) VALUES(1,\'0xtest\',?)').run(Date.now());
  return w.lastInsertRowid;
}

let walletId;

function insertTrade(type, tokenAddr, amount, priceUsd, gasUsd = 0, ts = 1000) {
  const r = db.prepare(
    'INSERT INTO trades(wallet_id,chain,tx_hash,timestamp,type,token_address,token_symbol,amount,price_usd,gas_usd) VALUES(?,\'eth\',?,?,?,?,\'TST\',?,?,?)'
  ).run(walletId, `0x${Math.random().toString(36).slice(2)}`, ts, type, tokenAddr, amount, priceUsd, gasUsd);
  return db.prepare('SELECT * FROM trades WHERE id=?').get(r.lastInsertRowid);
}

describe('FIFO Engine', () => {
  before(() => { walletId = setup(); });

  it('Buy creates an open lot', () => {
    const trade = insertTrade('buy', '0xtoken1', 100, 1.0, 0, 1000);
    processBuy(trade);
    const lot = db.prepare('SELECT * FROM open_lots WHERE wallet_id=? AND token_address=?').get(walletId, '0xtoken1');
    assert.ok(lot, 'lot should exist');
    assert.equal(lot.amount, 100);
    assert.equal(lot.cost_per_unit_usd, 1.0);
  });

  it('Sell against lot computes correct PnL', () => {
    // Buy 100 @ $1 with $0.5 gas → cost_per_unit = (100*1 + 0.5)/100 = 1.005
    const buy = insertTrade('buy', '0xtoken2', 100, 1.0, 0.5, 2000);
    processBuy(buy);
    // Sell 100 @ $2 with $0.3 gas → proceeds = 100*2 - 0.3 = 199.7; pnl = 199.7 - 100.5 = 99.2
    const sell = insertTrade('sell', '0xtoken2', 100, 2.0, 0.3, 3000);
    processSell(sell);
    const pnl = db.prepare('SELECT * FROM realized_pnl WHERE wallet_id=? AND token_address=?').get(walletId, '0xtoken2');
    assert.ok(pnl, 'pnl record should exist');
    assert.ok(Math.abs(pnl.pnl_usd - 99.2) < 0.01, `Expected ~99.2 got ${pnl.pnl_usd}`);
  });

  it('FIFO partial sell consumes oldest lots first', () => {
    const token = '0xtoken3';
    const b1 = insertTrade('buy', token, 100, 1.0, 0, 1000);
    processBuy(b1);
    const b2 = insertTrade('buy', token, 100, 2.0, 0, 2000);
    processBuy(b2);
    // Sell 150 @ $3 → uses all 100@$1 + 50@$2 → cost=200, proceeds=450, pnl=250
    const sell = insertTrade('sell', token, 150, 3.0, 0, 3000);
    processSell(sell);
    const pnl = db.prepare('SELECT * FROM realized_pnl WHERE wallet_id=? AND token_address=?').get(walletId, token);
    assert.ok(Math.abs(pnl.pnl_usd - 250) < 0.01, `Expected 250 got ${pnl.pnl_usd}`);
    const remaining = db.prepare('SELECT SUM(amount) as amt FROM open_lots WHERE wallet_id=? AND token_address=?').get(walletId, token);
    assert.ok(Math.abs(remaining.amt - 50) < 0.001, `Expected 50 remaining got ${remaining.amt}`);
  });

  it('Sell without lots records unknown_basis', () => {
    const token = '0xtoken4';
    const sell = insertTrade('sell', token, 50, 5.0, 0, 5000);
    processSell(sell);
    const pnl = db.prepare('SELECT * FROM realized_pnl WHERE wallet_id=? AND token_address=?').get(walletId, token);
    assert.ok(pnl, 'pnl record should exist');
    assert.equal(pnl.notes, 'unknown_basis');
  });

  it('Buy with null price skips lot creation', () => {
    const token = '0xtoken5';
    const trade = insertTrade('buy', token, 100, null, 0, 6000);
    trade.price_usd = null;
    processBuy(trade);
    const lot = db.prepare('SELECT * FROM open_lots WHERE wallet_id=? AND token_address=?').get(walletId, token);
    assert.equal(lot, undefined, 'no lot should be created for null price');
  });
});
