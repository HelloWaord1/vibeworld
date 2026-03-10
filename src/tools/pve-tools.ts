import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { enforceCooldown, COOLDOWNS } from '../server/cooldown.js';
import { getActiveMonster, getMonstersAtLocation, engageMonster, disengageMonster, getEngagedMonster, updateMonsterHp } from '../models/active-monster.js';
import { getTemplateById } from '../models/monster-template.js';
import { resolvePveRound, handlePveKnockout, handleMonsterKill } from '../game/pve-combat.js';
import { getPlayerById, updatePlayerHp, updatePlayerGold, updatePlayerPosition } from '../models/player.js';
import { getChunk, getAdjacentChunks } from '../models/chunk.js';
import { getLocationById } from '../models/location.js';
import { logEvent } from '../models/event-log.js';
import { d20 } from '../game/dice.js';
import { HP_REGEN_FRACTION, MONSTER_REGEN_FRACTION, TAVERN_HEAL_COST, MONSTER_ENGAGE_TIMEOUT_SECONDS } from '../types/index.js';
import { spawnRandomEncounter } from '../game/encounter.js';
import { getPartyByPlayerId, getActivePartyMembersInChunk, isInSameParty } from '../models/party.js';
import { incrementQuestProgress } from '../models/quest.js';

function monsterDifficultyTag(monsterAc: number, monsterDmgEst: number, playerLevel: number): string {
  const score = monsterAc + monsterDmgEst - playerLevel * 2;
  if (score <= 12) return 'Easy';
  if (score <= 18) return 'Medium';
  if (score <= 24) return 'Hard';
  return 'Deadly';
}

function formatMonsterInfo(m: { id: number; hp: number; max_hp: number; strength: number; constitution: number; damage_bonus: number; defense_bonus: number; engaged_by: number | null }, template: { name: string; monster_type: string } | null, playerId: number, playerLevel: number): string {
  const name = template?.name ?? 'Unknown';
  const type = template?.monster_type ?? '?';
  const ac = 10 + Math.floor(m.constitution / 3) + m.defense_bonus;
  const dmgEst = Math.floor(m.strength / 3) + m.damage_bonus + 4; // avg d6 ≈ 3.5 → 4
  const difficulty = monsterDifficultyTag(ac, dmgEst, playerLevel);
  const engaged = m.engaged_by !== null ? (m.engaged_by === playerId ? ' [ENGAGED BY YOU]' : ' [IN COMBAT]') : '';
  return `  [${m.id}] ${name} (${type}) — HP: ${m.hp}/${m.max_hp} | AC: ${ac} | Dmg: ~${dmgEst} | ${difficulty}${engaged}`;
}

export function registerPveTools(server: McpServer): void {
  server.tool(
    'attack_monster',
    'Attack a monster at your location. One d20 combat round. 3s cooldown.',
    {
      token: z.string().uuid().describe('Your auth token'),
      monster_id: z.number().int().describe('ID of the monster to attack'),
    },
    async ({ token, monster_id }) => {
      try {
        const player = authenticate(token);
        const cd = enforceCooldown(player.id, 'attack_monster', COOLDOWNS.ATTACK_MONSTER);
        if (cd !== null) return { content: [{ type: 'text', text: `Please wait ${cd}s before attacking again.` }] };

        const monster = getActiveMonster(monster_id);
        if (!monster) return { content: [{ type: 'text', text: 'Monster not found. It may have despawned or been killed.' }] };

        if (monster.chunk_x !== player.chunk_x || monster.chunk_y !== player.chunk_y) {
          return { content: [{ type: 'text', text: 'That monster is not in your chunk.' }] };
        }
        if ((monster.location_id ?? null) !== (player.location_id ?? null)) {
          return { content: [{ type: 'text', text: 'That monster is not at your exact location.' }] };
        }

        // Party-aware engagement check
        const playerParty = getPartyByPlayerId(player.id);
        const partyEngageId = playerParty ? playerParty.leader_id : player.id;

        if (monster.engaged_by !== null && monster.engaged_by !== player.id) {
          // Check if the engager is in the same party
          const sameParty = playerParty !== null && (
            monster.engaged_by === playerParty.leader_id ||
            isInSameParty(player.id, monster.engaged_by)
          );

          if (!sameParty) {
            // Auto-disengage if the previous engagement has timed out
            const isTimedOut = monster.engaged_at
              ? (Date.now() - new Date(monster.engaged_at + 'Z').getTime()) > MONSTER_ENGAGE_TIMEOUT_SECONDS * 1000
              : false;
            if (!isTimedOut) {
              return { content: [{ type: 'text', text: 'Another player is already fighting this monster.' }] };
            }
            disengageMonster(monster.id);
          }
        }

        // Engage with party leader ID as the party identifier, or player ID if solo
        engageMonster(monster.id, partyEngageId);

        const template = getTemplateById(monster.template_id);
        const monsterName = template?.name ?? 'Monster';

        const { result, narrative } = resolvePveRound(player, monster);

        const parts = [
          `--- ${player.name} vs ${monsterName} ---`,
          '',
          narrative,
          '',
          `Your HP: ${result.player_hp}/${player.max_hp}`,
          `${monsterName} HP: ${result.monster_hp}/${monster.max_hp}`,
        ];

        if (result.monster_dead) {
          const chunk = getChunk(player.chunk_x, player.chunk_y);
          const dangerLevel = chunk?.danger_level ?? 1;
          const rewards = handleMonsterKill(player, monster, dangerLevel, playerParty?.id ?? null);

          // Update kill quest progress
          incrementQuestProgress(player.id, 'kill_monsters', 1);

          parts.push('');
          parts.push(`${monsterName} has been SLAIN!`);
          if (playerParty) {
            parts.push(`Party Rewards: +${rewards.xp} XP each (${rewards.partySize} members), +${rewards.gold}g to you`);
          } else {
            parts.push(`Rewards: +${rewards.xp} XP, +${rewards.gold}g`);
          }
          if (rewards.loot.length > 0) {
            parts.push(`Loot: ${rewards.loot.join(', ')}`);
          }
        } else if (result.player_knocked_out) {
          const knockout = handlePveKnockout(player);

          // Monster regens HP on player knockout
          const regenAmount = Math.floor(monster.max_hp * MONSTER_REGEN_FRACTION);
          const newMonsterHp = Math.min(result.monster_hp + regenAmount, monster.max_hp);
          updateMonsterHp(monster.id, newMonsterHp);
          disengageMonster(monster.id);

          parts.push('');
          parts.push(`You have been KNOCKED OUT by ${monsterName}!`);
          parts.push(`You lose ${knockout.goldLost}g. You recover at your current location with reduced HP.`);
          parts.push(`${monsterName} recovers to ${newMonsterHp}/${monster.max_hp} HP.`);
          parts.push(`(No permadeath from PvE. Your items are safe.)`);
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'flee_monster',
    'Attempt to flee from a monster. DEX check, DC scales with danger level. Disengages the monster on success. Monster recovers some HP.',
    {
      token: z.string().uuid().describe('Your auth token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const engaged = getEngagedMonster(player.id);

        if (!engaged) {
          return { content: [{ type: 'text', text: 'You are not engaged with any monster.' }] };
        }

        const template = getTemplateById(engaged.template_id);
        const monsterName = template?.name ?? 'Monster';

        const chunk = getChunk(player.chunk_x, player.chunk_y);
        const dangerLevel = chunk?.danger_level ?? 1;
        const fleeRoll = d20() + Math.floor(player.dexterity / 2);
        const dc = 8 + Math.floor(dangerLevel / 2);

        if (fleeRoll >= dc) {
          // Monster regens on disengage
          const regenAmount = Math.floor(engaged.max_hp * MONSTER_REGEN_FRACTION);
          const newHp = Math.min(engaged.hp + regenAmount, engaged.max_hp);
          updateMonsterHp(engaged.id, newHp);
          disengageMonster(engaged.id);

          // Move player to random adjacent chunk (if any exist)
          let fleeLocation = '';
          if (player.location_id !== null) {
            // If in a location, exit to chunk level
            updatePlayerPosition(player.id, player.chunk_x, player.chunk_y, null);
            fleeLocation = ' You scramble outside.';
          } else {
            // If at chunk level, try to flee to adjacent chunk
            const adjacent = getAdjacentChunks(player.chunk_x, player.chunk_y);
            if (adjacent.length > 0) {
              const target = adjacent[Math.floor(Math.random() * adjacent.length)];
              updatePlayerPosition(player.id, target.x, target.y, null);
              fleeLocation = ` You flee to ${target.name} (${target.x},${target.y}).`;
            }
          }

          return { content: [{ type: 'text', text: `You flee from ${monsterName}! (Roll: ${fleeRoll} vs DC ${dc}).${fleeLocation} ${monsterName} recovers to ${newHp}/${engaged.max_hp} HP.` }] };
        }

        return { content: [{ type: 'text', text: `You fail to flee from ${monsterName}! (Roll: ${fleeRoll} vs DC ${dc}). You remain in combat.` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'seek',
    'Actively search for monsters at your location. Rolls an encounter check and spawns a monster if templates exist. 5s cooldown.',
    {
      token: z.string().uuid().describe('Your auth token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const cd = enforceCooldown(player.id, 'seek', COOLDOWNS.SEEK);
        if (cd !== null) return { content: [{ type: 'text', text: `Please wait ${cd}s before seeking again.` }] };

        const chunk = getChunk(player.chunk_x, player.chunk_y);
        const dangerLevel = chunk?.danger_level ?? 1;

        const spawned = spawnRandomEncounter(player.chunk_x, player.chunk_y, player.location_id, dangerLevel);
        if (!spawned) {
          return { content: [{ type: 'text', text: 'You search the area but find nothing. (No monster templates available here, or none match the danger level.)' }] };
        }

        const tmpl = getTemplateById(spawned.template_id);
        const info = formatMonsterInfo(spawned, tmpl, player.id, player.level);

        return { content: [{ type: 'text', text: `You hear rustling nearby...\n\nA ${tmpl?.name ?? 'monster'} appears!\n${info}\n\nUse \`attack_monster ${spawned.id}\` to fight or \`flee_monster\` to run.` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'hunt',
    'List active monsters at your current location with difficulty info. 5s cooldown.',
    {
      token: z.string().uuid().describe('Your auth token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const cd = enforceCooldown(player.id, 'hunt', COOLDOWNS.HUNT);
        if (cd !== null) return { content: [{ type: 'text', text: `Please wait ${cd}s before hunting again.` }] };

        const monsters = getMonstersAtLocation(player.chunk_x, player.chunk_y, player.location_id);

        if (monsters.length === 0) {
          return { content: [{ type: 'text', text: 'No monsters are active at your location. Use `seek` to search for monsters.' }] };
        }

        const lines = ['Monsters here:'];
        for (const m of monsters) {
          const template = getTemplateById(m.template_id);
          lines.push(formatMonsterInfo(m, template, player.id, player.level));
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'rest',
    'Rest to recover 35% of your max HP (15s cooldown). In a tavern, fully heal for 10g. Cannot rest while engaged with a monster.',
    {
      token: z.string().uuid().describe('Your auth token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const cd = enforceCooldown(player.id, 'rest', COOLDOWNS.REST);
        if (cd !== null) return { content: [{ type: 'text', text: `Please wait ${cd}s before resting again.` }] };

        const engaged = getEngagedMonster(player.id);
        if (engaged) {
          return { content: [{ type: 'text', text: 'You cannot rest while engaged with a monster! Flee or defeat it first.' }] };
        }

        const fresh = getPlayerById(player.id)!;
        if (fresh.hp >= fresh.max_hp) {
          return { content: [{ type: 'text', text: `You are already at full health (${fresh.hp}/${fresh.max_hp} HP).` }] };
        }

        // Tavern full heal
        if (fresh.location_id !== null) {
          const loc = getLocationById(fresh.location_id);
          if (loc && loc.location_type === 'tavern') {
            if (fresh.gold >= TAVERN_HEAL_COST) {
              updatePlayerGold(fresh.id, fresh.gold - TAVERN_HEAL_COST);
              updatePlayerHp(fresh.id, fresh.max_hp);
              return { content: [{ type: 'text', text: `The barkeep patches you up. Fully healed! (${fresh.max_hp}/${fresh.max_hp} HP, -${TAVERN_HEAL_COST}g)` }] };
            }
            // Not enough gold — fall through to regular rest
          }
        }

        const healAmount = Math.floor(fresh.max_hp * HP_REGEN_FRACTION);
        const newHp = Math.min(fresh.hp + healAmount, fresh.max_hp);
        updatePlayerHp(player.id, newHp);

        // Update rest quest progress
        incrementQuestProgress(player.id, 'rest', 1);

        return { content: [{ type: 'text', text: `You rest and recover ${newHp - fresh.hp} HP. (${newHp}/${fresh.max_hp} HP)` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );
}
