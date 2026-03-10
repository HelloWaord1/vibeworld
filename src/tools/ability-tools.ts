import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import {
  getAvailableAbilities,
  getAbilityCooldownRemaining,
  activateAbility,
  getActiveBuffs,
  buffTypeName,
} from '../game/abilities.js';

export function registerAbilityTools(server: McpServer): void {
  server.tool(
    'abilities',
    'List your available abilities based on current stats. Shows cooldown status.',
    {
      token: z.string().uuid().describe('Your auth token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const available = getAvailableAbilities(player);

        if (available.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'You have no abilities available yet. Raise your stats to at least 8 in any stat to unlock abilities. Use `allocate_stats` after leveling up.',
            }],
          };
        }

        const lines: string[] = ['Your abilities:'];
        for (const ability of available) {
          const cdRemaining = getAbilityCooldownRemaining(player.id, ability.name);
          const readyText = cdRemaining === null ? 'READY' : `Cooldown: ${cdRemaining}s`;
          const statLabel = ability.stat_requirement.stat.toUpperCase();
          lines.push(
            `  ${ability.name} [${readyText}]`,
            `    ${ability.description}`,
            `    Requires: ${statLabel} ${ability.stat_requirement.min}+ | Cooldown: ${ability.cooldown_ms / 1000}s | Type: ${ability.effect}`,
            ''
          );
        }

        // Show active buffs
        const buffs = getActiveBuffs(player.id);
        if (buffs.length > 0) {
          lines.push('Active buffs:');
          for (const buff of buffs) {
            const remaining = Math.ceil((buff.expiresAt - Date.now()) / 1000);
            lines.push(`  ${buffTypeName(buff.type)} — ${buff.charges} charge(s), expires in ${remaining}s`);
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'use_ability',
    'Activate an ability. Check stat requirements and cooldown, then apply the effect.',
    {
      token: z.string().uuid().describe('Your auth token'),
      ability_name: z.string().describe('Name of the ability to use (see "abilities" tool for your available abilities)'),
    },
    async ({ token, ability_name }) => {
      try {
        const player = authenticate(token);
        const result = activateAbility(player.id, ability_name);
        return { content: [{ type: 'text', text: result }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );
}
