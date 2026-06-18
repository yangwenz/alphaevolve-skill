# AlphaEvolve Skill

An [AlphaEvolve](https://deepmind.google/discover/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)-style **evolutionary code optimizer** for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex](https://openai.com/index/codex/). It uses a coding agent as the mutation engine inside an evolutionary loop — maintaining a population of candidate programs, selecting parents, spawning mutations, and keeping only the fittest.

## How It Works

The optimizer wraps coding agent capabilities in a population-based search loop:

```
Seed → [ Sample → Mutate → Evaluate → Select → Migrate ] × N
```

| Step | Description |
|------|-------------|
| **Seed** | Evaluate the target function to establish a baseline score |
| **Sample** | Select a parent from the island population (biased toward top performers, with exploration for diversity) |
| **Mutate** | A subagent rewrites the target to improve it, informed by the history of previous attempts |
| **Evaluate** | Score the mutant via an LLM judge (and optionally a shell benchmark), gated by an optional test suite |
| **Select** | Insert the candidate into the population; prune weak programs per-island |
| **Migrate** | Periodically move top performers between islands to spread good solutions and escape local optima |

After all iterations complete, the best candidate is presented with a before/after comparison.

## Installation

**Claude Code:**

```bash
npx skills add https://github.com/yangwenz/alphaevolve-skill --skill alphaevolve-skill -a claude-code
```

**Codex:**

```bash
npx skills add https://github.com/yangwenz/alphaevolve-skill --skill alphaevolve-skill -a codex
```

> No external dependencies required — the database and CLI are plain ESM JavaScript (Node.js 18+).

## Usage

Trigger the skill with natural language in your coding agent CLI:

```bash
# Basic usage
evolve the function processItems in src/pipeline.ts

# Custom goal and iteration count
run alphaevolve on the sort method in utils/sort.py — optimize for speed, 20 iterations

# With a test suite as correctness gate
optimize the render function in components/Chart.jsx with test command "npm test"
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|:--------:|---------|-------------|
| Target file | Yes | — | Path to the file containing the code to optimize |
| Target name | Yes | — | Function, method, or class name to evolve |
| Iterations | No | 10 | Number of evolutionary cycles to run |
| Optimization goal | No | "optimize code efficiency" | What the optimizer should aim for |
| Test command | No | *(skip)* | Shell command to validate correctness |
| Eval command | No | *(LLM-only)* | Benchmark script that outputs a score in `[0.0, 1.0]` |

### Using a Benchmark

If you have a benchmark script that outputs a numeric score in `[0.0, 1.0]`:

```bash
evolve parseJSON in src/parser.ts — 15 iterations, test with "npm test", eval with "node bench/parse.mjs"
```

The eval command score is combined with the LLM judge score (50/50 weight) to determine final fitness.

## Project Structure

```
alphaevolve-skill/
├── SKILL.md                  # Skill definition and workflow spec
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

All artifacts are written to `evolve-output/` in your working directory:

```
evolve-output/
├── database/          # Population state (database.json)
├── context/           # Extracted dependency context
├── candidates/        # Each iteration's mutated file
└── best/              # The winning implementation
```

Runs are **resumable** — if interrupted, the skill detects existing state and offers to continue from where it left off.

## Learn More

For more details, visit [the getting started guide](https://www.wisebuilder.dev/projects/tutorials/alphaevolve-skill/getting-started).
