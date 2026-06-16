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

export class Database {
  constructor(savePath) {
    this.feature_bins = 10;
    this.num_islands = 3;
    this.migration_interval = 10;
    this.migration_rate = 0.1;
    this.savePath = savePath;

    this.programs = {};
    this.featureMap = {};
    this.islands = Array.from({ length: this.num_islands }, () => new Set());
    this.currentIsland = 0;
    this.islandGenerations = Array.from({ length: this.num_islands }, () => 0);
    this.lastMigrationGeneration = 0;
    this.bestProgramId = "";
    this.lastIteration = 0;
  }

  async save() {
    await fs.mkdir(this.savePath, { recursive: true });

    const data = {
      feature_bins: this.feature_bins,
      num_islands: this.num_islands,
      migration_interval: this.migration_interval,
      migration_rate: this.migration_rate,
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

    this.feature_bins = data.feature_bins;
    this.num_islands = data.num_islands;
    this.migration_interval = data.migration_interval;
    this.migration_rate = data.migration_rate;
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

  addProgram(program) {
    this.programs[program.id] = program;
  }

  getProgram(id) {
    return this.programs[id] ?? null;
  }

  get bestProgram() {
    return this.bestProgramId ? this.programs[this.bestProgramId] ?? null : null;
  }
}
