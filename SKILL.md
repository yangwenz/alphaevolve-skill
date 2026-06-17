# AlphaEvolve Optimization Loop

An evolutionary code optimizer skill. It evolves candidate programs against a user-defined evaluation function using an island-model population database, iterating until a quality threshold or iteration limit is reached.

## Invocation

The user provides:
- **Target file**: Path to the source file containing the code to optimize.
- **Target name**: The function, method, or class name to evolve.
- **Target disambiguator** (required when overloads exist): A line number or full signature to identify the exact target when multiple definitions share the same name. Examples: `line:42`, `(int, str) -> bool`, `(self, request: HttpRequest) -> Response`.
- **Evaluation command** (optional): A shell command that takes a file path argument and outputs a JSON score (e.g., `python bench.py --target $FILE`). Used as an additional scoring signal alongside the LLM evaluator.
- **Optimization goal** (optional): What metric to optimize (e.g., "minimize p99 latency", "maximize throughput"). Defaults to "maximize efficiency".
- **Iterations** (optional): Number of evolution iterations. Defaults to 10.
- **Output directory** (optional): Where to store the database and artifacts. Defaults to `output/`.

## Execution Steps

### 1. Setup

1. Create the output directory structure:
   ```
   <output_dir>/
     database/       — population database (database.json)
     context/        — extracted context files
     candidates/     — candidate implementations per iteration
     best/           — current best implementation
   ```
2. Load or create the population database from `<output_dir>/database/` using `Database.create()` from `scripts/database.mjs`.

### 2. Extract Context

Follow the instructions in `references/context.md` to extract context for the target:
- Read the target file and locate the target function/method/class.
- If the target name is ambiguous (multiple definitions), use the disambiguator:
  - **Line number** (e.g., `line:42`): select the definition at or containing that line.
  - **Signature fragment** (e.g., `(int, str) -> bool`): match by parameter types or return type.
- If no disambiguator is provided and multiple matches exist, report all candidates with their line numbers and signatures, then stop and ask the user to specify.
- Extract imports, dependency signatures, and a goal description.
- Save the context file to `<output_dir>/context/<filename>_<target_name>.md`.
- If the context file already exists and the source hasn't changed, reuse it.

### 3. Seed the Population

If the database is empty (no programs exist):
1. Read the current implementation of the target from the source file.
2. Run the evaluator against the current implementation to get a baseline score (see step 4e).
3. Create a `Program` with the current code, the baseline metrics, and empty changes.
4. Add it to the database via `addProgram()`.
5. Report the baseline score to the user.

### 4. Evolution Loop

For each iteration from 1 to N:

#### 4a. Sample Parent and Inspirations

Call `database.sample()` to get a parent program and a set of inspiration programs from the population.

If the parent is null (shouldn't happen after seeding), report an error and stop.

#### 4b. Build the Mutation Prompt

Assemble a prompt that includes:

1. **System context**: You are an expert code optimizer. Your goal is to improve the given code to {optimization_goal}. Generate a modified version that scores higher on the evaluation metric.

2. **Target context**: The extracted context from step 2 (imports, dependencies, goal description).

3. **Parent code**: The full code of the parent program being evolved.

4. **Evaluation history** (from inspirations): For each inspiration program, include:
   - Its score/metrics
   - A summary of what changes it made (the `changes` field)
   - Whether those changes helped or hurt

5. **Mutation directives**: Vary these across iterations to maintain diversity:
   - Iterations 1-3: "Try a different algorithm or data structure"
   - Iterations 4-6: "Optimize the hot path — reduce allocations, branching, or redundant computation"
   - Iterations 7-9: "Try a fundamentally different approach to the problem"
   - Iteration 10+: "Combine the best ideas from previous attempts"

6. **Constraints**:
   - The output must be a complete, valid replacement for the target function/method/class.
   - It must maintain the same signature (parameters, return type).
   - It must pass all existing tests (correctness is non-negotiable).
   - Output only the replacement code — no explanation, no markdown fences.

#### 4c. Generate Variant

Send the assembled prompt to the LLM. Parse the response as the candidate code.

#### 4d. Write Candidate to Disk

1. Copy the target file to `<output_dir>/candidates/iteration_<N>.ext`.
2. Replace the target function/method/class body in the copy with the generated variant.

#### 4e. Evaluate the Candidate

Evaluation always runs the LLM-as-judge evaluator, and optionally runs a shell command evaluator if one is provided.

**LLM-as-judge evaluator (always runs):**
1. Read the candidate code.
2. Send it to the LLM with the system prompt from `references/evaluator.md`.
3. Parse the JSON response to extract the `efficiency-score` (integer 1-10).
4. Normalize: `llm_score = efficiency-score / 10.0`.

**Shell command evaluator (if provided):**
1. Execute: `<evaluation_command>` with the candidate file path substituted for `$FILE`.
2. Parse the output as JSON. Extract numeric score(s).
3. If the command exits non-zero or produces no parseable output, assign `cmd_score = -Infinity` (failed candidate).

**Correctness gate (always applied):**
- If a test command is available (e.g., detected from `package.json` scripts, `Makefile`, or user-specified), run tests against the candidate.
- If tests fail, reject the candidate (final score = `-Infinity`) regardless of evaluation scores.

**Final score computation:**
- If only the LLM evaluator ran: `final_score = llm_score`.
- If both evaluators ran: `final_score = 0.5 * llm_score + 0.5 * normalize(cmd_score)` (normalize cmd_score to 0-1 range based on the baseline).
- Store both individual scores in the metrics dict for transparency: `{ "efficiency": llm_score, "benchmark": cmd_score }`.

#### 4f. Update Population

1. Create a `Program` with:
   - `code`: the candidate code
   - `parentId`: the parent's id
   - `metrics`: the evaluation scores (e.g., `{ "efficiency": 0.8, "benchmark": 0.75 }`)
   - `changes`: a one-line description of what changed from the parent (generate this by diffing parent vs candidate)
2. Only add to the database if the final score is not `-Infinity` (passed correctness gate).
3. Call `database.addProgram(program)` — this handles island placement, migration, and pruning automatically.

#### 4g. Report Progress

After each iteration, report to the user:
```
Iteration <N>/<total>: efficiency=<llm_score> benchmark=<cmd_score|n/a> (best so far: <best_score>)
  Change: <one-line summary of what this variant tried>
  Status: <accepted into population | rejected (tests failed) | rejected (score too low)>
```

### 5. Finalize

After all iterations complete (or if the user interrupts):

1. Retrieve `database.bestProgram` — the highest-scoring program in the population.
2. Write the best implementation to `<output_dir>/best/<filename>`.
3. Show the user:
   - The best score achieved vs the baseline score.
   - The best implementation code.
   - A summary of the evolutionary trajectory (how many iterations, what strategies worked).
4. Ask the user whether to apply the best implementation back to the original source file.

## Evaluation Design Principles

When helping users design custom evaluators, follow this cascade:

1. **Correctness gate**: All existing tests must pass. Binary — fail means reject.
2. **Primary metric**: The property being optimized (latency, throughput, memory, score).
3. **Guard metrics**: Properties that must NOT regress beyond a threshold (e.g., memory < 2x baseline).
4. **Cheap checks first**: Syntax/type-check before running expensive benchmarks.

## Configuration Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| Iterations | 10 | Number of evolution iterations |
| Population islands | 3 | Number of island sub-populations |
| Max island size | 40 | Programs per island before pruning |
| Migration interval | 10 | Generations between migrations |
| Migration rate | 0.1 | Fraction of top programs that migrate |
| Exploration ratio | 0.3 | Probability of sampling a random parent vs elite |

## Error Handling

- If the target function cannot be found in the source file, report the error with line numbers of similar names and stop.
- If multiple definitions match and no disambiguator was provided, list all candidates with line numbers and signatures, then ask the user to provide a line number or signature to disambiguate.
- If the evaluator fails on the seed implementation, report the error and stop (the evaluator itself is broken).
- If all variants in an iteration fail the correctness gate, report this and suggest the mutations are too aggressive — the next iteration will still proceed with the existing population.
- If the database file is corrupted, back it up and start fresh.

## Resuming a Previous Run

If the database already contains programs (from a previous run):
- Skip seeding (step 3).
- Continue from the next iteration number (`database.lastIteration + 1`).
- Report the current best score before starting new iterations.
