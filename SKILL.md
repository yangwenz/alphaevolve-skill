---
name: alphaevolve-skill
description: |
  Evolutionary code optimizer. Use when the user asks to "evolve", "optimize a function",
  "run alphaevolve", "evolve this code", or wants to iteratively improve code performance
  against a measurable metric. Wraps coding agent as a mutation engine inside an evolutionary loop
  with population-based search, automated evaluation, and iterative refinement.
argument-hint: <target_file> <target_name> [line:<N> or signature] [iterations] [goal] [eval_command]
---

# AlphaEvolve — Evolutionary Code Optimization Loop

Evolve a target function/method/class through iterative mutation and selection, using an island-model population database to maintain diversity and avoid local optima.

## Workflow

### Step 0: Validate Inputs

1. Verify the target file exists. If not, report the error and stop.
2. Read the target file and locate the target by name.
3. If multiple definitions match the target name:
   - If a disambiguator was provided, use it to select the correct one.
   - If no disambiguator was provided, list all candidates with their line numbers and signatures, then **ask the user** which one to evolve.
4. If no definition matches, report similar names found in the file and stop.

### Step 1: Setup Output Directory

Create the output directory structure at `evolve-output/` (relative to project root):

```bash
mkdir -p evolve-output/database evolve-output/context evolve-output/candidates evolve-output/best
```

### Step 2: Load Population Database

```javascript
import { Database, Program } from './scripts/database.mjs';
const db = await Database.create('evolve-output/database');
```

If the database already has programs (resuming a previous run):
- Report: "Resuming from iteration {db.lastIteration}. Current best score: {bestProgram.metrics}"
- Skip Step 4 (seeding).

### Step 3: Extract Context

Follow the procedure in `references/context.md`:

1. Read the target file.
2. Locate the target (using disambiguator if needed).
3. Extract imports that the target depends on.
4. Write a 1-2 sentence goal description of what the target does.
5. Extract dependency signatures (functions/classes the target calls).
6. Save to `evolve-output/context/<filename>_<target_name>.md`.
7. If the context file already exists and the source file hasn't changed, reuse it.

### Step 4: Seed the Population

Only if the database is empty:

1. Read the current implementation of the target.
2. Evaluate it (see Step 6e) to get a baseline score.
3. Create a Program and add it to the database:
   ```javascript
   const seed = new Program({
     code: currentImplementation,
     parentId: "0",
     metrics: baselineMetrics,
     changes: "initial implementation"
   });
   await db.addProgram(seed);
   ```
4. Report: "Baseline score: {metrics}. Starting evolution."

### Step 5: Evolution Loop

Repeat for each iteration from 1 to N (default N=10):

#### 5a. Sample Parent and Inspirations

```javascript
const { parent, inspirations } = db.sample();
```

If parent is null, report an error and stop.

#### 5b. Build the Mutation Prompt

Assemble the prompt with these sections:

**System message:**
```
You are an expert code optimizer. Your goal: {optimization_goal}.
Generate an improved version of the target code that scores higher on the evaluation metric.
It must maintain the exact same signature (name, parameters, return type).

Respond with EXACTLY two sections, in this order:

CHANGES: <one-line summary of what you changed and why>
CODE:
<the replacement code for the target function/method/class — no markdown fences, no explanation>
```

**User message — assemble in order:**

1. **Context** (from the extracted context file):
   - Goal description
   - Imports
   - Dependency signatures

2. **Parent code:**
   ```
   # Current Implementation (to improve)

   {parent.code}
   ```

3. **Evaluation history** (from inspirations):
   ```
   # Previous Attempts

   ## Attempt 1 — Score: {metrics}
   Changes: {changes}

   ## Attempt 2 — Score: {metrics}
   Changes: {changes}
   ...
   ```

4. **Mutation directive** (rotate to maintain diversity):
   - Iterations 1–3: "Try a different algorithm or data structure."
   - Iterations 4–6: "Optimize the hot path — reduce allocations, avoid branching, eliminate redundant computation."
   - Iterations 7–9: "Try a fundamentally different approach to the problem."
   - Iterations 10+: "Combine the best ideas from previous attempts into a single superior solution."

5. **Constraints reminder:**
   ```
   CONSTRAINTS:
   - Same function/method/class signature — do not rename or change parameters.
   - Must remain correct — do not sacrifice correctness for performance.
   - Output ONLY the replacement code, nothing else.
   ```

#### 5c. Generate Variant

Send the prompt to a subagent. Parse the response into two parts:
- **changes**: the text after `CHANGES:` (one-line summary)
- **code**: everything after `CODE:` (the candidate implementation)

If the response contains markdown fences, strip them from the code portion.

#### 5d. Write Candidate to Disk

1. Copy the target file to `evolve-output/candidates/iteration_<N>.<ext>`.
2. In the copy, replace the target function/method/class with the generated variant.

#### 5e. Evaluate the Candidate

**Always run the LLM-as-judge evaluator** using the system prompt from `references/evaluator.md`:
1. Read the candidate code from the file written in 5d.
2. Send it to the LLM with the system prompt from `references/evaluator.md`.
3. Parse the JSON response: `{"efficiency-score": <1-10>}`.
4. Compute: `llm_score = efficiency_score / 10.0`.

**If an eval_command was provided**, also run it:
1. Execute: the eval_command with `$FILE` replaced by the candidate file path.
2. Parse JSON output for numeric scores.
3. If the command exits non-zero or output is unparseable: `cmd_score = -Infinity`.

**Correctness gate** (always attempt):
- Detect the project's test runner (check `package.json` scripts, `Makefile`, or common patterns).
- Run tests with the candidate in place.
- If tests fail: final score = `-Infinity` (reject candidate).
- If no test runner is detected, skip this gate and note it in the output.

**Final score:**
- LLM evaluator only: `final_score = llm_score`
- Both evaluators: `final_score = (llm_score + normalize(cmd_score)) / 2`

Store individual scores in metrics: `{ "efficiency": llm_score, "benchmark": cmd_score }` (omit benchmark key if no eval_command).

#### 5f. Update Population

If final_score is not `-Infinity`:
1. Create and add the program (using the `changes` parsed from the LLM response in 5c):
   ```javascript
   const candidate = new Program({
     code: candidateCode,
     parentId: parent.id,
     metrics: { efficiency: llmScore, benchmark: cmdScore },
     changes: changesFromLLM
   });
   await db.addProgram(candidate);
   ```

If final_score is `-Infinity`: do not add to population.

#### 5g. Report Progress

After each iteration, print:
```
Iteration <N>/<total> | efficiency: <llm_score> | benchmark: <cmd_score or n/a> | best: <db.bestProgram.metrics>
  Δ <one-line change summary>
  → <accepted | rejected (tests failed) | rejected (below threshold)>
```

### Step 6: Finalize

After all iterations complete:

1. Retrieve `db.bestProgram`.
2. Write the best code to `evolve-output/best/<target_file_name>`.
3. Report to the user:
   ```
   Evolution complete.
   Baseline: <seed metrics>
   Best:     <best metrics> (iteration <N>)
   Improvement: <delta or percentage>

   Strategy that worked best: <summarize from changes field>
   ```
4. Show the best implementation code.
5. **Ask the user**: "Apply this implementation to the original source file?"
   - If yes: replace the target in the original file with the best code.
   - If no: leave the original unchanged. The result is saved in `evolve-output/best/`.

## Error Handling

- **Target not found**: Report similar names in the file with their line numbers. Stop.
- **Ambiguous target**: List all matches with line numbers and signatures. Ask the user to provide `line:<N>` or a signature. Stop until resolved.
- **Evaluator broken on seed**: If the LLM evaluator or eval_command fails on the initial implementation, report the error and stop — the evaluation setup is misconfigured.
- **All candidates rejected in an iteration**: Report "All variants failed correctness this iteration — mutations may be too aggressive." Continue to next iteration with existing population.
- **Database corrupted**: Back up the corrupted `database.json`, delete it, and start fresh.

## Resuming

If `evolve-output/database/database.json` exists with programs:
- Skip seeding.
- Start from iteration `db.lastIteration + 1`.
- Report current best before continuing.

## Configuration Defaults

| Parameter | Default |
|-----------|---------|
| Iterations | 10 |
| Islands | 3 |
| Max island size | 40 |
| Migration interval | 10 |
| Migration rate | 0.1 |
| Exploration ratio | 0.3 |
