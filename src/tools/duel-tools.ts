import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { getPlayerByName, getPlayerById } from '../models/player.js';
import { createDuel, getPendingDuel, resolveDuel, declineDuel } from '../models/duel.js';
import { resolveDuelCombat } from '../game/duel-combat.js';
import { logEvent } from '../models/event-log.js';
import { enforceCooldown, COOLDOWNS } from '../server/cooldown.js';

export function registerDuelTools(server: McpServer): void {
  server.tool(
    'challenge',
    'Challenge another player to a duel. Both players must be in the same chunk. 30s cooldown.',
    {
      token: z.string().uuid().describe('Your auth token'),
      target_name: z.string().describe('Name of the player to challenge'),
      wager: z.number().int().min(0).optional().default(0).describe('Gold wager (0 for honor duel)'),
    },
    async ({ token, target_name, wager }) => {
      try {
        const player = authenticate(token);
        const cd = enforceCooldown(player.id, 'challenge', COOLDOWNS.CHALLENGE);
        if (cd !== null) {
          return { content: [{ type: 'text', text: `Please wait ${cd}s before challenging again.` }] };
        }

        const target = getPlayerByName(target_name);
        if (!target) {
          return { content: [{ type: 'text', text: `Player "${target_name}" not found or is dead.` }] };
        }

        if (target.id === player.id) {
          return { content: [{ type: 'text', text: 'You cannot challenge yourself.' }] };
        }

        if (target.chunk_x !== player.chunk_x || target.chunk_y !== player.chunk_y) {
          return { content: [{ type: 'text', text: `${target_name} is not in your chunk.` }] };
        }

        // Check if target already has a pending duel
        const existingDuel = getPendingDuel(target.id);
        if (existingDuel) {
          return { content: [{ type: 'text', text: `${target_name} already has a pending duel challenge.` }] };
        }

        // Check if challenger has enough gold for wager
        if (wager > 0 && player.gold < wager) {
          return { content: [{ type: 'text', text: `You don't have enough gold for a ${wager}g wager. (You have ${player.gold}g)` }] };
        }

        // Create duel challenge
        const duel = createDuel(player.id, target.id, wager);

        logEvent('duel_challenge', player.id, target.id, player.chunk_x, player.chunk_y, player.location_id, {
          duel_id: duel.id,
          wager,
        });

        const wagerText = wager > 0 ? ` for ${wager}g` : ' (honor duel)';
        return {
          content: [{
            type: 'text',
            text: `You challenge ${target_name} to a duel${wagerText}! They have 60 seconds to accept or decline.`
          }]
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'accept_duel',
    'Accept a pending duel challenge. Starts the duel immediately (non-lethal combat).',
    {
      token: z.string().uuid().describe('Your auth token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const duel = getPendingDuel(player.id);

        if (!duel) {
          return { content: [{ type: 'text', text: 'You have no pending duel challenges.' }] };
        }

        const challenger = getPlayerById(duel.challenger_id);
        if (!challenger) {
          declineDuel(duel.id);
          return { content: [{ type: 'text', text: 'The challenger is no longer available.' }] };
        }

        // Check if target has enough gold for wager
        if (duel.wager > 0 && player.gold < duel.wager) {
          declineDuel(duel.id);
          return { content: [{ type: 'text', text: `You don't have enough gold for the ${duel.wager}g wager. (You have ${player.gold}g). Duel declined.` }] };
        }

        // Check if both players are still in the same chunk
        if (challenger.chunk_x !== player.chunk_x || challenger.chunk_y !== player.chunk_y) {
          declineDuel(duel.id);
          return { content: [{ type: 'text', text: 'You and the challenger are no longer in the same chunk. Duel cancelled.' }] };
        }

        // Resolve duel combat
        const result = resolveDuelCombat(challenger, player, duel.wager);

        // Update duel record
        resolveDuel(duel.id, result.winner.id);

        logEvent('duel_complete', result.winner.id, result.loser.id, player.chunk_x, player.chunk_y, player.location_id, {
          duel_id: duel.id,
          wager: duel.wager,
          winner_id: result.winner.id,
        });

        const parts = [
          `DUEL: ${challenger.name} vs ${player.name}`,
          '',
          result.narrative,
          '',
          `=== DUEL COMPLETE ===`,
          `Winner: ${result.winner.name} (+25 XP${result.wagerGold > 0 ? `, +${result.wagerGold}g` : ''})`,
          `Loser: ${result.loser.name} (+10 XP${result.wagerGold > 0 ? `, -${result.wagerGold}g` : ''}, knocked to 1 HP)`,
        ];

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'decline_duel',
    'Decline a pending duel challenge.',
    {
      token: z.string().uuid().describe('Your auth token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const duel = getPendingDuel(player.id);

        if (!duel) {
          return { content: [{ type: 'text', text: 'You have no pending duel challenges.' }] };
        }

        const challenger = getPlayerById(duel.challenger_id);
        declineDuel(duel.id);

        logEvent('duel_declined', player.id, duel.challenger_id, player.chunk_x, player.chunk_y, player.location_id, {
          duel_id: duel.id,
        });

        return {
          content: [{
            type: 'text',
            text: `You declined the duel challenge from ${challenger?.name || 'Unknown'}.`
          }]
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );
}
