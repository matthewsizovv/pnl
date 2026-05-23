import { Interface } from 'ethers';
import { FatalError } from '../core/errors.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const PackSaleABI: unknown[] = require('./abi/PackSale.json');
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const PackNFTABI: unknown[] = require('./abi/PackNFT.json');

/**
 * Contract addresses on Base mainnet.
 *
 * ⚠️  ALL ADDRESSES ARE PLACEHOLDERS — fill in after Phase 0 RE.
 * Find the real addresses via:
 *   1. BaseScan transactions from Grail.xyz frontend
 *   2. Tenderly debugger on real buy/open txs
 *   3. Chrome DevTools Network tab (mitmproxy)
 */
export const ADDRESSES = {
  /** Grail pack sale contract */
  PACK_SALE: process.env['GRAIL_PACK_SALE'] ?? '0x0000000000000000000000000000000000000001',
  /** Grail pack NFT contract (ERC721 or ERC1155) */
  PACK_NFT: process.env['GRAIL_PACK_NFT'] ?? '0x0000000000000000000000000000000000000002',
  /** USDC on Base */
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  /** WETH on Base */
  WETH: '0x4200000000000000000000000000000000000006',
} as const;

// Sanity check: refuse to run against placeholder addresses in non-dry-run mode
export function assertContractsConfigured(dryRun: boolean): void {
  if (dryRun) return;
  if (
    ADDRESSES.PACK_SALE === '0x0000000000000000000000000000000000000001' ||
    ADDRESSES.PACK_NFT === '0x0000000000000000000000000000000000000002'
  ) {
    throw new FatalError(
      'Contract addresses not configured. Complete Phase 0 RE and set GRAIL_PACK_SALE / GRAIL_PACK_NFT env vars.',
    );
  }
}

// ABI interfaces
export const PACK_SALE_IFACE = new Interface(PackSaleABI as never[]);
export const PACK_NFT_IFACE = new Interface(PackNFTABI as never[]);

/**
 * Payment token for packs.
 * TODO Phase 0: confirm whether packs are paid in ETH or USDC.
 */
export const PACK_PAYMENT: 'ETH' | 'USDC' = 'USDC';

/**
 * Price per pack in payment token units (raw).
 * TODO Phase 0: confirm fixed vs dynamic pricing.
 * For dynamic pricing, implement getPricePerPack() that reads from contract.
 */
export const PACK_PRICE_RAW: bigint = 10_000_000n; // placeholder: 10 USDC (6 decimals)

/**
 * Maximum packs per wallet per tx.
 * TODO Phase 0: confirm from contract or RE_REPORT.md
 */
export const MAX_PACKS_PER_WALLET: number | null = null;

/**
 * Does the buy function require a backend-signed message?
 * TODO Phase 0: check if Grail backend returns a signature required in buy() call.
 */
export const REQUIRES_BACKEND_SIGNATURE = false;
