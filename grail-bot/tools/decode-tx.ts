#!/usr/bin/env tsx
/**
 * tools/decode-tx.ts — Инструмент Phase 0
 *
 * Декодирует транзакцию Grail.xyz и выводит:
 *   - Адрес контракта (to)
 *   - Функциональный селектор (первые 4 байта calldata)
 *   - Декодированные параметры (если ABI известен)
 *   - Список эмитированных событий
 *   - ETH value транзакции
 *
 * Использование:
 *   npx tsx tools/decode-tx.ts <TX_HASH>
 *   npx tsx tools/decode-tx.ts <TX_HASH> --rpc https://mainnet.base.org
 *
 * Примеры:
 *   npx tsx tools/decode-tx.ts 0xabc123...  # Декодировать buy tx
 *   npx tsx tools/decode-tx.ts 0xdef456...  # Декодировать open tx
 *
 * Результат сохраняется в: RE_REPORT_auto.md
 */

import { JsonRpcProvider, Interface, formatEther, hexlify } from 'ethers';
import { writeFileSync } from 'fs';

// ── Аргументы командной строки ─────────────────────────────────────────────
const args = process.argv.slice(2);
const txHash = args.find((a) => a.startsWith('0x') && a.length === 66);
const rpcArg = args.findIndex((a) => a === '--rpc');
const rpcUrl = rpcArg >= 0 ? args[rpcArg + 1] : process.env['RPC_URL'];

if (!txHash) {
  console.error('Использование: npx tsx tools/decode-tx.ts <TX_HASH> [--rpc <RPC_URL>]');
  console.error('Пример: npx tsx tools/decode-tx.ts 0xabcd...');
  process.exit(1);
}

const RPC_URLS = [
  rpcUrl,
  'https://mainnet.base.org',
  'https://base.drpc.org',
  'https://base.llamarpc.com',
].filter(Boolean) as string[];

// ── Известные ABI для попытки декодирования ────────────────────────────────
// Добавляй сюда сигнатуры по мере их нахождения в Phase 0
const KNOWN_FUNCTIONS = [
  // Покупка паков — пробуем несколько вариантов
  'function buy(uint256 packCount)',
  'function buy(uint256 packCount, bytes signature, uint256 deadline)',
  'function buy(uint256 collectionId, uint256 packCount)',
  'function purchasePacks(uint256 count)',
  'function mintPacks(uint256 amount)',
  'function buyPacks(uint256 count)',
  // Открытие паков
  'function open(uint256[] packIds)',
  'function openPacks(uint256[] tokenIds)',
  'function reveal(uint256[] tokenIds)',
  'function unpack(uint256[] tokenIds)',
  // Клейм
  'function claim()',
  'function claimRewards()',
  'function redeem()',
  // ERC20 стандарт
  'function approve(address spender, uint256 amount)',
  'function transfer(address to, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
  // ERC721 стандарт
  'function setApprovalForAll(address operator, bool approved)',
];

const KNOWN_EVENTS = [
  'event PackBought(address indexed buyer, uint256 packCount, uint256[] packIds)',
  'event PackBought(address indexed buyer, uint256 packId)',
  'event PacksPurchased(address indexed buyer, uint256 count)',
  'event PackOpened(address indexed opener, uint256 packId, address[] tokens, uint256[] amounts)',
  'event PackOpened(address indexed opener, uint256[] packIds, address[] tokens, uint256[] amounts)',
  'event TokensMinted(address indexed to, address[] tokens, uint256[] amounts)',
  'event RewardsClaimed(address indexed account, address[] tokens, uint256[] amounts)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
];

// Строим интерфейс из всех известных функций и событий
const iface = new Interface([...KNOWN_FUNCTIONS, ...KNOWN_EVENTS]);

// ── Основная логика ────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Декодирование транзакции: ${txHash}\n`);

  // Пробуем подключиться к RPC
  let provider: JsonRpcProvider | null = null;
  for (const url of RPC_URLS) {
    try {
      const p = new JsonRpcProvider(url, 8453, { staticNetwork: true });
      await p.getBlockNumber();
      provider = p;
      console.log(`✅ RPC подключён: ${url}`);
      break;
    } catch {
      console.log(`❌ RPC недоступен: ${url}`);
    }
  }

  if (!provider) {
    console.error('\n⛔ Не удалось подключиться ни к одному RPC.');
    console.error('Запусти вручную: cast tx <hash> --rpc-url https://mainnet.base.org');
    process.exit(1);
  }

  // Получаем транзакцию
  const tx = await provider.getTransaction(txHash!);
  if (!tx) {
    console.error(`Транзакция ${txHash} не найдена`);
    process.exit(1);
  }

  const receipt = await provider.getTransactionReceipt(txHash!);

  // ── Базовая информация ───────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ТРАНЗАКЦИЯ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Hash:           ${tx.hash}`);
  console.log(`From:           ${tx.from}`);
  console.log(`To:             ${tx.to}`);
  console.log(`Value:          ${formatEther(tx.value)} ETH`);
  console.log(`Nonce:          ${tx.nonce}`);
  console.log(`Block:          ${tx.blockNumber}`);
  console.log(`Status:         ${receipt?.status === 1 ? '✅ Success' : '❌ Failed/Reverted'}`);
  console.log(`Gas used:       ${receipt?.gasUsed?.toString() ?? 'unknown'}`);

  // ── Декодирование calldata ───────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('CALLDATA');
  console.log('═══════════════════════════════════════════════════════════════');

  const calldata = tx.data;
  const selector = calldata.slice(0, 10); // первые 4 байта + 0x

  console.log(`Selector (4 bytes): ${selector}`);
  console.log(`Calldata raw:       ${calldata.slice(0, 100)}...`);

  // Пробуем декодировать через известные функции
  let decoded = false;
  for (const funcSig of KNOWN_FUNCTIONS) {
    try {
      const funcName = funcSig.split('(')[0]!.replace('function ', '');
      const fragment = iface.getFunction(funcName);
      if (!fragment) continue;

      const result = iface.decodeFunctionData(fragment, calldata);
      console.log(`\n✅ Декодировано как: ${funcSig}`);
      console.log('Параметры:');
      fragment.inputs.forEach((input, i) => {
        const val = result[i];
        const valStr = Array.isArray(val) ? `[${val.map(String).join(', ')}]` : String(val);
        console.log(`  ${input.name} (${input.type}): ${valStr}`);
      });
      decoded = true;
      break;
    } catch {
      // Не совпало — пробуем следующую
    }
  }

  if (!decoded) {
    console.log(`\n⚠️  Функция не опознана. Selector: ${selector}`);
    console.log('Добавь сигнатуру в KNOWN_FUNCTIONS или используй:');
    console.log(`  cast 4byte ${selector}`);
    console.log(`  cast 4byte-decode ${calldata.slice(0, 10)}`);
  }

  // ── Декодирование событий ────────────────────────────────────────────────
  if (receipt && receipt.logs.length > 0) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`СОБЫТИЯ (${receipt.logs.length} штук)`);
    console.log('═══════════════════════════════════════════════════════════════');

    for (const log of receipt.logs) {
      console.log(`\nКонтракт: ${log.address}`);

      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed) {
          console.log(`  Событие: ${parsed.name}`);
          parsed.fragment.inputs.forEach((input, i) => {
            const val = parsed.args[i];
            const valStr = Array.isArray(val) ? `[${val.map(String).join(', ')}]` : String(val);
            console.log(`  ${input.name} (${input.type}): ${valStr}`);
          });
        } else {
          console.log(`  Topics: ${log.topics.join(', ')}`);
        }
      } catch {
        // Неизвестное событие
        console.log(`  ⚠️ Неизвестное событие. Topic[0]: ${log.topics[0]}`);
        console.log(`     Data: ${log.data.slice(0, 66)}...`);
      }
    }
  }

  // ── Генерируем частичный RE_REPORT ──────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('РЕЗУЛЬТАТ ДЛЯ RE_REPORT.md');
  console.log('═══════════════════════════════════════════════════════════════');

  const report = generateReport(tx, receipt, selector, calldata, decoded);
  console.log(report);

  // Сохраняем в файл
  const outFile = 'RE_REPORT_auto.md';
  writeFileSync(outFile, report, 'utf8');
  console.log(`\n✅ Результат сохранён в ${outFile}`);
}

function generateReport(tx: Awaited<ReturnType<typeof JsonRpcProvider.prototype.getTransaction>>, receipt: Awaited<ReturnType<typeof JsonRpcProvider.prototype.getTransactionReceipt>>, selector: string, calldata: string, decoded: boolean): string {
  const lines: string[] = [
    '# Phase 0 — Автоматически извлечённый отчёт',
    '',
    '> Сгенерировано: ' + new Date().toISOString(),
    '> Скопируй в RE_REPORT.md и заполни оставшиеся поля вручную.',
    '',
    '## Транзакция',
    '',
    `\`\`\`yaml`,
    `tx_hash: "${tx?.hash}"`,
    `from: "${tx?.from}"`,
    `to: "${tx?.to}"    # ← Это вероятно PACK_SALE контракт`,
    `value: "${tx ? formatEther(tx.value) : '0'} ETH"`,
    `selector: "${selector}"`,
    `status: "${receipt?.status === 1 ? 'success' : 'failed'}"`,
    `gas_used: ${receipt?.gasUsed?.toString() ?? 'unknown'}`,
    '```',
    '',
    '## Переменные окружения для заполнения',
    '',
    '```bash',
    `export GRAIL_PACK_SALE="${tx?.to ?? '0x???'}"`,
    `export GRAIL_PACK_NFT="0x???"    # Найти из события PackOpened`,
    `export GRAIL_PAYMENT_TOKEN="ETH"  # или USDC — проверь значение value выше`,
    '```',
    '',
    '## Следующие шаги',
    '',
    '1. Определить тип пак NFT:',
    `   cast call ${tx?.to ?? '<PACK_SALE>'} "supportsInterface(bytes4)(bool)" 0xd9b67a26 --rpc-url https://mainnet.base.org`,
    `   # Если true → ERC1155 (GRAIL_NFT_ERC1155=true)`,
    `   # Если false → ERC721 (по умолчанию)`,
    '',
    '2. Найти имя view-функции цены:',
    `   cast 4byte ${selector}`,
    '',
    '3. Задать все ENV переменные и запустить:',
    '   npm start -- --dry-run',
  ];

  return lines.join('\n');
}

main().catch((err) => {
  console.error('Ошибка:', err);
  process.exit(1);
});
