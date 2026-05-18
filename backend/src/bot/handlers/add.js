import { ethers } from 'ethers';
import { getState, setState, getData, updateData, clearState } from '../fsm.js';
import { getWallets, countWallets, getWalletByAddress, addWallet } from '../../services/walletService.js';
import * as syncService from '../../services/syncService.js';
import { getWalletStatsWithUnrealized } from '../../services/pnlService.js';
import { upsertUser } from '../../services/userService.js';
import { errorMsg, syncDone } from '../templates.js';
import { syncDoneMenu } from '../keyboards.js';
import { logger } from '../../logger.js';

export async function handleAdd(ctx) {
  upsertUser({ tg_id: ctx.from.id, username: ctx.from.username, first_name: ctx.from.first_name });

  if (countWallets(ctx.from.id) >= 5) {
    return ctx.replyWithMarkdownV2(errorMsg('wallet_limit'));
  }
  setState(ctx.from.id, 'WAITING_ADDRESS', { attempts: 0 });
  await ctx.replyWithMarkdownV2('📝 Отправь адрес кошелька \\(формат 0x\\.\\.\\.\\.\\)\n\nМожно скопировать из Metamask, Rabby или Etherscan\\.\n\n/cancel — отмена');
}

export async function handleAddMessage(ctx) {
  const userId = ctx.from.id;
  const state = getState(userId);
  if (!state) return;

  const text = ctx.message.text?.trim();

  if (state === 'WAITING_ADDRESS') {
    const data = getData(userId);
    let attempts = (data.attempts || 0) + 1;

    if (!ethers.isAddress(text)) {
      if (attempts >= 3) {
        clearState(userId);
        return ctx.replyWithMarkdownV2(errorMsg('too_many_attempts'));
      }
      updateData(userId, { attempts });
      return ctx.replyWithMarkdownV2(`❌ Это не похоже на адрес\\. Должно быть 42 символа, начинаться с 0x\\.\n\nПопробуй ещё раз \\(${3 - attempts} попыток\\)\\. /cancel`);
    }

    const address = text.toLowerCase();

    if (countWallets(userId) >= 5) {
      clearState(userId);
      return ctx.replyWithMarkdownV2(errorMsg('wallet_limit'));
    }

    const existing = getWalletByAddress(userId, address);
    if (existing) {
      clearState(userId);
      return ctx.replyWithMarkdownV2(typeof errorMsg('wallet_duplicate') === 'function'
        ? errorMsg('wallet_duplicate')(existing.label)
        : errorMsg('wallet_duplicate'));
    }

    updateData(userId, { address, attempts: 0 });
    setState(userId, 'WAITING_LABEL');

    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    await ctx.replyWithMarkdownV2(
      `✅ Адрес валиден: \`${address}\`\n\nДай метку для удобства \\(например «Main wallet»\\) или /skip\\.`
    );
    return;
  }

  if (state === 'WAITING_LABEL') {
    const data = getData(userId);
    const label = text === '/skip' ? null : text.slice(0, 50);
    await finishAdd(ctx, userId, data.address, label);
    return;
  }

  if (state === 'WAITING_NEW_LABEL') {
    const data = getData(userId);
    const label = text.slice(0, 50);
    const { getDb } = await import('../../db/index.js');
    getDb().prepare('UPDATE wallets SET label=? WHERE id=? AND user_id=?')
      .run(label, data.walletId, userId);
    clearState(userId);
    return ctx.replyWithMarkdownV2(`✅ Метка обновлена\\!`);
  }
}

async function finishAdd(ctx, userId, address, label) {
  clearState(userId);

  const wallet = addWallet({ userId, address, label });
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  await ctx.replyWithMarkdownV2(
    `✅ Кошелёк добавлен: \`${address}\`\n\n🔄 Идёт первичный синк всей истории\\. Это займёт 1–3 минуты для активного кошелька\\.\n\nПришлю отчёт когда закончу\\.`
  );

  // Background sync
  syncService.fullSync(wallet).then(async ({ newTrades }) => {
    try {
      const stats = await getWalletStatsWithUnrealized(wallet.id);
      await ctx.telegram.sendMessage(
        userId,
        syncDone(wallet, stats),
        { parse_mode: 'MarkdownV2', ...syncDoneMenu() }
      );
    } catch (err) {
      logger.error({ err }, 'Failed to send sync done notification');
    }
  }).catch(async (err) => {
    logger.error({ err }, 'Background sync failed');
    try {
      await ctx.telegram.sendMessage(userId, '⚠️ Не удалось синканить кошелёк\\. Попробую снова через 5 минут\\.', { parse_mode: 'MarkdownV2' });
    } catch {}
  });
}
