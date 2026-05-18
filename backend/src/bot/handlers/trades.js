import { getWallets } from '../../services/walletService.js';
import { getTopTrades, getTokenDetails } from '../../services/pnlService.js';
import { tradeList, errorMsg } from '../templates.js';
import { paginationButtons } from '../keyboards.js';
import { Markup } from 'telegraf';

export async function handleBest(ctx, page = 0) {
  const userId = ctx.from.id;
  const wallets = getWallets(userId);
  if (!wallets.length) return ctx.replyWithMarkdownV2(errorMsg('no_wallets'));

  const walletIds = wallets.map(w => w.id);
  const trades = getTopTrades(walletIds, 'DESC', 6, page * 5);
  const hasNext = trades.length > 5;
  const slice = trades.slice(0, 5);

  if (!slice.length) return ctx.replyWithMarkdownV2(errorMsg('no_trades'));

  const text = tradeList(slice, '🏆 Топ\\-5 прибыльных сделок');
  const kb = paginationButtons('best', page, hasNext, [
    Markup.button.callback('📥 Экспорт', 'cmd:export'),
  ]);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', ...kb });
    await ctx.answerCbQuery();
  } else {
    await ctx.replyWithMarkdownV2(text, kb);
  }
}

export async function handleWorst(ctx, page = 0) {
  const userId = ctx.from.id;
  const wallets = getWallets(userId);
  if (!wallets.length) return ctx.replyWithMarkdownV2(errorMsg('no_wallets'));

  const walletIds = wallets.map(w => w.id);
  const trades = getTopTrades(walletIds, 'ASC', 6, page * 5);
  const hasNext = trades.length > 5;
  const slice = trades.slice(0, 5);

  if (!slice.length) return ctx.replyWithMarkdownV2(errorMsg('no_trades'));

  const text = tradeList(slice, '📉 Топ\\-5 убыточных сделок');
  const kb = paginationButtons('worst', page, hasNext, [
    Markup.button.callback('📥 Экспорт', 'cmd:export'),
  ]);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', ...kb });
    await ctx.answerCbQuery();
  } else {
    await ctx.replyWithMarkdownV2(text, kb);
  }
}

export async function handleToken(ctx) {
  const userId = ctx.from.id;
  const wallets = getWallets(userId);
  if (!wallets.length) return ctx.replyWithMarkdownV2(errorMsg('no_wallets'));

  const args = ctx.message?.text?.split(' ') || [];
  const symbol = args[1];
  if (!symbol) {
    return ctx.replyWithMarkdownV2('Укажи тикер: `/token PEPE`');
  }

  const walletIds = wallets.map(w => w.id);
  const { trades, realized } = getTokenDetails(walletIds, symbol);

  if (!trades.length && !realized.count) {
    return ctx.replyWithMarkdownV2(
      typeof errorMsg('token_not_found') === 'function'
        ? errorMsg('token_not_found')(symbol)
        : errorMsg('token_not_found')
    );
  }

  const { tokenDetails } = await import('../templates.js');
  await ctx.replyWithMarkdownV2(tokenDetails(symbol, trades, realized, []));
}
