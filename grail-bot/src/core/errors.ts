/**
 * Typed error hierarchy.
 *
 * FatalError         → stop the entire bot, human required
 * WalletBlockedError → skip this wallet, continue with next
 * RetryableError     → exponential backoff, up to maxAttempts
 * SkipTokenError     → skip this specific token during sell phase
 */

export class FatalError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'FatalError';
    if (cause instanceof Error) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

export class WalletBlockedError extends Error {
  constructor(
    message: string,
    public readonly wallet: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WalletBlockedError';
    if (cause instanceof Error) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RetryableError';
    if (cause instanceof Error) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

export class SkipTokenError extends Error {
  constructor(
    message: string,
    public readonly token: string,
    public readonly reason: 'no_liquidity' | 'honeypot' | 'below_threshold' | 'simulation_revert',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SkipTokenError';
    if (cause instanceof Error) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Classify a raw RPC/contract error into our typed hierarchy.
 * Returns the most appropriate error type.
 */
export function classifyError(
  err: unknown,
  wallet: string,
): FatalError | WalletBlockedError | RetryableError {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

  // Fatal: configuration problems that require human intervention
  if (msg.includes('encryption key') || msg.includes('master_key') || msg.includes('schema')) {
    return new FatalError(`Fatal: ${msg}`, err);
  }

  // Wallet blocked: insufficient ETH/gas
  if (
    msg.includes('insufficient funds for gas') ||
    msg.includes('insufficient funds for transfer') ||
    msg.includes('insufficient eth')
  ) {
    return new WalletBlockedError(`Insufficient gas: ${msg}`, wallet, err);
  }

  // Wallet blocked: reverts we cannot recover from
  if (
    (msg.includes('execution reverted') || msg.includes('revert')) &&
    !msg.includes('nonce') &&
    !msg.includes('replacement')
  ) {
    return new WalletBlockedError(`Contract reverted: ${msg}`, wallet, err);
  }

  // Retryable: nonce issues
  if (msg.includes('nonce too low') || msg.includes('nonce too high') || msg.includes('nonce')) {
    return new RetryableError(`Nonce drift: ${msg}`, err);
  }

  // Retryable: gas/replacement issues
  if (msg.includes('replacement underpriced') || msg.includes('transaction underpriced')) {
    return new RetryableError(`Underpriced: ${msg}`, err);
  }

  // Retryable: RPC timeouts and connectivity
  if (
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('network error') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('socket hang up') ||
    msg.includes('request failed') ||
    msg.includes('rpc') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  ) {
    return new RetryableError(`RPC error: ${msg}`, err);
  }

  // Default: treat unknown errors as retryable with a warning
  return new RetryableError(`Unknown error (treated as retryable): ${msg}`, err);
}
