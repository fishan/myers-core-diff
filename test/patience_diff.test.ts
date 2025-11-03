// test/patience_diff.test.ts
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

// Register both strategies
registerPatienceDiffStrategy(MyersCoreDiff);
registerPreserveStructureStrategy(MyersCoreDiff); // <-- IMPORTANT: Patience now depends on Preserve

// =============== HELPER FUNCTIONS (Copied from preserve_structure.test.ts) ===============

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
    return result;
};

//  Helper function for running patienceDiff tests
const runPatienceDiffTest = (
    title: string,
    oldStr: string,
    newStr: string,
    expectedPatch?: DiffResult[] // For unit tests
) => {
    test(title, () => {
        const myers = new MyersCoreDiff();
        const oldTokens = oldStr.split('\n'); // Use lines as tokens
        const newTokens = newStr.split('\n');
        
        // Specify the 'patienceDiff' strategy
        const options: DiffOptions = { 
            diffStrategyName: 'patienceDiff',
        };

        // Set to `true` for detailed logging on failure
        const debug = false; 
        const generatedPatch = myers.diff(oldTokens, newTokens, debug, options);

        // --- Functional Validation (Mandatory) ---
        let reconstructedTokens: string[] = [];
        let applyError: Error | null = null;
        try {
            reconstructedTokens = applyPatch(oldTokens, generatedPatch);
        } catch (error) {
            applyError = error as Error;
        }

        // Output details on failure
        if (applyError || reconstructedTokens.join('\n') !== newStr) {
             console.error("\n--- TEST FAILED ---");
             console.error("Title:", title);
             console.error("Old String:\n", oldStr);
             console.error("New String (Expected):\n", newStr);
             console.error("Generated Patch (Patience):\n", generatedPatch);
             if (applyError) {
                 console.error("Apply Error:", applyError.message);
             } else {
                 console.error("Reconstructed String:\n", reconstructedTokens.join('\n'));
             }
             console.error("-------------------\n");
        }

        assert.strictEqual(applyError, null, "Patch application threw an error");
        assert.deepStrictEqual(reconstructedTokens.join('\n'), newStr, "Reconstruction failed");

        // --- Unit Test (Optional) ---
        if (expectedPatch) {
            assert.deepStrictEqual(generatedPatch, expectedPatch, "Generated patch structure mismatch");
        }
    });
};

// =============== FUNCTIONAL TESTS (Check result correctness) ===============

suite('MyersDiff Functional Tests (Patch Correctness) - Strategy: patienceDiff', () => {

    // These tests are identical to preserve_structure, as they
    // simply verify the correctness of the reconstruction.
    
    runPatienceDiffTest(
        'should handle simple addition',
        'line1\nline3',
        'line1\nline2\nline3'
    );

    runPatienceDiffTest(
        'should handle simple deletion',
        'line1\nline2\nline3',
        'line1\nline3'
    );

    runPatienceDiffTest(
        'should handle simple replacement',
        'line1\nold\nline3',
        'line1\nnew\nline3'
    );

    // Key test for patience
    runPatienceDiffTest(
        'should handle move (complex change) - expecting correct reconstruction',
        'header\nblockA_line1\nblockA_line2\nmiddle\nblockB_line1\nblockB_line2\nfooter',
        'header\nblockB_line1\nblockB_line2\nmiddle\nblockA_line1\nblockA_line2\nfooter'
    );

    // Another key test
    runPatienceDiffTest(
        'should handle a moved block of tokens (Block Move test case)',
        'section1\nline a\nline b\nline c\nsection2\nline d\nline e\nsection3',
        'section1\nline d\nline e\nsection2\nline a\nline b\nline c\nsection3'
    );

    runPatienceDiffTest(
        'should handle multiple non-contiguous modifications',
        'line A\nline B\nline C\nline D\nline E',
        'line X\nline B\nline Y\nline D\nline Z'
    );
    
    runPatienceDiffTest(
        'should handle changes involving only whitespace (indentation)',
        '{\n  "key": "value",\n  "array": [\n    1,\n    2\n  ]\n}',
        '{\n    "key": "value",\n    "array": [\n        1,\n        2\n    ]\n}'
    );

    runPatienceDiffTest(
        'should handle complete rewrite',
        'old line 1\nold line 2',
        'new line A\nnew line B\nnew line C'
    );

    runPatienceDiffTest(
        'should handle deletion of all content',
        'line1\nline2',
        ''
    );

    runPatienceDiffTest(
        'should handle creation from empty',
        '',
        'line1\nline2'
    );

    runPatienceDiffTest(
        'should handle identical inputs',
        'line1\nline2',
        'line1\nline2'
    );

});


// =============== UNIT TESTS (Check exact patch structure) ===============

suite('MyersDiff Unit Tests (Exact Match) - Strategy: patienceDiff', () => {

    // Simple cases will likely be identical to commonSES/preserveStructure,
    // as LIS-anchors will not be found, triggering the fallback.
    runPatienceDiffTest(
        'should handle simple addition (unit)',
        'line1\nline3',
        'line1\nline2\nline3',
        [
            [DiffOperation.EQUAL, 'line1'],
            [DiffOperation.ADD, 'line2'],
            [DiffOperation.EQUAL, 'line3']
        ]
    );

    runPatienceDiffTest(
        'should handle simple deletion (unit)',
        'line1\nline2\nline3',
        'line1\nline3',
        [
            [DiffOperation.EQUAL, 'line1'],
            [DiffOperation.REMOVE, 'line2'],
            [DiffOperation.EQUAL, 'line3']
        ]
    );

    // The fallback logic (L2/L3/L4) generates [ADD, REMOVE].
    // Both orders are functionally correct.
    runPatienceDiffTest(
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
    
    // This is a specific test for patienceDiff.
    // It verifies that `patience` correctly identifies
    // the move of block `B` after `C`.
    runPatienceDiffTest(
        'should handle a simple block move (unit)',
        'A\nB\nC\nD',
        'A\nC\nB\nD',
        [
            [DiffOperation.EQUAL, 'A'],
            // The gap (old='B\nC', new='C\nB') is processed:
            // LIS finds 'C' (or 'B') as an anchor.
            // If 'C' is the anchor:
            [DiffOperation.REMOVE, 'B'], // Gap before C
            [DiffOperation.EQUAL, 'C'],  // Anchor
            [DiffOperation.ADD, 'B'],    // Gap after C
            // End of gap
            [DiffOperation.EQUAL, 'D']
        ]
        // The expected patch proves that `patience` "understood"
        // the move of `B`, rather than just replacing B->C and C->B.
    );
    
    //  Verifies that "noise" lines do not prevent
    // `patience` from finding the LIS anchors `A` and `B`.
    runPatienceDiffTest(
        'should ignore surrounding noise and find LIS (unit)',
        'noise 1\nA\nnoise 2\nnoise 3\nB\nnoise 4',
        'noise 5\nA\nnoise 6\nB\nnoise 7',
        [
            [DiffOperation.ADD, 'noise 5'],
            [DiffOperation.REMOVE, 'noise 1'],
            [DiffOperation.EQUAL, 'A'],
            [DiffOperation.REMOVE, 'noise 2'],
            [DiffOperation.ADD, 'noise 6'],
            [DiffOperation.REMOVE, 'noise 3'],
            [DiffOperation.EQUAL, 'B'],
            [DiffOperation.ADD, 'noise 7'],
            [DiffOperation.REMOVE, 'noise 4']
        ]
    );

});