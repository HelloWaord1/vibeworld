import { getDb } from '../db/connection.js';

export interface Duel {
  id: number;
  challenger_id: number;
  target_id: number;
  wager: number;
  status: 'pending' | 'accepted' | 'declined' | 'resolved';
  winner_id: number | null;
  created_at: string;
  resolved_at: string | null;
}

export function createDuel(challengerId: number, targetId: number, wager: number): Duel {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO duels (challenger_id, target_id, wager, status)
    VALUES (?, ?, ?, 'pending')
  `).run(challengerId, targetId, wager);

  return getDuelById(result.lastInsertRowid as number)!;
}

export function getDuelById(id: number): Duel | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM duels WHERE id = ?').get(id) as Duel | undefined) || null;
}

export function getPendingDuel(playerId: number): Duel | null {
  const db = getDb();
  const duel = db.prepare(`
    SELECT * FROM duels
    WHERE target_id = ? AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(playerId) as Duel | undefined;

  if (!duel) return null;

  // Check if duel expired (60 seconds)
  const createdAt = new Date(duel.created_at + 'Z').getTime();
  const now = Date.now();
  const age = (now - createdAt) / 1000;

  if (age > 60) {
    // Auto-decline expired duel
    db.prepare(`
      UPDATE duels SET status = 'declined', resolved_at = datetime('now')
      WHERE id = ?
    `).run(duel.id);
    return null;
  }

  return duel;
}

export function resolveDuel(duelId: number, winnerId: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE duels
    SET status = 'resolved', winner_id = ?, resolved_at = datetime('now')
    WHERE id = ?
  `).run(winnerId, duelId);
}

export function declineDuel(duelId: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE duels
    SET status = 'declined', resolved_at = datetime('now')
    WHERE id = ?
  `).run(duelId);
}
