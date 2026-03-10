import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { getPlayerByName, updatePlayerGold, getPlayerById } from '../models/player.js';
import { createTrade, getTradeById, getPendingTradesForPlayer, updateTradeStatus } from '../models/trade.js';
import { getItemById, getItemsByOwner, transferToPlayer } from '../models/item.js';
import { logEvent } from '../models/event-log.js';
import { getDb } from '../db/connection.js';
import { applyTax } from '../game/tax.js';
import { enforceCooldown, COOLDOWNS } from '../server/cooldown.js';
import { incrementQuestProgress } from '../models/quest.js';
import { checkAndUnlock } from '../models/achievement.js';

export function registerEconomyTools(server: McpServer): void {
  server.tool(
    'trade_offer',
    'Offer a trade to another player in the same chunk. Specify items and/or gold.',
    {
      token: z.string().uuid().describe('Your auth token'),
      to: z.string().describe('Name of the player to trade with'),
      offer_items: z.array(z.number().int()).optional().default([]).describe('Item IDs you are offering'),
      offer_gold: z.number().int().min(0).optional().default(0).describe('Gold you are offering'),
      request_items: z.array(z.number().int()).optional().default([]).describe('Item IDs you want from them'),
      request_gold: z.number().int().min(0).optional().default(0).describe('Gold you want from them'),
    },
    async ({ token, to, offer_items, offer_gold, request_items, request_gold }) => {
      try {
        const player = authenticate(token);
        const cd = enforceCooldown(player.id, 'trade_offer', COOLDOWNS.TRADE_OFFER);
        if (cd !== null) return { content: [{ type: 'text', text: `Please wait ${cd}s before sending another trade offer.` }] };
        const target = getPlayerByName(to);
        if (!target) return { content: [{ type: 'text', text: `Player "${to}" not found.` }] };
        if (target.id === player.id) {
          return { content: [{ type: 'text', text: 'You cannot trade with yourself.' }] };
        }
        if (target.chunk_x !== player.chunk_x || target.chunk_y !== player.chunk_y) {
          return { content: [{ type: 'text', text: 'You must be in the same chunk to trade.' }] };
        }

        // Validate offered items belong to player
        for (const id of offer_items) {
          const item = getItemById(id);
          if (!item || item.owner_id !== player.id) {
            return { content: [{ type: 'text', text: `You don't own item ${id}.` }] };
          }
        }

        // Validate requested items belong to target
        for (const id of request_items) {
          const item = getItemById(id);
          if (!item || item.owner_id !== target.id) {
            return { content: [{ type: 'text', text: `${target.name} doesn't own item ${id}.` }] };
          }
        }

        if (offer_gold > player.gold) {
          return { content: [{ type: 'text', text: `You only have ${player.gold} gold.` }] };
        }

        const trade = createTrade(player.id, target.id, offer_items, offer_gold, request_items, request_gold);
        logEvent('trade_offer', player.id, target.id, player.chunk_x, player.chunk_y, player.location_id, { trade_id: trade.id });

        const offerDesc = [];
        if (offer_items.length) offerDesc.push(`items: [${offer_items.join(', ')}]`);
        if (offer_gold > 0) offerDesc.push(`${offer_gold}g`);
        const requestDesc = [];
        if (request_items.length) requestDesc.push(`items: [${request_items.join(', ')}]`);
        if (request_gold > 0) requestDesc.push(`${request_gold}g`);

        return {
          content: [{
            type: 'text',
            text: `📦 Trade offer #${trade.id} sent to ${target.name}\nOffering: ${offerDesc.join(', ') || 'nothing'}\nRequesting: ${requestDesc.join(', ') || 'nothing'}\n\n${target.name} must use \`trade_accept\` or \`trade_reject\` with trade_id ${trade.id}.`
          }]
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'trade_accept',
    'Accept a pending trade offer.',
    {
      token: z.string().uuid().describe('Your auth token'),
      trade_id: z.number().int().describe('Trade ID to accept'),
    },
    async ({ token, trade_id }) => {
      try {
        const player = authenticate(token);
        const trade = getTradeById(trade_id);
        if (!trade) return { content: [{ type: 'text', text: 'Trade not found.' }] };
        if (trade.to_id !== player.id) return { content: [{ type: 'text', text: 'This trade is not for you.' }] };
        if (trade.status !== 'pending') return { content: [{ type: 'text', text: `Trade already ${trade.status}.` }] };

        const offerItems: number[] = JSON.parse(trade.offer_items);
        const requestItems: number[] = JSON.parse(trade.request_items);

        // All validation + execution inside transaction to prevent race conditions
        const db = getDb();
        let senderName = '';
        const executeTrade = db.transaction(() => {
          // Fresh reads inside transaction
          const freshSender = db.prepare('SELECT * FROM players WHERE id = ? AND is_alive = 1').get(trade.from_id) as any;
          if (!freshSender) throw new Error('Sender is no longer available.');
          senderName = freshSender.name;

          const freshPlayer = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id) as any;

          // Validate items still owned by correct parties
          for (const id of offerItems) {
            const item = getItemById(id);
            if (!item || item.owner_id !== freshSender.id) {
              updateTradeStatus(trade_id, 'rejected');
              throw new Error('Trade invalid — sender no longer has offered items.');
            }
          }
          for (const id of requestItems) {
            const item = getItemById(id);
            if (!item || item.owner_id !== freshPlayer.id) {
              updateTradeStatus(trade_id, 'rejected');
              throw new Error('Trade invalid — you no longer have requested items.');
            }
          }
          if (trade.offer_gold > freshSender.gold || trade.request_gold > freshPlayer.gold) {
            updateTradeStatus(trade_id, 'rejected');
            throw new Error('Trade invalid — insufficient gold.');
          }

          // Transfer items
          for (const id of offerItems) transferToPlayer(id, player.id);
          for (const id of requestItems) transferToPlayer(id, freshSender.id);

          // Apply taxes on gold using relative SQL updates
          if (trade.offer_gold > 0) {
            const offerTax = applyTax(trade.offer_gold, player.chunk_x, player.chunk_y);
            db.prepare('UPDATE players SET gold = gold - ? WHERE id = ?').run(trade.offer_gold, freshSender.id);
            db.prepare('UPDATE players SET gold = min(gold + ?, 10000000) WHERE id = ?').run(offerTax.netAmount, freshPlayer.id);
          }

          if (trade.request_gold > 0) {
            const requestTax = applyTax(trade.request_gold, player.chunk_x, player.chunk_y);
            db.prepare('UPDATE players SET gold = gold - ? WHERE id = ?').run(trade.request_gold, freshPlayer.id);
            db.prepare('UPDATE players SET gold = min(gold + ?, 10000000) WHERE id = ?').run(requestTax.netAmount, freshSender.id);
          }

          updateTradeStatus(trade_id, 'accepted');
          logEvent('trade_complete', player.id, freshSender.id, player.chunk_x, player.chunk_y, player.location_id, { trade_id });
        });
        executeTrade();

        // Update trade quest progress for both parties
        incrementQuestProgress(player.id, 'trade', 1);
        incrementQuestProgress(trade.from_id, 'trade', 1);

        // Check trader achievement for both parties
        checkAndUnlock(player.id, 'trader');
        checkAndUnlock(trade.from_id, 'trader');

        return { content: [{ type: 'text', text: `✅ Trade #${trade_id} completed with ${senderName}! (2.8% platform tax + chunk tax applied on gold)` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'trade_reject',
    'Reject a pending trade offer.',
    {
      token: z.string().uuid().describe('Your auth token'),
      trade_id: z.number().int().describe('Trade ID to reject'),
    },
    async ({ token, trade_id }) => {
      try {
        const player = authenticate(token);
        const trade = getTradeById(trade_id);
        if (!trade) return { content: [{ type: 'text', text: 'Trade not found.' }] };
        if (trade.to_id !== player.id && trade.from_id !== player.id) {
          return { content: [{ type: 'text', text: 'This trade is not yours.' }] };
        }
        if (trade.status !== 'pending') return { content: [{ type: 'text', text: `Trade already ${trade.status}.` }] };

        updateTradeStatus(trade_id, 'rejected');
        return { content: [{ type: 'text', text: `❌ Trade #${trade_id} rejected.` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );
}
