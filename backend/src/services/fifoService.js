import { getDb } from '../db/index.js';
import { logger } from '../logger.js';

export function processBuy(trade) {
  if (trade.price_usd == null) return;
  const db = getDb();
  const costPerUnit = ((trade.amount * trade.price_usd) + (trade.gas_usd || 0)) / trade.amount;
  db.prepare(
    'INSERT INTO open_lots(wallet_id,token_address,token_symbol,amount,cost_per_unit_usd,acquired_at,buy_trade_id) VALUES(?,?,?,?,?,?,?)'
  ).run(trade.wallet_id, trade.token_address, trade.token_symbol || null, trade.amount, costPerUnit, trade.timestamp, trade.id);
}

export function processSell(trade) {
  if (trade.price_usd == null) return;
  const db = getDb();

  let remaining = trade.amount;
  let costBasis = 0;
  let firstAcquired = null;

  const lots = db.prepare(
    'SELECT * FROM open_lots WHERE wallet_id=? AND token_address=? ORDER BY acquired_at ASC'
  ).all(trade.wallet_id, trade.token_address);

  if (lots.length === 0) {
    db.prepare(
      'INSERT INTO realized_pnl(wallet_id,sell_trade_id,token_address,token_symbol,amount,cost_basis_usd,proceeds_usd,pnl_usd,roi_pct,holding_hours,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
    ).run(trade.wallet_id, trade.id, trade.token_address, trade.token_symbol || null, trade.amount, 0, trade.amount * trade.price_usd, 0, null, null, 'unknown_basis');
    return;
  }

  for (const lot of lots) {
    if (remaining <= 0) break;
    const used = Math.min(lot.amount, remaining);
    costBasis += used * lot.cost_per_unit_usd;
    if (firstAcquired == null) firstAcquired = lot.acquired_at;

    const newAmount = lot.amount - used;
    remaining -= used;

    if (newAmount <= 1e-12) {
      db.prepare('DELETE FROM open_lots WHERE id=?').run(lot.id);
    } else {
      db.prepare('UPDATE open_lots SET amount=? WHERE id=?').run(newAmount, lot.id);
    }
  }

  const matched = trade.amount - remaining;
  const proceeds = matched * trade.price_usd - (trade.gas_usd || 0);
  const pnl = proceeds - costBasis;
  const holdingHours = firstAcquired ? Math.floor((trade.timestamp - firstAcquired) / 3600) : null;

  db.prepare(
    'INSERT INTO realized_pnl(wallet_id,sell_trade_id,token_address,token_symbol,amount,cost_basis_usd,proceeds_usd,pnl_usd,roi_pct,holding_hours) VALUES(?,?,?,?,?,?,?,?,?,?)'
  ).run(
    trade.wallet_id, trade.id, trade.token_address, trade.token_symbol || null,
    matched, costBasis, proceeds, pnl,
    costBasis > 0 ? (pnl / costBasis) * 100 : null,
    holdingHours
  );
}

export function recomputeFifo(walletId) {
  const db = getDb();
  // Clear existing computed data
  db.prepare('DELETE FROM realized_pnl WHERE wallet_id=?').run(walletId);
  db.prepare('DELETE FROM open_lots WHERE wallet_id=?').run(walletId);

  const trades = db.prepare(
    'SELECT * FROM trades WHERE wallet_id=? ORDER BY timestamp ASC, id ASC'
  ).all(walletId);

  for (const trade of trades) {
    if (trade.type === 'buy') processBuy(trade);
    else processSell(trade);
  }
  logger.info({ walletId }, 'FIFO recomputed');
}
