import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { getItemsByOwner, getItemById, transferToPlayer, dropAtLocation, equipItem, unequipItem, createItem } from '../models/item.js';
import { updatePlayerHp, updatePlayerGold, getPlayerById } from '../models/player.js';
import { getLocationById } from '../models/location.js';
import { logEvent } from '../models/event-log.js';
import { getDb } from '../db/connection.js';
import { MAX_INVENTORY_SIZE, PLATFORM_TAX_RATE, STAT_CAP, SELL_ITEM_VALUE_FRACTION } from '../types/index.js';
import { calculateTax, applyTax } from '../game/tax.js';
import { addLocationRevenue, addChunkRevenue } from '../models/nation.js';
import { incrementQuestProgress } from '../models/quest.js';
import { consumeBuff } from '../game/abilities.js';

export function registerInventoryTools(server: McpServer): void {
  server.tool(
    'inventory',
    'View your inventory (items and gold).',
    { token: z.string().uuid().describe('Your auth token') },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const items = getItemsByOwner(player.id);
        const parts: string[] = [`🎒 Inventory of ${player.name} | Gold: ${player.gold}`];

        if (items.length === 0) {
          parts.push('  (empty)');
        } else {
          for (const item of items) {
            const equipped = item.is_equipped ? ' [EQUIPPED]' : '';
            const stats: string[] = [];
            if (item.damage_bonus) stats.push(`+${item.damage_bonus} dmg`);
            if (item.defense_bonus) stats.push(`+${item.defense_bonus} def`);
            if (item.heal_amount) stats.push(`heals ${item.heal_amount}`);
            if (item.level_requirement > 0) stats.push(`req lv${item.level_requirement}`);
            let bonuses: Record<string, unknown> = {};
            try { bonuses = JSON.parse(item.stat_bonuses || '{}'); } catch {}
            for (const [k, v] of Object.entries(bonuses)) {
              if (v) stats.push(`+${v} ${k}`);
            }
            parts.push(`  [${item.id}] ${item.name} (${item.item_type}, ${item.rarity})${equipped} ${stats.join(', ')} — ${item.value}g`);
          }
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'pickup',
    'Pick up a free item from the ground. Cannot pick up shop items — use `buy_item` for those.',
    {
      token: z.string().uuid().describe('Your auth token'),
      item_id: z.number().int().describe('ID of the item to pick up'),
    },
    async ({ token, item_id }) => {
      try {
        const player = authenticate(token);
        const item = getItemById(item_id);
        if (!item) return { content: [{ type: 'text', text: 'Item not found.' }] };
        if (item.owner_id !== null) return { content: [{ type: 'text', text: 'That item belongs to someone.' }] };
        if (item.chunk_x !== player.chunk_x || item.chunk_y !== player.chunk_y) {
          return { content: [{ type: 'text', text: 'That item is not here.' }] };
        }
        if ((item.location_id ?? null) !== player.location_id) {
          return { content: [{ type: 'text', text: 'That item is not in your current location.' }] };
        }
        if (item.is_shop_item) {
          return { content: [{ type: 'text', text: `That item is for sale (${item.value}g). Use \`buy_item\` to purchase it.` }] };
        }

        // Inventory limit (currency bypasses since it converts to gold)
        if (item.item_type !== 'currency' && getItemsByOwner(player.id).length >= MAX_INVENTORY_SIZE) {
          return { content: [{ type: 'text', text: `Inventory full (${MAX_INVENTORY_SIZE} items max). Drop something first.` }] };
        }

        // Currency items add gold directly (with platform tax to prevent death tax evasion)
        if (item.item_type === 'currency') {
          const tax = Math.floor(item.value * PLATFORM_TAX_RATE);
          const netGold = item.value - tax;
          const db = getDb();
          db.prepare('UPDATE players SET gold = min(gold + ?, 10000000) WHERE id = ?').run(netGold, player.id);
          db.prepare('DELETE FROM items WHERE id = ?').run(item_id);
          const taxNote = tax > 0 ? ` (${tax}g tax)` : '';
          return { content: [{ type: 'text', text: `You pick up ${item.name} and gain ${netGold}g${taxNote}.` }] };
        }

        transferToPlayer(item_id, player.id);
        return { content: [{ type: 'text', text: `You pick up ${item.name}.` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'buy_item',
    'Buy an item from a shop. You must be in the same location as the item.',
    {
      token: z.string().uuid().describe('Your auth token'),
      item_id: z.number().int().describe('ID of the item to buy'),
    },
    async ({ token, item_id }) => {
      try {
        const player = authenticate(token);
        const item = getItemById(item_id);
        if (!item) return { content: [{ type: 'text', text: 'Item not found.' }] };
        if (item.owner_id !== null) return { content: [{ type: 'text', text: 'That item is not for sale.' }] };
        if (!item.is_shop_item) return { content: [{ type: 'text', text: 'That item is not a shop item. Use `pickup` instead.' }] };
        if (item.chunk_x !== player.chunk_x || item.chunk_y !== player.chunk_y) {
          return { content: [{ type: 'text', text: 'That item is not here.' }] };
        }
        if ((item.location_id ?? null) !== player.location_id) {
          return { content: [{ type: 'text', text: 'That item is not in your current location.' }] };
        }
        
        // Apply CHA discount: -1% per 3 CHA, cap 25%
        const chaDiscount = Math.min(0.25, player.charisma / 300);

        // Check for Bargain buff (50% off)
        const bargainBuff = consumeBuff(player.id, 'bargain');
        const bargainDiscount = bargainBuff ? bargainBuff.value : 0;

        const totalDiscount = Math.min(0.75, chaDiscount + bargainDiscount); // Cap at 75% discount
        const finalCost = Math.max(1, Math.floor(item.value * (1 - totalDiscount)));
        
        const taxInfo = calculateTax(finalCost, player.chunk_x, player.chunk_y);

        // Re-read fresh player gold to avoid stale data
        const freshPlayer = getPlayerById(player.id);
        if (!freshPlayer) return { content: [{ type: 'text', text: 'Player not found.' }] };
        if (freshPlayer.gold < finalCost) {
          return { content: [{ type: 'text', text: `Not enough gold. You have ${freshPlayer.gold}g, need ${finalCost}g.` }] };
        }
        if (getItemsByOwner(player.id).length >= MAX_INVENTORY_SIZE) {
          return { content: [{ type: 'text', text: `Inventory full (${MAX_INVENTORY_SIZE} items max). Drop something first.` }] };
        }

        // Atomic purchase: deduct gold, apply taxes, create item copy
        const db = getDb();
        const bought = db.transaction(() => {
          updatePlayerGold(player.id, freshPlayer.gold - finalCost);
          applyTax(finalCost, player.chunk_x, player.chunk_y);

          addChunkRevenue(player.chunk_x, player.chunk_y, finalCost);
          if (player.location_id !== null) {
            addLocationRevenue(player.location_id, finalCost);
          }

          return createItem(item.name, item.description, item.item_type as any, {
            damage_bonus: item.damage_bonus,
            defense_bonus: item.defense_bonus,
            stat_bonuses: (() => { try { return JSON.parse(item.stat_bonuses || '{}'); } catch { return {}; } })(),
            heal_amount: item.heal_amount,
            value: item.value,
            owner_id: player.id,
            rarity: item.rarity as any,
            level_requirement: item.level_requirement,
          });
        })();

        logEvent('buy', player.id, null, player.chunk_x, player.chunk_y, player.location_id, {
          item_name: item.name, cost: finalCost, original_cost: item.value,
          cha_discount: chaDiscount,
          bargain_discount: bargainDiscount,
          platform_tax: taxInfo.platformTax, chunk_tax: taxInfo.chunkTax,
        });

        // Track tutorial quest progress for buying an item
        incrementQuestProgress(player.id, 'buy_item', 1);

        const remainingGold = freshPlayer.gold - finalCost;
        const discountAmount = item.value - finalCost;
        let discountNote = '';
        if (bargainBuff) {
          discountNote = ` (BARGAIN: 50% off + CHA: ${discountAmount}g total discount from ${item.value}g)`;
        } else if (discountAmount > 0) {
          discountNote = ` (CHA discount: ${discountAmount}g off ${item.value}g)`;
        }
        const taxNote = taxInfo.platformTax > 0 || taxInfo.chunkTax > 0
          ? ` (tax: ${taxInfo.platformTax}g platform + ${taxInfo.chunkTax}g chunk)`
          : '';
        return { content: [{ type: 'text', text: `You buy ${item.name} for ${finalCost}g${discountNote}${taxNote}. Gold remaining: ${remainingGold}g` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'sell_item',
    'Sell an item from your inventory. You must be in a shop. Base sell price is 40% + CHA bonus (max 65%).',
    {
      token: z.string().uuid().describe('Your auth token'),
      item_id: z.number().int().describe('ID of the item to sell'),
    },
    async ({ token, item_id }) => {
      try {
        const player = authenticate(token);
        if (player.location_id === null) {
          return { content: [{ type: 'text', text: 'You must be inside a shop to sell items to an NPC vendor. Try entering a shop location first (use `look` to see nearby locations, then `enter` to go inside). Alternatively, you can sell to other players using `list_item` to post on the player marketplace.' }] };
        }
        const loc = getLocationById(player.location_id);
        if (!loc || !loc.is_shop) {
          return { content: [{ type: 'text', text: `You must be inside a shop to sell items. "${loc?.name}" is not a shop. Look for a location with is_shop=true nearby, or use \`list_item\` to sell on the player marketplace instead.` }] };
        }

        const item = getItemById(item_id);
        if (!item || item.owner_id !== player.id) return { content: [{ type: 'text', text: "You don't have that item." }] };
        if (item.item_type === 'currency') return { content: [{ type: 'text', text: "You can't sell currency." }] };

        // Apply CHA bonus: +1% per 3 CHA, cap 25%
        const chaBonus = Math.min(0.25, player.charisma / 300);
        const sellPrice = Math.floor(item.value * (SELL_ITEM_VALUE_FRACTION + chaBonus));
        
        const taxInfo = applyTax(sellPrice, player.chunk_x, player.chunk_y);
        updatePlayerGold(player.id, player.gold + taxInfo.netAmount);
        getDb().prepare('DELETE FROM items WHERE id = ?').run(item_id);

        // Track revenue for demolition cost scaling
        addChunkRevenue(player.chunk_x, player.chunk_y, sellPrice);
        if (player.location_id !== null) {
          addLocationRevenue(player.location_id, sellPrice);
        }

        logEvent('sell', player.id, null, player.chunk_x, player.chunk_y, player.location_id, {
          item_name: item.name, base_price: sellPrice, net: taxInfo.netAmount,
          cha_bonus: chaBonus,
          platform_tax: taxInfo.platformTax, chunk_tax: taxInfo.chunkTax,
        });

        // Update earn_gold quest progress
        incrementQuestProgress(player.id, 'earn_gold', taxInfo.netAmount);

        const baseSellPrice = Math.floor(item.value * SELL_ITEM_VALUE_FRACTION);
        const bonusAmount = sellPrice - baseSellPrice;
        const bonusNote = bonusAmount > 0 ? ` (CHA bonus: +${bonusAmount}g)` : '';
        const taxNote = taxInfo.platformTax > 0 || taxInfo.chunkTax > 0
          ? ` (after tax: ${taxInfo.platformTax}g platform + ${taxInfo.chunkTax}g chunk)`
          : '';
        return { content: [{ type: 'text', text: `You sell ${item.name} for ${taxInfo.netAmount}g${bonusNote}${taxNote}. Gold: ${player.gold + taxInfo.netAmount}g` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'drop',
    'Drop an item from your inventory onto the ground.',
    {
      token: z.string().uuid().describe('Your auth token'),
      item_id: z.number().int().describe('ID of the item to drop'),
    },
    async ({ token, item_id }) => {
      try {
        const player = authenticate(token);
        const item = getItemById(item_id);
        if (!item || item.owner_id !== player.id) return { content: [{ type: 'text', text: "You don't have that item." }] };

        dropAtLocation(item_id, player.chunk_x, player.chunk_y, player.location_id);
        return { content: [{ type: 'text', text: `You drop ${item.name} on the ground.` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'equip',
    'Equip a weapon or armor from your inventory. Stat bonuses are applied. Level requirements are checked.',
    {
      token: z.string().uuid().describe('Your auth token'),
      item_id: z.number().int().describe('ID of the item to equip'),
    },
    async ({ token, item_id }) => {
      try {
        const player = authenticate(token);
        const item = getItemById(item_id);
        if (!item || item.owner_id !== player.id) return { content: [{ type: 'text', text: "You don't have that item." }] };
        if (item.item_type !== 'weapon' && item.item_type !== 'armor') {
          return { content: [{ type: 'text', text: 'You can only equip weapons and armor.' }] };
        }

        // Check level requirement
        if (item.level_requirement > 0 && player.level < item.level_requirement) {
          return { content: [{ type: 'text', text: `You must be level ${item.level_requirement} to equip ${item.name}. (You are level ${player.level})` }] };
        }

        // Unequip existing weapon if equipping a weapon
        if (item.item_type === 'weapon') {
          const items = getItemsByOwner(player.id);
          for (const i of items) {
            if (i.item_type === 'weapon' && i.is_equipped) {
              unequipItem(i.id);
              applyStatBonuses(player.id, i, false);
            }
          }
        }

        equipItem(item_id);
        applyStatBonuses(player.id, item, true);

        // Track tutorial quest progress for equipping an item
        incrementQuestProgress(player.id, 'equip_item', 1);

        const stats: string[] = [];
        if (item.damage_bonus) stats.push(`+${item.damage_bonus} damage`);
        if (item.defense_bonus) stats.push(`+${item.defense_bonus} defense`);
        let equipBonuses: Record<string, unknown> = {};
        try { equipBonuses = JSON.parse(item.stat_bonuses || '{}'); } catch {}
        for (const [k, v] of Object.entries(equipBonuses)) {
          if (v) stats.push(`+${v} ${k}`);
        }
        return { content: [{ type: 'text', text: `You equip ${item.name}. ${stats.join(', ')}` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'unequip',
    'Unequip a weapon or armor. Stat bonuses are removed.',
    {
      token: z.string().uuid().describe('Your auth token'),
      item_id: z.number().int().describe('ID of the item to unequip'),
    },
    async ({ token, item_id }) => {
      try {
        const player = authenticate(token);
        const item = getItemById(item_id);
        if (!item || item.owner_id !== player.id) return { content: [{ type: 'text', text: "You don't have that item." }] };
        if (!item.is_equipped) return { content: [{ type: 'text', text: 'That item is not equipped.' }] };

        unequipItem(item_id);
        applyStatBonuses(player.id, item, false);
        return { content: [{ type: 'text', text: `You unequip ${item.name}.` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'use_item',
    'Use a consumable item (potion, scroll, etc) or a key item.',
    {
      token: z.string().uuid().describe('Your auth token'),
      item_id: z.number().int().describe('ID of the item to use'),
    },
    async ({ token, item_id }) => {
      try {
        const player = authenticate(token);
        const item = getItemById(item_id);
        if (!item || item.owner_id !== player.id) return { content: [{ type: 'text', text: "You don't have that item." }] };
        if (item.item_type !== 'consumable' && item.item_type !== 'key') {
          return { content: [{ type: 'text', text: 'You can only use consumable or key items.' }] };
        }

        if (item.item_type === 'key') {
          return { content: [{ type: 'text', text: `${item.name} — keys are used automatically when you enter a locked location. Keep it in your inventory.` }] };
        }

        const parts: string[] = [`You use ${item.name}.`];

        if (item.heal_amount > 0) {
          const newHp = Math.min(player.max_hp, player.hp + item.heal_amount);
          const actualHeal = newHp - player.hp;
          updatePlayerHp(player.id, newHp);
          if (actualHeal < item.heal_amount) {
            parts.push(`Healed ${actualHeal} HP (restores up to ${item.heal_amount}). HP: ${newHp}/${player.max_hp}`);
          } else {
            parts.push(`Healed ${actualHeal} HP. HP: ${newHp}/${player.max_hp}`);
          }
        }

        // Apply stat bonuses from consumable (one-time boost, consumed)
        let useBonuses: Record<string, unknown> = {};
        try { useBonuses = JSON.parse(item.stat_bonuses || '{}'); } catch {}
        if (Object.keys(useBonuses).length > 0) {
          applyStatBonuses(player.id, item, true);
          parts.push(`Stat boost: ${Object.entries(useBonuses).map(([k, v]) => `+${v} ${k}`).join(', ')}`);
        }

        getDb().prepare('DELETE FROM items WHERE id = ?').run(item_id);

        logEvent('use_item', player.id, null, player.chunk_x, player.chunk_y, player.location_id, { item_name: item.name, heal_amount: item.heal_amount });

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );
}

function applyStatBonuses(playerId: number, item: { stat_bonuses: string }, equip: boolean): void {
  let bonuses: Record<string, unknown> = {};
  try { bonuses = JSON.parse(item.stat_bonuses || '{}'); } catch {}
  if (Object.keys(bonuses).length === 0) return;

  const db = getDb();
  const multiplier = equip ? 1 : -1;
  const sets: string[] = [];
  const values: number[] = [];

  for (const [stat, val] of Object.entries(bonuses)) {
    if (['strength', 'dexterity', 'constitution', 'charisma', 'luck'].includes(stat) && typeof val === 'number') {
      sets.push(`${stat} = min(${STAT_CAP}, max(1, ${stat} + ?))`);
      values.push(val * multiplier);
    }
  }

  if (sets.length > 0) {
    values.push(playerId);
    db.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
}
