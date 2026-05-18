import { getWallets } from '../../services/walletService.js';
import { getAggregatedStats } from '../../services/pnlService.js';
import * as incrementalSync from '../../services/syncService.js';
import { statsMessage, errorMsg } from '../templates.js';
import { statsMenu } from '../keyboards.js';
import * as statsCache from '../statsCache.js';
import { logger } from '../../logger.js';

const STALE_THRESHOLD = 5 * 60 * 1000;

export async function handleStats(ctx) {
  const userId = ctx.from.id;
  const wallets = getWallets(userId);

  if (!wallets.length) {
    return ctx.replyWithMarkdownV2(errorMsg('no_wallets'));
  }

  const cached = statsCache.get(userId);
  if (cached) {
    return ctx.replyWithMarkdownV2(
      statsMessage(cached.stats, wallets.length, cached.ts),
      statsMenu()
    );
  }

  const loadingMsg = await ctx.reply('⏳ Считаю...');

  try {
    const stale = wallets.some(w => !w.last_synced_at || Date.now() - w.last_synced_at > STALE_THRESHOLD);
    if (stale) {
      await Promise.allSettled(wallets.map(w => incrementalSync.incrementalSync(w)));
    }

    const stats = await getAggregatedStats(userId);
    statsCache.set(userId, { stats, ts: Date.now() });

    const text = statsMessage(stats, wallets.length, Date.now());
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, text, {
      parse_mode: 'MarkdownV2',
      ...statsMenu(),
    });
  } catch (err) {
    logger.error({ err }, 'handleStats failed');
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, errorMsg('internal'), {
      parse_mode: 'MarkdownV2',
    });
  }
}
