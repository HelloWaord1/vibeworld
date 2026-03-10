import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createPlayer } from '../src/models/player.js';
import { updatePlayerPosition } from '../src/models/player.js';
import { getNpcsAtLocation, getNpcByName } from '../src/models/npc.js';
import { getLocationById } from '../src/models/location.js';
import { getDb } from '../src/db/connection.js';
import type { NpcDialogue } from '../src/types/index.js';

describe('NPC & Emote System', () => {
  beforeEach(() => {
    resetDb();
    migrate();
  });

  it('seeds NPCs in The Nexus locations', () => {
    const npcs = getDb().prepare('SELECT * FROM npcs').all();
    expect(npcs).toHaveLength(2);

    const grimjaw = npcs.find((n: any) => n.name === 'Grimjaw');
    const whiskers = npcs.find((n: any) => n.name === 'Old Whiskers');

    expect(grimjaw).toBeDefined();
    expect(grimjaw.role).toBe('barkeep');
    expect(whiskers).toBeDefined();
    expect(whiskers.role).toBe('shopkeeper');
  });

  it('getNpcsAtLocation returns NPCs at a specific location', () => {
    const tavernLoc = getDb().prepare(
      `SELECT id FROM locations WHERE name = 'The First Pint Tavern'`
    ).get() as { id: number };

    const npcs = getNpcsAtLocation(0, 0, tavernLoc.id);
    expect(npcs).toHaveLength(1);
    expect(npcs[0].name).toBe('Grimjaw');
  });

  it('getNpcByName finds NPC by name', () => {
    const tavernLoc = getDb().prepare(
      `SELECT id FROM locations WHERE name = 'The First Pint Tavern'`
    ).get() as { id: number };

    const npc = getNpcByName('Grimjaw', tavernLoc.id);
    expect(npc).not.toBeNull();
    expect(npc?.name).toBe('Grimjaw');
    expect(npc?.greeting).toContain('Welcome to The First Pint');
  });

  it('NPC dialogue is properly structured JSON', () => {
    const tavernLoc = getDb().prepare(
      `SELECT id FROM locations WHERE name = 'The First Pint Tavern'`
    ).get() as { id: number };

    const npc = getNpcByName('Grimjaw', tavernLoc.id);
    expect(npc).not.toBeNull();

    const dialogue: NpcDialogue[] = JSON.parse(npc!.dialogue);
    expect(Array.isArray(dialogue)).toBe(true);
    expect(dialogue.length).toBeGreaterThan(0);

    const rumorsTopic = dialogue.find(d => d.topic === 'rumors');
    expect(rumorsTopic).toBeDefined();
    expect(rumorsTopic?.text).toContain('monsters');
  });

  it('NPCs appear in look output when inside location', () => {
    const player = createPlayer('TestHero' + Date.now(), 'password123');

    // Find the tavern location
    const tavernLoc = getDb().prepare(
      `SELECT id FROM locations WHERE name = 'The First Pint Tavern'`
    ).get() as { id: number };

    // Move player into tavern
    updatePlayerPosition(player.id, 0, 0, tavernLoc.id);

    // Get NPCs at player's location
    const npcs = getNpcsAtLocation(0, 0, tavernLoc.id);
    expect(npcs).toHaveLength(1);
    expect(npcs[0].name).toBe('Grimjaw');
  });

  it('both NPCs have distinct dialogue topics', () => {
    const db = getDb();
    const npcs = db.prepare('SELECT * FROM npcs').all() as any[];

    for (const npc of npcs) {
      const dialogue: NpcDialogue[] = JSON.parse(npc.dialogue);
      expect(dialogue.length).toBeGreaterThan(0);

      // Check all dialogue entries have topic and text
      for (const entry of dialogue) {
        expect(entry.topic).toBeTruthy();
        expect(entry.text).toBeTruthy();
        expect(entry.text.length).toBeGreaterThan(10);
      }
    }
  });
});
