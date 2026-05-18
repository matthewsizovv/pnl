import { getWallets } from '../../services/walletService.js';
import { getWalletStatsWithUnrealized } from '../../services/pnlService.js';
import { positionsList, errorMsg } from '../templates.js';
import { Markup } from 'telegraf';

export async function handlePositions(ctx) {
  const userId = ctx.from.id;
  const wallets = getWallets(userId);
  if (!wallets.length) return ctx.replyWithMarkdownV2(errorMsg('no_wallets'));

  const msg = await ctx.reply('⏳ Загружаю позиции...');

  try {
    const statsArr = await Promise.all(wallets.map(w => getWalletStatsWithUnrealized(w.id)));
    const allPositions = statsArr.flatMap(s => s.openPositions || []);

    const text = positionsList(allPositions);
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback('🔄 Обновить', 'cmd:positions'),
        Markup.button.callback('📊 Все статы', 'cmd:stats'),
      ],
    ]);

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, text, {
      parse_mode: 'MarkdownV2',
      ...kb,
    });
  } catch (err) {
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, errorMsg('internal'), {
      parse_mode: 'MarkdownV2',
    });
  }
}
