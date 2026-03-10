import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { createMonsterTemplate, getTemplatesByCreator } from '../models/monster-template.js';
import { getChunk } from '../models/chunk.js';
import { logEvent } from '../models/event-log.js';
import { sanitizeHtml } from '../utils/content-filter.js';

export function registerMonsterTools(server: McpServer): void {
  server.tool(
    'submit_monster',
    'Create a monster template at your current location. Monsters will spawn from this template during encounters.',
    {
      token: z.string().uuid().describe('Your auth token'),
      name: z.string().min(2).max(50).describe('Monster name'),
      description: z.string().min(10).max(500).describe('Monster description'),
      monster_type: z.enum(['beast', 'undead', 'demon', 'construct', 'elemental', 'humanoid', 'dragon', 'aberration'])
        .optional().default('beast').describe('Monster type'),
      base_hp: z.number().int().min(10).max(200).optional().default(30).describe('Base HP'),
      base_strength: z.number().int().min(1).max(20).optional().default(5).describe('Base STR'),
      base_dexterity: z.number().int().min(1).max(20).optional().default(5).describe('Base DEX'),
      base_constitution: z.number().int().min(1).max(20).optional().default(5).describe('Base CON'),
      base_damage_bonus: z.number().int().min(0).max(10).optional().default(0).describe('Base damage bonus'),
      base_defense_bonus: z.number().int().min(0).max(10).optional().default(0).describe('Base defense bonus'),
      min_danger_level: z.number().int().min(1).max(10).optional().default(1).describe('Minimum danger level to spawn'),
      max_danger_level: z.number().int().min(1).max(10).optional().default(10).describe('Maximum danger level to spawn'),
      xp_reward: z.number().int().min(5).max(200).optional().default(25).describe('Base XP reward'),
      gold_min: z.number().int().min(0).max(500).optional().default(0).describe('Minimum gold drop'),
      gold_max: z.number().int().min(0).max(1000).optional().default(10).describe('Maximum gold drop'),
      loot_table: z.string().optional().default('[]').describe('JSON array of loot entries'),
    },
    async ({ token, name, description, monster_type, base_hp, base_strength, base_dexterity, base_constitution, base_damage_bonus, base_defense_bonus, min_danger_level, max_danger_level, xp_reward, gold_min, gold_max, loot_table }) => {
      try {
        const player = authenticate(token);
        const chunk = getChunk(player.chunk_x, player.chunk_y);
        if (!chunk) return { content: [{ type: 'text', text: 'You are in a void. Cannot create monsters here.' }] };

        const sanitizedName = sanitizeHtml(name);
        const sanitizedDescription = sanitizeHtml(description);

        if (min_danger_level > max_danger_level) {
          return { content: [{ type: 'text', text: 'min_danger_level cannot be greater than max_danger_level.' }] };
        }
        if (gold_min > gold_max) {
          return { content: [{ type: 'text', text: 'gold_min cannot be greater than gold_max.' }] };
        }

        // Validate loot_table JSON
        try {
          JSON.parse(loot_table);
        } catch {
          return { content: [{ type: 'text', text: 'loot_table must be valid JSON array.' }] };
        }

        // Balance formula: cap rewards based on monster difficulty to prevent
        // gold printer exploits (e.g. HP=10, STR=1 but gold_drop=100, xp=200).
        const difficultyScore =
          (base_hp / 10) * 0.3 +
          base_strength * 0.25 +
          (base_defense_bonus || 0) * 0.25 +
          (base_dexterity || 0) * 0.2;
        const maxGoldDrop = Math.ceil(difficultyScore * 3);
        const maxXpReward = Math.ceil(difficultyScore * 5);

        const clampedGoldMin = Math.min(gold_min, maxGoldDrop);
        const clampedGoldMax = Math.min(gold_max, maxGoldDrop);
        const clampedXpReward = Math.min(xp_reward, maxXpReward);

        const template = createMonsterTemplate({
          name: sanitizedName,
          description: sanitizedDescription,
          monster_type,
          base_hp,
          base_strength,
          base_dexterity,
          base_constitution,
          base_damage_bonus,
          base_defense_bonus,
          min_danger_level,
          max_danger_level,
          xp_reward: clampedXpReward,
          gold_min: clampedGoldMin,
          gold_max: clampedGoldMax,
          loot_table,
          chunk_x: player.chunk_x,
          chunk_y: player.chunk_y,
          location_id: player.location_id,
          created_by: player.id,
        });

        logEvent('monster_template_created', player.id, null, player.chunk_x, player.chunk_y, player.location_id, {
          template_id: template.id,
          monster_name: name,
        });

        const wasClamped =
          gold_min > maxGoldDrop || gold_max > maxGoldDrop || xp_reward > maxXpReward;
        const clampNote = wasClamped
          ? `\n⚠️ Rewards were capped to match difficulty (max gold: ${maxGoldDrop}, max XP: ${maxXpReward}).`
          : '';

        return {
          content: [{
            type: 'text',
            text: `Monster template created: ${template.name} (${template.monster_type})\nHP: ${template.base_hp} | STR: ${template.base_strength} | DEX: ${template.base_dexterity} | CON: ${template.base_constitution}\nDanger range: ${template.min_danger_level}-${template.max_danger_level} | XP: ${template.xp_reward} | Gold: ${template.gold_min}-${template.gold_max}g\nTemplate ID: ${template.id}${clampNote}`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'my_monsters',
    'List your created monster templates.',
    {
      token: z.string().uuid().describe('Your auth token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const templates = getTemplatesByCreator(player.id);

        if (templates.length === 0) {
          return { content: [{ type: 'text', text: 'You have not created any monster templates yet. Use `submit_monster` to create one.' }] };
        }

        const lines = [`Your monster templates (${templates.length}):`];
        for (const t of templates) {
          lines.push(`  [${t.id}] ${t.name} (${t.monster_type}) @ (${t.chunk_x},${t.chunk_y})${t.location_id ? ` loc:${t.location_id}` : ''}`);
          lines.push(`    HP:${t.base_hp} STR:${t.base_strength} DEX:${t.base_dexterity} CON:${t.base_constitution} | Danger:${t.min_danger_level}-${t.max_danger_level} | XP:${t.xp_reward} | Gold:${t.gold_min}-${t.gold_max}g`);
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );
}
