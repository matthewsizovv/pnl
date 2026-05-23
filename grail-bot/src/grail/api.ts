import { request } from 'undici';
import { logger } from '../core/logger.js';
import { RetryableError, FatalError } from '../core/errors.js';

/**
 * Grail.xyz backend API client.
 *
 * TODO Phase 0: Determine if Grail uses a backend signing service.
 * If REQUIRES_BACKEND_SIGNATURE is true:
 *   - Capture the actual API endpoint via Chrome DevTools / mitmproxy
 *   - Implement auth flow (JWT, wallet-signed nonce, etc.)
 *   - Replace the stub methods below with real implementations
 *
 * If no backend signing is needed, this module is unused.
 */

const BASE_URL = process.env['GRAIL_API_URL'] ?? 'https://api.grail.xyz';
const API_KEY = process.env['GRAIL_API_KEY'] ?? '';

interface PackQuoteResponse {
  signature: string;
  deadline: number;
  nonce: string;
  price: string;
}

/**
 * Request a signed quote from the Grail backend for buying packs.
 * TODO Phase 0: Replace stub with actual implementation once API is reversed.
 */
export async function getPackBuySignature(
  walletAddress: string,
  packCount: number,
): Promise<PackQuoteResponse> {
  // Stub — replace after Phase 0 RE
  logger.warn({ walletAddress, packCount }, '[API STUB] getPackBuySignature not implemented');

  if (process.env['GRAIL_API_STUB'] === 'true') {
    return {
      signature: '0x' + '00'.repeat(65),
      deadline: Math.floor(Date.now() / 1000) + 3600,
      nonce: '0',
      price: '0',
    };
  }

  throw new FatalError(
    'Grail backend API not implemented. Complete Phase 0 RE and implement getPackBuySignature().',
  );
}

/**
 * Generic API request with retry on 429/5xx.
 */
async function apiRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }

  const reqOptions: Parameters<typeof request>[1] = {
    method,
    headers,
  };
  if (body !== undefined) {
    reqOptions.body = JSON.stringify(body);
  }
  const response = await request(url, reqOptions);

  if (response.statusCode === 429) {
    const retryAfter = response.headers['retry-after'];
    throw new RetryableError(
      `Grail API rate limited, retry-after: ${retryAfter}`,
    );
  }

  if (response.statusCode >= 500) {
    throw new RetryableError(`Grail API server error: ${response.statusCode}`);
  }

  if (response.statusCode >= 400) {
    const text = await response.body.text();
    throw new FatalError(`Grail API client error ${response.statusCode}: ${text}`);
  }

  return response.body.json() as Promise<T>;
}
