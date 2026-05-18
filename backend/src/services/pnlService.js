import { getDb } from '../db/index.js';
import { getCurrentPrices } from './priceService.js';

export function getWalletStats(walletId) {
  const db = getDb();

  const realized = db.prepare(
    'SELECT COALESCE(SUM(pnl_usd),0) as total, COUNT(*) as count FROM realized_pnl WHERE wallet_id=?'
  ).get(walletId);

  const wins = db.prepare(
    'SELECT COUNT(*) as c FROM realized_pnl WHERE wallet_id=? AND pnl_usd > 0'
  ).get(walletId).c;

  const losses = db.prepare(
    'SELECT COUNT(*) as c FROM realized_pnl WHERE wallet_id=? AND pnl_usd <= 0'
  ).get(walletId).c;

  const avgHold = db.prepare(
    'SELECT AVG(holding_hours) as avg FROM realized_pnl WHERE wallet_id=? AND holding_hours IS NOT NULL'
  ).get(walletId).avg;

  const gas = db.prepare(
    'SELECT COALESCE(SUM(gas_usd),0) as total FROM trades WHERE wallet_id=? AND type=\'buy\''
  ).get(walletId).total;

  const best = db.prepare(
    'SELECT token_symbol, pnl_usd, roi_pct FROM realized_pnl WHERE wallet_id=? ORDER BY pnl_usd DESC LIMIT 1'
  ).get(walletId);

  const worst = db.prepare(
    'SELECT token_symbol, pnl_usd, roi_pct FROM realized_pnl WHERE wallet_id=? ORDER BY pnl_usd ASC LIMIT 1'
  ).get(walletId);

  const tradeCount = db.prepare(
    'SELECT COUNT(DISTINCT tx_hash) as c FROM trades WHERE wallet_id=?'
  ).get(walletId).c;

  return {
    realizedPnl: realized.total,
    tradeCount,
    wins,
    losses,
    winrate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0,
    avgHoldHours: avgHold ? Math.round(avgHold) : 0,
    gasSpent: gas,
    best,
    worst,
  };
}

export async function getWalletStatsWithUnrealized(walletId) {
  const db = getDb();
  const base = getWalletStats(walletId);

  const lots = db.prepare(
    'SELECT token_address, token_symbol, SUM(amount) as amount, AVG(cost_per_unit_usd) as avg_cost, chain FROM open_lots ol LEFT JOIN wallets w ON w.id = ol.wallet_id WHERE ol.wallet_id=? GROUP BY token_address'
  ).all(walletId);

  // We need chain info for lots — get from trades
  const lotsWithChain = db.prepare(`
    SELECT ol.token_address, ol.token_symbol, SUM(ol.amount) as amount,
           AVG(ol.cost_per_unit_usd) as avg_cost,
           t.chain
    FROM open_lots ol
    JOIN trades t ON t.id = ol.buy_trade_id
    WHERE ol.wallet_id=?
    GROUP BY ol.token_address, t.chain
  `).all(walletId);

  if (lotsWithChain.length === 0) {
    return { ...base, unrealizedPnl: 0, openPositions: [] };
  }

  const tokens = lotsWithChain.map(l => ({ chain: l.chain, address: l.token_address }));
  const prices = await getCurrentPrices(tokens);

  let unrealized = 0;
  const openPositions = [];

  for (const lot of lotsWithChain) {
    const key = `${lot.chain}:${lot.token_address}`;
    const currentPrice = prices[key] || 0;
    const unreal = lot.amount * (currentPrice - lot.avg_cost);
    unrealized += unreal;
    openPositions.push({
      tokenAddress: lot.token_address,
      tokenSymbol: lot.token_symbol,
      amount: lot.amount,
      avgCost: lot.avg_cost,
      currentPrice,
      valueUsd: lot.amount * currentPrice,
      unrealizedPnl: unreal,
      unrealizedPct: lot.avg_cost > 0 ? ((currentPrice - lot.avg_cost) / lot.avg_cost) * 100 : 0,
      chain: lot.chain,
    });
  }

  return {
    ...base,
    unrealizedPnl: unrealized,
    totalPnl: base.realizedPnl + unrealized,
    openPositions,
  };
}

export async function getAggregatedStats(userId) {
  const db = getDb();
  const wallets = db.prepare('SELECT id FROM wallets WHERE user_id=?').all(userId);
  if (wallets.length === 0) return null;

  const allStats = await Promise.all(wallets.map(w => getWalletStatsWithUnrealized(w.id)));

  return allStats.reduce((acc, s) => ({
    realizedPnl: acc.realizedPnl + s.realizedPnl,
    unrealizedPnl: acc.unrealizedPnl + (s.unrealizedPnl || 0),
    totalPnl: acc.totalPnl + (s.totalPnl || s.realizedPnl),
    tradeCount: acc.tradeCount + s.tradeCount,
    wins: acc.wins + s.wins,
    losses: acc.losses + s.losses,
    gasSpent: acc.gasSpent + s.gasSpent,
    winrate: 0, // computed below
    avgHoldHours: 0, // computed below
    best: !acc.best || (s.best && s.best.pnl_usd > acc.best.pnl_usd) ? s.best : acc.best,
    worst: !acc.worst || (s.worst && s.worst.pnl_usd < acc.worst.pnl_usd) ? s.worst : acc.worst,
    openPositions: [...(acc.openPositions || []), ...(s.openPositions || [])],
    walletCount: wallets.length,
  }), {
    realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0, tradeCount: 0,
    wins: 0, losses: 0, gasSpent: 0, best: null, worst: null, openPositions: [], walletCount: 0,
  });
}

export function getTopTrades(walletIds, order = 'DESC', limit = 5, offset = 0) {
  const db = getDb();
  const placeholders = walletIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT rp.*, t.chain, t.tx_hash
    FROM realized_pnl rp
    JOIN trades t ON t.id = rp.sell_trade_id
    WHERE rp.wallet_id IN (${placeholders})
    ORDER BY rp.pnl_usd ${order}
    LIMIT ? OFFSET ?
  `).all(...walletIds, limit, offset);
}

export function getTokenDetails(walletIds, symbol) {
  const db = getDb();
  const placeholders = walletIds.map(() => '?').join(',');
  const trades = db.prepare(`
    SELECT * FROM trades
    WHERE wallet_id IN (${placeholders}) AND LOWER(token_symbol)=LOWER(?)
    ORDER BY timestamp DESC
    LIMIT 10
  `).all(...walletIds, symbol);

  const realized = db.prepare(`
    SELECT COALESCE(SUM(pnl_usd),0) as total, COUNT(*) as count
    FROM realized_pnl
    WHERE wallet_id IN (${placeholders}) AND LOWER(token_symbol)=LOWER(?)
  `).get(...walletIds, symbol);

  return { trades, realized };
}

export function getPnlTimeline(walletId) {
  const db = getDb();
  return db.prepare(`
    SELECT DATE(timestamp, 'unixepoch') as date, SUM(pnl_usd) as daily_pnl
    FROM realized_pnl rp
    JOIN trades t ON t.id = rp.sell_trade_id
    WHERE rp.wallet_id=?
    GROUP BY date
    ORDER BY date ASC
  `).all(walletId);
}
