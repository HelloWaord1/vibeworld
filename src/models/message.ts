import { getDb } from '../db/connection.js';
import type { Message, MessageType } from '../types/index.js';
import { checkAndUnlock } from './achievement.js';

export function createMessage(
  fromId: number,
  toId: number | null,
  chunkX: number,
  chunkY: number,
  content: string,
  messageType: MessageType = 'public',
): Message {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO messages (from_id, to_id, chunk_x, chunk_y, content, message_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(fromId, toId, chunkX, chunkY, content, messageType);

  // Check social_butterfly achievement (count total messages from player)
  const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE from_id = ?').get(fromId) as { count: number };
  if (messageCount.count >= 5) {
    checkAndUnlock(fromId, 'social_butterfly');
  }

  return db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid) as Message;
}

export function getRecentMessages(chunkX: number, chunkY: number, playerId: number, limit = 20): Message[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM messages
    WHERE chunk_x = ? AND chunk_y = ? AND (to_id IS NULL OR to_id = ? OR from_id = ?)
    ORDER BY created_at DESC LIMIT ?
  `).all(chunkX, chunkY, playerId, playerId, limit) as Message[];
}
