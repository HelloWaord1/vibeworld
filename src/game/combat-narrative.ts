/**
 * Combat narrative generation
 * Provides flavor text for combat events to make battles more immersive
 *
 * Templates use {attacker}, {defender}, {damage}, {weapon} placeholders.
 * Player-perspective templates (attacker = "You") use "Your"/"You" phrasing.
 * Third-person templates (attacker = monster/NPC name) use "{attacker}" phrasing.
 */

// --- Player-as-attacker templates (second person) ---

const PLAYER_ATTACK_NARRATIVES = [
  "Your {weapon} strikes true, tearing into {defender} for {damage} damage!",
  "A devastating blow connects with {defender}, dealing {damage} damage!",
  "You unleash a powerful attack on {defender}, inflicting {damage} damage!",
  "{defender} staggers as your attack lands for {damage} damage!",
  "Your weapon finds its mark, cutting {defender} for {damage} damage!",
];

const PLAYER_CRIT_NARRATIVES = [
  "CRITICAL HIT! Your {weapon} cleaves through {defender}'s defenses for a devastating {damage} damage!",
  "A PERFECT STRIKE! {defender} reels from the critical blow — {damage} damage!",
  "CRITICAL! Your attack finds a vital point on {defender}, dealing {damage} damage!",
  "DEVASTATING BLOW! {defender} takes a crushing {damage} damage from your critical hit!",
  "MASTERFUL STRIKE! Your {weapon} lands a critical hit on {defender} for {damage} damage!",
];

const PLAYER_MISS_NARRATIVES = [
  "Your attack goes wide, missing {defender} completely.",
  "{defender} sidesteps your strike with ease.",
  "You swing at {defender}, but they're too quick!",
  "Your weapon slices through empty air as {defender} evades.",
  "The attack fails to connect — {defender} is untouched.",
];

const PLAYER_DODGE_NARRATIVES = [
  "{defender} deftly dodges your attack!",
  "{defender} gracefully sidesteps, avoiding all damage!",
  "With incredible agility, {defender} evades your strike!",
  "{defender} sees it coming and rolls away!",
  "Your attack is avoided — {defender} is too nimble!",
];

// --- Third-person attacker templates (monster/NPC as attacker) ---

const THIRD_PERSON_ATTACK_NARRATIVES = [
  "{attacker}'s {weapon} strikes true, tearing into {defender} for {damage} damage!",
  "A devastating blow from {attacker} connects with {defender}, dealing {damage} damage!",
  "{attacker} unleashes a powerful attack on {defender}, inflicting {damage} damage!",
  "{defender} staggers as {attacker}'s attack lands for {damage} damage!",
  "{attacker}'s weapon finds its mark, cutting {defender} for {damage} damage!",
];

const THIRD_PERSON_CRIT_NARRATIVES = [
  "CRITICAL HIT! {attacker}'s {weapon} cleaves through {defender}'s defenses for a devastating {damage} damage!",
  "A PERFECT STRIKE! {defender} reels from {attacker}'s critical blow — {damage} damage!",
  "CRITICAL! {attacker}'s attack finds a vital point on {defender}, dealing {damage} damage!",
  "DEVASTATING BLOW! {defender} takes a crushing {damage} damage from {attacker}'s critical hit!",
  "MASTERFUL STRIKE! {attacker}'s {weapon} lands a critical hit on {defender} for {damage} damage!",
];

const THIRD_PERSON_MISS_NARRATIVES = [
  "{attacker}'s attack goes wide, missing {defender} completely.",
  "{defender} sidesteps {attacker}'s strike with ease.",
  "{attacker} swings at {defender}, but they're too quick!",
  "{attacker}'s weapon slices through empty air as {defender} evades.",
  "The attack fails to connect — {defender} is untouched.",
];

const THIRD_PERSON_DODGE_NARRATIVES = [
  "{defender} deftly dodges {attacker}'s attack!",
  "{defender} gracefully sidesteps, avoiding all damage!",
  "With incredible agility, {defender} evades {attacker}'s strike!",
  "{defender} sees it coming and rolls away!",
  "{attacker}'s attack is avoided — {defender} is too nimble!",
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
 * Check whether the attacker string represents the player (second person).
 * The PvE combat code passes 'You' when the player is attacking.
 */
function isPlayerAttacker(attacker: string): boolean {
  return attacker.toLowerCase() === 'you';
}

/**
 * Get narrative text for a successful attack.
 * Selects player-perspective or third-person templates based on attacker.
 */
export function getAttackNarrative(
  attacker: string,
  defender: string,
  damage: number,
  isCrit: boolean,
  weaponType?: string
): string {
  const weapon = getWeaponName(weaponType);
  const playerPov = isPlayerAttacker(attacker);

  const template = isCrit
    ? randomChoice(playerPov ? PLAYER_CRIT_NARRATIVES : THIRD_PERSON_CRIT_NARRATIVES)
    : randomChoice(playerPov ? PLAYER_ATTACK_NARRATIVES : THIRD_PERSON_ATTACK_NARRATIVES);

  return template
    .replace('{attacker}', attacker)
    .replace('{defender}', defender)
    .replace('{damage}', damage.toString())
    .replace('{weapon}', weapon);
}

/**
 * Get narrative text for a missed attack.
 * Selects player-perspective or third-person templates based on attacker.
 */
export function getMissNarrative(attacker: string, defender: string): string {
  const playerPov = isPlayerAttacker(attacker);
  const template = randomChoice(playerPov ? PLAYER_MISS_NARRATIVES : THIRD_PERSON_MISS_NARRATIVES);

  return template
    .replace('{attacker}', attacker)
    .replace('{defender}', defender);
}

/**
 * Get narrative text for a dodged attack.
 * Selects player-perspective or third-person templates based on attacker.
 */
export function getDodgeNarrative(defender: string, attacker: string): string {
  const playerPov = isPlayerAttacker(attacker);
  const template = randomChoice(playerPov ? PLAYER_DODGE_NARRATIVES : THIRD_PERSON_DODGE_NARRATIVES);

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
