const TTL = 60 * 1000;
const cache = new Map();

export function get(userId) {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL) { cache.delete(userId); return null; }
  return entry.data;
}

export function set(userId, data) {
  cache.set(userId, { data, ts: Date.now() });
}

export function invalidate(userId) {
  cache.delete(userId);
}
