import type { Player } from '../types/index.js';
import { checkCooldown, setCooldown } from '../server/cooldown.js';
import { getPlayerById, updatePlayerHp } from '../models/player.js';
import { getPlayersAtChunk } from '../models/player.js';
import { getDb } from '../db/connection.js';

// --- Ability Definitions ---

export interface Ability {
  name: string;
  description: string;
  stat_requirement: { stat: string; min: number };
  cooldown_ms: number;
  effect: 'buff' | 'heal' | 'damage' | 'utility';
}

export const ABILITIES: readonly Ability[] = [
  // STR abilities
  {
    name: 'Rage',
    description: 'Next attack deals double damage, but -3 AC for 1 round.',
    stat_requirement: { stat: 'strength', min: 8 },
    cooldown_ms: 45_000,
    effect: 'buff',
  },
  {
    name: 'Power Strike',
    description: "Next attack ignores target's defense bonus.",
    stat_requirement: { stat: 'strength', min: 12 },
    cooldown_ms: 60_000,
    effect: 'buff',
  },
  {
    name: 'Titan\'s Grip',
    description: 'Next 3 attacks deal +50% damage.',
    stat_requirement: { stat: 'strength', min: 18 },
    cooldown_ms: 120_000,
    effect: 'buff',
  },
  // DEX abilities
  {
    name: 'Stealth',
    description: 'Next attack has +5 to hit (ambush bonus).',
    stat_requirement: { stat: 'dexterity', min: 8 },
    cooldown_ms: 45_000,
    effect: 'buff',
  },
  {
    name: 'Riposte',
    description: 'After dodging, auto-counter attack for DEX/2 damage. Passive (auto-triggers on dodge). 30s internal CD.',
    stat_requirement: { stat: 'dexterity', min: 12 },
    cooldown_ms: 30_000,
    effect: 'buff',
  },
  {
    name: 'Shadow Step',
    description: 'Flee from combat guaranteed (no roll needed).',
    stat_requirement: { stat: 'dexterity', min: 18 },
    cooldown_ms: 90_000,
    effect: 'utility',
  },
  // CON abilities
  {
    name: 'Fortify',
    description: '+3 AC for next 2 incoming attacks.',
    stat_requirement: { stat: 'constitution', min: 8 },
    cooldown_ms: 45_000,
    effect: 'buff',
  },
  {
    name: 'Second Wind',
    description: 'Instantly heal 25% max HP.',
    stat_requirement: { stat: 'constitution', min: 12 },
    cooldown_ms: 120_000,
    effect: 'heal',
  },
  {
    name: 'Undying',
    description: 'When knocked to 0 HP, survive with 1 HP once. Passive, 300s internal CD.',
    stat_requirement: { stat: 'constitution', min: 18 },
    cooldown_ms: 300_000,
    effect: 'buff',
  },
  // CHA abilities
  {
    name: 'Intimidate',
    description: 'Force monster to skip next attack (PvE only).',
    stat_requirement: { stat: 'charisma', min: 10 },
    cooldown_ms: 60_000,
    effect: 'utility',
  },
  {
    name: 'Bargain',
    description: 'Next shop purchase is 50% off.',
    stat_requirement: { stat: 'charisma', min: 15 },
    cooldown_ms: 300_000,
    effect: 'utility',
  },
  // LUK abilities
  {
    name: 'Lucky Strike',
    description: 'Next attack has 50% crit chance.',
    stat_requirement: { stat: 'luck', min: 10 },
    cooldown_ms: 90_000,
    effect: 'buff',
  },
  {
    name: 'Fortune\'s Favor',
    description: 'Next monster kill drops double loot.',
    stat_requirement: { stat: 'luck', min: 15 },
    cooldown_ms: 180_000,
    effect: 'buff',
  },
  // Combo abilities
  {
    name: 'Assassinate',
    description: 'Massive single hit: (STR + DEX) damage, auto-crit. Requires STR 10 + DEX 10.',
    stat_requirement: { stat: 'strength', min: 10 }, // Primary stat checked first
    cooldown_ms: 180_000,
    effect: 'damage',
  },
  {
    name: 'Paladin\'s Shield',
    description: 'Heal 15% HP and +5 AC for 3 rounds. Requires CON 10 + CHA 10.',
    stat_requirement: { stat: 'constitution', min: 10 }, // Primary stat checked first
    cooldown_ms: 120_000,
    effect: 'buff',
  },
] as const;

// --- Active Buff System (SQLite-backed) ---

export type BuffType =
  | 'rage'
  | 'stealth'
  | 'inspire'
  | 'lucky_strike'
  | 'fortify'
  | 'rage_ac_penalty'
  | 'power_strike'
  | 'titans_grip'
  | 'riposte'
  | 'shadow_step'
  | 'second_wind'
  | 'undying'
  | 'intimidate'
  | 'bargain'
  | 'fortunes_favor'
  | 'assassinate'
  | 'paladins_shield';

export interface ActiveBuff {
  readonly type: BuffType;
  readonly expiresAt: number;
  readonly charges: number;
  readonly value: number;
}

interface BuffRow {
  player_id: number;
  buff_type: string;
  expires_at: string;
  charges: number;
  value: number;
}

function toEpochMs(sqliteDatetime: string): number {
  return new Date(sqliteDatetime + 'Z').getTime();
}

function toSqliteDatetime(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('Z', '').replace('T', ' ').split('.')[0];
}

function rowToBuff(row: BuffRow): ActiveBuff {
  return {
    type: row.buff_type as BuffType,
    expiresAt: toEpochMs(row.expires_at),
    charges: row.charges,
    value: row.value,
  };
}

function addBuff(playerId: number, buff: ActiveBuff): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO active_buffs (player_id, buff_type, expires_at, charges, value)
     VALUES (?, ?, ?, ?, ?)`
  ).run(playerId, buff.type, toSqliteDatetime(buff.expiresAt), buff.charges, buff.value);
}

// --- Cooldown Keys ---

function abilityCooldownKey(abilityName: string): string {
  return `ability_${abilityName.toLowerCase().replace(/\s+/g, '_')}`;
}

// --- Stat Lookup ---

function getPlayerStat(player: Player, stat: string): number {
  switch (stat) {
    case 'strength': return player.strength;
    case 'dexterity': return player.dexterity;
    case 'constitution': return player.constitution;
    case 'charisma': return player.charisma;
    case 'luck': return player.luck;
    default: return 0;
  }
}

// --- Public API ---

export function getAvailableAbilities(player: Player): Ability[] {
  return ABILITIES.filter(
    ability => getPlayerStat(player, ability.stat_requirement.stat) >= ability.stat_requirement.min
  );
}

export function getAbilityCooldownRemaining(playerId: number, abilityName: string): number | null {
  return checkCooldown(playerId, abilityCooldownKey(abilityName));
}

export function activateAbility(playerId: number, abilityName: string): string {
  const player = getPlayerById(playerId);
  if (!player) return 'Player not found.';

  const ability = ABILITIES.find(
    a => a.name.toLowerCase() === abilityName.toLowerCase()
  );
  if (!ability) return `Unknown ability: "${abilityName}". Use \`abilities\` to see your available abilities.`;

  // Check stat requirement
  const statValue = getPlayerStat(player, ability.stat_requirement.stat);
  if (statValue < ability.stat_requirement.min) {
    return `You need ${ability.stat_requirement.stat.toUpperCase()} ${ability.stat_requirement.min}+ to use ${ability.name}. (Current: ${statValue})`;
  }

  // Check combo ability secondary requirements
  if (ability.name === 'Assassinate') {
    if (player.dexterity < 10) {
      return `Assassinate requires STR 10 + DEX 10. (Current: STR ${player.strength}, DEX ${player.dexterity})`;
    }
  }
  if (ability.name === 'Paladin\'s Shield') {
    if (player.charisma < 10) {
      return `Paladin's Shield requires CON 10 + CHA 10. (Current: CON ${player.constitution}, CHA ${player.charisma})`;
    }
  }

  // Check cooldown
  const cdRemaining = checkCooldown(playerId, abilityCooldownKey(ability.name));
  if (cdRemaining !== null) {
    return `${ability.name} is on cooldown for ${cdRemaining} more seconds.`;
  }

  // Set cooldown
  setCooldown(playerId, abilityCooldownKey(ability.name), ability.cooldown_ms);

  const buffExpiry = Date.now() + 120_000; // buffs expire after 2 minutes if not consumed

  // Apply effect based on ability
  switch (ability.name) {
    case 'Rage': {
      addBuff(playerId, { type: 'rage', expiresAt: buffExpiry, charges: 1, value: 2 });
      addBuff(playerId, { type: 'rage_ac_penalty', expiresAt: buffExpiry, charges: 1, value: 3 });
      return 'RAGE activated! Your next attack deals double damage, but your AC is reduced by 3 for the next incoming attack.';
    }
    case 'Power Strike': {
      addBuff(playerId, { type: 'power_strike', expiresAt: buffExpiry, charges: 1, value: 1 });
      return 'You channel your strength into a precise strike. Next attack ignores target\'s defense bonus!';
    }
    case 'Titan\'s Grip': {
      addBuff(playerId, { type: 'titans_grip', expiresAt: buffExpiry, charges: 3, value: 1.5 });
      return 'Your grip tightens with titan strength! Next 3 attacks deal +50% damage.';
    }
    case 'Stealth': {
      addBuff(playerId, { type: 'stealth', expiresAt: buffExpiry, charges: 1, value: 5 });
      return 'You melt into the shadows. Next attack has +5 to hit.';
    }
    case 'Riposte': {
      addBuff(playerId, { type: 'riposte', expiresAt: buffExpiry, charges: 999, value: 1 });
      return 'Riposte stance enabled. You will counter-attack when you successfully dodge (30s internal CD per trigger).';
    }
    case 'Shadow Step': {
      addBuff(playerId, { type: 'shadow_step', expiresAt: buffExpiry, charges: 1, value: 1 });
      return 'You prepare to vanish into shadows. Your next flee attempt cannot fail!';
    }
    case 'Fortify': {
      addBuff(playerId, { type: 'fortify', expiresAt: buffExpiry, charges: 2, value: 3 });
      return 'You brace yourself. +3 AC for the next 2 incoming attacks.';
    }
    case 'Second Wind': {
      const fresh = getPlayerById(playerId)!;
      const healAmount = Math.floor(fresh.max_hp * 0.25);
      const newHp = Math.min(fresh.hp + healAmount, fresh.max_hp);
      updatePlayerHp(playerId, newHp);
      return `You catch your breath and rally. Restored ${newHp - fresh.hp} HP. (${newHp}/${fresh.max_hp})`;
    }
    case 'Undying': {
      addBuff(playerId, { type: 'undying', expiresAt: buffExpiry, charges: 1, value: 1 });
      return 'Undying will activates! If you would be knocked to 0 HP, you survive with 1 HP instead (once).';
    }
    case 'Intimidate': {
      addBuff(playerId, { type: 'intimidate', expiresAt: buffExpiry, charges: 1, value: 1 });
      return 'You let out a blood-curdling roar! The next monster you fight will cower in fear and skip its first attack.';
    }
    case 'Bargain': {
      addBuff(playerId, { type: 'bargain', expiresAt: buffExpiry, charges: 1, value: 0.5 });
      return 'Your silver tongue is ready. Next shop purchase is 50% off!';
    }
    case 'Lucky Strike': {
      addBuff(playerId, { type: 'lucky_strike', expiresAt: buffExpiry, charges: 1, value: 0.5 });
      return 'Fortune smiles upon you. Your next attack has a 50% crit chance!';
    }
    case 'Fortune\'s Favor': {
      addBuff(playerId, { type: 'fortunes_favor', expiresAt: buffExpiry, charges: 1, value: 2 });
      return 'Lady Luck herself watches over you. Your next monster kill will drop DOUBLE loot!';
    }
    case 'Assassinate': {
      addBuff(playerId, { type: 'assassinate', expiresAt: buffExpiry, charges: 1, value: player.strength + player.dexterity });
      return `You prepare for a lethal strike! Next attack deals ${player.strength + player.dexterity} damage and automatically crits.`;
    }
    case 'Paladin\'s Shield': {
      const fresh = getPlayerById(playerId)!;
      const healAmount = Math.floor(fresh.max_hp * 0.15);
      const newHp = Math.min(fresh.hp + healAmount, fresh.max_hp);
      updatePlayerHp(playerId, newHp);
      addBuff(playerId, { type: 'paladins_shield', expiresAt: buffExpiry, charges: 3, value: 5 });
      return `Holy light surrounds you! Healed ${newHp - fresh.hp} HP. +5 AC for next 3 attacks. (${newHp}/${fresh.max_hp})`;
    }
    default:
      return `Ability "${ability.name}" has no implementation.`;
  }
}

export function getActiveBuffs(playerId: number): ActiveBuff[] {
  const db = getDb();
  const now = toSqliteDatetime(Date.now());

  // Clean expired buffs and return active ones in a single operation
  db.prepare(
    `DELETE FROM active_buffs WHERE player_id = ? AND expires_at <= ?`
  ).run(playerId, now);

  const rows = db.prepare(
    `SELECT player_id, buff_type, expires_at, charges, value
     FROM active_buffs WHERE player_id = ? AND expires_at > ?`
  ).all(playerId, now) as BuffRow[];

  return rows.map(rowToBuff);
}

/**
 * Consume a buff of the given type. Returns the buff data if active, or null.
 * Decrements charges; removes buff when charges reach 0.
 */
export function consumeBuff(playerId: number, buffType: BuffType): ActiveBuff | null {
  const db = getDb();
  const now = toSqliteDatetime(Date.now());

  const row = db.prepare(
    `SELECT player_id, buff_type, expires_at, charges, value
     FROM active_buffs WHERE player_id = ? AND buff_type = ?`
  ).get(playerId, buffType) as BuffRow | undefined;

  if (!row) return null;

  // Check if expired
  if (toEpochMs(row.expires_at) <= Date.now()) {
    db.prepare(
      `DELETE FROM active_buffs WHERE player_id = ? AND buff_type = ?`
    ).run(playerId, buffType);
    return null;
  }

  const buff = rowToBuff(row);

  if (buff.charges <= 1) {
    db.prepare(
      `DELETE FROM active_buffs WHERE player_id = ? AND buff_type = ?`
    ).run(playerId, buffType);
  } else {
    db.prepare(
      `UPDATE active_buffs SET charges = charges - 1 WHERE player_id = ? AND buff_type = ?`
    ).run(playerId, buffType);
  }

  return buff;
}

// --- Buff name display helper ---

export function buffTypeName(type: BuffType): string {
  switch (type) {
    case 'rage': return 'Rage (2x damage)';
    case 'stealth': return 'Stealth (+5 hit)';
    case 'inspire': return 'Inspire (+2 attack)';
    case 'lucky_strike': return 'Lucky Strike (50% crit)';
    case 'fortify': return 'Fortify (+3 AC)';
    case 'rage_ac_penalty': return 'Rage (-3 AC)';
    case 'power_strike': return 'Power Strike (ignore def)';
    case 'titans_grip': return 'Titan\'s Grip (+50% dmg)';
    case 'riposte': return 'Riposte (counter on dodge)';
    case 'shadow_step': return 'Shadow Step (guaranteed flee)';
    case 'second_wind': return 'Second Wind';
    case 'undying': return 'Undying (death save)';
    case 'intimidate': return 'Intimidate (skip attack)';
    case 'bargain': return 'Bargain (50% off)';
    case 'fortunes_favor': return 'Fortune\'s Favor (2x loot)';
    case 'assassinate': return 'Assassinate (mega crit)';
    case 'paladins_shield': return 'Paladin\'s Shield (+5 AC)';
    default: return type;
  }
}
