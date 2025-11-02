# myers-core-diff

[![NPM Version](https://img.shields.io/npm/v/@fishan/myers-core-diff.svg?style=flat)](https://www.npmjs.com/package/@fishan/myers-core-diff)
[![Build Status](https://img.shields.io/github/actions/workflow/status/fishan/myers-core-diff/ci.yml?branch=main)](https://github.com/fishan/myers-core-diff/actions)
[![License](https://img.shields.io/npm/l/@fishan/myers-core-diff.svg)](./LICENSE)

**A high-performance core diff engine based on Myers' algorithm, designed as an extensible "Toolbox" that can be enhanced with pluggable strategies.**

This core is the foundation for tools like `cdiff` but can be used for any task requiring fast and accurate sequence comparison (lines, tokens, DNA, etc.).

## Key Features

* **High Performance**: Natively operates on `Uint32Array` (integers) instead of strings for CPU-native comparisons.
* **Extensible**: Provides a "Toolbox" API, allowing developers to create custom diff strategies by combining low-level primitives.
* **Built-in Strategies**: Includes `commonSES` (default), `patienceDiff`, and `preserveStructure` as ready-to-use examples.
* **Advanced Optimizations**: Features L1 (global), L2 (positional), and L3 (micro) anchors to accelerate diffing on large and complex datasets.

---

## Real-World Implementation

This engine is the battle-tested core of the **[@fishan/cdiff](https://github.com/fishan/cdiff)** tool.

* **GitHub:** [https://github.com/fishan/cdiff](https://github.com/fishan/cdiff)
* **NPM:** [`@fishan/cdiff`](https://www.npmjs.com/package/@fishan/cdiff)

While `cdiff` is a powerful comparison tool, its primary strength is as an advanced **patching system** built on this core.

`cdiff` leverages the engine's precision to create highly optimized, **invertible patches**. Thanks to this architecture, `cdiff` consistently creates the **smallest patches** among its competitors (see Benchmarks below).

It provides an advanced feature set impossible without a reliable core:
* **Built-in Compression** for further reducing patch size.
* **"Ultra-thin" Patches**: Generation of patches without restoration data for one-way updates.
* **Invertible Patches**: Full support for reversing patches to restore the original content.
* **Built-in Validation** to ensure patch integrity.

The speed, precision, and flexibility of `cdiff` are a direct result of the `@fishan/myers-core-diff` engine design.

---

## The Power of Tokenization

This engine does **not** operate on strings. It operates on **integers**.

Before calling `.diff()`, the engine first "tokenizes" your input arrays of strings (`string[]`) into arrays of integers (`Uint32Array`). Each unique string gets a unique integer ID.

This is the core of its high performance:

1.  **CPU-Native Comparison:** Comparing two strings (`"hello" === "world"`) is slow. It requires byte-by-byte checking. Comparing two 32-bit integers (`12345 === 12346`) is one of the fastest operations a CPU can perform.
2.  **Algorithm Efficiency:** The Myers O(ND) algorithm relies on massive amounts of comparisons inside its core loop. Using integers makes this loop orders of magnitude faster than a string-based implementation.
3.  **Flexibility:** Because the engine only sees integers, *you* get to define what a "token" is before you pass it in. A token can be:
    * A line of text (for `cdiff`).
    * A word (for prose diffing).
    * A character (for micro-diffing).
    * A Git commit hash, a filename, or any other unique string identifier.

The engine simply finds the shortest edit script to turn one sequence of *integers* into another.

---

## Installation

```bash
npm install @fishan/myers-core-diff
````

## Basic Usage

The engine operates on arrays of strings (tokens).

```typescript
import { MyersCoreDiff, DiffOperation } from '@fishan/myers-core-diff';

// 1. Initialize the engine
// The engine automatically registers 'commonSES' by default
const differ = new MyersCoreDiff();

const oldTokens = ["a", "b", "c", "d", "e"];
const newTokens = ["a", "X", "c", "d", "Y", "e"];

// 2. Calculate the diff
const result = differ.diff(oldTokens, newTokens);

// 3. The result
console.log(result);
/*
[
  [ 0, 'a' ], // EQUAL
  [ -1, 'b' ], // REMOVE
  [ 1, 'X' ], // ADD
  [ 0, 'c' ], // EQUAL
  [ 0, 'd' ], // EQUAL
  [ 1, 'Y' ], // ADD
  [ 0, 'e' ]  // EQUAL
]
*/
```

-----

## Plugin System (Strategies)

This is the most powerful feature. You can completely change the diff logic without changing the core engine.

### Using a Built-in Plugin

The core ships with two powerful strategies besides `commonSES`: `patienceDiff` and `preserveStructure`. They must be registered before use.

#### `patienceDiff`

Excellent for code, as it focuses on unique lines that haven't changed and ignores "noise" (e.g., shifted blocks).

```typescript
import { MyersCoreDiff, registerPatienceDiffStrategy } from '@fishan/myers-core-diff';

// 1. Register the plugin
registerPatienceDiffStrategy(MyersCoreDiff);

// 2. Initialize the engine
const differ = new MyersCoreDiff();

// 3. Call diff, specifying the strategy
const options = { diffStrategyName: 'patienceDiff' };
const result = differ.diff(oldCode, newCode, false, options);
```

#### `preserveStructure`

A hybrid strategy that attempts to maintain positional stability (L2 anchors) but uses floating L1 and L3 anchors to find matches within modified blocks.

```typescript
import { MyersCoreDiff, registerPreserveStructureStrategy } from '@fishan/myers-core-diff';

// 1. Register the plugin
registerPreserveStructureStrategy(MyersCoreDiff);

// 2. Initialize
const differ = new MyersCoreDiff();

// 3. Call
const options = { diffStrategyName: 'preserveStructure' };
const result = differ.diff(oldText, newText, false, options);
```

-----

## Developer Guide: The Toolbox API

When you build a plugin, you receive the `engine` instance. This is your "Toolbox". It provides direct, low-level access to the core's optimized functions. This allows you to mix-and-match core logic to create new, powerful strategies.

All Toolbox methods (like `_recursiveDiff`, `_findAnchors`) operate on tokenized `Uint32Array` inputs for maximum performance.

### 1\. `engine._recursiveDiff(...)`

  * **What it is:** The main, classic Myers' O(ND) algorithm, implemented with the "middle snake" optimization.
  * **Principle:** This function is guaranteed to find the **Shortest Edit Script (SES)**. It works by finding a "middle snake" (a common subsequence) near the center of the diff region, which divides the problem (A vs B) into two smaller, independent problems (A-prefix vs B-prefix and A-suffix vs B-suffix). It then calls itself recursively on these smaller problems.
  * **When to use it:** This is your precision tool. Use it for small-to-medium sized "gaps" between anchors (e.g., `N+M < hugeDiffThreshold`).
  * **Advantages:** 100% accurate (finds the shortest possible list of edits).
  * **Disadvantages:** Can be computationally expensive. Its performance is `O(ND)`, where `D` is the number of differences. In worst-case scenarios (low similarity), `D` approaches `N`, and performance degrades to `O(N^2)`.
  * **Example:** The default `commonSES` strategy is essentially a direct wrapper around this one method, with a fallback to `_guidedCalculateDiff` for very large gaps.

### 2\. `engine._findAnchors(...)`

  * **What it is:** The L1 Anchor generation system. This is the key to high performance on large files.
  * **Principle:** This function scans both sequences to find large, high-confidence common subsequences ("anchors"). It uses a rolling hash (`huntChunkSize`) and confidence scoring (`minAnchorConfidence`) to identify these blocks *without* running a full `O(ND)` diff.
  * **When to use it:** Call this **first** in any custom plugin. It breaks a single, massive diff problem (e.g., 10,000 lines vs. 10,000 lines) into several small, independent diff problems (the "gaps" *between* the anchors).
  * **Advantages:** Drastically improves performance from `O(N^2)` to something closer to `O(N)` in common cases by allowing you to skip diffing large, identical blocks.
  * **Example:** Both `patienceDiff` and `preserveStructure` use this method immediately to find stable blocks. They then iterate over the `gaps` between the returned anchors and apply `_recursiveDiff` only to those small regions.

### 3\. `engine._guidedCalculateDiff(...)`

  * **What it is:** A heuristic-based, linear-time `O(N)` diff algorithm. It is **not** a Myers' algorithm.
  * **Principle:** This is a "corridor" scan. It's a greedy algorithm that scans forward, trying to find small matches within a narrow `lookahead` window. It is **not** guaranteed to find the SES. It is designed for speed, not accuracy.
  * **When to use it:** Use this for "chaotic" or very low-similarity gaps where `N+M > hugeDiffThreshold`. In such cases, finding a precise SES is computationally infeasible, and a "good enough" linear-time result is preferable to crashing or freezing.
  * **Advantages:** Extremely fast, `O(N)`. Prevents catastrophic performance degradation on worst-case inputs.
  * **Disadvantages:** Fails badly on moved or swapped blocks. It's designed for massive, contiguous additions, deletions, or replacements.
  * **Example:** The default `commonSES` strategy *falls back* to this method if it encounters a gap that is too large for `_recursiveDiff`.

### 4\. `engine._createDeletions(...)` / `engine._createAdditions(...)`

  * **What it is:** Simple utility functions for "flushing" tokens.
  * **Principle:** They iterate over a token range (`start` to `end`) and create a `DiffResult` array, marking every single token as `DiffOperation.REMOVE` or `DiffOperation.ADD`.
  * **When to use it:** Use these to "flush" remaining tokens at the beginning or end of your logic. For example, if your plugin processes all anchors and gaps, and you are left with a final un-matched range at the end of the old file, you would pass it to `_createDeletions`.
  * **Example:**
    ```typescript
    // We've processed everything else, now just delete the rest
    const remainingDeletions = engine._createDeletions(oldTokens, lastOldPos, oldEnd, idToString);
    results.push(...remainingDeletions);
    ```

-----

## Core API (`MyersCoreDiff`)

### `new MyersCoreDiff()`
Creates a new diff engine instance.

### `differ.diff(oldTokens, newTokens, debug?, options?)`
The main method.

* `oldTokens: string[]`: Array of "old" tokens.
* `newTokens: string[]`: Array of "new" tokens.
* `debug?: boolean`: (default `false`) Enables verbose logging to the console.
* `options?: DiffOptions`: Configuration object.

**Example of using options:**

You can control the diff engine's behavior by passing the `options` object.

```typescript
import { MyersCoreDiff, registerPatienceDiffStrategy, type DiffOptions } from '@fishan/myers-core-diff';

// Register a strategy to use it by name
registerPatienceDiffStrategy(MyersCoreDiff);
const differ = new MyersCoreDiff();

// 1. Define your options
const options: DiffOptions = {
  // Use the 'patienceDiff' plugin
  diffStrategyName: 'patienceDiff',
  
  // Ignore small matches, look for bigger blocks
  minMatchLength: 10, 
  
  // Don't use the heuristic fallback
  hugeDiffThreshold: 100000,
  
  // Don't use global anchors
  useAnchors: false 
};

// 2. Pass them to the diff method
const result = differ.diff(oldCode, newCode, false, options);

### `MyersCoreDiff.registerStrategy(name, strategyFn)`

Static method to register a new plugin strategy.

-----

## Options (`DiffOptions`)

You can pass these options into the `diff()` method:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `diffStrategyName` | `string` | `'commonSES'` | **(v6.0)** The name of the strategy plugin to use. |
| `minMatchLength` | `number` | `30` | Minimum token length for an L1 anchor. |
| `quickDiffThreshold` | `number` | `64` | N+M threshold below which to use quick O(ND) diff. |
| `hugeDiffThreshold` | `number` | `256` | N+M gap threshold above which to use `_guidedCalculateDiff`. |
| `lookahead` | `number` | `10` | (For `_guidedCalculateDiff`) How far to look ahead. |
| `corridorWidth` | `number` | `10` | (For `_guidedCalculateDiff`) Width of the search "corridor". |
| `skipTrimming` | `boolean` | `false` | Skip trimming common prefixes/suffixes. |
| `jumpStep` | `number` | `30` | (For `_findAnchors`) Scan step when searching for anchors. |
| `huntChunkSize` | `number` | `10` | (For `_findAnchors`) Chunk size for hashing. |
| `minAnchorConfidence` | `number` | `0.8` | (For `_findAnchors`) Minimum anchor confidence (0.0 - 1.0). |
| `useAnchors` | `boolean` | `true` | Whether to use L1 anchors (global search). |
| `localLookahead` | `number` | `50` | (For `preserveStructure`) How far to search for L2 (positional) anchors. |
| `anchorSearchMode` | `'floating'` | `'positional'` | `'combo'` | `'combo'` | L1 anchor search mode. |
| `positionalAnchorMaxDrift` | `number` | `20` | (For `positional` mode) Max drift for an L1 positional anchor. |

-----

## Test Suite

The engine is validated by a comprehensive suite of 126 tests, designed to ensure correctness, reliability, and performance from the lowest-level primitives to the high-level strategy plugins.

The test methodology is built on three pillars:

White-Box (Direct) Tests: These tests directly invoke internal, non-public methods of the "Toolbox" (like _findMiddleSnake and _guidedCalculateDiff). This ensures that the core building blocks are numerically stable, correct, and handle edge cases (e.g., odd/even deltas, changes at the very beginning/end) as expected, independent of the high-level API.

Black-Box (Unit) Tests: These tests call the public diff() method and compare its output exactly against a known, pre-defined "snapshot" of the expected DiffResult array. This is used to verify simple, predictable scenarios (simple additions, deletions, replacements) and guarantee that the diff output itself is correct.

Black-Box (Functional) Tests: This is the most critical test category. These tests do not inspect the DiffResult. Instead, they apply the generated diff as a patch to the "old" content and assert that the result is an exact, byte-for-byte match of the "new" content. This verifies real-world correctness and ensures that the diff is "round-trip" safe, even for complex scenarios like block moves, binary data, and complete rewrites.

This entire test battery (Unit and Functional) is run separately for the default strategy (commonSES) and for each built-in plugin (patienceDiff, preserveStructure) to guarantee that all provided strategies are production-ready.

\<details\>\<summary\>\<b\>View Test Results (126 passing)\</b\>\</summary\>

```bash
  Direct Test: _findMiddleSnake
    ✔ should find a snake with odd delta (N > M)
    ✔ should find a snake with even delta (N > M)
    ✔ should find a snake when change is at the beginning
    ✔ should find a snake when change is at the end
    ✔ should find a snake in a large, complete replacement scenario

  Direct Test: _guidedCalculateDiff
    ✔ should handle huge additions
    ✔ should handle huge deletions
    ✔ should handle a chaotic mix of small changes in a large string
    ✔ should handle low-similarity content
    ✔ should handle repetitive patterns
    ✔ should fail on swapped blocks
    ✔ should fail on an interleaved sequence
    ✔ should fail when a block is moved to the end
    ✔ should fail with two completely different, complex strings

  Direct Test: calculateDiff
    ✔ should handle simple insertion
    ✔ should handle simple deletion
    ✔ should handle simple substitution
    ✔ should handle empty old string
    ✔ should handle empty new string
    ✔ should handle identical strings
    ✔ should handle reversed string
    ✔ should handle overlapping changes
    ✔ should handle changes at the start and end
    ✔ should handle unicode characters
    ✔ should handle multiple edits
    ✔ should handle long common subsequence with small changes
    ✔ should handle one string being a substring of another
    ✔ should handle highly repetitive content
    ✔ should handle strings with only whitespace and newlines
    ✔ should handle a move-like operation

  Direct Test: MyersCoreDiff.diff on Complex Scenarios
    ✔ should correctly handle a simple block swap
    ✔ should correctly handle a complete replacement
    ✔ should correctly handle a block move operation

  Direct Test: _findMiddleSnake
    ✔ should find a snake in a large, complete replacement scenario

  Direct Test: _guidedCalculateDiff
    ✔ should handle huge additions
    ✔ should handle huge deletions
    ✔ should handle a chaotic mix of small changes in a large string

  Direct Test: calculateDiff
    ✔ should handle simple insertion
    ✔ should handle simple deletion
    ✔ should handle simple substitution
    ✔ should handle empty old string
    ✔ should handle empty new string
    ✔ should handle identical strings
    ✔ should handle reversed string

  MyersDiff Functional Tests (Patch Correctness)
    ✔ should handle simple addition
    ✔ should handle simple deletion
    ✔ should handle simple replacement
    ✔ should handle whitespace-only line replacement
    ✔ should handle move (complex change)
    ✔ should handle multiple non-contiguous modifications
    ✔ should handle changes involving only whitespace
    ✔ should handle complete rewrite
    ✔ should handle deletion of all content
    ✔ should handle creation from empty
    ✔ should handle changes with unicode characters
    ✔ should return no changes for identical inputs
    ✔ should handle addition at the beginning
    ✔ should handle deletion from the end
    ✔ should handle a moved block of tokens
    ✔ should handle changes in repeating patterns
    ✔ should handle multiple partial replacements
    ✔ should handle binary-like data stress test
    ✔ should handle changes with long common prefix/suffix (trimmer test)
    ✔ should handle interleaved changes
    ✔ should handle large block deletion from the middle

  MyersDiff Unit Tests (Exact Match)
    ✔ should handle simple addition
    ✔ should handle simple deletion
    ✔ should handle simple replacement
    ✔ should handle whitespace-only line replacement
    ✔ should handle move (complex change)
    ✔ should handle multiple non-contiguous modifications
    ✔ should handle changes involving only whitespace
    ✔ should handle complete rewrite
    ✔ should handle deletion of all content
    ✔ should handle creation from empty
    ✔ should handle changes with unicode characters
    ✔ should return no changes for identical inputs
    ✔ should handle addition at the beginning
    ✔ should handle deletion from the end
    ✔ should handle changes in repeating patterns
    ✔ should correctly handle changes with common prefix/suffix (trimmer test)
    ✔ should handle interleaved changes
    ✔ should handle large block deletion from the middle

  MyersDiff: Direct _findMiddleSnake Invocation Tests
    ✔ should find a snake in the "Swapped Blocks" scenario that was failing
    ✔ should find a snake in the "Complete Replacement" scenario that was failing

  MyersDiff: Direct _findMiddleSnake Invocation Tests
    ✔ should find the middle snake in a complex replacement scenario

  MyersDiff: Middle Snake Stress Tests
    ✔ should correctly handle a large block replacement in the middle
    ✔ should correctly handle moving a large block of tokens
    Words: 345, Hits: 21, Misses: 298, Confidence: 0.07, Anchors: 0
    ✔ should correctly handle multiple small interleaved changes in a large file
    ✔ should handle a complete rewrite of one large file to another
    ✔ should handle deleting large blocks from multiple locations

  MyersDiff Functional Tests (Patch Correctness) - Strategy: patienceDiff
    ✔ should handle simple addition
    ✔ should handle simple deletion
    ✔ should handle simple replacement
    ✔ should handle move (complex change) - expecting correct reconstruction
    ✔ should handle a moved block of tokens (Block Move test case)
    ✔ should handle multiple non-contiguous modifications
    ✔ should handle changes involving only whitespace (indentation)
    ✔ should handle complete rewrite
    ✔ should handle deletion of all content
    ✔ should handle creation from empty
    ✔ should handle identical inputs

  MyersDiff Unit Tests (Exact Match) - Strategy: patienceDiff
    ✔ should handle simple addition (unit)
    ✔ should handle simple deletion (unit)
    ✔ should handle simple replacement (unit)
    ✔ should handle a simple block move (unit)
    ✔ should ignore surrounding noise and find LIS (unit)

  MyersDiff Functional Tests (Patch correctness) - Strategy: preserveStructure
    ✔ should handle simple addition
    Values: - (0) vs + (1)
    ✔ should handle simple deletion
    Values: - (1) vs + (0)
    ✔ should handle simple replacement
    Values: - (1) vs + (1)
    ✔ should handle whitespace-only line replacement
    Values: - (1) vs + (1)
    ✔ should handle move (complex change) - expecting correct reconstruction
    Values: - (20) vs + (20)
    ✔ should handle multiple non-contiguous modifications
    Values: - (5) vs + (5)
    ✔ should handle changes involving only whitespace (indentation)
    Values: - (1) vs + (1)
    ✔ should handle complete rewrite
    Values: - (121) vs + (121)
    ✔ should handle deletion of all content
    Values: - (121) vs + (0)
    ✔ should handle creation from empty
    Values: - (0) vs + (121)
    ✔ should handle changes with unicode characters
    Values: - (4) vs + (4)
    ✔ should return no changes for identical inputs
    Values: - (0) vs + (0)
    ✔ should prioritize local change over larger replacement
    Values: - (2) vs + (2)
    ✔ should handle a moved block of tokens (Block Move test case)
    Values: - (6) vs + (6)

  MyersDiff Unit Tests (Exact Match) - Strategy: preserveStructure
    ✔ should handle simple addition (unit)
    ✔ should handle simple deletion (unit)
    ✔ should handle simple replacement (unit)
    ✔ should handle indentation change (unit - expecting line replace)
    ✔ should prioritize local change over larger replacement (unit)


  126 passing (275ms)
```

\</details\>

-----

## License

MIT © Aleks Fishan

\<details\>
\<summary\>View License Text\</summary\>

```
MIT License

Copyright (c) 2025 Aleks Fishan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOTT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

\</details\>
