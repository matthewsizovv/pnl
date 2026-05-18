function esc(text) {
  if (text == null) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function fmt(n, decimals = 2) {
  if (n == null) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function fmtPct(n) {
  if (n == null) return '';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function fmtHold(hours) {
  if (!hours) return '—';
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function timeAgo(ts) {
  if (!ts) return 'никогда';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs} сек назад`;
  if (secs < 3600) return `${Math.floor(secs / 60)} мин назад`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} ч назад`;
  return `${Math.floor(secs / 86400)} дн назад`;
}

function explorerLink(chain, txHash) {
  const base = chain === 'eth' ? 'https://etherscan.io/tx/' : 'https://basescan.org/tx/';
  return `${base}${txHash}`;
}

export function escapeMd(text) { return esc(text); }

export function welcome(isNew, firstName) {
  if (isNew) {
    return `👋 *Привет\\!*\n\nЯ считаю реальный PnL по твоим on\\-chain сделкам на Ethereum и Base\\.\n\nЧто умею:\n• 🔍 Парсить всю историю свопов\n• 💰 Считать прибыль по FIFO с историческими ценами\n• 📊 Показывать топ сделок и winrate\n• 📥 Экспортировать в Koinly\\-совместимый CSV\n• 🌐 Веб\\-дашборд с графиками\n\nЧтобы начать — добавь свой кошелёк\\.`;
  }
  return `С возвращением, *${esc(firstName)}*\\! 👋`;
}

export function walletList(wallets, pnlMap) {
  const lines = wallets.map((w, i) => {
    const num = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][i];
    const label = w.label || 'Кошелёк ' + (i + 1);
    const addr = `${w.address.slice(0, 6)}…${w.address.slice(-4)}`;
    const pnl = pnlMap?.[w.id];
    const pnlStr = pnl != null ? `💰 ${fmt(pnl.realizedPnl)} · ` : '';
    const trades = pnl ? `🔄 ${pnl.tradeCount} сделок` : '';
    const synced = `🕐 синк ${timeAgo(w.last_synced_at)}`;
    return `${num} *${esc(label)}*\n   \`${esc(addr)}\`\n   ${pnlStr}${trades}\n   ${synced}`;
  });
  return `💼 *Твои кошельки \\(${wallets.length} из 5\\):*\n\n${lines.join('\n\n')}`;
}

export function statsMessage(stats, walletCount, updatedAt) {
  const costBasis = stats.realizedPnl - (stats.unrealizedPnl || 0);
  const totalPct = costBasis ? fmtPct((stats.totalPnl / Math.abs(costBasis)) * 100) : '';

  let msg = `📊 *Сводка по ${walletCount} ${walletCount === 1 ? 'кошельку' : 'кошелькам'}*\n\n`;
  msg += `💰 Total PnL: *${esc(fmt(stats.totalPnl))}* ${esc(totalPct)}\n`;
  msg += `   ├─ Realized:    ${esc(fmt(stats.realizedPnl))}\n`;
  msg += `   └─ Unrealized:  ${esc(fmt(stats.unrealizedPnl || 0))}\n\n`;
  msg += `🎯 Winrate: *${stats.winrate}%* \\(${stats.wins}W / ${stats.losses}L\\)\n`;
  msg += `🔄 Сделок: ${stats.tradeCount}\n`;
  msg += `⏱ Avg hold: ${esc(fmtHold(stats.avgHoldHours))}\n`;
  msg += `💸 Газа потрачено: ${esc(fmt(stats.gasSpent))}\n`;
  if (stats.best) msg += `\n🏆 Лучшая: ${esc(stats.best.token_symbol)} ${esc(fmt(stats.best.pnl_usd))} \\(${esc(fmtPct(stats.best.roi_pct))}\\)\n`;
  if (stats.worst) msg += `📉 Худшая: ${esc(stats.worst.token_symbol)} ${esc(fmt(stats.worst.pnl_usd))} \\(${esc(fmtPct(stats.worst.roi_pct))}\\)\n`;
  if (updatedAt) msg += `\nОбновлено: ${esc(timeAgo(updatedAt))}`;
  return msg;
}

export function tradeList(trades, title) {
  const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  const lines = trades.map((t, i) => {
    const num = nums[i] || `${i + 1}\\.`;
    const symbol = esc(t.token_symbol || '—');
    const pnl = esc(fmt(t.pnl_usd));
    const roi = esc(fmtPct(t.roi_pct));
    const hold = esc(fmtHold(t.holding_hours));
    const date = new Date(t.timestamp ? t.timestamp * 1000 : Date.now()).toLocaleDateString('ru-RU');
    const chain = t.chain === 'eth' ? 'ETH' : 'Base';
    const link = `[Etherscan ↗](${explorerLink(t.chain, t.tx_hash)})`;
    return `${num} ${symbol}      *${pnl}*  \\(${roi}\\)  hold ${hold}\n   📅 ${esc(date)} · ${esc(chain)}\n   🔗 ${link}`;
  });
  return `${title}\n\n${lines.join('\n\n')}`;
}

export function positionsList(positions) {
  if (!positions.length) return '📦 Открытых позиций нет — все купленные токены уже проданы\\.';
  const lines = positions.map((p, i) => {
    const symbol = esc(p.tokenSymbol || p.tokenAddress.slice(0, 8));
    const amount = p.amount.toLocaleString('en-US', { maximumFractionDigits: 4 });
    const value = fmt(p.valueUsd, 0);
    const pnl = fmt(p.unrealizedPnl);
    const pct = fmtPct(p.unrealizedPct);
    return `${i + 1}\\. ${symbol}       ${esc(amount)} шт   ${esc(value)} · ${esc(pnl)} \\(${esc(pct)}\\)`;
  });
  const total = positions.reduce((s, p) => s + p.valueUsd, 0);
  const totalUnreal = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  return `📦 *Открытые позиции \\(${positions.length} ${positions.length === 1 ? 'токен' : 'токенов'}\\)*\n\n${lines.join('\n')}\n\n💰 Суммарная стоимость: ${esc(fmt(total, 0))}\n📈 Total Unrealized: ${esc(fmt(totalUnreal))} \\(${esc(fmtPct(totalUnreal / total * 100))}\\)`;
}

export function tokenDetails(symbol, trades, realized, lots) {
  const sym = esc(symbol.toUpperCase());
  let msg = `🔍 *${sym}*\n\n`;
  msg += `📊 Суммарно:\n`;
  msg += `   💰 Realized: ${esc(fmt(realized.total))}\n`;
  msg += `   🔄 Сделок: ${realized.count}\n\n`;
  if (trades.length > 0) {
    msg += `🕐 *Последние сделки:*\n`;
    trades.slice(0, 10).forEach((t, i) => {
      const type = t.type === 'buy' ? '🟢 BUY' : '🔴 SELL';
      const date = new Date(t.timestamp * 1000).toLocaleDateString('ru-RU');
      msg += `${i + 1}\\. ${type}  ${esc(t.amount.toFixed(4))}  @${esc(t.price_usd?.toFixed(6) || '?')}  ${esc(date)}\n`;
    });
  }
  return msg;
}

export function syncDone(wallet, stats) {
  const label = wallet.label || `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
  return `🎉 *Синк завершён\\!*\n\n📊 Сводка по ${esc(label)}:\n💰 Total PnL: *${esc(fmt(stats.totalPnl || stats.realizedPnl))}*\n🎯 Winrate: ${stats.winrate}% \\(${stats.wins}W/${stats.losses}L\\)\n🔄 Сделок: ${stats.tradeCount}`;
}

export function errorMsg(type) {
  const msgs = {
    invalid_address: '❌ Это не похоже на адрес\\. Должно быть 42 символа, начинаться с 0x\\.',
    wallet_limit: '❌ Достигнут лимит — 5 кошельков\\. Удали один через /wallets\\.',
    wallet_duplicate: (label) => `❌ Этот кошелёк уже добавлен${label ? ` как «${esc(label)}»` : ''}`,
    no_wallets: '💼 Сначала добавь кошелёк через /add\\.',
    no_trades: '🔍 На твоих кошельках пока нет свопов на ETH/Base\\.',
    alchemy_down: '⚠️ Не могу связаться с RPC\\. Попробуй через минуту\\.',
    price_down: '⚠️ Источник цен недоступен\\. Покажу что есть, остальное досчитаю позже\\.',
    internal: '💥 Что\\-то пошло не так\\. Попробуй позже\\.',
    token_not_found: (t) => `❌ Не вижу сделок по \`${esc(t)}\`\\. Проверь написание\\.`,
    too_many_attempts: '❌ Слишком много неверных попыток\\. /add чтобы начать снова\\.',
  };
  return typeof msgs[type] === 'function' ? msgs[type] : (msgs[type] || msgs.internal);
}

export { fmt, fmtPct, fmtHold, timeAgo, esc as escapeMd2 };
