import { getWallets } from '../../services/walletService.js';
import * as syncService from '../../services/syncService.js';
import { errorMsg } from '../templates.js';
import * as statsCache from '../statsCache.js';
import { logger } from '../../logger.js';

const RATE_LIMIT = 10 * 60 * 1000;

export async function handleRefresh(ctx) {
  const userId = ctx.from.id;
  const wallets = getWallets(userId);

  if (!wallets.length) return ctx.replyWithMarkdownV2(errorMsg('no_wallets'));

  const now = Date.now();
  const staleWallets = wallets.filter(w => !w.last_synced_at || now - w.last_synced_at > RATE_LIMIT);

  if (!staleWallets.length) {
    const minWait = wallets.reduce((min, w) => {
      const wait = Math.ceil((w.last_synced_at + RATE_LIMIT - now) / 1000);
      return Math.min(min, wait);
    }, Infinity);
    return ctx.replyWithMarkdownV2(`⏳ Подожди ${minWait} сек — последний синк был недавно\\.`);
  }

  const msg = await ctx.reply(`🔄 Синкаю ${staleWallets.length > 1 ? `${staleWallets.length} кошелька параллельно` : 'кошелёк'}...`);

  try {
    const results = await Promise.allSettled(staleWallets.map(w => syncService.incrementalSync(w)));
    statsCache.invalidate(userId);

    const lines = staleWallets.map((w, i) => {
      const r = results[i];
      const label = w.label || `${w.address.slice(0, 6)}…${w.address.slice(-4)}`;
      if (r.status === 'fulfilled') {
        return `✅ ${label} — ${r.value.newTrades} новых сделок`;
      }
      return `❌ ${label} — ошибка`;
    });

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, lines.join('\n'));
  } catch (err) {
    logger.error({ err }, 'handleRefresh failed');
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, errorMsg('internal'), { parse_mode: 'MarkdownV2' });
  }
}
