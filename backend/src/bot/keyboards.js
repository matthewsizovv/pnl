import { Markup } from 'telegraf';

export const mainMenu = (hasWallets) => {
  const buttons = [];
  if (hasWallets) {
    buttons.push([
      Markup.button.callback('📊 Статистика', 'cmd:stats'),
      Markup.button.callback('💼 Кошельки', 'cmd:wallets'),
    ]);
  }
  buttons.push([
    Markup.button.callback('➕ Добавить кошелёк', 'cmd:add'),
    Markup.button.webApp('🌐 Dashboard', process.env.DASHBOARD_URL || 'https://example.com'),
  ]);
  buttons.push([Markup.button.callback('❓ Помощь', 'cmd:help')]);
  return Markup.inlineKeyboard(buttons);
};

export const walletActions = (wallets) => {
  const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  const rows = wallets.map((w, i) => [
    Markup.button.callback(`${nums[i]} Открыть`, `wallet:open:${w.id}`),
    Markup.button.callback(`${nums[i]} Удалить`, `wallet:delete:${w.id}`),
  ]);
  rows.push([
    Markup.button.callback('➕ Добавить', 'cmd:add'),
    Markup.button.callback('🔄 Синк всех', 'wallet:syncall'),
  ]);
  return Markup.inlineKeyboard(rows);
};

export const statsMenu = () => Markup.inlineKeyboard([
  [
    Markup.button.callback('🔄 Обновить', 'cmd:stats_refresh'),
    Markup.button.callback('🏆 Топ', 'cmd:best'),
    Markup.button.callback('📉 Худшие', 'cmd:worst'),
  ],
  [
    Markup.button.callback('💼 Кошельки', 'cmd:wallets'),
    Markup.button.webApp('🌐 Dashboard', process.env.DASHBOARD_URL || 'https://example.com'),
  ],
]);

export const deleteConfirm = (walletId) => Markup.inlineKeyboard([
  [
    Markup.button.callback('✅ Да, удалить', `wallet:confirm_delete:${walletId}`),
    Markup.button.callback('❌ Отмена', 'wallet:cancel_delete'),
  ],
]);

export const paginationButtons = (cmd, page, hasNext, extra = []) => {
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('← Назад', `${cmd}:page:${page - 1}`));
  if (hasNext) nav.push(Markup.button.callback('Следующие 5 →', `${cmd}:page:${page + 1}`));
  const rows = [];
  if (nav.length) rows.push(nav);
  if (extra.length) rows.push(extra);
  rows.push([Markup.button.callback('← Назад', 'cmd:stats')]);
  return Markup.inlineKeyboard(rows);
};

export const exportMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('📄 CSV (для Koinly)', 'export:csv')],
  [Markup.button.callback('📊 XLSX (Excel)', 'export:xlsx')],
  [Markup.button.callback('❌ Отмена', 'export:cancel')],
]);

export const syncDoneMenu = () => Markup.inlineKeyboard([
  [
    Markup.button.callback('📊 Подробнее', 'cmd:stats'),
    Markup.button.webApp('🌐 Dashboard', process.env.DASHBOARD_URL || 'https://example.com'),
  ],
]);
