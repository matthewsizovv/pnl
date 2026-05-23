/**
 * Finite-state machine for a single wallet.
 *
 * Transitions:
 *   NEW → PREFLIGHT_OK → APPROVED → PACKS_BOUGHT → PACKS_OPENED
 *       → TOKENS_DISCOVERED → TOKENS_SOLD → CONSOLIDATED → DONE
 *
 * On WalletBlockedError → BLOCKED (skip, continue with next wallet)
 * On RetryableError     → FAILED_RETRY (try again next run)
 * On FatalError         → rethrow (stop everything)
 */

import { Wallet } from 'ethers';
import { decryptPrivateKey } from '../core/crypto.js';
import { getDB, type WalletRow, type WalletState } from '../core/db.js';
import { walletLogger } from '../core/logger.js';
import { WalletBlockedError, FatalError, classifyError } from '../core/errors.js';
import {
  stagePreflight,
  stageBuyPacks,
  stageOpenPacks,
  stageDiscoverTokens,
  stageSellTokens,
  stageConsolidate,
} from './stages.js';
import { getRpcPool } from '../chain/rpcPool.js';
import type { Config } from '../core/config.js';

type StageHandler = (ctx: { wallet: Wallet; row: WalletRow; config: Config; dryRun: boolean }) => Promise<void>;

// State machine: current state → handler to execute
const TRANSITIONS: Partial<Record<WalletState, { handler: StageHandler; next: WalletState }>> = {
  NEW: { handler: stagePreflight, next: 'PREFLIGHT_OK' },
  PREFLIGHT_OK: { handler: stageBuyPacks, next: 'PACKS_BOUGHT' },
  APPROVED: { handler: stageBuyPacks, next: 'PACKS_BOUGHT' }, // APPROVED is a sub-state of PREFLIGHT_OK
  PACKS_BOUGHT: { handler: stageOpenPacks, next: 'PACKS_OPENED' },
  PACKS_OPENED: { handler: stageDiscoverTokens, next: 'TOKENS_DISCOVERED' },
  TOKENS_DISCOVERED: { handler: stageSellTokens, next: 'TOKENS_SOLD' },
  TOKENS_SOLD: { handler: stageConsolidate, next: 'CONSOLIDATED' },
  CONSOLIDATED: { handler: markDone, next: 'DONE' },
};

async function markDone(ctx: { wallet: Wallet; row: WalletRow; config: Config; dryRun: boolean }): Promise<void> {
  getDB().updateWalletState(ctx.wallet.address, 'DONE');
}

export async function runWallet(row: WalletRow, config: Config, dryRun: boolean): Promise<void> {
  const log = walletLogger(row.address);
  const db = getDB();

  log.info({ state: row.state }, 'Starting wallet pipeline');

  // Decrypt private key
  let pk: string;
  try {
    pk = decryptPrivateKey(row.pk_encrypted);
  } catch (err) {
    throw new FatalError('Cannot decrypt private key — check MASTER_KEY env var', err);
  }

  const provider = getRpcPool().getProvider();
  const wallet = new Wallet(pk, provider);

  let currentState = row.state;

  // Resume from current state
  while (currentState !== 'DONE' && currentState !== 'BLOCKED' && currentState !== 'FAILED_RETRY') {
    const transition = TRANSITIONS[currentState];
    if (!transition) {
      log.error({ state: currentState }, 'No transition defined for state — marking BLOCKED');
      db.updateWalletState(row.address, 'BLOCKED', `No transition for state: ${currentState}`);
      break;
    }

    try {
      log.info({ state: currentState }, 'Executing stage');
      const freshRow = db.getWallet(row.address) ?? row;

      await transition.handler({
        wallet,
        row: freshRow,
        config,
        dryRun,
      });

      currentState = transition.next;
      log.info({ state: currentState }, 'Stage completed');
    } catch (err) {
      if (err instanceof FatalError) {
        throw err; // Stop everything
      }

      if (err instanceof WalletBlockedError) {
        log.error({ state: currentState, err: err.message }, 'Wallet blocked');
        db.updateWalletState(row.address, 'BLOCKED', err.message);
        return;
      }

      // Classify and decide fate
      const classified = classifyError(err, row.address);

      if (classified instanceof WalletBlockedError) {
        log.error({ state: currentState, err: classified.message }, 'Wallet blocked (classified)');
        db.updateWalletState(row.address, 'BLOCKED', classified.message);
        return;
      }

      // RetryableError — save state and exit; orchestrator will retry next run
      log.warn({ state: currentState, err: String(err) }, 'Stage failed — will retry next run');
      db.updateWalletState(row.address, 'FAILED_RETRY', String(err));
      return;
    }
  }

  if (currentState === 'DONE') {
    log.info('Wallet pipeline completed successfully');
  }
}
