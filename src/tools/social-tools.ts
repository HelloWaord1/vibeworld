import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { createMessage, getRecentMessages } from '../models/message.js';
import { getPlayerByName, getPlayersAtChunk } from '../models/player.js';
import { getPlayerById } from '../models/player.js';
import { getDb } from '../db/connection.js';
import type { Player, NpcDialogue } from '../types/index.js';
import { enforceCooldown, COOLDOWNS } from '../server/cooldown.js';
import { validateContent, sanitizeHtml } from '../utils/content-filter.js';
import { checkMuted } from './admin-tools.js';
import { getNpcsAtLocation, getNpcByName } from '../models/npc.js';

/** Check if blockerId has blocked blockedId. */
function isBlocked(blockerId: number, blockedId: number): boolean {
  const db = getDb();
  return !!db.prepare(
    'SELECT 1 FROM player_blocks WHERE blocker_id = ? AND blocked_id = ?',
  ).get(blockerId, blockedId);
}

/** Strip control characters that break JSON parsing on the client side. */
const sanitizedMessage = z.string().min(1).max(500)
  .transform(s => s.replace(/[\x00-\x1f]/g, ''));

export function registerSocialTools(server: McpServer): void {
  // ---------- Chat ----------

  server.tool(
    'say',
    'Say something to everyone in your chunk. Visible to all players here.',
    {
      token: z.string().uuid().describe('Your auth token'),
      message: sanitizedMessage.describe('What you want to say'),
    },
    async ({ token, message: msg }) => {
      try {
        const player = authenticate(token);
        checkMuted(player.id);
        const sanitized = sanitizeHtml(msg);
        validateContent(sanitized, 'message');
        const cd = enforceCooldown(player.id, 'say', COOLDOWNS.SAY);
        if (cd !== null) return { content: [{ type: 'text', text: `Please wait ${cd}s before sending another message.` }] };
        createMessage(player.id, null, player.chunk_x, player.chunk_y, sanitized);
        return { content: [{ type: 'text', text: `${player.name} says: "${sanitized}"` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'whisper',
    'Send a private message to any player in the world.',
    {
      token: z.string().uuid().describe('Your auth token'),
      to: z.string().describe('Name of the recipient'),
      message: sanitizedMessage.describe('Private message'),
    },
    async ({ token, to, message: msg }) => {
      try {
        const player = authenticate(token);
        checkMuted(player.id);
        const sanitized = sanitizeHtml(msg);
        validateContent(sanitized, 'message');
        const cd = enforceCooldown(player.id, 'say', COOLDOWNS.SAY);
        if (cd !== null) return { content: [{ type: 'text', text: `Please wait ${cd}s before sending another message.` }] };
        const target = getPlayerByName(to);
        if (!target) return { content: [{ type: 'text', text: `Player "${to}" not found.` }] };
        if (target.id === player.id) return { content: [{ type: 'text', text: 'You cannot whisper to yourself.' }] };

        if (isBlocked(target.id, player.id)) {
          return { content: [{ type: 'text', text: `${target.name} has blocked you.` }] };
        }

        const crossChunk = target.chunk_x !== player.chunk_x || target.chunk_y !== player.chunk_y;
        createMessage(player.id, target.id, player.chunk_x, player.chunk_y, sanitized, 'whisper');

        const suffix = crossChunk ? ' (sent across the world)' : '';
        return { content: [{ type: 'text', text: `You whisper to ${target.name}: "${sanitized}"${suffix}` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'check_messages',
    'Check recent messages in your chunk (public + your private messages).',
    { token: z.string().uuid().describe('Your auth token') },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const messages = getRecentMessages(player.chunk_x, player.chunk_y, player.id);

        // Filter out messages from players this user has blocked
        const filtered = messages.filter(m => !isBlocked(player.id, m.from_id));

        if (filtered.length === 0) {
          return { content: [{ type: 'text', text: 'No recent messages.' }] };
        }

        const parts = filtered.reverse().map(m => {
          const sender = getPlayerById(m.from_id);
          const senderName = sender?.name || 'Unknown';
          if (m.to_id) {
            const recipient = getPlayerById(m.to_id);
            const recipientName = recipient?.name || 'Unknown';
            if (m.to_id === player.id) {
              return `[whisper from ${senderName}]: ${m.content}`;
            }
            return `[whisper to ${recipientName}]: ${m.content}`;
          }
          return `${senderName}: ${m.content}`;
        });

        return { content: [{ type: 'text', text: `Recent messages:\n${parts.join('\n')}` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'who',
    'See who is online in the world or in your chunk.',
    { token: z.string().uuid().describe('Your auth token') },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const db = getDb();

        // Players in same chunk
        const here = getPlayersAtChunk(player.chunk_x, player.chunk_y, player.location_id)
          .filter(p => p.id !== player.id);

        // All online players (active in last 5 min)
        const online = db.prepare(`
          SELECT name, level, chunk_x, chunk_y FROM players
          WHERE is_alive = 1 AND last_active_at > datetime('now', '-5 minutes')
        `).all() as Pick<Player, 'name' | 'level' | 'chunk_x' | 'chunk_y'>[];

        const parts: string[] = [`Online players: ${online.length}`];
        if (here.length > 0) {
          parts.push(`\nHere with you:`);
          for (const p of here) parts.push(`  ${p.name} (Lv${p.level})`);
        }
        parts.push(`\nAll online:`);
        for (const p of online) {
          parts.push(`  ${p.name} (Lv${p.level}) @ (${p.chunk_x},${p.chunk_y})`);
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  // ---------- NPC Dialogue ----------

  server.tool(
    'talk',
    'Talk to an NPC at your location. Optionally specify a topic.',
    {
      token: z.string().uuid().describe('Your auth token'),
      npc_name: z.string().optional().describe('Name of the NPC (leave empty to list NPCs)'),
      topic: z.string().optional().describe('Topic to ask about (leave empty for greeting)'),
    },
    async ({ token, npc_name, topic }) => {
      try {
        const player = authenticate(token);
        const cd = enforceCooldown(player.id, 'talk', 3000);
        if (cd !== null) return { content: [{ type: 'text', text: `Please wait ${cd}s before talking again.` }] };

        const npcs = getNpcsAtLocation(player.chunk_x, player.chunk_y, player.location_id);

        if (!npc_name) {
          if (npcs.length === 0) {
            return { content: [{ type: 'text', text: 'There are no NPCs here to talk to.' }] };
          }
          const npcList = npcs.map(n => `${n.name} (${n.role})`).join(', ');
          return { content: [{ type: 'text', text: `NPCs here: ${npcList}\n\nUse talk with npc_name to speak to one.` }] };
        }

        if (player.location_id === null) {
          return { content: [{ type: 'text', text: 'NPCs are found inside locations. Use "enter" to go inside.' }] };
        }

        const npc = getNpcByName(npc_name, player.location_id);
        if (!npc) {
          return { content: [{ type: 'text', text: `NPC "${npc_name}" not found at your location.` }] };
        }

        if (!topic) {
          return { content: [{ type: 'text', text: `${npc.name}: "${npc.greeting}"` }] };
        }

        let dialogueOptions: NpcDialogue[] = [];
        try {
          dialogueOptions = JSON.parse(npc.dialogue);
        } catch {
          return { content: [{ type: 'text', text: `${npc.name}: "${npc.greeting}"` }] };
        }

        const match = dialogueOptions.find(d => d.topic.toLowerCase() === topic.toLowerCase());
        if (!match) {
          const availableTopics = dialogueOptions.map(d => d.topic).join(', ');
          return { content: [{ type: 'text', text: `${npc.name} doesn't have anything to say about "${topic}".\n\nAvailable topics: ${availableTopics}` }] };
        }

        return { content: [{ type: 'text', text: `${npc.name}: "${match.text}"` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  // ---------- Emotes ----------

  const PREDEFINED_EMOTES: Record<string, string> = {
    bow: 'bows respectfully.',
    wave: 'waves enthusiastically.',
    dance: 'breaks into an enthusiastic dance!',
    cheer: 'cheers loudly!',
    salute: 'salutes sharply.',
    laugh: 'laughs heartily.',
    cry: 'bursts into tears.',
    shrug: 'shrugs nonchalantly.',
    flex: 'flexes their muscles impressively.',
    meditate: 'sits cross-legged and meditates peacefully.',
  };

  server.tool(
    'emote',
    'Perform an emote action visible to everyone at your location.',
    {
      token: z.string().uuid().describe('Your auth token'),
      action: z.string().min(1).max(100).describe('Emote action (bow, wave, dance, etc. or custom text)'),
    },
    async ({ token, action }) => {
      try {
        const player = authenticate(token);
        const cd = enforceCooldown(player.id, 'emote', 5000);
        if (cd !== null) return { content: [{ type: 'text', text: `Please wait ${cd}s before emoting again.` }] };

        const actionLower = action.toLowerCase().trim();
        const emoteText = PREDEFINED_EMOTES[actionLower] || action;

        const message = `${player.name} ${emoteText}`;
        createMessage(player.id, null, player.chunk_x, player.chunk_y, message);

        return { content: [{ type: 'text', text: message }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );
}
