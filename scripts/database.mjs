export class Program {
  constructor({
    id,
    code,
    language = 'python',
    parentId = null,
    generation = 0,
    timestamp = Date.now() / 1000,
    iterationFound = 0,
    metrics = {},
  }) {
    this.id = id;
    this.code = code;
    this.language = language;
    this.parentId = parentId;
    this.generation = generation;
    this.timestamp = timestamp;
    this.iterationFound = iterationFound;
    this.metrics = metrics;
  }

  toDict() {
    return {
      id: this.id,
      code: this.code,
      language: this.language,
      parent_id: this.parentId,
      generation: this.generation,
      timestamp: this.timestamp,
      iteration_found: this.iterationFound,
      metrics: this.metrics,
    };
  }

  static fromDict(data) {
    return new Program({
      id: data.id,
      code: data.code,
      language: data.language ?? 'python',
      parentId: data.parent_id ?? null,
      generation: data.generation ?? 0,
      timestamp: data.timestamp ?? Date.now() / 1000,
      iterationFound: data.iteration_found ?? 0,
      metrics: data.metrics ?? {},
    });
  }
}
