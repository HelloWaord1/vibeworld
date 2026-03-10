import { d20, d6 } from './dice.js';
import type { Player, CombatResult, SoulBinding } from '../types/index.js';
import { MAX_CRIT_CHANCE } from '../types/index.js';
import { getEquippedWeapon, getEquippedArmor, getItemsByOwner, dropAtLocation } from '../models/item.js';
import { killPlayer, updatePlayerHp, addXp, updatePlayerGold, getPlayerById } from '../models/player.js';
import { createItem } from '../models/item.js';
import { logEvent } from '../models/event-log.js';
import { getDb } from '../db/connection.js';
import { addBounty, claimBounty } from './bounty.js';
import { consumeBuff } from './abilities.js';
import { getActiveBountiesOnPlayer } from '../models/bounty.js';
import { getActiveSoulBinding, removeSoulBinding } from '../models/soul-binding.js';
import { getAttackNarrative, getMissNarrative } from './combat-narrative.js';
import { checkAndUnlock } from '../models/achievement.js';

function getWeaponBonus(playerId: number): number {
  const weapon = getEquippedWeapon(playerId);
  return weapon ? weapon.damage_bonus : 0;
}

function getArmorBonus(playerId: number): number {
  const armor = getEquippedArmor(playerId);
  return armor.reduce((sum, a) => sum + a.defense_bonus, 0);
}

export function resolveCombatRound(attacker: Player, defender: Player, options?: { skipDeath?: boolean }): { attacker_result: CombatResult; defender_result: CombatResult; narrative: string; bountyGained: number; bountyClaimed: number } {
  const skipDeath = options?.skipDeath ?? false;
  const atkWeaponBonus = getWeaponBonus(attacker.id);
  const defWeaponBonus = getWeaponBonus(defender.id);
  const atkArmorBonus = getArmorBonus(attacker.id);
  const defArmorBonus = getArmorBonus(defender.id);

  // Initiative
  const atkInit = d20() + Math.floor(attacker.dexterity / 2);
  const defInit = d20() + Math.floor(defender.dexterity / 2);
  const attackerFirst = atkInit >= defInit;

  const [first, second] = attackerFirst ? [attacker, defender] : [defender, attacker];
  const [firstWB, secondWB] = attackerFirst ? [atkWeaponBonus, defWeaponBonus] : [defWeaponBonus, atkWeaponBonus];
  const [_firstAB, secondAB] = attackerFirst ? [atkArmorBonus, defArmorBonus] : [defArmorBonus, atkArmorBonus];
  const [firstAB2, _secondAB2] = attackerFirst ? [atkArmorBonus, defArmorBonus] : [defArmorBonus, atkArmorBonus];

  let firstHp = first.hp;
  let secondHp = second.hp;
  const parts: string[] = [];
  const buffNarrative: string[] = [];

  // First strike
  const r1 = resolveAttack(first, second, firstWB, secondAB, secondHp, buffNarrative);
  secondHp = r1.defender_hp;
  if (buffNarrative.length > 0) {
    parts.push(...buffNarrative);
    buffNarrative.length = 0;
  }

  const firstWeapon = getEquippedWeapon(first.id);
  if (r1.hit) {
    const attackNarrative = getAttackNarrative(first.name, second.name, r1.damage, r1.crit, firstWeapon?.name);
    parts.push(`${attackNarrative}\n(d20: ${r1.attacker_roll} vs AC ${r1.defender_ac} = Hit, ${r1.damage} dmg)`);
  } else {
    const missNarrative = getMissNarrative(first.name, second.name);
    parts.push(`${missNarrative}\n(d20: ${r1.attacker_roll} vs AC ${r1.defender_ac} = Miss)`);
  }

  let secondResult: CombatResult;
  if (secondHp > 0) {
    // Second strike
    secondResult = resolveAttack(second, first, secondWB, firstAB2, firstHp, buffNarrative);
    firstHp = secondResult.defender_hp;
    if (buffNarrative.length > 0) {
      parts.push(...buffNarrative);
      buffNarrative.length = 0;
    }

    const secondWeapon = getEquippedWeapon(second.id);
    if (secondResult.hit) {
      const attackNarrative = getAttackNarrative(second.name, first.name, secondResult.damage, secondResult.crit, secondWeapon?.name);
      parts.push(`${attackNarrative}\n(d20: ${secondResult.attacker_roll} vs AC ${secondResult.defender_ac} = Hit, ${secondResult.damage} dmg)`);
    } else {
      const missNarrative = getMissNarrative(second.name, first.name);
      parts.push(`${missNarrative}\n(d20: ${secondResult.attacker_roll} vs AC ${secondResult.defender_ac} = Miss)`);
    }
  } else {
    secondResult = { attacker_roll: 0, defender_ac: 0, hit: false, damage: 0, crit: false, attacker_hp: secondHp, defender_hp: firstHp, attacker_dead: secondHp <= 0, defender_dead: false };
  }

  // Check for Undying passive (must be done BEFORE HP update)
  let atkHp = attackerFirst ? firstHp : secondHp;
  let defHp = attackerFirst ? secondHp : firstHp;

  if (atkHp <= 0) {
    const undyingBuff = consumeBuff(attacker.id, 'undying');
    if (undyingBuff) {
      atkHp = 1;
      parts.push(`[UNDYING] ${attacker.name} refuses to fall! They survive with 1 HP!`);
    }
  }

  if (defHp <= 0) {
    const undyingBuff = consumeBuff(defender.id, 'undying');
    if (undyingBuff) {
      defHp = 1;
      parts.push(`[UNDYING] ${defender.name} refuses to fall! They survive with 1 HP!`);
    }
  }

  // Update HPs
  updatePlayerHp(attacker.id, Math.max(0, atkHp));
  updatePlayerHp(defender.id, Math.max(0, defHp));

  // Handle deaths (skip in arena mode — caller handles knockout)
  let bountyGained = 0;
  let bountyClaimed = 0;
  if (!skipDeath) {
    if (defHp <= 0) {
      const deathResult = handleDeath(defender, attacker);
      bountyGained = deathResult.bountyGained;
      bountyClaimed = deathResult.bountyClaimed;
      if (deathResult.soulBindUsed) {
        parts.push(`${defender.name}'s soul binding activates! They respawn at their bound tavern, losing 3 levels and all items.`);
      } else {
        parts.push(`${defender.name} has been SLAIN by ${attacker.name}! Permadeath.`);
      }
      if (deathResult.bountyGained > 0) {
        parts.push(`${attacker.name}'s bounty is now ${deathResult.bountyGained}g!`);
      }
      if (deathResult.bountyClaimed > 0) {
        parts.push(`Bounty claimed: ${deathResult.bountyClaimed}g from ${defender.name}!`);
      }
      if (deathResult.activeBountyBoardCount > 0) {
        parts.push(`There are ${deathResult.activeBountyBoardCount} active bounties on ${defender.name}! Use \`claim_bounty\` to collect.`);
      }
    }
    if (atkHp <= 0) {
      const deathResult = handleDeath(attacker, defender);
      // From defender's perspective
      if (deathResult.soulBindUsed) {
        parts.push(`${attacker.name}'s soul binding activates! They respawn at their bound tavern, losing 3 levels and all items.`);
      } else {
        parts.push(`${attacker.name} has been SLAIN by ${defender.name}! Permadeath.`);
      }
      if (deathResult.bountyGained > 0) {
        parts.push(`${defender.name}'s bounty is now ${deathResult.bountyGained}g!`);
      }
      if (deathResult.bountyClaimed > 0) {
        parts.push(`Bounty claimed: ${deathResult.bountyClaimed}g from ${attacker.name}!`);
      }
      if (deathResult.activeBountyBoardCount > 0) {
        parts.push(`There are ${deathResult.activeBountyBoardCount} active bounties on ${attacker.name}! Use \`claim_bounty\` to collect.`);
      }
    }
  }

  const attacker_result: CombatResult = {
    attacker_roll: attackerFirst ? r1.attacker_roll : secondResult.attacker_roll,
    defender_ac: attackerFirst ? r1.defender_ac : secondResult.defender_ac,
    hit: attackerFirst ? r1.hit : secondResult.hit,
    damage: attackerFirst ? r1.damage : secondResult.damage,
    crit: attackerFirst ? r1.crit : secondResult.crit,
    attacker_hp: Math.max(0, atkHp),
    defender_hp: Math.max(0, defHp),
    attacker_dead: atkHp <= 0,
    defender_dead: defHp <= 0,
  };

  const defender_result: CombatResult = {
    attacker_roll: attackerFirst ? secondResult.attacker_roll : r1.attacker_roll,
    defender_ac: attackerFirst ? secondResult.defender_ac : r1.defender_ac,
    hit: attackerFirst ? secondResult.hit : r1.hit,
    damage: attackerFirst ? secondResult.damage : r1.damage,
    crit: attackerFirst ? secondResult.crit : r1.crit,
    attacker_hp: Math.max(0, defHp),
    defender_hp: Math.max(0, atkHp),
    attacker_dead: defHp <= 0,
    defender_dead: atkHp <= 0,
  };

  return {
    attacker_result,
    defender_result,
    narrative: parts.join('\n'),
    bountyGained,
    bountyClaimed,
  };
}

function resolveAttack(
  attacker: Player, defender: Player,
  weaponBonus: number, armorBonus: number, defenderHp: number,
  buffNarrative: string[]
): CombatResult {
  // Consume attacker's offensive buffs
  const rageBuff = consumeBuff(attacker.id, 'rage');
  const stealthBuff = consumeBuff(attacker.id, 'stealth');
  const inspireBuff = consumeBuff(attacker.id, 'inspire');
  const luckyStrikeBuff = consumeBuff(attacker.id, 'lucky_strike');
  const powerStrikeBuff = consumeBuff(attacker.id, 'power_strike');
  const titansGripBuff = consumeBuff(attacker.id, 'titans_grip');
  const assassinateBuff = consumeBuff(attacker.id, 'assassinate');

  const stealthBonus = stealthBuff ? stealthBuff.value : 0;
  const inspireBonus = inspireBuff ? inspireBuff.value : 0;

  if (rageBuff) buffNarrative.push(`[RAGE] ${attacker.name}'s fury empowers their attack!`);
  if (stealthBuff) buffNarrative.push(`[STEALTH] ${attacker.name} strikes from the shadows! (+5 to hit)`);
  if (inspireBuff) buffNarrative.push(`[INSPIRE] ${attacker.name} feels inspired! (+2 to hit)`);
  if (luckyStrikeBuff) buffNarrative.push(`[LUCKY STRIKE] Fortune guides ${attacker.name}'s blade!`);
  if (powerStrikeBuff) buffNarrative.push(`[POWER STRIKE] ${attacker.name} strikes with precision, ignoring defenses!`);
  if (titansGripBuff) buffNarrative.push(`[TITAN'S GRIP] ${attacker.name}'s attack is empowered! (+50% damage)`);
  if (assassinateBuff) buffNarrative.push(`[ASSASSINATE] ${attacker.name} delivers a LETHAL STRIKE!`);

  // Consume defender's defensive buffs
  const fortifyBuff = consumeBuff(defender.id, 'fortify');
  const rageAcPenalty = consumeBuff(defender.id, 'rage_ac_penalty');
  const paladinsShieldBuff = consumeBuff(defender.id, 'paladins_shield');

  let acModifier = 0;
  if (fortifyBuff) {
    acModifier += fortifyBuff.value;
    buffNarrative.push(`[FORTIFY] ${defender.name}'s defenses hold strong! (+${fortifyBuff.value} AC)`);
  }
  if (paladinsShieldBuff) {
    acModifier += paladinsShieldBuff.value;
    buffNarrative.push(`[PALADIN'S SHIELD] ${defender.name} is protected by holy light! (+${paladinsShieldBuff.value} AC)`);
  }
  if (rageAcPenalty) {
    acModifier -= rageAcPenalty.value;
    buffNarrative.push(`[RAGE PENALTY] ${defender.name}'s reckless fury leaves them exposed! (-${rageAcPenalty.value} AC)`);
  }

  const attackRoll = d20() + Math.floor(attacker.strength / 2) + weaponBonus + stealthBonus + inspireBonus;
  // Power Strike ignores armor bonus
  const effectiveArmorBonus = powerStrikeBuff ? 0 : armorBonus;
  const ac = 10 + Math.floor(defender.constitution / 3) + effectiveArmorBonus + acModifier;
  const hit = attackRoll >= ac;

  let damage = 0;
  let crit = false;

  if (hit) {
    // Assassinate: fixed damage, auto-crit
    if (assassinateBuff) {
      damage = assassinateBuff.value;
      crit = true;
    } else {
      damage = Math.max(1, d6() + Math.floor(attacker.strength / 3) + weaponBonus);

      // Lucky Strike: 50% crit chance
      if (luckyStrikeBuff) {
        if (Math.random() < luckyStrikeBuff.value) {
          crit = true;
          damage *= 2;
        }
      } else {
        const critRoll = d20();
        if (critRoll <= Math.min(MAX_CRIT_CHANCE, Math.floor(attacker.luck / 2))) {
          crit = true;
          damage *= 2;
        }
      }

      // Rage: double damage (stacks with crit)
      if (rageBuff) {
        damage *= 2;
      }

      // Titan's Grip: +50% damage
      if (titansGripBuff) {
        damage = Math.floor(damage * 1.5);
      }
    }

    // Ensure minimum 1 damage on hit
    damage = Math.max(1, damage);
    defenderHp -= damage;
  }

  return {
    attacker_roll: attackRoll,
    defender_ac: ac,
    hit,
    damage,
    crit,
    attacker_hp: attacker.hp,
    defender_hp: Math.max(0, defenderHp),
    attacker_dead: false,
    defender_dead: defenderHp <= 0,
  };
}

export function handleDeath(victim: Player, killer: Player): { bountyGained: number; bountyClaimed: number; activeBountyBoardCount: number; soulBindUsed?: boolean } {
  const db = getDb();

  // Check for active soul binding (PvP death insurance)
  const soulBinding = getActiveSoulBinding(victim.id);
  if (soulBinding) {
    // Respawn instead of permadeath
    const respawnResult = handleSoulBindRespawn(victim, killer, soulBinding);
    return respawnResult;
  }
  let bountyGained = 0;
  let bountyClaimed = 0;

  // Check for player-placed bounties on the victim before the transaction
  const activeBoardBounties = getActiveBountiesOnPlayer(victim.id);
  const activeBountyBoardCount = activeBoardBounties.length;

  const runInTransaction = db.transaction(() => {
    killPlayer(victim.id, `Slain by ${killer.name}`);

    // Drop all items
    const items = getItemsByOwner(victim.id);
    for (const item of items) {
      dropAtLocation(item.id, victim.chunk_x, victim.chunk_y, victim.location_id);
    }

    // Drop gold as item
    if (victim.gold > 0) {
      createItem('Gold Pouch', `A pouch containing ${victim.gold} gold, dropped by ${victim.name}.`, 'currency', {
        value: victim.gold,
        chunk_x: victim.chunk_x,
        chunk_y: victim.chunk_y,
        location_id: victim.location_id,
      });
      updatePlayerGold(victim.id, 0);
    }

    // XP reward
    const freshKiller = getPlayerById(killer.id)!;
    const baseXpGain = victim.level * 50;
    const levelDiff = freshKiller.level - victim.level;
    const downscalePenalty = levelDiff > 0 ? Math.max(0.2, 1 - levelDiff * 0.15) : 1; // killing lower-level = less XP
    const xpGain = Math.min(150, Math.floor(baseXpGain * downscalePenalty)); // hard cap at 150 XP per kill
    const levelResult = addXp(killer.id, xpGain);

    // Bounty: killer gains bounty for PvP kill
    const bountyResult = addBounty(killer.id);
    bountyGained = bountyResult.newBounty;

    // Bounty: if victim had a bounty, killer claims it
    const claimResult = claimBounty(victim.id, killer.id);
    bountyClaimed = claimResult.bountyAmount;

    // Increment killer's total_pvp_kills
    db.prepare('UPDATE players SET total_pvp_kills = total_pvp_kills + 1 WHERE id = ?').run(killer.id);

    // Check pvp_kill achievement
    checkAndUnlock(killer.id, 'pvp_kill');

    logEvent('kill', killer.id, victim.id, victim.chunk_x, victim.chunk_y, victim.location_id, {
      xp_gained: xpGain,
      leveled_up: levelResult.leveled_up,
      new_level: levelResult.new_level,
      bounty_gained: bountyGained,
      bounty_claimed: bountyClaimed,
      active_bounty_board_count: activeBountyBoardCount,
    });
  });
  runInTransaction();

  return { bountyGained, bountyClaimed, activeBountyBoardCount };
}

function handleSoulBindRespawn(
  victim: Player, killer: Player, binding: SoulBinding
): { bountyGained: number; bountyClaimed: number; activeBountyBoardCount: number; soulBindUsed: boolean } {
  const db = getDb();
  
  const SOUL_BIND_LEVEL_PENALTY = 3;
  
  const runRespawn = db.transaction(() => {
    // Drop all items at death location
    const items = getItemsByOwner(victim.id);
    for (const item of items) {
      dropAtLocation(item.id, victim.chunk_x, victim.chunk_y, victim.location_id);
    }
    
    // Drop gold as item
    if (victim.gold > 0) {
      createItem('Gold Pouch', `A pouch containing ${victim.gold} gold, dropped by ${victim.name}.`, 'currency', {
        value: victim.gold,
        chunk_x: victim.chunk_x,
        chunk_y: victim.chunk_y,
        location_id: victim.location_id,
      });
      updatePlayerGold(victim.id, 0);
    }
    
    // Lose 3 levels (minimum level 1)
    const newLevel = Math.max(1, victim.level - SOUL_BIND_LEVEL_PENALTY);
    const hpLoss = (victim.level - newLevel) * 10; // 10 HP per level
    const newMaxHp = Math.max(50, victim.max_hp - hpLoss);
    const newHp = Math.max(1, Math.floor(newMaxHp * 0.5)); // Respawn at 50% of new max
    
    // Recalculate XP for new level
    const newXp = 0; // Reset XP progress within the new level
    
    // Move to binding tavern
    db.prepare(
      `UPDATE players SET 
        level = ?, max_hp = ?, hp = ?, xp = ?, gold = 0,
        chunk_x = ?, chunk_y = ?, location_id = ?,
        last_active_at = datetime('now')
      WHERE id = ?`
    ).run(newLevel, newMaxHp, newHp, newXp, 
          binding.tavern_chunk_x, binding.tavern_chunk_y, binding.tavern_location_id,
          victim.id);
    
    // XP reward for killer (same as normal)
    const freshKiller = getPlayerById(killer.id)!;
    const baseXpGain = victim.level * 50;
    const levelDiff = freshKiller.level - victim.level;
    const downscalePenalty = levelDiff > 0 ? Math.max(0.2, 1 - levelDiff * 0.15) : 1;
    const xpGain = Math.min(150, Math.floor(baseXpGain * downscalePenalty));
    addXp(killer.id, xpGain);
    
    // Bounty still applies
    const bountyResult = addBounty(killer.id);
    const claimResult = claimBounty(victim.id, killer.id);
    
    // Increment killer's PvP kills
    db.prepare('UPDATE players SET total_pvp_kills = total_pvp_kills + 1 WHERE id = ?').run(killer.id);
    
    // Consume the soul binding
    removeSoulBinding(victim.id);
    
    logEvent('soul_bind_death', killer.id, victim.id, victim.chunk_x, victim.chunk_y, victim.location_id, {
      xp_gained: xpGain,
      levels_lost: victim.level - newLevel,
      new_level: newLevel,
      respawn_location: `${binding.tavern_chunk_x},${binding.tavern_chunk_y}`,
    });
    
    return { bountyGained: bountyResult.newBounty, bountyClaimed: claimResult.bountyAmount };
  });
  
  const result = runRespawn();
  const activeBoardBounties = getActiveBountiesOnPlayer(victim.id);
  
  return { 
    ...result, 
    activeBountyBoardCount: activeBoardBounties.length,
    soulBindUsed: true 
  };
}
