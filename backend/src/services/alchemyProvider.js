import { logger } from '../logger.js';

const SEMAPHORE_LIMIT = 5;
let _active = 0;
const _queue = [];

function acquire() {
  return new Promise(resolve => {
    if (_active < SEMAPHORE_LIMIT) { _active++; resolve(); }
    else _queue.push(resolve);
  });
}

function release() {
  _active--;
  if (_queue.length > 0) { _active++; _queue.shift()(); }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function rpcCall(url, method, params, retries = 3) {
  const delays = [1000, 3000, 9000];
  for (let i = 0; i <= retries; i++) {
    await acquire();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429) {
        release();
        await sleep(10000);
        continue;
      }
      const json = await res.json();
      release();
      if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
      return json.result;
    } catch (err) {
      release();
      if (i === retries) throw err;
      logger.warn({ err, method, attempt: i }, 'RPC retry');
      await sleep(delays[i] || 9000);
    }
  }
}

function getRpcUrl(chain) {
  return chain === 'eth' ? process.env.ALCHEMY_ETH : process.env.ALCHEMY_BASE;
}

export async function getLatestBlock(chain) {
  const result = await rpcCall(getRpcUrl(chain), 'eth_blockNumber', []);
  return parseInt(result, 16);
}

export async function getTransactionReceipt(chain, txHash) {
  return rpcCall(getRpcUrl(chain), 'eth_getTransactionReceipt', [txHash]);
}

export async function getTransfersByAddress(chain, address, fromBlock, toBlock, direction) {
  const url = getRpcUrl(chain);
  const params = {
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
    category: ['external', 'erc20'],
    withMetadata: true,
    excludeZeroValue: true,
    maxCount: '0x3e8',
  };
  if (direction === 'from') params.fromAddress = address;
  else params.toAddress = address;

  const results = [];
  let pageKey;
  do {
    if (pageKey) params.pageKey = pageKey;
    const data = await rpcCall(url, 'alchemy_getAssetTransfers', [params]);
    if (data?.transfers) results.push(...data.transfers);
    pageKey = data?.pageKey;
  } while (pageKey);

  return results;
}
