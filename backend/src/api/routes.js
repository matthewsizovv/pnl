import { jwtMiddleware } from './auth.js';
import * as walletService from '../services/walletService.js';
import * as pnlService from '../services/pnlService.js';
import * as syncService from '../services/syncService.js';
import { generateCsv, generateXlsx } from '../services/exportService.js';
import { getDb } from '../db/index.js';
import { logger } from '../logger.js';
import { readFileSync, unlinkSync, existsSync } from 'fs';

const SYNC_RATE = 10 * 60 * 1000;
const syncTimestamps = new Map();

function canSync(walletId) {
  const last = syncTimestamps.get(walletId);
  return !last || Date.now() - last > SYNC_RATE;
}

export async function registerRoutes(fastify) {
  // All protected routes require JWT
  fastify.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/auth')) return;
    return jwtMiddleware(req, reply);
  });

  // GET /api/wallets
  fastify.get('/api/wallets', async (req) => {
    const wallets = walletService.getWallets(req.user.tg_id);
    return wallets.map(w => ({
      ...w,
      addressShort: `${w.address.slice(0, 6)}…${w.address.slice(-4)}`,
    }));
  });

  // POST /api/wallets
  fastify.post('/api/wallets', async (req, reply) => {
    const { address, label } = req.body || {};
    if (!address) return reply.code(400).send({ error: { code: 'MISSING_ADDRESS', message: 'address required' } });

    const { ethers } = await import('ethers');
    if (!ethers.isAddress(address)) {
      return reply.code(400).send({ error: { code: 'INVALID_ADDRESS', message: 'Invalid Ethereum address' } });
    }

    if (walletService.countWallets(req.user.tg_id) >= 5) {
      return reply.code(400).send({ error: { code: 'WALLET_LIMIT', message: 'Max 5 wallets' } });
    }

    if (walletService.getWalletByAddress(req.user.tg_id, address)) {
      return reply.code(400).send({ error: { code: 'DUPLICATE', message: 'Wallet already added' } });
    }

    const wallet = walletService.addWallet({ userId: req.user.tg_id, address, label });
    syncService.fullSync(wallet).catch(err => logger.error({ err }, 'Background sync error'));
    return wallet;
  });

  // PATCH /api/wallets/:id
  fastify.patch('/api/wallets/:id', async (req, reply) => {
    const wallet = walletService.getUserWallet(req.user.tg_id, parseInt(req.params.id));
    if (!wallet) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } });
    const { label } = req.body || {};
    walletService.updateWalletLabel(wallet.id, label?.slice(0, 50));
    return { ok: true };
  });

  // DELETE /api/wallets/:id
  fastify.delete('/api/wallets/:id', async (req, reply) => {
    const wallet = walletService.getUserWallet(req.user.tg_id, parseInt(req.params.id));
    if (!wallet) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } });
    walletService.deleteWallet(wallet.id);
    return { ok: true };
  });

  // POST /api/wallets/:id/sync
  fastify.post('/api/wallets/:id/sync', async (req, reply) => {
    const wallet = walletService.getUserWallet(req.user.tg_id, parseInt(req.params.id));
    if (!wallet) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } });

    if (!canSync(wallet.id)) {
      return reply.code(429).send({ error: { code: 'RATE_LIMIT', message: 'Wait before syncing again' } });
    }

    syncTimestamps.set(wallet.id, Date.now());
    syncService.incrementalSync(wallet).catch(err => logger.error({ err }, 'Sync error'));
    return { ok: true, message: 'Sync started' };
  });

  // GET /api/wallets/:id/stats
  fastify.get('/api/wallets/:id/stats', async (req, reply) => {
    const wallet = walletService.getUserWallet(req.user.tg_id, parseInt(req.params.id));
    if (!wallet) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } });
    return pnlService.getWalletStatsWithUnrealized(wallet.id);
  });

  // GET /api/wallets/:id/trades
  fastify.get('/api/wallets/:id/trades', async (req, reply) => {
    const wallet = walletService.getUserWallet(req.user.tg_id, parseInt(req.params.id));
    if (!wallet) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } });

    const { cursor = 0, limit = 50, type, token } = req.query;
    const db = getDb();
    let query = 'SELECT * FROM trades WHERE wallet_id=?';
    const params = [wallet.id];
    if (type) { query += ' AND type=?'; params.push(type); }
    if (token) { query += ' AND LOWER(token_symbol)=LOWER(?)'; params.push(token); }
    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(Math.min(parseInt(limit) || 50, 100), parseInt(cursor) || 0);
    return db.prepare(query).all(...params);
  });

  // GET /api/wallets/:id/positions
  fastify.get('/api/wallets/:id/positions', async (req, reply) => {
    const wallet = walletService.getUserWallet(req.user.tg_id, parseInt(req.params.id));
    if (!wallet) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } });
    const stats = await pnlService.getWalletStatsWithUnrealized(wallet.id);
    return stats.openPositions || [];
  });

  // GET /api/wallets/:id/token/:symbol
  fastify.get('/api/wallets/:id/token/:symbol', async (req, reply) => {
    const wallet = walletService.getUserWallet(req.user.tg_id, parseInt(req.params.id));
    if (!wallet) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } });
    return pnlService.getTokenDetails([wallet.id], req.params.symbol);
  });

  // GET /api/wallets/:id/export
  fastify.get('/api/wallets/:id/export', async (req, reply) => {
    const wallet = walletService.getUserWallet(req.user.tg_id, parseInt(req.params.id));
    if (!wallet) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } });

    const format = req.query.format || 'csv';
    const date = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
      const csv = generateCsv([wallet.id]);
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="trades_${date}.csv"`)
        .send(csv);
    }

    if (format === 'xlsx') {
      const filePath = await generateXlsx([wallet.id]);
      const buf = readFileSync(filePath);
      if (existsSync(filePath)) unlinkSync(filePath);
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="trades_${date}.xlsx"`)
        .send(buf);
    }

    return reply.code(400).send({ error: { code: 'BAD_FORMAT', message: 'format must be csv or xlsx' } });
  });

  // GET /api/me/stats
  fastify.get('/api/me/stats', async (req) => {
    const stats = await pnlService.getAggregatedStats(req.user.tg_id);
    if (!stats) return { realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0, tradeCount: 0, walletCount: 0 };
    return stats;
  });

  // GET /api/wallets/:id/timeline
  fastify.get('/api/wallets/:id/timeline', async (req, reply) => {
    const wallet = walletService.getUserWallet(req.user.tg_id, parseInt(req.params.id));
    if (!wallet) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } });
    return pnlService.getPnlTimeline(wallet.id);
  });
}
