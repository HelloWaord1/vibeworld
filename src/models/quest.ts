import { getDb } from '../db/connection.js';
import type { DailyQuest, QuestStreak, QuestType } from '../types/index.js';
import { DAILY_QUEST_COUNT } from '../types/index.js';

export function getPlayerQuests(playerId: number, date: string): DailyQuest[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM daily_quests WHERE player_id = ? AND assigned_date = ? AND is_tutorial = 0'
  ).all(playerId, date) as DailyQuest[];
}

export function createQuest(playerId: number, questType: QuestType, description: string, targetCount: number, rewardXp: number, rewardGold: number, date: string, isTutorial: boolean = false): DailyQuest {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO daily_quests (player_id, quest_type, description, target_count, reward_xp, reward_gold, assigned_date, is_tutorial) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(playerId, questType, description, targetCount, rewardXp, rewardGold, date, isTutorial ? 1 : 0);
  return db.prepare('SELECT * FROM daily_quests WHERE id = ?').get(result.lastInsertRowid) as DailyQuest;
}

export function incrementQuestProgress(playerId: number, questType: QuestType, amount: number = 1): void {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  // Update both daily quests (assigned today) and tutorial quests (any date, is_tutorial=1)
  db.prepare(
    `UPDATE daily_quests SET current_count = min(current_count + ?, target_count)
     WHERE player_id = ? AND quest_type = ? AND completed_at IS NULL
     AND (assigned_date = ? OR is_tutorial = 1)`
  ).run(amount, playerId, questType, today);
}

export function completeQuest(questId: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE daily_quests SET completed_at = datetime('now') WHERE id = ? AND completed_at IS NULL`
  ).run(questId);
}

export function getQuestStreak(playerId: number): QuestStreak | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM quest_streaks WHERE player_id = ?').get(playerId) as QuestStreak | undefined) ?? null;
}

export function updateStreak(playerId: number, date: string): QuestStreak {
  const db = getDb();
  const existing = getQuestStreak(playerId);

  if (!existing) {
    db.prepare(
      'INSERT INTO quest_streaks (player_id, current_streak, last_completed_date, total_completed) VALUES (?, 1, ?, 1)'
    ).run(playerId, date);
  } else {
    // Check if this is consecutive
    const lastDate = new Date(existing.last_completed_date);
    const thisDate = new Date(date);
    const diffDays = Math.floor((thisDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      // Consecutive day
      db.prepare(
        'UPDATE quest_streaks SET current_streak = current_streak + 1, last_completed_date = ?, total_completed = total_completed + 1 WHERE player_id = ?'
      ).run(date, playerId);
    } else if (diffDays > 1) {
      // Streak broken
      db.prepare(
        'UPDATE quest_streaks SET current_streak = 1, last_completed_date = ?, total_completed = total_completed + 1 WHERE player_id = ?'
      ).run(date, playerId);
    }
    // diffDays === 0: same day, don't update streak
  }

  return getQuestStreak(playerId)!;
}

export function getTutorialQuests(playerId: number): DailyQuest[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM daily_quests WHERE player_id = ? AND is_tutorial = 1 ORDER BY id ASC'
  ).all(playerId) as DailyQuest[];
}

export function hasTutorialQuests(playerId: number): boolean {
  const db = getDb();
  const result = db.prepare(
    'SELECT COUNT(*) as count FROM daily_quests WHERE player_id = ? AND is_tutorial = 1'
  ).get(playerId) as { count: number };
  return result.count > 0;
}
