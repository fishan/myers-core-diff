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

const tokenize = (oldTokens: string[], newTokens: string[]) => {
    const tokenMap = new Map<string, number>();
    const idToString: string[] = [];
    let nextId = 0;

    const hash = (tokens: string[]): number[] => {
        return tokens.map(token => {
            let id = tokenMap.get(token);
            if (id === undefined) {
                id = nextId++;
                tokenMap.set(token, id);
                idToString.push(token);
            }
            return id;
        });
    };
    const hashedOld = hash(oldTokens);
    const hashedNew = hash(newTokens);
    return { hashedOld, hashedNew, idToString };
};

suite('MyersDiff: Direct _findMiddleSnake Invocation Tests', () => {

    test('should find a snake in the "Swapped Blocks" scenario that was failing', () => {
        const base = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
        const blockA = base.slice(200, 250);
        const blockB = base.slice(700, 750);
        
        const oldContent = [
            ...base.slice(0, 200),
            ...blockA,
            ...base.slice(250, 700),
            ...blockB,
            ...base.slice(750)
        ];
        
        const newContent = [
            ...base.slice(0, 200),
            ...blockB, // Swapped
            ...base.slice(250, 700),
            ...blockA, // Swapped
            ...base.slice(750)
        ];

        const { hashedOld, hashedNew } = tokenize(oldContent, newContent);
        const myers = new MyersCoreDiff();
        const findMiddleSnake = (myers as any)._findMiddleSnake;

        // console.log('--- Invoking _findMiddleSnake for "Swapped Blocks" ---');
        const snake = findMiddleSnake.call(myers,
            hashedOld, 0, hashedOld.length,
            hashedNew, 0, hashedNew.length,
            true // Enable debug logs
        );

        assert.ok(snake, 'The _findMiddleSnake method did not return a snake for the swapped blocks scenario.');
        // console.log('--- "Swapped Blocks" test PASSED ---');
    });

    test('should find a snake in the "Complete Replacement" scenario that was failing', () => {
        const oldContent = Array.from({ length: 400 }, (_, i) => `Original file content line ${i}`);
        const newContent = Array.from({ length: 450 }, (_, i) => `Completely new file content line ${i}`);

        const { hashedOld, hashedNew } = tokenize(oldContent, newContent);
        const myers = new MyersCoreDiff();
        const findMiddleSnake = (myers as any)._findMiddleSnake;
        
        // console.log('\n--- Invoking _findMiddleSnake for "Complete Replacement" ---');
        const snake = findMiddleSnake.call(myers,
            hashedOld, 0, hashedOld.length,
            hashedNew, 0, hashedNew.length,
            true // Enable debug logs
        );

        assert.ok(snake, 'The _findMiddleSnake method did not return a snake for the complete replacement scenario.');
        //  console.log('--- "Complete Replacement" test PASSED ---');
    });
});


suite('MyersDiff: Direct _findMiddleSnake Invocation Tests', () => {

    test('should find the middle snake in a complex replacement scenario', () => {
        const oldContent = Array.from({ length: 400 }, (_, i) => `Original file content line ${i}`);
        const newContent = Array.from({ length: 450 }, (_, i) => `Completely new file content line ${i}`);

        const { hashedOld, hashedNew } = tokenize(oldContent, newContent);

        const myers = new MyersCoreDiff();

        const findMiddleSnake = (myers as any)._findMiddleSnake;
        assert.strictEqual(typeof findMiddleSnake, 'function', 'Could not access the private method _findMiddleSnake');

        const snake = findMiddleSnake.call(myers,
            hashedOld, 0, hashedOld.length,
            hashedNew, 0, hashedNew.length,
            true // debug logs
        );

        // Check that the "snake" was found at all.
        // In an incorrect implementation, this would be undefined or an error.
        assert.ok(snake, 'The _findMiddleSnake method did not return a snake.');

        // We check the basic adequacy of the "snake" coordinates
        assert.ok(snake.x <= snake.u, `Snake's x coordinate (${snake.x}) cannot be greater than u (${snake.u})`);
        assert.ok(snake.y <= snake.v, `Snake's y coordinate (${snake.y}) cannot be greater than v (${snake.v})`);
        assert.ok(snake.u - snake.x === snake.v - snake.y, 'The length of the snake in old and new sequences must be equal');
    });

});