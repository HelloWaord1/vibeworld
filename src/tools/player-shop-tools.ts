import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { getItemById, getItemsByOwner, transferToPlayer } from '../models/item.js';
import { getPlayerById, updatePlayerGold } from '../models/player.js';
import { createListing, getListingById, getListingsBySeller, deleteListing, getListingByItemId } from '../models/player-listing.js';
import { calculateTax, applyTax } from '../game/tax.js';
import { logEvent } from '../models/event-log.js';
import { getDb } from '../db/connection.js';
import { MAX_INVENTORY_SIZE } from '../types/index.js';
import { addLocationRevenue, addChunkRevenue } from '../models/nation.js';
import { enforceCooldown, COOLDOWNS } from '../server/cooldown.js';
import { incrementQuestProgress } from '../models/quest.js';

/** Sentinel error to signal a stale listing detected inside a transaction.
 *  Thrown so the transaction rolls back cleanly; the caller then deletes
 *  the ghost listing outside the transaction. */
class ListingDesyncError extends Error {
  readonly listingId: number;
  constructor(listingId: number) {
    super('Listing desync detected');
    this.listingId = listingId;
  }
}

export function registerPlayerShopTools(server: McpServer): void {
  server.tool(
    'list_item',
    'List an item from your inventory for sale at your current location.',
    {
      token: z.string().uuid().describe('Your auth token'),
      item_id: z.number().int().describe('ID of the item to list'),
      price: z.number().int().positive().max(1_000_000).describe('Price in gold (max 1M)'),
    },
    async ({ token, item_id, price }) => {
      try {
        const player = authenticate(token);
        const cd = enforceCooldown(player.id, 'list_item', COOLDOWNS.LIST_ITEM);
        if (cd !== null) return { content: [{ type: 'text', text: `Please wait ${cd}s before listing another item.` }] };
        const item = getItemById(item_id);
        if (!item || item.owner_id !== player.id) {
          return { content: [{ type: 'text', text: "You don't have that item." }] };
        }
        if (item.is_equipped) {
          return { content: [{ type: 'text', text: 'Unequip the item first.' }] };
        }
        if (getListingByItemId(item_id)) {
          return { content: [{ type: 'text', text: 'That item is already listed.' }] };
        }

        const listing = createListing(player.id, item_id, price, player.chunk_x, player.chunk_y, player.location_id);
        const taxPreview = calculateTax(price, player.chunk_x, player.chunk_y);

        logEvent('list_item', player.id, null, player.chunk_x, player.chunk_y, player.location_id, {
          listing_id: listing.id, item_name: item.name, price,
        });

        return {
          content: [{
            type: 'text',
            text: [
              `🏪 Listed ${item.name} for ${price}g (listing #${listing.id})`,
              `When sold you'll receive ~${taxPreview.netAmount}g after taxes.`,
              `Platform tax: ${taxPreview.platformTax}g | Chunk tax: ${taxPreview.chunkTax}g`,
            ].join('\n'),
          }],
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'delist_item',
    'Remove your item listing from sale.',
    {
      token: z.string().uuid().describe('Your auth token'),
      listing_id: z.number().int().describe('Listing ID to remove'),
    },
    async ({ token, listing_id }) => {
      try {
        const player = authenticate(token);
        const listing = getListingById(listing_id);
        if (!listing || listing.seller_id !== player.id) {
          return { content: [{ type: 'text', text: 'Listing not found or not yours.' }] };
        }

        deleteListing(listing_id);
        const item = getItemById(listing.item_id);
        return { content: [{ type: 'text', text: `Removed listing for ${item?.name || 'item'}.` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'buy_listing',
    'Buy an item from a player shop listing. Taxes apply.',
    {
      token: z.string().uuid().describe('Your auth token'),
      listing_id: z.number().int().describe('Listing ID to buy'),
    },
    async ({ token, listing_id }) => {
      try {
        const player = authenticate(token);
        const listing = getListingById(listing_id);
        if (!listing) {
          return { content: [{ type: 'text', text: 'Listing not found.' }] };
        }
        if (listing.seller_id === player.id) {
          return { content: [{ type: 'text', text: "You can't buy your own listing. Use delist_item." }] };
        }
        if (listing.chunk_x !== player.chunk_x || listing.chunk_y !== player.chunk_y) {
          return { content: [{ type: 'text', text: 'That listing is not in your current chunk.' }] };
        }
        if ((listing.location_id ?? null) !== player.location_id) {
          return { content: [{ type: 'text', text: 'That listing is not at your current location.' }] };
        }
        if (player.gold < listing.price) {
          return { content: [{ type: 'text', text: `Not enough gold. Need ${listing.price}g, have ${player.gold}g.` }] };
        }
        if (getItemsByOwner(player.id).length >= MAX_INVENTORY_SIZE) {
          return { content: [{ type: 'text', text: `Inventory full (${MAX_INVENTORY_SIZE} items max).` }] };
        }

        const item = getItemById(listing.item_id);
        if (!item) {
          deleteListing(listing_id);
          return { content: [{ type: 'text', text: 'Item no longer exists. Listing removed.' }] };
        }

        const seller = getPlayerById(listing.seller_id);
        if (!seller || !seller.is_alive) {
          deleteListing(listing_id);
          return { content: [{ type: 'text', text: 'Seller is no longer available. Listing removed.' }] };
        }

        // Pre-transaction ownership check: if seller no longer owns the item,
        // cancel the ghost listing before entering the transaction (deleteListing
        // inside a transaction that throws would be rolled back, leaving the
        // ghost listing intact).
        if (item.owner_id !== listing.seller_id) {
          deleteListing(listing_id);
          return { content: [{ type: 'text', text: 'Seller no longer owns this item. Listing has been cancelled.' }] };
        }

        const db = getDb();
        const executePurchase = db.transaction(() => {
          // Re-verify item ownership inside transaction for atomicity
          const freshItem = getItemById(listing.item_id);
          if (!freshItem || freshItem.owner_id !== listing.seller_id) {
            // Cannot delete listing here (transaction rollback would undo it).
            // Signal the caller to clean up after the transaction.
            throw new ListingDesyncError(listing_id);
          }

          // Fresh buyer balance check
          const freshBuyer = db.prepare('SELECT gold FROM players WHERE id = ?').get(player.id) as { gold: number };
          if (freshBuyer.gold < listing.price) {
            throw new Error(`Not enough gold. Need ${listing.price}g, have ${freshBuyer.gold}g.`);
          }

          // Buyer pays full price (relative update)
          db.prepare('UPDATE players SET gold = gold - ? WHERE id = ?').run(listing.price, player.id);

          // Apply taxes — platform tax destroyed, chunk tax to ruler
          const taxResult = applyTax(listing.price, listing.chunk_x, listing.chunk_y);

          // Seller receives net amount (relative update)
          db.prepare('UPDATE players SET gold = min(gold + ?, 10000000) WHERE id = ?').run(taxResult.netAmount, listing.seller_id);

          // Update earn_gold quest progress for seller
          incrementQuestProgress(listing.seller_id, 'earn_gold', taxResult.netAmount);

          // Transfer item
          transferToPlayer(listing.item_id, player.id);
          deleteListing(listing_id);

          // Track revenue for demolition cost scaling
          addChunkRevenue(listing.chunk_x, listing.chunk_y, listing.price);
          if (listing.location_id !== null) {
            addLocationRevenue(listing.location_id, listing.price);
          }

          logEvent('buy_listing', player.id, listing.seller_id, player.chunk_x, player.chunk_y, player.location_id, {
            listing_id, item_name: item.name, price: listing.price,
            platform_tax: taxResult.platformTax, chunk_tax: taxResult.chunkTax, net: taxResult.netAmount,
          });

          return taxResult;
        });
        let taxResult;
        try {
          taxResult = executePurchase();
        } catch (txError: unknown) {
          if (txError instanceof ListingDesyncError) {
            // Transaction was rolled back; now safely delete the ghost listing
            deleteListing(txError.listingId);
            return { content: [{ type: 'text', text: 'Seller no longer owns this item. Listing has been cancelled.' }] };
          }
          throw txError;
        }

        return {
          content: [{
            type: 'text',
            text: [
              `🛒 Bought ${item.name} from ${seller.name} for ${listing.price}g`,
              `Seller received: ${taxResult.netAmount}g`,
              `Platform tax: ${taxResult.platformTax}g (burned) | Chunk tax: ${taxResult.chunkTax}g`,
              `Your gold: ${player.gold - listing.price}g`,
            ].join('\n'),
          }],
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );

  server.tool(
    'my_listings',
    'View your active item listings.',
    { token: z.string().uuid().describe('Your auth token') },
    async ({ token }) => {
      try {
        const player = authenticate(token);
        const listings = getListingsBySeller(player.id);
        if (listings.length === 0) {
          return { content: [{ type: 'text', text: 'You have no active listings.' }] };
        }

        const parts = ['🏪 Your listings:'];
        for (const listing of listings) {
          const item = getItemById(listing.item_id);
          parts.push(`  [#${listing.id}] ${item?.name || '???'} — ${listing.price}g @ (${listing.chunk_x},${listing.chunk_y})`);
        }
        return { content: [{ type: 'text', text: parts.join('\n') }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e.message }] };
      }
    }
  );
}
