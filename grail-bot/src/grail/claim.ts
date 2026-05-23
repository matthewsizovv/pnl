/**
 * Claim rewards module.
 *
 * TODO Phase 0: Determine if rewards are:
 *   a) Minted automatically during open() → this module is a no-op
 *   b) Require a separate claim() tx → implement below
 *
 * Check by:
 *   1. Looking at PackOpened event — if tokens are transferred in the same tx, option (a)
 *   2. Looking for a separate Claim event or pending rewards mapping in the contract
 *   3. Checking the Grail frontend for a "Claim" button after opening
 */

import type { Wallet } from 'ethers';
import { walletLogger } from '../core/logger.js';

export interface ClaimResult {
  needed: boolean;
  skipped: boolean;
}

/**
 * Idempotent claim stage.
 * Currently a stub — fill in after Phase 0 RE.
 */
export async function claimRewards(wallet: Wallet, _dryRun = false): Promise<ClaimResult> {
  const log = walletLogger(wallet.address);

  // TODO Phase 0: Implement based on RE findings
  // If rewards auto-mint during open(), just return { needed: false, skipped: true }
  log.debug('Claim stage: checking if separate claim is needed (TODO Phase 0)');

  return { needed: false, skipped: true };
}
