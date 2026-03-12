import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createPlayer } from '../src/models/player.js';
import { createChunk } from '../src/models/chunk.js';
import { getTemplatesInChunk } from '../src/models/monster-template.js';
import {
  generateChunkMonsters,
  computeMonsterStats,
  selectMonstersForTerrain,
  TERRAIN_MONSTERS,
  DEFAULT_MONSTERS,
} from '../src/game/seed-monsters.js';

beforeEach(() => {
  resetDb();
  process.env.DATABASE_PATH = ':memory:';
  migrate();
});

afterEach(() => {
  resetDb();
});

describe('computeMonsterStats', () => {
  it('scales HP by danger level', () => {
    const stats1 = computeMonsterStats(1);
    expect(stats1.base_hp).toBe(30); // 20 + 1*10

    const stats5 = computeMonsterStats(5);
    expect(stats5.base_hp).toBe(70); // 20 + 5*10

    const stats10 = computeMonsterStats(10);
    expect(stats10.base_hp).toBe(120); // 20 + 10*10
  });

  it('scales STR/DEX/CON by danger level', () => {
    const stats3 = computeMonsterStats(3);
    expect(stats3.base_strength).toBe(9);   // 3 + 3*2
    expect(stats3.base_dexterity).toBe(9);
    expect(stats3.base_constitution).toBe(9);
  });

  it('scales XP reward by danger level', () => {
    const stats1 = computeMonsterStats(1);
    expect(stats1.xp_reward).toBe(18); // 10 + 1*8

    const stats7 = computeMonsterStats(7);
    expect(stats7.xp_reward).toBe(66); // 10 + 7*8
  });

  it('scales gold by danger level', () => {
    const stats4 = computeMonsterStats(4);
    expect(stats4.gold_min).toBe(20);  // 4*5
    expect(stats4.gold_max).toBe(60);  // 4*15
  });
});

describe('selectMonstersForTerrain', () => {
  it('returns forest monsters for forest terrain', () => {
    const monsters = selectMonstersForTerrain('forest');
    expect(monsters).toBe(TERRAIN_MONSTERS.forest);
  });

  it('returns desert monsters for desert terrain', () => {
    const monsters = selectMonstersForTerrain('desert');
    expect(monsters).toBe(TERRAIN_MONSTERS.desert);
  });

  it('returns mountain monsters for mountain terrain', () => {
    const monsters = selectMonstersForTerrain('mountain');
    expect(monsters).toBe(TERRAIN_MONSTERS.mountain);
  });

  it('returns mountain monsters for mountains terrain', () => {
    const monsters = selectMonstersForTerrain('mountains');
    expect(monsters).toBe(TERRAIN_MONSTERS.mountains);
  });

  it('returns swamp monsters for swamp terrain', () => {
    const monsters = selectMonstersForTerrain('swamp');
    expect(monsters).toBe(TERRAIN_MONSTERS.swamp);
  });

  it('returns plains monsters for plains terrain', () => {
    const monsters = selectMonstersForTerrain('plains');
    expect(monsters).toBe(TERRAIN_MONSTERS.plains);
  });

  it('returns city monsters for city terrain', () => {
    const monsters = selectMonstersForTerrain('city');
    expect(monsters).toBe(TERRAIN_MONSTERS.city);
  });

  it('is case-insensitive', () => {
    const monsters = selectMonstersForTerrain('Forest');
    expect(monsters).toBe(TERRAIN_MONSTERS.forest);
  });

  it('trims whitespace', () => {
    const monsters = selectMonstersForTerrain('  desert  ');
    expect(monsters).toBe(TERRAIN_MONSTERS.desert);
  });

  it('returns default monsters for unknown terrain', () => {
    const monsters = selectMonstersForTerrain('volcano');
    expect(monsters).toBe(DEFAULT_MONSTERS);
  });
});

describe('generateChunkMonsters', () => {
  it('creates 1-3 monster templates in the database', () => {
    const player = createPlayer('ChunkBuilder', 'password');
    createChunk(1, 0, 'Test Forest', 'A dark forest.', 'forest', 3, ['dark'], player.id);

    const templates = generateChunkMonsters(1, 0, 'forest', 3, player.id);

    expect(templates.length).toBeGreaterThanOrEqual(1);
    expect(templates.length).toBeLessThanOrEqual(3);

    // Verify they are persisted in the database
    const dbTemplates = getTemplatesInChunk(1, 0);
    expect(dbTemplates.length).toBe(templates.length);
  });

  it('uses terrain-appropriate monster names for forest', () => {
    const player = createPlayer('ForestBuilder', 'password');
    createChunk(2, 0, 'Deep Forest', 'Towering trees.', 'forest', 2, [], player.id);

    const templates = generateChunkMonsters(2, 0, 'forest', 2, player.id);
    const forestNames = TERRAIN_MONSTERS.forest.map(m => m.name);

    for (const t of templates) {
      expect(forestNames).toContain(t.name);
    }
  });

  it('uses terrain-appropriate monster names for desert', () => {
    const player = createPlayer('DesertBuilder', 'password');
    createChunk(3, 0, 'Vast Desert', 'Endless sand.', 'desert', 4, [], player.id);

    const templates = generateChunkMonsters(3, 0, 'desert', 4, player.id);
    const desertNames = TERRAIN_MONSTERS.desert.map(m => m.name);

    for (const t of templates) {
      expect(desertNames).toContain(t.name);
    }
  });

  it('uses default monsters for unknown terrain', () => {
    const player = createPlayer('UnknownBuilder', 'password');
    createChunk(4, 0, 'Lava Fields', 'Molten rock.', 'volcano', 6, [], player.id);

    const templates = generateChunkMonsters(4, 0, 'volcano', 6, player.id);
    const defaultNames = DEFAULT_MONSTERS.map(m => m.name);

    for (const t of templates) {
      expect(defaultNames).toContain(t.name);
    }
  });

  it('scales stats based on danger level', () => {
    const player = createPlayer('StatsBuilder', 'password');
    createChunk(5, 0, 'Dangerous Zone', 'Very dangerous.', 'plains', 5, [], player.id);

    const templates = generateChunkMonsters(5, 0, 'plains', 5, player.id);

    for (const t of templates) {
      expect(t.base_hp).toBe(70);          // 20 + 5*10
      expect(t.base_strength).toBe(13);    // 3 + 5*2
      expect(t.base_dexterity).toBe(13);
      expect(t.base_constitution).toBe(13);
      expect(t.xp_reward).toBe(50);        // 10 + 5*8
      expect(t.gold_min).toBe(25);         // 5*5
      expect(t.gold_max).toBe(75);         // 5*15
    }
  });

  it('caps city monsters at low danger', () => {
    const player = createPlayer('CityBuilder', 'password');
    createChunk(6, 0, 'Small Town', 'A quiet town.', 'city', 1, [], player.id);

    const templates = generateChunkMonsters(6, 0, 'city', 1, player.id);

    for (const t of templates) {
      expect(t.base_hp).toBeLessThanOrEqual(30);
      expect(t.base_strength).toBeLessThanOrEqual(5);
      expect(t.xp_reward).toBeLessThanOrEqual(18);
      expect(t.gold_max).toBeLessThanOrEqual(10);
    }
  });

  it('does not cap city monsters at high danger', () => {
    const player = createPlayer('CityHighBuilder', 'password');
    createChunk(7, 0, 'Crime City', 'A lawless place.', 'city', 5, [], player.id);

    const templates = generateChunkMonsters(7, 0, 'city', 5, player.id);

    // At danger 5, stats should NOT be capped
    for (const t of templates) {
      expect(t.base_hp).toBe(70);  // 20 + 5*10, no cap
    }
  });

  it('sets danger range centered around chunk danger', () => {
    const player = createPlayer('RangeBuilder', 'password');
    createChunk(8, 0, 'Mid Zone', 'Medium danger.', 'forest', 5, [], player.id);

    const templates = generateChunkMonsters(8, 0, 'forest', 5, player.id);

    for (const t of templates) {
      expect(t.min_danger_level).toBe(4);  // max(1, 5-1)
      expect(t.max_danger_level).toBe(7);  // min(10, 5+2)
    }
  });

  it('clamps min danger level to 1', () => {
    const player = createPlayer('LowDangerBuilder', 'password');
    createChunk(9, 0, 'Safe Zone', 'Very safe.', 'plains', 1, [], player.id);

    const templates = generateChunkMonsters(9, 0, 'plains', 1, player.id);

    for (const t of templates) {
      expect(t.min_danger_level).toBe(1);
    }
  });

  it('clamps max danger level to 10', () => {
    const player = createPlayer('HighDangerBuilder', 'password');
    createChunk(10, 0, 'Death Zone', 'Extremely dangerous.', 'swamp', 9, [], player.id);

    const templates = generateChunkMonsters(10, 0, 'swamp', 9, player.id);

    for (const t of templates) {
      expect(t.max_danger_level).toBe(10);  // min(10, 9+2) = 10
    }
  });

  it('assigns created_by to the chunk creator', () => {
    const player = createPlayer('CreatorTest', 'password');
    createChunk(11, 0, 'Creator Zone', 'Testing creator.', 'forest', 3, [], player.id);

    const templates = generateChunkMonsters(11, 0, 'forest', 3, player.id);

    for (const t of templates) {
      expect(t.created_by).toBe(player.id);
    }
  });

  it('assigns location_id as null (chunk-level monsters)', () => {
    const player = createPlayer('LocationTest', 'password');
    createChunk(12, 0, 'Location Zone', 'Testing location.', 'desert', 2, [], player.id);

    const templates = generateChunkMonsters(12, 0, 'desert', 2, player.id);

    for (const t of templates) {
      expect(t.location_id).toBeNull();
    }
  });
});
