// test/preserve_structure.test.ts
import { suite, test } from 'mocha';
import * as assert from 'assert';
import { MyersCoreDiff, DiffOperation, type DiffResult, type DiffOptions } from '../src/myers_core_diff.js';
import { registerPreserveStructureStrategy } from '../src/strategy_preserve.js';
registerPreserveStructureStrategy(MyersCoreDiff);

// =============== HELPER FUNCTIONS (from myers_core_direct.test.ts) ===============

// Simple applyPatch function for verification
const applyPatch = (oldTokens: string[], patch: DiffResult[]): string[] => {
    const result: string[] = [];
    let oldTokensIndex = 0;
    for (const [op, value] of patch) {
        if (op === DiffOperation.EQUAL || op === DiffOperation.REMOVE) {
            // Simple check that the removed/equal token matches
            if (oldTokensIndex >= oldTokens.length || oldTokens[oldTokensIndex] !== value) {
                throw new Error(`Patch application error: expected token '${oldTokens[oldTokensIndex]}' at index ${oldTokensIndex}, but patch op ${DiffOperation[op]} has value '${value}'`);
            }
            oldTokensIndex++;
        }
        if (op !== DiffOperation.REMOVE) {
            result.push(value);
        }
    }
    // Check that all tokens from oldTokens were "consumed" by the patch (if no additions at the end)
    // For stricter checking, you can add: assert.strictEqual(oldTokensIndex, oldTokens.length, "Patch did not consume all old tokens");
    return result;
};

// Helper for running preserveStructure tests
const runPreserveStructureTest = (
    title: string,
    oldStr: string,
    newStr: string,
    expectedPatch?: DiffResult[] // For unit tests
) => {
    test(title, () => {
        const myers = new MyersCoreDiff();
        const oldTokens = oldStr.split('\n'); // Use lines as tokens
        const newTokens = newStr.split('\n');
        const options: DiffOptions = { // Explicitly specify strategy
            diffStrategyName: 'preserveStructure',
            // Other options can be added here for specific tests if needed
            // anchorSearchMode: 'combo', // Use default value
        };

        const generatedPatch = myers.diff(oldTokens, newTokens, true, options);

        // --- Functional validation (mandatory) ---
        let reconstructedTokens: string[] = [];
        let applyError: Error | null = null;
        try {
            reconstructedTokens = applyPatch(oldTokens, generatedPatch);
        } catch (error) {
            applyError = error as Error;
        }

        // Output details on failure for easier debugging
        if (applyError || reconstructedTokens.join('\n') !== newStr) {
             console.error("\n--- TEST FAILED ---");
             console.error("Title:", title);
             console.error("Old String:\n", oldStr);
             console.error("New String (Expected):\n", newStr);
             console.error("Generated Patch:\n", generatedPatch);
             if (applyError) {
                 console.error("Apply Error:", applyError.message);
             } else {
                 console.error("Reconstructed String:\n", reconstructedTokens.join('\n'));
             }
             console.error("-------------------\n");
        }

        assert.strictEqual(applyError, null, "Patch application threw an error");
        assert.deepStrictEqual(reconstructedTokens.join('\n'), newStr, "Reconstruction failed");

        // --- Unit test (optional) ---
        if (expectedPatch) {
            assert.deepStrictEqual(generatedPatch, expectedPatch, "Generated patch structure mismatch");
        }
    });
};

// =============== FUNCTIONAL TESTS (Check result correctness) ===============

suite('MyersDiff Functional Tests (Patch Correctness) - Strategy: preserveStructure', () => {

    runPreserveStructureTest(
        'should handle simple addition',
        'line1\nline3',
        'line1\nline2\nline3'
    );

    runPreserveStructureTest(
        'should handle simple deletion',
        'line1\nline2\nline3',
        'line1\nline3'
    );

    runPreserveStructureTest(
        'should handle simple replacement',
        'line1\nold\nline3',
        'line1\nnew\nline3'
    );

    runPreserveStructureTest(
        'should handle whitespace-only line replacement',
        'line1\n \nline3', // Line with a space
        'line1\n\t\nline3' // Line with a tab
    );

    runPreserveStructureTest(
        'should handle move (complex change) - expecting correct reconstruction',
        'header\nblockA_line1\nblockA_line2\nmiddle\nblockB_line1\nblockB_line2\nfooter',
        'header\nblockB_line1\nblockB_line2\nmiddle\nblockA_line1\nblockA_line2\nfooter'
    );

    runPreserveStructureTest(
        'should handle multiple non-contiguous modifications',
        'line A\nline B\nline C\nline D\nline E',
        'line X\nline B\nline Y\nline D\nline Z'
    );

    // Key test for preserveStructure
    runPreserveStructureTest(
        'should handle changes involving only whitespace (indentation)',
        '{\n  "key": "value",\n  "array": [\n    1,\n    2\n  ]\n}',
        '{\n    "key": "value",\n    "array": [\n        1,\n        2\n    ]\n}'
    );

    runPreserveStructureTest(
        'should handle complete rewrite',
        'old line 1\nold line 2',
        'new line A\nnew line B\nnew line C'
    );

    runPreserveStructureTest(
        'should handle deletion of all content',
        'line1\nline2',
        ''
    );

    runPreserveStructureTest(
        'should handle creation from empty',
        '',
        'line1\nline2'
    );

    runPreserveStructureTest(
        'should handle changes with unicode characters',
        '你好世界\nline2',
        '你好，世界\nline2'
    );

    runPreserveStructureTest(
        'should return no changes for identical inputs',
        'line1\nline2',
        'line1\nline2'
    );

    // Test where preserveStructure may differ from commonSES (SES)
    runPreserveStructureTest(
        'should prioritize local change over larger replacement',
        'common header\n  line A\n  line B\n  line C\ncommon footer',
        'common header\n  line A\n  line B MODIFIED\n  line C\ncommon footer'
        // commonSES (without preservePositions) might replace all 3 lines A,B,C if it were "shorter"
        // preserveStructure should keep A and C as EQUAL
    );

    // Test for moved block (hybrid logic L1+L2 check)
    runPreserveStructureTest(
        'should handle a moved block of tokens (Block Move test case)',
        'section1\nline a\nline b\nline c\nsection2\nline d\nline e\nsection3',
        'section1\nline d\nline e\nsection2\nline a\nline b\nline c\nsection3'
    );

});


// =============== UNIT TESTS (Check exact patch structure) ===============

suite('MyersDiff Unit Tests (Exact Match) - Strategy: preserveStructure', () => {

    runPreserveStructureTest(
        'should handle simple addition (unit)',
        'line1\nline3',
        'line1\nline2\nline3',
        [
            [DiffOperation.EQUAL, 'line1'],
            [DiffOperation.ADD, 'line2'],
            [DiffOperation.EQUAL, 'line3']
        ]
    );

    runPreserveStructureTest(
        'should handle simple deletion (unit)',
        'line1\nline2\nline3',
        'line1\nline3',
        [
            [DiffOperation.EQUAL, 'line1'],
            [DiffOperation.REMOVE, 'line2'],
            [DiffOperation.EQUAL, 'line3']
        ]
    );

    runPreserveStructureTest(
        'should handle simple replacement (unit)',
        'line1\nold\nline3',
        'line1\nnew\nline3',
        [
            [DiffOperation.EQUAL, 'line1'],
            [DiffOperation.ADD, 'new'],
            [DiffOperation.REMOVE, 'old'],            
            [DiffOperation.EQUAL, 'line3']
        ]
    );

    // Unit test for indentation (approximate, exact result may depend on _guidedCalculateDiff)
    // Expect that lines are NOT removed/added entirely, but are EQUAL with internal edits (if testing char-diff)
    // Since we test line-diff, expect REMOVE+ADD only for changed lines.
    runPreserveStructureTest(
        'should handle indentation change (unit - expecting line replace)',
        'function() {\n  return 1;\n}',
        'function() {\n    return 1;\n}',
        [
            [DiffOperation.EQUAL, 'function() {'],
            [DiffOperation.ADD, '    return 1;'],
            [DiffOperation.REMOVE, '  return 1;'],            
            [DiffOperation.EQUAL, '}']
        ]
        // Note: if lines were longer and differed only in indentation,
        // preserveStructure might use char-diff via CdiffService.
        // Here we only test the line-level result from MyersCoreDiff.
    );

    // Unit test for structure preservation
    runPreserveStructureTest(
        'should prioritize local change over larger replacement (unit)',
        'common header\n  line A\n  line B\n  line C\ncommon footer',
        'common header\n  line A\n  line B MODIFIED\n  line C\ncommon footer',
        [
            [DiffOperation.EQUAL, 'common header'],
            [DiffOperation.EQUAL, '  line A'],
            [DiffOperation.ADD, '  line B MODIFIED'],
            [DiffOperation.REMOVE, '  line B'],            
            [DiffOperation.EQUAL, '  line C'],
            [DiffOperation.EQUAL, 'common footer']
        ]
    );

});
