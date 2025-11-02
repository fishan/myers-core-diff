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
    type Anchor // Import Anchor type if needed for internal logic
} from './myers_core_diff.js'; // Adjust path as needed

const __DEV__ = false; // Or inherit from MyersCoreDiff?

// Configuration for micro-anchor search within gaps
const microAnchorConfigOverrides: Partial<DiffOptions> = {
    minMatchLength: 2,
    quickDiffThreshold: 16, // Lower threshold for micro search
    hugeDiffThreshold: 64, // Lower threshold for micro search
    jumpStep: 1,
    huntChunkSize: 2,
    minAnchorConfidence: 0.7, // Slightly lower confidence might be acceptable here
    useAnchors: true,
    // Keep corridorWidth, lookahead etc. from the main config?
};

// Configuration for L1 anchor search
const preserveStructureL1AnchorConfig: Partial<DiffOptions> = {
    minMatchLength: 30,
    huntChunkSize: 10,        
    jumpStep: 10,              
    minAnchorConfidence: 0.75,
    useAnchors: true,     
    quickDiffThreshold: 32,
    hugeDiffThreshold: 128,
    anchorSearchMode: 'floating',
    preservePositions: true,
};

/**
 * Checks if two token ranges share any common tokens.
 * This is an optimization used by `_processStableGap` to quickly detect
 * whether a diff computation between two ranges is meaningful.
 *
 * @param {Uint32Array} oldTokens - Array of token IDs from the old sequence.
 * @param {number} oldStart - Start index in the old token array.
 * @param {number} oldEnd - End index (exclusive) in the old token array.
 * @param {Uint32Array} newTokens - Array of token IDs from the new sequence.
 * @param {number} newStart - Start index in the new token array.
 * @param {number} newEnd - End index (exclusive) in the new token array.
 * @returns {boolean} `true` if there is at least one token present in both ranges; otherwise `false`.
 *
 * @example
 * const hasCommon = _hasCommonTokens(
 *   new Uint32Array([1, 2, 3]),
 *   0, 3,
 *   new Uint32Array([3, 4, 5]),
 *   0, 3
 * );
 * // hasCommon === true
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
 * Processes a range of tokens by locating and using local (L2) anchors.
 * For each gap between positional anchors, delegates processing to
 * `_processStableGap`, which handles deeper (L3/L4) levels.
 * This function ensures structured traversal through locally stable regions.
 *
 * @param {MyersCoreDiff} engine - The diff engine instance used to find anchors and perform sub-diffs.
 * @param {Uint32Array} oldTokens - Tokenized representation of the old input.
 * @param {number} oldStart - Start index of the old segment.
 * @param {number} oldEnd - End index (exclusive) of the old segment.
 * @param {Uint32Array} newTokens - Tokenized representation of the new input.
 * @param {number} newStart - Start index of the new segment.
 * @param {number} newEnd - End index (exclusive) of the new segment.
 * @param {string[]} idToString - Array mapping token IDs back to their original string forms.
 * @param {Required<DiffOptions>} config - The effective diff configuration.
 * @param {boolean} debug - Enables detailed logging if true.
 * @returns {DiffResult[]} List of diff operations (ADD, REMOVE, EQUAL) for this range.
 *
 * @example
 * const result = _processRangeWithLocalAnchors(
 *   engine,
 *   oldTokens, 0, oldTokens.length,
 *   newTokens, 0, newTokens.length,
 *   idToString, config, true
 * );
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
        // 1. Find next L2 positional anchor
        const nextAnchor = engine._findNextLocalAnchor(
            oldTokens, oldPos, oldEnd,
            newTokens, newPos, newEnd,
            config.localLookahead || 50,
            debug
        );

        // 2. Determine gap BEFORE the anchor
        const gapOldEnd = nextAnchor?.oldPos ?? oldEnd;
        const gapNewEnd = nextAnchor?.newPos ?? newEnd;

        if (__DEV__ && debug) {
            if (nextAnchor) {
                 console.log(`[🧬 L2] Next L2 anchor found at old=${nextAnchor.oldPos}, new=${nextAnchor.newPos}. Gap before: old[${oldPos}, ${gapOldEnd}), new[${newPos}, ${gapNewEnd})`);
            } else {
                 console.log(`[🧬 L2] No more L2 anchors. Final Gap: old[${oldPos}, ${gapOldEnd}), new[${newPos}, ${gapNewEnd})`);
            }
        }

        // 3. Process the gap using the L3/L4 handler (_processStableGap)
        if (gapOldEnd > oldPos || gapNewEnd > newPos) {
             if (__DEV__ && debug) {
                 console.log(`[🧬 L2] Processing gap -> _processStableGap`);
            }
            const gapResult = _processStableGap(
                engine,
                oldTokens, oldPos, gapOldEnd,
                newTokens, newPos, gapNewEnd,
                idToString, config, debug
            );
            result.push(...gapResult);
        } else {
             if (__DEV__ && debug) {
                 console.log(`[🧬 L2] No gap before anchor.`);
            }
        }

        // 4. Add the L2 anchor itself (if found)
        if (nextAnchor) {
            result.push([DiffOperation.EQUAL, idToString[oldTokens[nextAnchor.oldPos]]]);
            oldPos = nextAnchor.oldPos + 1;
            newPos = nextAnchor.newPos + 1;
        } else {
            // No more anchors, finish loop
            oldPos = oldEnd;
            newPos = newEnd;
        }
    }

    // 5. Handle pure ADD/REMOVE tail
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
 * Handles the gap between two L2 positional anchors (Levels L3 & L4).
 * It searches for micro-floating anchors within the gap to preserve structure
 * and uses guided diff as a fallback when no anchors are found or when the
 * segment is too small. This function is never recursive into the core SES algorithm.
 *
 * @param {MyersCoreDiff} engine - The diff engine instance.
 * @param {Uint32Array} oldTokens - Array of token IDs for the old sequence.
 * @param {number} oldStart - Start index of the old segment.
 * @param {number} oldEnd - End index (exclusive) of the old segment.
 * @param {Uint32Array} newTokens - Array of token IDs for the new sequence.
 * @param {number} newStart - Start index of the new segment.
 * @param {number} newEnd - End index (exclusive) of the new segment.
 * @param {string[]} idToString - Mapping from token IDs to original strings.
 * @param {Required<DiffOptions>} config - Configuration for the diff engine.
 * @param {boolean} debug - Enables detailed logging for diagnostics.
 * @returns {DiffResult[]} Array of diff operations representing this gap.
 *
 * @example
 * const result = _processStableGap(
 *   engine,
 *   oldTokens, 0, 50,
 *   newTokens, 0, 45,
 *   idToString,
 *   config,
 *   false
 * );
 */

function _processStableGap(
    engine: MyersCoreDiff, // The Core Engine instance
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

    // --- Optimization: Check for common tokens ---
    if (!_hasCommonTokens(oldTokens, oldStart, oldEnd, newTokens, newStart, newEnd)) {
        if (__DEV__ && debug) {
            console.log(`[🧬 _processStableGap L3/L4] No common tokens found. Using simple REMOVE+ADD via _guidedCalculateDiff.`);
        }
        // Use guided diff as it efficiently handles this case (O(N+M))
        const fallbackResult = engine._guidedCalculateDiff(
            oldTokens, oldStart, oldEnd,
            newTokens, newStart, newEnd,
            idToString, config, debug
        );
         if (__DEV__ && debug) console.groupEnd();
        return fallbackResult;
    }

    // --- Decide between L3 search or direct L4 fallback ---
    // Use L3 micro-anchor search only if the gap is large enough to potentially benefit
    const shouldUseMicroAnchorSearch = gapSize >= (config.quickDiffThreshold / 2); // Heuristic threshold

    if (shouldUseMicroAnchorSearch) {
        // --- Step L3: Search for Micro-Floating Anchors ---
        if (__DEV__ && debug) {
            console.log(`[🧬 _processStableGap L3] Gap large enough (${gapSize}). Searching for micro-anchors...`);
        }
        const microConfig: Required<DiffOptions> = {
            ...config, // Start with main config
            ...microAnchorConfigOverrides // Apply micro overrides
        };

        const microAnchors = engine._findAnchors(
            oldTokens, oldStart, oldEnd,
            newTokens, newStart, newEnd,
            microConfig, debug // Use micro-config
        );

        const anchorChain = engine._mergeAndFilterAnchors(microAnchors, microConfig, debug);

        if (anchorChain.length > 0) {
            // --- L3 Anchors FOUND: Process recursively ---
            if (__DEV__ && debug) {
                console.log(`[🧬 _processStableGap L3] Found ${anchorChain.length} micro-anchors. Processing gaps between them...`);
            }
            const result: DiffResult[] = [];
            let currentOldPos = oldStart;
            let currentNewPos = newStart;

            for (const anchor of anchorChain) {
                // Process gap before anchor
                if (anchor.oldPos > currentOldPos || anchor.newPos > currentNewPos) {
                    const subGapResult = _processStableGap( // Recursive call
                        engine,
                        oldTokens, currentOldPos, anchor.oldPos,
                        newTokens, currentNewPos, anchor.newPos,
                        idToString, config, debug // Pass main config down
                    );
                    result.push(...subGapResult);
                }

                // Add anchor itself
                for (let j = 0; j < anchor.length; j++) {
                    result.push([DiffOperation.EQUAL, idToString[oldTokens[anchor.oldPos + j]]]);
                }

                currentOldPos = anchor.oldPos + anchor.length;
                currentNewPos = anchor.newPos + anchor.length;
            }

            // Process trailing gap after last anchor
            if (currentOldPos < oldEnd || currentNewPos < newEnd) {
                const trailingGapResult = _processStableGap( // Recursive call
                    engine,
                    oldTokens, currentOldPos, oldEnd,
                    newTokens, currentNewPos, newEnd,
                    idToString, config, debug // Pass main config down
                );
                result.push(...trailingGapResult);
            }

            if (__DEV__ && debug) {
                 console.log(`[🧬 _processStableGap L3] Finished processing micro-anchors. Result length: ${result.length}`);
                 console.groupEnd();
            }
            return result;

        } else {
             // --- L3 Anchors NOT FOUND: Fallback to L4 ---
             if (__DEV__ && debug) {
                console.log(`[🧬 _processStableGap L3->L4] No micro-anchors found. Using L4 fallback (_guidedCalculateDiff).`);
            }
        }

    } else {
        // --- Gap too small for L3 search: Fallback directly to L4 ---
         if (__DEV__ && debug) {
            console.log(`[🧬 _processStableGap L4] Gap too small (${gapSize}). Using L4 fallback (_guidedCalculateDiff).`);
        }
    }


    // --- Step L4: Fallback using Guided "Corridor" Diff ---
    // This is used if no common tokens, gap is too small for L3, or L3 found no anchors.
    const fallbackResult = engine._guidedCalculateDiff(
        oldTokens, oldStart, oldEnd,
        newTokens, newStart, newEnd,
        idToString, config, debug
    );
     if (__DEV__ && debug) console.groupEnd();
    return fallbackResult;
}


/**
 * The main orchestrator for the `preserveStructure` diff strategy (v6.1 HYBRID).
 * Operates in multiple levels:
 *  - Level 1 (L1): Global anchors across the entire sequence.
 *  - Level 2 (L2): Local anchors between global segments.
 *  - Level 3/4 (L3/L4): Micro-anchors and guided fallback diffs.
 * Provides a balanced approach between stability and efficiency.
 *
 * @param {MyersCoreDiff} engine - The diff engine instance managing anchor search and diff algorithms.
 * @param {Uint32Array} oldTokens - Tokens representing the old version of input.
 * @param {number} oldStart - Start index of the old segment.
 * @param {number} oldEnd - End index (exclusive) of the old segment.
 * @param {Uint32Array} newTokens - Tokens representing the new version of input.
 * @param {number} newStart - Start index of the new segment.
 * @param {number} newEnd - End index (exclusive) of the new segment.
 * @param {string[]} idToString - Mapping between token IDs and source strings.
 * @param {Required<DiffOptions>} config - Configuration controlling diff behavior.
 * @param {boolean} debug - If true, enables verbose logging.
 * @returns {DiffResult[]} Final list of diff operations representing structural changes.
 *
 * @example
 * const result = _strategyPreserveStructure(
 *   engine,
 *   oldTokens, 0, oldTokens.length,
 *   newTokens, 0, newTokens.length,
 *   idToString,
 *   config,
 *   true
 * );
 */

const _strategyPreserveStructure: DiffStrategyPlugin = (
    engine: MyersCoreDiff,
    oldTokens: Uint32Array, oldStart: number, oldEnd: number,
    newTokens: Uint32Array, newStart: number, newEnd: number,
    idToString: string[],
    config: Required<DiffOptions>,
    debug: boolean
): DiffResult[] => {

    if (__DEV__ && debug) {
        console.group(`[🧬 Strategy 'preserveStructure' v6.1 HYBRID] START old[${oldStart}, ${oldEnd}) new[${newStart}, ${newEnd})`);
    }

    const lakeSize = (oldEnd - oldStart) + (newEnd - newStart);
    let anchorChain: Anchor[] = []; // L1 global anchors

    // --- Шаг 1: Поиск Глобальных L1 Якорей (как в commonSES) ---
    if (config.useAnchors && lakeSize > config.quickDiffThreshold) {
        if (__DEV__ && debug) console.log(`[🧬 L1] Lake large enough (${lakeSize}). Searching for global anchors...`);
        const l1Config: Required<DiffOptions> = {
            ...config, // Берем основу из главного конфига
            ...preserveStructureL1AnchorConfig // Переопределяем L1 настройками
        };

        const foundAnchors = engine._findAnchors(
            oldTokens, oldStart, oldEnd,
            newTokens, newStart, newEnd,
            l1Config,
            debug
        );
        anchorChain = engine._mergeAndFilterAnchors(foundAnchors, config, debug);
    }

    const result: DiffResult[] = [];

    // --- Шаг 2: Обработка на основе L1 якорей ---
    if (anchorChain.length > 0) {
        // --- Путь A: L1 Якоря найдены ---
        if (__DEV__ && debug) {
            console.log(`[🧬 L1] Found ${anchorChain.length} global anchors. Processing gaps between them using L2/L3/L4 logic.`);
        }
        let currentOldPos = oldStart;
        let currentNewPos = newStart;

        for (const anchor of anchorChain) {
            // 2.A.1: Обработка разрыва ДО L1 якоря с помощью L2/L3/L4
            if (anchor.oldPos > currentOldPos || anchor.newPos > currentNewPos) {
                 if (__DEV__ && debug) console.log(`[🧬 L1->L2] Processing gap before anchor old[${currentOldPos}, ${anchor.oldPos}) new[${currentNewPos}, ${anchor.newPos}) -> _processRangeWithLocalAnchors`);
                const gapResult = _processRangeWithLocalAnchors( // Вызываем хелпер
                    engine,
                    oldTokens, currentOldPos, anchor.oldPos,
                    newTokens, currentNewPos, anchor.newPos,
                    idToString, config, debug
                );
                result.push(...gapResult);
            }

            // 2.A.2: Добавление самого L1 якоря (EQUAL блок)
             if (__DEV__ && debug) console.log(`[🧬 L1] Adding global anchor EQUAL block (length ${anchor.length})`);
            for (let j = 0; j < anchor.length; j++) {
                result.push([DiffOperation.EQUAL, idToString[oldTokens[anchor.oldPos + j]]]);
            }

            // Обновляем позиции
            currentOldPos = anchor.oldPos + anchor.length;
            currentNewPos = anchor.newPos + anchor.length;
        }

        // 2.A.3: Обработка разрыва ПОСЛЕ последнего L1 якоря
        if (currentOldPos < oldEnd || currentNewPos < newEnd) {
             if (__DEV__ && debug) console.log(`[🧬 L1->L2] Processing trailing gap old[${currentOldPos}, ${oldEnd}) new[${currentNewPos}, ${newEnd}) -> _processRangeWithLocalAnchors`);
            const trailingGapResult = _processRangeWithLocalAnchors( // Вызываем хелпер
                engine,
                oldTokens, currentOldPos, oldEnd,
                newTokens, currentNewPos, newEnd,
                idToString, config, debug
            );
            result.push(...trailingGapResult);
        }

    } else {
        // --- Путь B: L1 Якоря НЕ найдены ---
        // Используем оригинальную L2/L3/L4 логику для всего диапазона
        if (__DEV__ && debug) {
            console.log(`[🧬 L1] No global anchors found. Falling back to full range L2/L3/L4 processing -> _processRangeWithLocalAnchors`);
        }
        const fullRangeResult = _processRangeWithLocalAnchors(
            engine,
            oldTokens, oldStart, oldEnd,
            newTokens, newStart, newEnd,
            idToString, config, debug
        );
        result.push(...fullRangeResult);
    }

    if (__DEV__ && debug) {
        console.log(`[🧬 Strategy 'preserveStructure' v6.1 HYBRID] END. Final result length: ${result.length}`);
        console.groupEnd();
    }
    return result;
};

/**
 * Registers the `'preserveStructure'` diff strategy within a given Core Engine.
 * Once registered, the engine can use this strategy via `engine.setStrategy('preserveStructure')`.
 *
 * @param {typeof MyersCoreDiff} CoreEngine - The core diff engine class (typically `MyersCoreDiff`).
 * @returns {void}
 *
 * @example
 * import { registerPreserveStructureStrategy } from './preserveStructurePlugin.js';
 * import { MyersCoreDiff } from './myers_core_diff.js';
 *
 * registerPreserveStructureStrategy(MyersCoreDiff);
 * const diff = new MyersCoreDiff({ strategy: 'preserveStructure' });
 */

export function registerPreserveStructureStrategy(CoreEngine: typeof MyersCoreDiff): void {
    CoreEngine.registerStrategy('preserveStructure', _strategyPreserveStructure);
}