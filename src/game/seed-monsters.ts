import { createMonsterTemplate } from '../models/monster-template.js';
import type { MonsterTemplate } from '../types/index.js';

interface MonsterDefinition {
  readonly name: string;
  readonly description: string;
  readonly monster_type: string;
}

const TERRAIN_MONSTERS: Readonly<Record<string, readonly MonsterDefinition[]>> = {
  forest: [
    { name: 'Wild Wolf', description: 'A snarling grey wolf with bared fangs, prowling through the underbrush.', monster_type: 'beast' },
    { name: 'Cave Bear', description: 'A massive brown bear that towers over most adventurers. Its claws can shred armor.', monster_type: 'beast' },
    { name: 'Giant Spider', description: 'A web-spinning arachnid the size of a large dog, lurking among the trees.', monster_type: 'beast' },
  ],
  desert: [
    { name: 'Giant Scorpion', description: 'A chitinous scorpion with pincers like shears and a venomous tail.', monster_type: 'beast' },
    { name: 'Sand Snake', description: 'A long serpent that burrows beneath the dunes and strikes without warning.', monster_type: 'beast' },
    { name: 'Dust Elemental', description: 'A swirling vortex of sand and wind given malevolent sentience.', monster_type: 'elemental' },
  ],
  mountain: [
    { name: 'Rock Golem', description: 'A lumbering construct of stone and moss, animated by ancient mountain magic.', monster_type: 'construct' },
    { name: 'Giant Eagle', description: 'A fierce raptor with a wingspan wider than a wagon, talons like daggers.', monster_type: 'beast' },
    { name: 'Mountain Troll', description: 'A hulking grey-skinned troll that dwells in rocky crags, hurling boulders at intruders.', monster_type: 'humanoid' },
  ],
  mountains: [
    { name: 'Rock Golem', description: 'A lumbering construct of stone and moss, animated by ancient mountain magic.', monster_type: 'construct' },
    { name: 'Giant Eagle', description: 'A fierce raptor with a wingspan wider than a wagon, talons like daggers.', monster_type: 'beast' },
    { name: 'Mountain Troll', description: 'A hulking grey-skinned troll that dwells in rocky crags, hurling boulders at intruders.', monster_type: 'humanoid' },
  ],
  swamp: [
    { name: 'Swamp Slime', description: 'A gelatinous mass of putrid muck that oozes through the marshland.', monster_type: 'aberration' },
    { name: 'Marsh Crocodile', description: 'A heavily armored reptile that lurks just beneath the murky water surface.', monster_type: 'beast' },
    { name: 'Bog Wraith', description: 'A spectral figure shrouded in mist, drifting silently above the wetlands.', monster_type: 'undead' },
  ],
  plains: [
    { name: 'Wild Boar', description: 'A tusked boar with a foul temper, charging at anything that enters its territory.', monster_type: 'beast' },
    { name: 'Roaming Bandit', description: 'A desperate outlaw armed with a rusty blade, seeking easy prey on the open road.', monster_type: 'humanoid' },
    { name: 'Hunting Hawk', description: 'A razor-taloned bird of prey that dives from above with startling speed.', monster_type: 'beast' },
  ],
  city: [
    { name: 'Sewer Rat', description: 'An oversized rat with matted fur and beady red eyes, scavenging in dark alleys.', monster_type: 'beast' },
    { name: 'Petty Thief', description: 'A hooded pickpocket who resorts to violence when cornered.', monster_type: 'humanoid' },
    { name: 'Stray Dog', description: 'A mangy, feral dog that growls and snaps at passersby.', monster_type: 'beast' },
  ],
};

const DEFAULT_MONSTERS: readonly MonsterDefinition[] = [
  { name: 'Shadow Lurker', description: 'A dark, amorphous creature that feeds on fear and strikes from the shadows.', monster_type: 'aberration' },
  { name: 'Feral Beast', description: 'A mutated animal twisted by wild magic, snarling with unnatural ferocity.', monster_type: 'beast' },
  { name: 'Wandering Skeleton', description: 'The animated remains of a fallen warrior, shambling forward with hollow eye sockets.', monster_type: 'undead' },
];

function computeMonsterStats(danger: number): {
  readonly base_hp: number;
  readonly base_strength: number;
  readonly base_dexterity: number;
  readonly base_constitution: number;
  readonly base_damage_bonus: number;
  readonly base_defense_bonus: number;
  readonly xp_reward: number;
  readonly gold_min: number;
  readonly gold_max: number;
} {
  return {
    base_hp: 20 + danger * 10,
    base_strength: 3 + danger * 2,
    base_dexterity: 3 + danger * 2,
    base_constitution: 3 + danger * 2,
    base_damage_bonus: Math.floor(danger / 3),
    base_defense_bonus: Math.floor(danger / 4),
    xp_reward: 10 + danger * 8,
    gold_min: danger * 5,
    gold_max: danger * 15,
  };
}

function selectMonstersForTerrain(terrainType: string): readonly MonsterDefinition[] {
  const normalized = terrainType.toLowerCase().trim();
  return TERRAIN_MONSTERS[normalized] ?? DEFAULT_MONSTERS;
}

function pickRandomSubset(
  definitions: readonly MonsterDefinition[],
  minCount: number,
  maxCount: number,
): readonly MonsterDefinition[] {
  const count = Math.min(
    definitions.length,
    minCount + Math.floor(Math.random() * (maxCount - minCount + 1)),
  );

  // Fisher-Yates on a copy to pick `count` items without mutation
  const shuffled = [...definitions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

/**
 * Generates 1-3 monster templates for a newly created chunk based on
 * terrain type and danger level, then inserts them into the database.
 *
 * For city terrain with low danger (<=2), monsters are capped to weaker stats.
 */
export function generateChunkMonsters(
  chunkX: number,
  chunkY: number,
  terrainType: string,
  dangerLevel: number,
  createdBy: number,
): readonly MonsterTemplate[] {
  const definitions = selectMonstersForTerrain(terrainType);
  const selected = pickRandomSubset(definitions, 1, 3);
  const stats = computeMonsterStats(dangerLevel);

  // For city terrain with low danger, cap stats further
  const isCityLowDanger =
    terrainType.toLowerCase().trim() === 'city' && dangerLevel <= 2;

  const cappedStats = isCityLowDanger
    ? {
        ...stats,
        base_hp: Math.min(stats.base_hp, 30),
        base_strength: Math.min(stats.base_strength, 5),
        base_dexterity: Math.min(stats.base_dexterity, 5),
        base_constitution: Math.min(stats.base_constitution, 5),
        xp_reward: Math.min(stats.xp_reward, 18),
        gold_max: Math.min(stats.gold_max, 10),
      }
    : stats;

  return selected.map((def) =>
    createMonsterTemplate({
      name: def.name,
      description: def.description,
      monster_type: def.monster_type,
      base_hp: cappedStats.base_hp,
      base_strength: cappedStats.base_strength,
      base_dexterity: cappedStats.base_dexterity,
      base_constitution: cappedStats.base_constitution,
      base_damage_bonus: cappedStats.base_damage_bonus,
      base_defense_bonus: cappedStats.base_defense_bonus,
      min_danger_level: Math.max(1, dangerLevel - 1),
      max_danger_level: Math.min(10, dangerLevel + 2),
      xp_reward: cappedStats.xp_reward,
      gold_min: cappedStats.gold_min,
      gold_max: cappedStats.gold_max,
      loot_table: '[]',
      chunk_x: chunkX,
      chunk_y: chunkY,
      location_id: null,
      created_by: createdBy,
    }),
  );
}

// Exported for testing
export { TERRAIN_MONSTERS, DEFAULT_MONSTERS, computeMonsterStats, selectMonstersForTerrain };
