/**
 * Orchestrator: runs wallets sequentially (concurrency=1 by default).
 *
 * Features:
 *   - Resume from any state after crash
 *   - Graceful shutdown on SIGINT/SIGTERM
 *   - Random delay between wallets (human-like)
 *   - Skips DONE and BLOCKED wallets
 *   - FAILED_RETRY wallets are retried in the same run
 */

import { getDB, type WalletRow } from '../core/db.js';
import { logger, maskAddress } from '../core/logger.js';
import { runWallet } from './walletRunner.js';
import { FatalError } from '../core/errors.js';
import type { Config } from '../core/config.js';

let _shutdown = false;

export function setupShutdownHandlers(): void {
  const handler = (signal: string) => {
    logger.warn({ signal }, 'Shutdown signal received — finishing current wallet then exiting');
    _shutdown = true;
  };
  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}

export interface OrchestratorOptions {
  onlyIndex?: number; // Run only wallet at this CSV index
  resumeOnly?: boolean; // Skip NEW wallets, only resume unfinished
}

/**
 * Main orchestration loop.
 */
export async function runOrchestrator(config: Config, opts: OrchestratorOptions = {}): Promise<void> {
  const db = getDB();
  setupShutdownHandlers();

  const allWallets = db.getAllWallets();
  logger.info({ total: allWallets.length }, 'Orchestrator starting');

  // Filter wallets to process
  let wallets: WalletRow[];
  if (opts.onlyIndex !== undefined) {
    wallets = allWallets.filter((w) => w.index_in_csv === opts.onlyIndex);
    if (wallets.length === 0) {
      logger.warn({ index: opts.onlyIndex }, 'No wallet found at that index');
      return;
    }
  } else {
    wallets = allWallets.filter(
      (w) => w.state !== 'DONE' && w.state !== 'BLOCKED',
    );
  }

  if (opts.resumeOnly) {
    wallets = wallets.filter((w) => w.state !== 'NEW');
  }

  logger.info({ eligible: wallets.length }, 'Wallets to process');

  if (wallets.length === 0) {
    logger.info('Nothing to do');
    return;
  }

  let processed = 0;
  let succeeded = 0;
  let blocked = 0;
  let retried = 0;

  for (const row of wallets) {
    if (_shutdown) {
      logger.info('Shutdown requested — stopping orchestrator loop');
      break;
    }

    logger.info(
      { index: row.index_in_csv, wallet: maskAddress(row.address), state: row.state },
      `Processing wallet ${processed + 1}/${wallets.length}`,
    );

    const startMs = Date.now();

    try {
      await runWallet(row, config, config.execution.dryRun);

      const freshRow = db.getWallet(row.address);
      if (freshRow?.state === 'DONE') {
        succeeded++;
        logger.info({ wallet: maskAddress(row.address), durationMs: Date.now() - startMs }, 'Wallet DONE');
      } else if (freshRow?.state === 'BLOCKED') {
        blocked++;
        logger.warn({ wallet: maskAddress(row.address), error: freshRow.last_error }, 'Wallet BLOCKED');
      } else if (freshRow?.state === 'FAILED_RETRY') {
        retried++;
        logger.warn({ wallet: maskAddress(row.address) }, 'Wallet will be retried next run');
      }
    } catch (err) {
      if (err instanceof FatalError) {
        logger.fatal({ err: err.message }, 'Fatal error — stopping bot');
        throw err;
      }
      logger.error({ wallet: maskAddress(row.address), err: String(err) }, 'Unexpected error in orchestrator');
      blocked++;
    }

    processed++;

    // Delay between wallets (random human-like interval)
    if (processed < wallets.length && !_shutdown) {
      const [minDelay, maxDelay] = config.execution.delayBetweenWallets;
      const delayMs = randomBetween(minDelay * 1000, maxDelay * 1000);
      logger.debug({ delayMs }, 'Waiting before next wallet');
      await sleep(delayMs);
    }
  }

  logger.info(
    { processed, succeeded, blocked, retried },
    'Orchestrator finished',
  );
}

// ── Summary stats ─────────────────────────────────────────────────────────

export function printStats(): void {
  const db = getDB();
  const stats = db.getStats();

  const lines = [
    '┌─────────────────────────────────┐',
    '│      Wallet State Summary       │',
    '├──────────────────┬──────────────┤',
  ];

  for (const [state, count] of Object.entries(stats)) {
    lines.push(`│ ${state.padEnd(16)} │ ${String(count).padStart(12)} │`);
  }

  lines.push('└──────────────────┴──────────────┘');
  console.log(lines.join('\n'));
}

// ── Helpers ───────────────────────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
