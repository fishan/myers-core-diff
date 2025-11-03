// test/myers_middle_snake.test.ts
import { suite, test } from 'mocha';
import * as assert from 'assert';
import { 
    MyersCoreDiff, 
    DiffOperation, 
    type DiffResult, 
    type DiffOptions,
    registerPatienceDiffStrategy,
    registerPreserveStructureStrategy
} from '@fishan/myers-core-diff';

/**
 * Helper function for applying a patch.
 * Key for verifying the correctness of the diff algorithm.
 */
const applyPatch = (oldTokens: string[], patch: DiffResult[]): string[] => {
    const result: string[] = [];
    let oldTokensIndex = 0;

    for (const [op, value] of patch) {
        switch (op) {
            case DiffOperation.EQUAL:
                if (oldTokens[oldTokensIndex] !== value) {
                    throw new Error(`Patch consistency error: expected token '${oldTokens[oldTokensIndex]}' at position ${oldTokensIndex}, but found EQUAL with '${value}' in the patch`);
                }
                result.push(value);
                oldTokensIndex++;
                break;
            case DiffOperation.ADD:
                result.push(value);
                break;
            case DiffOperation.REMOVE:
                if (oldTokens[oldTokensIndex] !== value) {
                    throw new Error(`Patch consistency error: expected token '${oldTokens[oldTokensIndex]}' at position ${oldTokensIndex}, but found REMOVE with '${value}' in the patch`);
                }
                oldTokensIndex++;
                break;
        }
    }
    return result;
};

suite('MyersDiff: Middle Snake Stress Tests', () => {

    const runStressTest = (title: string, oldGenerator: () => string[], newGenerator: () => string[]) => {
        test(title, function() {
            // Increase timeout for potentially long tests
            this.timeout(5000);

            const oldTokens = oldGenerator();
            const newTokens = newGenerator();

            // Ensure the total length is large enough to trigger the 'middle snake'
            // Threshold value in the reference implementation: RECURSION_QUICK_DIFF_THRESHOLD = 256
            assert.ok(oldTokens.length + newTokens.length > 256, 'Test is not long enough to trigger middle snake');

            const myers = new MyersCoreDiff();
            const patch = myers.diff(oldTokens, newTokens);
            const reconstructedNew = applyPatch(oldTokens, patch);

            assert.deepStrictEqual(reconstructedNew, newTokens, "Reconstructed content does not match the new version");
        });
    };

    // Test 1: Replacement of a large block in the middle
    runStressTest(
        'should correctly handle a large block replacement in the middle',
        () => {
            const prefix = Array.from({ length: 200 }, (_, i) => `line_prefix_${i}`);
            const middle = Array.from({ length: 100 }, (_, i) => `line_old_middle_${i}`);
            const suffix = Array.from({ length: 200 }, (_, i) => `line_suffix_${i}`);
            return [...prefix, ...middle, ...suffix];
        },
        () => {
            const prefix = Array.from({ length: 200 }, (_, i) => `line_prefix_${i}`);
            const middle = Array.from({ length: 120 }, (_, i) => `line_NEW_middle_${i}`); // New block with different size
            const suffix = Array.from({ length: 200 }, (_, i) => `line_suffix_${i}`);
            return [...prefix, ...middle, ...suffix];
        }
    );

    // Test 2: Moving a large code block
    runStressTest(
        'should correctly handle moving a large block of tokens',
        () => {
            const partA = Array.from({ length: 150 }, (_, i) => `Block A line ${i}`);
            const partB = Array.from({ length: 150 }, (_, i) => `Block B line ${i}`);
            const partC = Array.from({ length: 150 }, (_, i) => `Block C line ${i}`);
            return [...partA, ...partB, ...partC];
        },
        () => {
            const partA = Array.from({ length: 150 }, (_, i) => `Block A line ${i}`);
            const partB = Array.from({ length: 150 }, (_, i) => `Block B line ${i}`);
            const partC = Array.from({ length: 150 }, (_, i) => `Block C line ${i}`);
            // Move block B to the end
            return [...partA, ...partC, ...partB];
        }
    );

    // Test 3: Multiple small interleaved changes in a large file
    runStressTest(
        'should correctly handle multiple small interleaved changes in a large file',
        () => Array.from({ length: 500 }, (_, i) => `const value_${i} = ${i};`),
        () => Array.from({ length: 500 }, (_, i) => {
            if (i % 10 === 0) {
                return `// Changed line\nconst value_${i} = ${i * 100};`;
            }
            return `const value_${i} = ${i};`;
        })
    );
    
    // Test 4: Complete rewrite of one large file with another
    runStressTest(
        'should handle a complete rewrite of one large file to another',
        () => Array.from({ length: 400 }, (_, i) => `Original file content line ${i}`),
        () => Array.from({ length: 450 }, (_, i) => `Completely new file content line ${i}`)
    );

    // Test 5: Deleting large blocks from multiple locations
    runStressTest(
        'should handle deleting large blocks from multiple locations',
        () => {
            const partA = Array.from({ length: 100 }, (_, i) => `A_${i}`);
            const toDeleteB = Array.from({ length: 100 }, (_, i) => `DEL_B_${i}`);
            const partC = Array.from({ length: 100 }, (_, i) => `C_${i}`);
            const toDeleteD = Array.from({ length: 100 }, (_, i) => `DEL_D_${i}`);
            const partE = Array.from({ length: 100 }, (_, i) => `E_${i}`);
            return [...partA, ...toDeleteB, ...partC, ...toDeleteD, ...partE];
        },
        () => {
            const partA = Array.from({ length: 100 }, (_, i) => `A_${i}`);
            const partC = Array.from({ length: 100 }, (_, i) => `C_${i}`);
            const partE = Array.from({ length: 100 }, (_, i) => `E_${i}`);
            return [...partA, ...partC, ...partE];
        }
    );
});
