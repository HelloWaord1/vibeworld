import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { getPlayerByName, getPlayerById } from '../models/player.js';
import { getItemsByOwner, getItemById, getEquippedWeapon, getEquippedArmor } from '../models/item.js';
import { getChunk } from '../models/chunk.js';
import { getLocationById } from '../models/location.js';
import { getDb } from '../db/connection.js';
import { getStatPointsAvailable, xpToNextLevel } from '../game/leveling.js';
import { getPendingTradesForPlayer } from '../models/trade.js';
import { getBounty, getTopBounties } from '../game/bounty.js';
import type { Chunk } from '../types/index.js';
import { getPlayerAchievements, ACHIEVEMENTS } from '../models/achievement.js';

// ---------------------------------------------------------------------------
// Help data
// ---------------------------------------------------------------------------

const TOOL_CATEGORIES: Record<string, readonly string[]> = {
  'Getting Started': ['register', 'login', 'look', 'status', 'stats', 'help'],
  'Movement & Exploration': ['move', 'enter', 'exit', 'map'],
  'Combat': ['attack_player', 'attack_monster', 'flee_monster', 'seek', 'hunt', 'rest'],
  'Dueling': ['challenge', 'accept_duel', 'decline_duel'],
  'Inventory & Equipment': [
    'inventory', 'buy_item', 'sell_item', 'use_item', 'equip', 'unequip',
    'pickup', 'drop', 'inspect',
  ],
  'Player Market': ['list_item', 'delist_item', 'my_listings'],
  'Social & Trading': ['say', 'whisper', 'check_messages', 'who', 'talk', 'emote', 'trade_offer', 'accept_trade', 'reject_trade'],
  'Economy': ['swap_gold_for_usdc', 'swap_usdc_for_gold'],
  'Governance': [
    'claim_chunk', 'seize_chunk', 'abdicate', 'set_chunk_tax', 'set_immigration_policy',
    'set_build_policy', 'set_exit_policy', 'revolt_vote', 'chunk_info', 'my_chunks',
  ],
  'World Building': ['submit_chunk', 'submit_location', 'submit_monster'],
  'Other': ['leaderboard'],
} as const;

const TOOL_DETAILS: Record<string, string> = {
  // Navigation
  move: 'move {direction: north|south|east|west} -- Move to an adjacent chunk.',
  look: 'look -- See your current chunk, nearby locations, players, and monsters.',
  enter: 'enter {location_id} -- Enter a location (building, dungeon, etc.).',
  exit: 'exit -- Leave your current location back to the chunk surface.',
  map: 'map -- View the world map showing explored chunks around you.',

  // Building
  submit_chunk: 'submit_chunk {name, description, terrain_type, danger_level, theme_tags, x, y} -- Create a new chunk at unclaimed coordinates.',
  submit_location: 'submit_location {name, description, location_type, ...} -- Build a location inside a chunk.',
  submit_monster: 'submit_monster {name, description, monster_type, stats, ...} -- Create a monster template for a location.',

  // Combat
  attack_player: 'attack_player {target_name} -- Attack another player at your location. PvP with permadeath risk.',
  attack_monster: 'attack_monster {monster_id} -- Attack a monster. One d20 combat round. 3s cooldown.',
  flee_monster: 'flee_monster -- Attempt to flee from an engaged monster. DEX check DC 10.',
  seek: 'seek -- Search for monsters at your location. May spawn a random encounter. 5s cooldown.',
  hunt: 'hunt -- List all active monsters at your location with difficulty ratings. 5s cooldown.',
  rest: 'rest -- Recover 35% max HP (15s cooldown). Full heal in taverns for 10g.',

  // Dueling
  challenge: 'challenge {target_name, wager?} -- Challenge another player to a non-lethal duel. Both must be in same chunk. 30s cooldown.',
  accept_duel: 'accept_duel -- Accept a pending duel challenge. Loser drops to 1 HP (no permadeath). Winner gets wager.',
  decline_duel: 'decline_duel -- Decline a pending duel challenge.',

  // Inventory
  inventory: 'inventory -- View all items you own.',
  buy_item: 'buy_item {item_id} -- Buy an item from a shop (use "look" to see shop items and their IDs).',
  sell_item: 'sell_item {item_id} -- Sell an item for 40% of its value.',
  use_item: 'use_item {item_id} -- Use a consumable item (potions, etc.).',
  equip: 'equip {item_id} -- Equip a weapon or armor.',
  unequip: 'unequip {item_id} -- Unequip a weapon or armor.',
  pickup: 'pickup {item_id} -- Pick up an item on the ground.',
  drop: 'drop {item_id} -- Drop an item at your location.',
  list_item: 'list_item {item_id, price} -- List an item for sale on the player market.',
  delist_item: 'delist_item {listing_id} -- Remove your item listing from the market.',
  my_listings: 'my_listings -- View your active market listings.',
  inspect: 'inspect {target} -- Examine an item (#ID) or player in detail.',

  // Social
  say: 'say {message} -- Speak to everyone at your location.',
  whisper: 'whisper {target_name, message} -- Send a private message to a player.',
  check_messages: 'check_messages -- View recent messages at your location and whispers.',
  who: 'who -- See who else is at your location.',
  talk: 'talk {npc_name?, topic?} -- Talk to an NPC. Leave npc_name empty to list NPCs, leave topic empty for greeting.',
  emote: 'emote {action} -- Perform an emote (bow, wave, dance, etc. or custom text). 5s cooldown.',
  trade_offer: 'trade_offer {target_name, offer_items, offer_gold, request_items, request_gold} -- Propose a trade.',
  accept_trade: 'accept_trade {trade_id} -- Accept a pending trade offer.',
  reject_trade: 'reject_trade {trade_id} -- Reject a pending trade offer.',

  // Governance
  claim_chunk: 'claim_chunk -- Claim an unruled chunk you are standing in.',
  seize_chunk: 'seize_chunk -- Attempt to seize a chunk from its current ruler.',
  abdicate: 'abdicate -- Give up rulership of the chunk you are in.',
  set_chunk_tax: 'set_chunk_tax {rate} -- Set the tax rate for your chunk (0-15%).',
  set_immigration_policy: 'set_immigration_policy {policy, fee?} -- Control who can enter your chunk.',
  set_build_policy: 'set_build_policy {policy, fee?} -- Control who can build in your chunk.',
  set_exit_policy: 'set_exit_policy {policy, fee?} -- Control exit from your chunk.',
  revolt_vote: 'revolt_vote -- Vote to overthrow the current chunk ruler.',
  chunk_info: 'chunk_info -- View detailed info about the current chunk.',
  my_chunks: 'my_chunks -- View all chunks you rule.',

  // Economy
  swap_gold_for_usdc: 'swap_gold_for_usdc {amount} -- Convert gold to USDC via the AMM.',
  swap_usdc_for_gold: 'swap_usdc_for_gold {amount} -- Convert USDC to gold via the AMM.',

  // Info
  help: 'help {topic?} -- Show this help. Optionally pass a category or tool name for details.',
  status: 'status -- View your full player profile, stats, equipment, location, kills, bounty, and more.',
  stats: 'stats -- View your character stats, level, XP, and available stat points.',
  leaderboard: 'leaderboard {category?, page?, per_page?} -- Paginated rankings by level, wealth, pve, pvp, or explorers.',

  // Account
  register: 'register {name, password} -- Create a new character.',
  login: 'login {name, password} -- Log in to an existing character.',
};

function buildCategoryListing(): string {
  const lines = ['=== VIBEWORLD HELP ===', ''];
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    lines.push(`${category.toUpperCase()}:`);
    for (const tool of tools) {
      const detail = TOOL_DETAILS[tool];
      if (detail) {
        const description = detail.split(' -- ')[1] || detail;
        lines.push(`  ${tool} - ${description}`);
      } else {
        lines.push(`  ${tool}`);
      }
    }
    lines.push('');
  }
  lines.push('COMMON MISTAKES:');
  lines.push('  Use "buy_item" not "buy", "browse", or "shop"');
  lines.push('  Use "seek" or "hunt" not "gather"');
  lines.push('  Use "check_messages" not "inbox"');
  lines.push('  Use "stats" not "allocate_stat" (then use allocate_stats to spend points)');
  lines.push('');
  lines.push('COMMON EXAMPLES:');
  lines.push('  allocate_stats strength=2 dexterity=1');
  lines.push('  attack_monster monster_id=203');
  lines.push('  move direction=north');
  lines.push('  buy_item item_id=15');
  lines.push('  send_mail to=PlayerName subject=Hello body=How are you?');
  lines.push('  craft recipe_name=Iron Sword');
  lines.push('  daily_quests (no params needed)');
  lines.push('  soul_bind (must be in a tavern)');
  lines.push('');
  lines.push('For detailed help on a category or tool: help("combat") or help("attack_monster")');
  return lines.join('\n');
}

function buildCategoryDetail(categoryName: string, tools: readonly string[]): string {
  const lines = [`=== ${categoryName} Tools ===`, ''];
  for (const tool of tools) {
    const detail = TOOL_DETAILS[tool];
    lines.push(detail ?? tool);
  }
  return lines.join('\n');
}

function buildToolDetail(toolName: string): string | null {
  const detail = TOOL_DETAILS[toolName];
  if (!detail) return null;
  return `=== ${toolName} ===\n\n${detail}`;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerInfoTools(server: McpServer): void {

  // --- help ---
  server.tool(
    'help',
    'List all available tools grouped by category, or get details on a specific tool or category.',
    {
      topic: z.string().optional().describe('A category name (e.g. "combat") or tool name (e.g. "attack_monster")'),
    },
    async ({ topic }) => {
      try {
        if (!topic) {
          return { content: [{ type: 'text', text: buildCategoryListing() }] };
        }

        const normalized = topic.toLowerCase().trim();

        // Check if topic matches a category name
        for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
          if (category.toLowerCase() === normalized) {
            return { content: [{ type: 'text', text: buildCategoryDetail(category, tools) }] };
          }
        }

        // Check if topic matches a tool name
        const toolDetail = buildToolDetail(normalized);
        if (toolDetail) {
          return { content: [{ type: 'text', text: toolDetail }] };
        }

        return { content: [{ type: 'text', text: `Unknown topic "${topic}". Use help() to see all categories and tools.` }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: message }] };
      }
    }
  );

  // --- status ---
  server.tool(
    'status',
    'View your full player profile: stats, HP, equipment, location, kills, bounty, and more.',
    {
      token: z.string().uuid().describe('Your auth token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const fresh = getPlayerById(player.id)!;

        const xpNeeded = xpToNextLevel(fresh);
        const xpForLevel = fresh.level * 100;
        const statPoints = getStatPointsAvailable(fresh);

        const weapon = getEquippedWeapon(fresh.id);
        const armorPieces = getEquippedArmor(fresh.id);
        const armorBonus = armorPieces.reduce((sum, a) => sum + a.defense_bonus, 0);
        const ac = 10 + Math.floor(fresh.constitution / 3) + armorBonus;

        const chunk = getChunk(fresh.chunk_x, fresh.chunk_y);
        const chunkName = chunk?.name ?? 'Unknown';
        const locationName = fresh.location_id !== null
          ? getLocationById(fresh.location_id)?.name ?? 'Unknown'
          : null;

        const bounty = getBounty(fresh.id);

        const locationLine = locationName
          ? `  ${chunkName} (${fresh.chunk_x},${fresh.chunk_y}) > ${locationName}`
          : `  ${chunkName} (${fresh.chunk_x},${fresh.chunk_y})`;

        const weaponLine = weapon
          ? `  Weapon: ${weapon.name} (+${weapon.damage_bonus} dmg)`
          : '  Weapon: (none)';

        const armorLines = armorPieces.length > 0
          ? armorPieces.map(a => `  Armor: ${a.name} (+${a.defense_bonus} def)`).join('\n')
          : '  Armor: (none)';

        const lines = [
          `=== ${fresh.name} ===`,
          '',
          `Level: ${fresh.level}  |  XP: ${fresh.xp}/${xpForLevel} (${xpNeeded} to next level)`,
          `HP: ${fresh.hp}/${fresh.max_hp}`,
          '',
          '[Stats]',
          `  STR: ${fresh.strength}  DEX: ${fresh.dexterity}  CON: ${fresh.constitution}  CHA: ${fresh.charisma}  LCK: ${fresh.luck}`,
          `  Stat points available: ${statPoints}`,
          `  AC: ${ac}`,
          '',
          '[Wealth]',
          `  Gold: ${fresh.gold}`,
          `  USDC: ${fresh.usdc_balance}`,
          '',
          '[Location]',
          locationLine,
          '',
          '[Equipment]',
          weaponLine,
          armorLines,
          '',
          '[Combat Record]',
          `  Monsters killed: ${fresh.total_monsters_killed}`,
          `  PvP kills: ${fresh.total_pvp_kills}`,
          `  Bounty on head: ${bounty ? `${bounty.amount}g` : 'None'}`,
        ];

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: message }] };
      }
    }
  );

  // --- stats (existing) ---
  server.tool(
    'stats',
    'View your character stats, level, XP, and available stat points.',
    { token: z.string().uuid().describe('Your auth token') },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const statPoints = getStatPointsAvailable(player);
        const xpNeeded = xpToNextLevel(player);
        const trades = getPendingTradesForPlayer(player.id);

        const chunk = getChunk(player.chunk_x, player.chunk_y);
        const parts = [
          `${player.name} — Level ${player.level}`,
          `HP: ${player.hp}/${player.max_hp}`,
          `XP: ${player.xp}/${player.level * 100} (${xpNeeded} to next level)`,
          `Gold: ${player.gold}`,
          '',
          `STR: ${player.strength} | DEX: ${player.dexterity} | CON: ${player.constitution}`,
          `CHA: ${player.charisma} | LCK: ${player.luck}`,
          statPoints > 0 ? `\n${statPoints} stat points available! Use \`allocate_stats\`.` : '',
          '',
          `Location: ${chunk?.name || 'Unknown'} (${player.chunk_x},${player.chunk_y})`,
          trades.length > 0 ? `\n${trades.length} pending trade(s)` : '',
        ];

        return { content: [{ type: 'text', text: parts.filter(Boolean).join('\n') }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: message }] };
      }
    }
  );

  // --- inspect (existing) ---
  server.tool(
    'inspect',
    'Inspect a player or item for details.',
    {
      token: z.string().uuid().describe('Your auth token'),
      target: z.string().describe('Player name or item ID (prefix with # for items, e.g. #5)'),
    },
    async ({ token, target }) => {
      try {
        authenticate(token);

        // Item inspection
        if (target.startsWith('#')) {
          const itemId = parseInt(target.slice(1));
          if (isNaN(itemId)) return { content: [{ type: 'text', text: 'Invalid item ID.' }] };
          const item = getItemById(itemId);
          if (!item) return { content: [{ type: 'text', text: 'Item not found.' }] };

          const parts = [
            `${item.name} [${item.id}]`,
            item.description,
            `Type: ${item.item_type} | Rarity: ${item.rarity}`,
            `Value: ${item.value}g`,
          ];
          if (item.damage_bonus) parts.push(`Damage: +${item.damage_bonus}`);
          if (item.defense_bonus) parts.push(`Defense: +${item.defense_bonus}`);
          if (item.heal_amount) parts.push(`Heals: ${item.heal_amount} HP`);
          let bonuses: Record<string, unknown> = {};
          try { bonuses = JSON.parse(item.stat_bonuses || '{}'); } catch {}
          if (Object.keys(bonuses).length > 0) {
            parts.push(`Stat bonuses: ${Object.entries(bonuses).map(([k, v]) => `+${v} ${k}`).join(', ')}`);
          }

          return { content: [{ type: 'text', text: parts.join('\n') }] };
        }

        // Player inspection
        const targetPlayer = getPlayerByName(target);
        if (!targetPlayer) return { content: [{ type: 'text', text: `Player "${target}" not found.` }] };

        const equipped = getItemsByOwner(targetPlayer.id).filter(i => i.is_equipped);
        const parts = [
          `${targetPlayer.name} — Level ${targetPlayer.level}`,
          `HP: ${targetPlayer.hp}/${targetPlayer.max_hp}`,
          `Location: (${targetPlayer.chunk_x},${targetPlayer.chunk_y})`,
        ];
        if (equipped.length > 0) {
          parts.push('\nEquipped:');
          for (const item of equipped) {
            parts.push(`  ${item.name} (${item.item_type})`);
          }
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: message }] };
      }
    }
  );

  // --- map (existing) ---
  server.tool(
    'map',
    'View a map of explored chunks around you.',
    { token: z.string().uuid().describe('Your auth token') },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const db = getDb();
        const chunks = db.prepare('SELECT x, y, name, terrain_type, danger_level FROM chunks').all() as Chunk[];

        if (chunks.length === 0) {
          return { content: [{ type: 'text', text: 'No chunks explored yet.' }] };
        }

        // Find bounds
        const minX = Math.max(-99, player.chunk_x - 5);
        const maxX = Math.min(99, player.chunk_x + 5);
        const minY = Math.max(-99, player.chunk_y - 5);
        const maxY = Math.min(99, player.chunk_y + 5);

        const lines: string[] = [`Map (you are at ${player.chunk_x},${player.chunk_y})`, ''];

        for (let y = maxY; y >= minY; y--) {
          let row = `${String(y).padStart(3)}: `;
          for (let x = minX; x <= maxX; x++) {
            const chunk = chunks.find(c => c.x === x && c.y === y);
            if (x === player.chunk_x && y === player.chunk_y) {
              row += '[@]';
            } else if (chunk) {
              row += `[${chunk.terrain_type.charAt(0).toUpperCase()}]`;
            } else {
              row += ' . ';
            }
          }
          lines.push(row);
        }

        // Legend
        lines.push('');
        lines.push('Legend: [@]=You  [C]=city  [F]=forest  [D]=desert  etc.  .=unexplored');

        // List nearby chunks
        const nearby = chunks.filter(c => Math.abs(c.x - player.chunk_x) <= 5 && Math.abs(c.y - player.chunk_y) <= 5);
        if (nearby.length > 0) {
          lines.push('');
          lines.push('Nearby chunks:');
          for (const c of nearby) {
            lines.push(`  (${c.x},${c.y}) ${c.name} — ${c.terrain_type}, danger ${c.danger_level}`);
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: message }] };
      }
    }
  );

  // --- achievements ---
  server.tool(
    'achievements',
    'View your unlocked achievements and progress.',
    {
      token: z.string().uuid().describe('Your auth token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const achievements = getPlayerAchievements(player.id);

        const lines = ['=== ACHIEVEMENTS ===', ''];

        if (achievements.length === 0) {
          lines.push('You have not unlocked any achievements yet.');
          lines.push('');
          lines.push('Available achievements:');
          for (const [key, def] of Object.entries(ACHIEVEMENTS)) {
            lines.push(`  ${def.name} - ${def.description} (+${def.xp} XP)`);
          }
        } else {
          lines.push(`Unlocked: ${achievements.length}/${Object.keys(ACHIEVEMENTS).length}`);
          lines.push('');

          // Show unlocked achievements
          for (const ach of achievements) {
            const def = ACHIEVEMENTS[ach.achievement_key];
            if (def) {
              const date = new Date(ach.unlocked_at).toLocaleDateString();
              lines.push(`✓ ${def.name} - ${def.description} (unlocked ${date})`);
            }
          }

          // Show locked achievements
          const unlockedKeys = new Set(achievements.map(a => a.achievement_key));
          const locked = Object.entries(ACHIEVEMENTS).filter(([key]) => !unlockedKeys.has(key));

          if (locked.length > 0) {
            lines.push('');
            lines.push('Locked:');
            for (const [key, def] of locked) {
              lines.push(`  ✗ ${def.name} - ${def.description} (+${def.xp} XP)`);
            }
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: message }] };
      }
    }
  );
}
