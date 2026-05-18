import { Telegraf } from 'telegraf';
import { logger } from '../logger.js';
import * as fsm from './fsm.js';

// Handlers
import { handleStart } from './handlers/start.js';
import { handleAdd, handleAddMessage } from './handlers/add.js';
import { handleStats } from './handlers/stats.js';
import { handleWallets, handleDeleteRequest, handleConfirmDelete, handleCancelDelete, handleRename } from './handlers/wallets.js';
import { handleBest, handleWorst, handleToken } from './handlers/trades.js';
import { handlePositions } from './handlers/positions.js';
import { handleExport, handleExportCb } from './handlers/export.js';
import { handleRefresh } from './handlers/refresh.js';
import { handleHelp } from './handlers/help.js';
import { setState } from './fsm.js';

export function createBot(token) {
  const bot = new Telegraf(token);

  // Commands
  bot.start(handleStart);
  bot.command('add', handleAdd);
  bot.command('wallets', handleWallets);
  bot.command('remove', handleWallets); // alias
  bot.command('rename', handleRename);
  bot.command('stats', handleStats);
  bot.command('best', handleBest);
  bot.command('worst', handleWorst);
  bot.command('token', handleToken);
  bot.command('positions', handlePositions);
  bot.command('export', handleExport);
  bot.command('refresh', handleRefresh);
  bot.command('help', handleHelp);
  bot.command('cancel', (ctx) => {
    const state = fsm.getState(ctx.from.id);
    fsm.clearState(ctx.from.id);
    if (state) return ctx.reply('❌ Действие отменено.');
    return ctx.reply('Нет активного действия.');
  });
  bot.command('skip', (ctx) => {
    const state = fsm.getState(ctx.from.id);
    if (state === 'WAITING_LABEL') {
      ctx.message.text = '/skip';
      return handleAddMessage(ctx);
    }
  });

  // Callback queries
  bot.action('cmd:start', handleStart);
  bot.action('cmd:add', handleAdd);
  bot.action('cmd:wallets', handleWallets);
  bot.action('cmd:stats', handleStats);
  bot.action('cmd:stats_refresh', async (ctx) => {
    const { invalidate } = await import('./statsCache.js');
    invalidate(ctx.from.id);
    await ctx.answerCbQuery('Обновляю...');
    return handleStats(ctx);
  });
  bot.action('cmd:best', (ctx) => { ctx.answerCbQuery(); return handleBest(ctx); });
  bot.action('cmd:worst', (ctx) => { ctx.answerCbQuery(); return handleWorst(ctx); });
  bot.action('cmd:positions', (ctx) => { ctx.answerCbQuery(); return handlePositions(ctx); });
  bot.action('cmd:export', (ctx) => handleExport(ctx));
  bot.action('cmd:help', (ctx) => { ctx.answerCbQuery(); return handleHelp(ctx); });

  // Wallet callbacks
  bot.action(/^wallet:open:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    return handleStats(ctx);
  });
  bot.action(/^wallet:delete:(\d+)$/, async (ctx) => {
    const walletId = parseInt(ctx.match[1]);
    return handleDeleteRequest(ctx, walletId);
  });
  bot.action(/^wallet:confirm_delete:(\d+)$/, async (ctx) => {
    const walletId = parseInt(ctx.match[1]);
    return handleConfirmDelete(ctx, walletId);
  });
  bot.action('wallet:cancel_delete', handleCancelDelete);
  bot.action('wallet:syncall', async (ctx) => {
    await ctx.answerCbQuery('Синкаю...');
    return handleRefresh(ctx);
  });

  // Rename
  bot.action(/^rename:(\d+)$/, async (ctx) => {
    const walletId = parseInt(ctx.match[1]);
    setState(ctx.from.id, 'WAITING_NEW_LABEL', { walletId });
    await ctx.editMessageText('Отправь новую метку для кошелька. /cancel — отмена.');
    await ctx.answerCbQuery();
  });

  // Trade pagination
  bot.action(/^best:page:(\d+)$/, (ctx) => handleBest(ctx, parseInt(ctx.match[1])));
  bot.action(/^worst:page:(\d+)$/, (ctx) => handleWorst(ctx, parseInt(ctx.match[1])));

  // Export
  bot.action('export:csv', (ctx) => handleExportCb(ctx, 'csv'));
  bot.action('export:xlsx', (ctx) => handleExportCb(ctx, 'xlsx'));
  bot.action('export:cancel', async (ctx) => {
    await ctx.editMessageText('❌ Экспорт отменён.');
    await ctx.answerCbQuery();
  });

  // FSM message routing
  bot.on('text', async (ctx) => {
    const state = fsm.getState(ctx.from.id);
    if (state === 'WAITING_ADDRESS' || state === 'WAITING_LABEL' || state === 'WAITING_NEW_LABEL') {
      return handleAddMessage(ctx);
    }
  });

  // Set menu button
  bot.telegram.setChatMenuButton({
    menu_button: {
      type: 'web_app',
      text: 'Открыть Dashboard',
      web_app: { url: process.env.DASHBOARD_URL || 'https://example.com' },
    },
  }).catch(() => {}); // Ignore if not supported

  bot.catch((err, ctx) => {
    logger.error({ err, update: ctx.update }, 'Bot error');
    ctx.reply('💥 Что-то пошло не так. Попробуй позже.').catch(() => {});
  });

  return bot;
}
