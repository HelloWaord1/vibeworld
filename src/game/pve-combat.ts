import { d20, d6, d100 } from './dice.js';
import type { Player, ActiveMonster, PveCombatResult } from '../types/index.js';
import { MAX_CRIT_CHANCE, PVE_KNOCKOUT_GOLD_PENALTY, HP_REGEN_FRACTION, MONSTER_STAT_SCALE } from '../types/index.js';
import { getEquippedWeapon, getEquippedArmor, createItem } from '../models/item.js';
import { updatePlayerHp, updatePlayerGold, addXp, getPlayerById } from '../models/player.js';
import { updateMonsterHp, killMonster } from '../models/active-monster.js';
import { getTemplateById } from '../models/monster-template.js';
import { logEvent } from '../models/event-log.js';
import { withdrawFromWRB } from '../models/bank.js';
import { getDb } from '../db/connection.js';
import { consumeBuff } from './abilities.js';
import { getActivePartyMembersInChunk } from '../models/party.js';
import { PARTY_XP_BONUS, PARTY_XP_BONUS_LARGE } from '../types/index.js';
import { getAttackNarrative, getMissNarrative, getDodgeNarrative } from './combat-narrative.js';
import { incrementQuestProgress } from '../models/quest.js';
import { checkAndUnlock } from '../models/achievement.js';

function getWeaponBonus(playerId: number): number {
  const weapon = getEquippedWeapon(playerId);
  return weapon ? weapon.damage_bonus : 0;
}

function getArmorBonus(playerId: number): number {
  const armor = getEquippedArmor(playerId);
  return armor.reduce((sum, a) => sum + a.defense_bonus, 0);
}

export function resolvePveRound(
  player: Player,
  monster: ActiveMonster
): { result: PveCombatResult; narrative: string } {
  const template = getTemplateById(monster.template_id);
  const monsterName = template?.name ?? 'Monster';
  const weaponBonus = getWeaponBonus(player.id);
  const armorBonus = getArmorBonus(player.id);
  const parts: string[] = [];

  let playerHp = player.hp;
  let monsterHp = monster.hp;

  // --- Consume offensive buffs BEFORE player attack ---
  const rageBuff = consumeBuff(player.id, 'rage');
  const stealthBuff = consumeBuff(player.id, 'stealth');
  const inspireBuff = consumeBuff(player.id, 'inspire');
  const luckyStrikeBuff = consumeBuff(player.id, 'lucky_strike');
  const powerStrikeBuff = consumeBuff(player.id, 'power_strike');
  const titansGripBuff = consumeBuff(player.id, 'titans_grip');
  const assassinateBuff = consumeBuff(player.id, 'assassinate');
  const intimidateBuff = consumeBuff(player.id, 'intimidate');

  const stealthBonus = stealthBuff ? stealthBuff.value : 0;
  const inspireBonus = inspireBuff ? inspireBuff.value : 0;

  if (rageBuff) parts.push('[RAGE] Your fury empowers your attack!');
  if (stealthBuff) parts.push('[STEALTH] You strike from the shadows! (+5 to hit)');
  if (inspireBuff) parts.push('[INSPIRE] You feel inspired! (+2 to hit)');
  if (luckyStrikeBuff) parts.push('[LUCKY STRIKE] Fortune guides your blade!');
  if (powerStrikeBuff) parts.push('[POWER STRIKE] You strike with precision, ignoring defenses!');
  if (titansGripBuff) parts.push('[TITAN\'S GRIP] Your attack is empowered! (+50% damage)');
  if (assassinateBuff) parts.push('[ASSASSINATE] You deliver a LETHAL STRIKE!');
  if (intimidateBuff) parts.push('[INTIMIDATE] The monster cowers in fear!');

  // Player attacks monster
  // Dodge check for monster (DEX-based)
  const monsterDodgeRoll = d100();
  const monsterDodgeChance = Math.floor(monster.dexterity / 4);
  let playerDamage = 0;
  let playerCrit = false;
  let playerRoll = 0;
  let monsterAc = 0;
  let playerHit = false;

  if (monsterDodgeRoll <= monsterDodgeChance) {
    const dodgeNarrative = getDodgeNarrative(monsterName, 'You');
    parts.push(`${dodgeNarrative}\n(DEX ${monster.dexterity}, ${monsterDodgeChance}% dodge chance)`);
  } else {
    playerRoll = d20() + Math.floor(player.strength / 2) + weaponBonus + stealthBonus + inspireBonus;
    // Power Strike ignores monster defense bonus
    const effectiveDefenseBonus = powerStrikeBuff ? 0 : monster.defense_bonus;
    monsterAc = 10 + Math.floor(monster.constitution / 3) + effectiveDefenseBonus;
    playerHit = playerRoll >= monsterAc;

    if (playerHit) {
      // Assassinate: fixed damage, auto-crit
      if (assassinateBuff) {
        playerDamage = assassinateBuff.value;
        playerCrit = true;
      } else {
        playerDamage = Math.max(1, d6() + Math.floor(player.strength / 3) + weaponBonus);

        // Lucky Strike: 50% crit chance
        if (luckyStrikeBuff) {
          if (Math.random() < luckyStrikeBuff.value) {
            playerCrit = true;
            playerDamage *= 2;
          }
        } else {
          const critRoll = d20();
          if (critRoll <= Math.min(MAX_CRIT_CHANCE, Math.floor(player.luck / 2))) {
            playerCrit = true;
            playerDamage *= 2;
          }
        }

        // Rage: double damage (stacks with crit)
        if (rageBuff) {
          playerDamage *= 2;
        }

        // Titan's Grip: +50% damage
        if (titansGripBuff) {
          playerDamage = Math.floor(playerDamage * 1.5);
        }
      }

      // Ensure minimum 1 damage on hit to prevent infinite combat loops
      playerDamage = Math.max(1, playerDamage);
      monsterHp -= playerDamage;
    }

    const weapon = getEquippedWeapon(player.id);
    if (playerHit) {
      const attackNarrative = getAttackNarrative('You', monsterName, playerDamage, playerCrit, weapon?.name);
      parts.push(`${attackNarrative}\n(d20: ${playerRoll} vs AC ${monsterAc} = Hit, ${playerDamage} dmg)`);
    } else {
      const missNarrative = getMissNarrative('You', monsterName);
      parts.push(`${missNarrative}\n(d20: ${playerRoll} vs AC ${monsterAc} = Miss)`);
    }
  }

  // --- Monster attacks player (if still alive) ---
  let monsterRoll = 0;
  let playerAc = 10 + Math.floor(player.constitution / 3) + armorBonus;

  // Consume defensive buffs BEFORE monster attack
  const fortifyBuff = consumeBuff(player.id, 'fortify');
  const rageAcPenalty = consumeBuff(player.id, 'rage_ac_penalty');
  const paladinsShieldBuff = consumeBuff(player.id, 'paladins_shield');

  if (fortifyBuff) {
    playerAc += fortifyBuff.value;
    parts.push(`[FORTIFY] Your defenses hold strong! (+${fortifyBuff.value} AC)`);
  }
  if (paladinsShieldBuff) {
    playerAc += paladinsShieldBuff.value;
    parts.push(`[PALADIN'S SHIELD] You are protected by holy light! (+${paladinsShieldBuff.value} AC)`);
  }
  if (rageAcPenalty) {
    playerAc -= rageAcPenalty.value;
    parts.push(`[RAGE PENALTY] Your reckless fury leaves you exposed! (-${rageAcPenalty.value} AC)`);
  }

  let monsterHit = false;
  let monsterDamage = 0;

  // Check for Intimidate - monster skips attack
  if (monsterHp > 0 && intimidateBuff) {
    parts.push(`${monsterName} is too frightened to attack!`);
  } else if (monsterHp > 0) {
    // Dodge check for player (DEX-based)
    const playerDodgeRoll = d100();
    const playerDodgeChance = Math.floor(player.dexterity / 4);

    if (playerDodgeRoll <= playerDodgeChance) {
      const dodgeNarrative = getDodgeNarrative('You', monsterName);
      parts.push(`${dodgeNarrative}\n(DEX ${player.dexterity}, ${playerDodgeChance}% dodge chance)`);
    } else {
      monsterRoll = d20() + Math.floor(monster.strength / 2) + monster.damage_bonus;
      monsterHit = monsterRoll >= playerAc;

      if (monsterHit) {
        monsterDamage = Math.max(1, d6() + Math.floor(monster.strength / 3) + monster.damage_bonus);
        playerHp -= monsterDamage;
      }

      if (monsterHit) {
        const attackNarrative = getAttackNarrative(monsterName, 'you', monsterDamage, false);
        parts.push(`${attackNarrative}\n(d20: ${monsterRoll} vs AC ${playerAc} = Hit, ${monsterDamage} dmg)`);
      } else {
        const missNarrative = getMissNarrative(monsterName, 'you');
        parts.push(`${missNarrative}\n(d20: ${monsterRoll} vs AC ${playerAc} = Miss)`);
      }
    }
  }

  let finalPlayerHp = Math.max(0, playerHp);
  const finalMonsterHp = Math.max(0, monsterHp);

  // Check for Undying passive BEFORE updating HP
  if (finalPlayerHp <= 0) {
    const undyingBuff = consumeBuff(player.id, 'undying');
    if (undyingBuff) {
      finalPlayerHp = 1;
      parts.push('[UNDYING] You refuse to fall! You survive with 1 HP!');
    }
  }

  // Update HP in DB
  updatePlayerHp(player.id, finalPlayerHp);
  updateMonsterHp(monster.id, finalMonsterHp);

  const result: PveCombatResult = {
    player_roll: playerRoll,
    monster_ac: monsterAc,
    player_hit: playerHit,
    player_damage: playerDamage,
    player_crit: playerCrit,
    monster_roll: monsterRoll,
    player_ac: playerAc,
    monster_hit: monsterHit,
    monster_damage: monsterDamage,
    player_hp: finalPlayerHp,
    monster_hp: finalMonsterHp,
    player_knocked_out: finalPlayerHp <= 0,
    monster_dead: finalMonsterHp <= 0,
  };

  return { result, narrative: parts.join('\n') };
}

export function handlePveKnockout(player: Player): { goldLost: number } {
  const db = getDb();
  const fresh = getPlayerById(player.id)!;
  const goldLost = Math.floor(fresh.gold * PVE_KNOCKOUT_GOLD_PENALTY);
  const newGold = fresh.gold - goldLost;
  const newHp = Math.max(1, Math.floor(fresh.max_hp * HP_REGEN_FRACTION));

  updatePlayerGold(player.id, newGold);
  updatePlayerHp(player.id, newHp);

  if (goldLost > 0) {
    createItem('Scattered Gold', `${goldLost} gold scattered by ${fresh.name} during a monster attack.`, 'currency', {
      value: goldLost,
      chunk_x: fresh.chunk_x,
      chunk_y: fresh.chunk_y,
      location_id: fresh.location_id,
    });
  }

  logEvent('pve_knockout', player.id, null, fresh.chunk_x, fresh.chunk_y, fresh.location_id, {
    gold_lost: goldLost,
    hp_restored: newHp,
  });

  return { goldLost };
}

function getPartyXpMultiplier(partySize: number): number {
  if (partySize <= 1) return 1;
  return PARTY_XP_BONUS[partySize] ?? PARTY_XP_BONUS_LARGE;
}

export function handleMonsterKill(
  player: Player,
  monster: ActiveMonster,
  dangerLevel: number,
  partyId: number | null = null,
): { xp: number; gold: number; loot: string[]; partySize: number } {
  const db = getDb();
  const template = getTemplateById(monster.template_id);
  if (!template) {
    killMonster(monster.id);
    return { xp: 0, gold: 0, loot: [], partySize: 1 };
  }

  // XP scaled by danger
  const baseXp = Math.floor(template.xp_reward * (1 + (dangerLevel - 1) * 0.35));

  // Determine party members in same chunk for XP splitting
  const colocatedMembers = partyId !== null
    ? getActivePartyMembersInChunk(partyId, monster.chunk_x, monster.chunk_y)
    : [];
  const partySize = colocatedMembers.length > 1 ? colocatedMembers.length : 1;
  const xpMultiplier = getPartyXpMultiplier(partySize);
  const totalXp = Math.floor(baseXp * xpMultiplier);
  const xpPerMember = Math.floor(baseXp * xpMultiplier);

  // Award XP to all co-located party members, or just the killer if solo
  if (partySize > 1) {
    for (const member of colocatedMembers) {
      addXp(member.player_id, xpPerMember);
    }
  } else {
    addXp(player.id, xpPerMember);
  }

  // Gold goes to the killer only (WRB-backed)
  const dangerMultiplier = 1 + (dangerLevel - 1) * 0.3; // 1x at danger 1, 1.3x at danger 2, ... 3.7x at danger 10
  const templateGold = template.gold_min + Math.floor(Math.random() * (template.gold_max - template.gold_min + 1));
  const dangerFloor = dangerLevel * 3;
  const goldRequested = Math.max(dangerFloor, Math.floor(templateGold * dangerMultiplier));
  const gold = withdrawFromWRB(goldRequested);
  if (gold > 0) {
    const fresh = getPlayerById(player.id)!;
    updatePlayerGold(player.id, Math.min(fresh.gold + gold, 10_000_000));
    // Update earn_gold quest progress
    incrementQuestProgress(player.id, 'earn_gold', gold);
  }

  // Loot rolls — loot goes to killer
  const lootDropped: string[] = [];

  // Check for Fortune's Favor buff (double loot)
  const fortunesFavorBuff = consumeBuff(player.id, 'fortunes_favor');
  const lootMultiplier = fortunesFavorBuff ? fortunesFavorBuff.value : 1;

  try {
    const lootTable = JSON.parse(template.loot_table) as Array<{
      name: string;
      description: string;
      item_type: string;
      damage_bonus?: number;
      defense_bonus?: number;
      heal_amount?: number;
      value?: number;
      rarity?: string;
      drop_chance: number;
    }>;

    // Roll loot drops (potentially twice with Fortune's Favor)
    for (let roll = 0; roll < lootMultiplier; roll++) {
      for (const entry of lootTable) {
        if (Math.random() < entry.drop_chance) {
          // Luck-based rarity upgrade
          const luckUpgradeChance = player.luck / 5; // 0-10% at luck 0-50
          let finalRarity = (entry.rarity as any) ?? 'common';
          if (Math.random() * 100 < luckUpgradeChance) {
            const rarityOrder = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
            const currentIdx = rarityOrder.indexOf(finalRarity);
            if (currentIdx < rarityOrder.length - 1) {
              finalRarity = rarityOrder[currentIdx + 1];
              lootDropped.push(`${entry.name} (LUCKY UPGRADE → ${finalRarity}!)`);
            } else {
              lootDropped.push(entry.name);
            }
          } else {
            lootDropped.push(entry.name);
          }

          createItem(entry.name, entry.description, entry.item_type as any, {
            damage_bonus: entry.damage_bonus ?? 0,
            defense_bonus: entry.defense_bonus ?? 0,
            heal_amount: entry.heal_amount ?? 0,
            value: entry.value ?? 0,
            owner_id: player.id,
            rarity: finalRarity,
          });
        }
      }
    }
  } catch {
    // Invalid loot table — skip
  }

  // 75% chance to drop a random crafting material
  const craftingMaterials = [
    { name: 'Iron Ore', desc: 'Raw iron ore, the foundation of metalwork.', value: 8 },
    { name: 'Coal', desc: 'A chunk of coal for fueling the forge.', value: 5 },
    { name: 'Herb', desc: 'A fragrant medicinal herb.', value: 6 },
    { name: 'Water Flask', desc: 'A flask filled with clean water.', value: 4 },
    { name: 'Leather', desc: 'Tanned hide ready for crafting.', value: 7 },
    { name: 'Thread', desc: 'Strong thread for stitching.', value: 3 },
    { name: 'Wheat', desc: 'Golden wheat ready for milling.', value: 4 },
    { name: 'Salt', desc: 'Fine salt for preserving and seasoning.', value: 3 },
  ];
  if (Math.random() < 0.75) {
    const material = craftingMaterials[Math.floor(Math.random() * craftingMaterials.length)];
    createItem(material.name, material.desc, 'misc', {
      value: material.value,
      owner_id: player.id,
      rarity: 'common',
    });
    lootDropped.push(material.name);
  }

  // Increment total_monsters_killed for killer
  db.prepare('UPDATE players SET total_monsters_killed = total_monsters_killed + 1 WHERE id = ?').run(player.id);

  // Check achievements
  const freshPlayer = getPlayerById(player.id)!;
  checkAndUnlock(player.id, 'first_blood'); // First kill
  if (freshPlayer.total_monsters_killed >= 10) checkAndUnlock(player.id, 'slayer10');
  if (freshPlayer.total_monsters_killed >= 50) checkAndUnlock(player.id, 'slayer50');

  // Delete the monster
  killMonster(monster.id);

  logEvent('monster_kill', player.id, null, monster.chunk_x, monster.chunk_y, monster.location_id, {
    monster_name: template.name,
    xp_gained: xpPerMember,
    xp_total: totalXp,
    gold_gained: gold,
    loot: lootDropped,
    party_id: partyId,
    party_size: partySize,
    xp_multiplier: xpMultiplier,
  });

  return { xp: xpPerMember, gold, loot: lootDropped, partySize };
}
