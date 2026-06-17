import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Program, Database } from '../scripts/database.mjs';

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Program', () => {
  it('constructor sets fields from arguments', () => {
    const p = new Program({ codePath: 'fn()', parentId: 'p1', metrics: { acc: 0.9 }, changes: 'diff' });
    assert.equal(p.codePath, 'fn()');
    assert.equal(p.parentId, 'p1');
    assert.deepEqual(p.metrics, { acc: 0.9 });
    assert.equal(p.changes, 'diff');
    assert.equal(p.generation, 0);
    assert.equal(p.iterationFound, 0);
    assert.equal(typeof p.id, 'string');
    assert.ok(p.id.length > 0);
    assert.equal(typeof p.timestamp, 'number');
  });

  it('constructor uses defaults for optional fields', () => {
    const p = new Program({ codePath: 'x' });
    assert.equal(p.parentId, '0');
    assert.deepEqual(p.metrics, {});
    assert.equal(p.changes, '');
  });

  it('fromJSON restores all fields', () => {
    const data = {
      id: 'abc-123',
      codePath: 'code',
      parentId: 'p2',
      metrics: { f1: 0.8 },
      changes: 'c',
      generation: 5,
      iterationFound: 3,
      timestamp: 1000,
    };
    const p = Program.fromJSON(data);
    assert.equal(p.id, 'abc-123');
    assert.equal(p.codePath, 'code');
    assert.equal(p.generation, 5);
    assert.equal(p.iterationFound, 3);
    assert.equal(p.timestamp, 1000);
  });

  it('fromJSON uses defaults for missing optional fields', () => {
    const p = Program.fromJSON({ id: 'x', codePath: 'y' });
    assert.equal(p.generation, 0);
    assert.equal(p.iterationFound, 0);
    assert.equal(p.timestamp, 0);
  });
});

describe('Database', () => {
  describe('constructor and create', () => {
    it('initializes with default values', () => {
      const db = new Database(tmpDir);
      assert.equal(db.numIslands, 3);
      assert.equal(db.maxIslandSize, 40);
      assert.equal(db.migrationInterval, 10);
      assert.equal(db.migrationRate, 0.1);
      assert.equal(db.explorationRatio, 0.3);
      assert.deepEqual(db.programs, {});
      assert.equal(db.islands.length, 3);
      assert.equal(db.currentIsland, 0);
      assert.equal(db.bestProgramId, '');
      assert.equal(db.lastIteration, 0);
    });

    it('create returns a Database when no file exists', async () => {
      const db = await Database.create(tmpDir);
      assert.ok(db instanceof Database);
      assert.deepEqual(db.programs, {});
    });
  });

  describe('save and load round-trip', () => {
    it('persists and restores state', async () => {
      const db = new Database(tmpDir);
      const p = new Program({ codePath: 'hello', metrics: { score: 1.0 } });
      db.programs[p.id] = p;
      db.islands[0].add(p.id);
      db.bestProgramId = p.id;
      db.lastIteration = 1;
      await db._save();

      const db2 = await Database.create(tmpDir);
      assert.equal(Object.keys(db2.programs).length, 1);
      assert.equal(db2.programs[p.id].codePath, 'hello');
      assert.equal(db2.bestProgramId, p.id);
      assert.equal(db2.lastIteration, 1);
      assert.ok(db2.islands[0].has(p.id));
    });

    it('_load filters out orphaned island references', async () => {
      const db = new Database(tmpDir);
      const p = new Program({ codePath: 'x' });
      db.programs[p.id] = p;
      db.islands[0].add(p.id);
      db.islands[0].add('nonexistent-id');
      await db._save();

      const db2 = await Database.create(tmpDir);
      assert.ok(db2.islands[0].has(p.id));
      assert.ok(!db2.islands[0].has('nonexistent-id'));
    });
  });

  describe('addProgram', () => {
    it('adds program and updates state', async () => {
      const db = new Database(tmpDir);
      const p = new Program({ codePath: 'fn()' });
      await db.addProgram(p);

      assert.equal(db.programs[p.id], p);
      assert.equal(p.generation, 0);
      assert.equal(p.iterationFound, 0);
      assert.equal(db.bestProgramId, p.id);
      assert.equal(db.lastIteration, 1);
      assert.equal(db.currentIsland, 1);
      assert.ok(db.islands[0].has(p.id));
    });

    it('increments generation from parent', async () => {
      const db = new Database(tmpDir);
      const parent = new Program({ codePath: 'parent' });
      await db.addProgram(parent);

      const child = new Program({ codePath: 'child', parentId: parent.id });
      await db.addProgram(child);

      assert.equal(child.generation, 1);
    });

    it('rotates islands on successive adds', async () => {
      const db = new Database(tmpDir);
      const p1 = new Program({ codePath: 'a' });
      const p2 = new Program({ codePath: 'b' });
      const p3 = new Program({ codePath: 'c' });
      const p4 = new Program({ codePath: 'd' });

      await db.addProgram(p1);
      assert.ok(db.islands[0].has(p1.id));

      await db.addProgram(p2);
      assert.ok(db.islands[1].has(p2.id));

      await db.addProgram(p3);
      assert.ok(db.islands[2].has(p3.id));

      await db.addProgram(p4);
      assert.ok(db.islands[0].has(p4.id));
    });

    it('updates bestProgramId when new program is better', async () => {
      const db = new Database(tmpDir);
      const p1 = new Program({ codePath: 'a', metrics: { score: 0.5 } });
      await db.addProgram(p1);
      assert.equal(db.bestProgramId, p1.id);

      const p2 = new Program({ codePath: 'b', metrics: { score: 0.9 } });
      await db.addProgram(p2);
      assert.equal(db.bestProgramId, p2.id);
    });

    it('does not update bestProgramId when new program is worse', async () => {
      const db = new Database(tmpDir);
      const p1 = new Program({ codePath: 'a', metrics: { score: 0.9 } });
      await db.addProgram(p1);

      const p2 = new Program({ codePath: 'b', metrics: { score: 0.1 } });
      await db.addProgram(p2);
      assert.equal(db.bestProgramId, p1.id);
    });

    it('saves to disk after adding', async () => {
      const db = new Database(tmpDir);
      await db.addProgram(new Program({ codePath: 'x' }));

      const filePath = path.join(tmpDir, 'database.json');
      const stat = await fs.stat(filePath);
      assert.ok(stat.isFile());
    });
  });

  describe('_shouldMigrate', () => {
    it('returns false when generation gap is below interval', () => {
      const db = new Database(tmpDir);
      db.islandGenerations = [5, 3, 2];
      db.lastMigrationGeneration = 0;
      db.migrationInterval = 10;
      assert.equal(db._shouldMigrate(), false);
    });

    it('returns true when generation gap meets interval', () => {
      const db = new Database(tmpDir);
      db.islandGenerations = [10, 5, 3];
      db.lastMigrationGeneration = 0;
      db.migrationInterval = 10;
      assert.equal(db._shouldMigrate(), true);
    });
  });

  describe('_migratePrograms', () => {
    it('migrates top programs to neighboring islands', () => {
      const db = new Database(tmpDir);
      db.numIslands = 3;
      db.migrationRate = 0.5;

      const p1 = Program.fromJSON({ id: 'p1', codePath: 'a', metrics: { score: 0.9 }, timestamp: 1 });
      const p2 = Program.fromJSON({ id: 'p2', codePath: 'b', metrics: { score: 0.5 }, timestamp: 1 });
      db.programs = { p1, p2 };
      db.islands = [new Set(['p1', 'p2']), new Set(), new Set()];

      db._migratePrograms();

      assert.ok(db.islands[1].has('p1'));
      assert.ok(db.islands[2].has('p1'));
    });

    it('does nothing with fewer than 2 islands', () => {
      const db = new Database(tmpDir);
      db.numIslands = 1;
      db.islands = [new Set(['x'])];
      db.programs = { x: Program.fromJSON({ id: 'x', codePath: 'a', metrics: {}, timestamp: 1 }) };
      db._migratePrograms();
      assert.equal(db.islands[0].size, 1);
    });
  });

  describe('_pruneIsland', () => {
    it('does nothing when island is under max size', () => {
      const db = new Database(tmpDir);
      db.maxIslandSize = 5;
      const p = Program.fromJSON({ id: 'p1', codePath: 'x', metrics: { s: 1 }, timestamp: 1 });
      db.programs = { p1: p };
      db.islands = [new Set(['p1']), new Set(), new Set()];

      db._pruneIsland(0);
      assert.ok(db.islands[0].has('p1'));
    });

    it('removes worst programs when island exceeds max size', () => {
      const db = new Database(tmpDir);
      db.maxIslandSize = 2;

      const programs = [];
      for (let i = 0; i < 4; i++) {
        const p = Program.fromJSON({
          id: `p${i}`,
          codePath: `code${i}`,
          metrics: { score: i * 0.25 },
          timestamp: i,
        });
        programs.push(p);
      }
      db.programs = Object.fromEntries(programs.map((p) => [p.id, p]));
      db.islands = [new Set(programs.map((p) => p.id)), new Set(), new Set()];

      db._pruneIsland(0);

      assert.equal(db.islands[0].size, 2);
      assert.ok(db.islands[0].has('p3'));
      assert.ok(db.islands[0].has('p2'));
    });

    it('does not delete a program if it exists on another island', () => {
      const db = new Database(tmpDir);
      db.maxIslandSize = 1;

      const p1 = Program.fromJSON({ id: 'p1', codePath: 'a', metrics: { s: 1.0 }, timestamp: 1 });
      const p2 = Program.fromJSON({ id: 'p2', codePath: 'b', metrics: { s: 0.1 }, timestamp: 1 });
      db.programs = { p1, p2 };
      db.islands = [new Set(['p1', 'p2']), new Set(['p2']), new Set()];

      db._pruneIsland(0);

      assert.equal(db.islands[0].size, 1);
      assert.ok(db.islands[0].has('p1'));
      assert.ok(!db.islands[0].has('p2'));
      assert.ok(db.programs.p2, 'p2 should still exist in programs since island 1 has it');
    });

    it('deletes a program from programs map if no island references it', () => {
      const db = new Database(tmpDir);
      db.maxIslandSize = 1;

      const p1 = Program.fromJSON({ id: 'p1', codePath: 'a', metrics: { s: 1.0 }, timestamp: 1 });
      const p2 = Program.fromJSON({ id: 'p2', codePath: 'b', metrics: { s: 0.1 }, timestamp: 1 });
      db.programs = { p1, p2 };
      db.islands = [new Set(['p1', 'p2']), new Set(), new Set()];

      db._pruneIsland(0);

      assert.ok(!db.programs.p2, 'p2 should be deleted from programs');
    });
  });

  describe('sample', () => {
    it('returns null parent when database is empty', () => {
      const db = new Database(tmpDir);
      const result = db.sample();
      assert.equal(result.parent, null);
      assert.deepEqual(result.inspirations, []);
    });

    it('returns a parent and inspirations when programs exist', async () => {
      const db = new Database(tmpDir);
      for (let i = 0; i < 5; i++) {
        await db.addProgram(new Program({ codePath: `code${i}`, metrics: { s: i } }));
      }

      db.currentIsland = 0;
      const result = db.sample();
      assert.ok(result.parent !== null);
      assert.ok(result.parent.codePath !== undefined);
    });

    it('inspirations do not include the parent', async () => {
      const db = new Database(tmpDir);
      for (let i = 0; i < 10; i++) {
        await db.addProgram(new Program({ codePath: `code${i}`, metrics: { s: i } }));
      }

      db.currentIsland = 0;
      const result = db.sample();
      if (result.parent && result.inspirations.length > 0) {
        const inspirationIds = result.inspirations.map((p) => p.id);
        assert.ok(!inspirationIds.includes(result.parent.id));
      }
    });
  });

  describe('_sampleParent', () => {
    it('returns null when no programs exist', () => {
      const db = new Database(tmpDir);
      assert.equal(db._sampleParent(), null);
    });

    it('falls back to any program when current island is empty', async () => {
      const db = new Database(tmpDir);
      const p = new Program({ codePath: 'x', metrics: { s: 1 } });
      db.programs[p.id] = p;
      db.islands[1].add(p.id);
      db.currentIsland = 0;

      const result = db._sampleParent();
      assert.ok(result !== null);
    });
  });

  describe('_sampleInspirations', () => {
    it('returns empty array when current island is empty', () => {
      const db = new Database(tmpDir);
      db.currentIsland = 0;
      assert.deepEqual(db._sampleInspirations(), []);
    });

    it('returns at most 5 programs', async () => {
      const db = new Database(tmpDir);
      db.currentIsland = 0;
      for (let i = 0; i < 20; i++) {
        const p = Program.fromJSON({ id: `p${i}`, codePath: `c${i}`, metrics: { s: i }, timestamp: i });
        db.programs[p.id] = p;
        db.islands[0].add(p.id);
      }

      const result = db._sampleInspirations();
      assert.ok(result.length <= 5);
    });
  });

  describe('bestProgram getter', () => {
    it('returns null when no best program', () => {
      const db = new Database(tmpDir);
      assert.equal(db.bestProgram, null);
    });

    it('returns null when bestProgramId references deleted program', () => {
      const db = new Database(tmpDir);
      db.bestProgramId = 'deleted';
      assert.equal(db.bestProgram, null);
    });

    it('returns the best program', async () => {
      const db = new Database(tmpDir);
      const p = new Program({ codePath: 'best', metrics: { score: 1.0 } });
      await db.addProgram(p);
      assert.equal(db.bestProgram.id, p.id);
    });
  });

describe('migration triggered by addProgram', () => {
    it('triggers migration after enough generations', async () => {
      const db = new Database(tmpDir);
      db.migrationInterval = 3;
      db.numIslands = 2;
      db.islands = [new Set(), new Set()];
      db.islandGenerations = [0, 0];

      for (let i = 0; i < 6; i++) {
        await db.addProgram(new Program({ codePath: `c${i}`, metrics: { s: i } }));
      }

      const island0Ids = [...db.islands[0]];
      const island1Ids = [...db.islands[1]];
      const shared = island0Ids.filter((id) => island1Ids.includes(id));
      assert.ok(shared.length > 0, 'migration should copy programs between islands');
    });
  });
});
