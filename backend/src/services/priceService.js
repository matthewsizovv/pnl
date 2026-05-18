import { getDb } from '../db/index.js';
import { logger } from '../logger.js';

const CURRENT_CACHE = new Map(); // key -> { price, ts }
const CURRENT_TTL = 5 * 60 * 1000;

const CHAIN_PREFIX = { eth: 'ethereum', base: 'base' };

async function fetchWithRetry(url, retries = 3) {
  const delays = [1000, 3000, 9000];
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.status === 429) {
        await sleep(10000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries) throw err;
      await sleep(delays[i] || 9000);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function getHistoricalPrice(chain, tokenAddress, timestampSec) {
  const db = getDb();
  const hourTs = Math.floor(timestampSec / 3600) * 3600;
  const cached = db.prepare(
    'SELECT price_usd FROM price_cache WHERE chain=? AND token_address=? AND timestamp=?'
  ).get(chain, tokenAddress.toLowerCase(), hourTs);
  if (cached) return cached.price_usd;

  const coin = `${CHAIN_PREFIX[chain]}:${tokenAddress.toLowerCase()}`;
  try {
    const data = await fetchWithRetry(
      `https://coins.llama.fi/prices/historical/${hourTs}/${coin}`
    );
    const price = data?.coins?.[coin]?.price ?? null;
    if (price != null) {
      db.prepare(
        'INSERT OR REPLACE INTO price_cache(chain,token_address,timestamp,price_usd,fetched_at) VALUES(?,?,?,?,?)'
      ).run(chain, tokenAddress.toLowerCase(), hourTs, price, Date.now());
    }
    return price;
  } catch (err) {
    logger.error({ err, chain, tokenAddress }, 'getHistoricalPrice failed');
    return null;
  }
}

export async function getPriceWithFallback(chain, tokenAddress, timestampSec) {
  const steps = [0, 3600, 6 * 3600, 86400, 3 * 86400, 7 * 86400];
  for (const offset of steps) {
    const price = await getHistoricalPrice(chain, tokenAddress, timestampSec + offset);
    if (price != null) {
      return { price, offset, note: offset > 0 ? `price_from_+${offset}s` : null };
    }
  }
  return { price: null, offset: null, note: 'no_price' };
}

export async function getCurrentPrices(tokens) {
  // tokens: [{chain, address}]
  const now = Date.now();
  const result = {};
  const toFetch = [];

  for (const { chain, address } of tokens) {
    const key = `${chain}:${address.toLowerCase()}`;
    const cached = CURRENT_CACHE.get(key);
    if (cached && now - cached.ts < CURRENT_TTL) {
      result[key] = cached.price;
    } else {
      toFetch.push(key);
    }
  }

  if (toFetch.length === 0) return result;

  const coins = toFetch.map(k => {
    const [chain, addr] = k.split(':');
    return `${CHAIN_PREFIX[chain]}:${addr}`;
  }).join(',');

  try {
    const data = await fetchWithRetry(`https://coins.llama.fi/prices/current/${coins}`);
    for (const key of toFetch) {
      const [chain, addr] = key.split(':');
      const coinKey = `${CHAIN_PREFIX[chain]}:${addr}`;
      const price = data?.coins?.[coinKey]?.price ?? null;
      result[key] = price;
      CURRENT_CACHE.set(key, { price, ts: now });
    }
  } catch (err) {
    logger.error({ err }, 'getCurrentPrices failed');
  }

  return result;
}
