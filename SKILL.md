---
name: alphaevolve-skill
description: |
  Evolutionary code optimizer. Use when the user asks to "evolve", "optimize a function",
  "run alphaevolve", "evolve this code", or wants to iteratively improve code performance
  against a measurable metric. Wraps coding agent as a mutation engine inside an evolutionary loop
  with population-based search, automated evaluation, and iterative refinement.
---

# Evolutionary Code Optimization Loop

Evolve a target function/method/class through iterative mutation and selection, using an island-model population database to maintain diversity and avoid local optima.

If `goal` is not provided, default to: "optimize code efficiency — make the code faster and with less anti-patterns."

## Workflow

### Step 0: Validate Inputs

Infer the following from the user's request:

| Input | Required? | Default |
|-------|-----------|---------|
| target file | **Required** | — (ask user if not inferrable) |
| target name | **Required** | — (ask user if not inferrable) |
| disambiguator | Optional | none (ask only if multiple matches found) |
| number of iterations | Optional | 10 |
| optimization goal | Optional | "optimize code efficiency — make the code faster and with less anti-patterns" |
| eval command | Optional | none (LLM evaluator only) |

If either required input cannot be inferred, **ask the user** before proceeding.

1. Verify the target file exists. If not, report the error and stop.
2. Read the target file and locate the target by name.
3. If multiple definitions match the target name:
   - If a disambiguator was provided, use it to select the correct one.
   - If no disambiguator was provided, list all candidates with their line numbers and signatures, then **ask the user** which one to evolve.
4. If no definition matches, report similar names found in the file and stop.

### Step 1: Setup Output Directory & Load Database

All paths prefixed with `scripts/` or `references/` are relative to the skill's installation directory (the directory containing this `SKILL.md` file). Resolve this directory first and use absolute paths when invoking these files (e.g., `node /absolute/path/to/scripts/db-cli.mjs`).

Ensure the directory structure exists:

```bash
mkdir -p evolve-output/database evolve-output/context evolve-output/candidates evolve-output/best
```

All database interactions use the CLI wrapper at `scripts/db-cli.mjs`. Load/create the database and check its status:

```bash
node <skill_dir>/scripts/db-cli.mjs info evolve-output/database
```

This outputs JSON: `{ "isEmpty": bool, "lastIteration": int, "programCount": int, "bestMetrics": object|null, "seedCodePath": string|null, "seedTargetCode": string|null }`.

If `isEmpty` is false, **ask the user**: "An existing evolution run was found ({programCount} programs, best score: {bestMetrics}). Resume or start fresh?"
- **Resume**: keep the directory intact. Report: "Resuming from iteration {lastIteration}. Current best score: {bestMetrics}". Skip Step 3 (seeding).
- **Start fresh**: `rm -rf evolve-output/` — then re-run `mkdir -p` and the `info` command above.

### Step 2: Extract Context

Follow the procedure in `<skill_dir>/references/context.md`:

1. Read the target file.
2. Locate the target (using disambiguator if needed).
3. Extract imports that the target depends on.
4. Write a 1-2 sentence goal description of what the target does.
5. Extract dependency signatures (functions/classes the target calls).
6. Save to `evolve-output/context/<filename>_<target_name>.md`.
7. If the context file already exists, compare the source file's modification time (`stat -f %m <file>` on macOS or `stat -c %Y <file>` on Linux) against the context file's modification time. If the source is newer, re-extract. Otherwise, reuse the existing context file.

### Step 3: Seed the Population

Only if the database is empty (`isEmpty` is true from the `info` command):

1. The target file is the seed candidate. Its absolute path will be stored as `codePath`.
2. Extract the target function/method/class code from the file (the exact source text).
3. Evaluate it using the full evaluation procedure in Step 4e (correctness gate + LLM evaluator + optional command evaluator) to get a baseline score. If the evaluation fails on the seed, report the error and stop — the evaluation setup is misconfigured.
4. Add the seed program:
   ```bash
   node <skill_dir>/scripts/db-cli.mjs seed evolve-output/database \
     --codePath "/absolute/path/to/target/file.ext" \
     --targetCode "extracted target code" \
     --metrics '{"efficiency-score": 0.7}'
   ```
   Note: `--targetCode` and `--metrics` values must be properly shell-escaped. For multi-line targetCode, write it to a temp file and use `--targetCode "$(cat /tmp/target_code.txt)"`.
5. Report: "Baseline score: {metrics}. Starting evolution."

### Step 4: Evolution Loop

Repeat for each iteration `i` from 1 to N (default N=10). The loop counter `i` always increments regardless of whether a candidate is accepted or discarded. On resume, `i` starts from `lastIteration + 1` (see Resuming section).

#### 4a. Sample Parent and Inspirations

```bash
node <skill_dir>/scripts/db-cli.mjs sample evolve-output/database
```

This outputs JSON: `{ "parent": { "id", "codePath", "targetCode", "metrics", "changes" }, "inspirations": [...] }`.

If `parent` is null, report an error and stop.

#### 4b. Write Parent to Disk

Copy the parent's file to the candidate path for this iteration. `<ext>` is the file extension from the original target file (e.g., `.py`, `.ts`, `.js`):

```bash
cp <parent.codePath> evolve-output/candidates/iteration_<i>.<ext>
```

This gives the subagent a real file to edit in place.

#### 4c. Dispatch Subagent to Mutate

Spawn a subagent with the following prompt. The subagent operates on the candidate file written in 4b and edits it directly using its tools.

**Subagent prompt — assemble in order:**

1. **Task:**
   ```
   You are an expert code optimizer. Your goal: {optimization_goal}.
   Modify the function/method/class `{target_name}` in the file `evolve-output/candidates/iteration_<i>.<ext>` to improve its efficiency.
   Edit the file in place. Do not change the signature (name, parameters, return type).
   Do not modify anything outside the target.
   ```

2. **Context** (from the extracted context file):
   - Goal description
   - Imports
   - Dependency signatures

3. **Evaluation history** (from inspirations):
   ```
   # Previous Attempts

   ## Attempt 1 — Score: {metrics}
   Changes: {changes}

   ## Attempt 2 — Score: {metrics}
   Changes: {changes}
   ...
   ```

4. **Constraints:**
   ```
   CONSTRAINTS:
   - Same function/method/class signature — do not rename or change parameters.
   - Must remain correct — do not sacrifice correctness for performance.
   - Edit the file in place. Only modify the target `{target_name}`.
   - After editing, respond with a one-line CHANGES summary of what you did and why.
   ```

The subagent edits `evolve-output/candidates/iteration_<i>.<ext>` using its coding tools (Read, Edit, Write) and returns a `changes` summary.

If the subagent fails (errors out, times out, or leaves the file unchanged from the parent), retry the subagent once with the same prompt. If it fails again, discard this iteration and continue to the next.

#### 4d. Read the Mutated Candidate

After the subagent finishes:
1. The candidate file is at `evolve-output/candidates/iteration_<i>.<ext>` (absolute path). This is the `codePath` for the new Program.
2. Extract the target function/method/class from the candidate file — this is the `targetCode`.
3. Capture the `changes` summary from the subagent's response.
4. Record the parent's id (`parent.id`) — this will be used as `parentId` when creating the new Program.

#### 4e. Evaluate the Candidate

`<original_target_file>` refers to the user-provided target file path (the file being optimized, at its original location in the project). `<candidate_file>` is the absolute path `evolve-output/candidates/iteration_<i>.<ext>`.

**Step 1 — Correctness gate (run first, always attempt):**
- Detect the project's test runner (check `package.json` scripts, `Makefile`, or common patterns).
- Back up the original target file: `cp <original_target_file> <original_target_file>.bak`
- Copy the candidate to the original location: `cp <candidate_file> <original_target_file>`
- Run tests.
- **Always** restore the original, even if tests fail: `mv <original_target_file>.bak <original_target_file>`
- If tests fail: **discard this candidate and continue to the next iteration** (skip the remaining evaluation steps).
- If no test runner is detected, skip this gate and note it in the output.

**Step 2 — LLM-as-judge evaluator** (using `<skill_dir>/references/evaluator.md`):
1. Use the `targetCode` extracted in 4d (just the target function/method/class, not the full file).
2. Spawn a subagent whose prompt begins with the full contents of `<skill_dir>/references/evaluator.md`, followed by a separator line (`---`), followed by the `targetCode`.
3. Parse the JSON response: `{"efficiency-score": <1-10>}`. If parsing fails (invalid JSON, missing key, or score outside 1–10), retry the subagent once. If it fails again, discard this candidate and continue to the next iteration.
4. Compute: `llm_score = efficiency_score / 10.0`.

**Step 3 — Shell command evaluator** (only if an eval_command was provided):
1. Back up the original target file: `cp <original_target_file> <original_target_file>.bak`
2. Copy the candidate to the original location: `cp <candidate_file> <original_target_file>`
3. Execute the eval_command (no `$FILE` substitution — it runs against the code at its original path).
4. Extract `cmd_score` from the command's stdout:
   - First, try parsing stdout as JSON. If valid JSON, look for a numeric value under any of these keys (in order): `score`, `result`, `value`. Use the first match.
   - If stdout is not valid JSON, find the last numeric value (integer or float) in the output and use that.
   - If no numeric value can be found, report an error to the user and halt the entire evolution run.
5. If the command exits non-zero, report the error and halt the entire evolution run.
6. Validate the score is in [0.0, 1.0]. If out of range, report an error to the user and halt the entire evolution run.
7. **Always** restore the original: `mv <original_target_file>.bak <original_target_file>`

**Final score:**
- LLM evaluator only: `final_score = llm_score`
- Both evaluators: `final_score = (llm_score + cmd_score) / 2`

Store individual scores in metrics: `{ "efficiency-score": llm_score, "benchmark-score": cmd_score }` (omit `"benchmark-score"` key if no eval_command).

#### 4f. Update Population

Add the candidate to the database (codePath is the absolute path to the candidate file from 4d, targetCode and changes come from 4d):

```bash
node <skill_dir>/scripts/db-cli.mjs add evolve-output/database \
  --codePath "/absolute/path/to/evolve-output/candidates/iteration_<i>.<ext>" \
  --targetCode "$(cat /tmp/target_code.txt)" \
  --parentId "<parent.id from 4a>" \
  --metrics '{"efficiency-score": 0.7, "benchmark-score": 0.8}' \
  --changes "one-line summary from subagent"
```

This outputs JSON: `{ "id", "metrics", "bestProgramId", "bestMetrics", "lastIteration" }`.

Note: Write `targetCode` to a temp file first to avoid shell quoting issues with multi-line code. Omit `"benchmark-score"` from metrics if no eval_command.

#### 4g. Report Progress

After each iteration, print:
```
Iteration <i>/<N> | efficiency-score: <llm_score> | benchmark-score: <cmd_score or n/a> | best: <db.bestProgram.metrics>
  Δ <change summary>
```

### Step 5: Finalize

After all iterations complete:

1. Retrieve the best program:
   ```bash
   node <skill_dir>/scripts/db-cli.mjs best evolve-output/database
   ```
   This outputs JSON: `{ "id", "codePath", "targetCode", "metrics", "changes", "iterationFound" }`.

2. Copy the best candidate file to the output: `cp <best.codePath> evolve-output/best/<target_file_name>`.
3. Report to the user:
   ```
   Evolution complete.
   Baseline: <seed metrics>
   Best:     <best metrics> (iteration <iterationFound>)
   Improvement: <delta or percentage>

   Strategy that worked best: <summarize from changes field>
   ```
4. Show the best implementation's target code (`best.targetCode`).
5. **Ask the user**: "Apply this implementation to the original source file?"
   - If yes: Read the original target file, replace only the target function/method/class with `best.targetCode` (preserving everything else in the file), and write the file back. Do NOT copy the entire candidate file over the original.
   - If no: leave the original unchanged. The result is saved in `evolve-output/best/`.

## Error Handling

- **Target not found**: Report similar names in the file with their line numbers. Stop.
- **Ambiguous target**: List all matches with line numbers and signatures. Ask the user to provide `line:<N>` or a signature. Stop until resolved.
- **Evaluator broken on seed**: If the LLM evaluator or eval_command fails on the initial implementation, report the error and stop — the evaluation setup is misconfigured.
- **Multiple consecutive candidates rejected**: If 3+ consecutive candidates are discarded (test failures or evaluator failures), report "Multiple consecutive candidates failed — mutations may be too aggressive or the test suite is brittle." Continue to next iteration with existing population.
- **Database corrupted**: Back up the corrupted `database.json`, delete it, and start fresh.

## Resuming

When the user chooses "Resume" in Step 1:
- Skip seeding (Step 3).
- **Ask the user**: "Run N more iterations on top of existing progress, or complete up to iteration N total?"
  - **N more**: the loop runs from `lastIteration + 1` to `lastIteration + N`.
  - **Up to N total**: the loop runs from `lastIteration + 1` to `N`. If `lastIteration >= N`, report "Already at or past iteration N" and stop.
- Report current best before continuing.
