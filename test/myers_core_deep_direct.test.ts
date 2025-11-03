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

// =============== HELPER FUNCTIONS ===============

const tokenize = (oldStr: string, newStr: string) => {
    const oldTokens = Array.from(oldStr);
    const newTokens = Array.from(newStr);
    const myers = new MyersCoreDiff();
    // Accessing the private tokenizer for consistency
    return (myers as any)._tokenize(oldTokens, newTokens, false);
};

const applyPatch = (oldTokens: string[], patch: DiffResult[]): string[] => {
    const result: string[] = [];
    let oldTokensIndex = 0;
    for (const [op, value] of patch) {
        if (op === DiffOperation.EQUAL || op === DiffOperation.REMOVE) {
            // Strict check to ensure removed/equal token matches the original
            if (oldTokens[oldTokensIndex] !== value) {
                throw new Error(`Patch consistency error: expected token '${oldTokens[oldTokensIndex]}' at index ${oldTokensIndex}, but patch has operation for '${value}'`);
            }
            oldTokensIndex++;
        }
        if (op !== DiffOperation.REMOVE) {
            result.push(value);
        }
    }
    return result;
};


// =============== TESTS FOR _findMiddleSnake ===============

suite('Direct Test: _findMiddleSnake', () => {
    const runSnakeTest = (title: string, oldStr: string, newStr: string, expectedSnake?: { x: number, y: number, u: number, v: number }) => {
        test(title, function() {
            this.timeout(0);
            const myers = new MyersCoreDiff();
            const { hashedOld, hashedNew } = tokenize(oldStr, newStr);
            const findMiddleSnake = (myers as any)._findMiddleSnake;

            const snake = findMiddleSnake.call(myers, hashedOld, 0, hashedOld.length, hashedNew, 0, hashedNew.length, true);

            assert.ok(snake, 'Snake was not found');
            if (expectedSnake) {
                assert.deepStrictEqual({ x: snake.x, y: snake.y, u: snake.u, v: snake.v }, expectedSnake, "Snake coordinates mismatch");
            }
        });
    };

    runSnakeTest(
        'should find a snake with odd delta (N > M)',
        "abcdefgh", // N=8
        "abxyfgh"   // M=7, delta=1
    );

    runSnakeTest(
        'should find a snake with even delta (N > M)',
        "abcdefgh", // N=8
        "abxygh"    // M=6, delta=2
    );

    runSnakeTest(
        'should find a snake when change is at the beginning',
        "abcdef",
        "xyzabcdef"
    );

    runSnakeTest(
        'should find a snake when change is at the end',
        "abcdef",
        "abcdexyz"
    );

    runSnakeTest(
        'should find a snake in a large, complete replacement scenario',
        'a'.repeat(400),
        'b'.repeat(450)
    );
});


// =============== TESTS FOR _guidedCalculateDiff ===============

suite('Direct Test: _guidedCalculateDiff', () => {
    const runGuidedTest = (title: string, oldStr: string, newStr: string) => {
        test(title, function() {
            this.timeout(5000); // Increase timeout
            const myers = new MyersCoreDiff();
            const { hashedOld, hashedNew, idToString } = tokenize(oldStr, newStr);
            const guidedDiff = (myers as any)._guidedCalculateDiff;
            const config = MyersCoreDiff.defaultOptions;

            const patch = guidedDiff.call(myers, hashedOld, 0, hashedOld.length, hashedNew, 0, hashedNew.length, idToString, config, false);
            const reconstructed = applyPatch(Array.from(oldStr), patch);

            assert.deepStrictEqual(reconstructed.join(''), newStr, "Reconstruction failed");
        });
    };

    runGuidedTest('should handle huge additions', 'abc', 'x'.repeat(500) + 'abc' + 'y'.repeat(500));
    runGuidedTest('should handle huge deletions', 'x'.repeat(500) + 'abc' + 'y'.repeat(500), 'abc');
    runGuidedTest('should handle a chaotic mix of small changes in a large string',
        'a'.repeat(200) + 'b'.repeat(200) + 'c'.repeat(200),
        'a'.repeat(200) + 'X'.repeat(10) + 'b'.repeat(200) + 'Y'.repeat(10) + 'c'.repeat(200)
    );
    runGuidedTest('should handle low-similarity content', 'a'.repeat(1000), 'b'.repeat(1000));
    runGuidedTest('should handle repetitive patterns', 'abc'.repeat(300), 'axc'.repeat(300));

    // =============== NEW STRESS TESTS ===============

    // This test directly reproduces the "Swapped Blocks" scenario that fails in benchmarks.
    // The heuristic cannot handle non-linear changes where a block from the end moves to the start.
    runGuidedTest('should fail on swapped blocks',
        'A'.repeat(100) + 'M'.repeat(200) + 'B'.repeat(100),
        'B'.repeat(100) + 'M'.repeat(200) + 'A'.repeat(100)
    );

    // This test "shuffles" the sequence. The local heuristic "sees" only nearby characters
    // and will generate many unnecessary deletions and insertions
    // instead of recognizing the overall structure, leading to an incorrect patch.
    runGuidedTest('should fail on an interleaved sequence',
        'A1B2C3D4E5F6G7H8',
        'ACEGBDFH12345678'
    );

    // Simpler rearrangement case: one block is just moved to another position.
    // This also breaks the linear algorithm logic.
    runGuidedTest('should fail when a block is moved to the end',
        'BLOCK_A' + 'BLOCK_B' + 'BLOCK_C',
        'BLOCK_A' + 'BLOCK_C' + 'BLOCK_B'
    );

    // Test with high entropy and no obvious repetitive patterns.
    // Unlike 'a'.repeat(1000), there’s no simple template.
    // The heuristic gets lost and produces an incorrect result.
    runGuidedTest('should fail with two completely different, complex strings',
        'The quick brown fox jumps over the lazy dog and feels victorious.',
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.'
    );
});


// =============== TESTS FOR calculateDiff (base algorithm) ===============

suite('Direct Test: calculateDiff', () => {
    const runCalculateTest = (title: string, oldStr: string, newStr: string) => {
        test(title, function() {
            this.timeout(10000);
            const myers = new MyersCoreDiff();
            const { hashedOld, hashedNew, idToString } = tokenize(oldStr, newStr);
            const calculateDiff = (myers as any).calculateDiff;

            const patch = calculateDiff.call(myers, hashedOld, 0, hashedOld.length, hashedNew, 0, hashedNew.length, idToString, false);
            const reconstructed = applyPatch(Array.from(oldStr), patch);

            assert.deepStrictEqual(reconstructed.join(''), newStr, "Reconstruction failed");
        });
    };

    // Basic cases
    runCalculateTest('should handle simple insertion', 'ac', 'abc');
    runCalculateTest('should handle simple deletion', 'abc', 'ac');
    runCalculateTest('should handle simple substitution', 'abc', 'axc');
    runCalculateTest('should handle empty old string', '', 'abc');
    runCalculateTest('should handle empty new string', 'abc', '');
    runCalculateTest('should handle identical strings', 'abc', 'abc');

    // More complex cases
    runCalculateTest('should handle reversed string', 'abc', 'cba');
    runCalculateTest('should handle overlapping changes', 'abcde', 'axcyf');
    runCalculateTest('should handle changes at the start and end', 'abcdefg', 'xbcdefy');
    runCalculateTest('should handle unicode characters', '😊😊😊', '😊🚀😊');
    runCalculateTest('should handle multiple edits', 'the quick brown fox', 'the fast brown cat');

    // Checks how the algorithm handles a long common part with small edge changes.
    runCalculateTest('should handle long common subsequence with small changes',
        'START_UNIQUE' + 'COMMON'.repeat(100) + 'END_UNIQUE',
        'START_NEW' + 'COMMON'.repeat(100) + 'END_NEW'
    );

    // Checks the case when one string is a substring of another.
    runCalculateTest('should handle one string being a substring of another',
        'This is the middle part',
        'This is the start, This is the middle part, and this is the end.'
    );

    // Checks handling of strings with high repetition,
    // which can be challenging for some diff implementations.
    runCalculateTest('should handle highly repetitive content',
        'abababababababababab',
        'babababababababababa'
    );

    // Checks correct handling of strings consisting only of whitespace and newlines.
    runCalculateTest('should handle strings with only whitespace and newlines',
        '  \n \n  \n',
        ' \n\n \n '
    );

    // Simulates a "move" operation. The algorithm should interpret it
    // as a deletion in one place and an addition in another.
    runCalculateTest('should handle a move-like operation',
        'BLOCK_A' + 'BLOCK_B' + 'BLOCK_C',
        'BLOCK_B' + 'BLOCK_A' + 'BLOCK_C'
    );
    
});

suite('Direct Test: MyersCoreDiff.diff on Complex Scenarios', () => {

    const runFullDiffTest = (title: string, oldContent: string[], newContent: string[]) => {
        test(title, function() {
            this.timeout(10000); // Increase timeout for complex cases

            const myers = new MyersCoreDiff();
            
            // IMPORTANT: Call diff with disabled anchors, as in failed benchmarks.
            // This is achieved by passing an empty anchor array in _processWithAnchors,
            // which is simulated by a standard call without anchors.
            const patch = myers.diff(oldContent, newContent, true); // Enable core debug logs

            // Apply the patch and verify that it reconstructs the content.
            // This is the most important check.
            const reconstructed = applyPatch(oldContent, patch);
            assert.deepStrictEqual(reconstructed, newContent, "The patch generated by MyersCoreDiff.diff failed to reconstruct the content.");
        });
    };

    // Test 1: Minimal version of "Swapped Blocks"
    runFullDiffTest(
        'should correctly handle a simple block swap',
        ['A', 'B', 'C'],
        ['C', 'B', 'A']
    );

    // Test 2: Minimal version of "Complete Replacement"
    runFullDiffTest(
        'should correctly handle a complete replacement',
        ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'],
        ['one', 'two', 'three']
    );

    // Test 3: More complex case with a moved block that previously failed tests
    runFullDiffTest(
        'should correctly handle a block move operation',
        ['A', 'B', 'C', 'D'],
        ['A', 'C', 'D', 'B'] // Block B moved to the end
    );
});
