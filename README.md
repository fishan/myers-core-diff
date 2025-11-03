

# myers-core-diff


[![NPM Version](https://img.shields.io/npm/v/@fishan/myers-core-diff.svg?style=flat)](https://www.npmjs.com/package/@fishan/myers-core-diff)
[![Build Status](https://img.shields.io/github/actions/workflow/status/fishan/myers-core-diff/ci.yml?branch=main)](https://github.com/fishan/myers-core-diff/actions)
[![License](https://img.shields.io/npm/l/@fishan/myers-core-diff.svg)](./LICENSE)

**A high-performance core diff engine based on Myers' algorithm, designed as an extensible "Toolbox" that can be enhanced with pluggable strategies.**

This core is the foundation for tools like `cdiff` but can be used for any task requiring fast and accurate sequence comparison (lines, tokens, DNA, etc.).

---

## Table of Contents

- [Key Features](#key-features)
- [Real-World Implementation](#real-world-implementation)
- [The Power of Tokenization](#the-power-of-tokenization)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Plugin System (Strategies)](#plugin-system--strategies)
  - [`patienceDiff`](#patiencediff)
  - [`preserveStructure`](#preservestructure)
- [Developer Guide: The Toolbox API](#developer-guide-the-toolbox-api)
  - [`engine._recursiveDiff(...)`](#1-enginerecursivediff)
  - [`engine._findAnchors(...)`](#2-enginefindanchors)
  - [`engine._guidedCalculateDiff(...)`](#3-engineguidedcalculatediff)
  - [`engine._createDeletions(...)` / `engine._createAdditions(...)`](#4-enginecreatedeletions--enginecreateadditions)
- [Core API (`MyersCoreDiff`)](#core-api--myerscorediff)
- [Options (`DiffOptions`)](#options--diffoptions)
- [Test Suite](#test-suite)
- [License](#license)

---

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

## Benchmarks

The following benchmarks demonstrate the performance of the **`cdiff`** tool, which uses `@fishan/myers-core-diff` as its engine.

The key metric is **Patch Size (B)**, where `cdiff` consistently produces the smallest patches (🥇) across a wide range of scenarios. This is a direct result of the core engine's precision, its advanced tokenization, and its character-level diffing capabilities, which libraries like `jsdiff (unified)` lack.

While other tools may be faster in `Total (ms)` in some isolated cases (by generating larger, less precise patches), `cdiff` and this core are optimized for **patch size** and **correctness**, especially in complex scenarios involving whitespace, block moves, and low-entropy data.

<details>
<summary><b>View All Benchmark Tables</b></summary>

--- Standard Benchmarks ---

**=== Realistic change in small (package (source code)on) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 50 | '10.48' | '5.32' | '15.81' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 259 | '2.65' | '2.52' | '5.17' | '✅ OK' |
| 2 | 'diff-match-patch' | 62 | '3.70' | '0.88' | '4.58 🥇' | '✅ OK' |

**=== Realistic change in medium (source code) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 26 | '1.31' | '0.30' | '1.61' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 401 | '1.15' | '1.58' | '2.72' | '✅ OK' |
| 2 | 'diff-match-patch' | 54 | '1.05' | '0.08' | '1.13 🥇' | '✅ OK' |

**=== Realistic change in large (source code) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 41 | '28.86' | '3.86' | '32.73' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 197 | '19.33' | '5.39' | '24.71' | '✅ OK' |
| 2 | 'diff-match-patch' | 59 | '1.09' | '0.54' | '1.63 🥇' | '✅ OK' |

--- Advanced Scenarios ---

**=== Multiple Small Changes (large file) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 855 | '98.58' | '5.21' | '103.78' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 16942 | '18.59' | '3.54' | '22.13 🥇' | '✅ OK' |
| 2 | 'diff-match-patch' | 3473 | '93.10' | '16.75' | '109.84' | '✅ OK' |

**=== Block Move (structural shift in large.js) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 1830 | '38.25' | '5.08' | '43.33' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 2938 | '16.78' | '3.18' | '19.95' | '✅ OK' |
| 2 | 'diff-match-patch' | 3229 | '3.02' | '1.24' | '4.26 🥇' | '✅ OK' |

**=== Whitespace Change (indentation in medium.js) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 989 | '36.07' | '4.40' | '40.47' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 10834 | '21.00' | '0.52' | '21.52 🥇' | '✅ OK' |
| 2 | 'diff-match-patch' | 7500 | '88.11' | '0.40' | '88.51' | '✅ OK' |

--- Inversion Benchmarks (Refactoring Scenario) ---

**=== Invert Patch from Refactoring ===**
| (index) | Library | Invert+Apply (ms) | Correctness |
| :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | '6.97' | '✅ OK' |
| 1 | 'jsdiff (unified)' | '17.11' | '✅ OK' |
| 2 | 'diff-match-patch' | '82.50' | '✅ OK' |

--- Core Strength Benchmarks ---

**=== Huge File (50k lines) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 281 | '199.66' | '27.13' | '226.79' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 2222 | '85.99' | '17.42' | '103.41' | '✅ OK' |
| 2 | 'diff-match-patch' | 470 | '39.52' | '14.76' | '54.28 🥇' | '✅ OK' |

**=== Binary Data (1KB) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 57 | '0.74' | '0.73' | '1.47' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 1672 | '0.16' | '0.31' | '0.47' | '✅ OK' |
| 2 | 'diff-match-patch' | 296 | '0.12' | '0.05' | '0.18 🥇' | '✅ OK' |

**=== "Dirty" Data (Large common prefix/suffix) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 47 | '0.89' | '0.29' | '1.18' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 100206 | '0.56' | '0.28' | '0.84' | '✅ OK' |
| 2 | 'diff-match-patch' | 58 | '0.26' | '0.04' | '0.30 🥇' | '✅ OK' |

--- Edge Case & Stress Test Scenarios ---

**=== Low Entropy (Repeating Data) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 105 | '20.73' | '4.55' | '25.28' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 1972 | '13.08' | '4.02' | '17.10 🥇' | '✅ OK' |
| 2 | 'diff-match-patch' | 330 | '108.60' | '2.95' | '111.55' | '✅ OK' |

**=== Single Line Changes (Minified JS) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 474 | '325.23' | '11.38' | '336.61' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 336055 | '1.15' | '0.50' | '1.65 🥇' | '✅ OK' |
| 2 | 'diff-match-patch' | 3331 | '61.17' | '7.86' | '69.03' | '✅ OK' |

**=== Complete Replacement (Low Similarity) ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 299375 | '1401.53' | '26.18' | '1427.72' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 301830 | '199.55' | '10.76' | '210.31 🥇' | '✅ OK' |
| 2 | 'diff-match-patch' | 379704 | '1009.81' | '0.36' | '1010.18' | '✅ OK' |

**=== Complete Replacement Invert (Low Similarity) ===**
| (index) | Library | Invert+Apply (ms) | Correctness |
| :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | '28.63' | '✅ OK' |
| 1 | 'jsdiff (unified)' | '969.17' | '✅ OK' |
| 2 | 'diff-match-patch' | '1001.04' | '✅ OK' |

**=== Swapped Blocks ===**
| (index) | Library | Patch Size (B) | Create (ms) | Apply (ms) | Total (ms) | Correctness |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'cdiff 🥇' | 4487 | '24.17' | '5.90' | '30.07' | '✅ OK' |
| 1 | 'jsdiff (unified)' | 6346 | '17.99' | '3.08' | '21.07 🥇' | '✅ OK' |
| 2 | 'diff-match-patch' | 7552 | '260.23' | '3.34' | '263.57' | '✅ OK' |

</details>

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
```

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

---

## Plugin System (Strategies)

This is the most powerful feature. You can completely change the diff logic without changing the core engine.

### Using a Built-in Plugin

The core ships with two powerful strategies besides `commonSES`: `patienceDiff` and `preserveStructure`. They must be registered before use.

### `patienceDiff`

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

### `preserveStructure`

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

---

## Developer Guide: The Toolbox API

When you build a plugin, you receive the `engine` instance. This is your "Toolbox". It provides direct, low-level access to the core's optimized functions. This allows you to mix-and-match core logic to create new, powerful strategies.

All Toolbox methods (like `_recursiveDiff`, `_findAnchors`) operate on tokenized `Uint32Array` inputs for maximum performance.

### 1. `engine._recursiveDiff(...)`

* **What it is:** The main, classic Myers' O(ND) algorithm, implemented with the "middle snake" optimization.
* **Principle:** This function is guaranteed to find the **Shortest Edit Script (SES)**. It works by finding a "middle snake" (a common subsequence) near the center of the diff region, which divides the problem (A vs B) into two smaller, independent problems (A-prefix vs B-prefix and A-suffix vs B-suffix). It then calls itself recursively on these smaller problems.
* **When to use it:** This is your precision tool. Use it for small-to-medium sized "gaps" between anchors (e.g., `N+M < hugeDiffThreshold`).
* **Advantages:** 100% accurate (finds the shortest possible list of edits).
* **Disadvantages:** Can be computationally expensive. Its performance is `O(ND)`, where `D` is the number of differences. In worst-case scenarios (low similarity), `D` approaches `N`, and performance degrades to `O(N^2)`.

### 2. `engine._findAnchors(...)`

* **What it is:** The L1 Anchor generation system. This is the key to high performance on large files.
* **Principle:** This function scans both sequences to find large, high-confidence common subsequences ("anchors"). It uses a rolling hash (`huntChunkSize`) and confidence scoring (`minAnchorConfidence`) to identify these blocks *without* running a full `O(ND)` diff.
* **When to use it:** Call this **first** in any custom plugin. It breaks a single, massive diff problem (e.g., 10,000 lines vs. 10,000 lines) into several small, independent diff problems (the "gaps" *between* the anchors).
* **Advantages:** Drastically improves performance from `O(N^2)` to something closer to `O(N)` in common cases by allowing you to skip diffing large, identical blocks.

### 3. `engine._guidedCalculateDiff(...)`

* **What it is:** A heuristic-based, linear-time `O(N)` diff algorithm. It is **not** a Myers' algorithm.
* **Principle:** This is a "corridor" scan. It's a greedy algorithm that scans forward, trying to find small matches within a narrow `lookahead` window. It is **not** guaranteed to find the SES. It is designed for speed, not accuracy.
* **When to use it:** Use this for "chaotic" or very low-similarity gaps where `N+M > hugeDiffThreshold`. In such cases, finding a precise SES is computationally infeasible, and a "good enough" linear-time result is preferable to crashing or freezing.
* **Advantages:** Extremely fast, `O(N)`. Prevents catastrophic performance degradation on worst-case inputs.
* **Disadvantages:** Fails badly on moved or swapped blocks. It's designed for massive, contiguous additions, deletions, or replacements.

### 4. `engine._createDeletions(...)` / `engine._createAdditions(...)`

* **What it is:** Simple utility functions for "flushing" tokens.
* **Principle:** They iterate over a token range (`start` to `end`) and create a `DiffResult` array, marking every single token as `DiffOperation.REMOVE` or `DiffOperation.ADD`.
* **When to use it:** Use these to "flush" remaining tokens at the beginning or end of your logic. For example, if your plugin processes all anchors and gaps, and you are left with a final un-matched range at the end of the old file, you would pass it to `_createDeletions`.

---

## Core API (`MyersCoreDiff`)

### `new MyersCoreDiff()`
Creates a new diff engine instance.

### `differ.diff(oldTokens, newTokens, debug?, options?)`
The main method.

* `oldTokens: string[]`: Array of "old" tokens.
* `newTokens: string[]`: Array of "new" tokens.
* `debug?: boolean`: (default `false`) Enables verbose logging to the console.
* `options?: DiffOptions`: Configuration object.

**Example:**

```typescript
import { MyersCoreDiff, registerPatienceDiffStrategy, type DiffOptions } from '@fishan/myers-core-diff';

registerPatienceDiffStrategy(MyersCoreDiff);
const differ = new MyersCoreDiff();

const options: DiffOptions = {
  diffStrategyName: 'patienceDiff',
  minMatchLength: 10,
  hugeDiffThreshold: 100000,
  useAnchors: false
};

const result = differ.diff(oldCode, newCode, false, options);
```

### `MyersCoreDiff.registerStrategy(name, strategyFn)`

Static method to register a new plugin strategy.

---

## Options (`DiffOptions`)

You can pass these options into the `diff()` method:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `diffStrategyName` | `string` | `'commonSES'` | The name of the strategy plugin to use. |
| `minMatchLength` | `number` | `30` | Minimum token length for an L1 anchor. |
| `quickDiffThreshold` | `number` | `64` | N+M threshold below which to use quick O(ND) diff. |
| `hugeDiffThreshold` | `number` | `256` | N+M gap threshold above which to use `_guidedCalculateDiff`. |
| `lookahead` | `number` | `10` | (For `_guidedCalculateDiff`) How far to look ahead. |
| `corridorWidth` | `number` | `10` | (For `_guidedCalculateDiff`) Width of the search "corridor". |
| `skipTrimming` | `boolean` | `false` | Skip trimming common prefixes/suffixes. |
| `jumpStep` | `number` | `30` | (For `_findAnchors`) Scan step when searching for anchors. |
| `huntChunkSize` | `number` | `10` | (For `_findAnchors`) Chunk size for hashing. |
| `minAnchorConfidence` | `number` | `0.8` | (For `_findAnchors`) Minimum anchor confidence (0.0–1.0). |
| `useAnchors` | `boolean` | `true` | Whether to use L1 anchors (global search). |
| `localLookahead` | `number` | `50` | (For `preserveStructure`) How far to search for L2 (positional) anchors. |
| `anchorSearchMode` | `'floating' \| 'positional' \| 'combo'` | `'combo'` | L1 anchor search mode. |
| `positionalAnchorMaxDrift` | `number` | `20` | (For `positional` mode) Max drift for an L1 positional anchor. |

---

## Test Suite

The engine is validated by a comprehensive suite of **126 tests**, designed to ensure correctness, reliability, and performance—from the lowest-level primitives to the high-level strategy plugins.

### How to Run Tests

This project uses `mocha` and `ts-node` for testing.

#### 1. Development Tests (Fast)

This command runs tests directly against the un-compiled `src/` files using `ts-node`. It is ideal for rapid development and debugging, as it does not require a build step.

```bash
npm run test:dev
```

2. Production Build Tests (Verification)
This command first builds the entire project, creating a minified, production-ready bundle in dist/. It then runs the test suite against that minified bundle. This is the official verification step to ensure the build process or minification did not break any functionality.

```bash
npm test
# (or npm run test:prod)
```

The test methodology is built on three pillars:

- **White-Box (Direct) Tests**: Validate internal primitives like `_findMiddleSnake`.
- **Black-Box (Unit) Tests**: Assert exact diff output matches expected snapshots.
- **Black-Box (Functional) Tests**: Apply the diff as a patch and verify the result matches the expected new content byte-for-byte.

All tests are run for each built-in strategy (`commonSES`, `patienceDiff`, `preserveStructure`) to guarantee production readiness.

<details>
<summary><b>View Test Results (126 passing)</b></summary>

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

  MyersDiff: Middle Snake Stress Tests
    ✔ should correctly handle a large block replacement in the middle
    ✔ should correctly handle moving a large block of tokens
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
    ✔ should handle simple deletion
    ✔ should handle simple replacement
    ✔ should handle whitespace-only line replacement
    ✔ should handle move (complex change) - expecting correct reconstruction
    ✔ should handle multiple non-contiguous modifications
    ✔ should handle changes involving only whitespace (indentation)
    ✔ should handle complete rewrite
    ✔ should handle deletion of all content
    ✔ should handle creation from empty
    ✔ should handle changes with unicode characters
    ✔ should return no changes for identical inputs
    ✔ should prioritize local change over larger replacement
    ✔ should handle a moved block of tokens (Block Move test case)

  MyersDiff Unit Tests (Exact Match) - Strategy: preserveStructure
    ✔ should handle simple addition (unit)
    ✔ should handle simple deletion (unit)
    ✔ should handle simple replacement (unit)
    ✔ should handle indentation change (unit - expecting line replace)
    ✔ should prioritize local change over larger replacement (unit)

  126 passing (275ms)
```

</details>

---

## License

MIT © Aleks Fishan

<details>
<summary>View License Text</summary>

```text
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
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>