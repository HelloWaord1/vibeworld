/** Per-player action cooldown system persisted to SQLite */

import { getDb } from '../db/connection.js';

/**
 * Check if player can perform action. Returns null if allowed,
 * or seconds remaining if on cooldown.
 */
export function checkCooldown(playerId: number, action: string): number | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT expires_at FROM cooldowns WHERE player_id = ? AND action = ?`
  ).get(playerId, action) as { expires_at: string } | undefined;

  if (!row) return null;

  const expiresAt = new Date(row.expires_at + 'Z').getTime();
  const now = Date.now();

  if (expiresAt <= now) {
    db.prepare(
      `DELETE FROM cooldowns WHERE player_id = ? AND action = ?`
    ).run(playerId, action);
    return null;
  }

  return Math.ceil((expiresAt - now) / 1000);
}

/** Set cooldown for a player action. */
export function setCooldown(playerId: number, action: string, durationMs: number): void {
  const db = getDb();
  const expiresAt = new Date(Date.now() + durationMs).toISOString().replace('Z', '').replace('T', ' ').split('.')[0];
  db.prepare(
    `INSERT OR REPLACE INTO cooldowns (player_id, action, expires_at) VALUES (?, ?, ?)`
  ).run(playerId, action, expiresAt);
}

/** Check and set in one call. Returns null if allowed (and sets cooldown), or seconds remaining. */
export function enforceCooldown(playerId: number, action: string, durationMs: number): number | null {
  const remaining = checkCooldown(playerId, action);
  if (remaining !== null) return remaining;
  setCooldown(playerId, action, durationMs);
  return null;
}

// Cooldown durations (ms)
export const COOLDOWNS = {
  SWAP: 5_000,        // 5s between AMM swaps
  ATTACK: 3_000,      // 3s between attacks
  TRADE_OFFER: 10_000, // 10s between trade offers
  REVOLT: 60_000,     // 60s between revolt votes
  CLAIM_SEIZE: 10_000, // 10s between claim/seize
  LIST_ITEM: 5_000,   // 5s between listing items
  SAY: 5_000,         // 5s between say/whisper messages
  ATTACK_MONSTER: 2_000, // 2s between monster attacks
  HUNT: 3_000,         // 3s between hunt scans
  REST: 15_000,        // 15s between rests
  SEEK: 5_000,         // 5s between seek attempts
  CRAFT: 10_000,       // 10s between crafting
  CREATE_ALLIANCE: 60_000, // 60s between alliance creation
  ALLIANCE_INVITE: 10_000, // 10s between alliance invites
  ALLIANCE_CHAT: 3_000,    // 3s between alliance chat messages
  BANK_DEPOSIT: 5_000,
  BANK_WITHDRAW: 5_000,
  TAKE_LOAN: 10_000,
  REPAY_LOAN: 5_000,
  BANK_VIEW: 5_000,
  OPEN_BANK: 60_000,
  SET_BANK_RATES: 30_000,
  STOCK_TRADE: 3_000,     // 3s between stock trades
  STOCK_VIEW: 5_000,      // 5s between stock market views
  DIVIDEND_CLAIM: 10_000, // 10s between dividend claims
  SOUL_BIND: 60_000,      // 60s between soul binding
  SOUL_STATUS: 5_000,     // 5s between soul status checks
  QUEST_VIEW: 5_000,      // 5s between quest views
  QUEST_CLAIM: 3_000,     // 3s between quest claims
  CHALLENGE: 30_000,      // 30s between duel challenges
  TALK: 3_000,            // 3s between NPC conversations
  EMOTE: 5_000,           // 5s between emotes
} as const;
