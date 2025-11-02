// .mocharc.cjs
// version: 1.0.0
'use strict';

/**
 * @license
 * Copyright (c) 2025, Aleks Fishan
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// This config tells Mocha how to run TypeScript tests in an ES Module environment.
module.exports = {
	// Use the ts-node ESM loader. This is critical for "type": "module" in package.json
	loader: 'ts-node/esm',

	// Show full stack traces
	'full-trace': true,

	// Stop on first error
	bail: true,

	// Define the test file pattern
	// This specifically looks for files ending in .test.ts
	spec: ['test/**/*.test.ts'],

	// Search recursively
	recursive: true,
};