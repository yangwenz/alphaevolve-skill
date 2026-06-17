# Context Extraction

This document describes how to extract context information for a target method or class within a source file. The extracted context is stored as a markdown file in the output folder so the optimization loop can load it directly without re-extracting.

## When to Use

Run this step once per optimization target before starting the evolution loop. Skip if a context file already exists at `evolve-output/context/<filename>_<target_name>.md`.

## Inputs

- **File path**: The source file containing the target method or class.
- **Target name**: The name of the method, function, or class to extract context for.
- **Target disambiguator** (optional): A line number or partial signature to identify the exact overload when multiple methods share the same name. Examples: `line:42`, `(int, str) -> bool`, `(self, request: HttpRequest)`.
- **Output directory**: Defaults to `evolve-output/context/` relative to the project root.

## Extraction Steps

### 1. Read the source file

Read the entire source file at the given path. Identify the language from the file extension.

### 2. Locate the target

Find the method, function, or class named by the target name. If multiple definitions share the same name (overloading), use the disambiguator to select the correct one:
- If a **line number** is provided (e.g., `line:42`), use the definition that contains or starts at that line.
- If a **signature fragment** is provided (e.g., `(int, str) -> bool`), match the overload whose parameter types or return type correspond.
- If no disambiguator is provided and multiple matches exist, report the ambiguity with the line numbers and signatures of all candidates, then stop.

If the target does not exist in the file, report an error and stop.

### 3. Extract imports

Identify all import/require/include/use statements at the top of the file that the target depends on. Include:
- Direct imports used inside the target body
- Transitive imports (e.g., a type imported for a parameter that the target accepts)

List each import as it appears in the source (preserve the original syntax).

### 4. Determine the goal

Write a concise 1-2 sentence description of what the target method/class does — its purpose, inputs, outputs, and key behavior. Focus on the "what" and "why", not implementation details.

### 5. Extract dependency signatures

Find all other functions, methods, or classes that the target calls or references. For each dependency:
- **Name**: The function/method/class name.
- **Signature**: The full signature including parameters and return type (if the language provides types). If no type annotations exist, infer parameter names and describe the shape.
- **Location**: Where this dependency is defined — "same file", a module path, or "built-in/standard library".

Only include dependencies that the target directly uses. Do not include unrelated code from the file.

### 6. Write the context file

Save the extracted context as a markdown file at:

```
<output_directory>/<filename_without_ext>_<target_name>.md
```

Use the following markdown format for the output file:

---

# Context: <target_name>

**File**: `<file_path>`
**Language**: <language>
**Signature**: `<full signature of the target>`
**Lines**: <start_line>-<end_line>

## Goal

<1-2 sentence description of what the target does>

## Imports

```<language>
<each import statement, one per line>
```

## Dependencies

### <dependency_name>

- **Signature**: `<full signature>`
- **Location**: <where it's defined>

### <dependency_name>

- **Signature**: `<full signature>`
- **Location**: <where it's defined>

(repeat for each dependency)

---
