import { getDb } from '../db/index.js';
import { createWriteStream } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { getWalletStatsWithUnrealized } from './pnlService.js';

function formatDate(ts) {
  return new Date(ts * 1000).toISOString().replace('T', ' ').substring(0, 19);
}

export function generateCsv(walletIds) {
  const db = getDb();
  const placeholders = walletIds.map(() => '?').join(',');
  const trades = db.prepare(`
    SELECT t.*, w.address as wallet_address
    FROM trades t
    JOIN wallets w ON w.id = t.wallet_id
    WHERE t.wallet_id IN (${placeholders})
    ORDER BY t.timestamp ASC
  `).all(...walletIds);

  const header = 'Date,Type,Sent Amount,Sent Currency,Received Amount,Received Currency,Fee Amount,Fee Currency,TxHash,Notes';
  const rows = trades.map(t => {
    const date = formatDate(t.timestamp);
    const fee = t.gas_usd > 0 ? t.gas_usd.toFixed(6) : '';
    if (t.type === 'buy') {
      return `${date},Trade,,ETH,${t.amount},${t.token_symbol || t.token_address},${fee},ETH,${t.tx_hash},${t.notes || ''}`;
    } else {
      return `${date},Trade,${t.amount},${t.token_symbol || t.token_address},,ETH,,ETH,${t.tx_hash},${t.notes || ''}`;
    }
  });
  return [header, ...rows].join('\n');
}

export async function generateXlsx(walletIds) {
  const db = getDb();
  const placeholders = walletIds.map(() => '?').join(',');

  const trades = db.prepare(`
    SELECT t.chain, t.tx_hash, t.timestamp, t.type, t.token_symbol, t.token_address,
           t.amount, t.price_usd, t.gas_usd, t.notes
    FROM trades t WHERE t.wallet_id IN (${placeholders}) ORDER BY t.timestamp ASC
  `).all(...walletIds).map(t => ({
    Date: formatDate(t.timestamp),
    Chain: t.chain,
    TxHash: t.tx_hash,
    Type: t.type,
    Token: t.token_symbol || t.token_address,
    Amount: t.amount,
    PriceUSD: t.price_usd,
    GasUSD: t.gas_usd,
    Notes: t.notes || '',
  }));

  const realized = db.prepare(`
    SELECT rp.token_symbol, rp.amount, rp.cost_basis_usd, rp.proceeds_usd, rp.pnl_usd, rp.roi_pct, rp.holding_hours,
           t.timestamp as sell_date, t.chain, t.tx_hash
    FROM realized_pnl rp
    JOIN trades t ON t.id = rp.sell_trade_id
    WHERE rp.wallet_id IN (${placeholders})
    ORDER BY t.timestamp DESC
  `).all(...walletIds).map(r => ({
    Token: r.token_symbol,
    SellDate: formatDate(r.sell_date),
    Chain: r.chain,
    Amount: r.amount,
    CostBasisUSD: r.cost_basis_usd,
    ProceedsUSD: r.proceeds_usd,
    PnlUSD: r.pnl_usd,
    RoiPct: r.roi_pct ? r.roi_pct.toFixed(2) + '%' : '',
    HoldingHours: r.holding_hours,
    TxHash: r.tx_hash,
  }));

  const positions = db.prepare(`
    SELECT ol.token_symbol, ol.token_address, SUM(ol.amount) as amount, AVG(ol.cost_per_unit_usd) as avg_cost
    FROM open_lots ol WHERE ol.wallet_id IN (${placeholders})
    GROUP BY ol.token_address
  `).all(...walletIds).map(p => ({
    Token: p.token_symbol || p.token_address,
    Amount: p.amount,
    AvgCostUSD: p.avg_cost,
    TotalCostUSD: p.amount * p.avg_cost,
  }));

  const statsArr = await Promise.all(walletIds.map(id => getWalletStatsWithUnrealized(id)));
  const summary = [{
    TotalRealizedPnL: statsArr.reduce((s, x) => s + x.realizedPnl, 0),
    TotalUnrealizedPnL: statsArr.reduce((s, x) => s + (x.unrealizedPnl || 0), 0),
    TotalTrades: statsArr.reduce((s, x) => s + x.tradeCount, 0),
    Wins: statsArr.reduce((s, x) => s + x.wins, 0),
    Losses: statsArr.reduce((s, x) => s + x.losses, 0),
    GasSpent: statsArr.reduce((s, x) => s + x.gasSpent, 0),
  }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trades), 'Trades');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(realized), 'Realized PnL');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(positions), 'Open Positions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');

  const filePath = path.join(tmpdir(), `trades_${Date.now()}.xlsx`);
  XLSX.writeFile(wb, filePath);
  return filePath;
}
