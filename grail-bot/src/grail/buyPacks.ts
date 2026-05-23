import type { Wallet } from 'ethers';
import { MaxUint256 } from 'ethers';
import { getTxBuilder } from '../chain/txBuilder.js';
import { getRpcPool } from '../chain/rpcPool.js';
import { ensureApproval, buildApproveData, balanceOf } from '../chain/erc20.js';
import {
  ADDRESSES,
  PACK_SALE_IFACE,
  PACK_PAYMENT,
  PACK_PRICE_RAW,
  MAX_PACKS_PER_WALLET,
  REQUIRES_BACKEND_SIGNATURE,
} from './contracts.js';
import { getPackBuySignature } from './api.js';
import { walletLogger } from '../core/logger.js';
import { WalletBlockedError, RetryableError } from '../core/errors.js';
import { getDB } from '../core/db.js';
import type { TransactionReceipt } from 'ethers';

export interface BuyPacksResult {
  skipped: boolean;
  receipt?: TransactionReceipt;
  packCount: number;
}

/**
 * Idempotent buy-packs stage.
 *
 * Checks on-chain state before acting:
 *   1. Count PackBought events from this wallet in the last hour.
 *   2. If already purchased target count → skip.
 *   3. Check USDC allowance and approve if needed.
 *   4. Build buy() calldata (with backend signature if required).
 *   5. Send tx and verify PackBought event.
 */
export async function buyPacks(
  wallet: Wallet,
  packCount: number,
  dryRun = false,
): Promise<BuyPacksResult> {
  const log = walletLogger(wallet.address);

  // ── Idempotency check ─────────────────────────────────────────────────────
  const alreadyBought = await countRecentPacksBought(wallet.address, packCount);
  if (alreadyBought >= packCount) {
    log.info({ packCount, alreadyBought }, 'Packs already bought on-chain, skipping');
    return { skipped: true, packCount: alreadyBought };
  }

  const remaining = packCount - alreadyBought;
  log.info({ packCount, alreadyBought, remaining }, 'Buying packs');

  // ── Pack limit check ──────────────────────────────────────────────────────
  if (MAX_PACKS_PER_WALLET !== null && remaining > MAX_PACKS_PER_WALLET) {
    throw new WalletBlockedError(
      `Pack limit exceeded: trying to buy ${remaining}, max is ${MAX_PACKS_PER_WALLET}`,
      wallet.address,
    );
  }

  // ── USDC approval ─────────────────────────────────────────────────────────
  if (PACK_PAYMENT === 'USDC') {
    const totalCost = PACK_PRICE_RAW * BigInt(remaining);
    const { needed } = await ensureApproval(wallet, ADDRESSES.USDC, ADDRESSES.PACK_SALE, totalCost);

    if (needed) {
      log.info({ totalCost: totalCost.toString() }, 'Approving USDC for pack sale');
      const balUsdc = await balanceOf(ADDRESSES.USDC, wallet.address);
      const balEth = await getRpcPool().call((p) => p.getBalance(wallet.address));

      await getTxBuilder().send(
        wallet,
        {
          to: ADDRESSES.USDC,
          data: buildApproveData(ADDRESSES.PACK_SALE, MaxUint256),
          stage: 'approve',
          dryRun,
        },
        {
          balanceEth: balEth,
          balanceUsdc: balUsdc,
          lastSeenBlock: await getRpcPool().call((p) => p.getBlockNumber()),
        },
        { iface: PACK_SALE_IFACE, eventName: 'Approval' },
      );

      getDB().updateWalletState(wallet.address, 'APPROVED');
    }
  }

  // ── Backend signature (if required) ──────────────────────────────────────
  let extraCalldata = '0x';
  if (REQUIRES_BACKEND_SIGNATURE) {
    const quote = await getPackBuySignature(wallet.address, remaining);
    // TODO Phase 0: encode signature into calldata per contract ABI
    extraCalldata = quote.signature;
    log.debug({ deadline: quote.deadline }, 'Got backend signature for buy');
  }

  // ── Build calldata ────────────────────────────────────────────────────────
  // TODO Phase 0: replace with actual function signature from RE_REPORT.md
  // Example: buy(uint256 packCount) or buy(uint256 packCount, bytes signature, uint256 deadline)
  const data = PACK_SALE_IFACE.encodeFunctionData('buy', [BigInt(remaining)]);

  // ── Fetch balances for pre-flight ─────────────────────────────────────────
  const [balEth, balUsdc, blockNumber] = await Promise.all([
    getRpcPool().call((p) => p.getBalance(wallet.address)),
    balanceOf(ADDRESSES.USDC, wallet.address),
    getRpcPool().call((p) => p.getBlockNumber()),
  ]);

  const totalCost = PACK_PAYMENT === 'USDC' ? PACK_PRICE_RAW * BigInt(remaining) : 0n;
  const value = PACK_PAYMENT === 'ETH' ? PACK_PRICE_RAW * BigInt(remaining) : 0n;

  // ── Send tx ───────────────────────────────────────────────────────────────
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
    { balanceEth: balEth, balanceUsdc: balUsdc, lastSeenBlock: blockNumber },
    { iface: PACK_SALE_IFACE, eventName: 'PackBought' },
  );

  log.info({ packCount: remaining, txHash: receipt.hash }, 'Packs bought successfully');
  return { skipped: false, receipt, packCount: remaining };
}

/**
 * Count PackBought events from this wallet in the last ~1 hour.
 * Used for idempotency checks.
 *
 * TODO Phase 0: verify actual event name and parameters.
 */
async function countRecentPacksBought(walletAddress: string, _target: number): Promise<number> {
  // TODO: implement via eth_getLogs with PackBought topic, last 1800 blocks (~1h on Base)
  // For now, check DB for confirmed buy txs
  const db = getDB();
  const txs = db.getTxByWalletAndStage(walletAddress, 'buy');
  const confirmed = txs.filter((t) => t.status === 'confirmed');
  return confirmed.length; // simplified — in production, parse event logs for exact pack count
}
