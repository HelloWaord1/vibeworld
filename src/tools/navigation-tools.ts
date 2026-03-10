import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { getChunk, getAdjacentChunks, acquireLock, suggestDangerLevel } from '../models/chunk.js';
import { getLocationsInChunk, getLocationById, getChildLocations } from '../models/location.js';
import { getPlayersAtChunk, updatePlayerPosition } from '../models/player.js';
import { getItemsAtLocation, getItemsByOwner, getItemById } from '../models/item.js';
import { tryDiscover } from '../game/discovery.js';
import { DIRECTIONS, EMERGENCY_ESCAPE_COST } from '../types/index.js';
import { isValidChunkCoord } from '../game/world-rules.js';
import { getDb } from '../db/connection.js';
import { getListingsAtLocation } from '../models/player-listing.js';
import { getPlayerById, updatePlayerGold } from '../models/player.js';
import { addChunkRevenue } from '../models/nation.js';
import { rollEncounter, rollDungeonEncounter, spawnRandomEncounter } from '../game/encounter.js';
import { getMonstersAtLocation, getEngagedMonster } from '../models/active-monster.js';
import { getTemplateById } from '../models/monster-template.js';
import { awardExploreXp } from '../game/xp-rewards.js';
import { checkCooldown } from '../server/cooldown.js';
import { incrementQuestProgress } from '../models/quest.js';
import { checkAndUnlock } from '../models/achievement.js';
import { getNpcsAtLocation } from '../models/npc.js';

export function registerNavigationTools(server: McpServer): void {
  server.tool(
    'look',
    'Look around your current location. Shows description, players, items, exits.',
    { token: z.string().uuid().describe('Your auth token') },
    async ({ token }) => {
      try {
        const player = authenticate(token);

        // Track tutorial quest progress for using look
        incrementQuestProgress(player.id, 'use_look', 1);

        const chunk = getChunk(player.chunk_x, player.chunk_y);
        if (!chunk) return { content: [{ type: 'text', text: 'Error: You are in a void. This should not happen.' }] };

        const parts: string[] = [];

        // Ruler / tax / policy info
        if (chunk.ruler_id) {
          const ruler = getPlayerById(chunk.ruler_id);
          if (ruler) {
            let rulerLine = `Ruler: ${ruler.name} | Tax: ${chunk.chunk_tax_rate}%`;
            const policies: string[] = [];
            if (chunk.immigration_policy !== 'open') policies.push(`Immigration: ${chunk.immigration_policy}${chunk.immigration_fee > 0 ? ` (${chunk.immigration_fee}g)` : ''}`);
            if (chunk.build_policy !== 'free') policies.push(`Building: ${chunk.build_policy}${chunk.build_fee > 0 ? ` (${chunk.build_fee}g)` : ''}`);
            if (chunk.exit_policy !== 'free') policies.push(`Exit: ${chunk.exit_policy}${chunk.exit_fee > 0 ? ` (${chunk.exit_fee}g)` : ''}`);
            if (policies.length > 0) rulerLine += `\n  ${policies.join(' | ')}`;
            parts.push(rulerLine);
          }
        }

        if (player.location_id) {
          const loc = getLocationById(player.location_id);
          if (loc) {
            parts.push(`📍 ${loc.name} (inside ${chunk.name} @ ${chunk.x},${chunk.y})`);
            parts.push(loc.description);
            parts.push(`Type: ${loc.location_type} | Depth: ${loc.depth}`);

            // Sub-locations
            const children = getChildLocations(loc.id);
            const visible = children.filter(c => {
              if (!c.is_hidden) return true;
              const disc = tryDiscover(player, c);
              return disc.success;
            });
            if (visible.length > 0) {
              parts.push(`\nPlaces here:`);
              for (const c of visible) {
                parts.push(`  [${c.id}] ${c.name} (${c.location_type})`);
              }
            }
          }
        } else {
          parts.push(`🗺️ ${chunk.name} (${chunk.x},${chunk.y})`);
          parts.push(chunk.description);
          parts.push(`Terrain: ${chunk.terrain_type} | Danger: ${'⚠️'.repeat(chunk.danger_level)}`);

          // Locations at chunk level
          const locations = getLocationsInChunk(chunk.x, chunk.y, null);
          const visible = locations.filter(loc => {
            if (!loc.is_hidden) return true;
            const disc = tryDiscover(player, loc);
            return disc.success;
          });
          if (visible.length > 0) {
            parts.push(`\nPlaces:`);
            for (const loc of visible) {
              parts.push(`  [${loc.id}] ${loc.name} (${loc.location_type})`);
            }
          }

          // Adjacent directions
          const adjacent = getAdjacentChunks(chunk.x, chunk.y);
          const exits: string[] = [];
          for (const [dir, [dx, dy]] of Object.entries(DIRECTIONS)) {
            const adj = adjacent.find(a => a.x === chunk.x + dx && a.y === chunk.y + dy);
            if (adj) {
              exits.push(`${dir}: ${adj.name}`);
            } else {
              const nx = chunk.x + dx;
              const ny = chunk.y + dy;
              if (isValidChunkCoord(nx, ny)) exits.push(`${dir}: Unexplored`);
            }
          }
          if (exits.length > 0) {
            parts.push(`\nDirections:\n  ${exits.join('\n  ')}`);
          }
        }

        // NPCs
        const npcs = getNpcsAtLocation(player.chunk_x, player.chunk_y, player.location_id);
        if (npcs.length > 0) {
          parts.push(`\nNPCs:\n  ${npcs.map(n => `${n.name} (${n.role})`).join(', ')}`);
        }

        // Other players
        const players = getPlayersAtChunk(player.chunk_x, player.chunk_y, player.location_id)
          .filter(p => p.id !== player.id);
        if (players.length > 0) {
          parts.push(`\nPeople here:\n  ${players.map(p => `${p.name} (Lv${p.level})`).join(', ')}`);
        }

        // Items on ground / for sale
        const items = getItemsAtLocation(player.chunk_x, player.chunk_y, player.location_id);
        if (items.length > 0) {
          const shopItems = items.filter(i => i.is_shop_item);
          const groundItems = items.filter(i => !i.is_shop_item);
          if (shopItems.length > 0) {
            parts.push(`\nFor sale:`);
            for (const item of shopItems) {
              parts.push(`  [${item.id}] ${item.name} (${item.item_type}, ${item.rarity}) — ${item.value}g`);
            }
          }
          if (groundItems.length > 0) {
            parts.push(`\nItems on ground:`);
            for (const item of groundItems) {
              parts.push(`  [${item.id}] ${item.name} (${item.item_type}${item.value > 0 ? `, ${item.value}g` : ''})`);
            }
          }
        }

        // Player shop listings (capped at 20 to prevent output flood)
        const listings = getListingsAtLocation(player.chunk_x, player.chunk_y, player.location_id);
        if (listings.length > 0) {
          const displayListings = listings.slice(0, 20);
          parts.push(`\nPlayer shops:`);
          for (const listing of displayListings) {
            const listItem = getItemById(listing.item_id);
            const seller = getPlayerById(listing.seller_id);
            if (listItem && seller) {
              parts.push(`  [listing #${listing.id}] ${listItem.name} (${listItem.item_type}, ${listItem.rarity}) — ${listing.price}g by ${seller.name}`);
            }
          }
          if (listings.length > 20) {
            parts.push(`  ...and ${listings.length - 20} more listings`);
          }
        }

        // Active monsters
        const monsters = getMonstersAtLocation(player.chunk_x, player.chunk_y, player.location_id);
        if (monsters.length > 0) {
          parts.push(`\nMonsters:`);
          for (const m of monsters) {
            const tmpl = getTemplateById(m.template_id);
            const mName = tmpl?.name ?? 'Unknown';
            const engaged = m.engaged_by !== null ? (m.engaged_by === player.id ? ' [ENGAGED BY YOU]' : ' [IN COMBAT]') : '';
            parts.push(`  [${m.id}] ${mName} (${tmpl?.monster_type ?? '?'}) — HP: ${m.hp}/${m.max_hp}${engaged}`);
          }
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'move',
    'Move to an adjacent chunk (north/south/east/west). If the chunk does not exist, you will be asked to generate it.',
    {
      token: z.string().uuid().describe('Your auth token'),
      direction: z.enum(['north', 'south', 'east', 'west']).describe('Direction to move'),
    },
    async ({ token, direction }) => {
      try {
        const player = authenticate(token);

        // Must exit locations first
        if (player.location_id !== null) {
          return { content: [{ type: 'text', text: 'You must exit your current location first. Use `exit` to leave.' }] };
        }

        // Check PvE engagement — cannot move while fighting a monster
        const engaged = getEngagedMonster(player.id);
        if (engaged) {
          return { content: [{ type: 'text', text: 'You are engaged with a monster! Defeat it or use `flee_monster` first.' }] };
        }

        // Check PvP combat lock — cannot move for 10s after PvP combat
        const combatLockRemaining = checkCooldown(player.id, 'combat_lock');
        if (combatLockRemaining !== null) {
          return { content: [{ type: 'text', text: `You are locked in PvP combat! You cannot move for ${combatLockRemaining} more seconds. Fight or wait it out.` }] };
        }

        // Check exit policy of current chunk
        let exitNotice = '';
        const currentChunk = getChunk(player.chunk_x, player.chunk_y);
        if (currentChunk && currentChunk.ruler_id !== null && currentChunk.ruler_id !== player.id) {
          if (currentChunk.exit_policy === 'locked') {
            const freshPlayer = getPlayerById(player.id)!;
            // Free escape for newcomers (level 1-2)
            if (freshPlayer.level <= 2) {
              exitNotice = 'As a newcomer, the guards let you pass without payment.\n';
            } else if (freshPlayer.gold < EMERGENCY_ESCAPE_COST) {
              return { content: [{ type: 'text', text: `This nation has locked borders. Emergency escape costs ${EMERGENCY_ESCAPE_COST}g (you have ${freshPlayer.gold}g). Use \`revolt\` to overthrow the ruler.` }] };
            } else {
              // Emergency escape: pay EMERGENCY_ESCAPE_COST to force exit
              const db = getDb();
              db.prepare('UPDATE players SET gold = gold - ? WHERE id = ?').run(EMERGENCY_ESCAPE_COST, player.id);
              // Ruler gets half of emergency escape cost
              if (currentChunk.ruler_id) {
                db.prepare('UPDATE players SET gold = min(gold + ?, 10000000) WHERE id = ?').run(Math.floor(EMERGENCY_ESCAPE_COST / 2), currentChunk.ruler_id);
              }
              addChunkRevenue(player.chunk_x, player.chunk_y, EMERGENCY_ESCAPE_COST);
            }
          }
          if (currentChunk.exit_policy === 'fee' && currentChunk.exit_fee > 0) {
            const freshPlayer = getPlayerById(player.id)!;
            if (freshPlayer.gold < currentChunk.exit_fee) {
              // Check if player has been trapped for more than 5 minutes
              const db = getDb();
              const chunkEntry = db.prepare(
                "SELECT created_at FROM event_log WHERE event_type = 'chunk_explore' AND actor_id = ? AND chunk_x = ? AND chunk_y = ? ORDER BY created_at DESC LIMIT 1"
              ).get(player.id, player.chunk_x, player.chunk_y) as { created_at: string } | undefined;

              const minutesInChunk = chunkEntry
                ? (Date.now() - new Date(chunkEntry.created_at + 'Z').getTime()) / 60000
                : 0;

              if (minutesInChunk > 5 && freshPlayer.gold >= 1) {
                // Emergency escape: penalize 10% of gold (min 1g)
                const penalty = Math.max(1, Math.floor(freshPlayer.gold * 0.1));
                db.prepare('UPDATE players SET gold = gold - ? WHERE id = ?').run(penalty, player.id);
                exitNotice += `Emergency escape! You lost ${penalty}g scrambling out.\n`;
              } else {
                return { content: [{ type: 'text', text: `Exit fee: ${currentChunk.exit_fee}g. You only have ${freshPlayer.gold}g.${minutesInChunk <= 5 ? ` Wait ${Math.ceil(5 - minutesInChunk)} more minutes for emergency escape.` : ''}` }] };
              }
            } else {
              const db = getDb();
              db.prepare('UPDATE players SET gold = gold - ? WHERE id = ?').run(currentChunk.exit_fee, player.id);
              if (currentChunk.ruler_id) {
                db.prepare('UPDATE players SET gold = min(gold + ?, 10000000) WHERE id = ?').run(currentChunk.exit_fee, currentChunk.ruler_id);
              }
              addChunkRevenue(player.chunk_x, player.chunk_y, currentChunk.exit_fee);
            }
          }
        }

        const [dx, dy] = DIRECTIONS[direction];
        const newX = player.chunk_x + dx;
        const newY = player.chunk_y + dy;

        if (!isValidChunkCoord(newX, newY)) {
          return { content: [{ type: 'text', text: `You cannot go ${direction}. The world ends here (-99 to 99 range).` }] };
        }

        const existing = getChunk(newX, newY);
        if (existing) {
          // Check immigration policy
          if (existing.ruler_id !== null && existing.ruler_id !== player.id) {
            if (existing.immigration_policy === 'closed' || existing.immigration_policy === 'selective') {
              return { content: [{ type: 'text', text: `${existing.name} has closed borders. You cannot enter.` }] };
            }
            if (existing.immigration_policy === 'fee' && existing.immigration_fee > 0) {
              const freshPlayer = getPlayerById(player.id)!;
              if (freshPlayer.gold < existing.immigration_fee) {
                return { content: [{ type: 'text', text: `${existing.name} charges an immigration fee of ${existing.immigration_fee}g. You only have ${freshPlayer.gold}g.` }] };
              }
              const db = getDb();
              db.prepare('UPDATE players SET gold = gold - ? WHERE id = ?').run(existing.immigration_fee, player.id);
              if (existing.ruler_id) {
                db.prepare('UPDATE players SET gold = min(gold + ?, 10000000) WHERE id = ?').run(existing.immigration_fee, existing.ruler_id);
              }
              addChunkRevenue(newX, newY, existing.immigration_fee);
            }
          }

          // Warn about non-free exit policies before entering
          let entryWarning = '';
          if (existing.exit_policy !== 'free' && existing.ruler_id !== null && existing.ruler_id !== player.id) {
            const currentGold = getPlayerById(player.id)!.gold;
            entryWarning = `\u26a0 WARNING: This chunk has locked borders. Emergency escape costs ${EMERGENCY_ESCAPE_COST}g. Your gold: ${currentGold}g.\n\n`;
          }

          updatePlayerPosition(player.id, newX, newY, null);
          let moveText = `${exitNotice}${entryWarning}You travel ${direction} to ${existing.name} (${newX},${newY}).\n\n${existing.description}\nTerrain: ${existing.terrain_type} | Danger: ${'⚠️'.repeat(existing.danger_level)}`;
          if (existing.ruler_id) {
            const ruler = getPlayerById(existing.ruler_id);
            if (ruler) {
              moveText += `\n👑 Ruler: ${ruler.name} | Tax: ${existing.chunk_tax_rate}%`;
              if (existing.immigration_policy !== 'open') {
                moveText += ` | Immigration: ${existing.immigration_policy}`;
              }
              if (existing.exit_policy !== 'free') {
                moveText += ` | Exit: ${existing.exit_policy}${existing.exit_fee > 0 ? ` (${existing.exit_fee}g)` : ''}`;
              }
            }
          }

          // Explore XP: atomically check-and-insert inside a transaction to prevent race condition
          const db = getDb();
          const awardExploreXpIfNew = db.transaction(() => {
            const visitCheck = db.prepare(
              "SELECT 1 FROM event_log WHERE event_type = 'chunk_explore' AND actor_id = ? AND chunk_x = ? AND chunk_y = ?"
            ).get(player.id, newX, newY);
            if (visitCheck) return null;
            db.prepare(
              "INSERT INTO event_log (event_type, actor_id, chunk_x, chunk_y, data) VALUES ('chunk_explore', ?, ?, ?, '{}')"
            ).run(player.id, newX, newY);
            return awardExploreXp(player.id);
          });
          const xpResult = awardExploreXpIfNew();
          if (xpResult) {
            // Update explore quest progress (only for new chunks)
            incrementQuestProgress(player.id, 'explore_chunks', 1);

            // Check explorer achievement (5 unique chunks)
            const exploredCount = db.prepare(
              "SELECT COUNT(*) as count FROM event_log WHERE event_type = 'chunk_explore' AND actor_id = ?"
            ).get(player.id) as { count: number };
            if (exploredCount.count >= 5) {
              checkAndUnlock(player.id, 'explorer');
            }

            moveText += `\n+${xpResult.xp} XP (new territory!)`;
            if (xpResult.leveled_up) {
              moveText += ` LEVEL UP! You are now level ${xpResult.new_level}.`;
            }
          }

          // Random encounter check
          if (rollEncounter(existing.danger_level)) {
            const spawned = spawnRandomEncounter(newX, newY, null, existing.danger_level);
            if (spawned) {
              const tmpl = getTemplateById(spawned.template_id);
              moveText += `\n\nA wild ${tmpl?.name ?? 'monster'} appears! (HP: ${spawned.hp}/${spawned.max_hp}) [ID: ${spawned.id}]`;
              moveText += `\nUse \`attack_monster\` to fight or \`flee_monster\` to run.`;
            }
          }

          return { content: [{ type: 'text', text: moveText }] };
        }

        // Chunk doesn't exist — try to acquire lock
        const locked = acquireLock(newX, newY, player.id);
        const adjacent = getAdjacentChunks(newX, newY);
        const dangerSuggestion = suggestDangerLevel(newX, newY);

        const adjacentInfo = adjacent.map(a => `  (${a.x},${a.y}) ${a.name} — ${a.terrain_type}, danger ${a.danger_level}, tags: ${a.theme_tags}`).join('\n');

        if (locked) {
          return {
            content: [{
              type: 'text',
              text: `🌍 GENERATION NEEDED — Chunk (${newX},${newY}) does not exist yet!\n\nYou have acquired the creation lock. Generate a description for this chunk and submit it with \`submit_chunk\`.\n\nSuggested danger level: ${dangerSuggestion}\n\nAdjacent chunks for context:\n${adjacentInfo || '  None (you are at the frontier)'}\n\nRequirements:\n- Name (2-100 chars)\n- Description (10-2000 chars)\n- Terrain type\n- Danger level (1-10, suggested: ${dangerSuggestion})\n- Theme tags (optional array)\n\nCoordinates: x=${newX}, y=${newY}`
            }]
          };
        } else {
          return { content: [{ type: 'text', text: `Chunk (${newX},${newY}) is being generated by another player. Try again in a moment.` }] };
        }
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'enter',
    'Enter a location (tavern, shop, dungeon, etc). Use the location ID from `look`.',
    {
      token: z.string().uuid().describe('Your auth token'),
      location_id: z.number().int().describe('ID of the location to enter'),
    },
    async ({ token, location_id }) => {
      try {
        const player = authenticate(token);

        // Check PvP combat lock
        const enterCombatLock = checkCooldown(player.id, 'combat_lock');
        if (enterCombatLock !== null) {
          return { content: [{ type: 'text', text: `You are locked in PvP combat! You cannot enter locations for ${enterCombatLock} more seconds.` }] };
        }

        const loc = getLocationById(location_id);
        if (!loc) return { content: [{ type: 'text', text: 'Location not found.' }] };
        if (loc.chunk_x !== player.chunk_x || loc.chunk_y !== player.chunk_y) {
          return { content: [{ type: 'text', text: 'That location is not in your current chunk.' }] };
        }

        // Check parent chain
        if (player.location_id === null && loc.parent_id !== null) {
          return { content: [{ type: 'text', text: 'You must enter the parent location first.' }] };
        }
        if (player.location_id !== null && loc.parent_id !== player.location_id) {
          return { content: [{ type: 'text', text: 'That location is not accessible from here. It may be inside another place.' }] };
        }

        // Hidden check
        if (loc.is_hidden) {
          const disc = tryDiscover(player, loc);
          if (!disc.success) {
            return { content: [{ type: 'text', text: `You search but find nothing special. (Roll: ${disc.roll} vs DC ${disc.dc})` }] };
          }
        }

        // Key check
        if (loc.required_key_id !== null) {
          const playerItems = getItemsByOwner(player.id);
          const hasKey = playerItems.some(i => i.id === loc.required_key_id || (i.item_type === 'key' && i.rarity === 'rare'));
          if (!hasKey) {
            return { content: [{ type: 'text', text: `This location is locked. You need the right key to enter.` }] };
          }
        }

        updatePlayerPosition(player.id, player.chunk_x, player.chunk_y, loc.id);

        // Track tutorial quest progress for entering a tavern
        if (loc.location_type === 'tavern') {
          incrementQuestProgress(player.id, 'enter_tavern', 1);
        }

        let enterText = `You enter ${loc.name}.\n\n${loc.description}`;

        // Dungeon encounter check
        if (loc.location_type === 'dungeon' && rollDungeonEncounter()) {
          const chunk = getChunk(player.chunk_x, player.chunk_y);
          const dangerLevel = chunk?.danger_level ?? 1;
          const spawned = spawnRandomEncounter(player.chunk_x, player.chunk_y, loc.id, dangerLevel);
          if (spawned) {
            const tmpl = getTemplateById(spawned.template_id);
            enterText += `\n\nA ${tmpl?.name ?? 'monster'} lurks in the darkness! (HP: ${spawned.hp}/${spawned.max_hp}) [ID: ${spawned.id}]`;
            enterText += `\nUse \`attack_monster\` to fight or \`flee_monster\` to run.`;
          }
        }

        return { content: [{ type: 'text', text: enterText }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'exit',
    'Exit your current location, going up one level.',
    { token: z.string().uuid().describe('Your auth token') },
    async ({ token }) => {
      try {
        const player = authenticate(token);

        // Check PvP combat lock
        const exitCombatLock = checkCooldown(player.id, 'combat_lock');
        if (exitCombatLock !== null) {
          return { content: [{ type: 'text', text: `You are locked in PvP combat! You cannot exit for ${exitCombatLock} more seconds.` }] };
        }

        if (player.location_id === null) {
          return { content: [{ type: 'text', text: 'You are already outside. Use `move` to travel to another chunk.' }] };
        }
        const loc = getLocationById(player.location_id);
        const parentId = loc?.parent_id ?? null;
        updatePlayerPosition(player.id, player.chunk_x, player.chunk_y, parentId);

        if (parentId) {
          const parent = getLocationById(parentId);
          return { content: [{ type: 'text', text: `You exit to ${parent?.name || 'the previous area'}.` }] };
        }
        const chunk = getChunk(player.chunk_x, player.chunk_y);
        return { content: [{ type: 'text', text: `You step outside into ${chunk?.name || 'the open'}.` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );
}
