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

suite('MyersDiff Unit Tests (Exact Match)', () => {

    const runMyersTest = (title: string, oldTokens: string[], newTokens: string[], expected: DiffResult[]) => {
        test(title, () => {
            const myers = new MyersCoreDiff();
            const result = myers.diff(oldTokens, newTokens);
            assert.deepStrictEqual(result, expected);
        });
    };
    
    runMyersTest(
        'should handle simple addition',
        ['line 1', 'line 3'],
        ['line 1', 'line 2', 'line 3'],
        [
            [DiffOperation.EQUAL, 'line 1'],
            [DiffOperation.ADD, 'line 2'],
            [DiffOperation.EQUAL, 'line 3']
        ]
    );

    runMyersTest(
        'should handle simple deletion',
        ['line 1', 'line 2', 'line 3'],
        ['line 1', 'line 3'],
        [
            [DiffOperation.EQUAL, 'line 1'],
            [DiffOperation.REMOVE, 'line 2'],
            [DiffOperation.EQUAL, 'line 3']
        ]
    );

    runMyersTest(
        'should handle simple replacement',
        ['line 1', 'old', 'line 3'],
        ['line 1', 'new', 'line 3'],
        [
            [DiffOperation.EQUAL, 'line 1'],
            [DiffOperation.REMOVE, 'old'],
            [DiffOperation.ADD, 'new'],
            [DiffOperation.EQUAL, 'line 3']
        ]
    );

    runMyersTest(
        'should handle whitespace-only line replacement',
        ['line 1', '  ', 'line 3'],
        ['line 1', 'new line', 'line 3'],
        [
            [DiffOperation.EQUAL, 'line 1'],
            [DiffOperation.REMOVE, '  '],
            [DiffOperation.ADD, 'new line'],
            [DiffOperation.EQUAL, 'line 3']
        ]
    );

    runMyersTest(
        'should handle move (complex change)',
        ['a', 'b', 'c'],
        ['b', 'c', 'a'],
        [
            [DiffOperation.REMOVE, 'a'],
            [DiffOperation.EQUAL, 'b'],
            [DiffOperation.EQUAL, 'c'],
            [DiffOperation.ADD, 'a']
        ]
    );

    runMyersTest(
        'should handle multiple non-contiguous modifications',
        Array.from('alpha beta gamma delta'),
        Array.from('ALPHA beta GAMMA delta'),
        [
            [DiffOperation.REMOVE, 'a'],[DiffOperation.REMOVE, 'l'],[DiffOperation.REMOVE, 'p'],[DiffOperation.REMOVE, 'h'],[DiffOperation.REMOVE, 'a'],
            [DiffOperation.ADD, 'A'],[DiffOperation.ADD, 'L'],[DiffOperation.ADD, 'P'],[DiffOperation.ADD, 'H'],[DiffOperation.ADD, 'A'],
            [DiffOperation.EQUAL, ' '],[DiffOperation.EQUAL, 'b'],[DiffOperation.EQUAL, 'e'],[DiffOperation.EQUAL, 't'],[DiffOperation.EQUAL, 'a'],[DiffOperation.EQUAL, ' '],
            [DiffOperation.REMOVE, 'g'],[DiffOperation.REMOVE, 'a'],[DiffOperation.REMOVE, 'm'],[DiffOperation.REMOVE, 'm'],[DiffOperation.REMOVE, 'a'],
            [DiffOperation.ADD, 'G'],[DiffOperation.ADD, 'A'],[DiffOperation.ADD, 'M'],[DiffOperation.ADD, 'M'],[DiffOperation.ADD, 'A'],
            [DiffOperation.EQUAL, ' '],[DiffOperation.EQUAL, 'd'],[DiffOperation.EQUAL, 'e'],[DiffOperation.EQUAL, 'l'],[DiffOperation.EQUAL, 't'],[DiffOperation.EQUAL, 'a']
        ]
    );

    runMyersTest(
        'should handle changes involving only whitespace',
        Array.from('a b c'),
        Array.from('a\tb\tc'),
        [
            [DiffOperation.EQUAL, 'a'],
            [DiffOperation.REMOVE, ' '],
            [DiffOperation.ADD, '\t'],
            [DiffOperation.EQUAL, 'b'],
            [DiffOperation.REMOVE, ' '],
            [DiffOperation.ADD, '\t'],
            [DiffOperation.EQUAL, 'c']
        ]
    );
    
    runMyersTest(
        'should handle complete rewrite',
        Array.from('abcdefg'),
        Array.from('12345'),
        [
            [DiffOperation.REMOVE, 'a'], [DiffOperation.REMOVE, 'b'], [DiffOperation.REMOVE, 'c'], [DiffOperation.REMOVE, 'd'], [DiffOperation.REMOVE, 'e'], [DiffOperation.REMOVE, 'f'], [DiffOperation.REMOVE, 'g'],
            [DiffOperation.ADD, '1'], [DiffOperation.ADD, '2'], [DiffOperation.ADD, '3'], [DiffOperation.ADD, '4'], [DiffOperation.ADD, '5']
        ]
    );

    runMyersTest(
        'should handle deletion of all content',
        ['line 1', 'line 2'],
        [],
        [
            [DiffOperation.REMOVE, 'line 1'],
            [DiffOperation.REMOVE, 'line 2']
        ]
    );
    
    runMyersTest(
        'should handle creation from empty',
        [],
        ['line 1', 'line 2'],
        [
            [DiffOperation.ADD, 'line 1'],
            [DiffOperation.ADD, 'line 2']
        ]
    );
    
    runMyersTest(
        'should handle changes with unicode characters',
        Array.from('A line 😊.'),
        Array.from('A line 🚀.'),
        [
            [DiffOperation.EQUAL, 'A'], [DiffOperation.EQUAL, ' '], [DiffOperation.EQUAL, 'l'], [DiffOperation.EQUAL, 'i'], [DiffOperation.EQUAL, 'n'], [DiffOperation.EQUAL, 'e'], [DiffOperation.EQUAL, ' '],
            [DiffOperation.REMOVE, '😊'],
            [DiffOperation.ADD, '🚀'],
            [DiffOperation.EQUAL, '.']
        ]
    );

    runMyersTest(
        'should return no changes for identical inputs',
        ['a', 'b', 'c'],
        ['a', 'b', 'c'],
        [
            [DiffOperation.EQUAL, 'a'],
            [DiffOperation.EQUAL, 'b'],
            [DiffOperation.EQUAL, 'c']
        ]
    );

    runMyersTest(
        'should handle addition at the beginning',
        ['b', 'c'],
        ['a', 'b', 'c'],
        [
            [DiffOperation.ADD, 'a'],
            [DiffOperation.EQUAL, 'b'],
            [DiffOperation.EQUAL, 'c']
        ]
    );

    runMyersTest(
        'should handle deletion from the end',
        ['a', 'b', 'c'],
        ['a', 'b'],
        [
            [DiffOperation.EQUAL, 'a'],
            [DiffOperation.EQUAL, 'b'],
            [DiffOperation.REMOVE, 'c']
        ]
    );

    runMyersTest(
        'should handle changes in repeating patterns',
        Array.from('ababab'),
        Array.from('acacac'),
        [
            [DiffOperation.EQUAL, 'a'],
            [DiffOperation.REMOVE, 'b'],
            [DiffOperation.ADD, 'c'],
            [DiffOperation.EQUAL, 'a'],
            [DiffOperation.REMOVE, 'b'],
            [DiffOperation.ADD, 'c'],
            [DiffOperation.EQUAL, 'a'],
            [DiffOperation.REMOVE, 'b'],
            [DiffOperation.ADD, 'c'],
        ]
    );

    runMyersTest(
        'should correctly handle changes with common prefix/suffix (trimmer test)',
        ['same', 'same', 'old', 'end', 'end'],
        ['same', 'same', 'new', 'end', 'end'],
        [
            [DiffOperation.EQUAL, 'same'],
            [DiffOperation.EQUAL, 'same'],
            [DiffOperation.REMOVE, 'old'],
            [DiffOperation.ADD, 'new'],
            [DiffOperation.EQUAL, 'end'],
            [DiffOperation.EQUAL, 'end'],
        ]
    );

    runMyersTest(
        'should handle interleaved changes',
        ['a', 'b', 'c', 'd', 'e', 'f'],
        ['a', 'X', 'c', 'Y', 'e', 'Z'],
        [
            [DiffOperation.EQUAL, 'a'],
            [DiffOperation.REMOVE, 'b'],
            [DiffOperation.ADD, 'X'],
            [DiffOperation.EQUAL, 'c'],
            [DiffOperation.REMOVE, 'd'],
            [DiffOperation.ADD, 'Y'],
            [DiffOperation.EQUAL, 'e'],
            [DiffOperation.REMOVE, 'f'],
            [DiffOperation.ADD, 'Z'],
        ]
    );

    runMyersTest(
        'should handle large block deletion from the middle',
        ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        ['a', 'b', 'f', 'g'],
        [
            [DiffOperation.EQUAL, 'a'],
            [DiffOperation.EQUAL, 'b'],
            [DiffOperation.REMOVE, 'c'],
            [DiffOperation.REMOVE, 'd'],
            [DiffOperation.REMOVE, 'e'],
            [DiffOperation.EQUAL, 'f'],
            [DiffOperation.EQUAL, 'g'],
        ]
    );
});