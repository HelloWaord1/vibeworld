import { getDb } from '../db/connection.js';
import type { Npc } from '../types/index.js';

export function getNpcsAtLocation(chunkX: number, chunkY: number, locationId: number | null): Npc[] {
  const db = getDb();
  if (locationId === null) {
    return db.prepare(
      'SELECT * FROM npcs WHERE chunk_x = ? AND chunk_y = ? AND location_id IS NULL'
    ).all(chunkX, chunkY) as Npc[];
  }
  return db.prepare(
    'SELECT * FROM npcs WHERE chunk_x = ? AND chunk_y = ? AND location_id = ?'
  ).all(chunkX, chunkY, locationId) as Npc[];
}

export function getNpcByName(name: string, locationId: number): Npc | null {
  const db = getDb();
  return (db.prepare(
    'SELECT * FROM npcs WHERE LOWER(name) = LOWER(?) AND location_id = ?'
  ).get(name, locationId) as Npc | undefined) || null;
}
