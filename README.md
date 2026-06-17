# alphaevolve-skill

An [AlphaEvolve](https://deepmind.google/discover/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)-style evolutionary code optimizer. It drives a coding agent as the mutation engine inside an evolutionary loop — maintaining a population of candidate programs, selecting parents, spawning mutations, and keeping only the fittest.

## How It Works

The skill wraps coding agent capabilities in a population-based search loop:

1. **Seed** — The target function is evaluated to establish a baseline score.
2. **Sample** — A parent is selected from the current island population (biased toward top performers, with an exploration ratio for diversity).
3. **Mutate** — A subagent rewrites the target to improve efficiency, informed by the history of previous attempts.
4. **Evaluate** — The mutant is scored by an LLM judge (and optionally a shell benchmark), gated by an optional test suite.
5. **Select** — The candidate enters the population; weak programs are pruned per-island.
6. **Migrate** — Periodically, top performers migrate between islands to spread good genes and escape local optima.

After N iterations, the best candidate is presented with a before/after comparison.

## Installation

```bash
npx skills add https://github.com/yangwenz/alphaevolve-skill
```

No dependencies to install — the database and CLI are plain ESM JavaScript (Node.js 18+).

## Usage

In Claude Code, trigger the skill with natural language:

```
evolve the function processItems in src/pipeline.ts
```

```
run alphaevolve on the sort method in utils/sort.py — optimize for speed, 20 iterations
```

```
optimize the render function in components/Chart.jsx with test command "npm test"
```

### Parameters

| Parameter | Required | Default |
|-----------|----------|---------|
| Target file | Yes | — |
| Target name (function/method/class) | Yes | — |
| Number of iterations | No | 10 |
| Optimization goal | No | "optimize code efficiency" |
| Test command (correctness gate) | No | none (skip) |
| Eval command (benchmark scorer) | No | none (LLM-only) |

### With a benchmark

If you have a benchmark script that outputs a score in `[0.0, 1.0]`:

```
evolve parseJSON in src/parser.ts — 15 iterations, test with "npm test", eval with "node bench/parse.mjs"
```

The eval command's output is combined with the LLM judge score (50/50 weight) for the final fitness.

## Architecture

```
alphaevolve-skill/
├── SKILL.md                  # Skill definition (the full workflow spec)
├── scripts/
│   ├── database.mjs          # Island-model population database
│   └── db-cli.mjs            # CLI wrapper for database operations
├── references/
│   ├── context.md            # Context extraction procedure
│   └── evaluator.md          # LLM-as-judge evaluation rubric
└── tests/
    └── database.test.mjs     # Database unit tests
```

## Output

All artifacts are written to `evolve-output/` in the working directory:

```
evolve-output/
├── database/          # Population state (database.json)
├── context/           # Extracted dependency context
├── candidates/        # Each iteration's mutated file
└── best/              # The winning implementation
```

Runs are resumable — if interrupted, the skill detects existing state and offers to continue.
