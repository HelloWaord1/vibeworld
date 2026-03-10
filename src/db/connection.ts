import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH || './data/vibetheworld.db';
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // One-time migration: rename old vibeworld.db → vibetheworld.db
      if (!fs.existsSync(dbPath)) {
        const oldPath = path.join(dir, 'vibeworld.db');
        if (fs.existsSync(oldPath)) {
          fs.renameSync(oldPath, dbPath);
          // Also move WAL/SHM files if they exist
          for (const ext of ['-wal', '-shm']) {
            if (fs.existsSync(oldPath + ext)) {
              fs.renameSync(oldPath + ext, dbPath + ext);
            }
          }
        }
      }
    }
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function resetDb(): void {
  if (db) {
    try { db.close(); } catch {}
    db = null;
  }
}
