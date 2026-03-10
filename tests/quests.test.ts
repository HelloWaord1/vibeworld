import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, resetDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createPlayer } from '../src/models/player.js';
import { generateDailyQuests, generateTutorialQuests } from '../src/game/quests.js';
import { getPlayerQuests, getQuestStreak, updateStreak, completeQuest, getTutorialQuests } from '../src/models/quest.js';

describe('Daily Quest System', () => {
  beforeEach(() => {
    resetDb();
    process.env.DATABASE_PATH = ':memory:';
    migrate();
  });

  afterEach(() => {
    resetDb();
  });

  it('generates 3 daily quests for a new player', () => {
    const player = createPlayer('QuestPlayer1', 'password123');
    const today = new Date().toISOString().split('T')[0];
    
    const quests = generateDailyQuests(player.id);
    
    expect(quests).toHaveLength(3);
    expect(quests[0].player_id).toBe(player.id);
    expect(quests[0].assigned_date).toBe(today);
    expect(quests[0].current_count).toBe(0);
    expect(quests[0].completed_at).toBeNull();
  });

  it('does not generate duplicate quests on same day', () => {
    const player = createPlayer('QuestPlayer2', 'password123');
    
    const quests1 = generateDailyQuests(player.id);
    const quests2 = generateDailyQuests(player.id);
    
    expect(quests1).toHaveLength(3);
    expect(quests2).toHaveLength(3);
    expect(quests1[0].id).toBe(quests2[0].id); // Same quests returned
  });

  it('each quest has unique type', () => {
    const player = createPlayer('QuestPlayer3', 'password123');
    const quests = generateDailyQuests(player.id);
    
    const types = quests.map(q => q.quest_type);
    const uniqueTypes = new Set(types);
    
    expect(uniqueTypes.size).toBe(3); // All different types
  });

  it('completing a quest marks it as complete', () => {
    const player = createPlayer('QuestPlayer4', 'password123');
    const quests = generateDailyQuests(player.id);
    const questId = quests[0].id;
    
    completeQuest(questId);
    
    const today = new Date().toISOString().split('T')[0];
    const updated = getPlayerQuests(player.id, today);
    const completedQuest = updated.find(q => q.id === questId);
    
    expect(completedQuest?.completed_at).not.toBeNull();
  });

  it('updateStreak creates new streak for first completion', () => {
    const player = createPlayer('QuestPlayer5', 'password123');
    const today = new Date().toISOString().split('T')[0];
    
    const streak = updateStreak(player.id, today);
    
    expect(streak.current_streak).toBe(1);
    expect(streak.total_completed).toBe(1);
    expect(streak.last_completed_date).toBe(today);
  });

  it('updateStreak increments for consecutive days', () => {
    const player = createPlayer('QuestPlayer6', 'password123');
    
    const day1 = '2024-01-01';
    const day2 = '2024-01-02';
    
    updateStreak(player.id, day1);
    const streak = updateStreak(player.id, day2);
    
    expect(streak.current_streak).toBe(2);
    expect(streak.total_completed).toBe(2);
  });

  it('updateStreak resets for non-consecutive days', () => {
    const player = createPlayer('QuestPlayer7', 'password123');
    
    const day1 = '2024-01-01';
    const day3 = '2024-01-03'; // Skipped day 2
    
    updateStreak(player.id, day1);
    const streak = updateStreak(player.id, day3);
    
    expect(streak.current_streak).toBe(1); // Reset to 1
    expect(streak.total_completed).toBe(2); // But total still increases
  });

  it('quest has rewards configured', () => {
    const player = createPlayer('QuestPlayer8', 'password123');
    const quests = generateDailyQuests(player.id);

    expect(quests[0].reward_xp).toBeGreaterThan(0);
    // Gold rewards can be 0 for some quests (like earn_gold type)
    expect(quests[0].reward_xp + quests[0].reward_gold).toBeGreaterThan(0);
  });
});

describe('Tutorial Quest System', () => {
  beforeEach(() => {
    resetDb();
    process.env.DATABASE_PATH = ':memory:';
    migrate();
  });

  afterEach(() => {
    resetDb();
  });

  it('generates 8 tutorial quests for a new player', () => {
    const player = createPlayer('TutorialPlayer1', 'password123');
    const tutorialQuests = generateTutorialQuests(player.id);

    expect(tutorialQuests).toHaveLength(8);
    expect(tutorialQuests[0].player_id).toBe(player.id);
    expect(tutorialQuests[0].is_tutorial).toBe(1);
  });

  it('tutorial quests are not regenerated if they already exist', () => {
    const player = createPlayer('TutorialPlayer2', 'password123');

    const quests1 = generateTutorialQuests(player.id);
    const quests2 = generateTutorialQuests(player.id);

    expect(quests1).toHaveLength(8);
    expect(quests2).toHaveLength(0); // No new quests generated
  });

  it('tutorial quests have correct types', () => {
    const player = createPlayer('TutorialPlayer3', 'password123');
    const tutorialQuests = generateTutorialQuests(player.id);

    const expectedTypes = [
      'use_look',
      'buy_item',
      'equip_item',
      'kill_monsters',
      'rest',
      'explore_chunks',
      'check_daily_quests',
      'enter_tavern'
    ];

    const actualTypes = tutorialQuests.map(q => q.quest_type);
    expect(actualTypes).toEqual(expectedTypes);
  });

  it('tutorial quests have appropriate rewards', () => {
    const player = createPlayer('TutorialPlayer4', 'password123');
    const tutorialQuests = generateTutorialQuests(player.id);

    // First 3 quests: 25g each, no XP
    expect(tutorialQuests[0].reward_gold).toBe(25);
    expect(tutorialQuests[0].reward_xp).toBe(0);

    // Quest 4-6: 50g + 25XP each
    expect(tutorialQuests[3].reward_gold).toBe(50);
    expect(tutorialQuests[3].reward_xp).toBe(25);

    // Quest 7-8: 75g + 50XP each
    expect(tutorialQuests[6].reward_gold).toBe(75);
    expect(tutorialQuests[6].reward_xp).toBe(50);
  });

  it('tutorial quests can be retrieved separately from daily quests', () => {
    const player = createPlayer('TutorialPlayer5', 'password123');

    generateTutorialQuests(player.id);
    generateDailyQuests(player.id);

    const tutorialQuests = getTutorialQuests(player.id);
    const today = new Date().toISOString().split('T')[0];
    const dailyQuests = getPlayerQuests(player.id, today);

    expect(tutorialQuests).toHaveLength(8);
    expect(dailyQuests).toHaveLength(3);

    // Verify they are separate
    expect(tutorialQuests.every(q => q.is_tutorial === 1)).toBe(true);
    expect(dailyQuests.every(q => q.is_tutorial === 0)).toBe(true);
  });
});
