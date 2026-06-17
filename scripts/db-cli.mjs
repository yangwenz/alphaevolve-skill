#!/usr/bin/env node

import { Database, Program } from './database.mjs';

const USAGE = `Usage: node scripts/db-cli.mjs <command> [options]

Commands:
  create <dbPath>                         Create/load database, print status as JSON
  info <dbPath>                           Print database status (isEmpty, lastIteration, bestMetrics, seedCodePath)
  seed <dbPath> --codePath --targetCode --metrics [--changes]
                                          Add seed program (parentId=0)
  add <dbPath> --codePath --targetCode --parentId --metrics --changes
                                          Add a new program
  sample <dbPath>                         Sample parent + inspirations, print as JSON
  best <dbPath>                           Print best program as JSON
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const dbPath = args[1];

  if (!command || !dbPath) {
    console.error(USAGE);
    process.exit(1);
  }

  const opts = parseFlags(args.slice(2));
  const db = await Database.create(dbPath);

  switch (command) {
    case 'create':
    case 'info': {
      const seed = db.getSeedProgram();
      console.log(JSON.stringify({
        isEmpty: Object.keys(db.programs).length === 0,
        lastIteration: db.lastIteration,
        programCount: Object.keys(db.programs).length,
        bestProgramId: db.bestProgramId || null,
        bestMetrics: db.bestProgram?.metrics ?? null,
        seedCodePath: seed?.codePath ?? null,
        seedTargetCode: seed?.targetCode ?? null,
      }));
      break;
    }

    case 'seed': {
      requireFlags(opts, ['codePath', 'targetCode', 'metrics']);
      const metrics = JSON.parse(opts.metrics);
      const program = new Program({
        codePath: opts.codePath,
        targetCode: opts.targetCode,
        parentId: "0",
        metrics,
        changes: opts.changes || "initial implementation",
      });
      await db.addProgram(program);
      console.log(JSON.stringify({ id: program.id, metrics: program.metrics }));
      break;
    }

    case 'add': {
      requireFlags(opts, ['codePath', 'targetCode', 'parentId', 'metrics', 'changes']);
      const metrics = JSON.parse(opts.metrics);
      const program = new Program({
        codePath: opts.codePath,
        targetCode: opts.targetCode,
        parentId: opts.parentId,
        metrics,
        changes: opts.changes,
      });
      await db.addProgram(program);
      console.log(JSON.stringify({
        id: program.id,
        metrics: program.metrics,
        bestProgramId: db.bestProgramId,
        bestMetrics: db.bestProgram?.metrics ?? null,
        lastIteration: db.lastIteration,
      }));
      break;
    }

    case 'sample': {
      const { parent, inspirations } = db.sample();
      if (!parent) {
        console.log(JSON.stringify({ parent: null, inspirations: [] }));
      } else {
        console.log(JSON.stringify({
          parent: {
            id: parent.id,
            codePath: parent.codePath,
            targetCode: parent.targetCode,
            metrics: parent.metrics,
            changes: parent.changes,
          },
          inspirations: inspirations.map(p => ({
            id: p.id,
            metrics: p.metrics,
            changes: p.changes,
          })),
        }));
      }
      break;
    }

    case 'best': {
      const best = db.bestProgram;
      if (!best) {
        console.log(JSON.stringify({ best: null }));
      } else {
        console.log(JSON.stringify({
          id: best.id,
          codePath: best.codePath,
          targetCode: best.targetCode,
          metrics: best.metrics,
          changes: best.changes,
          iterationFound: best.iterationFound,
        }));
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}\n${USAGE}`);
      process.exit(1);
  }
}

function parseFlags(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
      opts[key] = val;
      if (val !== 'true') i++;
    }
  }
  return opts;
}

function requireFlags(opts, required) {
  for (const flag of required) {
    if (!(flag in opts)) {
      console.error(`Missing required flag: --${flag}`);
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
