import { getDb } from '../db/index.js';
import { logger } from '../logger.js';
import { getLatestBlock, getTransfersByAddress, getTransactionReceipt } from './alchemyProvider.js';
import { getPriceWithFallback, getHistoricalPrice } from './priceService.js';
import { isSpam } from './spamFilter.js';
import { processBuy, processSell } from './fifoService.js';
import * as walletService from './walletService.js';

const ETH_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const WETH_ETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const WETH_BASE = '0x4200000000000000000000000000000000000006';
const WBTC = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';

const CANONICAL = {
  [WETH_ETH]: ETH_ADDRESS,
  [WETH_BASE]: ETH_ADDRESS,
  [WBTC]: '0xbtc',
};

function canonicalize(addr) {
  return CANONICAL[addr?.toLowerCase()] || addr?.toLowerCase();
}

async function computeGasUsd(chain, txHash, timestampSec) {
  try {
    const receipt = await getTransactionReceipt(chain, txHash);
    if (!receipt) return 0;
    const gasUsed = parseInt(receipt.gasUsed, 16);
    const gasPrice = parseInt(receipt.effectiveGasPrice || receipt.gasPrice || '0', 16);
    const gasCostEth = (gasUsed * gasPrice) / 1e18;
    const ethPrice = await getHistoricalPrice(chain, ETH_ADDRESS, timestampSec) || 0;
    return gasCostEth * ethPrice;
  } catch {
    return 0;
  }
}

function getTimestamp(transfer) {
  const hex = transfer.metadata?.blockTimestamp;
  if (hex) return Math.floor(new Date(hex).getTime() / 1000);
  return Math.floor(Date.now() / 1000);
}

function getTokenAddress(transfer) {
  if (transfer.category === 'external' || transfer.asset === 'ETH') return ETH_ADDRESS;
  return transfer.rawContract?.address?.toLowerCase() || ETH_ADDRESS;
}

async function syncChain(wallet, chain) {
  const db = getDb();
  const address = wallet.address.toLowerCase();
  const fromBlock = chain === 'eth' ? (wallet.last_synced_block_eth || 0) : (wallet.last_synced_block_base || 0);

  const latestBlock = await getLatestBlock(chain);
  const toBlock = latestBlock - 10;

  if (toBlock <= fromBlock) {
    logger.info({ walletId: wallet.id, chain }, 'No new blocks');
    return { newTrades: 0 };
  }

  logger.info({ walletId: wallet.id, chain, fromBlock, toBlock }, 'Syncing');

  const [transfersOut, transfersIn] = await Promise.all([
    getTransfersByAddress(chain, address, fromBlock + 1, toBlock, 'from'),
    getTransfersByAddress(chain, address, fromBlock + 1, toBlock, 'to'),
  ]);

  // Dedup and group by tx_hash
  const allTransfers = [...transfersOut, ...transfersIn];
  const byTxHash = new Map();
  for (const t of allTransfers) {
    const key = `${t.hash}:${t.log?.index ?? ''}`;
    if (!byTxHash.has(t.hash)) byTxHash.set(t.hash, []);
    // Avoid exact duplicates
    const existing = byTxHash.get(t.hash);
    const isDup = existing.some(e => e.log?.index === t.log?.index && e.from === t.from && e.to === t.to);
    if (!isDup) existing.push(t);
  }

  let newTrades = 0;
  const insertTrade = db.prepare(
    'INSERT OR IGNORE INTO trades(wallet_id,chain,tx_hash,timestamp,type,token_address,token_symbol,amount,price_usd,gas_usd,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
  );

  for (const [txHash, group] of byTxHash) {
    const inT = group.filter(t => t.to?.toLowerCase() === address);
    const outT = group.filter(t => t.from?.toLowerCase() === address);
    const timestamp = getTimestamp(group[0]);

    if (inT.length > 0 && outT.length > 0) {
      // SWAP
      const bestOut = outT.reduce((a, b) => (b.value || 0) > (a.value || 0) ? b : a);
      const bestIn = inT.reduce((a, b) => (b.value || 0) > (a.value || 0) ? b : a);

      const addrOut = getTokenAddress(bestOut);
      const addrIn = getTokenAddress(bestIn);

      if (canonicalize(addrOut) === canonicalize(addrIn)) continue; // WETH wrap

      const gasUsd = await computeGasUsd(chain, txHash, timestamp);

      // Sell side
      const { price: priceOut, note: noteOut } = await getPriceWithFallback(chain, addrOut, timestamp);
      const amountOut = parseFloat(bestOut.value || 0);
      const symbolOut = bestOut.asset || null;

      if (!isSpam(symbolOut) && amountOut > 0) {
        const r1 = insertTrade.run(wallet.id, chain, txHash, timestamp, 'sell', addrOut, symbolOut, amountOut, priceOut, 0, noteOut);
        if (r1.changes > 0) {
          const trade = db.prepare('SELECT * FROM trades WHERE id=?').get(r1.lastInsertRowid);
          processSell(trade);
          newTrades++;
        }
      }

      // Buy side
      const { price: priceIn, note: noteIn } = await getPriceWithFallback(chain, addrIn, timestamp);
      const amountIn = parseFloat(bestIn.value || 0);
      const symbolIn = bestIn.asset || null;

      if (!isSpam(symbolIn) && amountIn > 0) {
        const r2 = insertTrade.run(wallet.id, chain, txHash, timestamp, 'buy', addrIn, symbolIn, amountIn, priceIn, gasUsd, noteIn);
        if (r2.changes > 0) {
          const trade = db.prepare('SELECT * FROM trades WHERE id=?').get(r2.lastInsertRowid);
          processBuy(trade);
          newTrades++;
        }
      }

    } else if (inT.length > 0 && outT.length === 0) {
      // Incoming transfer (airdrop, CEX withdrawal)
      for (const t of inT) {
        const addr = getTokenAddress(t);
        const symbol = t.asset || null;
        if (isSpam(symbol)) continue;
        const amount = parseFloat(t.value || 0);
        if (amount <= 0) continue;
        const { price, note } = await getPriceWithFallback(chain, addr, timestamp);
        const r = insertTrade.run(wallet.id, chain, txHash, timestamp, 'buy', addr, symbol, amount, price, 0, note);
        if (r.changes > 0) {
          const trade = db.prepare('SELECT * FROM trades WHERE id=?').get(r.lastInsertRowid);
          processBuy(trade);
          newTrades++;
        }
      }
    }
    // outT only (withdrawal) → skip
  }

  walletService.updateSyncedBlock(wallet.id, chain, toBlock);
  logger.info({ walletId: wallet.id, chain, newTrades }, 'Chain sync done');
  return { newTrades };
}

export async function fullSync(wallet) {
  const results = await Promise.allSettled([
    syncChain(wallet, 'eth'),
    syncChain(wallet, 'base'),
  ]);
  let total = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') total += r.value.newTrades;
    else logger.error({ err: r.reason }, 'Chain sync failed');
  }
  return { newTrades: total };
}

export async function incrementalSync(wallet) {
  return fullSync(wallet);
}
