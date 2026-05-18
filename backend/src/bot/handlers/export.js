import { getWallets } from '../../services/walletService.js';
import { generateCsv, generateXlsx } from '../../services/exportService.js';
import { exportMenu, errorMsg } from '../templates.js';
import { Markup } from 'telegraf';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

export async function handleExport(ctx) {
  const userId = ctx.from.id;
  const wallets = getWallets(userId);
  if (!wallets.length) return ctx.replyWithMarkdownV2(errorMsg('no_wallets'));

  if (ctx.callbackQuery) {
    await ctx.editMessageText('📥 Экспорт сделок\n\nФормат:', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('📄 CSV (для Koinly)', 'export:csv')],
        [Markup.button.callback('📊 XLSX (Excel)', 'export:xlsx')],
        [Markup.button.callback('❌ Отмена', 'export:cancel')],
      ]).reply_markup,
    });
    await ctx.answerCbQuery();
  } else {
    await ctx.replyWithMarkdownV2('📥 *Экспорт сделок*\n\nВыбери формат\\:',
      Markup.inlineKeyboard([
        [Markup.button.callback('📄 CSV (для Koinly)', 'export:csv')],
        [Markup.button.callback('📊 XLSX (Excel)', 'export:xlsx')],
        [Markup.button.callback('❌ Отмена', 'export:cancel')],
      ])
    );
  }
}

export async function handleExportCb(ctx, format) {
  const userId = ctx.from.id;
  const wallets = getWallets(userId);

  await ctx.editMessageText('⏳ Готовлю файл...');
  await ctx.answerCbQuery();

  const walletIds = wallets.map(w => w.id);
  const date = new Date().toISOString().split('T')[0];
  let filePath;

  try {
    if (format === 'csv') {
      filePath = path.join(tmpdir(), `trades_${userId}_${Date.now()}.csv`);
      const csv = generateCsv(walletIds);
      writeFileSync(filePath, csv, 'utf-8');
    } else {
      filePath = await generateXlsx(walletIds);
    }

    await ctx.replyWithDocument({ source: filePath, filename: `trades_${date}.${format}` },
      { caption: `✅ Готово! Экспорт завершён.` }
    );

    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (err) {
    if (filePath && existsSync(filePath)) unlinkSync(filePath);
    await ctx.reply('❌ Ошибка при генерации файла. Попробуй позже.');
  }
}
