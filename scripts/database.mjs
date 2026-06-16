import fs from 'fs/promises';
import path from 'path';

export class Program {
  constructor({
    id,
    code,
    language = 'python',
    parentId = null,
    generation = 0,
    timestamp = Date.now() / 1000,
    metrics = {},
  }) {
    this.id = id;
    this.code = code;
    this.language = language;
    this.parentId = parentId;
    this.generation = generation;
    this.timestamp = timestamp;
    this.metrics = metrics;
  }
}

function getFeatureCoords(program, featureBins) {
  const keys = Object.keys(program.metrics).sort();
  return keys.map((key) => {
    const v = program.metrics[key];
    if (typeof v !== 'number' || Number.isNaN(v)) return 0;
    return Math.max(0, Math.min(Math.floor(v * featureBins), featureBins - 1));
  });
}

function featureCoordsToKey(coords) {
  return coords.join('-');
}

function avgMetrics(program) {
  const vals = Object.values(program.metrics).filter(
    (v) => typeof v === 'number' && !Number.isNaN(v)
  );
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function isBetter(program1, program2) {
  const score1 = avgMetrics(program1);
  const score2 = avgMetrics(program2);
  if (score1 !== score2) return score1 > score2;
  return program1.timestamp > program2.timestamp;
}

export class Database {
  constructor(savePath) {
    this.featureBins = 10;
    this.numIslands = 3;
    this.migrationInterval = 10;
    this.migrationRate = 0.1;
    this.savePath = savePath;

    this.programs = {};
    this.featureMap = {};
    this.islands = Array.from({ length: this.numIslands }, () => new Set());
    this.currentIsland = 0;
    this.islandGenerations = Array.from({ length: this.numIslands }, () => 0);
    this.lastMigrationGeneration = 0;
    this.bestProgramId = "";
    this.lastIteration = 0;
  }

  static async create(savePath) {
    const db = new Database(savePath);
    await db.load();
    return db;
  }

  async save() {
    await fs.mkdir(this.savePath, { recursive: true });

    const data = {
      featureBins: this.featureBins,
      numIslands: this.numIslands,
      migrationInterval: this.migrationInterval,
      migrationRate: this.migrationRate,
      programs: Object.fromEntries(
        Object.entries(this.programs).map(([id, p]) => [id, { ...p }])
      ),
      featureMap: this.featureMap,
      islands: this.islands.map((s) => [...s]),
      currentIsland: this.currentIsland,
      islandGenerations: this.islandGenerations,
      lastMigrationGeneration: this.lastMigrationGeneration,
      bestProgramId: this.bestProgramId,
      lastIteration: this.lastIteration,
    };

    await fs.writeFile(
      path.join(this.savePath, 'database.json'),
      JSON.stringify(data, null, 2)
    );
  }

  async load() {
    const filePath = path.join(this.savePath, 'database.json');

    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
    const data = JSON.parse(raw);

    this.featureBins = data.featureBins;
    this.numIslands = data.numIslands;
    this.migrationInterval = data.migrationInterval;
    this.migrationRate = data.migrationRate;
    this.programs = Object.fromEntries(
      Object.entries(data.programs).map(([id, p]) => [id, new Program(p)])
    );
    this.featureMap = data.featureMap;
    this.islands = data.islands.map((arr) => new Set(arr));
    this.currentIsland = data.currentIsland;
    this.islandGenerations = data.islandGenerations;
    this.lastMigrationGeneration = data.lastMigrationGeneration;
    this.bestProgramId = data.bestProgramId;
    this.lastIteration = data.lastIteration;

    return true;
  }

  async addProgram(program) {
    this.programs[program.id] = program;

    const coords = getFeatureCoords(program, this.featureBins);
    const key = featureCoordsToKey(coords);

    const existingId = this.featureMap[key];
    if (!existingId || !(existingId in this.programs) || isBetter(program, this.programs[existingId])) {
      this.featureMap[key] = program.id;
    }
    this.islands[this.currentIsland].add(program.id);

    if (!this.bestProgramId || !(this.bestProgramId in this.programs) || isBetter(program, this.programs[this.bestProgramId])) {
      this.bestProgramId = program.id;
    }
    this.islandGenerations[this.currentIsland]++;
    this.lastIteration++;
    this.currentIsland = (this.currentIsland + 1) % this.numIslands;

    if (this.shouldMigrate()) {
      this.migratePrograms();
    }
    await this.save();
  }

  shouldMigrate() {
    const maxGen = Math.max(...this.islandGenerations);
    return (maxGen - this.lastMigrationGeneration) >= this.migrationInterval;
  }

  migratePrograms() {
    if (this.numIslands < 2) return;

    for (let i = 0; i < this.numIslands; i++) {
      const islandProgramIds = [...this.islands[i]].filter((id) => id in this.programs);
      if (islandProgramIds.length === 0) continue;

      islandProgramIds.sort((a, b) => avgMetrics(this.programs[b]) - avgMetrics(this.programs[a]));

      const numToMigrate = Math.max(1, Math.floor(islandProgramIds.length * this.migrationRate));
      const migrants = islandProgramIds.slice(0, numToMigrate);

      const targets = [(i + 1) % this.numIslands, (i - 1 + this.numIslands) % this.numIslands];

      for (const migrantId of migrants) {
        for (const target of targets) {
          this.islands[target].add(migrantId);
        }
      }
    }

    this.lastMigrationGeneration = Math.max(...this.islandGenerations);
  }

  getProgram(id) {
    return this.programs[id] ?? null;
  }

  get bestProgram() {
    return this.bestProgramId ? this.programs[this.bestProgramId] ?? null : null;
  }
}
