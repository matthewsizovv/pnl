export async function handleHelp(ctx) {
  const text = `❓ *Помощь*

📋 Команды:
/add — добавить кошелёк
/wallets — список кошельков
/stats — общая статистика
/best — топ прибыльных сделок
/worst — топ убыточных
/token TICKER — детали по токену
/positions — открытые позиции
/export — выгрузить сделки
/refresh — ручной синк
/cancel — отменить ввод

💡 Что считается:
• Свопы и переводы на Ethereum \\+ Base
• PnL по FIFO с историческими ценами DefiLlama
• Газ учитывается в cost basis

❌ Что НЕ считается:
• Сделки на CEX \\(Binance, Bybit и т\\.д\\.\\)
• Другие сети \\(Solana, Polygon, BNB и т\\.д\\.\\)
• LP / staking / farming / NFT

📨 Поддержка: @your\\_username`;

  await ctx.replyWithMarkdownV2(text);
}
