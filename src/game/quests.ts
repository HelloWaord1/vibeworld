import { createQuest, getPlayerQuests, hasTutorialQuests } from '../models/quest.js';
import type { QuestType, DailyQuest } from '../types/index.js';
import { DAILY_QUEST_COUNT } from '../types/index.js';

interface QuestTemplate {
  type: QuestType;
  description: string;
  targetCount: number;
  rewardXp: number;
  rewardGold: number;
}

interface TutorialQuestTemplate {
  type: QuestType;
  description: string;
  targetCount: number;
  rewardXp: number;
  rewardGold: number;
}

const QUEST_POOL: QuestTemplate[] = [
  { type: 'kill_monsters', description: 'Slay 3 monsters', targetCount: 3, rewardXp: 40, rewardGold: 30 },
  { type: 'kill_monsters', description: 'Slay 5 monsters', targetCount: 5, rewardXp: 70, rewardGold: 50 },
  { type: 'explore_chunks', description: 'Visit 2 new chunks', targetCount: 2, rewardXp: 35, rewardGold: 25 },
  { type: 'explore_chunks', description: 'Visit 3 new chunks', targetCount: 3, rewardXp: 50, rewardGold: 40 },
  { type: 'craft_item', description: 'Craft an item', targetCount: 1, rewardXp: 25, rewardGold: 20 },
  { type: 'craft_item', description: 'Craft 2 items', targetCount: 2, rewardXp: 45, rewardGold: 35 },
  { type: 'trade', description: 'Complete a trade', targetCount: 1, rewardXp: 30, rewardGold: 25 },
  { type: 'earn_gold', description: 'Earn 100 gold', targetCount: 100, rewardXp: 30, rewardGold: 0 },
  { type: 'earn_gold', description: 'Earn 50 gold', targetCount: 50, rewardXp: 20, rewardGold: 0 },
  { type: 'rest', description: 'Rest 2 times', targetCount: 2, rewardXp: 15, rewardGold: 15 },
];

export function generateDailyQuests(playerId: number): DailyQuest[] {
  const today = new Date().toISOString().split('T')[0];
  
  // Check if already generated today
  const existing = getPlayerQuests(playerId, today);
  if (existing.length >= DAILY_QUEST_COUNT) return existing;
  
  // Pick random quests (no duplicate types)
  const shuffled = [...QUEST_POOL].sort(() => Math.random() - 0.5);
  const selected: QuestTemplate[] = [];
  const usedTypes = new Set<QuestType>();
  
  for (const quest of shuffled) {
    if (selected.length >= DAILY_QUEST_COUNT) break;
    if (!usedTypes.has(quest.type)) {
      selected.push(quest);
      usedTypes.add(quest.type);
    }
  }
  
  const quests: DailyQuest[] = [];
  for (const tmpl of selected) {
    const quest = createQuest(playerId, tmpl.type, tmpl.description, tmpl.targetCount, tmpl.rewardXp, tmpl.rewardGold, today, false);
    quests.push(quest);
  }

  return quests;
}

const TUTORIAL_QUESTS: TutorialQuestTemplate[] = [
  { type: 'use_look', description: 'First Steps: Use `look` to see your surroundings', targetCount: 1, rewardXp: 0, rewardGold: 25 },
  { type: 'buy_item', description: 'Gear Up: Buy a weapon from the shop', targetCount: 1, rewardXp: 0, rewardGold: 25 },
  { type: 'equip_item', description: 'Armed and Dangerous: Equip your weapon', targetCount: 1, rewardXp: 0, rewardGold: 25 },
  { type: 'kill_monsters', description: 'Monster Hunter: Kill your first monster', targetCount: 1, rewardXp: 25, rewardGold: 50 },
  { type: 'rest', description: 'Rest & Recover: Use rest to heal', targetCount: 1, rewardXp: 25, rewardGold: 50 },
  { type: 'explore_chunks', description: 'Explorer: Visit a new chunk', targetCount: 1, rewardXp: 25, rewardGold: 50 },
  { type: 'check_daily_quests', description: 'Daily Grind: Check your daily quests', targetCount: 1, rewardXp: 50, rewardGold: 75 },
  { type: 'enter_tavern', description: 'Soul Insurance: Visit a tavern and check soul_bind', targetCount: 1, rewardXp: 50, rewardGold: 75 },
];

export function generateTutorialQuests(playerId: number): DailyQuest[] {
  // Check if player already has tutorial quests
  if (hasTutorialQuests(playerId)) {
    return [];
  }

  const today = new Date().toISOString().split('T')[0];
  const quests: DailyQuest[] = [];

  for (const tmpl of TUTORIAL_QUESTS) {
    const quest = createQuest(playerId, tmpl.type, tmpl.description, tmpl.targetCount, tmpl.rewardXp, tmpl.rewardGold, today, true);
    quests.push(quest);
  }

  return quests;
}
