import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { enforceCooldown, COOLDOWNS } from '../server/cooldown.js';
import { getAllRecipes, getRecipeByName, getRecipesByCategory, checkPlayerHasIngredients, craftItem } from '../models/recipe.js';
import { getItemsByOwner } from '../models/item.js';
import { getLocationById } from '../models/location.js';
import { logEvent } from '../models/event-log.js';
import { MAX_INVENTORY_SIZE, XP_CRAFT_ITEM } from '../types/index.js';
import type { RecipeWithIngredients } from '../types/index.js';
import { getDb } from '../db/connection.js';
import { incrementQuestProgress } from '../models/quest.js';
import { checkAndUnlock } from '../models/achievement.js';

function formatRecipe(recipe: RecipeWithIngredients): string {
  const ingredientList = recipe.ingredients
    .map(i => `${i.quantity}x ${i.item_name}`)
    .join(' + ');

  const stats: string[] = [];
  if (recipe.result_damage_bonus) stats.push(`+${recipe.result_damage_bonus} dmg`);
  if (recipe.result_defense_bonus) stats.push(`+${recipe.result_defense_bonus} def`);
  if (recipe.result_heal_amount) stats.push(`heals ${recipe.result_heal_amount}`);
  stats.push(`${recipe.result_value}g value`);
  if (recipe.result_level_requirement > 0) stats.push(`req lv${recipe.result_level_requirement}`);

  const location = recipe.required_location_type
    ? ` [requires: ${recipe.required_location_type}]`
    : '';

  return `  ${recipe.name} (${recipe.result_item_type}, ${recipe.result_rarity}) — ${ingredientList} => ${recipe.result_item_name} (${stats.join(', ')})${location}`;
}

export function registerCraftTools(server: McpServer): void {
  server.tool(
    'recipes',
    'List all available crafting recipes. Optionally filter by category (weapon, armor, consumable, food).',
    {
      token: z.string().uuid().describe('Your auth token'),
      category: z.string().optional().describe('Filter by item type: weapon, armor, consumable, food, misc'),
    },
    async ({ token, category }) => {
      try {
        authenticate(token);

        const recipes = category
          ? getRecipesByCategory(category)
          : getAllRecipes();

        if (recipes.length === 0) {
          const note = category ? ` in category "${category}"` : '';
          return { content: [{ type: 'text', text: `No recipes found${note}.` }] };
        }

        const header = category
          ? `Crafting Recipes (${category}):`
          : 'Crafting Recipes:';

        const lines = [header, ...recipes.map(formatRecipe)];
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: message }] };
      }
    }
  );

  server.tool(
    'craft',
    'Craft an item using a recipe. Requires ingredients in your inventory. Some recipes require a specific location type (e.g. forge).',
    {
      token: z.string().uuid().describe('Your auth token'),
      recipe_name: z.string().min(1).describe('Name of the recipe to craft'),
    },
    async ({ token, recipe_name }) => {
      try {
        const player = authenticate(token);

        // Check cooldown
        const remaining = enforceCooldown(player.id, 'craft', COOLDOWNS.CRAFT);
        if (remaining !== null) {
          return { content: [{ type: 'text', text: `Crafting cooldown: ${remaining}s remaining.` }] };
        }

        // Find recipe
        const recipe = getRecipeByName(recipe_name);
        if (!recipe) {
          return { content: [{ type: 'text', text: `Recipe "${recipe_name}" not found. Use \`recipes\` to see available recipes.` }] };
        }

        // Check location requirement
        if (recipe.required_location_type) {
          if (player.location_id === null) {
            return { content: [{ type: 'text', text: `This recipe requires a ${recipe.required_location_type}. You must enter a ${recipe.required_location_type} location first.` }] };
          }
          const location = getLocationById(player.location_id);
          if (!location || location.location_type !== recipe.required_location_type) {
            const currentType = location ? location.location_type : 'unknown';
            return { content: [{ type: 'text', text: `This recipe requires a ${recipe.required_location_type}. You are in a ${currentType} ("${location?.name ?? 'unknown'}").` }] };
          }
        }

        // Check inventory space (crafting consumes N ingredients and creates 1 item)
        const currentInventory = getItemsByOwner(player.id);
        const totalIngredientsConsumed = recipe.ingredients.reduce((sum, i) => sum + i.quantity, 0);
        const inventoryAfterCraft = currentInventory.length - totalIngredientsConsumed + 1;
        if (inventoryAfterCraft > MAX_INVENTORY_SIZE) {
          return { content: [{ type: 'text', text: `Inventory full (${MAX_INVENTORY_SIZE} items max). Drop something first.` }] };
        }

        // Check ingredients
        const check = checkPlayerHasIngredients(player.id, recipe.id);
        if (!check.satisfied) {
          const missingList = check.missing
            .map(m => `${m.item_name}: need ${m.needed}, have ${m.have}`)
            .join(', ');
          return { content: [{ type: 'text', text: `Missing ingredients: ${missingList}` }] };
        }

        // Craft the item (transactional: consume + create)
        const craftedItem = craftItem(player.id, recipe.id);

        // Award XP
        const db = getDb();
        db.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').run(XP_CRAFT_ITEM, player.id);

        // Update craft quest progress
        incrementQuestProgress(player.id, 'craft_item', 1);

        // Log event
        logEvent('craft', player.id, null, player.chunk_x, player.chunk_y, player.location_id, {
          recipe_name: recipe.name,
          item_id: craftedItem.id,
          item_name: craftedItem.name,
        });

        // Check craftsman achievement
        checkAndUnlock(player.id, 'craftsman');

        const ingredientList = recipe.ingredients
          .map(i => `${i.quantity}x ${i.item_name}`)
          .join(', ');

        const stats: string[] = [];
        if (craftedItem.damage_bonus) stats.push(`+${craftedItem.damage_bonus} dmg`);
        if (craftedItem.defense_bonus) stats.push(`+${craftedItem.defense_bonus} def`);
        if (craftedItem.heal_amount) stats.push(`heals ${craftedItem.heal_amount}`);
        if (craftedItem.level_requirement > 0) stats.push(`req lv${craftedItem.level_requirement}`);
        const statsStr = stats.length > 0 ? ` (${stats.join(', ')})` : '';

        return {
          content: [{
            type: 'text',
            text: `You crafted ${craftedItem.name} (${craftedItem.rarity})${statsStr}! Used: ${ingredientList}. (+${XP_CRAFT_ITEM} XP)`,
          }],
        };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: message }] };
      }
    }
  );
}
