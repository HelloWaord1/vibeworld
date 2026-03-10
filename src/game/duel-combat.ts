import { d20, d6 } from './dice.js';
import type { Player } from '../types/index.js';
import { MAX_CRIT_CHANCE } from '../types/index.js';
import { getEquippedWeapon, getEquippedArmor } from '../models/item.js';
import { updatePlayerHp, addXp, updatePlayerGold } from '../models/player.js';
import { consumeBuff } from './abilities.js';

function getWeaponBonus(playerId: number): number {
  const weapon = getEquippedWeapon(playerId);
  return weapon ? weapon.damage_bonus : 0;
}

function getArmorBonus(playerId: number): number {
  const armor = getEquippedArmor(playerId);
  return armor.reduce((sum, a) => sum + a.defense_bonus, 0);
}

interface DuelAttackResult {
  attacker_roll: number;
  defender_ac: number;
  hit: boolean;
  damage: number;
  crit: boolean;
  attacker_hp: number;
  defender_hp: number;
}

function resolveDuelAttack(
  attacker: Player,
  defender: Player,
  weaponBonus: number,
  armorBonus: number,
  defenderHp: number,
  buffNarrative: string[]
): DuelAttackResult {
  // Consume attacker's offensive buffs
  const rageBuff = consumeBuff(attacker.id, 'rage');
  const stealthBuff = consumeBuff(attacker.id, 'stealth');
  const inspireBuff = consumeBuff(attacker.id, 'inspire');
  const luckyStrikeBuff = consumeBuff(attacker.id, 'lucky_strike');

  const stealthBonus = stealthBuff ? stealthBuff.value : 0;
  const inspireBonus = inspireBuff ? inspireBuff.value : 0;

  if (rageBuff) buffNarrative.push(`[RAGE] ${attacker.name}'s fury empowers their attack!`);
  if (stealthBuff) buffNarrative.push(`[STEALTH] ${attacker.name} strikes from the shadows! (+5 to hit)`);
  if (inspireBuff) buffNarrative.push(`[INSPIRE] ${attacker.name} feels inspired! (+2 to hit)`);
  if (luckyStrikeBuff) buffNarrative.push(`[LUCKY STRIKE] Fortune guides ${attacker.name}'s blade!`);

  // Consume defender's defensive buffs
  const fortifyBuff = consumeBuff(defender.id, 'fortify');
  const rageAcPenalty = consumeBuff(defender.id, 'rage_ac_penalty');

  let acModifier = 0;
  if (fortifyBuff) {
    acModifier += fortifyBuff.value;
    buffNarrative.push(`[FORTIFY] ${defender.name}'s defenses hold strong! (+${fortifyBuff.value} AC)`);
  }
  if (rageAcPenalty) {
    acModifier -= rageAcPenalty.value;
    buffNarrative.push(`[RAGE PENALTY] ${defender.name}'s reckless fury leaves them exposed! (-${rageAcPenalty.value} AC)`);
  }

  const attackRoll = d20() + Math.floor(attacker.strength / 2) + weaponBonus + stealthBonus + inspireBonus;
  const ac = 10 + Math.floor(defender.constitution / 3) + armorBonus + acModifier;
  const hit = attackRoll >= ac;

  let damage = 0;
  let crit = false;

  if (hit) {
    damage = Math.max(1, d6() + Math.floor(attacker.strength / 3) + weaponBonus);

    // Lucky Strike: auto-crit on hit
    if (luckyStrikeBuff) {
      crit = true;
      damage *= 2;
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
    defender_hp: Math.max(1, defenderHp), // Non-lethal: min 1 HP
  };
}

export interface DuelResult {
  narrative: string;
  winner: Player;
  loser: Player;
  wagerGold: number;
}

/**
 * Resolve a full duel combat between challenger and target.
 * Uses same d20 combat system as PvP but NON-LETHAL:
 * - Combat continues until one player hits 1 HP (not 0)
 * - Loser stays at 1 HP (no death)
 * - Winner gets wager gold from loser
 * - Both get XP (winner: 25, loser: 10)
 */
export function resolveDuelCombat(challenger: Player, target: Player, wager: number): DuelResult {
  const parts: string[] = [];
  const buffNarrative: string[] = [];

  let challengerHp = challenger.hp;
  let targetHp = target.hp;

  const atkWeaponBonus = getWeaponBonus(challenger.id);
  const defWeaponBonus = getWeaponBonus(target.id);
  const atkArmorBonus = getArmorBonus(challenger.id);
  const defArmorBonus = getArmorBonus(target.id);

  // Combat rounds until someone hits 1 HP
  let round = 1;
  while (challengerHp > 1 && targetHp > 1) {
    parts.push(`\n--- Round ${round} ---`);

    // Initiative
    const atkInit = d20() + Math.floor(challenger.dexterity / 2);
    const defInit = d20() + Math.floor(target.dexterity / 2);
    const attackerFirst = atkInit >= defInit;

    const [first, second] = attackerFirst ? [challenger, target] : [target, challenger];
    const [firstWB, secondWB] = attackerFirst ? [atkWeaponBonus, defWeaponBonus] : [defWeaponBonus, atkWeaponBonus];
    const [_firstAB, secondAB] = attackerFirst ? [atkArmorBonus, defArmorBonus] : [defArmorBonus, atkArmorBonus];
    const [firstAB2, _secondAB2] = attackerFirst ? [atkArmorBonus, defArmorBonus] : [defArmorBonus, atkArmorBonus];

    let firstHp = attackerFirst ? challengerHp : targetHp;
    let secondHp = attackerFirst ? targetHp : challengerHp;

    // First strike
    const r1 = resolveDuelAttack(first, second, firstWB, secondAB, secondHp, buffNarrative);
    secondHp = r1.defender_hp;
    if (buffNarrative.length > 0) {
      parts.push(...buffNarrative);
      buffNarrative.length = 0;
    }
    parts.push(`${first.name} rolls ${r1.attacker_roll} vs AC ${r1.defender_ac}: ${r1.hit ? (r1.crit ? 'CRITICAL HIT' : 'Hit') : 'Miss'}${r1.hit ? ` for ${r1.damage} damage` : ''}`);

    // Check if second is knocked out
    if (secondHp <= 1) {
      secondHp = 1;
      parts.push(`${second.name} is knocked out!`);
      if (attackerFirst) {
        targetHp = secondHp;
      } else {
        challengerHp = secondHp;
      }
      break;
    }

    // Second strike
    const r2 = resolveDuelAttack(second, first, secondWB, firstAB2, firstHp, buffNarrative);
    firstHp = r2.defender_hp;
    if (buffNarrative.length > 0) {
      parts.push(...buffNarrative);
      buffNarrative.length = 0;
    }
    parts.push(`${second.name} rolls ${r2.attacker_roll} vs AC ${r2.defender_ac}: ${r2.hit ? (r2.crit ? 'CRITICAL HIT' : 'Hit') : 'Miss'}${r2.hit ? ` for ${r2.damage} damage` : ''}`);

    // Check if first is knocked out
    if (firstHp <= 1) {
      firstHp = 1;
      parts.push(`${first.name} is knocked out!`);
      if (attackerFirst) {
        challengerHp = firstHp;
      } else {
        targetHp = firstHp;
      }
      break;
    }

    // Update HPs for next round
    if (attackerFirst) {
      challengerHp = firstHp;
      targetHp = secondHp;
    } else {
      challengerHp = secondHp;
      targetHp = firstHp;
    }

    parts.push(`${challenger.name}: ${challengerHp} HP | ${target.name}: ${targetHp} HP`);
    round++;

    // Safety: max 50 rounds
    if (round > 50) {
      parts.push('Duel reaches stalemate after 50 rounds. Draw!');
      challengerHp = Math.max(challengerHp, 1);
      targetHp = Math.max(targetHp, 1);
      break;
    }
  }

  // Determine winner/loser
  const winner = challengerHp > targetHp ? challenger : target;
  const loser = challengerHp > targetHp ? target : challenger;

  // Update HPs (loser at 1 HP, winner at current)
  updatePlayerHp(winner.id, challengerHp > targetHp ? challengerHp : targetHp);
  updatePlayerHp(loser.id, 1);

  // Transfer wager gold
  if (wager > 0) {
    updatePlayerGold(loser.id, Math.max(0, loser.gold - wager));
    updatePlayerGold(winner.id, winner.gold + wager);
  }

  // Award XP
  addXp(winner.id, 25);
  addXp(loser.id, 10);

  return {
    narrative: parts.join('\n'),
    winner,
    loser,
    wagerGold: wager,
  };
}
