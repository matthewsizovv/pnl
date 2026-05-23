/**
 * Адреса контрактов и ABI интерфейсы для Grail.xyz на Base.
 *
 * ── КАК ЗАПОЛНИТЬ (Phase 0) ────────────────────────────────────────────────
 *
 * Шаг 1: Открой grail.xyz в браузере, DevTools → Network → XHR/Fetch.
 *         Купи 1 пак вручную. Запиши:
 *           a) хэш tx из MetaMask
 *           b) любые API запросы к бэкенду (если есть)
 *
 * Шаг 2: На BaseScan найди транзакцию, скопируй поле "To" → это PACK_SALE.
 *         Если в трейсе есть минт NFT — его контракт → PACK_NFT.
 *
 * Шаг 3: Через Foundry:
 *   cast tx <HASH> --rpc-url https://mainnet.base.org
 *   cast 4byte-decode <CALLDATA_PREFIX_8_CHARS>
 *   cast abi-decode "buy(uint256)" <CALLDATA>
 *
 * Шаг 4: Запусти бота в dry-run и убедись что calldata совпадает с tx.
 *
 * ── ЗАГЛУШКИ (заменить после Phase 0) ─────────────────────────────────────
 */

import { Interface } from 'ethers';
import type { ContractRunner } from 'ethers';
import { Contract } from 'ethers';
import { FatalError } from '../core/errors.js';
import { getRpcPool } from '../chain/rpcPool.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Загружаем ABI из JSON файлов — заменить на реальные после Phase 0
const PackSaleABI: unknown[] = require('./abi/PackSale.json') as unknown[];
const PackNFTABI: unknown[] = require('./abi/PackNFT.json') as unknown[];

// ── АДРЕСА КОНТРАКТОВ ──────────────────────────────────────────────────────
// Берём из ENV, чтобы не хардкодить в коде (безопаснее и удобнее для смены)
export const ADDRESSES = {
  /**
   * Контракт продажи паков Grail.
   * Устанавливается через: export GRAIL_PACK_SALE=0x...
   * TODO Phase 0: заменить после реверс-инжиниринга
   */
  PACK_SALE: process.env['GRAIL_PACK_SALE'] ?? '0x0000000000000000000000000000000000000001',

  /**
   * Контракт NFT паков (ERC721 или ERC1155).
   * Устанавливается через: export GRAIL_PACK_NFT=0x...
   * TODO Phase 0: определить стандарт (ERC721 vs ERC1155) через cast call
   */
  PACK_NFT: process.env['GRAIL_PACK_NFT'] ?? '0x0000000000000000000000000000000000000002',

  /** USDC на Base (нативный, не bridged USDbC) */
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',

  /** WETH на Base (нужен для продажи токенов через некоторые агрегаторы) */
  WETH: '0x4200000000000000000000000000000000000006',

  /**
   * Контракт награды (если отдельный, а не автоматический при открытии).
   * TODO Phase 0: определить — может быть null если mint происходит в open()
   */
  REWARD_CLAIM: process.env['GRAIL_REWARD_CLAIM'] ?? null,
} as const;

// ── ВАЛИДАЦИЯ АДРЕСОВ ──────────────────────────────────────────────────────

/**
 * Запрещает запуск с заглушечными адресами на mainnet.
 * В dry-run пропускаем — там транзакции не идут.
 */
export function assertContractsConfigured(dryRun: boolean): void {
  if (dryRun) return;

  const placeholders = [
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000002',
  ];

  if (placeholders.includes(ADDRESSES.PACK_SALE) || placeholders.includes(ADDRESSES.PACK_NFT)) {
    throw new FatalError(
      'Адреса контрактов не настроены!\n' +
      'Выполни Phase 0 RE и задай переменные окружения:\n' +
      '  export GRAIL_PACK_SALE=0x...\n' +
      '  export GRAIL_PACK_NFT=0x...\n' +
      'Подробнее: см. RE_REPORT.md',
    );
  }
}

// ── ABI ИНТЕРФЕЙСЫ ─────────────────────────────────────────────────────────

/** Интерфейс контракта продажи паков */
export const PACK_SALE_IFACE = new Interface(PackSaleABI as never[]);

/** Интерфейс контракта NFT паков */
export const PACK_NFT_IFACE = new Interface(PackNFTABI as never[]);

// ── ПАРАМЕТРЫ ПАКОВ ────────────────────────────────────────────────────────

/**
 * Токен оплаты за паки.
 * TODO Phase 0: проверить через Tenderly — если msg.value > 0 → ETH, иначе → USDC
 */
export const PACK_PAYMENT: 'ETH' | 'USDC' = (process.env['GRAIL_PAYMENT_TOKEN'] as 'ETH' | 'USDC') ?? 'USDC';

/**
 * Количество паков на кошелёк (читается из ENV или конфига).
 * Устанавливается через: export PACKS_PER_WALLET=3
 */
export const PACKS_PER_WALLET = parseInt(process.env['PACKS_PER_WALLET'] ?? '1', 10);

/**
 * Нужна ли подпись от бэкенда Grail при покупке?
 * TODO Phase 0: ищем в calldata параметр bytes/bytes32 типа — если есть, значит true.
 * Проверить: cast abi-decode на реальной tx.
 */
export const REQUIRES_BACKEND_SIGNATURE = (process.env['GRAIL_BACKEND_SIG'] === 'true');

/**
 * Получить цену одного пака из контракта (динамическая цена).
 * TODO Phase 0: если цена фиксированная, просто return константу.
 * Если динамическая — вызвать view функцию типа price() или packPrice().
 */
export async function getPackPrice(): Promise<bigint> {
  // Статическая цена из ENV (задать после Phase 0)
  const staticPrice = process.env['GRAIL_PACK_PRICE_RAW'];
  if (staticPrice) return BigInt(staticPrice);

  // TODO Phase 0: раскомментировать после того как найдём имя view-функции цены
  // const contract = new Contract(ADDRESSES.PACK_SALE, PACK_SALE_IFACE, getRpcPool().getProvider());
  // return (contract['price'] as () => Promise<bigint>)();

  // Заглушка: 10 USDC (6 decimals)
  return 10_000_000n;
}

/**
 * Лимит паков на кошелёк (null = без лимита).
 * TODO Phase 0: прочитать из контракта через cast call <addr> "maxPerWallet()(uint256)"
 */
export async function getMaxPacksPerWallet(): Promise<number | null> {
  // TODO Phase 0: раскомментировать если контракт имеет такую view-функцию
  // try {
  //   const contract = new Contract(ADDRESSES.PACK_SALE, PACK_SALE_IFACE, getRpcPool().getProvider());
  //   const max = await (contract['maxPerWallet'] as () => Promise<bigint>)();
  //   return Number(max);
  // } catch { return null; }
  return null;
}

/**
 * Проверить, является ли pack NFT стандартом ERC1155 (а не ERC721).
 * ERC1155: balanceOf(address, tokenId) принимает 2 аргумента
 * ERC721: balanceOf(address) принимает 1 аргумент
 * TODO Phase 0: проверить через cast call или посмотреть на ABI в BaseScan
 */
export const PACK_NFT_IS_ERC1155 = (process.env['GRAIL_NFT_ERC1155'] === 'true');
