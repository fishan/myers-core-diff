// test/myers_core_direct.test.ts
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
    return (myers as any)._tokenize(oldTokens, newTokens, false);
};

const applyPatch = (oldTokens: string[], patch: DiffResult[]): string[] => {
    const result: string[] = [];
    let oldTokensIndex = 0;
    for (const [op, value] of patch) {
        if (op === DiffOperation.EQUAL || op === DiffOperation.REMOVE) {
            assert.strictEqual(oldTokens[oldTokensIndex], value, `Patch mismatch: expected REMOVE/EQUAL for '${oldTokens[oldTokensIndex]}', but got for '${value}'`);
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

    test('should find a snake in a large, complete replacement scenario', () => {
        const myers = new MyersCoreDiff();
        const oldContent = 'a'.repeat(400);
        const newContent = 'b'.repeat(450);
        const { hashedOld, hashedNew } = tokenize(oldContent, newContent);
        const findMiddleSnake = (myers as any)._findMiddleSnake;

        const snake = findMiddleSnake.call(myers, hashedOld, 0, hashedOld.length, hashedNew, 0, hashedNew.length, false);
        assert.ok(snake, 'Snake was not found in large replacement');
    });
});


// =============== TESTS FOR _guidedCalculateDiff ===============

suite('Direct Test: _guidedCalculateDiff', () => {
    const runGuidedTest = (title: string, oldStr: string, newStr: string) => {
        test(title, () => {
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
});


// =============== TESTS FOR calculateDiff (basic algorithm) ===============

suite('Direct Test: calculateDiff', () => {
    const runCalculateTest = (title: string, oldStr: string, newStr: string) => {
        test(title, () => {
            const myers = new MyersCoreDiff();
            const { hashedOld, hashedNew, idToString } = tokenize(oldStr, newStr);
            const calculateDiff = (myers as any).calculateDiff;

            const patch = calculateDiff.call(myers, hashedOld, 0, hashedOld.length, hashedNew, 0, hashedNew.length, idToString, false);
            const reconstructed = applyPatch(Array.from(oldStr), patch);

            assert.deepStrictEqual(reconstructed.join(''), newStr, "Reconstruction failed");
        });
    };

    runCalculateTest('should handle simple insertion', 'ac', 'abc');
    runCalculateTest('should handle simple deletion', 'abc', 'ac');
    runCalculateTest('should handle simple substitution', 'abc', 'axc');
    runCalculateTest('should handle empty old string', '', 'abc');
    runCalculateTest('should handle empty new string', 'abc', '');
    runCalculateTest('should handle identical strings', 'abc', 'abc');
    runCalculateTest('should handle reversed string', 'abc', 'cba');
});