import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { enforceCooldown, COOLDOWNS } from '../server/cooldown.js';
import { getPlayerById, updatePlayerGold } from '../models/player.js';
import { getLocationById } from '../models/location.js';
import { getActiveSoulBinding, createSoulBinding } from '../models/soul-binding.js';
import { SOUL_BIND_COST_PER_LEVEL, SOUL_BIND_DURATION_HOURS } from '../types/index.js';
import { checkAndUnlock } from '../models/achievement.js';

export function registerSoulTools(server: McpServer): void {
  server.tool(
    'soul_bind',
    'Bind your soul at a tavern to insure against permadeath. Costs (level × 100) gold. Lasts 48 hours. On PvP death, respawn at bound tavern, losing 3 levels, all gold, and all items. 60s cooldown.',
    {
      token: z.string().uuid().describe('Your auth token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const cd = enforceCooldown(player.id, 'soul_bind', COOLDOWNS.SOUL_BIND);
        if (cd !== null) return { content: [{ type: 'text', text: `Please wait ${cd}s before binding again.` }] };

        // Must be at a tavern
        if (player.location_id === null) {
          return { content: [{ type: 'text', text: 'You must be inside a tavern to bind your soul. Use `enter` to go into a tavern location.' }] };
        }

        const location = getLocationById(player.location_id);
        if (!location || location.location_type !== 'tavern') {
          return { content: [{ type: 'text', text: 'You must be inside a tavern to bind your soul. This is not a tavern.' }] };
        }

        // Check if player can afford it
        const fresh = getPlayerById(player.id)!;
        const cost = fresh.level * SOUL_BIND_COST_PER_LEVEL;
        if (fresh.gold < cost) {
          return { content: [{ type: 'text', text: `Soul binding costs ${cost}g (level × 100). You only have ${fresh.gold}g.` }] };
        }

        // Check if already has active binding
        const existingBinding = getActiveSoulBinding(fresh.id);
        if (existingBinding) {
          const expiresAt = new Date(existingBinding.expires_at + 'Z');
          const hoursRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60));
          return { content: [{ type: 'text', text: `You already have an active soul binding that expires in ${hoursRemaining} hours. Wait for it to expire before binding again.` }] };
        }

        // Create the binding
        const binding = createSoulBinding(fresh.id, location.id, player.chunk_x, player.chunk_y);
        updatePlayerGold(fresh.id, fresh.gold - cost);

        // Check soul_bound achievement
        checkAndUnlock(fresh.id, 'soul_bound');

        const expiresAt = new Date(binding.expires_at + 'Z');
        const expiryText = expiresAt.toISOString().replace('T', ' ').split('.')[0];

        return {
          content: [{
            type: 'text',
            text: `Soul bound to ${location.name}! You paid ${cost}g.\n\nIf you die in PvP within the next ${SOUL_BIND_DURATION_HOURS} hours, you will respawn here instead of permanent death. However, you will:\n- Lose 3 levels\n- Drop all gold\n- Drop all items\n\nBinding expires at: ${expiryText} UTC`
          }]
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'soul_status',
    'Check your current soul binding status. 5s cooldown.',
    {
      token: z.string().uuid().describe('Your auth token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const cd = enforceCooldown(player.id, 'soul_status', COOLDOWNS.SOUL_STATUS);
        if (cd !== null) return { content: [{ type: 'text', text: `Please wait ${cd}s before checking status again.` }] };

        const binding = getActiveSoulBinding(player.id);
        if (!binding) {
          return { content: [{ type: 'text', text: 'You have no active soul binding. Visit a tavern and use `soul_bind` to bind your soul.' }] };
        }

        const location = getLocationById(binding.tavern_location_id);
        const tavernName = location?.name ?? 'Unknown Tavern';
        const expiresAt = new Date(binding.expires_at + 'Z');
        const hoursRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60));
        const minutesRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60)) % 60;

        return {
          content: [{
            type: 'text',
            text: `Soul Binding Active\n\nBound to: ${tavernName}\nLocation: (${binding.tavern_chunk_x}, ${binding.tavern_chunk_y})\nTime remaining: ${hoursRemaining}h ${minutesRemaining}m\nExpires: ${expiresAt.toISOString().replace('T', ' ').split('.')[0]} UTC\n\nIf you die in PvP, you will respawn at this tavern, losing 3 levels, all gold, and all items.`
          }]
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );
}
