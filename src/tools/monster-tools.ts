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
        .optional().describe('Monster type (default: beast)'),
      base_hp: z.number().int().min(10).max(500).optional().describe('Base HP (default: 30, max scales with danger)'),
      base_strength: z.number().int().min(3).max(40).optional().describe('Base STR (default: 5, max scales with danger)'),
      base_dexterity: z.number().int().min(3).max(40).optional().describe('Base DEX (default: 5, max scales with danger)'),
      base_constitution: z.number().int().min(3).max(40).optional().describe('Base CON (default: 5, max scales with danger)'),
      base_damage_bonus: z.number().int().min(0).max(10).optional().describe('Base damage bonus (default: 0)'),
      base_defense_bonus: z.number().int().min(0).max(10).optional().describe('Base defense bonus (default: 0)'),
      min_danger_level: z.number().int().min(1).max(10).optional().describe('Minimum danger level to spawn (default: 1)'),
      max_danger_level: z.number().int().min(1).max(10).optional().describe('Maximum danger level to spawn (default: 10)'),
      xp_reward: z.number().int().min(5).max(250).optional().describe('Base XP reward (auto-calculated from stats if omitted)'),
      gold_min: z.number().int().min(0).max(200).optional().describe('Minimum gold drop (default: 0)'),
      gold_max: z.number().int().min(0).max(200).optional().describe('Maximum gold drop (default: 10)'),
      loot_table: z.string().optional().describe('JSON array of loot entries (default: [])'),
    },
    async ({ token, name, description, monster_type: rawMonsterType, base_hp: rawHp, base_strength: rawStr, base_dexterity: rawDex, base_constitution: rawCon, base_damage_bonus: rawDmg, base_defense_bonus: rawDef, min_danger_level: rawMinDanger, max_danger_level: rawMaxDanger, xp_reward: rawXp, gold_min: rawGoldMin, gold_max: rawGoldMax, loot_table: rawLootTable }) => {
      try {
        const player = authenticate(token);
        const chunk = getChunk(player.chunk_x, player.chunk_y);
        if (!chunk) return { content: [{ type: 'text', text: 'You are in a void. Cannot create monsters here.' }] };

        const sanitizedName = sanitizeHtml(name);
        const sanitizedDescription = sanitizeHtml(description);
        const danger = chunk.danger_level;

        // Apply defaults for omitted fields
        const monster_type = rawMonsterType ?? 'beast';
        const min_danger_level = rawMinDanger ?? 1;
        const max_danger_level = rawMaxDanger ?? 10;
        const base_damage_bonus = rawDmg ?? 0;
        const base_defense_bonus = rawDef ?? 0;
        const loot_table = rawLootTable ?? '[]';

        // Danger-scaled caps for stats
        const hpCap = Math.max(50, danger * 50);       // danger 1 = 50, danger 10 = 500
        const statCap = Math.max(6, 3 + danger * 3);   // danger 1 = 6, danger 10 = 33
        const xpCap = Math.max(25, danger * 25);        // danger 1 = 25, danger 10 = 250
        const goldCap = Math.max(10, danger * 20);      // danger 1 = 20, danger 10 = 200

        // Apply user values with danger-based clamping (min floors from Zod still apply)
        const base_hp = Math.min(rawHp ?? 30, hpCap);
        const base_strength = Math.min(rawStr ?? 5, statCap);
        const base_dexterity = Math.min(rawDex ?? 5, statCap);
        const base_constitution = Math.min(rawCon ?? 5, statCap);

        if (min_danger_level > max_danger_level) {
          return { content: [{ type: 'text', text: 'min_danger_level cannot be greater than max_danger_level.' }] };
        }

        // Validate loot_table JSON
        try {
          JSON.parse(loot_table);
        } catch {
          return { content: [{ type: 'text', text: 'loot_table must be valid JSON array.' }] };
        }

        // Auto-calculate XP from stats if not provided, otherwise cap at danger-based max
        const calculatedXp = Math.ceil(
          (base_hp / 10) * 0.3 +
          base_strength * 0.25 +
          base_defense_bonus * 0.25 +
          base_dexterity * 0.2
        ) * 5;
        const xp_reward = Math.max(5, Math.min(rawXp ?? calculatedXp, xpCap));

        // Clamp gold drops: user values respected within danger-based cap
        const gold_min = Math.min(rawGoldMin ?? 0, goldCap);
        const gold_max = Math.min(rawGoldMax ?? 10, goldCap);

        // Ensure gold_min <= gold_max after clamping
        const finalGoldMin = Math.min(gold_min, gold_max);

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
          xp_reward,
          gold_min: finalGoldMin,
          gold_max,
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

        const warnings: string[] = [];
        if (rawHp !== undefined && rawHp > hpCap) warnings.push(`HP capped: ${rawHp} -> ${base_hp} (danger ${danger} max: ${hpCap})`);
        if (rawStr !== undefined && rawStr > statCap) warnings.push(`STR capped: ${rawStr} -> ${base_strength} (max: ${statCap})`);
        if (rawDex !== undefined && rawDex > statCap) warnings.push(`DEX capped: ${rawDex} -> ${base_dexterity} (max: ${statCap})`);
        if (rawCon !== undefined && rawCon > statCap) warnings.push(`CON capped: ${rawCon} -> ${base_constitution} (max: ${statCap})`);
        if (rawXp !== undefined && rawXp > xpCap) warnings.push(`XP capped: ${rawXp} -> ${xp_reward} (max: ${xpCap})`);
        if (rawGoldMax !== undefined && rawGoldMax > goldCap) warnings.push(`Gold max capped: ${rawGoldMax} -> ${gold_max} (max: ${goldCap})`);
        const clampNote = warnings.length > 0
          ? '\n-- Adjusted for chunk danger level ' + danger + ': ' + warnings.join('; ')
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
