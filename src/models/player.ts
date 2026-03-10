import { getDb } from '../db/connection.js';
import type { Player } from '../types/index.js';
import { STARTING_HP, STARTING_GOLD, STARTING_STATS } from '../types/index.js';
import { generateToken, hashPassword, verifyPassword } from '../utils/crypto.js';
import { checkAndUnlock } from './achievement.js';

export function createPlayer(name: string, password: string): Player {
  const db = getDb();
  const token = generateToken();
  const password_hash = hashPassword(password);

  const stmt = db.prepare(`
    INSERT INTO players (name, token, password_hash, hp, max_hp, strength, dexterity, constitution, charisma, luck, gold)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(name, token, password_hash, STARTING_HP, STARTING_HP, STARTING_STATS, STARTING_STATS, STARTING_STATS, STARTING_STATS, STARTING_STATS, STARTING_GOLD);
  return getPlayerById(result.lastInsertRowid as number)!;
}

export function loginPlayer(name: string, password: string): Player | null {
  const db = getDb();
  const player = db.prepare('SELECT * FROM players WHERE name = ?').get(name) as Player | undefined;
  if (!player) return null;
  if (!verifyPassword(password, player.password_hash)) return null;
  if (!player.is_alive) return null;

  // Rotate token on login
  const token = generateToken();
  db.prepare(`UPDATE players SET token = ?, last_active_at = datetime('now') WHERE id = ?`).run(token, player.id);
  return { ...player, token };
}

export function getPlayerByToken(token: string): Player | null {
  const db = getDb();
  const player = db.prepare('SELECT * FROM players WHERE token = ?').get(token) as Player | undefined;
  if (player && player.is_alive) {
    db.prepare(`UPDATE players SET last_active_at = datetime('now') WHERE id = ?`).run(player.id);
  }
  return player || null;
}

export function getPlayerById(id: number): Player | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player | undefined) || null;
}

export function getPlayerByName(name: string): Player | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM players WHERE name = ? AND is_alive = 1').get(name) as Player | undefined) || null;
}

export function isNameTakenByAlive(name: string): boolean {
  const db = getDb();
  return !!db.prepare('SELECT 1 FROM players WHERE name = ? AND is_alive = 1').get(name);
}

export function getPlayersAtChunk(x: number, y: number, locationId: number | null): Player[] {
  const db = getDb();
  if (locationId !== null) {
    return db.prepare('SELECT * FROM players WHERE chunk_x = ? AND chunk_y = ? AND location_id = ? AND is_alive = 1').all(x, y, locationId) as Player[];
  }
  return db.prepare('SELECT * FROM players WHERE chunk_x = ? AND chunk_y = ? AND location_id IS NULL AND is_alive = 1').all(x, y) as Player[];
}

export function updatePlayerPosition(id: number, chunkX: number, chunkY: number, locationId: number | null): void {
  const db = getDb();
  db.prepare('UPDATE players SET chunk_x = ?, chunk_y = ?, location_id = ? WHERE id = ?').run(chunkX, chunkY, locationId, id);
}

export function updatePlayerHp(id: number, hp: number): void {
  const db = getDb();
  db.prepare('UPDATE players SET hp = ? WHERE id = ?').run(hp, id);
}

export function updatePlayerStats(id: number, stats: Partial<Pick<Player, 'strength' | 'dexterity' | 'constitution' | 'charisma' | 'luck'>>): void {
  const db = getDb();
  const sets: string[] = [];
  const values: number[] = [];
  for (const [key, val] of Object.entries(stats)) {
    if (val !== undefined) {
      sets.push(`${key} = ${key} + ?`);
      values.push(val);
    }
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function addXp(id: number, amount: number): { leveled_up: boolean; new_level: number; stat_points: number } {
  const db = getDb();
  const player = getPlayerById(id)!;
  let remainingXp = player.xp + amount;
  let currentLevel = player.level;
  let leveled_up = false;
  let totalStatPoints = 0;
  let levelsGained = 0;

  // Loop to handle multi-level ups
  while (remainingXp >= currentLevel * 100) {
    remainingXp -= currentLevel * 100;
    currentLevel++;
    levelsGained++;
    totalStatPoints += 2;
    leveled_up = true;
  }

  if (leveled_up) {
    db.prepare('UPDATE players SET xp = ?, level = ?, max_hp = max_hp + ?, hp = min(hp + ?, max_hp + ?) WHERE id = ?')
      .run(remainingXp, currentLevel, levelsGained * 10, levelsGained * 10, levelsGained * 10, id);

    // Check level-based achievements
    if (currentLevel >= 5) checkAndUnlock(id, 'level5');
    if (currentLevel >= 10) checkAndUnlock(id, 'level10');
  } else {
    db.prepare('UPDATE players SET xp = ? WHERE id = ?').run(remainingXp, id);
  }

  return { leveled_up, new_level: currentLevel, stat_points: totalStatPoints };
}

export function killPlayer(id: number, causeOfDeath: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE players SET is_alive = 0, died_at = datetime('now'), cause_of_death = ?, hp = 0 WHERE id = ?
  `).run(causeOfDeath, id);

  // Clear revolt votes for chunks this player ruled (before resetting ruler_id)
  db.prepare(`
    DELETE FROM revolt_votes WHERE (chunk_x, chunk_y) IN (
      SELECT x, y FROM chunks WHERE ruler_id = ?
    )
  `).run(id);

  // Release all chunks ruled by this player — reset policies to prevent ghost nations
  db.prepare(`
    UPDATE chunks SET ruler_id = NULL, chunk_tax_rate = 0,
      immigration_policy = 'open', immigration_fee = 0,
      build_policy = 'free', build_fee = 0,
      exit_policy = 'free', exit_fee = 0,
      sale_price = NULL
    WHERE ruler_id = ?
  `).run(id);
}

export function updatePlayerGold(id: number, gold: number): void {
  const db = getDb();
  const capped = Math.min(Math.max(0, gold), 10_000_000);
  db.prepare('UPDATE players SET gold = ? WHERE id = ?').run(capped, id);

  // Check wealth achievement
  if (capped >= 1000) checkAndUnlock(id, 'rich');
}
