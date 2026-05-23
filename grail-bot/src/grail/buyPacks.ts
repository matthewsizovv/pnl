/**
 * Модуль покупки паков на Grail.xyz.
 *
 * Идемпотентность:
 *   Перед покупкой проверяем on-chain события PackBought от этого кошелька
 *   за последние ~1 час (≈1800 блоков на Base). Если уже куплено нужное
 *   количество — пропускаем, не тратим газ.
 *
 * Порядок действий:
 *   1. Идемпотентная проверка (события on-chain)
 *   2. Approve USDC если нужно
 *   3. Получить подпись бэкенда (если requiresBackendSignature = true)
 *   4. Построить calldata
 *   5. Preflight → send → ждём 2 подтверждения → проверяем событие PackBought
 */

import { MaxUint256, type Wallet, type TransactionReceipt } from 'ethers';
import { getTxBuilder } from '../chain/txBuilder.js';
import { getRpcPool } from '../chain/rpcPool.js';
import { ensureApproval, buildApproveData, balanceOf } from '../chain/erc20.js';
import {
  ADDRESSES,
  PACK_SALE_IFACE,
  PACK_PAYMENT,
  PACKS_PER_WALLET,
  REQUIRES_BACKEND_SIGNATURE,
  getPackPrice,
  getMaxPacksPerWallet,
} from './contracts.js';
import { getPackBuySignature } from './api.js';
import { walletLogger } from '../core/logger.js';
import { WalletBlockedError } from '../core/errors.js';
import { getDB } from '../core/db.js';

export interface BuyPacksResult {
  /** true если покупка пропущена (уже куплено) */
  skipped: boolean;
  receipt?: TransactionReceipt;
  /** Сколько паков куплено в этот раз */
  packsBought: number;
}

/**
 * Идемпотентная покупка паков.
 *
 * @param wallet   Кошелёк покупателя
 * @param count    Сколько паков хотим купить
 * @param dryRun   Если true — только логируем, транзакцию не отправляем
 */
export async function buyPacks(
  wallet: Wallet,
  count: number = PACKS_PER_WALLET,
  dryRun = false,
): Promise<BuyPacksResult> {
  const log = walletLogger(wallet.address);
  const db = getDB();

  // ── 1. Идемпотентность: считаем покупки из on-chain событий ──────────────
  const alreadyBought = await countConfirmedPacksBought(wallet.address);

  if (alreadyBought >= count) {
    log.info({ alreadyBought, target: count }, 'Паки уже куплены on-chain, пропускаем');
    return { skipped: true, packsBought: 0 };
  }

  const remaining = count - alreadyBought;
  log.info({ alreadyBought, remaining, target: count }, 'Покупаем паки');

  // ── 2. Проверка лимита паков на кошелёк ──────────────────────────────────
  const maxPerWallet = await getMaxPacksPerWallet();
  if (maxPerWallet !== null && remaining > maxPerWallet) {
    throw new WalletBlockedError(
      `Превышен лимит паков: пытаемся купить ${remaining}, максимум ${maxPerWallet}`,
      wallet.address,
    );
  }

  // ── 3. Получаем цену и проверяем USDC баланс ─────────────────────────────
  const pricePerPack = await getPackPrice();
  const totalCost = pricePerPack * BigInt(remaining);

  log.debug(
    { pricePerPack: pricePerPack.toString(), totalCost: totalCost.toString(), token: PACK_PAYMENT },
    'Стоимость паков',
  );

  // ── 4. Апруваем USDC если оплата в USDC ──────────────────────────────────
  if (PACK_PAYMENT === 'USDC') {
    const { needed } = await ensureApproval(wallet, ADDRESSES.USDC, ADDRESSES.PACK_SALE, totalCost);

    if (needed) {
      log.info({ totalCost: totalCost.toString() }, 'Апруваем USDC для контракта продажи паков');

      const [balEth, balUsdc, blockNum] = await fetchBalances(wallet.address);

      // Апруваем MaxUint256 чтобы не делать approve перед каждой покупкой
      await getTxBuilder().send(
        wallet,
        {
          to: ADDRESSES.USDC,
          data: buildApproveData(ADDRESSES.PACK_SALE, MaxUint256),
          stage: 'approve',
          dryRun,
        },
        { balanceEth: balEth, balanceUsdc: balUsdc, lastSeenBlock: blockNum },
      );

      db.updateWalletState(wallet.address, 'APPROVED');
      log.info('USDC аппрув выполнен');
    }
  }

  // ── 5. Получаем подпись бэкенда (если нужно) ─────────────────────────────
  let backendSignatureBytes = '0x';
  let backendDeadline = 0;

  if (REQUIRES_BACKEND_SIGNATURE) {
    log.debug('Запрашиваем подпись у бэкенда Grail');
    const quote = await getPackBuySignature(wallet.address, remaining);
    backendSignatureBytes = quote.signature;
    backendDeadline = quote.deadline;
    log.debug({ deadline: backendDeadline }, 'Подпись бэкенда получена');
  }

  // ── 6. Строим calldata ────────────────────────────────────────────────────
  // TODO Phase 0: заменить encodeFunctionData согласно реальной сигнатуре из RE_REPORT.md
  //
  // Варианты (раскомментировать нужный после Phase 0):
  //
  //   Без подписи:
  //   const data = PACK_SALE_IFACE.encodeFunctionData('buy', [BigInt(remaining)]);
  //
  //   С подписью и дедлайном:
  //   const data = PACK_SALE_IFACE.encodeFunctionData('buy', [
  //     BigInt(remaining),
  //     backendSignatureBytes,
  //     BigInt(backendDeadline),
  //   ]);
  //
  //   С конкретным ID коллекции:
  //   const data = PACK_SALE_IFACE.encodeFunctionData('buy', [
  //     BigInt(process.env['GRAIL_COLLECTION_ID'] ?? '1'),
  //     BigInt(remaining),
  //   ]);

  let data: string;
  if (REQUIRES_BACKEND_SIGNATURE) {
    data = PACK_SALE_IFACE.encodeFunctionData('buy', [
      BigInt(remaining),
      backendSignatureBytes,
      BigInt(backendDeadline),
    ]);
  } else {
    // Базовый вариант без подписи
    data = PACK_SALE_IFACE.encodeFunctionData('buy', [BigInt(remaining)]);
  }

  // ETH value — только если оплата в ETH
  const value = PACK_PAYMENT === 'ETH' ? totalCost : 0n;

  // ── 7. Preflight + отправка транзакции ───────────────────────────────────
  const [balEth, balUsdc, blockNum] = await fetchBalances(wallet.address);

  log.info(
    { to: ADDRESSES.PACK_SALE, packCount: remaining, value: value.toString() },
    'Отправляем транзакцию покупки паков',
  );

  const receipt = await getTxBuilder().send(
    wallet,
    {
      to: ADDRESSES.PACK_SALE,
      data,
      value,
      stage: 'buy',
      requiredUsdc: PACK_PAYMENT === 'USDC' ? totalCost : undefined,
      dryRun,
    },
    { balanceEth: balEth, balanceUsdc: balUsdc, lastSeenBlock: blockNum },
    // Верифицируем что событие PackBought было эмитировано
    { iface: PACK_SALE_IFACE, eventName: 'PackBought' },
  );

  log.info(
    { packsBought: remaining, txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() },
    'Паки куплены',
  );

  return { skipped: false, receipt, packsBought: remaining };
}

// ── Вспомогательные функции ───────────────────────────────────────────────

/**
 * Считает количество подтверждённых покупок паков этим кошельком.
 *
 * Идемпотентный check: если упали между sendTransaction и записью в БД,
 * повторный запуск НЕ должен купить паки второй раз.
 *
 * Сейчас проверяем через БД (confirmed buy txs).
 * TODO Phase 0: улучшить через eth_getLogs с фильтром по событию PackBought
 *   и адресу кошелька за последние 1800 блоков (~1 час на Base).
 *
 * Пример через eth_getLogs:
 *   const filter = {
 *     address: ADDRESSES.PACK_SALE,
 *     topics: [
 *       id('PackBought(address,uint256,uint256[])'),  // selector события
 *       zeroPad(wallet, 32),                          // indexed buyer
 *     ],
 *     fromBlock: currentBlock - 1800,
 *   };
 *   const logs = await provider.getLogs(filter);
 *   // суммировать packCount из каждого события
 */
async function countConfirmedPacksBought(walletAddress: string): Promise<number> {
  const db = getDB();
  const txs = db.getTxByWalletAndStage(walletAddress, 'buy');

  // Считаем только подтверждённые транзакции
  const confirmedCount = txs.filter((t) => t.status === 'confirmed').length;

  // Упрощение: 1 confirmed tx = 1 закупка (в реальности нужно парсить события)
  // TODO Phase 0: парсить событие PackBought из receipt.logs для точного подсчёта
  return confirmedCount;
}

/** Получить балансы и номер блока для preflight */
async function fetchBalances(address: string): Promise<[bigint, bigint, number]> {
  const pool = getRpcPool();
  return Promise.all([
    pool.call((p) => p.getBalance(address)),
    balanceOf(ADDRESSES.USDC, address),
    pool.call((p) => p.getBlockNumber()),
  ]);
}
