import { getWallets, deleteWallet, getUserWallet, updateWalletLabel } from '../../services/walletService.js';
import { getWalletStats } from '../../services/pnlService.js';
import { walletList, errorMsg } from '../templates.js';
import { walletActions, deleteConfirm } from '../keyboards.js';
import * as statsCache from '../statsCache.js';
import { setState } from '../fsm.js';

export async function handleWallets(ctx) {
  const userId = ctx.from.id;
  const wallets = getWallets(userId);

  if (!wallets.length) {
    return ctx.replyWithMarkdownV2(errorMsg('no_wallets'));
  }

  const pnlMap = {};
  for (const w of wallets) {
    try { pnlMap[w.id] = getWalletStats(w.id); } catch {}
  }

  await ctx.replyWithMarkdownV2(walletList(wallets, pnlMap), walletActions(wallets));
}

export async function handleDeleteRequest(ctx, walletId) {
  const userId = ctx.from.id;
  const wallet = getUserWallet(userId, walletId);
  if (!wallet) return ctx.answerCbQuery('Кошелёк не найден');

  const label = wallet.label || `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
  await ctx.editMessageText(
    `⚠️ Удалить кошелёк «${label}»?\n\nБудут стёрты все сделки, PnL и история синка для этого адреса.\nСам адрес можно будет добавить заново.`,
    { reply_markup: deleteConfirm(walletId).reply_markup }
  );
  await ctx.answerCbQuery();
}

export async function handleConfirmDelete(ctx, walletId) {
  const userId = ctx.from.id;
  const wallet = getUserWallet(userId, walletId);
  if (!wallet) return ctx.answerCbQuery('Кошелёк не найден');

  deleteWallet(walletId);
  statsCache.invalidate(userId);

  await ctx.editMessageText('✅ Кошелёк удалён.');
  await ctx.answerCbQuery('Удалено');
}

export async function handleCancelDelete(ctx) {
  await ctx.editMessageText('❌ Удаление отменено.');
  await ctx.answerCbQuery();
}

export async function handleRename(ctx) {
  const userId = ctx.from.id;
  const wallets = getWallets(userId);
  if (!wallets.length) return ctx.replyWithMarkdownV2(errorMsg('no_wallets'));

  if (wallets.length === 1) {
    setState(userId, 'WAITING_NEW_LABEL', { walletId: wallets[0].id });
    return ctx.replyWithMarkdownV2('Отправь новую метку для кошелька\\. /cancel — отмена\\.');
  }

  // Multiple wallets — show selection
  const { Markup } = await import('telegraf');
  const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  const buttons = wallets.map((w, i) => [
    Markup.button.callback(
      `${nums[i]} ${w.label || w.address.slice(0, 10) + '…'}`,
      `rename:${w.id}`
    )
  ]);
  await ctx.replyWithMarkdownV2(
    'Выбери кошелёк для переименования\\:',
    Markup.inlineKeyboard(buttons)
  );
}
