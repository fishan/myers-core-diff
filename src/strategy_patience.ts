/**
 * @license
 * Copyright (c) 2025, Internal Implementation
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
    MyersCoreDiff,
    DiffOperation,
    type DiffResult,
    type DiffStrategyPlugin,
    type DiffOptions,
    type Anchor
} from './myers_core_diff.js'; // Ensure the import path is correct

const __DEV__ = false;

const microAnchorConfigOverrides: Partial<DiffOptions> = {
    minMatchLength: 2,
    quickDiffThreshold: 16, // Lower threshold for micro search
    hugeDiffThreshold: 64,  // Lower threshold for micro search
    jumpStep: 1,
    huntChunkSize: 2,
    minAnchorConfidence: 0.7, // Slightly lower confidence might be acceptable here
    useAnchors: true,
};

/**
 * Checks if there are any common tokens between two token ranges.
 *
 * Used as a fast pre-check to determine whether a diff operation
 * between two segments can benefit from deeper analysis.
 *
 * @param {Uint32Array} oldTokens - Array of old tokens.
 * @param {number} oldStart - Start index of the old token range (inclusive).
 * @param {number} oldEnd - End index of the old token range (exclusive).
 * @param {Uint32Array} newTokens - Array of new tokens.
 * @param {number} newStart - Start index of the new token range (inclusive).
 * @param {number} newEnd - End index of the new token range (exclusive).
 * @returns {boolean} `true` if any token from the old range exists in the new range, otherwise `false`.
 * @example
 * const hasCommon = _hasCommonTokens(oldTokens, 0, 10, newTokens, 0, 12);
 * console.log(hasCommon); // true or false
 */
function _hasCommonTokens(
    oldTokens: Uint32Array, oldStart: number, oldEnd: number,
    newTokens: Uint32Array, newStart: number, newEnd: number
): boolean {
    const oldSet = new Set(oldTokens.subarray(oldStart, oldEnd));
    if (oldSet.size === 0) return false;
    for (let i = newStart; i < newEnd; i++) {
        if (oldSet.has(newTokens[i])) {
            return true;
        }
    }
    return false;
}

/**
 * Processes a "stable gap" between anchors using L3/L4 diff strategies.
 *
 * This function recursively analyzes a diff gap region and decides whether
 * to use micro-anchor search (L3) or fallback guided diff (L4), based on size and content.
 *
 * @param {MyersCoreDiff} engine - The core diff engine instance.
 * @param {Uint32Array} oldTokens - Array of old tokens.
 * @param {number} oldStart - Start index of the old token range.
 * @param {number} oldEnd - End index of the old token range.
 * @param {Uint32Array} newTokens - Array of new tokens.
 * @param {number} newStart - Start index of the new token range.
 * @param {number} newEnd - End index of the new token range.
 * @param {string[]} idToString - Mapping of token IDs to their string values.
 * @param {Required<DiffOptions>} config - The diff configuration.
 * @param {boolean} debug - Enables detailed console logging if `true`.
 * @returns {DiffResult[]} Array of diff operations representing the resolved gap.
 * @example
 * const result = _processStableGap(engine, oldTokens, 0, 15, newTokens, 0, 18, idMap, config, true);
 * console.log(result);
 */
function _processStableGap(
    engine: MyersCoreDiff,
    oldTokens: Uint32Array, oldStart: number, oldEnd: number,
    newTokens: Uint32Array, newStart: number, newEnd: number,
    idToString: string[],
    config: Required<DiffOptions>,
    debug: boolean
): DiffResult[] {

    const gapOldLen = oldEnd - oldStart;
    const gapNewLen = newEnd - newStart;
    const gapSize = gapOldLen + gapNewLen;

    if (__DEV__ && debug) {
        console.group(`[🧬 _processStableGap L3/L4] START old[${oldStart}, ${oldEnd}) new[${newStart}, ${newEnd}) size=${gapSize}`);
    }

    if (gapSize === 0) {
        if (__DEV__ && debug) console.groupEnd();
        return [];
    }

    // --- Optimization: check for shared tokens ---
    if (!_hasCommonTokens(oldTokens, oldStart, oldEnd, newTokens, newStart, newEnd)) {
        if (__DEV__ && debug) {
            console.log(`[🧬 _processStableGap L3/L4] No common tokens found. Using simple REMOVE+ADD via _guidedCalculateDiff.`);
        }
        const fallbackResult = engine._guidedCalculateDiff(
            oldTokens, oldStart, oldEnd,
            newTokens, newStart, newEnd,
            idToString, config, debug
        );
        if (__DEV__ && debug) console.groupEnd();
        return fallbackResult;
    }

    // --- Choose between L3 search or direct L4 fallback ---
    const shouldUseMicroAnchorSearch = gapSize >= (config.quickDiffThreshold / 2);

    if (shouldUseMicroAnchorSearch) {
        // --- Step L3: search for micro anchors ---
        if (__DEV__ && debug) {
            console.log(`[🧬 _processStableGap L3] Gap large enough (${gapSize}). Searching for micro-anchors...`);
        }
        const microConfig: Required<DiffOptions> = {
            ...config,
            ...microAnchorConfigOverrides
        };

        const microAnchors = engine._findAnchors(
            oldTokens, oldStart, oldEnd,
            newTokens, newStart, newEnd,
            microConfig, debug
        );

        const anchorChain = engine._mergeAndFilterAnchors(microAnchors, microConfig, debug);

        if (anchorChain.length > 0) {
            if (__DEV__ && debug) {
                console.log(`[🧬 _processStableGap L3] Found ${anchorChain.length} micro-anchors. Processing gaps between them...`);
            }
            const result: DiffResult[] = [];
            let currentOldPos = oldStart;
            let currentNewPos = newStart;

            for (const anchor of anchorChain) {
                if (anchor.oldPos > currentOldPos || anchor.newPos > currentNewPos) {
                    const subGapResult = _processStableGap(
                        engine,
                        oldTokens, currentOldPos, anchor.oldPos,
                        newTokens, currentNewPos, anchor.newPos,
                        idToString, config, debug
                    );
                    result.push(...subGapResult);
                }

                for (let j = 0; j < anchor.length; j++) {
                    result.push([DiffOperation.EQUAL, idToString[oldTokens[anchor.oldPos + j]]]);
                }

                currentOldPos = anchor.oldPos + anchor.length;
                currentNewPos = anchor.newPos + anchor.length;
            }

            if (currentOldPos < oldEnd || currentNewPos < newEnd) {
                const trailingGapResult = _processStableGap(
                    engine,
                    oldTokens, currentOldPos, oldEnd,
                    newTokens, currentNewPos, newEnd,
                    idToString, config, debug
                );
                result.push(...trailingGapResult);
            }

            if (__DEV__ && debug) {
                console.log(`[🧬 _processStableGap L3] Finished processing micro-anchors. Result length: ${result.length}`);
                console.groupEnd();
            }
            return result;

        } else {
            if (__DEV__ && debug) {
                console.log(`[🧬 _processStableGap L3->L4] No micro-anchors found. Using L4 fallback (_guidedCalculateDiff).`);
            }
        }

    } else {
        if (__DEV__ && debug) {
            console.log(`[🧬 _processStableGap L4] Gap too small (${gapSize}). Using L4 fallback (_guidedCalculateDiff).`);
        }
    }

    const fallbackResult = engine._guidedCalculateDiff(
        oldTokens, oldStart, oldEnd,
        newTokens, newStart, newEnd,
        idToString, config, debug
    );
    if (__DEV__ && debug) console.groupEnd();
    return fallbackResult;
}

/**
 * Processes a range using local L2 anchors and recursively calls
 * lower-level handlers for smaller gaps (L3/L4).
 *
 * Used to preserve local structural consistency during diff analysis.
 *
 * @param {MyersCoreDiff} engine - The core diff engine.
 * @param {Uint32Array} oldTokens - Array of old tokens.
 * @param {number} oldStart - Start index of the old token range.
 * @param {number} oldEnd - End index of the old token range.
 * @param {Uint32Array} newTokens - Array of new tokens.
 * @param {number} newStart - Start index of the new token range.
 * @param {number} newEnd - End index of the new token range.
 * @param {string[]} idToString - Mapping of token IDs to strings.
 * @param {Required<DiffOptions>} config - Configuration options for diffing.
 * @param {boolean} debug - Whether to enable debug logging.
 * @returns {DiffResult[]} The computed diff results for this range.
 * @example
 * const rangeDiff = _processRangeWithLocalAnchors(engine, oldTokens, 0, 25, newTokens, 0, 30, idMap, config, false);
 */
function _processRangeWithLocalAnchors(
    engine: MyersCoreDiff,
    oldTokens: Uint32Array, oldStart: number, oldEnd: number,
    newTokens: Uint32Array, newStart: number, newEnd: number,
    idToString: string[],
    config: Required<DiffOptions>,
    debug: boolean
): DiffResult[] {
    if (__DEV__ && debug) {
        console.group(`[🧬 _processRangeWithLocalAnchors L2/L3/L4] START old[${oldStart}, ${oldEnd}) new[${newStart}, ${newEnd})`);
    }

    const result: DiffResult[] = [];
    let oldPos = oldStart;
    let newPos = newStart;

    while (oldPos < oldEnd && newPos < newEnd) {
        const nextAnchor = engine._findNextLocalAnchor(
            oldTokens, oldPos, oldEnd,
            newTokens, newPos, newEnd,
            config.localLookahead || 50,
            debug
        );

        const gapOldEnd = nextAnchor?.oldPos ?? oldEnd;
        const gapNewEnd = nextAnchor?.newPos ?? newEnd;

        if (__DEV__ && debug) {
            if (nextAnchor) {
                console.log(`[🧬 L2] Next L2 anchor found at old=${nextAnchor.oldPos}, new=${nextAnchor.newPos}. Gap before: old[${oldPos}, ${gapOldEnd}), new[${newPos}, ${gapNewEnd})`);
            } else {
                console.log(`[🧬 L2] No more L2 anchors. Final gap: old[${oldPos}, ${gapOldEnd}), new[${newPos}, ${gapNewEnd})`);
            }
        }

        if (gapOldEnd > oldPos || gapNewEnd > newPos) {
            if (__DEV__ && debug) console.log(`[🧬 L2] Processing gap -> _processStableGap`);
            const gapResult = _processStableGap(
                engine,
                oldTokens, oldPos, gapOldEnd,
                newTokens, newPos, gapNewEnd,
                idToString, config, debug
            );
            result.push(...gapResult);
        }

        if (nextAnchor) {
            // Each L2 anchor represents one matching token
            result.push([DiffOperation.EQUAL, idToString[oldTokens[nextAnchor.oldPos]]]);
            oldPos = nextAnchor.oldPos + 1;
            newPos = nextAnchor.newPos + 1;
        } else {
            oldPos = oldEnd;
            newPos = newEnd;
        }
    }

    if (oldPos < oldEnd) {
        if (__DEV__ && debug) console.log(`[🧬 L2] Adding trailing REMOVEs from oldPos=${oldPos}`);
        for (let i = oldPos; i < oldEnd; i++) {
            result.push([DiffOperation.REMOVE, idToString[oldTokens[i]]]);
        }
    }
    if (newPos < newEnd) {
        if (__DEV__ && debug) console.log(`[🧬 L2] Adding trailing ADDs from newPos=${newPos}`);
        for (let i = newPos; i < newEnd; i++) {
            result.push([DiffOperation.ADD, idToString[newTokens[i]]]);
        }
    }

    if (__DEV__ && debug) {
        console.log(`[🧬 _processRangeWithLocalAnchors L2/L3/L4] END. Result length: ${result.length}`);
        console.groupEnd();
    }
    return result;
}

/**
 * Finds tokens that appear exactly once in both old and new ranges.
 *
 * Used in Patience Diff algorithm to detect unique anchors that are
 * guaranteed to be matched one-to-one between old and new sequences.
 *
 * @param {Uint32Array} oldTokens - Array of old tokens.
 * @param {number} oldStart - Start index in old tokens.
 * @param {number} oldEnd - End index in old tokens.
 * @param {Uint32Array} newTokens - Array of new tokens.
 * @param {number} newStart - Start index in new tokens.
 * @param {number} newEnd - End index in new tokens.
 * @returns {Map<number, { oldIndex: number, newIndex: number }>} Map of token IDs to their matching indices.
 * @example
 * const unique = findUniqueMatches(oldTokens, 0, 100, newTokens, 0, 120);
 * console.log(unique.size); // e.g., 15
 */
function findUniqueMatches(
    oldTokens: Uint32Array, oldStart: number, oldEnd: number,
    newTokens: Uint32Array, newStart: number, newEnd: number
): Map<number, { oldIndex: number, newIndex: number }> {
    const oldCounts = new Map<number, number>();
    const oldIndices = new Map<number, number>();
    for (let i = oldStart; i < oldEnd; i++) {
        const token = oldTokens[i];
        oldCounts.set(token, (oldCounts.get(token) || 0) + 1);
        if (oldCounts.get(token)! === 1) {
            oldIndices.set(token, i);
        } else {
            oldIndices.delete(token);
        }
    }

    const newCounts = new Map<number, number>();
    const newIndices = new Map<number, number>();
    for (let i = newStart; i < newEnd; i++) {
        const token = newTokens[i];
        newCounts.set(token, (newCounts.get(token) || 0) + 1);
        if (newCounts.get(token)! === 1) {
            newIndices.set(token, i);
        } else {
            newIndices.delete(token);
        }
    }

    const uniqueMatches = new Map<number, { oldIndex: number, newIndex: number }>();
    for (const [token, oldIndex] of oldIndices.entries()) {
        if (oldCounts.get(token) === 1 && newIndices.has(token) && newCounts.get(newIndices.get(token)!) === 1) {
            uniqueMatches.set(token, { oldIndex: oldIndex, newIndex: newIndices.get(token)! });
        }
    }
    return uniqueMatches;
}

/**
 * Computes the Longest Increasing Subsequence (LIS) of unique token matches.
 *
 * Used by the Patience Diff algorithm to determine the most stable alignment
 * of common tokens that preserve order in both sequences.
 *
 * @param {Array<{ tokenId: number, oldIndex: number, newIndex: number }>} uniqueMatchPairs - Pairs of matched indices.
 * @returns {Array<{ tokenId: number, oldIndex: number, newIndex: number }>} The LIS of matching token pairs.
 * @example
 * const lis = findLIS([{ tokenId: 1, oldIndex: 0, newIndex: 2 }, { tokenId: 2, oldIndex: 1, newIndex: 3 }]);
 * console.log(lis);
 */
function findLIS(
    uniqueMatchPairs: Array<{ tokenId: number, oldIndex: number, newIndex: number }>
): Array<{ tokenId: number, oldIndex: number, newIndex: number }> {
    if (!uniqueMatchPairs || uniqueMatchPairs.length === 0) {
        return [];
    }

    uniqueMatchPairs.sort((a, b) => a.oldIndex - b.oldIndex);

    const n = uniqueMatchPairs.length;
    const tailsIndices = new Array(n).fill(0);
    const predecessors = new Array(n).fill(-1);
    let size = 0;

    for (let i = 0; i < n; i++) {
        const currentNewIndex = uniqueMatchPairs[i].newIndex;
        let left = 0, right = size;
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (uniqueMatchPairs[tailsIndices[mid]].newIndex < currentNewIndex) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        tailsIndices[left] = i;
        if (left > 0) {
            predecessors[i] = tailsIndices[left - 1];
        }
        if (left === size) {
            size++;
        }
    }

    const lisResult: Array<{ tokenId: number, oldIndex: number, newIndex: number }> = [];
    let current = tailsIndices[size - 1];
    while (current !== -1) {
        lisResult.push(uniqueMatchPairs[current]);
        current = predecessors[current];
    }
    lisResult.reverse();
    return lisResult;
}

/**
 * Performs a recursive Patience Diff between two token ranges.
 *
 * The algorithm finds unique token matches, extracts the LIS (Longest Increasing Subsequence),
 * and recursively processes unmatched segments. Falls back to L2/L3/L4 strategies when necessary.
 *
 * @param {MyersCoreDiff} engine - The core diff engine.
 * @param {Uint32Array} oldTokens - The old token array.
 * @param {number} oldStart - Start index in oldTokens.
 * @param {number} oldEnd - End index in oldTokens.
 * @param {Uint32Array} newTokens - The new token array.
 * @param {number} newStart - Start index in newTokens.
 * @param {number} newEnd - End index in newTokens.
 * @param {string[]} idToString - Mapping of token IDs to text.
 * @param {Required<DiffOptions>} config - Full diff configuration.
 * @param {boolean} debug - Enables verbose logging when true.
 * @param {number} [depth=0] - Recursion depth for debugging.
 * @returns {DiffResult[]} Array of computed diff operations.
 * @example
 * const diff = _patienceDiffRecursive(engine, oldTokens, 0, 50, newTokens, 0, 55, idMap, config, false);
 * console.log(diff.length);
 */
function _patienceDiffRecursive(
    engine: MyersCoreDiff,
    oldTokens: Uint32Array, oldStart: number, oldEnd: number,
    newTokens: Uint32Array, newStart: number, newEnd: number,
    idToString: string[],
    config: Required<DiffOptions>,
    debug: boolean,
    depth: number = 0
): DiffResult[] {

    if (__DEV__ && debug) {
        console.group(`[🧘 _patienceDiffRecursive depth=${depth}] START old[${oldStart}, ${oldEnd}) new[${newStart}, ${newEnd})`);
    }

    // --- Base cases ---
    if (oldStart >= oldEnd && newStart >= newEnd) {
        if (__DEV__ && debug) console.log(` -> Base case: empty ranges.`);
        if (__DEV__ && debug) console.groupEnd();
        return [];
    }
    if (oldStart >= oldEnd) {
        if (__DEV__ && debug) console.log(` -> Base case: only additions.`);
        const adds = engine._createAdditions(newTokens, newStart, newEnd, idToString, false);
        if (__DEV__ && debug) console.groupEnd();
        return adds;
    }
    if (newStart >= newEnd) {
        if (__DEV__ && debug) console.log(` -> Base case: only deletions.`);
        const dels = engine._createDeletions(oldTokens, oldStart, oldEnd, idToString, false);
        if (__DEV__ && debug) console.groupEnd();
        return dels;
    }

    // --- Step 1: find unique matches ---
    const uniqueMatchesMap = findUniqueMatches(oldTokens, oldStart, oldEnd, newTokens, newStart, newEnd);
    if (__DEV__ && debug) console.log(` -> Found ${uniqueMatchesMap.size} unique matches.`);

    // --- Step 2: find LIS ---
    const uniqueMatchPairs = Array.from(uniqueMatchesMap.entries()).map(([tokenId, indices]) => ({
        tokenId,
        oldIndex: indices.oldIndex,
        newIndex: indices.newIndex
    }));
    const lisAnchors = findLIS(uniqueMatchPairs);

    if (__DEV__ && debug) {
        if (lisAnchors.length > 0) {
            console.log(` -> Found LIS of length ${lisAnchors.length}. First anchor: old=${lisAnchors[0].oldIndex}, new=${lisAnchors[0].newIndex}`);
        } else {
            console.log(` -> No LIS found.`);
        }
    }

    // --- Step 3: recursion or fallback ---
    if (lisAnchors.length === 0) {
        if (__DEV__ && debug) console.log(` -> No anchors, falling back to L2/L3/L4 handler (_processRangeWithLocalAnchors).`);
        const fallbackResult = _processRangeWithLocalAnchors(
            engine,
            oldTokens, oldStart, oldEnd,
            newTokens, newStart, newEnd,
            idToString, config, debug
        );
        if (__DEV__ && debug) console.groupEnd();
        return fallbackResult;
    } else {
        const result: DiffResult[] = [];
        let currentOld = oldStart;
        let currentNew = newStart;

        for (const anchor of lisAnchors) {
            if (anchor.oldIndex > currentOld || anchor.newIndex > currentNew) {
                const beforeResult = _patienceDiffRecursive(
                    engine, oldTokens, currentOld, anchor.oldIndex,
                    newTokens, currentNew, anchor.newIndex,
                    idToString, config, debug, depth + 1
                );
                result.push(...beforeResult);
            }

            result.push([DiffOperation.EQUAL, idToString[anchor.tokenId]]);
            currentOld = anchor.oldIndex + 1;
            currentNew = anchor.newIndex + 1;
        }

        if (oldEnd > currentOld || newEnd > currentNew) {
            const afterResult = _patienceDiffRecursive(
                engine, oldTokens, currentOld, oldEnd,
                newTokens, currentNew, newEnd,
                idToString, config, debug, depth + 1
            );
            result.push(...afterResult);
        }

        if (__DEV__ && debug) {
            console.log(` -> Finished recursive assembly. Result length: ${result.length}`);
            console.groupEnd();
        }
        return result;
    }
}

/**
 * The main diff strategy plugin entry point for the Patience Diff algorithm.
 *
 * This function acts as a bridge between the MyersCoreDiff engine and
 * the recursive patience diff logic, applying it to the given token ranges.
 *
 * @param {MyersCoreDiff} engine - The diff engine instance.
 * @param {Uint32Array} oldTokens - Array of old tokens.
 * @param {number} oldStart - Start index in oldTokens.
 * @param {number} oldEnd - End index in oldTokens.
 * @param {Uint32Array} newTokens - Array of new tokens.
 * @param {number} newStart - Start index in newTokens.
 * @param {number} newEnd - End index in newTokens.
 * @param {string[]} idToString - Mapping of token IDs to string values.
 * @param {Required<DiffOptions>} config - Diff configuration.
 * @param {boolean} debug - Enables detailed debug logging.
 * @returns {DiffResult[]} The final diff result from the Patience Diff strategy.
 * @example
 * const result = _strategyPatienceDiff(engine, oldTokens, 0, 40, newTokens, 0, 42, idMap, config, true);
 */
const _strategyPatienceDiff: DiffStrategyPlugin = (
    engine: MyersCoreDiff,
    oldTokens: Uint32Array, oldStart: number, oldEnd: number,
    newTokens: Uint32Array, newStart: number, newEnd: number,
    idToString: string[],
    config: Required<DiffOptions>,
    debug: boolean
): DiffResult[] => {

    if (__DEV__ && debug) {
        console.group(`[🧘 Strategy 'patienceDiff'] START old[${oldStart}, ${oldEnd}) new[${newStart}, ${newEnd})`);
    }

    const result = _patienceDiffRecursive(
        engine, oldTokens, oldStart, oldEnd,
        newTokens, newStart, newEnd,
        idToString, config, debug, 0
    );

    if (__DEV__ && debug) {
        console.log(`[🧘 Strategy 'patienceDiff'] END. Final result length: ${result.length}`);
        console.groupEnd();
    }
    return result;
};

/**
 * Registers the Patience Diff strategy with the MyersCoreDiff engine.
 *
 * Adds a new diff strategy named `'patienceDiff'` that can be selected
 * by other components or algorithms using the engine.
 *
 * @param {typeof MyersCoreDiff} CoreEngine - The MyersCoreDiff class reference.
 * @returns {void}
 * @example
 * registerPatienceDiffStrategy(MyersCoreDiff);
 * const result = MyersCoreDiff.runStrategy('patienceDiff', oldTokens, newTokens);
 */
export function registerPatienceDiffStrategy(CoreEngine: typeof MyersCoreDiff): void {
    if (__DEV__) console.log(`[MyersCoreDiff Static] Registering 'patienceDiff' strategy.`);
    CoreEngine.registerStrategy('patienceDiff', _strategyPatienceDiff);
}
