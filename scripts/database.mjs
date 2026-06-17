import fs from 'fs/promises';
import path from 'path';

export class Program {
  constructor({
    id,
    code,
    language = 'python',
    parentId = null,
    generation = 0,
    iterationFound = 0,
    timestamp = Date.now() / 1000,
    metrics = {},
  }) {
    this.id = id;
    this.code = code;
    this.language = language;
    this.parentId = parentId;
    this.generation = generation;
    this.iterationFound = iterationFound;
    this.timestamp = timestamp;
    this.metrics = metrics;
  }
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
    this.numIslands = 3;
    this.migrationInterval = 10;
    this.migrationRate = 0.1;
    this.explorationRatio = 0.3;
    this.savePath = savePath;

    this.programs = {};
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
      numIslands: this.numIslands,
      migrationInterval: this.migrationInterval,
      migrationRate: this.migrationRate,
      explorationRatio: this.explorationRatio,
      programs: Object.fromEntries(
        Object.entries(this.programs).map(([id, p]) => [id, { ...p }])
      ),
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

    this.numIslands = data.numIslands;
    this.migrationInterval = data.migrationInterval;
    this.migrationRate = data.migrationRate;
    this.explorationRatio = data.explorationRatio ?? this.explorationRatio;
    this.programs = Object.fromEntries(
      Object.entries(data.programs).map(([id, p]) => [id, new Program(p)])
    );
    this.islands = data.islands.map((arr) => new Set(arr));
    this.currentIsland = data.currentIsland;
    this.islandGenerations = data.islandGenerations;
    this.lastMigrationGeneration = data.lastMigrationGeneration;
    this.bestProgramId = data.bestProgramId;
    this.lastIteration = data.lastIteration;

    return true;
  }

  async addProgram(program) {
    program.iterationFound = this.lastIteration;
    this.programs[program.id] = program;

    this.islands[this.currentIsland].add(program.id);

    if (!this.bestProgramId || !Object.hasOwn(this.programs, this.bestProgramId) || isBetter(program, this.programs[this.bestProgramId])) {
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
      const islandProgramIds = [...this.islands[i]].filter((id) => Object.hasOwn(this.programs, id));
      if (islandProgramIds.length === 0) continue;

      islandProgramIds.sort((a, b) => avgMetrics(this.programs[b]) - avgMetrics(this.programs[a]));
      const numToMigrate = Math.max(1, Math.floor(islandProgramIds.length * this.migrationRate));
      const migrants = islandProgramIds.slice(0, numToMigrate);
      const targets = [(i + 1) % this.numIslands, (i - 1 + this.numIslands) % this.numIslands];

      for (const migrantId of migrants) {
        for (const target of targets) {
          if (!this.islands[target].has(migrantId)) {
            this.islands[target].add(migrantId);
          }
        }
      }
    }
    this.lastMigrationGeneration = Math.max(...this.islandGenerations);
  }

  sampleParent() {
    const islandIds = [...this.islands[this.currentIsland]].filter(
      (id) => Object.hasOwn(this.programs, id)
    );
    if (islandIds.length === 0) {
      const initial = Object.values(this.programs).find((p) => p.iterationFound === 0);
      if (initial) return initial;
      const allIds = Object.keys(this.programs);
      if (allIds.length === 0) return null;
      return this.programs[allIds[Math.floor(Math.random() * allIds.length)]];
    }

    if (Math.random() < this.explorationRatio) {
      return this.programs[islandIds[Math.floor(Math.random() * islandIds.length)]];
    }
    const programs = islandIds.map((id) => this.programs[id]);
    return programs.reduce((best, p) => isBetter(p, best) ? p : best);
  }

  getProgram(id) {
    return this.programs[id] ?? null;
  }

  get bestProgram() {
    return this.bestProgramId ? this.programs[this.bestProgramId] ?? null : null;
  }
}
