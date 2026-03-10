/**
 * Combat narrative generation
 * Provides flavor text for combat events to make battles more immersive
 */

const ATTACK_NARRATIVES = [
  "Your {weapon} strikes true, tearing into {defender} for {damage} damage!",
  "A devastating blow connects with {defender}, dealing {damage} damage!",
  "You unleash a powerful attack on {defender}, inflicting {damage} damage!",
  "{defender} staggers as your attack lands for {damage} damage!",
  "Your weapon finds its mark, cutting {defender} for {damage} damage!",
];

const CRIT_NARRATIVES = [
  "CRITICAL HIT! Your {weapon} cleaves through {defender}'s defenses for a devastating {damage} damage!",
  "A PERFECT STRIKE! {defender} reels from the critical blow — {damage} damage!",
  "CRITICAL! Your attack finds a vital point on {defender}, dealing {damage} damage!",
  "DEVASTATING BLOW! {defender} takes a crushing {damage} damage from your critical hit!",
  "MASTERFUL STRIKE! Your {weapon} lands a critical hit on {defender} for {damage} damage!",
];

const MISS_NARRATIVES = [
  "Your attack goes wide, missing {defender} completely.",
  "{defender} sidesteps your strike with ease.",
  "You swing at {defender}, but they're too quick!",
  "Your weapon slices through empty air as {defender} evades.",
  "The attack fails to connect — {defender} is untouched.",
];

const DODGE_NARRATIVES = [
  "{defender} deftly dodges your attack!",
  "{defender} gracefully sidesteps, avoiding all damage!",
  "With incredible agility, {defender} evades your strike!",
  "{defender} sees it coming and rolls away!",
  "Your attack is avoided — {defender} is too nimble!",
];

const KILL_NARRATIVES = [
  "{attacker} delivers the killing blow to {defender}!",
  "{defender} falls before {attacker}'s onslaught!",
  "With a final strike, {attacker} slays {defender}!",
  "{defender} has been vanquished by {attacker}!",
  "{attacker} stands victorious over {defender}'s corpse!",
];

const KNOCKOUT_NARRATIVES = [
  "You strike down {monster}, sending it crashing to the ground!",
  "The {monster} lets out a final cry before collapsing!",
  "Your attack fells the {monster}!",
  "Victory! The {monster} has been defeated!",
  "The {monster} falls lifeless at your feet!",
];

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getWeaponName(weaponType?: string): string {
  if (!weaponType) return 'weapon';
  return weaponType.toLowerCase();
}

/**
 * Get narrative text for a successful attack
 */
export function getAttackNarrative(
  attacker: string,
  defender: string,
  damage: number,
  isCrit: boolean,
  weaponType?: string
): string {
  const weapon = getWeaponName(weaponType);
  const template = isCrit ? randomChoice(CRIT_NARRATIVES) : randomChoice(ATTACK_NARRATIVES);

  return template
    .replace('{attacker}', attacker)
    .replace('{defender}', defender)
    .replace('{damage}', damage.toString())
    .replace('{weapon}', weapon);
}

/**
 * Get narrative text for a missed attack
 */
export function getMissNarrative(attacker: string, defender: string): string {
  const template = randomChoice(MISS_NARRATIVES);
  return template
    .replace('{attacker}', attacker)
    .replace('{defender}', defender);
}

/**
 * Get narrative text for a dodged attack
 */
export function getDodgeNarrative(defender: string, attacker: string): string {
  const template = randomChoice(DODGE_NARRATIVES);
  return template
    .replace('{defender}', defender)
    .replace('{attacker}', attacker);
}

/**
 * Get narrative text for a kill (PvP or PvE)
 */
export function getKillNarrative(attacker: string, defender: string): string {
  const template = randomChoice(KILL_NARRATIVES);
  return template
    .replace('{attacker}', attacker)
    .replace('{defender}', defender);
}

/**
 * Get narrative text for knocking out a monster
 */
export function getKnockoutNarrative(player: string, monster: string): string {
  const template = randomChoice(KNOCKOUT_NARRATIVES);
  return template
    .replace('{player}', player)
    .replace('{monster}', monster);
}
