import { Contract, type Wallet } from 'ethers';
import { getTxBuilder } from '../chain/txBuilder.js';
import { getRpcPool } from '../chain/rpcPool.js';
import { balanceOf } from '../chain/erc20.js';
import { ADDRESSES, PACK_NFT_IFACE } from './contracts.js';
import { walletLogger } from '../core/logger.js';
import type { TransactionReceipt } from 'ethers';

export interface OpenPacksResult {
  skipped: boolean;
  receipt?: TransactionReceipt;
  packsOpened: number;
  tokensReceived: { address: string; amount: bigint }[];
}

/**
 * Idempotent open-packs stage.
 *
 * 1. Check on-chain pack NFT balance.
 * 2. If balance == 0 → skip (already opened or never bought).
 * 3. Get list of pack token IDs owned by wallet.
 * 4. Call open(packIds[]).
 * 5. Parse PackOpened events to capture received tokens.
 *
 * TODO Phase 0:
 *   - Verify whether open() takes all packs at once or one at a time.
 *   - Verify if there's a cooldown between opens.
 *   - Check if NFT is ERC721 or ERC1155 (affects balanceOf/tokensOfOwner call).
 */
export async function openPacks(wallet: Wallet, dryRun = false): Promise<OpenPacksResult> {
  const log = walletLogger(wallet.address);

  // ── Idempotency check: do we own any pack NFTs? ────────────────────────
  const packBalance = await getRpcPool().call<bigint>((p) => {
    const c = new Contract(ADDRESSES.PACK_NFT, PACK_NFT_IFACE, p);
    return (c['balanceOf'] as (a: string) => Promise<bigint>)(wallet.address);
  });

  if (packBalance === 0n) {
    log.info('No pack NFTs held, skipping open stage');
    return { skipped: true, packsOpened: 0, tokensReceived: [] };
  }

  log.info({ packBalance: packBalance.toString() }, 'Opening packs');

  // ── Get pack token IDs ────────────────────────────────────────────────
  // TODO Phase 0: verify that tokensOfOwner() exists; some contracts use ERC721Enumerable
  const packIds = await getRpcPool().call<bigint[]>((p) => {
    const c = new Contract(ADDRESSES.PACK_NFT, PACK_NFT_IFACE, p);
    return (c['tokensOfOwner'] as (a: string) => Promise<bigint[]>)(wallet.address);
  });

  if (packIds.length === 0) {
    log.info('No pack IDs returned, skipping open stage');
    return { skipped: true, packsOpened: 0, tokensReceived: [] };
  }

  // ── Build calldata ─────────────────────────────────────────────────────
  const data = PACK_NFT_IFACE.encodeFunctionData('open', [packIds]);

  // ── Fetch balances for pre-flight ──────────────────────────────────────
  const [balEth, balUsdc, blockNumber] = await Promise.all([
    getRpcPool().call((p) => p.getBalance(wallet.address)),
    balanceOf(ADDRESSES.USDC, wallet.address),
    getRpcPool().call((p) => p.getBlockNumber()),
  ]);

  // ── Send tx ────────────────────────────────────────────────────────────
  const receipt = await getTxBuilder().send(
    wallet,
    {
      to: ADDRESSES.PACK_NFT,
      data,
      stage: 'open',
      dryRun,
    },
    { balanceEth: balEth, balanceUsdc: balUsdc, lastSeenBlock: blockNumber },
    { iface: PACK_NFT_IFACE, eventName: 'PackOpened' },
  );

  // ── Parse received tokens from events ─────────────────────────────────
  const tokensReceived: { address: string; amount: bigint }[] = [];

  if (!dryRun) {
    for (const rawLog of receipt.logs) {
      try {
        const parsed = PACK_NFT_IFACE.parseLog({
          topics: [...rawLog.topics],
          data: rawLog.data,
        });
        if (parsed?.name === 'PackOpened') {
          const tokens = parsed.args['tokens'] as string[];
          const amounts = parsed.args['amounts'] as bigint[];
          for (let i = 0; i < tokens.length; i++) {
            tokensReceived.push({
              address: tokens[i]!,
              amount: amounts[i]!,
            });
          }
        }
      } catch {
        // Not a PackOpened log
      }
    }
  }

  log.info(
    { packsOpened: packIds.length, tokensReceived: tokensReceived.length, txHash: receipt.hash },
    'Packs opened successfully',
  );

  return {
    skipped: false,
    receipt,
    packsOpened: packIds.length,
    tokensReceived,
  };
}
