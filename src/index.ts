// src/index.ts
// version: 1.0.0

/**
 * @license
 * Copyright (c) 2025, Aleks Fishan
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Core Engine and Types
export {
	DiffOperation,
	MyersCoreDiff,
	type DiffResult,
	type DiffOptions,
	type DiffStrategyPlugin,
	type Anchor
} from './myers_core_diff.js';

// Built-in Strategy Plugins
export { registerPatienceDiffStrategy } from './strategy_patience.js';
export { registerPreserveStructureStrategy } from './strategy_preserve.js';