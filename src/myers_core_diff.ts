/**
 * @license
 * Copyright (c) 2025, Internal Implementation
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const __DEV__ = false;

/**
 * Enumerates the types of operations in a diff result.
 */
export enum DiffOperation {
	/** Represents a part of the sequence that is unchanged. */
	EQUAL,
	/** Represents a part of the sequence that was added. */
	ADD,
	/** Represents a part of the sequence that was removed. */
	REMOVE,
}

/**
 * Represents a single operation in the diff result.
 * It's a tuple where the first element is the operation type
 * and the second is the string content (token).
 * @example [DiffOperation.EQUAL, 'some text']
 */
export type DiffResult = [DiffOperation, string];

/**
 * Data structure for the result of the middle snake search.
 * Represents the overlapping region found by the forward and backward searches.
 * @internal
 */
interface MiddleSnake {
	/** Start X coordinate (position in oldTokens) of the snake. */
	x: number;
	/** Start Y coordinate (position in newTokens) of the snake. */
	y: number;
	/** End U coordinate (position in oldTokens) of the snake. */
	u: number;
	/** End V coordinate (position in newTokens) of the snake. */
	v: number;
}

/**
 * Configuration options for the diff algorithm.
 */
export interface DiffOptions {
	/** The name of the diffing strategy plugin to use. */
	diffStrategyName?: string;
	/** The minimum length of a match to be considered a valid anchor. */
	minMatchLength?: number;
	/** The threshold (N+M) for switching to a faster, less precise diff algorithm for small changes. */
	quickDiffThreshold?: number;
	/** The threshold (N+M) for using optimizations (like _guidedCalculateDiff) for very large differences. */
	hugeDiffThreshold?: number;
	/** How far ahead to look for potential matches when guiding the diff algorithm (_guidedCalculateDiff). */
	lookahead?: number;
	/** The width of the "corridor" to search within around the main diagonal (_guidedCalculateDiff). */
	corridorWidth?: number;
	/** If true, skips the initial trimming of common prefixes and suffixes. */
	skipTrimming?: boolean;
	/** (For _findAnchors) Scan step when searching for anchors. */
	jumpStep?: number;
	/** (For _findAnchors) Chunk size for hashing. */
	huntChunkSize?: number
	/** (For _findAnchors) Minimum anchor confidence (0.0–1.0). */
	minAnchorConfidence?: number;
	/** Whether to use L1 anchors (global search). */
	useAnchors?: boolean;
	/** If true, the diff algorithm will prioritize preserving the positions of equal tokens. (Used by strategies) */
	preservePositions?: boolean;
	/** (For stable diff) Threshold for using full diff on small gaps vs. simple add/remove. */
	localgap?: number;
	/** (For stable diff) How far to search for L2 (positional) anchors. */
	localLookahead?: number;
	/** (For _findAnchors) L1 anchor search mode. */
	anchorSearchMode?: 'floating' | 'positional' | 'combo';
	/** (For 'positional' mode) Max drift for an L1 positional anchor. */
	positionalAnchorMaxDrift?: number;

}

/**
 * Defines the interface (contract) for a diff strategy plugin.
 * A plugin receives the diff engine instance to access its "Toolbox" of algorithms.
 *
 * @param engine The engine instance for accessing the Toolbox.
 * @param oldTokens The tokenized 'old' sequence.
 * @param oldStart The start index for diffing in oldTokens.
 * @param oldEnd The end index (exclusive) for diffing in oldTokens.
 * @param newTokens The tokenized 'new' sequence.
 * @param newStart The start index for diffing in newTokens.
 * @param newEnd The end index (exclusive) for diffing in newTokens.
 * @param idToString A map to convert token IDs back to strings.
 * @param config The fully resolved diff configuration.
 * @param debug A flag to enable verbose logging.
 * @returns An array of DiffResult tuples.
 */
export type DiffStrategyPlugin = (
	engine: MyersCoreDiff, // The engine instance for accessing the Toolbox
	oldTokens: Uint32Array, oldStart: number, oldEnd: number,
	newTokens: Uint32Array, newStart: number, newEnd: number,
	idToString: string[],
	config: Required<DiffOptions>,
	debug: boolean
) => DiffResult[];


/**
 * Represents an anchor, which is a significant, identical block of tokens
 * between the old and new sequences. Anchors guide the diffing process.
 * @internal
 */
export interface Anchor {
	/** The starting position in the 'old' sequence. */
	oldPos: number;
	/** The starting position in the 'new' sequence. */
	newPos: number;
	/** The length of the matching block. */
	length: number;
	/** The absolute positional difference (Math.abs(newPos - oldPos)). */
	driftDistance: number;
	/** The drift distance relative to the anchor length. */
	driftRatio: number;
	/** A confidence score (0.0 - 1.0) for this anchor. */
	confidence: number;
}

/**
 * Represents a "gap" between two anchors, which needs to be diffed.
 * @internal
 */
interface GapInfo {
	/** The start index of the gap in the 'old' sequence. */
	oldStart: number;
	/** The end index (exclusive) of the gap in the 'old' sequence. */
	oldEnd: number;
	/** The start index of the gap in the 'new' sequence. */
	newStart: number;
	/** The end index (exclusive) of the gap in the 'new' sequence. */
	newEnd: number;
}


/**
 * Implements a polynomial rolling hash for efficient substring searching.
 * This is used to quickly find potential matching blocks (anchors)
 * between two sequences of tokens.
 * @internal
 */
class RollingHash {
	private readonly P = 31; // A prime number for the polynomial hash
	private readonly M = 1e9 + 9; // A large prime modulus
	private readonly P_POW: number;
	private currentHash = 0;
	private readonly tokens: Uint32Array;
	private readonly length: number;

	/**
	 * Creates an instance of RollingHash.
	 * @param tokens - The array of token IDs to hash.
	 * @param length - The length of the window for hashing.
	 */
	constructor(tokens: Uint32Array, length: number) {
		this.tokens = tokens;
		this.length = length;
		this.P_POW = this._power(this.P, this.length - 1);
		this.currentHash = this._calculateInitialHash();
	}

	/**
	 * Gets the current hash value of the window.
	 * @returns The hash value.
	 */
	public getHash(): number {
		return this.currentHash;
	}

	/**
	 * Slides the hashing window one position to the right.
	 * It efficiently updates the hash value without recalculating from scratch
	 * by removing the leftmost token and adding the new rightmost token.
	 * @param oldToken - The token ID leaving the window.
	 * @param newToken - The token ID entering the window.
	 */
	public slide(oldToken: number, newToken: number): void {
		const M = this.M;
		const P = this.P;
		const P_POW = this.P_POW;

		// Remove the old token's contribution
		let hash = this.currentHash - (oldToken * P_POW) % M;
		if (hash < 0) hash += M;

		// Shift the hash to the left
		hash = (hash * P) % M;

		// Add the new token's contribution
		hash += newToken;
		if (hash >= M) hash -= M;

		this.currentHash = hash;
	}

	/**
	 * Calculates modular exponentiation (a^b % M).
	 * @param a - The base.
	 * @param b - The exponent.
	 * @returns The result of (a^b % M).
	 * @private
	 */
	private _power(a: number, b: number): number {
		const M = this.M;
		let res = 1;
		a %= M;

		while (b > 0) {
			if (b & 1) res = (res * a) % M;
			a = (a * a) % M;
			b >>= 1; // Faster than Math.floor(b / 2)
		}
		return res;
	}

	/**
	 * Calculates the initial hash for the first window of tokens.
	 * @returns The initial hash value.
	 * @private
	 */
	private _calculateInitialHash(): number {
		const M = this.M;
		const P = this.P;
		const tokens = this.tokens;
		const length = this.length;

		let hash = 0;
		for (let i = 0; i < length; i++) {
			hash = (hash * P + tokens[i]) % M;
		}
		return hash;
	}
}

/**
 * An advanced, high-performance implementation of the Myers diff algorithm.
 *
 * [v6.0] This class is implemented as an "Engine" (Toolbox) and a "Dispatcher".
 * It provides a "Toolbox" of core diffing algorithms (e.g., _findAnchors,
 * _recursiveDiff) and a "Registry" for "Strategy Plugins".
 *
 * The `diff()` method is a "Dispatcher" that performs tokenization and trimming,
 * then delegates the core diffing logic to the selected "Strategy Plugin"
 * (e.g., 'commonSES' or an external 'preserveStructure' plugin).
 *
 * ### Key Features & Techniques
 *
 * - **Token-Based Approach**: (Core) Converts string tokens to integer IDs
 * for blazing-fast comparisons.
 *
 * - **Prefix/Suffix Trimming**: (Core) Strips common prefixes and suffixes
 * before diffing.
 *
 * - **Strategy Registry (Plugins)**: Allows external code to register new
 * diffing strategies (e.G., `registerStrategy('preserveStructure', ...)`).
 * This makes the engine highly extensible for specialized tasks (like
 * genetic analysis) without modifying the core.
 *
 * - **Toolbox of Algorithms**: Provides all core algorithms as public methods
 * (e.g., `_findAnchors`, `_recursiveDiff`, `_guidedCalculateDiff`) for use
 * by external strategy plugins.
 *
 * ### Default Strategy: 'commonSES'
 *
 * The default built-in strategy, 'commonSES', implements the logic
 * optimized for finding the Shortest Edit Script (SES):
 *
 * - **Anchor-Based Guided Diff**: Uses `_findAnchors` (L1) to find
 * global floating anchors.
 * - **Recursive Myers**: Uses `_recursiveDiff` (with "middle snake")
 * to process the "gaps" between anchors, falling back to
 * `_guidedCalculateDiff` for very large gaps.
 *
 * @example
 * ```typescript
 * // 1. Using the default 'commonSES' strategy
 * const differ = new MyersCoreDiff();
 * const result = differ.diff(oldCode, newCode);
 *
 * // 2. Using a custom (externally registered) strategy
 * // (Assuming 'preserveStructure' was registered)
 * const options = { diffStrategyName: 'preserveStructure' };
 * const result = differ.diff(oldCode, newCode, false, options);
 * ```
 */
export class MyersCoreDiff {
	declare static __DEV__: boolean;
	private static strategyRegistry = new Map<string, DiffStrategyPlugin>();
    private static isDefaultRegistered = false;
	public static readonly defaultOptions: Required<DiffOptions> = {
		diffStrategyName: 'commonSES', // Default strategy
		minMatchLength: 30,
		quickDiffThreshold: 64,
		hugeDiffThreshold: 256,
		lookahead: 10,
		corridorWidth: 10,
		skipTrimming: false,
		jumpStep: 30,
		huntChunkSize: 10,
		minAnchorConfidence: 0.8,
		useAnchors: true,
		localgap: 10,
		preservePositions: true, // Default for 'commonSES'
		localLookahead: 50,
		anchorSearchMode: 'combo',
		positionalAnchorMaxDrift: 20,
	};

	/**
	 * Ensures that the default 'commonSES' strategy is registered.
	 * This method is idempotent and will only register the strategy once,
	 * using the provided instance to correctly bind 'this' for the method.
	 *
	 * @param instance - The MyersCoreDiff instance to which the strategy function will be bound.
	 * @private
	 * @static
	 */
	private static ensureDefaultStrategyRegistered(instance: MyersCoreDiff): void {
        // Register only if the flag is not set
        if (!MyersCoreDiff.isDefaultRegistered) {
            // Use the passed instance to correctly bind 'this' for the method
            MyersCoreDiff.registerStrategy('commonSES', instance._strategycommonSES.bind(instance));
            MyersCoreDiff.isDefaultRegistered = true; // Set the flag
             if (__DEV__) {
                console.log(`[MyersCoreDiff Static] Registered default 'commonSES' strategy.`);
            }
        }
    }
	

	/**
	 * Registers a new diffing strategy plugin with the Core Engine.
	 * @param name The name of the strategy (e.g., 'preserveStructure').
	 * @param strategyFn The function implementing the DiffStrategyPlugin interface.
	 * @public
	 * @static
	 */
	public static registerStrategy(name: string, strategyFn: DiffStrategyPlugin): void {
		if (__DEV__) {
			console.log(`[MyersCoreDiff] Registering strategy: '${name}'`);
		}
		MyersCoreDiff.strategyRegistry.set(name, strategyFn);
	}

	/**
	 * Initializes the Core Engine and registers built-in strategies.
	 * @public
	 */
	constructor() {
		MyersCoreDiff.ensureDefaultStrategyRegistered(this);
	}

	/**
	 * Computes the difference using the "Dispatcher" logic.
	 *
	 * This method performs setup (tokenization, trimming) and then delegates
	 * the core diffing logic to the selected "Strategy Plugin" from the
	 * registry (based on `options.diffStrategyName`).
	 *
	 * @param oldTokens - The original array of strings.
	 * @param newTokens - The new array of strings.
	 * @param debug - (Internal) Enables verbose logging for debugging purposes.
	 * @param options - Optional configuration, including `diffStrategyName`.
	 * @returns An array of DiffResult tuples representing the edit script.
	 * @public
	 */
	public diff(
		oldTokens: string[],
		newTokens: string[],
		debug: boolean = false,
		options?: DiffOptions
	): DiffResult[] {
		const config: Required<DiffOptions> = {
			...MyersCoreDiff.defaultOptions,
			...options,
		};		

		if (__DEV__ && debug) {
			console.group(`[diff] START (Dispatcher)`);
			console.log(`Options:`, config);
		}

		// --- 1. Preparation (Tokenization and Trimming) ---
		const { hashedOld, hashedNew, idToString } = this._tokenize(oldTokens, newTokens, debug);

		let prefix: DiffResult[] = [];
		let suffix: DiffResult[] = [];
		let newOldStart = 0;
		let newOldEnd = hashedOld.length;
		let newNewStart = 0;
		let newNewEnd = hashedNew.length;

		if (!config.skipTrimming) {
			const trimmed = this._trimCommonPrefixSuffix(
				hashedOld, 0, hashedOld.length,
				hashedNew, 0, hashedNew.length,
				idToString
			);
			prefix = trimmed.prefix;
			suffix = trimmed.suffix;
			newOldStart = trimmed.newOldStart;
			newOldEnd = trimmed.newOldEnd;
			newNewStart = trimmed.newNewStart;
			newNewEnd = trimmed.newNewEnd;
		}

		// --- 2. Strategy Definition ---
		const strategyName = config.diffStrategyName;

		if (__DEV__ && debug) {
			console.log(`[diff] Dispatching to strategy: '${strategyName}'`);
		}

		// --- 3. Plugin Lookup ---
		const strategyFn = MyersCoreDiff.strategyRegistry.get(strategyName);

		if (!strategyFn) {
			throw new Error(`[MyersCoreDiff] Strategy '${strategyName}' is not registered.`);
		}

		// --- 4. Plugin Invocation (passing 'this' as the "Engine") ---
		const body = strategyFn(
			this, // The "Engine" instance"
			hashedOld, newOldStart, newOldEnd,
			hashedNew, newNewStart, newNewEnd,
			idToString, config, debug
		);

		// --- 5. Assembly ---
		if (__DEV__ && debug) {
			console.log(`[diff] FINISH (Dispatcher). Total result length: ${prefix.length + body.length + suffix.length}`);
			console.groupEnd();
		}

		return prefix.concat(body).concat(suffix);
	}

	/**
     * Built-in plugin strategy "commonSES".
     * Implements the classic cdiff logic optimized for SES,
     * but *retains* the ability to use _calculateStableDiff if
     * config.preservePositions is true.
	 * @param engine - The engine instance (unused, `this` is used).
	 * @param oldTokens - The tokenized 'old' sequence.
	 * @param oldStart - The start index for diffing in oldTokens.
	 * @param oldEnd - The end index (exclusive) for diffing in oldTokens.
	 * @param newTokens - The tokenized 'new' sequence.
	 * @param newStart - The start index for diffing in newTokens.
	 * @param newEnd - The end index (exclusive) for diffing in newTokens.
	 * @param idToString - A map to convert token IDs back to strings.
	 * @param config - The fully resolved diff configuration.
	 * @param debug - A flag to enable verbose logging.
	 * @returns An array of DiffResult tuples.
	 * @private
     */
	private _strategycommonSES(
        engine: MyersCoreDiff, // engine parameter is convention, 'this' is used internally
        oldTokens: Uint32Array, oldStart: number, oldEnd: number,
        newTokens: Uint32Array, newStart: number, newEnd: number,
        idToString: string[],
        config: Required<DiffOptions>, // Config includes preservePositions
        debug: boolean
    ): DiffResult[] {

        if (__DEV__ && debug) {
            console.group(`[Strategy 'commonSES' v1 LOGIC] START old[${oldStart},${oldEnd}) new[${newStart},${newEnd})`);
            console.log(`Config:`, config);
        }

        const lakeSize = (oldEnd - oldStart) + (newEnd - newStart);

        // --- Anchor Finding (Logic from v1 diff) ---
        let anchors: Anchor[] = [];
        if (config.useAnchors && lakeSize > config.quickDiffThreshold) {
            // Use 'this' (engine instance) to call toolbox methods
            const foundAnchors = this._findAnchors(
                oldTokens, oldStart, oldEnd,
                newTokens, newStart, newEnd,
                config, debug
            );

            // Filter anchors (Logic from v1 diff)
            anchors = this._mergeAndFilterAnchors(foundAnchors, config, debug);

            if (anchors.length === 0 && __DEV__ && debug) {
                console.log(`[Strategy 'commonSES' v1 LOGIC] No valid anchor chain found - falling back to pure diff`);
            }
        }

        let body: DiffResult[] = [];

        // --- Branching Logic (Logic from v1 diff) ---
        if (anchors.length > 0) {
            // Use anchors path
             if (__DEV__ && debug) {
                 console.log(`[Strategy 'commonSES' v1 LOGIC] Using anchors path (_processWithAnchors)`);
             }
            body = this._processWithAnchors( // Use 'this'
                oldTokens, oldStart, oldEnd,
                newTokens, newStart, newEnd,
                anchors, idToString, config, debug, 0 // depth=0
            );
        } else {
            // Pure diff path (no anchors)
            if (config.preservePositions) {
                // Use stable diff path
                if (__DEV__ && debug) {
                    console.log(`[Strategy 'commonSES' v1 LOGIC] No anchors, using stable diff path (_calculateStableDiff)`);
                }
                body = this._calculateStableDiff( // Use 'this'
                    oldTokens, oldStart, oldEnd,
                    newTokens, newStart, newEnd,
                    idToString, config, debug
                );
            } else {
                // Use recursive SES path
                 if (__DEV__ && debug) {
                     console.log(`[Strategy 'commonSES' v1 LOGIC] No anchors, using recursive SES path (_recursiveDiff)`);
                 }
                body = this._recursiveDiff( // Use 'this'
                    oldTokens, oldStart, oldEnd,
                    newTokens, newStart, newEnd,
                    idToString, config, debug
                );
            }
        }

        if (__DEV__ && debug) {
            console.log(`[Strategy 'commonSES' v1 LOGIC] END. Body length: ${body.length}`);
            console.groupEnd();
        }
        return body;
    }

	/**
	 * [TOOLBOX] Finds anchors (significant matching blocks) between old and new token sequences.
	 * These anchors help guide the diffing process by identifying stable regions.
	 *
	 * @param oldTokens - The original array of token IDs.
	 * @param oldStart - The starting index in the oldTokens array.
	 * @param oldEnd - The ending index (exclusive) in the oldTokens array.
	 * @param newTokens - The new array of token IDs.
	 * @param newStart - The starting index in the newTokens array.
	 * @param newEnd - The ending index (exclusive) in the newTokens array.
	 * @param config - The diff options configuration.
	 * @param debug - Enables verbose logging for debugging purposes.
	 * @returns An array of Anchor objects representing the found anchors.
	 * @public
	 */
	public _findAnchors(
        oldTokens: Uint32Array, oldStart: number, oldEnd: number,
        newTokens: Uint32Array, newStart: number, newEnd: number,
        config: Required<DiffOptions>, 
        debug: boolean
    ): Anchor[] {
        // --- Settings and Preparation ---
        const anchorSearchMode = config.anchorSearchMode ?? 'combo'; // Filtration mode
        const maxDrift = config.positionalAnchorMaxDrift; // Positional anchor drifting limit
        const { jumpStep, huntChunkSize, minMatchLength, minAnchorConfidence } = config; //Search params

        if (__DEV__ && debug) {
            console.log(`\n--- [_findAnchors v6.4 START with FILTERING] ---`);
            console.log(`Filter Mode: ${anchorSearchMode}, PositionalMaxDrift: ${maxDrift}`);
            console.log(`Search Params: jump=${jumpStep}, chunk=${huntChunkSize}, minLen=${minMatchLength}, minConf=${minAnchorConfidence}`);
            console.log(`Lake: old[${oldStart}, ${oldEnd}) new[${newStart}, ${newEnd})`);
        }

        const lakeOldLen = oldEnd - oldStart;
        const lakeNewLen = newEnd - newStart;

        // Auto shutoff for small lakes
        if (lakeOldLen + lakeNewLen < config.quickDiffThreshold) {
            if (__DEV__ && debug) console.log(`[_findAnchors] Skipping - lake too small (${lakeOldLen + lakeNewLen} < ${config.quickDiffThreshold}).`);
            return [];
        }
        // Search parameter validation check
        if (huntChunkSize <= 0 || minMatchLength < huntChunkSize) {
             if (__DEV__ && debug) console.log(`[_findAnchors] Skipping - invalid params (huntChunkSize=${huntChunkSize}, minMatchLength=${minMatchLength}).`);
             return [];
        }

        const anchors: Anchor[] = []; // Array for collecting ALL found anchors
        const usedNewPos = new Uint8Array(newTokens.length); // Unified mask for newTokens

        // --- Main Search (Rolling Hash + Hunting) --
        const newHashes = new Map<number, { pos: number }[]>();
        const rh = new RollingHash(new Uint32Array(0), 0);
        const newLen = newEnd - newStart;

        // Building a hash table for newTokens
        if (newLen >= huntChunkSize) {
            for (let i = 0; i <= newLen - huntChunkSize; i += 1) {
                const pos = newStart + i;
                const slice = newTokens.subarray(pos, pos + huntChunkSize);
                let hash = 0;
                for (let k = 0; k < slice.length; k++) hash = (hash * rh['P'] + slice[k]) % rh['M'];
                if (!newHashes.has(hash)) newHashes.set(hash, []);
                newHashes.get(hash)!.push({ pos });
            }
        }

        if (newHashes.size === 0) {
             if (__DEV__ && debug) console.log(`[_findAnchors] Hash map empty. No potential anchors.`);
        } else {
             if (__DEV__ && debug) console.log(`[_findAnchors] Built hash map with ${newHashes.size} unique chunks. Searching old tokens...`);

            for (let i = 0; i <= lakeOldLen - huntChunkSize; i += jumpStep) {
                const oldPos = oldStart + i;
                const slice = oldTokens.subarray(oldPos, oldPos + huntChunkSize);
                let hash = 0;
                for (let k = 0; k < slice.length; k++) hash = (hash * rh['P'] + slice[k]) % rh['M'];
                const potentialStarts = newHashes.get(hash);
                if (!potentialStarts) continue;

                for (const start of potentialStarts) {
                    if (usedNewPos[start.pos]) continue;

                    // --- Hunting ---
                    const foundFragments: { oldPos: number; newPos: number }[] = [{ oldPos, newPos: start.pos }];
                    let currentHuntOldPos = oldPos + huntChunkSize;
                    const maxHuntJumps = 10;
                    let successfulHunts = 1;
                    for (let chunkNum = 1; chunkNum * huntChunkSize < minMatchLength; chunkNum++) {
                        let chunkFound = false;
                        const lastFragment = foundFragments[foundFragments.length - 1];
                        for (let j = 0; j < maxHuntJumps; j++) {
                            const nextOldPos = currentHuntOldPos + j * jumpStep;
                            if (nextOldPos + huntChunkSize > oldEnd) break;
                            const nextSlice = oldTokens.subarray(nextOldPos, nextOldPos + huntChunkSize);
                            let nextHash = 0;
                            for (let k = 0; k < nextSlice.length; k++) nextHash = (nextHash * rh['P'] + nextSlice[k]) % rh['M'];
                            const potentialMatches = newHashes.get(nextHash);
                            if (potentialMatches) {
                                for (const match of potentialMatches) {
                                    if (match.pos > lastFragment.newPos && !usedNewPos[match.pos]) {
                                        foundFragments.push({ oldPos: nextOldPos, newPos: match.pos });
                                        currentHuntOldPos = nextOldPos + huntChunkSize;
                                        chunkFound = true; successfulHunts++;
                                        break;
                                    }
                                }
                            }
                            if (chunkFound) break;
                        }
                        if (!chunkFound) break;
                    } 

                    const huntConfidence = (successfulHunts * huntChunkSize) / minMatchLength;

                    // --- Verification and Expansion ---
                    if (huntConfidence >= minAnchorConfidence) {
                        const firstFrag = foundFragments[0];
                        let finalLength = 0;
                        const scanOldStart = firstFrag.oldPos;
                        const scanNewStart = firstFrag.newPos;
                        // Expand while matching and not occupied in new
                        while (
                            scanOldStart + finalLength < oldEnd &&
                            scanNewStart + finalLength < newEnd &&
                            !usedNewPos[scanNewStart + finalLength] && // Check mask during expansion
                            oldTokens[scanOldStart + finalLength] === newTokens[scanNewStart + finalLength]
                        ) {
                            finalLength++;
                        }

                        // --- Anchor Creation ---
                        if (finalLength >= minMatchLength) {
                            const driftDistance = Math.abs(scanNewStart - scanOldStart);
                            const driftRatio = finalLength > 0 ? driftDistance / finalLength : 0;
                            // Anchor confidence calculation 
                            const maxExpectedDrift = Math.max(100, Math.min(lakeOldLen, lakeNewLen) * 0.1);
                            const driftConf = Math.max(0, 1.0 - (driftDistance / maxExpectedDrift)); // Using Math.max for >= 0
                            const lengthConf = Math.min(1.0, finalLength / (minMatchLength * 2));
                            const anchorConfidence = (driftConf * 0.3 + lengthConf * 0.7); // Final confidence

                            // Add anchor to the common list
                            const anchor: Anchor = {
                                oldPos: scanOldStart, newPos: scanNewStart, length: finalLength,
                                confidence: anchorConfidence, driftDistance, driftRatio
                            };
                            anchors.push(anchor);

                            // Mark used positions in new
                            for (let k = 0; k < finalLength; k++) {
                                if (scanNewStart + k < newTokens.length) usedNewPos[scanNewStart + k] = 1;
                            }
                            // Skip found block in old
                            i = (scanOldStart - oldStart) + finalLength - jumpStep;
                             if (__DEV__ && debug) console.log(`  -> ANCHOR FOUND: old=${scanOldStart}, new=${scanNewStart}, len=${finalLength}, drift=${driftDistance}, conf=${anchorConfidence.toFixed(2)}. Jumping i to ${i + jumpStep}`);
                            break; // Break search for current oldPos since anchor was found
						} // --- End of Anchor Creation ---
                    } // --- End of Verification ---
                } // end loop potentialStarts
            } // end loop oldTokens
        } // --- End of Main Search ---

        if (__DEV__ && debug) console.log(`[_findAnchors] Initial search found ${anchors.length} raw anchors.`);

       	// --- Filtering by Type (anchorSearchMode) ---
        let filteredByTypeAnchors: Anchor[];
        if (anchorSearchMode === 'positional') {
            filteredByTypeAnchors = anchors.filter(a => a.driftDistance <= maxDrift);
            if (__DEV__ && debug) console.log(`  Filtered for 'positional' (drift <= ${maxDrift}): ${filteredByTypeAnchors.length} anchors remaining.`);
        } else if (anchorSearchMode === 'floating') {
            filteredByTypeAnchors = anchors.filter(a => a.driftDistance > maxDrift);
             if (__DEV__ && debug) console.log(`  Filtered for 'floating' (drift > ${maxDrift}): ${filteredByTypeAnchors.length} anchors remaining.`);
        } else { // 'combo' or default
            filteredByTypeAnchors = anchors;
             if (__DEV__ && debug) console.log(`  Mode 'combo', using all ${filteredByTypeAnchors.length} anchors for confidence check.`);
        }

        // --- Final Filtering by Confidence ---
        const finalAnchors = filteredByTypeAnchors.filter(anchor => anchor.confidence >= minAnchorConfidence);

        if (__DEV__ && debug) {
            console.log(`  Filtered by confidence >= ${minAnchorConfidence}: ${finalAnchors.length} anchors remaining.`);
            console.log(`--- [_findAnchors v6.4 END] Returning ${finalAnchors.length} anchors ---`);
        }

        return finalAnchors; // Return anchors filtered by type AND by confidence
    }


	/**
	 * [TOOLBOX] Merges anchors, filters conflicts, and sorts them
	 * to produce a final, monotonic chain (Longest Common Subsequence of anchors).
	 *
	 * @param anchors - The raw array of anchors found by `_findAnchors`.
	 * @param config - The diff options configuration.
	 * @param debug - Enables verbose logging for debugging purposes.
	 * @returns A sorted and filtered array of Anchors forming a valid chain.
	 * @public
	 */
	public _mergeAndFilterAnchors(
		anchors: Anchor[],
		config: Required<DiffOptions>,
		debug: boolean
	): Anchor[] {
		if (__DEV__ && debug) {
			console.log(`\n--- [_mergeAndFilterAnchors START] ---`);
			console.log(`Input anchors: ${anchors.length}`);
		}

		if (anchors.length === 0) return [];

		// Sort by oldPos
		anchors.sort((a, b) => a.oldPos - b.oldPos);

		const n = anchors.length;
		const dp = new Array(n).fill(0);
		const prev = new Array(n).fill(-1);

		// Dynamic programming to find the optimal chain
		for (let i = 0; i < n; i++) {
			const anchorI = anchors[i];
			dp[i] = anchorI.length;

			for (let j = 0; j < i; j++) {
				const anchorJ = anchors[j];

				// CRITICALLY IMPORTANT: check that there are no negative lakes
				const noOverlap = (anchorI.oldPos >= anchorJ.oldPos + anchorJ.length) &&
					(anchorI.newPos >= anchorJ.newPos + anchorJ.length);

				if (noOverlap) {
					// Additional monotonicity check
					const monotoneInOld = anchorI.oldPos > anchorJ.oldPos;
					const monotoneInNew = anchorI.newPos > anchorJ.newPos;

					if (monotoneInOld || monotoneInNew) {
						if (dp[j] + anchorI.length > dp[i]) {
							dp[i] = dp[j] + anchorI.length;
							prev[i] = j;
						}
					}
				}
			}
		}

		// Reconstruct the optimal chain
		let bestChainEndIndex = 0;
		for (let i = 1; i < n; i++) {
			if (dp[i] > dp[bestChainEndIndex]) {
				bestChainEndIndex = i;
			}
		}

		const optimalChain: Anchor[] = [];
		let currentIndex = bestChainEndIndex;
		while (currentIndex !== -1) {
			optimalChain.push(anchors[currentIndex]);
			currentIndex = prev[currentIndex];
		}
		optimalChain.reverse();

		// VALIDATION: check that the chain does not create negative la
		for (let i = 1; i < optimalChain.length; i++) {
			const prevAnchor = optimalChain[i - 1];
			const currAnchor = optimalChain[i];

			const gapOld = currAnchor.oldPos - (prevAnchor.oldPos + prevAnchor.length);
			const gapNew = currAnchor.newPos - (prevAnchor.newPos + prevAnchor.length);

			if (gapOld < 0 || gapNew < 0) {
				if (__DEV__ && debug) {
					console.error(`❌ INVALID CHAIN: Negative gap detected between anchors`);
					console.error(`   Anchor ${i - 1}: old[${prevAnchor.oldPos}, ${prevAnchor.oldPos + prevAnchor.length}) new[${prevAnchor.newPos}, ${prevAnchor.newPos + prevAnchor.length})`);
					console.error(`   Anchor ${i}: old[${currAnchor.oldPos}, ${currAnchor.oldPos + currAnchor.length}) new[${currAnchor.newPos}, ${currAnchor.newPos + currAnchor.length})`);
					console.error(`   Gaps: old=${gapOld}, new=${gapNew}`);
				}
				// In case of a problem, return an empty chain - better no anchors than an error
				return [];
			}
		}

		if (__DEV__ && debug) {
			console.log(`--- [_mergeAndFilterAnchors END] Optimal chain: ${optimalChain.length} anchors ---\n`);
		}

		return optimalChain;
	}


	/**
	 * [TOOLBOX] Processes the diff by iterating through the anchor chain
	 * and calling `_processGap` for regions between them.
	 *
	 * @param oldTokens - The tokenized 'old' sequence.
	 * @param oldStart - The start index for diffing in oldTokens.
	 * @param oldEnd - The end index (exclusive) for diffing in oldTokens.
	 * @param newTokens - The tokenized 'new' sequence.
	 * @param newStart - The start index for diffing in newTokens.
	 * @param newEnd - The end index (exclusive) for diffing in newTokens.
	 * @param anchors - The sorted and filtered chain of anchors.
	 * @param idToString - A map to convert token IDs back to strings.
	 * @param config - The fully resolved diff configuration.
	 * @param debug - A flag to enable verbose logging.
	 * @param depth - Recursion depth, for debugging.
	 * @returns An array of DiffResult tuples.
	 * @public
	 */
	public _processWithAnchors(
		oldTokens: Uint32Array, oldStart: number, oldEnd: number,
		newTokens: Uint32Array, newStart: number, newEnd: number,
		anchors: Anchor[],
		idToString: string[],
		config: Required<DiffOptions>,
		debug: boolean,
		depth: number = 0
	): DiffResult[] {
		if (__DEV__ && debug) {
			console.log('--- [_processWithAnchors START] ---');
			console.group(`[Phase 2] _processWithAnchors (depth=${depth})`);
			console.log(`Input ranges: old [${oldStart}, ${oldEnd}) | new [${newStart}, ${newEnd})`);
			console.log(`Anchors count: ${anchors.length}`);
			console.log(`Config:`, config);

			const oldSegment = Array.from(oldTokens.slice(oldStart, oldEnd)).map(id => idToString[id]);
			const newSegment = Array.from(newTokens.slice(newStart, newEnd)).map(id => idToString[id]);
			console.log(`Old segment tokens:`, oldSegment);
			console.log(`New segment tokens:`, newSegment);
		}

		if (oldStart > oldEnd || newStart > newEnd) {
			console.error(`❌ INVALID RANGES in _processWithAnchors: old[${oldStart}, ${oldEnd}) new[${newStart}, ${newEnd})`);
			return this._processGap(
				{ oldStart, oldEnd, newStart, newEnd },
				oldTokens, newTokens, idToString, config, debug
			);
		}

		if (anchors.length === 0) {
			if (__DEV__ && debug) {
				console.log(`[Phase 2] No anchors found — delegating to _processGap`);
				console.groupEnd();
			}
			return this._processGap(
				{ oldStart, oldEnd, newStart, newEnd },
				oldTokens, newTokens,
				idToString, config, debug
			);
		}

		const result: DiffResult[] = [];
		let currentOldPos = oldStart;
		let currentNewPos = newStart;

		for (let index = 0; index < anchors.length; index++) {
			const anchor = anchors[index];
			if (__DEV__ && debug) {
				console.group(`[Anchor ${index}] oldPos=${anchor.oldPos}, newPos=${anchor.newPos}, length=${anchor.length}`);
			}

			// Process gap before anchor if any
			if (anchor.oldPos > currentOldPos || anchor.newPos > currentNewPos) {
				if (__DEV__ && debug) {
					console.log(`[Anchor ${index}] Detected gap before anchor.`);
				}
				const gapResult = this._processGap(
					{
						oldStart: currentOldPos, oldEnd: anchor.oldPos,
						newStart: currentNewPos, newEnd: anchor.newPos
					},
					oldTokens, newTokens, idToString, config, debug
				);
				if (__DEV__ && debug) {
					console.log(`[Anchor ${index}] Gap result:`, gapResult);
				}
				for (let i = 0; i < gapResult.length; i++) {
					result.push(gapResult[i]);
				}
			}

			// Add anchor equal sequence
			const equalTokens: string[] = [];
			for (let j = 0; j < anchor.length; j++) {
				const tokenStr = idToString[oldTokens[anchor.oldPos + j]];
				equalTokens.push(tokenStr);
				result.push([DiffOperation.EQUAL, tokenStr]);
			}
			if (__DEV__ && debug) {
				console.log(`[Anchor ${index}] Equal sequence:`, equalTokens);
			}

			currentOldPos = anchor.oldPos + anchor.length;
			currentNewPos = anchor.newPos + anchor.length;

			if (__DEV__ && debug) {
				console.groupEnd();
			}
		}

		// Handle trailing gap after last anchor
		if (currentOldPos < oldEnd || currentNewPos < newEnd) {
			if (__DEV__ && debug) {
				console.group(`[Final gap] old [${currentOldPos}, ${oldEnd}), new [${currentNewPos}, ${newEnd})`);
			}
			const finalGapResult = this._processGap(
				{
					oldStart: currentOldPos, oldEnd: oldEnd,
					newStart: currentNewPos, newEnd: newEnd
				},
				oldTokens, newTokens, idToString, config, debug
			);
			if (__DEV__ && debug) {
				console.log(`[Final gap] Result:`, finalGapResult);
				console.groupEnd();
			}
			for (let i = 0; i < finalGapResult.length; i++) {
				result.push(finalGapResult[i]);
			}
		}

		if (__DEV__ && debug) {
			console.log(`[Phase 2] Final diff result:`, result);
			console.groupEnd();
		}

		return result;
	}


	/**
	 * [TOOLBOX] A dispatcher that chooses the appropriate diffing strategy
	 * for a gap, optimized for 'commonSES' (SES).
	 *
	 * @param gap - The GapInfo object defining the region to diff.
	 * @param oldTokens - The tokenized 'old' sequence.
	 * @param newTokens - The tokenized 'new' sequence.
	 * @param idToString - A map to convert token IDs back to strings.
	 * @param config - The fully resolved diff configuration.
	 * @param debug - A flag to enable verbose logging.
	 * @returns An array of DiffResult tuples.
	 * @public
	 */
	public _processGap(
		gap: GapInfo,
		oldTokens: Uint32Array,
		newTokens: Uint32Array,
		idToString: string[],
		config: Required<DiffOptions>,
		debug: boolean
	): DiffResult[] {
		const gapOldLen = gap.oldEnd - gap.oldStart;
		const gapNewLen = gap.newEnd - gap.newStart;
		const gapSize = gapOldLen + gapNewLen;

		if (__DEV__ && debug) {
			console.log(`[_processGap] Processing gap. size=${gapSize} (old=${gapOldLen}, new=${gapNewLen})`);
		}

		if (gapSize === 0) {
			return [];
		}

		const sizeRatio = gapOldLen > 0 && gapNewLen > 0
			? Math.max(gapOldLen / gapNewLen, gapNewLen / gapOldLen)
			: 0;

		if (sizeRatio > 100 && gapSize > 500) {
			if (__DEV__ && debug) {
				console.log(`[_processGap] Absurd case detected. Using simple add/remove.`);
			}
			const deletions = this._createDeletions(oldTokens, gap.oldStart, gap.oldEnd, idToString);
			const additions = this._createAdditions(newTokens, gap.newStart, gap.newEnd, idToString);
			deletions.push.apply(deletions, additions);
			return deletions;
		}

		if (gapSize > config.hugeDiffThreshold) {
			if (__DEV__ && debug) {
				console.log(`[_processGap] Gap size is huge (${gapSize}), falling back to guided diff for performance.`);
			}
			return this._guidedCalculateDiff(
				oldTokens, gap.oldStart, gap.oldEnd,
				newTokens, gap.newStart, gap.newEnd,
				idToString, config, debug
			);
		}

		if (__DEV__ && debug) {
			console.log(`[_processGap] Gap size is manageable (${gapSize}), using precise recursive Myers diff.`);
		}
		return this._recursiveDiff(
			oldTokens, gap.oldStart, gap.oldEnd,
			newTokens, gap.newStart, gap.newEnd,
			idToString, config, debug
		);
	}

	/**
	 * [TOOLBOX] The core recursive implementation of the Myers diff algorithm
	 * with the "middle snake" optimization (SES).
	 *
	 * @param oldTokens - The tokenized 'old' sequence.
	 * @param oldStart - The start index for diffing in oldTokens.
	 * @param oldEnd - The end index (exclusive) for diffing in oldTokens.
	 * @param newTokens - The tokenized 'new' sequence.
	 * @param newStart - The start index for diffing in newTokens.
	 * @param newEnd - The end index (exclusive) for diffing in newTokens.
	 * @param idToString - A map to convert token IDs back to strings.
	 * @param config - The fully resolved diff configuration.
	 * @param debug - A flag to enable verbose logging.
	 * @returns An array of DiffResult tuples.
	 * @public
	 */
	public _recursiveDiff(
		oldTokens: Uint32Array, oldStart: number, oldEnd: number,
		newTokens: Uint32Array, newStart: number, newEnd: number,
		idToString: string[],
		config: Required<DiffOptions>,
		debug: boolean
	): DiffResult[] {
		if (__DEV__ && debug) {
			console.group(`[recursiveDiff] START old[${oldStart}, ${oldEnd}) new[${newStart}, ${newEnd})`);
		}

		const oldLen = oldEnd - oldStart;
		const newLen = newEnd - newStart;

		if (oldLen < 0 || newLen < 0) {
			if (__DEV__ && debug) {
				console.error(`[recursiveDiff] ❌ NEGATIVE LENGTH at entry! oldLen=${oldLen}, newLen=${newLen}`);
				console.error(`  oldStart=${oldStart}, oldEnd=${oldEnd}, newStart=${newStart}, newEnd=${newEnd}`);
			}
			throw new Error(`Negative length detected at recursiveDiff entry`);
		}

		if (oldLen === 0 && newLen === 0) {
			if (__DEV__ && debug) console.groupEnd();
			return [];
		}
		if (oldLen === 0) {
			if (__DEV__ && debug) console.log(`[recursiveDiff] Old length = 0 → ADDITIONS`);
			const res = this._createAdditions(newTokens, newStart, newEnd, idToString);
			if (__DEV__ && debug) {
				console.log(`[recursiveDiff] Additions result:`, res);
				console.groupEnd();
			}
			return res;
		}
		if (newLen === 0) {
			if (__DEV__ && debug) console.log(`[recursiveDiff] New length = 0 → DELETIONS`);
			const res = this._createDeletions(oldTokens, oldStart, oldEnd, idToString);
			if (__DEV__ && debug) {
				console.log(`[recursiveDiff] Deletions result:`, res);
				console.groupEnd();
			}
			return res;
		}

		if ((oldLen + newLen) < config.quickDiffThreshold) {
			if (__DEV__ && debug) {
				console.log(`[recursiveDiff] Using quick diff: (oldLen+newLen)=${oldLen + newLen} < ${config.quickDiffThreshold}`);
			}
			const res = this.calculateDiff(
				oldTokens, oldStart, oldEnd,
				newTokens, newStart, newEnd,
				idToString, config, debug
			);
			if (__DEV__ && debug) {
				console.log(`[recursiveDiff] Quick diff result:`, res);
				console.groupEnd();
			}
			return res;
		}

		// --- FIND MIDDLE SNAKE ---
		const snake = this._findMiddleSnake(oldTokens, oldStart, oldEnd, newTokens, newStart, newEnd, debug);

		if (__DEV__ && debug) {
			console.log(`[recursiveDiff] Middle snake:`, snake);
		}

		if (!snake || snake.u - snake.x <= 0) {
			if (__DEV__ && debug) {
				console.warn(`[recursiveDiff] Middle snake failed, falling back to _guidedCalculateDiff`);
			}
			const res = this._guidedCalculateDiff(
				oldTokens, oldStart, oldEnd,
				newTokens, newStart, newEnd,
				idToString, config, debug
			);

			// alternative solution
			// const res = this.calculateDiff(
			// 	oldTokens, oldStart, oldEnd,
			// 	newTokens, newStart, newEnd,
			// 	idToString, config, debug
			// );

			if (__DEV__ && debug) {
				console.log(`[recursiveDiff] Fallback result:`, res);
				console.groupEnd();
			}
			return res;
		}

		const snakeLen = snake.u - snake.x;

		// --- VALIDATE SNAKE ---
		for (let i = 0; i < snakeLen; i++) {
			const oldVal = oldTokens[oldStart + snake.x + i];
			const newVal = newTokens[newStart + snake.y + i];
			if (oldVal !== newVal) {
				if (__DEV__ && debug) {
					console.error(`  ⚠️ [recursiveDiff] SNAKE VALIDATION FAILED at i=${i}`);
					console.error(`    oldVal=${oldVal}(${idToString[oldVal]}), newVal=${newVal}(${idToString[newVal]})`);
				}
				const res = this.calculateDiff(
					oldTokens, oldStart, oldEnd,
					newTokens, newStart, newEnd,
					idToString, config, debug
				);
				if (__DEV__ && debug) {
					console.log(`[recursiveDiff] Fallback due to snake validation result:`, res);
					console.groupEnd();
				}
				return res;
			}
		}

		// --- RECURSION PART 1 ---
		const leftOldStart = oldStart;
		const leftOldEnd = oldStart + snake.x;
		const leftNewStart = newStart;
		const leftNewEnd = newStart + snake.y;

		if (leftOldEnd - leftOldStart < 0 || leftNewEnd - leftNewStart < 0) {
			if (__DEV__ && debug) {
				console.error(`[recursiveDiff] ❌ NEGATIVE LENGTH in LEFT part`);
				console.error(`  old [${leftOldStart}, ${leftOldEnd}), new [${leftNewStart}, ${leftNewEnd})`);
			}
			throw new Error(`Negative length detected in left recursive part`);
		}

		if (__DEV__ && debug) {
			console.log(`[recursiveDiff] → Left recursion old[${leftOldStart}, ${leftOldEnd}) new[${leftNewStart}, ${leftNewEnd})`);
		}

		const part1 = this._recursiveDiff(
			oldTokens, leftOldStart, leftOldEnd,
			newTokens, leftNewStart, leftNewEnd,
			idToString, config, debug
		);

		// --- SNAKE PART ---
		const snakePart = new Array<DiffResult>(snakeLen);
		for (let i = 0; i < snakeLen; i++) {
			snakePart[i] = [DiffOperation.EQUAL, idToString[oldTokens[oldStart + snake.x + i]]];
		}
		if (__DEV__ && debug) {
			console.log(`[recursiveDiff] Snake part length=${snakeLen}`);
		}

		// --- RECURSION PART 2 ---
		const rightOldStart = oldStart + snake.u;
		const rightOldEnd = oldEnd;
		const rightNewStart = newStart + snake.v;
		const rightNewEnd = newEnd;

		if (rightOldEnd - rightOldStart < 0 || rightNewEnd - rightNewStart < 0) {
			if (__DEV__ && debug) {
				console.error(`[recursiveDiff] ❌ NEGATIVE LENGTH in RIGHT part`);
				console.error(`  old [${rightOldStart}, ${rightOldEnd}), new [${rightNewStart}, ${rightNewEnd})`);
			}
			throw new Error(`Negative length detected in right recursive part`);
		}

		if (__DEV__ && debug) {
			console.log(`[recursiveDiff] → Right recursion old[${rightOldStart}, ${rightOldEnd}) new[${rightNewStart}, ${rightNewEnd})`);
		}

		const part2 = this._recursiveDiff(
			oldTokens, rightOldStart, rightOldEnd,
			newTokens, rightNewStart, rightNewEnd,
			idToString, config, debug
		);

		const result = part1.concat(snakePart, part2);

		if (__DEV__ && debug) {
			console.log(`[recursiveDiff] RETURN result length=${result.length}`);
			console.groupEnd();
		}

		return result;
	}


	/**
	 * [TOOLBOX] Finds the "middle snake" for linear-memory Myers.
	 */
	private forwardBuffer = new Int32Array(0);
	private backwardBuffer = new Int32Array(0);

	/**
	 * Validates that the input ranges (start/end indices) are sane
	 * and within the bounds of the token arrays.
	 *
	 * @param oldTokens - The 'old' token array.
	 * @param oldStart - The start index for the 'old' range.
	 * @param oldEnd - The end index (exclusive) for the 'old' range.
	 * @param newTokens - The 'new' token array.
	 * @param newStart - The start index for the 'new' range.
	 * @param newEnd - The end index (exclusive) for the 'new' range.
	 * @returns `true` if the ranges are valid, `false` otherwise.
	 * @private
	 */
	private _validateInputs(
		oldTokens: Uint32Array, oldStart: number, oldEnd: number,
		newTokens: Uint32Array, newStart: number, newEnd: number
	): boolean {
		if (oldStart < 0 || oldEnd < oldStart || oldEnd > oldTokens.length) return false;
		if (newStart < 0 || newEnd < newStart || newEnd > newTokens.length) return false;
		return true;
	}


	/**
	 * [TOOLBOX] Finds the "middle snake" for linear-memory Myers.
	 *
	 * @param oldTokens - The tokenized 'old' sequence.
	 * @param oldStart - The start index for diffing in oldTokens.
	 * @param oldEnd - The end index (exclusive) for diffing in oldTokens.
	 * @param newTokens - The tokenized 'new' sequence.
	 * @param newStart - The start index for diffing in newTokens.
	 * @param newEnd - The end index (exclusive) for diffing in newTokens.
	 * @param debug - A flag to enable verbose logging.
	 * @returns A MiddleSnake object, or undefined if no overlap is found.
	 * @public
	 */
	public _findMiddleSnake(
		oldTokens: Uint32Array, oldStart: number, oldEnd: number,
		newTokens: Uint32Array, newStart: number, newEnd: number,
		debug: boolean
	): MiddleSnake | undefined {
		if (__DEV__ && debug) {
			console.log('[findMiddleSnake] START');
		}
		if (!this._validateInputs(oldTokens, oldStart, oldEnd, newTokens, newStart, newEnd)) {
			if (__DEV__ && debug) console.error('[findMiddleSnake] ❌ Invalid input ranges');
			return undefined;
		}

		const N = oldEnd - oldStart;
		const M = newEnd - newStart;
		const offset = N + M;
		const requiredSize = 2 * offset + 2;

		if (this.forwardBuffer.length < requiredSize) {
			const newSize = requiredSize * 2;
			this.forwardBuffer = new Int32Array(newSize);
			this.backwardBuffer = new Int32Array(newSize);
		}

		const forwardV = this.forwardBuffer.subarray(0, requiredSize);
		const backwardV = this.backwardBuffer.subarray(0, requiredSize);

		forwardV.fill(0);
		backwardV.fill(0);

		const delta = N - M;
		const isEven = (delta & 1) === 0;

		if (__DEV__ && debug) {
			console.log(`[_findMiddleSnake] N=${N}, M=${M}, delta=${delta}, isEven=${isEven}`);
		}

		const offsetPlus1 = offset + 1;
		forwardV[offsetPlus1] = 0;
		backwardV[offsetPlus1] = 0;

		const maxD = N + M;
		const shouldLogProgress = maxD > 10000;
		const hasProcessStdout = typeof process !== 'undefined' && process.stdout;

		for (let d = 0; d <= maxD; d++) {
			if (__DEV__ && debug) console.log(`\n=== d = ${d} ===`);
			if (shouldLogProgress && d > 0 && (d % 50) === 0 && hasProcessStdout) {
				process.stdout.write(`\r  - Middle snake search progress: ${d} / max ${maxD}`);
			}

			// Forward pass
			for (let k = -d; k <= d; k += 2) {
				const offsetK = offset + k;
				const offsetKMinus1 = offsetK - 1;
				const offsetKPlus1 = offsetK + 1;

				let x: number;
				if (k === -d || (k !== d && forwardV[offsetKMinus1] < forwardV[offsetKPlus1])) {
					x = forwardV[offsetKPlus1];
				} else {
					x = forwardV[offsetKMinus1] + 1;
				}
				let y = x - k;

				const startX = x;
				const startY = y;

				while (x < N && y < M && oldTokens[oldStart + x] === newTokens[newStart + y]) {
					x++;
					y++;
				}
				forwardV[offsetK] = x < N ? x : N;

				if (__DEV__ && debug) {
					console.log(`  FWD k=${k}: start=(${startX},${startY}) -> end=(${x},${y})`);
				}

				if (!isEven) {
					const kBack = k - delta;
					if (kBack >= -(d - 1) && kBack <= d - 1) {
						const x2 = N - backwardV[offset + kBack];
						if (x >= x2) {
							const y2 = x2 - k;
							if (x2 >= 0 && y2 >= 0 && y2 <= M && y >= 0) {
								if (__DEV__ && debug) {
									console.log(`  🟢 ODD OVERLAP FOUND! k=${k}, kBack=${kBack}`);
									console.log(`     Forward end: (${x}, ${y})`);
									console.log(`     Backward start: (${x2}, ${y2})`);
									console.log(`     RETURNING snake: x=${x2}, y=${y2}, u=${x}, v=${y}`);
								}
								return { x: x2, y: y2, u: x, v: y };
							}
						}
					}
				}
			}

			// Backward pass
			for (let k = -d; k <= d; k += 2) {
				const offsetK = offset + k;
				const offsetKMinus1 = offsetK - 1;
				const offsetKPlus1 = offsetK + 1;

				let x2: number;
				if (k === -d || (k !== d && backwardV[offsetKMinus1] < backwardV[offsetKPlus1])) {
					x2 = backwardV[offsetKPlus1];
				} else {
					x2 = backwardV[offsetKMinus1] + 1;
				}
				let y2 = x2 - k;

				const startBackX = x2;
				const startBackY = y2;

				const oldEndMinus1 = oldEnd - 1;
				const newEndMinus1 = newEnd - 1;
				while (x2 < N && y2 < M && oldTokens[oldEndMinus1 - x2] === newTokens[newEndMinus1 - y2]) {
					x2++;
					y2++;
				}
				backwardV[offsetK] = x2 < N ? x2 : N;

				if (__DEV__ && debug) {
					console.log(`  BWD k=${k}: start=(${N - startBackX}, ${M - startBackY}) -> end=(${N - x2}, ${M - y2})`);
					console.log(`     (stored x2=${x2}, y2=${y2})`);
				}

				if (isEven) {
					const kForward = k + delta;
					if (kForward >= -d && kForward <= d) {
						const x1 = forwardV[offset + kForward];
						const u = N - x2;
						if (x1 >= u) {
							const y1 = x1 - kForward;
							const v = M - y2;
							if (u >= 0 && v >= 0 && y1 >= v) {
								if (__DEV__ && debug) {
									console.log(`  🟢 EVEN OVERLAP FOUND! k=${k}, kForward=${kForward}`);
									console.log(`     Forward end: (${x1}, ${y1})`);
									console.log(`     Backward start: (${u}, ${v})`);
									console.log(`     RETURNING snake: x=${u}, y=${v}, u=${x1}, v=${y1}`);
								}
								return { x: u, y: v, u: x1, v: y1 };
							}
						}
					}
				}
			}
		}

		if (__DEV__ && debug) {
			console.log(`[_findMiddleSnake] No snake found. This should not happen.`);
		}
		return undefined;
	}

	/**
	 * [TOOLBOX] A fast, heuristic-based diff algorithm ("corridor diff").
	 * Does not guarantee SES, but stays close to the diagonal.
	 * Used as a fallback for very large or complex gaps.
	 *
	 * @param oldTokens - The tokenized 'old' sequence.
	 * @param oldStart - The start index for diffing in oldTokens.
	 * @param oldEnd - The end index (exclusive) for diffing in oldTokens.
	 * @param newTokens - The tokenized 'new' sequence.
	 * @param newStart - The start index for diffing in newTokens.
	 * @param newEnd - The end index (exclusive) for diffing in newTokens.
	 * @param idToString - A map to convert token IDs back to strings.
	 * @param config - The fully resolved diff configuration.
	 * @param debug - A flag to enable verbose logging.
	 * @returns An array of DiffResult tuples.
	 * @public
	 */
	public _guidedCalculateDiff(
		oldTokens: Uint32Array, oldStart: number, oldEnd: number,
		newTokens: Uint32Array, newStart: number, newEnd: number,
		idToString: string[],

		config: Required<DiffOptions>,
		debug: boolean
	): DiffResult[] {
		if (__DEV__ && debug) {
			console.log('[guidedCalculateDiff] START');
		}

		if (__DEV__ && debug) {
			console.log(`[_guidedCalculateDiff] Started. oldLen=${oldEnd - oldStart}, newLen=${newEnd - newStart}`);
		}

		const oldLen = oldEnd - oldStart;
		const newLen = newEnd - newStart;

		// OPTIMIZATION: For absurdly large differences, use simple delete + add
		const sizeRatio = oldLen > 0 && newLen > 0
			? Math.max(oldLen / newLen, newLen / oldLen)
			: 0;

		if (sizeRatio > 100 && (oldLen + newLen) > 500) {
			if (__DEV__ && debug) {
				console.log(`[_guidedCalculateDiff] Absurd size ratio (${sizeRatio.toFixed(1)}). Using simple add/remove.`);
			}
			const deletions = this._createDeletions(oldTokens, oldStart, oldEnd, idToString);
			const additions = this._createAdditions(newTokens, newStart, newEnd, idToString);
			deletions.push.apply(deletions, additions);
			return deletions;
		}

		const maxSize = oldLen + newLen;
		const operations = new Uint8Array(maxSize);
		const values = new Array<string>(maxSize);
		let resultLength = 0;

		const addOp = (op: DiffOperation, value: string): void => {
			operations[resultLength] = op;
			values[resultLength] = value;
			resultLength++;
		};

		let oldPos = oldStart;
		let newPos = newStart;

		const startDiagonal = newStart - oldStart;

		// OPTIMIZATION: Adaptive corridor width based on size
		const adaptiveCorridorWidth = Math.min(
			config.corridorWidth,
			Math.max(10, Math.floor((oldLen + newLen) / 100))
		);

		// OPTIMIZATION: Adaptive lookahead
		const adaptiveLookahead = Math.min(
			config.lookahead,
			Math.max(5, Math.floor((oldLen + newLen) / 200))
		);

		// OPTIMIZATION: Iteration limit with padding
		const maxIterations = oldLen + newLen + 100;
		let iterations = 0;

		// OPTIMIZATION: Early exit on progress
		let lastProgressIteration = 0;
		let lastOldPos = oldPos;
		let lastNewPos = newPos;
		const stuckThreshold = Math.max(50, Math.floor(maxIterations / 10));

		if (__DEV__ && debug) {
			console.log(`[_guidedCalculateDiff] Adaptive params: corridor=${adaptiveCorridorWidth}, lookahead=${adaptiveLookahead}`);
		}

		while (oldPos < oldEnd || newPos < newEnd) {
			iterations++;

			// Check for stuck loop
			if (iterations - lastProgressIteration > stuckThreshold) {
				if (__DEV__ && debug) {
					console.warn(`[_guidedCalculateDiff] Stuck detected after ${iterations} iterations. Flushing remaining.`);
				}
				while (oldPos < oldEnd) {
					addOp(DiffOperation.REMOVE, idToString[oldTokens[oldPos++]]);
				}
				while (newPos < newEnd) {
					addOp(DiffOperation.ADD, idToString[newTokens[newPos++]]);
				}
				break;
			}

			// Update progress
			if (oldPos > lastOldPos || newPos > lastNewPos) {
				lastProgressIteration = iterations;
				lastOldPos = oldPos;
				lastNewPos = newPos;
			}

			if (iterations > maxIterations) {
				if (__DEV__ && debug) {
					console.error(`[_guidedCalculateDiff] Max iterations ${maxIterations} exceeded!`);
				}
				while (oldPos < oldEnd) {
					addOp(DiffOperation.REMOVE, idToString[oldTokens[oldPos++]]);
				}
				while (newPos < newEnd) {
					addOp(DiffOperation.ADD, idToString[newTokens[newPos++]]);
				}
				break;
			}

			const canRemove = oldPos < oldEnd;
			const canAdd = newPos < newEnd;

			// OPTIMIZATION: Fast path for matches
			if (canRemove && canAdd && oldTokens[oldPos] === newTokens[newPos]) {
				addOp(DiffOperation.EQUAL, idToString[oldTokens[oldPos]]);
				oldPos++;
				newPos++;
				continue;
			}

			if (!canRemove) {
				addOp(DiffOperation.ADD, idToString[newTokens[newPos]]);
				newPos++;
				continue;
			}
			if (!canAdd) {
				addOp(DiffOperation.REMOVE, idToString[oldTokens[oldPos]]);
				oldPos++;
				continue;
			}

			// OPTIMIZATION: Corridor check with adaptive width
			const currentDiagonal = newPos - oldPos;
			const diagonalDistance = Math.abs(currentDiagonal - startDiagonal);

			if (diagonalDistance > adaptiveCorridorWidth) {
				if (currentDiagonal > startDiagonal) {
					addOp(DiffOperation.REMOVE, idToString[oldTokens[oldPos]]);
					oldPos++;
				} else {
					addOp(DiffOperation.ADD, idToString[newTokens[newPos]]);
					newPos++;
				}
				continue;
			}

			const tokenToRemove = oldTokens[oldPos];
			const tokenToAdd = newTokens[newPos];

			// OPTIMIZATION: Lookahead with adaptive size
			let removeTokenFoundInNew = -1;
			const lookaheadNewLimit = Math.min(newEnd, newPos + adaptiveLookahead);
			for (let i = newPos + 1; i < lookaheadNewLimit; i++) {
				if (newTokens[i] === tokenToRemove) {
					removeTokenFoundInNew = i;
					break;
				}
			}

			let addTokenFoundInOld = -1;
			const lookaheadOldLimit = Math.min(oldEnd, oldPos + adaptiveLookahead);
			for (let i = oldPos + 1; i < lookaheadOldLimit; i++) {
				if (oldTokens[i] === tokenToAdd) {
					addTokenFoundInOld = i;
					break;
				}
			}

			// OPTIMIZATION: Improved heuristic choice
			if (removeTokenFoundInNew !== -1 && addTokenFoundInOld === -1) {
				addOp(DiffOperation.ADD, idToString[newTokens[newPos]]);
				newPos++;
				continue;
			}

			if (addTokenFoundInOld !== -1 && removeTokenFoundInNew === -1) {
				addOp(DiffOperation.REMOVE, idToString[oldTokens[oldPos]]);
				oldPos++;
				continue;
			}

			if (removeTokenFoundInNew !== -1 && addTokenFoundInOld !== -1) {
				const distanceToRemove = removeTokenFoundInNew - newPos;
				const distanceToAdd = addTokenFoundInOld - oldPos;

				if (distanceToRemove < distanceToAdd) {
					addOp(DiffOperation.ADD, idToString[newTokens[newPos]]);
					newPos++;
				} else {
					addOp(DiffOperation.REMOVE, idToString[oldTokens[oldPos]]);
					oldPos++;
				}
				continue;
			}

			// OPTIMIZATION: Check token rarity (more efficient)
			const isRemoveTokenRare = this._isTokenRare(tokenToRemove, oldTokens, oldPos, oldEnd, 3);
			const isAddTokenRare = this._isTokenRare(tokenToAdd, newTokens, newPos, newEnd, 3);

			if (isRemoveTokenRare && !isAddTokenRare) {
				addOp(DiffOperation.ADD, idToString[newTokens[newPos]]);
				newPos++;
				continue;
			}

			if (isAddTokenRare && !isRemoveTokenRare) {
				addOp(DiffOperation.REMOVE, idToString[oldTokens[oldPos]]);
				oldPos++;
				continue;
			}

			// OPTIMIZATION: Final heuristic - go along the longer side
			if ((oldEnd - oldPos) > (newEnd - newPos)) {
				addOp(DiffOperation.REMOVE, idToString[oldTokens[oldPos]]);
				oldPos++;
			} else {
				addOp(DiffOperation.ADD, idToString[newTokens[newPos]]);
				newPos++;
			}
		}

		const result: DiffResult[] = new Array(resultLength);
		for (let i = 0; i < resultLength; i++) {
			result[i] = [operations[i], values[i]];
		}

		if (__DEV__ && debug) {
			console.log(`[_guidedCalculateDiff] Completed in ${iterations} iterations. Result length: ${resultLength}`);
		}

		return result;
	}

	/**
	 * [TOOLBOX] The basic (O(ND)) Myers diff algorithm.
	 * Finds the SES. Used for small gaps where recursion is overhead.
	 *
	 * @param oldTokens - The tokenized 'old' sequence.
	 * @param oldStart - The start index for diffing in oldTokens.
	 * @param oldEnd - The end index (exclusive) for diffing in oldTokens.
	 * @param newTokens - The tokenized 'new' sequence.
	 * @param newStart - The start index for diffing in newTokens.
	 * @param newEnd - The end index (exclusive) for diffing in newTokens.
	 * @param idToString - A map to convert token IDs back to strings.
	 * @param config - The fully resolved diff configuration.
	 * @param debug - A flag to enable verbose logging.
	 * @returns An array of DiffResult tuples.
	 * @public
	 */
	public calculateDiff(
		oldTokens: Uint32Array, oldStart: number, oldEnd: number,
		newTokens: Uint32Array, newStart: number, newEnd: number,
		idToString: string[],
		config?: Required<DiffOptions>,
		debug?: boolean
	): DiffResult[] {
		const oldLen = oldEnd - oldStart;
		const newLen = newEnd - newStart;

		if (oldLen === 0) return this._createAdditions(newTokens, newStart, newEnd, idToString);
		if (newLen === 0) return this._createDeletions(oldTokens, oldStart, oldEnd, idToString);

		const max = oldLen + newLen;
		const offset = max;
		const v = new Int32Array(2 * max + 2);
		const trace: Int32Array[] = [];

		v[offset + 1] = 0;

		for (let d = 0; d <= max; d++) {
			trace.push(v.slice());
			for (let k = -d; k <= d; k += 2) {
				const kOffset = k + offset;
				let x: number;
				if (k === -d || (k !== d && v[kOffset - 1] < v[kOffset + 1])) {
					x = v[kOffset + 1]; // move down (insert)
				} else {
					x = v[kOffset - 1] + 1; // move right (delete)
				}
				let y = x - k;

				while (x < oldLen && y < newLen && oldTokens[oldStart + x] === newTokens[newStart + y]) {
					x++;
					y++;
				}
				v[kOffset] = x;
				if (x >= oldLen && y >= newLen) {
					return this.buildValues(trace, oldTokens, oldStart, oldEnd, newTokens, newStart, newEnd, idToString);
				}
			}
		}
		return [];
	}

	/**
	 * [TOOLBOX] (Legacy) A stable diff algorithm that prioritizes
	 * finding positional anchors (L2 anchors).
	 *
	 * @param oldTokens - The tokenized 'old' sequence.
	 * @param oldStart - The start index for diffing in oldTokens.
	 * @param oldEnd - The end index (exclusive) for diffing in oldTokens.
	 * @param newTokens - The tokenized 'new' sequence.
	 * @param newStart - The start index for diffing in newTokens.
	 * @param newEnd - The end index (exclusive) for diffing in newTokens.
	 * @param idToString - A map to convert token IDs back to strings.
	 * @param config - The fully resolved diff configuration.
	 * @param debug - A flag to enable verbose logging.
	 * @returns An array of DiffResult tuples.
	 * @public
	 */
    public _calculateStableDiff(
    		oldTokens: Uint32Array, oldStart: number, oldEnd: number,
		newTokens: Uint32Array, newStart: number, newEnd: number,
		idToString: string[],
		config: Required<DiffOptions>,
		debug: boolean
	): DiffResult[] {
		if (__DEV__ && debug) {
			console.log(`[_calculateStableDiff] START with preservePositions`);
		}

		const result: DiffResult[] = [];
		let oldPos = oldStart;
		let newPos = newStart;

		while (oldPos < oldEnd && newPos < newEnd) {
			if (oldTokens[oldPos] === newTokens[newPos]) {
				// Local match - add EQUAL
				result.push([DiffOperation.EQUAL, idToString[oldTokens[oldPos]]]);
				oldPos++;
				newPos++;
			} else {
				// Found a mismatch - find the next local anchor
				const nextAnchor = this._findNextLocalAnchor(
					oldTokens, oldPos, oldEnd,
					newTokens, newPos, newEnd,
					config.localLookahead || 50, // How far to look
					debug
				);

				const gapOldEnd = nextAnchor?.oldPos ?? oldEnd;
				const gapNewEnd = nextAnchor?.newPos ?? newEnd;

				if (__DEV__ && debug) {
					console.log(`[_calculateStableDiff] Found gap: old[${oldPos}, ${gapOldEnd}) new[${newPos}, ${gapNewEnd})`);
					if (nextAnchor) {
						console.log(`  Next anchor at: old=${nextAnchor.oldPos}, new=${nextAnchor.newPos}`);
					}
				}

				// Process the gap between the current position and the next anchor
				const gapResult = this._processLocalGap(
					oldTokens, oldPos, gapOldEnd,
					newTokens, newPos, gapNewEnd,
					idToString, config, debug
				);
				result.push(...gapResult);

				// Move to the anchor
				if (nextAnchor) {
					oldPos = nextAnchor.oldPos;
					newPos = nextAnchor.newPos;
				} else {
					// Reached the end
					oldPos = oldEnd;
					newPos = newEnd;
				}
			}
		}

		// Process tails
		while (oldPos < oldEnd) {
			result.push([DiffOperation.REMOVE, idToString[oldTokens[oldPos++]]]);
		}
		while (newPos < newEnd) {
			result.push([DiffOperation.ADD, idToString[newTokens[newPos++]]]);
		}

		if (__DEV__ && debug) {
			console.log(`[_calculateStableDiff] END. Result length: ${result.length}`);
		}

		return result;
	}
	
	/**
	 * [TOOLBOX] Finds the next nearby positional anchor (L2 anchor).
	 *
	 * @param oldTokens - The tokenized 'old' sequence.
	 * @param oldStart - The start index for diffing in oldTokens.
	 * @param oldEnd - The end index (exclusive) for diffing in oldTokens.
	 * @param newTokens - The tokenized 'new' sequence.
	 * @param newStart - The start index for diffing in newTokens.
	 * @param newEnd - The end index (exclusive) for diffing in newTokens.
	 * @param lookahead - How far to search for a positional match.
	 * @param debug - A flag to enable verbose logging.
	 * @returns A simple object { oldPos, newPos } or null if no anchor is found.
	 * @public
	 */
	public _findNextLocalAnchor(
		oldTokens: Uint32Array, oldStart: number, oldEnd: number,
		newTokens: Uint32Array, newStart: number, newEnd: number,
		lookahead: number,
		debug: boolean
	): { oldPos: number; newPos: number } | null {
		const maxOldPos = Math.min(oldEnd, oldStart + lookahead);
		const maxNewPos = Math.min(newEnd, newStart + lookahead);

		// Look for the nearest match within lookahead
		for (let offset = 1; offset <= lookahead; offset++) {
			const oldPos = oldStart + offset;
			const newPos = newStart + offset;

			if (oldPos >= oldEnd || newPos >= newEnd) {
				break;
			}

			if (oldTokens[oldPos] === newTokens[newPos]) {
				if (__DEV__ && debug) {
					console.log(`[_findNextLocalAnchor] Found anchor at offset ${offset}: old=${oldPos}, new=${newPos}`);
				}
				return { oldPos, newPos };
			}
		}

		// Look for matches near the diagonal
		for (let radius = 1; radius <= Math.min(lookahead / 2, 10); radius++) {
			for (let delta = -radius; delta <= radius; delta++) {
				const oldPos = oldStart + radius;
				const newPos = newStart + radius + delta;

				if (oldPos < oldEnd && newPos >= newStart && newPos < newEnd) {
					if (oldTokens[oldPos] === newTokens[newPos]) {
						if (__DEV__ && debug) {
							console.log(`[_findNextLocalAnchor] Found diagonal anchor: old=${oldPos}, new=${newPos} (delta=${delta})`);
						}
						return { oldPos, newPos };
					}
				}
			}
		}

		if (__DEV__ && debug) {
			console.log(`[_findNextLocalAnchor] No anchor found within lookahead ${lookahead}`);
		}
		return null;
	}

	/**
	 * [TOOLBOX] (Legacy) Processes a gap for `_calculateStableDiff`.
	 *
	 * @param oldTokens - The tokenized 'old' sequence.
	 * @param oldStart - The start index for diffing in oldTokens.
	 * @param oldEnd - The end index (exclusive) for diffing in oldTokens.
	 * @param newTokens - The tokenized 'new' sequence.
	 * @param newStart - The start index for diffing in newTokens.
	 * @param newEnd - The end index (exclusive) for diffing in newTokens.
	 * @param idToString - A map to convert token IDs back to strings.
	 * @param config - The fully resolved diff configuration.
	 * @param debug - A flag to enable verbose logging.
	 * @returns An array of DiffResult tuples.
	 * @public
	 */
	public _processLocalGap(
		oldTokens: Uint32Array, oldStart: number, oldEnd: number,
		newTokens: Uint32Array, newStart: number, newEnd: number,
		idToString: string[],
		config: Required<DiffOptions>,
		debug: boolean
	): DiffResult[] {
		const gapOldLen = oldEnd - oldStart;
		const gapNewLen = newEnd - newStart;
		const result: DiffResult[] = [];

		if (__DEV__ && debug) {
			console.log(`[_processLocalGap] Processing gap: old[${oldStart}, ${oldEnd}) new[${newStart}, ${newEnd})`);
		}

		// For small gaps use a simple strategy
		if (gapOldLen + gapNewLen < (config.localgap || 10)) {
			// Simply remove the old block and add the new one
			for (let i = oldStart; i < oldEnd; i++) {
				result.push([DiffOperation.REMOVE, idToString[oldTokens[i]]]);
			}
			for (let i = newStart; i < newEnd; i++) {
				result.push([DiffOperation.ADD, idToString[newTokens[i]]]);
			}
		} else {
			// For large gaps use the normal diff
			const gapResult = this.calculateDiff(
				oldTokens, oldStart, oldEnd,
				newTokens, newStart, newEnd,
				idToString, config, debug
			);
			result.push(...gapResult);
		}

		return result;
	}

	// =================================================================
	// INTERNAL (PRIVATE) ENGINE HELPERS
	// (Not part of the "Toolbox" for plugins)
	// =================================================================

	/**
	 * Efficiently finds and separates common prefixes and suffixes from two token arrays.
	 * This preprocessing step reduces the problem size for the main diff algorithm.
	 *
	 * @param oldTokens - The tokenized 'old' sequence.
	 * @param oldStart - The start index for diffing in oldTokens.
	 * @param oldEnd - The end index (exclusive) for diffing in oldTokens.
	 * @param newTokens - The tokenized 'new' sequence.
	 * @param newStart - The start index for diffing in newTokens.
	 * @param newEnd - The end index (exclusive) for diffing in newTokens.
	 * @param idToString - A map to convert token IDs back to strings.
	 * @param debug - A flag to enable verbose logging.
	 * @returns An object containing the prefix/suffix arrays and new trimmed indices.
	 * @private
	 */
	private _trimCommonPrefixSuffix(
		oldTokens: Uint32Array, oldStart: number, oldEnd: number,
		newTokens: Uint32Array, newStart: number, newEnd: number,
		idToString: string[],
		debug?: boolean,
	): {
		prefix: DiffResult[],
		suffix: DiffResult[],
		newOldStart: number,
		newOldEnd: number,
		newNewStart: number,
		newNewEnd: number
	} {
		if (__DEV__ && debug) {
			console.log('_trimCommonPrefixSuffix called:', {
				oldTokens: `${oldStart}-${oldEnd}`,
				newTokens: `${newStart}-${newEnd}`,
				oldLength: oldEnd - oldStart,
				newLength: newEnd - newStart
			});
		}

		const oldLen = oldEnd - oldStart;
		const newLen = newEnd - newStart;

		let prefixLen = 0;
		const minLen = Math.min(oldLen, newLen);
		while (prefixLen < minLen && oldTokens[oldStart + prefixLen] === newTokens[newStart + prefixLen]) {
			prefixLen++;
		}

		let suffixLen = 0;
		const remainingLen = minLen - prefixLen;
		while (suffixLen < remainingLen && oldTokens[oldEnd - 1 - suffixLen] === newTokens[newEnd - 1 - suffixLen]) {
			suffixLen++;
		}

		const prefix: DiffResult[] = new Array(prefixLen);
		for (let i = 0; i < prefixLen; i++) {
			prefix[i] = [DiffOperation.EQUAL, idToString[oldTokens[oldStart + i]]];
		}

		const suffix: DiffResult[] = new Array(suffixLen);
		for (let i = 0; i < suffixLen; i++) {
			suffix[i] = [DiffOperation.EQUAL, idToString[oldTokens[oldEnd - suffixLen + i]]];
		}

		const result = {
			prefix,
			suffix,
			newOldStart: oldStart + prefixLen,
			newOldEnd: oldEnd - suffixLen,
			newNewStart: newStart + prefixLen,
			newNewEnd: newEnd - suffixLen,
		};

		if (__DEV__ && debug) {
			console.log('_trimCommonPrefixSuffix result:', {
				prefixLength: prefixLen,
				suffixLength: suffixLen,
				trimmedOldRange: `${result.newOldStart}-${result.newOldEnd}`,
				trimmedNewRange: `${result.newNewStart}-${result.newNewEnd}`,
				prefix: prefix.map(p => p[1]),
				suffix: suffix.map(s => s[1])
			});
		}

		return result;
	}

	/**
	 * Converts arrays of string tokens into numerical IDs to speed up comparisons.
	 * This is a critical performance optimization, as integer comparisons are much
	 * faster than string comparisons.
	 *
	 * @param oldTokens - Array of 'old' string tokens.
	 * @param newTokens - Array of 'new' string tokens.
	 *V @param debug - A flag to enable verbose logging.
	 * @returns An object containing hashed arrays and the ID-to-string map.
	 * @private
	 */
	private _tokenize(
		oldTokens: string[],
		newTokens: string[],
		debug?: boolean
	): {
		hashedOld: Uint32Array
		hashedNew: Uint32Array
		idToString: string[]
	} {

		if (__DEV__ && debug) {
			console.log(`[_tokenize] Old tokens:`, oldTokens);
			console.log(`[_tokenize] New tokens:`, newTokens);
		}

		const totalTokens = oldTokens.length + newTokens.length;
		const tokenMap = new Map<string, number>();
		const idToString: string[] = [];
		let nextId = 0;

		const hashedOld = new Uint32Array(oldTokens.length);
		const hashedNew = new Uint32Array(newTokens.length);

		for (let i = 0; i < oldTokens.length; i++) {
			const token = oldTokens[i];
			let id = tokenMap.get(token);
			if (id === undefined) {
				id = nextId++;
				tokenMap.set(token, id);
				idToString.push(token);
			}
			hashedOld[i] = id;
		}

		for (let i = 0; i < newTokens.length; i++) {
			const token = newTokens[i];
			let id = tokenMap.get(token);
			if (id === undefined) {
				id = nextId++;
				tokenMap.set(token, id);
				idToString.push(token);
			}
			hashedNew[i] = id;
		}

		if (__DEV__ && debug) {
			console.log(`[_tokenize] Token map:`, Array.from(tokenMap.entries()));
			console.log(`[_tokenize] Hashed ${totalTokens} tokens into ${idToString.length} unique IDs.`);
		}
		return { hashedOld, hashedNew, idToString };
	}

	/**
	 * Helper method to determine if a token is rare within a given range.
	 * This is used as a heuristic in the guided diff algorithm.
	 *
	 * @param token - The token ID to check.
	 * @param tokens - The array to search within.
	 * @param startPos - The start index of the range.
	 * @param endPos - The end index (exclusive) of the range.
	 * @param maxOccurrences - The threshold to be considered "rare".
	 * @param debug - A flag to enable verbose logging.
	 * @returns True if the token count is <= maxOccurrences, false otherwise.
	 * @private
	 */
	private _isTokenRare(
		token: number,
		tokens: Uint32Array,
		startPos: number,
		endPos: number,
		maxOccurrences: number,
		debug?: boolean
	): boolean {
		if (__DEV__ && debug) {
			console.log('_isTokenRare called:', {
				token,
				tokenRange: `${startPos}-${endPos}`,
				rangeLength: endPos - startPos,
				maxOccurrences
			});
		}

		let count = 0;
		for (let i = startPos; i < endPos; i++) {
			if (tokens[i] === token) {
				count++;
				if (count > maxOccurrences) {
					if (__DEV__ && debug) {
						console.log('_isTokenRare result: false (exceeded max occurrences)');
					}
					return false;
				}
			}
		}

		const result = count <= maxOccurrences;

		if (__DEV__ && debug) {
			console.log('_isTokenRare result:', {
				isRare: result,
				actualCount: count
			});
		}

		return result;
	}

	/**
	 * [TOOLBOX] Helper function to create an array of ADD operations.
	 *
	 * @param tokens - The token array to read from.
	 * @param start - The start index.
	 * @param end - The end index (exclusive).
	 * @param idToString - A map to convert token IDs back to strings.
	 * @param debug - A flag to enable verbose logging.
	 * @returns An array of ADD DiffResult tuples.
	 * @public
	 */
	public _createAdditions(
		tokens: Uint32Array,
		start: number,
		end: number,
		idToString: string[],
		debug?: boolean
	): DiffResult[] {
		if (__DEV__ && debug) {
			console.log('_createAdditions called:', {
				range: `${start}-${end}`,
				length: end - start,
				tokens: Array.from(tokens.slice(start, end)).map(t => idToString[t])
			});
		}

		const res = new Array<DiffResult>(end - start);
		for (let i = 0; i < res.length; i++) {
			res[i] = [DiffOperation.ADD, idToString[tokens[start + i]]];
		}

		if (__DEV__ && debug) {
			console.log('_createAdditions result:', res);
		}

		return res;
	}

	/**
	 * [TOOLBOX] Helper function to create an array of REMOVE operations.
	 *
	 * @param tokens - The token array to read from.
	 * @param start - The start index.
	 * @param end - The end index (exclusive).
	 * @param idToString - A map to convert token IDs back to strings.
	 * @param debug - A flag to enable verbose logging.
	 * @returns An array of REMOVE DiffResult tuples.
	 * @public
	 */
	public _createDeletions(
		tokens: Uint32Array,
		start: number,
		end: number,
		idToString: string[],
		debug?: boolean
	): DiffResult[] {
		if (__DEV__ && debug) {
			console.log('_createDeletions called:', {
				range: `${start}-${end}`,
				length: end - start,
				tokens: Array.from(tokens.slice(start, end)).map(t => idToString[t])
			});
		}

		const res = new Array<DiffResult>(end - start);
		for (let i = 0; i < res.length; i++) {
			res[i] = [DiffOperation.REMOVE, idToString[tokens[start + i]]];
		}

		if (__DEV__ && debug) {
			console.log('_createDeletions result:', res);
		}

		return res;
	}

	/**
	 * [TOOLBOX] Reconstructs the diff from the trace generated by `calculateDiff`.
	 *
	 * @param trace - The array of O(ND) trace buffers.
	 * @param oldTokens - The tokenized 'old' sequence.
	 * @param oldStart - The start index for diffing in oldTokens.
	 * @param oldEnd - The end index (exclusive) for diffing in oldTokens.
	 * @param newTokens - The tokenized 'new' sequence.
	 * @param newStart - The start index for diffing in newTokens.
	 * @param newEnd - The end index (exclusive) for diffing in newTokens.
	 * @param idToString - A map to convert token IDs back to strings.
	 * @returns An array of DiffResult tuples.
	 * @public
	 */
	public buildValues(
		trace: Int32Array[],
		oldTokens: Uint32Array, oldStart: number, oldEnd: number,
		newTokens: Uint32Array, newStart: number, newEnd: number,
		idToString: string[],
		debug?: boolean
	): DiffResult[] {
		if (__DEV__ && debug) {
			console.log('\n--- [buildValues START] ---');
		}
		let x = oldEnd - oldStart;
		let y = newEnd - newStart;
		const result: DiffResult[] = [];
		const offset = oldEnd - oldStart + newEnd - newStart;
		if (__DEV__ && debug) {
			console.log(`Initial position: x=${x}, y=${y}. Trace history length: ${trace.length}`);
		}
		for (let d = trace.length - 1; d >= 0; d--) {
			const v = trace[d];
			const k = x - y;
			const kOffset = k + offset;
			if (__DEV__ && debug) {
				console.log(`\n[d=${d}] Backtracking... Current position: (x=${x}, y=${y}), k=${k}`);
			}
			const prevK = (k === -d || (k !== d && v[kOffset - 1] < v[kOffset + 1]))
				? k + 1
				: k - 1;
			const prevKOffset = prevK + offset;
			const prevX = v[prevKOffset];
			const prevY = prevX - prevK;
			if (__DEV__ && debug) {
				console.log(`  Calculated previous k=${prevK}. Previous position from trace: (prev_x=${prevX}, prev_y=${prevY})`);
			}
			let snakeX = x;
			let snakeY = y;
			while (snakeX > prevX && snakeY > prevY) {
				const tokenValue = idToString[oldTokens[oldStart + snakeX - 1]];
				result.unshift([DiffOperation.EQUAL, tokenValue]);
				if (__DEV__ && debug) {
					console.log(`  SNAKE: Found EQUAL token "${tokenValue}" at (old:${snakeX - 1}, new:${snakeY - 1}). Prepending to result.`);
				}
				snakeX--;
				snakeY--;
			}
			if (x !== snakeX || y !== snakeY) {
				if (__DEV__ && debug) {
					if (__DEV__ && debug) {
						console.log(`  SNAKE END: Moved back from (x=${x}, y=${y}) to (x=${snakeX}, y=${snakeY})`);
					}
				}
			}

			if (d > 0) {
				if (prevX === snakeX) { // Down move, means addition
					const tokenValue = idToString[newTokens[newStart + snakeY - 1]];
					result.unshift([DiffOperation.ADD, tokenValue]);
					if (__DEV__ && debug) {
						console.log(`  OPERATION: ADD. Token: "${tokenValue}" from new[${newStart + snakeY - 1}]. Prepending to result.`);
					}
				} else { // Right move, means removal
					const tokenValue = idToString[oldTokens[oldStart + snakeX - 1]];
					result.unshift([DiffOperation.REMOVE, tokenValue]);
					if (__DEV__ && debug) {
						console.log(`  OPERATION: REMOVE. Token: "${tokenValue}" from old[${oldStart + snakeX - 1}]. Prepending to result.`);
					}
				}
			}

			x = prevX;
			y = prevY;

			if (x <= 0 && y <= 0) {
				if (__DEV__ && debug) {
					console.log(`[d=${d}] Reached origin (0,0). Backtracking complete.`);
				}
				break;
			}
		}
		if (__DEV__ && debug) {
			console.log('--- [buildValues END] ---\n');
		}
		return result;
	}

}