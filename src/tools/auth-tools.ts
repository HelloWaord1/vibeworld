import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createPlayer, loginPlayer, isNameTakenByAlive, updatePlayerPosition } from '../models/player.js';
import { logEvent } from '../models/event-log.js';
import { isWorldFull, getRandomOpenChunk } from '../models/nation.js';
import { getChunk } from '../models/chunk.js';
import { getPlayerById } from '../models/player.js';
import { generateTutorialQuests } from '../game/quests.js';

export function registerAuthTools(server: McpServer): void {
  server.tool(
    'register',
    'Register a new character in VibeWorld. Returns a token for authentication.',
    {
      name: z.string().min(2).max(24).regex(/^[a-zA-Z0-9_ -]+$/, 'Name must contain only letters, numbers, spaces, underscores, and hyphens.').describe('Character name (2-24 chars, alphanumeric + _ - space)'),
      password: z.string().min(6).max(64).describe('Password for the account (min 6 chars)'),
    },
    async ({ name, password }) => {
      try {
        if (isNameTakenByAlive(name)) {
          return { content: [{ type: 'text', text: `Name "${name}" is already taken by a living character. Choose another.` }] };
        }
        const player = createPlayer(name, password);

        // If world is full, spawn as citizen in a random open chunk
        let spawnX = 0;
        let spawnY = 0;
        let spawnInfo = 'You start at The Nexus (0,0)';

        if (isWorldFull()) {
          const openChunk = getRandomOpenChunk();
          if (openChunk) {
            spawnX = openChunk.x;
            spawnY = openChunk.y;
            updatePlayerPosition(player.id, spawnX, spawnY, null);
            const chunk = getChunk(spawnX, spawnY);
            spawnInfo = `The world is full. You were born in ${chunk?.name || 'an unknown land'} (${spawnX},${spawnY}) as a citizen`;
          }
        }

        // Generate tutorial quests for new player
        generateTutorialQuests(player.id);

        logEvent('register', player.id, null, spawnX, spawnY, null, { name });
        return {
          content: [{
            type: 'text',
            text: `Welcome to VibeWorld, ${player.name}!\n\nYour token: ${player.token}\n\n${spawnInfo} with ${player.gold} gold.\nUse this token in all subsequent commands.\n\nTip: Use \`look\` to see your surroundings. Check your tutorial quests with \`daily_quests\` to get started!`
          }]
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Registration failed: ${e.message}` }] };
      }
    }
  );

  server.tool(
    'login',
    'Login to an existing character. Returns a fresh token.',
    {
      name: z.string().describe('Character name'),
      password: z.string().describe('Password'),
    },
    async ({ name, password }) => {
      const player = loginPlayer(name, password);
      if (!player) {
        return { content: [{ type: 'text', text: 'Login failed. Wrong name/password or character is dead.' }] };
      }
      logEvent('login', player.id, null, player.chunk_x, player.chunk_y, player.location_id);
      return {
        content: [{
          type: 'text',
          text: `Welcome back, ${player.name}!\n\nYour token: ${player.token}\nHP: ${player.hp}/${player.max_hp} | Level ${player.level} | Gold: ${player.gold}\nLocation: chunk (${player.chunk_x},${player.chunk_y})`
        }]
      };
    }
  );
}
