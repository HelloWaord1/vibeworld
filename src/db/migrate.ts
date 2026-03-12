import { getDb } from './connection.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  chunk_x INTEGER NOT NULL DEFAULT 0,
  chunk_y INTEGER NOT NULL DEFAULT 0,
  location_id INTEGER,
  hp INTEGER NOT NULL DEFAULT 50,
  max_hp INTEGER NOT NULL DEFAULT 50,
  strength INTEGER NOT NULL DEFAULT 5,
  dexterity INTEGER NOT NULL DEFAULT 5,
  constitution INTEGER NOT NULL DEFAULT 5,
  charisma INTEGER NOT NULL DEFAULT 5,
  luck INTEGER NOT NULL DEFAULT 5,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  gold INTEGER NOT NULL DEFAULT 50,
  is_alive INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  died_at TEXT,
  cause_of_death TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name_alive ON players(name) WHERE is_alive = 1;

CREATE TABLE IF NOT EXISTS chunks (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  terrain_type TEXT NOT NULL,
  danger_level INTEGER NOT NULL DEFAULT 1,
  theme_tags TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (x, y)
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  parent_id INTEGER,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  location_type TEXT NOT NULL DEFAULT 'room',
  depth INTEGER NOT NULL DEFAULT 1,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  discovery_dc INTEGER NOT NULL DEFAULT 10,
  is_shop INTEGER NOT NULL DEFAULT 0,
  required_key_id INTEGER,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (chunk_x, chunk_y) REFERENCES chunks(x, y),
  FOREIGN KEY (parent_id) REFERENCES locations(id)
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'misc',
  damage_bonus INTEGER NOT NULL DEFAULT 0,
  defense_bonus INTEGER NOT NULL DEFAULT 0,
  stat_bonuses TEXT NOT NULL DEFAULT '{}',
  heal_amount INTEGER NOT NULL DEFAULT 0,
  value INTEGER NOT NULL DEFAULT 0,
  owner_id INTEGER,
  chunk_x INTEGER,
  chunk_y INTEGER,
  location_id INTEGER,
  is_equipped INTEGER NOT NULL DEFAULT 0,
  rarity TEXT NOT NULL DEFAULT 'common',
  is_shop_item INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (owner_id) REFERENCES players(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id INTEGER,
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (from_id) REFERENCES players(id),
  FOREIGN KEY (to_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  actor_id INTEGER,
  target_id INTEGER,
  chunk_x INTEGER,
  chunk_y INTEGER,
  location_id INTEGER,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS discoveries (
  player_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (player_id, location_id),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE TABLE IF NOT EXISTS chunk_locks (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  locked_by INTEGER NOT NULL,
  locked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (x, y),
  FOREIGN KEY (locked_by) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  offer_items TEXT NOT NULL DEFAULT '[]',
  offer_gold INTEGER NOT NULL DEFAULT 0,
  request_items TEXT NOT NULL DEFAULT '[]',
  request_gold INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (from_id) REFERENCES players(id),
  FOREIGN KEY (to_id) REFERENCES players(id)
);
`;

const QUEST_SCHEMA = `
CREATE TABLE IF NOT EXISTS daily_quests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  quest_type TEXT NOT NULL,
  description TEXT NOT NULL,
  target_count INTEGER NOT NULL DEFAULT 1,
  current_count INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  reward_gold INTEGER NOT NULL DEFAULT 0,
  assigned_date TEXT NOT NULL,
  completed_at TEXT,
  is_tutorial INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_daily_quests_player_date ON daily_quests(player_id, assigned_date);

CREATE TABLE IF NOT EXISTS quest_streaks (
  player_id INTEGER PRIMARY KEY,
  current_streak INTEGER NOT NULL DEFAULT 0,
  last_completed_date TEXT,
  total_completed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (player_id) REFERENCES players(id)
);
`;

const CRAFTING_SCHEMA = `
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  result_item_name TEXT NOT NULL,
  result_item_type TEXT NOT NULL,
  result_description TEXT NOT NULL,
  result_damage_bonus INTEGER NOT NULL DEFAULT 0,
  result_defense_bonus INTEGER NOT NULL DEFAULT 0,
  result_heal_amount INTEGER NOT NULL DEFAULT 0,
  result_value INTEGER NOT NULL DEFAULT 0,
  result_rarity TEXT NOT NULL DEFAULT 'common',
  result_level_requirement INTEGER NOT NULL DEFAULT 0,
  craft_time_seconds INTEGER NOT NULL DEFAULT 5,
  required_location_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  recipe_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
`;


const SOUL_BINDING_SCHEMA = `
CREATE TABLE IF NOT EXISTS soul_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL UNIQUE,
  tavern_location_id INTEGER NOT NULL,
  tavern_chunk_x INTEGER NOT NULL,
  tavern_chunk_y INTEGER NOT NULL,
  bound_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (tavern_location_id) REFERENCES locations(id)
);
`;

// --- PvE: Monsters ---
const PVE_SCHEMA = `
CREATE TABLE IF NOT EXISTS monster_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  monster_type TEXT NOT NULL,
  base_hp INTEGER NOT NULL,
  base_strength INTEGER NOT NULL,
  base_dexterity INTEGER NOT NULL,
  base_constitution INTEGER NOT NULL,
  base_damage_bonus INTEGER NOT NULL DEFAULT 0,
  base_defense_bonus INTEGER NOT NULL DEFAULT 0,
  min_danger_level INTEGER NOT NULL DEFAULT 1,
  max_danger_level INTEGER NOT NULL DEFAULT 10,
  xp_reward INTEGER NOT NULL DEFAULT 20,
  gold_min INTEGER NOT NULL DEFAULT 0,
  gold_max INTEGER NOT NULL DEFAULT 0,
  loot_table TEXT NOT NULL DEFAULT '[]',
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  location_id INTEGER,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (chunk_x, chunk_y) REFERENCES chunks(x, y),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (created_by) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS active_monsters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  location_id INTEGER,
  hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  strength INTEGER NOT NULL,
  dexterity INTEGER NOT NULL,
  constitution INTEGER NOT NULL,
  damage_bonus INTEGER NOT NULL DEFAULT 0,
  defense_bonus INTEGER NOT NULL DEFAULT 0,
  engaged_by INTEGER,
  engaged_at TEXT,
  spawned_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (template_id) REFERENCES monster_templates(id),
  FOREIGN KEY (chunk_x, chunk_y) REFERENCES chunks(x, y),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (engaged_by) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS bounties (
  player_id INTEGER PRIMARY KEY,
  amount INTEGER NOT NULL DEFAULT 0,
  kills_since_reset INTEGER NOT NULL DEFAULT 0,
  last_kill_at TEXT,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS active_buffs (
  player_id INTEGER NOT NULL,
  buff_type TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  charges INTEGER NOT NULL DEFAULT 1,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, buff_type),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS cooldowns (
  player_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (player_id, action),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS npcs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  location_id INTEGER NOT NULL,
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  greeting TEXT NOT NULL,
  dialogue TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (location_id) REFERENCES locations(id)
);
`;

// --- Social: Mail, Alliances, Parties, Blocks ---
const SOCIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS mail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  gold_attached INTEGER NOT NULL DEFAULT 0,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (from_id) REFERENCES players(id),
  FOREIGN KEY (to_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_mail_to_id ON mail(to_id, created_at DESC);

CREATE TABLE IF NOT EXISTS alliances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  tag TEXT NOT NULL UNIQUE,
  leader_id INTEGER NOT NULL,
  treasury INTEGER NOT NULL DEFAULT 0,
  shares_outstanding INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  max_members INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (leader_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS alliance_members (
  alliance_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (alliance_id, player_id),
  FOREIGN KEY (alliance_id) REFERENCES alliances(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leader_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (leader_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS party_members (
  party_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (party_id, player_id),
  FOREIGN KEY (party_id) REFERENCES parties(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS player_blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES players(id),
  FOREIGN KEY (blocked_id) REFERENCES players(id)
);
`;

// --- Economy: AMM, Marketplace, USDC, Stock Market ---
const ECONOMY_SCHEMA = `
CREATE TABLE IF NOT EXISTS liquidity_pool (
  id INTEGER PRIMARY KEY,
  gold_reserve INTEGER NOT NULL DEFAULT 500000,
  usdc_reserve INTEGER NOT NULL DEFAULT 5000,
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS player_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL UNIQUE,
  price INTEGER NOT NULL,
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  location_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (seller_id) REFERENCES players(id),
  FOREIGN KEY (item_id) REFERENCES items(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE TABLE IF NOT EXISTS usdc_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER,
  to_id INTEGER,
  amount INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  platform_tax INTEGER NOT NULL DEFAULT 0,
  chunk_tax INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (from_id) REFERENCES players(id),
  FOREIGN KEY (to_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  ticker TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  company_type TEXT NOT NULL DEFAULT 'service',
  total_shares INTEGER NOT NULL DEFAULT 10000,
  ipo_price INTEGER NOT NULL DEFAULT 10,
  treasury INTEGER NOT NULL DEFAULT 0,
  shares_outstanding INTEGER NOT NULL DEFAULT 0,
  dividend_rate REAL NOT NULL DEFAULT 0.5,
  revenue_accumulated INTEGER NOT NULL DEFAULT 0,
  last_dividend_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shares (
  player_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  avg_purchase_price REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, company_id),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS share_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  order_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_per_share INTEGER NOT NULL,
  filled_quantity INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS dividend_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,
  per_share_amount REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS dividend_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  dividend_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (dividend_id) REFERENCES dividend_history(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dividend_claims_unique ON dividend_claims(player_id, dividend_id);
`;

// --- Banking: World Bank, National Banks, Local Banks, Accounts, Loans ---
const BANKING_SCHEMA = `
CREATE TABLE IF NOT EXISTS world_bank (
  id INTEGER PRIMARY KEY,
  federal_rate REAL NOT NULL DEFAULT 0.05,
  reserves INTEGER NOT NULL DEFAULT 0,
  total_lent INTEGER NOT NULL DEFAULT 0,
  revenue_accumulated INTEGER NOT NULL DEFAULT 0,
  last_rate_change TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS national_banks (
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  ruler_id INTEGER NOT NULL,
  reserves INTEGER NOT NULL DEFAULT 0,
  markup REAL NOT NULL DEFAULT 0.05,
  total_deposits INTEGER NOT NULL DEFAULT 0,
  total_lent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chunk_x, chunk_y),
  FOREIGN KEY (chunk_x, chunk_y) REFERENCES chunks(x, y),
  FOREIGN KEY (ruler_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS local_banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  name TEXT NOT NULL,
  reserves INTEGER NOT NULL DEFAULT 0,
  deposit_rate REAL NOT NULL DEFAULT 0.03,
  lending_rate REAL NOT NULL DEFAULT 0.08,
  total_deposits INTEGER NOT NULL DEFAULT 0,
  total_lent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES players(id),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (chunk_x, chunk_y) REFERENCES chunks(x, y)
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  bank_id INTEGER NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  interest_accrued INTEGER NOT NULL DEFAULT 0,
  last_interest_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (bank_id) REFERENCES local_banks(id)
);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  borrower_type TEXT NOT NULL,
  borrower_id INTEGER NOT NULL,
  lender_type TEXT NOT NULL,
  lender_id INTEGER NOT NULL,
  principal INTEGER NOT NULL,
  interest_rate REAL NOT NULL,
  balance_remaining INTEGER NOT NULL,
  interest_accrued INTEGER NOT NULL DEFAULT 0,
  term_days INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_payment_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower_type, borrower_id);
CREATE INDEX IF NOT EXISTS idx_loans_lender ON loans(lender_type, lender_id);
`;

// --- Governance: Revolt votes, admin, reports, bans, mutes ---
const GOVERNANCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS revolt_votes (
  player_id INTEGER NOT NULL,
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (player_id, chunk_x, chunk_y),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (chunk_x, chunk_y) REFERENCES chunks(x, y)
);

CREATE TABLE IF NOT EXISTS admin_roles (
  player_id INTEGER PRIMARY KEY,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reporter_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS player_bans (
  player_id INTEGER PRIMARY KEY,
  banned_by INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (banned_by) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS player_mutes (
  player_id INTEGER PRIMARY KEY,
  muted_by INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (muted_by) REFERENCES players(id)
);
`;

// --- Bounty Board (player-created bounties) ---
const BOUNTY_BOARD_SCHEMA = `
CREATE TABLE IF NOT EXISTS player_bounties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  reward INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  claimed_by INTEGER,
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (creator_id) REFERENCES players(id),
  FOREIGN KEY (target_id) REFERENCES players(id),
  FOREIGN KEY (claimed_by) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_player_bounties_status ON player_bounties(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_player_bounties_target ON player_bounties(target_id, status);
`;

// --- Dueling System ---
const DUEL_SCHEMA = `
CREATE TABLE IF NOT EXISTS duels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenger_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  wager INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  winner_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (challenger_id) REFERENCES players(id),
  FOREIGN KEY (target_id) REFERENCES players(id),
  FOREIGN KEY (winner_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_duels_target ON duels(target_id, status);
CREATE INDEX IF NOT EXISTS idx_duels_challenger ON duels(challenger_id, status);
`;

// --- Achievements ---
const ACHIEVEMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  achievement_key TEXT NOT NULL,
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(player_id, achievement_key),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_achievements_player ON achievements(player_id);
`;

export function migrate(): void {
  const db = getDb();
  db.exec(SCHEMA);
  db.exec(QUEST_SCHEMA);
  db.exec(SOUL_BINDING_SCHEMA);
  db.exec(CRAFTING_SCHEMA);
  db.exec(PVE_SCHEMA);
  db.exec(SOCIAL_SCHEMA);
  db.exec(ECONOMY_SCHEMA);
  db.exec(BANKING_SCHEMA);
  db.exec(GOVERNANCE_SCHEMA);
  db.exec(BOUNTY_BOARD_SCHEMA);
  db.exec(DUEL_SCHEMA);
  db.exec(ACHIEVEMENTS_SCHEMA);

  // Add level_requirement column to items table
  addColumnIfMissing(db, 'items', 'level_requirement', 'INTEGER NOT NULL DEFAULT 0');

  // Add rarity and level_requirement columns to recipes table (for existing DBs created before these columns)
  addColumnIfMissing(db, 'recipes', 'result_rarity', "TEXT NOT NULL DEFAULT 'common'");
  addColumnIfMissing(db, 'recipes', 'result_level_requirement', 'INTEGER NOT NULL DEFAULT 0');

  // Add governance columns to chunks table
  addColumnIfMissing(db, 'chunks', 'ruler_id', 'INTEGER');
  addColumnIfMissing(db, 'chunks', 'chunk_tax_rate', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'chunks', 'immigration_policy', "TEXT NOT NULL DEFAULT 'open'");
  addColumnIfMissing(db, 'chunks', 'immigration_fee', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'chunks', 'build_policy', "TEXT NOT NULL DEFAULT 'free'");
  addColumnIfMissing(db, 'chunks', 'build_fee', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'chunks', 'exit_policy', "TEXT NOT NULL DEFAULT 'free'");
  addColumnIfMissing(db, 'chunks', 'exit_fee', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'chunks', 'sale_price', 'INTEGER');
  addColumnIfMissing(db, 'chunks', 'revenue_total', 'INTEGER NOT NULL DEFAULT 0');

  // Add economy columns to players table
  addColumnIfMissing(db, 'players', 'usdc_balance', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'players', 'wallet_address', 'TEXT');
  addColumnIfMissing(db, 'players', 'total_monsters_killed', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'players', 'total_pvp_kills', 'INTEGER NOT NULL DEFAULT 0');

  // Add revenue/service columns to locations table
  addColumnIfMissing(db, 'locations', 'revenue_total', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'locations', 'service_url', 'TEXT');
  addColumnIfMissing(db, 'locations', 'service_type', 'TEXT');

  // Add message_type and alliance_id to messages table
  addColumnIfMissing(db, 'messages', 'message_type', "TEXT NOT NULL DEFAULT 'public'");
  addColumnIfMissing(db, 'messages', 'alliance_id', 'INTEGER');

  // Add is_tutorial column to daily_quests table
  addColumnIfMissing(db, 'daily_quests', 'is_tutorial', 'INTEGER NOT NULL DEFAULT 0');

  // Seed world bank singleton row
  seedWorldBank(db);
  // Seed AMM liquidity pool singleton row
  seedLiquidityPool(db);
  // Seed system companies for revenue routing
  seedCompanies(db);

  seed(db);
  seedRecipes(db);
  seedNpcs(db);
}

function addColumnIfMissing(db: ReturnType<typeof getDb>, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function seedWorldBank(db: ReturnType<typeof getDb>): void {
  const existing = db.prepare('SELECT 1 FROM world_bank WHERE id = 1').get();
  if (existing) return;
  db.prepare(
    `INSERT INTO world_bank (id, federal_rate, reserves, total_lent, revenue_accumulated) VALUES (1, 0.05, 1000000, 0, 0)`
  ).run();
  console.log('[seed] World Reserve Bank created with 1,000,000g reserves');
}

function seedLiquidityPool(db: ReturnType<typeof getDb>): void {
  const existing = db.prepare('SELECT 1 FROM liquidity_pool WHERE id = 1').get();
  if (existing) return;
  db.prepare(
    `INSERT INTO liquidity_pool (id, gold_reserve, usdc_reserve) VALUES (1, 500000, 5000)`
  ).run();
  console.log('[seed] AMM liquidity pool created');
}

function seedCompanies(db: ReturnType<typeof getDb>): void {
  const existing = db.prepare('SELECT 1 FROM companies LIMIT 1').get();
  if (existing) return;

  const insert = db.prepare(`
    INSERT INTO companies (name, ticker, description, company_type, total_shares, ipo_price, dividend_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run('Imperial Mail Co.', 'MAIL', 'Operates the mail delivery network across all chunks.', 'service', 10000, 10, 0.5);
  insert.run('Grand Exchange Corp.', 'EXCH', 'Runs marketplace and trading infrastructure.', 'service', 10000, 10, 0.5);
  insert.run('World Reserve Bank Corp.', 'WBNK', 'Manages global banking and lending operations.', 'finance', 10000, 15, 0.4);
  insert.run('Nexus Teleport Guild', 'TELE', 'Operates the teleportation network.', 'service', 10000, 10, 0.5);

  console.log('[seed] System companies created (MAIL, EXCH, WBNK, TELE)');
}

function seed(db: ReturnType<typeof getDb>): void {
  const nexus = db.prepare('SELECT 1 FROM chunks WHERE x = 0 AND y = 0').get();
  if (nexus) return;

  db.exec(`
    INSERT INTO chunks (x, y, name, description, terrain_type, danger_level, theme_tags, created_by)
    VALUES (0, 0, 'The Nexus', 'A shimmering crossroads at the center of all realities. Cobblestone streets radiate outward in four directions, bustling with travelers from countless worlds. Arcane lampposts cast a warm glow over market stalls and gathering places. This is where every adventurer begins their journey.', 'city', 1, '["urban","safe","hub","magical"]', 0);
  `);

  db.exec(`
    INSERT INTO locations (chunk_x, chunk_y, parent_id, name, description, location_type, depth, is_hidden, discovery_dc, is_shop, created_by)
    VALUES (0, 0, NULL, 'The First Pint Tavern', 'A cozy tavern with oak beams and a roaring fireplace. The barkeep, a stout dwarf named Grimjaw, polishes mugs behind a worn counter. Adventurers swap tales over foaming ales. A notice board near the entrance is covered in job postings and wanted posters.', 'tavern', 1, 0, 0, 0, 0);
  `);

  db.exec(`
    INSERT INTO locations (chunk_x, chunk_y, parent_id, name, description, location_type, depth, is_hidden, discovery_dc, is_shop, created_by)
    VALUES (0, 0, NULL, 'The Curiosity Shop', 'A cramped shop overflowing with strange artifacts. Glass cases display glowing trinkets, dusty tomes, and weapons of curious design. The shopkeeper, a tall elf with silver eyes, watches every movement with an appraising gaze.', 'shop', 1, 0, 0, 1, 0);
  `);

  const shopLocation = db.prepare(
    `SELECT id FROM locations WHERE name = 'The Curiosity Shop' AND chunk_x = 0 AND chunk_y = 0`
  ).get() as { id: number } | undefined;

  if (shopLocation) {
    const locId = shopLocation.id;
    const insert = db.prepare(`
      INSERT INTO items (name, description, item_type, damage_bonus, defense_bonus, heal_amount, value, chunk_x, chunk_y, location_id, rarity, is_shop_item)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 1)
    `);
    insert.run('Rusty Sword', 'A battered but serviceable blade. Better than bare fists.', 'weapon', 2, 0, 0, 15, locId, 'common');
    insert.run('Leather Cap', 'A simple leather helmet offering modest protection.', 'armor', 0, 1, 0, 10, locId, 'common');
    insert.run('Minor Healing Potion', 'A small vial of red liquid. Restores 15 HP.', 'consumable', 0, 0, 15, 12, locId, 'common');
    insert.run('Minor Healing Potion', 'A small vial of red liquid. Restores 15 HP.', 'consumable', 0, 0, 15, 12, locId, 'common');
    insert.run('Iron Shield', 'A round iron shield, dented but functional.', 'armor', 0, 2, 0, 20, locId, 'common');
    insert.run('Adventurer\'s Compass', 'A brass compass that always points toward the nearest unexplored chunk.', 'misc', 0, 0, 0, 25, locId, 'uncommon');
    insert.run('Skeleton Key', 'A mysterious key that hums with faint energy. Might open locked doors.', 'key', 0, 0, 0, 40, locId, 'rare');

    // Crafting materials — raw ingredients for the 13 crafting recipes
    insert.run('Herb', 'A bundle of fragrant green herbs with restorative properties. Used in potions and elixirs.', 'material', 0, 0, 0, 8, locId, 'common');
    insert.run('Iron Ore', 'A chunk of unrefined iron ore, heavy and rough. Essential for forging weapons and armor.', 'material', 0, 0, 0, 12, locId, 'common');
    insert.run('Leather', 'A piece of tanned animal hide, supple yet tough. Used in crafting armor and bows.', 'material', 0, 0, 0, 10, locId, 'common');
    insert.run('Wheat', 'A sheaf of golden wheat grain. A staple ingredient for baking and cooking.', 'material', 0, 0, 0, 5, locId, 'common');
    insert.run('Water Flask', 'A sealed flask of purified water. Used as a base for brewing potions.', 'material', 0, 0, 0, 5, locId, 'common');
    insert.run('Coal', 'A lump of black coal that burns hot and long. Vital for smelting at the forge.', 'material', 0, 0, 0, 8, locId, 'common');
    insert.run('Salt', 'A pouch of coarse salt harvested from mineral deposits. Used in food preservation and alchemy.', 'material', 0, 0, 0, 4, locId, 'common');
    insert.run('Thread', 'A spool of sturdy thread spun from plant fibers. Used for stitching leather and fabric.', 'material', 0, 0, 0, 6, locId, 'common');
  }

  console.log('[seed] The Nexus created with starter locations and items');
}

function seedRecipes(db: ReturnType<typeof getDb>): void {
  const { c: count } = db.prepare('SELECT COUNT(*) as c FROM recipes').get() as { c: number };
  if (count >= 13) return; // All recipes already seeded

  const insertRecipe = db.prepare(`
    INSERT OR IGNORE INTO recipes (name, result_item_name, result_item_type, result_description, result_damage_bonus, result_defense_bonus, result_heal_amount, result_value, result_rarity, result_level_requirement, craft_time_seconds, required_location_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertIngredient = db.prepare(`
    INSERT INTO recipe_ingredients (recipe_id, item_name, quantity) VALUES (?, ?, ?)
  `);

  // Iron Sword: 2x Iron Ore + 1x Coal -> weapon, damage_bonus=3, value=25. Requires forge
  const ironSword = insertRecipe.run(
    'Iron Sword', 'Iron Sword', 'weapon',
    'A sturdy blade forged from iron ore. Reliable in combat.',
    3, 0, 0, 25, 'common', 0, 5, 'forge'
  );
  insertIngredient.run(ironSword.lastInsertRowid, 'Iron Ore', 2);
  insertIngredient.run(ironSword.lastInsertRowid, 'Coal', 1);

  // Healing Potion: 2x Herb + 1x Water Flask -> consumable, heal_amount=25, value=15
  const healingPotion = insertRecipe.run(
    'Healing Potion', 'Healing Potion', 'consumable',
    'A vibrant red potion brewed from fresh herbs. Restores 25 HP.',
    0, 0, 25, 15, 'common', 0, 5, null
  );
  insertIngredient.run(healingPotion.lastInsertRowid, 'Herb', 2);
  insertIngredient.run(healingPotion.lastInsertRowid, 'Water Flask', 1);

  // Leather Armor: 3x Leather + 1x Thread -> armor, defense_bonus=3, value=30
  const leatherArmor = insertRecipe.run(
    'Leather Armor', 'Leather Armor', 'armor',
    'Hardened leather plates stitched together for decent protection.',
    0, 3, 0, 30, 'common', 0, 5, null
  );
  insertIngredient.run(leatherArmor.lastInsertRowid, 'Leather', 3);
  insertIngredient.run(leatherArmor.lastInsertRowid, 'Thread', 1);

  // Bread: 2x Wheat + 1x Salt -> food, heal_amount=10, value=5
  const bread = insertRecipe.run(
    'Bread', 'Bread', 'food',
    'A warm loaf of freshly baked bread. Restores 10 HP.',
    0, 0, 10, 5, 'common', 0, 5, null
  );
  insertIngredient.run(bread.lastInsertRowid, 'Wheat', 2);
  insertIngredient.run(bread.lastInsertRowid, 'Salt', 1);

  // Steel Longsword: 3x Iron Ore + 2x Coal + 1x Iron Sword -> weapon, damage_bonus=6, value=60. Requires forge.
  const steelLongsword = insertRecipe.run(
    'Steel Longsword', 'Steel Longsword', 'weapon',
    'A masterfully forged longsword of tempered steel. Devastatingly sharp.',
    6, 0, 0, 60, 'uncommon', 0, 5, 'forge'
  );
  insertIngredient.run(steelLongsword.lastInsertRowid, 'Iron Ore', 3);
  insertIngredient.run(steelLongsword.lastInsertRowid, 'Coal', 2);
  insertIngredient.run(steelLongsword.lastInsertRowid, 'Iron Sword', 1);

  // --- NEW RECIPES ---

  // Mithril Blade: 2x Iron Ore + 1x Coal + 1x Iron Sword -> weapon, damage_bonus=9, value=80, level_req=7. Requires forge
  const mithrilBlade = insertRecipe.run(
    'Mithril Blade', 'Mithril Blade', 'weapon',
    'A lightweight but incredibly sharp blade forged from rare mithril ore.',
    9, 0, 0, 80, 'rare', 7, 5, 'forge'
  );
  insertIngredient.run(mithrilBlade.lastInsertRowid, 'Iron Ore', 2);
  insertIngredient.run(mithrilBlade.lastInsertRowid, 'Coal', 1);
  insertIngredient.run(mithrilBlade.lastInsertRowid, 'Iron Sword', 1);

  // Reinforced Chain Mail: 3x Iron Ore + 2x Coal + 1x Leather Armor -> armor, defense_bonus=6, value=70, level_req=7. Requires forge
  const reinforcedChainMail = insertRecipe.run(
    'Reinforced Chain Mail', 'Reinforced Chain Mail', 'armor',
    'Interlocking iron rings reinforced with hardened leather backing.',
    0, 6, 0, 70, 'rare', 7, 5, 'forge'
  );
  insertIngredient.run(reinforcedChainMail.lastInsertRowid, 'Iron Ore', 3);
  insertIngredient.run(reinforcedChainMail.lastInsertRowid, 'Coal', 2);
  insertIngredient.run(reinforcedChainMail.lastInsertRowid, 'Leather Armor', 1);

  // Greater Healing Potion: 2x Herb + 1x Water Flask -> consumable, heal_amount=50, value=30
  const greaterHealingPotion = insertRecipe.run(
    'Greater Healing Potion', 'Greater Healing Potion', 'consumable',
    'A concentrated healing elixir with potent restorative properties. Restores 50 HP.',
    0, 0, 50, 30, 'uncommon', 0, 5, 'alchemy_lab'
  );
  insertIngredient.run(greaterHealingPotion.lastInsertRowid, 'Herb', 2);
  insertIngredient.run(greaterHealingPotion.lastInsertRowid, 'Water Flask', 1);

  // Elixir of Fortitude: 3x Herb + 2x Water Flask + 1x Salt -> consumable, heal_amount=100, value=60, level_req=5
  const elixirOfFortitude = insertRecipe.run(
    'Elixir of Fortitude', 'Elixir of Fortitude', 'consumable',
    'A powerful elixir that greatly restores vitality. Restores 100 HP.',
    0, 0, 100, 60, 'rare', 5, 5, null
  );
  insertIngredient.run(elixirOfFortitude.lastInsertRowid, 'Herb', 3);
  insertIngredient.run(elixirOfFortitude.lastInsertRowid, 'Water Flask', 2);
  insertIngredient.run(elixirOfFortitude.lastInsertRowid, 'Salt', 1);

  // Hardened Leather Vest: 2x Leather + 1x Thread -> armor, defense_bonus=4, value=35
  const hardenedLeatherVest = insertRecipe.run(
    'Hardened Leather Vest', 'Hardened Leather Vest', 'armor',
    'A sturdy vest made from treated leather. Provides better protection than basic armor.',
    0, 4, 0, 35, 'uncommon', 0, 5, null
  );
  insertIngredient.run(hardenedLeatherVest.lastInsertRowid, 'Leather', 2);
  insertIngredient.run(hardenedLeatherVest.lastInsertRowid, 'Thread', 1);

  // Hunter's Bow: 1x Leather + 2x Thread -> weapon, damage_bonus=4, value=28
  const huntersBow = insertRecipe.run(
    "Hunter's Bow", "Hunter's Bow", 'weapon',
    'A well-crafted bow strung with durable leather cord. Ideal for hunting.',
    4, 0, 0, 28, 'uncommon', 0, 5, null
  );
  insertIngredient.run(huntersBow.lastInsertRowid, 'Leather', 1);
  insertIngredient.run(huntersBow.lastInsertRowid, 'Thread', 2);

  // Traveler's Rations: 1x Wheat + 1x Salt -> food, heal_amount=20, value=8
  const travelersRations = insertRecipe.run(
    "Traveler's Rations", "Traveler's Rations", 'food',
    'Preserved food perfect for long journeys. Restores 20 HP.',
    0, 0, 20, 8, 'common', 0, 5, null
  );
  insertIngredient.run(travelersRations.lastInsertRowid, 'Wheat', 1);
  insertIngredient.run(travelersRations.lastInsertRowid, 'Salt', 1);

  // War Hammer: 3x Iron Ore + 2x Coal + 1x Leather -> weapon, damage_bonus=7, value=65, level_req=10. Requires forge
  const warHammer = insertRecipe.run(
    'War Hammer', 'War Hammer', 'weapon',
    'A massive two-handed hammer forged from solid iron. Crushes armor with ease.',
    7, 0, 0, 65, 'rare', 10, 5, 'forge'
  );
  insertIngredient.run(warHammer.lastInsertRowid, 'Iron Ore', 3);
  insertIngredient.run(warHammer.lastInsertRowid, 'Coal', 2);
  insertIngredient.run(warHammer.lastInsertRowid, 'Leather', 1);

  console.log('[seed] Crafting recipes created (13 total)');
}

function seedNpcs(db: ReturnType<typeof getDb>): void {
  const existing = db.prepare('SELECT 1 FROM npcs LIMIT 1').get();
  if (existing) return;

  const tavernLocation = db.prepare(
    `SELECT id FROM locations WHERE name = 'The First Pint Tavern' AND chunk_x = 0 AND chunk_y = 0`
  ).get() as { id: number } | undefined;

  const shopLocation = db.prepare(
    `SELECT id FROM locations WHERE name = 'The Curiosity Shop' AND chunk_x = 0 AND chunk_y = 0`
  ).get() as { id: number } | undefined;

  if (tavernLocation) {
    const grimjawDialogue = JSON.stringify([
      { topic: 'rumors', text: 'I hear there are monsters prowling the Windswept Plains to the south. Dangerous business, but good coin for those brave enough.' },
      { topic: 'quest', text: 'Say, if you could clear out those rats in my cellar, I\'d pay you 50 gold. They\'ve been keeping me up at night!' },
      { topic: 'drink', text: 'Here, have an ale on the house. *slides you a foaming mug* Nothing beats a cold one after a long day of adventuring.' },
      { topic: 'town', text: 'The Nexus is the safest place in all the realms. Perfect for newcomers to get their bearings before venturing out.' },
      { topic: 'advice', text: 'If you\'re heading into danger, make sure you\'re well-equipped. Visit Old Whiskers at the Curiosity Shop - he has what you need.' }
    ]);

    db.prepare(`
      INSERT INTO npcs (name, role, location_id, chunk_x, chunk_y, greeting, dialogue)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Grimjaw',
      'barkeep',
      tavernLocation.id,
      0,
      0,
      'Welcome to The First Pint! What\'ll it be, friend? Pull up a stool and rest your weary bones.',
      grimjawDialogue
    );
  }

  if (shopLocation) {
    const whiskersDialogue = JSON.stringify([
      { topic: 'items', text: 'I stock only the finest wares from across the realms. Weapons, armor, potions... if you need it, I probably have it.' },
      { topic: 'rare', text: '*leans in conspiratorially* Between you and me, that Skeleton Key can open almost any lock. Very useful for... explorers.' },
      { topic: 'lore', text: 'This world is vast and full of mysteries. I\'ve heard tales of hidden dungeons, ancient artifacts, and powerful monsters. Some say there\'s even a dragon sleeping beneath the mountains to the north.' },
      { topic: 'business', text: 'Trade is the lifeblood of civilization. I buy and sell fairly - 60% of value when you sell to me, full price when you buy. Fair is fair.' },
      { topic: 'advice', text: 'Don\'t venture too far from The Nexus without proper equipment. The danger level rises quickly, and death is permanent in these lands.' }
    ]);

    db.prepare(`
      INSERT INTO npcs (name, role, location_id, chunk_x, chunk_y, greeting, dialogue)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Old Whiskers',
      'shopkeeper',
      shopLocation.id,
      0,
      0,
      'Ah, a customer! Welcome, welcome. Browse my wares, and let me know if anything catches your eye.',
      whiskersDialogue
    );
  }

  console.log('[seed] NPCs created (Grimjaw, Old Whiskers)');
}
