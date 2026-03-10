import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authenticate } from '../server/auth.js';
import { enforceCooldown, COOLDOWNS } from '../server/cooldown.js';
import { generateDailyQuests } from '../game/quests.js';
import { getQuestStreak, completeQuest, getPlayerQuests, getTutorialQuests, incrementQuestProgress } from '../models/quest.js';
import { updateStreak } from '../models/quest.js';
import { addXp, getPlayerById, updatePlayerGold } from '../models/player.js';
import { QUEST_STREAK_BONUS_DAYS } from '../types/index.js';

export function registerQuestTools(server: McpServer): void {

  // --- daily_quests ---
  server.tool(
    'daily_quests',
    'View your daily quests for today. Shows progress, rewards, and current streak.',
    {
      token: z.string().describe('Your authentication token'),
    },
    async ({ token }) => {
      try {
        const player = authenticate(token);

        const cooldown = enforceCooldown(player.id, 'QUEST_VIEW', COOLDOWNS.QUEST_VIEW);
        if (cooldown !== null) {
          return { content: [{ type: 'text', text: `You must wait ${cooldown}s before checking quests again.` }] };
        }

        // Track that player checked daily quests (for tutorial quest)
        incrementQuestProgress(player.id, 'check_daily_quests', 1);

        // Get tutorial quests and daily quests
        const tutorialQuests = getTutorialQuests(player.id);
        const dailyQuests = generateDailyQuests(player.id);
        const streak = getQuestStreak(player.id);

        let output = '';

        // Show tutorial quests first if player has any
        if (tutorialQuests.length > 0) {
          output += '=== TUTORIAL QUESTS ===\n';
          output += 'Complete these to learn the game!\n\n';

          for (const quest of tutorialQuests) {
            const progress = `[${quest.current_count}/${quest.target_count}]`;
            const status = quest.completed_at ? ' ✓ COMPLETED' : '';
            const rewards = `(${quest.reward_xp} XP, ${quest.reward_gold}g)`;

            // Simple progress bar
            const barLength = 20;
            const filled = Math.floor((quest.current_count / quest.target_count) * barLength);
            const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

            output += `Quest #${quest.id}: ${quest.description}${status}\n`;
            output += `Progress: ${progress} ${bar}\n`;
            output += `Reward: ${rewards}\n\n`;
          }

          output += '\n';
        }

        // Show daily quests
        output += '=== Daily Quests ===\n\n';

        for (const quest of dailyQuests) {
          const progress = `[${quest.current_count}/${quest.target_count}]`;
          const status = quest.completed_at ? ' ✓ COMPLETED' : '';
          const rewards = `(${quest.reward_xp} XP, ${quest.reward_gold}g)`;

          // Simple progress bar
          const barLength = 20;
          const filled = Math.floor((quest.current_count / quest.target_count) * barLength);
          const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

          output += `Quest #${quest.id}: ${quest.description}${status}\n`;
          output += `Progress: ${progress} ${bar}\n`;
          output += `Reward: ${rewards}\n\n`;
        }

        // Streak info
        if (streak) {
          output += `\n--- Streak ---\n`;
          output += `Current Streak: ${streak.current_streak} day(s)\n`;
          output += `Total Completed: ${streak.total_completed}\n`;
          output += `Next Bonus: ${QUEST_STREAK_BONUS_DAYS - (streak.current_streak % QUEST_STREAK_BONUS_DAYS)} day(s) away (100 XP + 200g)\n`;
        } else {
          output += `\nComplete all 3 quests today to start your streak!\n`;
        }

        return { content: [{ type: 'text', text: output }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${message}` }] };
      }
    }
  );

  // --- claim_quest ---
  server.tool(
    'claim_quest',
    'Claim the reward for a completed daily quest. If all 3 quests are done, updates your streak and awards bonus for 7-day streaks.',
    {
      token: z.string().describe('Your authentication token'),
      quest_id: z.number().int().positive().describe('The ID of the quest to claim'),
    },
    async ({ token, quest_id }) => {
      try {
        const player = authenticate(token);

        const cooldown = enforceCooldown(player.id, 'QUEST_CLAIM', COOLDOWNS.QUEST_CLAIM);
        if (cooldown !== null) {
          return { content: [{ type: 'text', text: `You must wait ${cooldown}s before claiming another quest.` }] };
        }

        const today = new Date().toISOString().split('T')[0];
        const tutorialQuests = getTutorialQuests(player.id);
        const dailyQuests = getPlayerQuests(player.id, today);

        // Find quest in either tutorial or daily quests
        const quest = [...tutorialQuests, ...dailyQuests].find(q => q.id === quest_id);
        if (!quest) {
          return { content: [{ type: 'text', text: 'Quest not found or not assigned to you.' }] };
        }

        if (quest.completed_at) {
          return { content: [{ type: 'text', text: 'You have already claimed this quest reward.' }] };
        }

        if (quest.current_count < quest.target_count) {
          return { content: [{ type: 'text', text: `Quest not complete. Progress: ${quest.current_count}/${quest.target_count}` }] };
        }

        // Mark quest as completed
        completeQuest(quest_id);

        // Award rewards
        const levelResult = addXp(player.id, quest.reward_xp);
        const updatedPlayer = getPlayerById(player.id)!;
        updatePlayerGold(player.id, updatedPlayer.gold + quest.reward_gold);

        let output = `Quest completed!\n`;
        output += `Earned: ${quest.reward_xp} XP, ${quest.reward_gold} gold\n`;

        if (levelResult.leveled_up) {
          output += `\n🎉 Level up! You are now level ${levelResult.new_level}!\n`;
          output += `+${levelResult.stat_points} stat points available.\n`;
        }

        // Check if all DAILY quests are now complete (tutorial quests don't count for streaks)
        if (!quest.is_tutorial) {
          const allQuests = getPlayerQuests(player.id, today);
          const allComplete = allQuests.every(q => q.completed_at !== null);

          if (allComplete) {
            const streak = updateStreak(player.id, today);
            output += `\n✨ All daily quests completed! Streak: ${streak.current_streak} day(s)\n`;

            // Award streak bonus every 7 days
            if (streak.current_streak > 0 && streak.current_streak % QUEST_STREAK_BONUS_DAYS === 0) {
              const bonusXp = 100;
              const bonusGold = 200;

              const bonusLevelResult = addXp(player.id, bonusXp);
              const finalPlayer = getPlayerById(player.id)!;
              updatePlayerGold(player.id, finalPlayer.gold + bonusGold);

              output += `\n🏆 ${QUEST_STREAK_BONUS_DAYS}-Day Streak Bonus!\n`;
              output += `Earned: ${bonusXp} XP, ${bonusGold} gold\n`;

              if (bonusLevelResult.leveled_up) {
                output += `Level up! You are now level ${bonusLevelResult.new_level}!\n`;
              }
            }
          }
        }

        return { content: [{ type: 'text', text: output }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${message}` }] };
      }
    }
  );
}
