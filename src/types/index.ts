export interface Player {
  id: number;
  name: string;
  token: string;
  password_hash: string;
  chunk_x: number;
  chunk_y: number;
  location_id: number | null;
  hp: number;
  max_hp: number;
  strength: number;
  dexterity: number;
  constitution: number;
  charisma: number;
  luck: number;
  xp: number;
  level: number;
  gold: number;
  usdc_balance: number;
  wallet_address: string | null;
  is_alive: number;
  created_at: string;
  last_active_at: string;
  died_at: string | null;
  cause_of_death: string | null;
  total_monsters_killed: number;
  total_pvp_kills: number;
}

export type ImmigrationPolicy = 'open' | 'selective' | 'closed' | 'fee';
export type BuildPolicy = 'free' | 'permit' | 'fee' | 'citizens' | 'closed';
export type ExitPolicy = 'free' | 'fee' | 'locked';

export interface Chunk {
  x: number;
  y: number;
  name: string;
  description: string;
  terrain_type: string;
  danger_level: number;
  theme_tags: string; // JSON array
  created_by: number;
  created_at: string;
  ruler_id: number | null;
  chunk_tax_rate: number;
  immigration_policy: ImmigrationPolicy;
  immigration_fee: number;
  build_policy: BuildPolicy;
  build_fee: number;
  exit_policy: ExitPolicy;
  exit_fee: number;
  sale_price: number | null; // null = not for sale, >0 = listed price in USDC cents
  revenue_total: number; // total gold transacted in this chunk
}

export interface Location {
  id: number;
  chunk_x: number;
  chunk_y: number;
  parent_id: number | null;
  name: string;
  description: string;
  location_type: string;
  depth: number;
  is_hidden: number;
  discovery_dc: number;
  is_shop: number;
  required_key_id: number | null;
  created_by: number;
  created_at: string;
  revenue_total: number; // total gold transacted in this location
  service_url: string | null; // external MCP/API endpoint for businesses
  service_type: string | null; // 'delivery', 'digital', 'consulting', etc.
}

export type ItemType = 'weapon' | 'armor' | 'consumable' | 'key' | 'misc' | 'currency' | 'food';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface Item {
  id: number;
  name: string;
  description: string;
  item_type: ItemType;
  damage_bonus: number;
  defense_bonus: number;
  stat_bonuses: string; // JSON
  heal_amount: number;
  value: number;
  owner_id: number | null;
  chunk_x: number | null;
  chunk_y: number | null;
  location_id: number | null;
  is_equipped: number;
  rarity: Rarity;
  is_shop_item: number;
  level_requirement: number;
}

export interface Recipe {
  id: number;
  name: string;
  result_item_name: string;
  result_item_type: string;
  result_description: string;
  result_damage_bonus: number;
  result_defense_bonus: number;
  result_heal_amount: number;
  result_value: number;
  result_rarity: string;
  result_level_requirement: number;
  craft_time_seconds: number;
  required_location_type: string | null;
  created_at: string;
}

export interface RecipeIngredient {
  recipe_id: number;
  item_name: string;
  quantity: number;
}

export interface RecipeWithIngredients extends Recipe {
  ingredients: RecipeIngredient[];
}

export interface Message {
  id: number;
  from_id: number;
  to_id: number | null;
  chunk_x: number;
  chunk_y: number;
  content: string;
  message_type: MessageType;
  alliance_id: number | null;
  created_at: string;
}

export interface EventLog {
  id: number;
  event_type: string;
  actor_id: number | null;
  target_id: number | null;
  chunk_x: number | null;
  chunk_y: number | null;
  location_id: number | null;
  data: string; // JSON
  created_at: string;
}

export interface Discovery {
  player_id: number;
  location_id: number;
  discovered_at: string;
}

export interface ChunkLock {
  x: number;
  y: number;
  locked_by: number;
  locked_at: string;
}

export type TradeStatus = 'pending' | 'accepted' | 'rejected';

export interface Trade {
  id: number;
  from_id: number;
  to_id: number;
  offer_items: string; // JSON array of item ids
  offer_gold: number;
  request_items: string; // JSON array of item ids
  request_gold: number;
  status: TradeStatus;
  created_at: string;
}

export interface CombatResult {
  attacker_roll: number;
  defender_ac: number;
  hit: boolean;
  damage: number;
  crit: boolean;
  attacker_hp: number;
  defender_hp: number;
  attacker_dead: boolean;
  defender_dead: boolean;
}

export interface DiceResult {
  sides: number;
  roll: number;
}

export const DIRECTIONS: Record<string, [number, number]> = {
  north: [0, 1],
  south: [0, -1],
  east: [1, 0],
  west: [-1, 0],
};

export const MIN_CHUNK_COORD = -99;
export const MAX_CHUNK_COORD = 99;
export const MAX_LOCATION_DEPTH = 10;
export const CHUNK_LOCK_TIMEOUT_MS = 60_000;
export const STARTING_HP = 50;
export const STARTING_GOLD = 250;
export const STARTING_STATS = 7;
export const MAX_INVENTORY_SIZE = 20;
export const MAX_CRIT_CHANCE = 5; // max d20 roll for crit (25% at max luck)
export const MAX_CHUNKS = 2800; // total nation-states in the world
export const DEMOLISH_BASE_COST = 500; // minimum gold to demolish a location
export const REVOLT_THRESHOLD = 0.51; // 51% of citizens must vote to revolt
export const MIN_REVOLT_VOTES = 3; // minimum absolute votes needed for revolt
export const MIN_REVOLT_LEVEL = 2; // minimum player level to cast revolt vote
export const MAX_LOCATIONS_PER_CHUNK = 50; // max top-level locations per chunk
export const MAX_LOCATION_DEPTH_ENFORCED = 10; // max nesting depth for locations
export const EMERGENCY_ESCAPE_COST = 200; // gold cost to force escape locked borders
export const MAX_POLICY_FEE = 1000; // max fee for immigration/build/exit policies
export const MAX_COMBINED_ENTRY_EXIT_FEE = 50; // entry_fee + exit_fee cap to prevent fee traps
export const MAX_CHUNKS_PER_PLAYER = 10; // max chunks a player can rule
export const MIN_GOLD_SWAP = 10; // minimum gold for AMM swap
export const MIN_USDC_SWAP = 1; // minimum USDC for AMM swap
export const SPAWN_IMMUNITY_SECONDS = 300; // 5 minutes spawn protection
export const STAT_CAP = 50; // max value for any individual stat
export const TRANSFER_RULE_MIN_FEE = 50; // minimum gold to transfer chunk rule
export const TRANSFER_RULE_REVENUE_RATE = 0.1; // 10% of chunk revenue as transfer fee
export const REVOLT_VOTE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h vote expiration
export const MAX_GOLD = 10_000_000; // 10M gold cap to prevent integer overflow
export const MAX_DEMOLISH_COST = 50_000; // cap demolition cost to prevent invincible locations
export const TRADE_EXPIRY_MS = 60 * 60 * 1000; // 1h trade expiration
export const LOCATION_BASE_COST = 25; // base gold cost to create a location
export const MAX_SPAWN_MONSTER_AC = 20; // cap monster AC for freshly spawned monsters

// Economy constants
export const PLATFORM_TAX_RATE = 0.028; // 2.8%
export const MAX_CHUNK_TAX_RATE = 15; // max 15%

export interface LiquidityPool {
  id: number;
  gold_reserve: number;
  usdc_reserve: number;
  last_updated_at: string;
}

export interface PlayerListing {
  id: number;
  seller_id: number;
  item_id: number;
  price: number;
  chunk_x: number;
  chunk_y: number;
  location_id: number | null;
  created_at: string;
}

export type UsdcTransactionType = 'swap_gold_to_usdc' | 'swap_usdc_to_gold' | 'p2p_transfer' | 'deposit' | 'withdrawal';

export interface UsdcTransaction {
  id: number;
  from_id: number | null;
  to_id: number | null;
  amount: number;
  transaction_type: UsdcTransactionType;
  platform_tax: number;
  chunk_tax: number;
  metadata: string; // JSON
  created_at: string;
}

export interface TaxBreakdown {
  platformTax: number;
  chunkTax: number;
  rulerId: number | null;
  netAmount: number;
}

// --- PvE: Monster Templates ---
export interface MonsterTemplate {
  id: number;
  name: string;
  description: string;
  monster_type: string;
  base_hp: number;
  base_strength: number;
  base_dexterity: number;
  base_constitution: number;
  base_damage_bonus: number;
  base_defense_bonus: number;
  min_danger_level: number;
  max_danger_level: number;
  xp_reward: number;
  gold_min: number;
  gold_max: number;
  loot_table: string; // JSON array
  chunk_x: number;
  chunk_y: number;
  location_id: number | null;
  created_by: number;
  created_at: string;
}

// --- PvE: Active Monsters ---
export interface ActiveMonster {
  id: number;
  template_id: number;
  chunk_x: number;
  chunk_y: number;
  location_id: number | null;
  hp: number;
  max_hp: number;
  strength: number;
  dexterity: number;
  constitution: number;
  damage_bonus: number;
  defense_bonus: number;
  engaged_by: number | null;
  engaged_at: string | null;
  spawned_at: string;
}

// --- Bounty ---
export interface Bounty {
  player_id: number;
  amount: number;
  kills_since_reset: number;
  last_kill_at: string | null;
}

// --- PvE Combat Result ---
export interface PveCombatResult {
  player_roll: number;
  monster_ac: number;
  player_hit: boolean;
  player_damage: number;
  player_crit: boolean;
  monster_roll: number;
  player_ac: number;
  monster_hit: boolean;
  monster_damage: number;
  player_hp: number;
  monster_hp: number;
  player_knocked_out: boolean;
  monster_dead: boolean;
}

// --- PvE Constants ---
export const ENCOUNTER_CHANCE_PER_DANGER = 0.12;
export const DUNGEON_ENCOUNTER_CHANCE = 0.6;
export const MONSTER_DESPAWN_MINUTES = 30;
export const MAX_MONSTER_TEMPLATES_PER_LOCATION = 5;
export const PVE_KNOCKOUT_GOLD_PENALTY = 0.1;
export const MONSTER_STAT_SCALE = 0.2;
export const MONSTER_REGEN_FRACTION = 0.25;
export const MONSTER_ENGAGE_TIMEOUT_SECONDS = 60;
export const SELL_ITEM_VALUE_FRACTION = 0.6;
export const TAVERN_HEAL_COST = 10;

// XP rewards
export const XP_PER_MONSTER_BASE = 20;
export const XP_EXPLORE_NEW_CHUNK = 15;
export const XP_DISCOVER_LOCATION = 10;
export const XP_CRAFT_LOCATION = 20;
export const XP_CRAFT_ITEM = 10;

// Bounty
export const BOUNTY_PER_KILL = 50;
export const BOUNTY_DECAY_HOURS = 48;

// HP regen
export const HP_REGEN_FRACTION = 0.35;

// --- Mail ---
export interface Mail {
  id: number;
  from_id: number;
  to_id: number;
  subject: string;
  body: string;
  gold_attached: number;
  is_read: number;
  created_at: string;
}

export interface MailWithSender extends Mail {
  sender_name: string;
}

export const MAX_INBOX_SIZE = 200;
export const MAX_MAIL_BODY_LENGTH = 2000;
export const MAIL_PAGE_SIZE = 20;

// --- Alliances ---
export type AllianceRole = 'leader' | 'officer' | 'member' | 'invited';

export interface Alliance {
  id: number;
  name: string;
  tag: string;
  leader_id: number;
  treasury: number;
  shares_outstanding: number;
  level: number;
  max_members: number;
  created_at: string;
}

export interface AllianceMember {
  alliance_id: number;
  player_id: number;
  role: AllianceRole;
  joined_at: string;
}

export interface AllianceWithMembers extends Alliance {
  members: Array<{
    player_id: number;
    player_name: string;
    role: AllianceRole;
    joined_at: string;
  }>;
}

// Mail constants
export const MAIL_COOLDOWN_MS = 30_000;
export const MAX_MAIL_SUBJECT_LENGTH = 100;
export const MAX_MAIL_CONTENT_LENGTH = 2000;

// Alliance constants
export const MAX_ALLIANCE_NAME_LENGTH = 30;
export const MIN_ALLIANCE_NAME_LENGTH = 2;
export const MAX_ALLIANCE_TAG_LENGTH = 5;
export const MIN_ALLIANCE_TAG_LENGTH = 2;
export const ALLIANCE_CREATION_COST = 500;
export const ALLIANCE_DEFAULT_MAX_MEMBERS = 10;

export type MessageType = 'public' | 'whisper' | 'alliance';

// --- Party (Group PvE) ---
export type PartyMemberStatus = 'active' | 'invited';

export interface Party {
  id: number;
  leader_id: number;
  created_at: string;
}

export interface PartyMember {
  party_id: number;
  player_id: number;
  status: PartyMemberStatus;
  joined_at: string;
}

export interface PartyMemberInfo {
  player_id: number;
  player_name: string;
  status: PartyMemberStatus;
  hp: number;
  max_hp: number;
  level: number;
  chunk_x: number;
  chunk_y: number;
  location_id: number | null;
  is_leader: boolean;
}

// Party constants
export const MAX_PARTY_SIZE = 5;
export const PARTY_XP_BONUS: Record<number, number> = {
  2: 1.2,
  3: 1.5,
}; // 4+ uses 1.8
export const PARTY_XP_BONUS_LARGE = 1.8;

// --- Stock Market ---
export interface Company {
  id: number;
  name: string;
  ticker: string;
  description: string;
  company_type: string;
  total_shares: number;
  ipo_price: number;
  treasury: number;
  shares_outstanding: number;
  dividend_rate: number;
  revenue_accumulated: number;
  last_dividend_at: string | null;
  created_at: string;
}

export interface ShareHolding {
  player_id: number;
  company_id: number;
  quantity: number;
  avg_purchase_price: number;
  company_name: string;
  ticker: string;
}

export interface ShareOrder {
  id: number;
  player_id: number;
  company_id: number;
  order_type: 'buy' | 'sell';
  quantity: number;
  price_per_share: number;
  filled_quantity: number;
  status: string;
  created_at: string;
}

export const MAX_SHARES_PER_ORDER = 1000;
export const STOCK_TRADE_COOLDOWN = 3_000;
export const STOCK_VIEW_COOLDOWN = 5_000;
export const DIVIDEND_CLAIM_COOLDOWN = 10_000;
export const MIN_SHARE_PRICE = 1;
export const MAX_SHARE_PRICE = 100_000;

// --- Banking System ---
export interface WorldBank {
  id: number;
  federal_rate: number;
  reserves: number;
  total_lent: number;
  revenue_accumulated: number;
  last_rate_change: string;
}

export interface NationalBank {
  chunk_x: number;
  chunk_y: number;
  ruler_id: number;
  reserves: number;
  markup: number;
  total_deposits: number;
  total_lent: number;
  created_at: string;
}

export interface LocalBank {
  id: number;
  owner_id: number;
  location_id: number;
  chunk_x: number;
  chunk_y: number;
  name: string;
  reserves: number;
  deposit_rate: number;
  lending_rate: number;
  total_deposits: number;
  total_lent: number;
  created_at: string;
}

export interface BankAccount {
  id: number;
  player_id: number;
  bank_id: number;
  balance: number;
  interest_accrued: number;
  last_interest_at: string;
  created_at: string;
}

export type BorrowerType = 'player' | 'local_bank' | 'national_bank';
export type LenderType = 'world_bank' | 'national_bank' | 'local_bank';
export type LoanStatus = 'active' | 'paid' | 'defaulted';

export interface Loan {
  id: number;
  borrower_type: BorrowerType;
  borrower_id: number;
  lender_type: LenderType;
  lender_id: number;
  principal: number;
  interest_rate: number;
  balance_remaining: number;
  interest_accrued: number;
  term_days: number;
  status: LoanStatus;
  last_payment_at: string;
  created_at: string;
}

export const WORLD_BANK_INITIAL_RESERVES = 0; // Zero-emission: WRB funded solely by platform taxes
export const NCB_INITIAL_LOAN = 10_000;
export const NCB_CREATION_COST = 500;
export const LOCAL_BANK_INITIAL_LOAN = 5_000;
export const LOCAL_BANK_CREATION_COST = 500;
export const MAX_PLAYER_LOANS = 3;
export const MIN_LOAN_AMOUNT = 100;
export const MAX_LOAN_AMOUNT = 100_000;
export const MAX_LOAN_TERM_DAYS = 30;
export const MIN_FEDERAL_RATE = 0.01;
export const MAX_FEDERAL_RATE = 0.20;
export const MAX_NCB_MARKUP = 0.15;
export const MAX_LOCAL_DEPOSIT_RATE = 0.10;
export const MAX_LOCAL_LENDING_RATE = 0.25;

// --- Soul Binding ---
export interface SoulBinding {
  id: number;
  player_id: number;
  tavern_location_id: number;
  tavern_chunk_x: number;
  tavern_chunk_y: number;
  bound_at: string;
  expires_at: string;
}

export const SOUL_BIND_COST_PER_LEVEL = 100; // level * 100 gold
export const SOUL_BIND_DURATION_HOURS = 48;
export const SOUL_BIND_LEVEL_PENALTY = 3; // lose 3 levels on death

// --- Daily Quests ---
export type QuestType = 'kill_monsters' | 'explore_chunks' | 'craft_item' | 'trade' | 'earn_gold' | 'rest' | 'use_look' | 'buy_item' | 'equip_item' | 'enter_tavern' | 'check_daily_quests';

export interface DailyQuest {
  id: number;
  player_id: number;
  quest_type: QuestType;
  description: string;
  target_count: number;
  current_count: number;
  reward_xp: number;
  reward_gold: number;
  assigned_date: string; // YYYY-MM-DD
  completed_at: string | null;
  is_tutorial: number;
}

export interface QuestStreak {
  player_id: number;
  current_streak: number;
  last_completed_date: string; // YYYY-MM-DD
  total_completed: number;
}

export const DAILY_QUEST_COUNT = 3;
export const QUEST_STREAK_BONUS_DAYS = 7; // Bonus after 7-day streak

// --- NPCs ---
export interface Npc {
  id: number;
  name: string;
  role: string;
  location_id: number;
  chunk_x: number;
  chunk_y: number;
  greeting: string;
  dialogue: string; // JSON array of dialogue options
}

export interface NpcDialogue {
  topic: string;
  text: string;
}
