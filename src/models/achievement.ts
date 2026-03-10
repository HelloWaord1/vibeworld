import { getDb } from '../db/connection.js';
import { addXp } from './player.js';

export interface Achievement {
  id: number;
  player_id: number;
  achievement_key: string;
  unlocked_at: string;
}

export interface AchievementDefinition {
  name: string;
  description: string;
  xp: number;
}

export const ACHIEVEMENTS: Record<string, AchievementDefinition> = {
  first_blood: { name: 'First Blood', description: 'Kill your first monster', xp: 25 },
  explorer: { name: 'Explorer', description: 'Visit 5 different chunks', xp: 50 },
  craftsman: { name: 'Craftsman', description: 'Craft your first item', xp: 25 },
  trader: { name: 'Trader', description: 'Complete your first trade', xp: 25 },
  level5: { name: 'Veteran', description: 'Reach level 5', xp: 100 },
  level10: { name: 'Champion', description: 'Reach level 10', xp: 250 },
  rich: { name: 'Wealthy', description: 'Accumulate 1000 gold', xp: 50 },
  slayer10: { name: 'Monster Slayer', description: 'Kill 10 monsters', xp: 75 },
  slayer50: { name: 'Monster Hunter', description: 'Kill 50 monsters', xp: 150 },
  social_butterfly: { name: 'Social Butterfly', description: 'Send 5 messages', xp: 25 },
  soul_bound: { name: 'Insured', description: 'Soul bind for the first time', xp: 25 },
  pvp_kill: { name: 'Player Killer', description: 'Kill another player', xp: 50 },
};

/**
 * Unlock an achievement for a player
 * Returns true if the achievement was newly unlocked, false if already had it
 */
export function unlockAchievement(
  playerId: number,
  key: string
): { unlocked: boolean; achievement?: AchievementDefinition } {
  const db = getDb();
  const def = ACHIEVEMENTS[key];

  if (!def) {
    return { unlocked: false };
  }

  try {
    db.prepare(
      'INSERT INTO achievements (player_id, achievement_key) VALUES (?, ?)'
    ).run(playerId, key);

    // Award XP
    addXp(playerId, def.xp);

    return { unlocked: true, achievement: def };
  } catch (e: unknown) {
    // UNIQUE constraint violation means already unlocked
    return { unlocked: false };
  }
}

/**
 * Get all achievements for a player
 */
export function getPlayerAchievements(playerId: number): Achievement[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM achievements WHERE player_id = ? ORDER BY unlocked_at DESC')
    .all(playerId) as Achievement[];
}

/**
 * Check and unlock an achievement if conditions are met
 * Returns a message if unlocked, null otherwise
 */
export function checkAndUnlock(playerId: number, key: string): string | null {
  const result = unlockAchievement(playerId, key);
  if (result.unlocked && result.achievement) {
    return `🏆 ACHIEVEMENT UNLOCKED: ${result.achievement.name}! +${result.achievement.xp} XP\n${result.achievement.description}`;
  }
  return null;
}

/**
 * Check if a player has a specific achievement
 */
export function hasAchievement(playerId: number, key: string): boolean {
  const db = getDb();
  const result = db
    .prepare('SELECT 1 FROM achievements WHERE player_id = ? AND achievement_key = ?')
    .get(playerId, key);
  return !!result;
}
