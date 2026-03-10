import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { createChunk, getChunk, releaseLock, getLock, getAdjacentChunks } from '../models/chunk.js';
import { createLocation, getLocationsInChunk } from '../models/location.js';
import { getLocationById } from '../models/location.js';
import { updatePlayerPosition, getPlayerById, updatePlayerGold } from '../models/player.js';
import { logEvent } from '../models/event-log.js';
import { isValidChunkCoord } from '../game/world-rules.js';
import { isWorldFull, addChunkRevenue } from '../models/nation.js';
import { MAX_CHUNKS, MAX_LOCATIONS_PER_CHUNK, MAX_LOCATION_DEPTH_ENFORCED, LOCATION_BASE_COST } from '../types/index.js';
import { getDb } from '../db/connection.js';
import { awardExploreXp, awardCraftLocationXp } from '../game/xp-rewards.js';
import { validateContent, sanitizeHtml } from '../utils/content-filter.js';

export function registerChunkTools(server: McpServer): void {
  server.tool(
    'submit_chunk',
    'Submit a newly generated chunk. You must hold the creation lock (from a `move` to an empty chunk).',
    {
      token: z.string().uuid().describe('Your auth token'),
      x: z.number().int().min(-99).max(99).describe('Chunk X coordinate'),
      y: z.number().int().min(-99).max(99).describe('Chunk Y coordinate'),
      name: z.string().min(2).max(100).describe('Chunk name'),
      description: z.string().min(10).max(2000).describe('Chunk description'),
      terrain_type: z.string().min(2).max(50).describe('Terrain type (e.g. forest, desert, city)'),
      danger_level: z.number().int().min(1).max(10).describe('Danger level 1-10'),
      theme_tags: z.array(z.string().max(30)).max(10).optional().default([]).describe('Theme tags (max 30 chars each)'),
    },
    async ({ token, x, y, name, description, terrain_type, danger_level, theme_tags }) => {
      try {
        const player = authenticate(token);

        // Content moderation
        const sanitizedName = sanitizeHtml(name);
        const sanitizedDescription = sanitizeHtml(description);
        const sanitizedTerrainType = sanitizeHtml(terrain_type);
        const sanitizedThemeTags = theme_tags.map(tag => sanitizeHtml(tag));

        validateContent(sanitizedName, 'chunk name');
        validateContent(sanitizedDescription, 'chunk description');
        validateContent(sanitizedTerrainType, 'terrain type');
        for (const tag of sanitizedThemeTags) {
          validateContent(tag, 'theme tag');
        }

        if (!isValidChunkCoord(x, y)) {
          return { content: [{ type: 'text', text: 'Invalid coordinates (must be -99 to 99).' }] };
        }

        // Check world capacity
        if (isWorldFull()) {
          releaseLock(x, y);
          return { content: [{ type: 'text', text: `The world is full (${MAX_CHUNKS} nation-states). No more chunks can be created.` }] };
        }

        // Check lock ownership
        const lock = getLock(x, y);
        if (!lock || lock.locked_by !== player.id) {
          return { content: [{ type: 'text', text: 'You do not hold the creation lock for this chunk. Move to it first.' }] };
        }

        // Check not already exists
        if (getChunk(x, y)) {
          releaseLock(x, y);
          return { content: [{ type: 'text', text: 'This chunk already exists.' }] };
        }

        // Check adjacency (must be adjacent to an existing chunk, or be 0,0)
        if (!(x === 0 && y === 0)) {
          const adjacent = getAdjacentChunks(x, y);
          if (adjacent.length === 0) {
            releaseLock(x, y);
            return { content: [{ type: 'text', text: 'Chunk must be adjacent to an existing chunk.' }] };
          }
        }

        // Enforce max danger level based on distance from Nexus (0,0)
        const distance = Math.abs(x) + Math.abs(y);
        const maxDanger = Math.min(10, Math.floor(distance / 2) + 3);
        const clampedDangerLevel = Math.min(danger_level, maxDanger);

        const chunk = createChunk(x, y, sanitizedName, sanitizedDescription, sanitizedTerrainType, clampedDangerLevel, sanitizedThemeTags, player.id);
        releaseLock(x, y);

        // Move player to new chunk
        updatePlayerPosition(player.id, x, y, null);

        logEvent('chunk_created', player.id, null, x, y, null, { name, terrain_type, danger_level });

        // Award explore XP and mark chunk as visited (prevents double-award on return)
        const xpResult = awardExploreXp(player.id);
        const db2 = getDb();
        db2.prepare(
          "INSERT INTO event_log (event_type, actor_id, chunk_x, chunk_y, data) VALUES ('chunk_explore', ?, ?, ?, '{}')"
        ).run(player.id, x, y);

        let resultText = `✨ Chunk created: ${chunk.name} (${x},${y})\n${chunk.description}\nTerrain: ${chunk.terrain_type} | Danger: ${'⚠️'.repeat(chunk.danger_level)}\n\nYou have moved to this new chunk.\n+${xpResult.xp} XP (new territory!)`;
        if (xpResult.leveled_up) {
          resultText += ` LEVEL UP! You are now level ${xpResult.new_level}.`;
        }

        return {
          content: [{
            type: 'text',
            text: resultText,
          }]
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Failed: ${e.message}` }] };
      }
    }
  );

  server.tool(
    'submit_location',
    'Create a new sub-location inside your current chunk. Others will be able to enter it.',
    {
      token: z.string().uuid().describe('Your auth token'),
      parent_id: z.number().int().nullable().optional().default(null).describe('Parent location ID (null for chunk-level)'),
      name: z.string().min(2).max(100).describe('Location name'),
      description: z.string().min(10).max(2000).describe('Location description'),
      location_type: z.string().min(2).max(50).optional().default('room').describe('Type (tavern, shop, dungeon, room, etc)'),
      is_hidden: z.boolean().optional().default(false).describe('Whether this location is hidden'),
      discovery_dc: z.number().int().min(5).max(25).optional().default(10).describe('DC to discover (if hidden, 5-25)'),
      is_shop: z.boolean().optional().default(false).describe('Whether this is a shop (items require buying)'),
      required_key_id: z.number().int().nullable().optional().default(null).describe('Item ID of key required to enter (null = no key needed)'),
    },
    async ({ token, parent_id, name, description, location_type, is_hidden, discovery_dc, is_shop, required_key_id }) => {
      try {
        const player = authenticate(token);

        // Content moderation
        const sanitizedName = sanitizeHtml(name);
        const sanitizedDescription = sanitizeHtml(description);
        validateContent(sanitizedName, 'location name');
        validateContent(sanitizedDescription, 'location description');

        // Check build policy
        const buildChunk = getChunk(player.chunk_x, player.chunk_y);
        if (buildChunk && buildChunk.ruler_id !== null && buildChunk.ruler_id !== player.id) {
          if (buildChunk.build_policy === 'closed' || buildChunk.build_policy === 'permit') {
            return { content: [{ type: 'text', text: `Building is not allowed in ${buildChunk.name}. The ruler has restricted construction.` }] };
          }
          // 'citizens' = anyone currently in the chunk can build (effectively 'free' since you must be here)
          // 'free' = anyone can build
          if (buildChunk.build_policy === 'fee' && buildChunk.build_fee > 0) {
            if (player.gold < buildChunk.build_fee) {
              return { content: [{ type: 'text', text: `Building in ${buildChunk.name} requires a ${buildChunk.build_fee}g fee. You have ${player.gold}g.` }] };
            }
            updatePlayerGold(player.id, player.gold - buildChunk.build_fee);
            if (buildChunk.ruler_id) {
              const ruler = getPlayerById(buildChunk.ruler_id);
              if (ruler) {
                updatePlayerGold(buildChunk.ruler_id, ruler.gold + buildChunk.build_fee);
              }
            }
            addChunkRevenue(player.chunk_x, player.chunk_y, buildChunk.build_fee);
          }
        }

        // If parent_id specified, validate it
        if (parent_id !== null) {
          const parent = getLocationById(parent_id);
          if (!parent) return { content: [{ type: 'text', text: 'Parent location not found.' }] };
          if (parent.chunk_x !== player.chunk_x || parent.chunk_y !== player.chunk_y) {
            return { content: [{ type: 'text', text: 'Parent location must be in your current chunk.' }] };
          }
          // Player must be in the parent location
          if (player.location_id !== parent_id) {
            return { content: [{ type: 'text', text: 'You must be inside the parent location to create a sub-location.' }] };
          }
          // Enforce depth limit
          if (parent.depth >= MAX_LOCATION_DEPTH_ENFORCED) {
            return { content: [{ type: 'text', text: `Maximum nesting depth is ${MAX_LOCATION_DEPTH_ENFORCED}. Cannot create deeper locations.` }] };
          }
        } else {
          // Must be at chunk level (not inside a location)
          if (player.location_id !== null) {
            return { content: [{ type: 'text', text: 'You must be at chunk level (outside) to create a top-level location. Use `exit` first, or specify a parent_id.' }] };
          }

          // Enforce max top-level locations per chunk
          const existingLocations = getLocationsInChunk(player.chunk_x, player.chunk_y, null);
          if (existingLocations.length >= MAX_LOCATIONS_PER_CHUNK) {
            return { content: [{ type: 'text', text: `This chunk already has ${MAX_LOCATIONS_PER_CHUNK} top-level locations. Demolish something first or build inside an existing location.` }] };
          }
        }

        // Calculate building cost: base + depth surcharge + optional modifiers
        const depth = parent_id !== null
          ? (getLocationById(parent_id)!.depth + 1)
          : 1;
        let buildCost = LOCATION_BASE_COST + (depth * 10);
        if (is_shop) buildCost += 25;
        if (is_hidden) buildCost += 15;

        // Re-read player gold in case build policy fee was deducted above
        const currentPlayer = getPlayerById(player.id)!;
        if (currentPlayer.gold < buildCost) {
          return { content: [{ type: 'text', text: `Building a location costs ${buildCost}g (base ${LOCATION_BASE_COST}g + ${depth * 10}g depth${is_shop ? ' + 25g shop' : ''}${is_hidden ? ' + 15g hidden' : ''}). You have ${currentPlayer.gold}g.` }] };
        }
        updatePlayerGold(player.id, currentPlayer.gold - buildCost);

        const loc = createLocation(
          player.chunk_x, player.chunk_y, parent_id,
          sanitizedName, sanitizedDescription, location_type,
          is_hidden, discovery_dc, is_shop, required_key_id, player.id
        );

        logEvent('location_created', player.id, null, player.chunk_x, player.chunk_y, loc.id, { name, location_type, is_hidden });

        const xpResult = awardCraftLocationXp(player.id);

        let resultText = `📍 Location created: ${loc.name} [${loc.id}] (cost: ${buildCost}g)\n${loc.description}\nType: ${loc.location_type} | Depth: ${loc.depth}${loc.is_hidden ? ` | Hidden (DC ${loc.discovery_dc})` : ''}\n+${xpResult.xp} XP (building!)`;
        if (xpResult.leveled_up) {
          resultText += ` LEVEL UP! You are now level ${xpResult.new_level}.`;
        }
        resultText += '\n\nOther players can now enter this location.';

        return {
          content: [{
            type: 'text',
            text: resultText,
          }]
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Failed: ${e.message}` }] };
      }
    }
  );
}
