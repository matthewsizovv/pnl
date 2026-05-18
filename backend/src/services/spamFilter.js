const SPAM_PATTERN = /visit|claim|airdrop|reward|gift|\.com|\.xyz|\.io|http|t\.me/i;

export function isSpam(symbol) {
  if (!symbol) return true;
  if (!/[a-zA-Z]/.test(symbol)) return true;
  if (symbol.length > 12) return true;
  if (SPAM_PATTERN.test(symbol)) return true;
  return false;
}
