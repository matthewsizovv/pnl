export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  tg_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  label TEXT,
  last_synced_block_eth INTEGER DEFAULT 0,
  last_synced_block_base INTEGER DEFAULT 0,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, address)
);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  chain TEXT NOT NULL CHECK(chain IN ('eth','base')),
  tx_hash TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('buy','sell')),
  token_address TEXT NOT NULL,
  token_symbol TEXT,
  amount REAL NOT NULL,
  price_usd REAL,
  gas_usd REAL DEFAULT 0,
  notes TEXT,
  UNIQUE(chain, tx_hash, type, token_address)
);
CREATE INDEX IF NOT EXISTS idx_trades_wallet_ts ON trades(wallet_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(wallet_id, token_address);

CREATE TABLE IF NOT EXISTS realized_pnl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  sell_trade_id INTEGER NOT NULL REFERENCES trades(id),
  token_address TEXT NOT NULL,
  token_symbol TEXT,
  amount REAL NOT NULL,
  cost_basis_usd REAL NOT NULL,
  proceeds_usd REAL NOT NULL,
  pnl_usd REAL NOT NULL,
  roi_pct REAL,
  holding_hours INTEGER,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_pnl_wallet ON realized_pnl(wallet_id);

CREATE TABLE IF NOT EXISTS open_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  token_address TEXT NOT NULL,
  token_symbol TEXT,
  amount REAL NOT NULL,
  cost_per_unit_usd REAL NOT NULL,
  acquired_at INTEGER NOT NULL,
  buy_trade_id INTEGER REFERENCES trades(id)
);
CREATE INDEX IF NOT EXISTS idx_lots_wallet_token ON open_lots(wallet_id, token_address);

CREATE TABLE IF NOT EXISTS price_cache (
  chain TEXT NOT NULL,
  token_address TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  price_usd REAL NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY(chain, token_address, timestamp)
);
`;
