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
