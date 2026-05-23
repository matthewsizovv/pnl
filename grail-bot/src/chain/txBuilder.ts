import {
  type JsonRpcProvider,
  type Wallet,
  type TransactionRequest,
  type TransactionReceipt,
  type TransactionResponse,
  type Log,
  type Interface,
  parseEther,
  formatEther,
} from 'ethers';
import { getRpcPool } from './rpcPool.js';
import { getNonceManager } from './nonceManager.js';
import { getGasOracle, type GasParams } from './gasOracle.js';
import { getDB, type TxStage } from '../core/db.js';
import { RetryableError, WalletBlockedError, classifyError } from '../core/errors.js';
import { walletLogger } from '../core/logger.js';
import type { Config } from '../core/config.js';

export interface TxRequest {
  to: string;
  data: string;
  value?: bigint;
  /** Estimated gas limit (will be buffered by 1.2x) */
  gasLimit?: bigint;
  /** Stage label for DB tracking */
  stage: TxStage;
  /** Required USDC amount for pre-flight check */
  requiredUsdc?: bigint;
  /** If true, just log the tx and return a fake hash */
  dryRun?: boolean;
}

interface PrefightContext {
  balanceEth: bigint;
  balanceUsdc: bigint;
  lastSeenBlock: number;
}

const CONFIRMATIONS = 2;
const GAS_BUFFER = 120n; // 1.2x = 120/100

export class TxBuilder {
  private cfg: Config;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  /**
   * Pre-flight checks. Throws WalletBlockedError or RetryableError on failure.
   */
  async preflight(
    wallet: Wallet,
    tx: TxRequest,
    ctx: PrefightContext,
    gasParams: GasParams,
  ): Promise<void> {
    const log = walletLogger(wallet.address);
    const pool = getRpcPool();

    // 1. RPC staleness check
    const blockNumber = await pool.call<number>((p: JsonRpcProvider) => p.getBlockNumber());
    if (blockNumber <= ctx.lastSeenBlock) {
      throw new RetryableError('RPC appears stale — block not advancing');
    }

    // 2. Gas estimation
    let gasLimit = tx.gasLimit;
    if (!gasLimit) {
      const estimated = await pool.call<bigint>((p: JsonRpcProvider) =>
        p.estimateGas({ ...tx, from: wallet.address }),
      );
      gasLimit = (estimated * GAS_BUFFER) / 100n;
    }

    const gasCost = getGasOracle().estimateCostEth(gasLimit, gasParams);
    const reserve = parseEther('0.0001'); // small reserve margin
    const needed = gasCost + reserve + (tx.value ?? 0n);

    if (ctx.balanceEth < needed) {
      throw new WalletBlockedError(
        `Insufficient ETH: have ${formatEther(ctx.balanceEth)}, need ${formatEther(needed)}`,
        wallet.address,
      );
    }

    // 3. USDC check
    if (tx.requiredUsdc !== undefined && ctx.balanceUsdc < tx.requiredUsdc) {
      throw new WalletBlockedError(
        `Insufficient USDC: have ${ctx.balanceUsdc}, need ${tx.requiredUsdc}`,
        wallet.address,
      );
    }

    // 4. Nonce check
    await getNonceManager().assertSync(wallet.address);

    // 5. eth_call simulation — catch reverts before spending gas on mainnet
    log.debug({ stage: tx.stage }, 'Simulating tx via eth_call');
    await pool.call<string>((p: JsonRpcProvider) =>
      p.call({ to: tx.to, data: tx.data, from: wallet.address, value: tx.value ?? 0n }),
    );

    log.debug({ stage: tx.stage, gasLimit: gasLimit.toString() }, 'Pre-flight passed');
  }

  /**
   * Build, sign, and send a transaction with retry + replacement on underpriced.
   * Waits for CONFIRMATIONS confirmations, verifies events.
   */
  async send(
    wallet: Wallet,
    tx: TxRequest,
    ctx: PrefightContext,
    verifyEvent?: { iface: Interface; eventName: string },
  ): Promise<TransactionReceipt> {
    const log = walletLogger(wallet.address);
    const db = getDB();

    if (tx.dryRun ?? this.cfg.execution.dryRun) {
      log.info({ stage: tx.stage, to: tx.to, data: tx.data.slice(0, 66) }, '[DRY-RUN] TX skipped');
      // Return a fake receipt for dry-run
      return { status: 1, hash: '0x' + '0'.repeat(64) } as unknown as TransactionReceipt;
    }

    const retry = this.cfg.retry;
    let gasParams = await getGasOracle().getGasParams();
    let lastErr: unknown;

    for (let attempt = 0; attempt < retry.maxAttempts; attempt++) {
      // Wait on retries
      if (attempt > 0) {
        const delayMs = retry.backoffMs[attempt - 1] ?? 16_000;
        log.info({ attempt, delayMs, stage: tx.stage }, 'Retry backoff');
        await sleep(delayMs);

        // Bump gas on replacement attempts
        if (attempt > 1) {
          gasParams = getGasOracle().bump(gasParams);
        }
      }

      try {
        await this.preflight(wallet, tx, ctx, gasParams);

        const nonce = await getNonceManager().getNonce(wallet.address);
        const pool = getRpcPool();

        // Estimate gas with buffer
        const estimated = await pool.call<bigint>((p: JsonRpcProvider) =>
          p.estimateGas({ ...tx, from: wallet.address }),
        );
        const gasLimit = (estimated * GAS_BUFFER) / 100n;

        const txReq: TransactionRequest = {
          to: tx.to,
          data: tx.data,
          value: tx.value ?? 0n,
          nonce,
          gasLimit,
          maxFeePerGas: gasParams.maxFeePerGas,
          maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
          chainId: BigInt(this.cfg.network.chainId),
          type: 2,
        };

        log.info(
          {
            stage: tx.stage,
            nonce,
            gasLimit: gasLimit.toString(),
            maxFeeGwei: (gasParams.maxFeePerGas / 1_000_000_000n).toString(),
          },
          'Sending tx',
        );

        const response: TransactionResponse = await wallet.sendTransaction(txReq);
        getNonceManager().advance(wallet.address);

        // Record in DB
        db.insertTx({
          hash: response.hash,
          wallet: wallet.address,
          stage: tx.stage,
          nonce,
          status: 'pending',
          created_at: Date.now(),
        });

        log.info({ stage: tx.stage, txHash: response.hash }, 'Tx broadcast, waiting for confirmations');

        // Wait for confirmations
        const receipt = await response.wait(CONFIRMATIONS);

        if (!receipt) {
          throw new RetryableError('Tx receipt is null — possible reorg');
        }

        if (receipt.status === 0) {
          db.updateTxStatus(response.hash, 'reverted');
          throw new WalletBlockedError(
            `Tx ${response.hash} reverted on-chain`,
            wallet.address,
          );
        }

        db.updateTxStatus(response.hash, 'confirmed', Number(receipt.gasUsed), receipt.blockNumber);
        ctx.lastSeenBlock = receipt.blockNumber;

        // Verify expected event was emitted
        if (verifyEvent) {
          const found = receipt.logs.some((rawLog: Log) => {
            try {
              const parsed = verifyEvent.iface.parseLog({
                topics: [...rawLog.topics],
                data: rawLog.data,
              });
              return parsed?.name === verifyEvent.eventName;
            } catch {
              return false;
            }
          });

          if (!found) {
            throw new WalletBlockedError(
              `Expected event '${verifyEvent.eventName}' not found in tx ${response.hash}`,
              wallet.address,
            );
          }
        }

        log.info(
          {
            stage: tx.stage,
            txHash: receipt.hash,
            gasUsed: receipt.gasUsed.toString(),
            blockNumber: receipt.blockNumber,
          },
          'Tx confirmed',
        );

        return receipt;
      } catch (err) {
        lastErr = err;

        // Don't retry fatal / wallet-blocked errors
        if (err instanceof WalletBlockedError) throw err;

        const classified = classifyError(err, wallet.address);
        if (classified instanceof WalletBlockedError) throw classified;

        // Handle nonce drift specially — resync and retry
        if (err instanceof RetryableError && String(err.message).includes('Nonce drift')) {
          await getNonceManager().syncFromChain(wallet.address);
        }

        log.warn({ stage: tx.stage, attempt, err: String(err) }, 'Tx attempt failed, will retry');
      }
    }

    throw new RetryableError(
      `Tx failed after ${retry.maxAttempts} attempts`,
      lastErr,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let _builder: TxBuilder | null = null;

export function initTxBuilder(cfg: Config): TxBuilder {
  _builder = new TxBuilder(cfg);
  return _builder;
}

export function getTxBuilder(): TxBuilder {
  if (!_builder) throw new Error('TxBuilder not initialized');
  return _builder;
}
