import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { 
    MyersCoreDiff, 
    DiffOperation, 
    type DiffResult, 
    type DiffOptions,
    registerPatienceDiffStrategy,
    registerPreserveStructureStrategy
} from '@fishan/myers-core-diff';

// --- Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface BenchmarkResult {
    name: string;
    time: number;
    memory: number;
    diffSizeOps: number;
    finalPatchBytes: number;
    correctness: '✅ OK' | '❌ FAILED';
}

interface Subject {
    name: string;
    diff: (oldTokens: string[], newTokens: string[]) => [number, string][];
}

// --- Verification Logic ---
function applyPatch(oldTokens: string[], patch: [number, string][]): string[] {
    const result: string[] = [];
    let oldIdx = 0;
    for (const [op, val] of patch) {
        if (op === 0) { // EQUAL
            if (oldIdx >= oldTokens.length || oldTokens[oldIdx] !== val) {
                throw new Error(`Verification failed: EQUAL mismatch at index ${oldIdx}. Expected '${oldTokens[oldIdx]}', got '${val}'`);
            }
            result.push(val);
            oldIdx++;
        } else if (op === 1) { // ADD
            result.push(val);
        } else if (op === 2) { // REMOVE
            if (oldIdx >= oldTokens.length || oldTokens[oldIdx] !== val) {
                 throw new Error(`Verification failed: REMOVE mismatch at index ${oldIdx}. Expected '${oldTokens[oldIdx]}', got '${val}'`);
            }
            oldIdx++;
        }
    }
    return result;
}

// --- 🎯 ИСПРАВЛЕННАЯ ФУНКЦИЯ ДЛЯ ПОДСЧЕТА РАЗМЕРА ФИНАЛЬНОГО ПАТЧА (ДЛЯ СИМВОЛОВ) ---
/**
 * Для символьного диффа, "финальный патч" - это, по сути, сами команды
 * на добавление/удаление символов. Эта функция подсчитывает их общий размер.
 */
function calculateFinalPatchSize(myersResult: [number, string][]): number {
    let size = 0;
    for (const [op, text] of myersResult) {
        if (op !== 0) { // Учитываем только ADD и REMOVE
            // Имитируем структуру команды: "1 a 5 <текст>"
            size += `1 a ${text.length} ${text}`.length;
        }
    }
    return size;
}


// --- Блок автоматической генерации конфигураций для тюнинга ---
const configurations: { name: string, options: DiffOptions }[] = [];
const minMatchLengths = [10, 15, 20, 25, 30];
const jumpSteps = [10, 15, 20, 25, 30];
const huntChunkSizes = [5, 10];

for (const minMatchLength of minMatchLengths){
    for (const jumpStep of jumpSteps) {
        if (jumpStep > minMatchLength) continue;
        for (const huntChunkSize of huntChunkSizes) {
            if (huntChunkSize > minMatchLength / 2) continue;
            
            configurations.push({
                name: `huntChunkSize=${huntChunkSize}, minMatchLength=${minMatchLength}, jumpStep=${jumpStep}`,
                options: {
                    jumpStep: jumpStep,
                    minMatchLength: minMatchLength,
                    huntChunkSize: huntChunkSize,
                }
            });
        }
    }
}

// --- Адаптированный генератор "испытуемых" ---
const subjects: Subject[] = configurations.map(config => {
    return {
        name: `Core (${config.name})`,
        diff: (oldTokens: string[], newTokens: string[]) => {
            const myers = new MyersCoreDiff();
            return myers.diff(oldTokens, newTokens, false, config.options);
        }
    };
});


// --- Test Scenarios ---
function loadFile(filename: string): string {
  return fs.readFileSync(path.join(__dirname, 'data', filename), 'utf8');
}

type ScenarioGenerator = () => { oldStr: string; newStr: string; };

const scenarios: { [key: string]: ScenarioGenerator } = {
  "Multiple Small Changes (large file)": () => {
      const original = loadFile('large.js');
      const modified = original
        .replace(/jQuery.fn.init/g, 'jQuery.fn.initialize')
        .replace(/isFunction/g, 'isFunc')
        .replace(/slice.call/g, 'arraySlice.call');
      return { oldStr: original, newStr: modified };
  }
};

// --- Runner ---
function runBenchmark(subject: Subject, oldContent: string, newContent: string): BenchmarkResult {
  // --- 🎯 ИСПРАВЛЕНИЕ: ВОЗВРАЩАЕМСЯ К СРАВНЕНИЮ СИМВОЛОВ ---
  const oldTokens = Array.from(oldContent);
  const newTokens = Array.from(newContent);
  
  // Warm-up run
  subject.diff(oldTokens, newTokens);

  if (global.gc) {
      global.gc();
  }

  const startHeap = process.memoryUsage().heapUsed;
  
  const startTime = performance.now();
  const diffResult = subject.diff(oldTokens, newTokens);
  const endTime = performance.now();

  const endHeap = process.memoryUsage().heapUsed;
  
  // --- ОБНОВЛЕННЫЕ ИЗМЕРЕНИЯ ---
  const diffSizeOps = diffResult.filter(op => op[0] !== 0).length;
  const finalPatchBytes = calculateFinalPatchSize(diffResult);

  let correctness: '✅ OK' | '❌ FAILED' = '❌ FAILED';
  try {
      const patchedTokens = applyPatch(oldTokens, diffResult);
      // --- 🎯 ИСПРАВЛЕНИЕ: ПРОВЕРКА КОРРЕКТНОСТИ ДЛЯ СИМВОЛОВ ---
      if (patchedTokens.join('') === newContent) {
          correctness = '✅ OK';
      } else {
          console.error(`Verification FAILED for ${subject.name}: Patched content does not match new content.`);
      }
  } catch (e) {
      console.error(`Verification ERROR for ${subject.name}:`, (e as Error).message);
  }

  return {
    name: subject.name,
    time: endTime - startTime,
    memory: (endHeap - startHeap) / 1024,
    diffSizeOps: diffSizeOps,
    finalPatchBytes: finalPatchBytes,
    correctness: correctness
  };
}



// --- Main Execution ---
async function main() {
    console.log('Starting MyersDiff Tuning Benchmark...\n');

    for (const scenarioName in scenarios) {
        console.log(`=== Scenario: ${scenarioName} ===`);
        const { oldStr, newStr } = scenarios[scenarioName]();

        const allResults: any[] = [];
        for (const subject of subjects) {
            try {
                const result = runBenchmark(subject, oldStr, newStr);
                allResults.push({
                    'Configuration': result.name,
                    'Time (ms)': result.time.toFixed(2),
                    'Heap Used (KB)': result.memory.toFixed(2),
                    'Diff Size (ops)': result.diffSizeOps,
                    'Final Patch (B)': result.finalPatchBytes,
                    'Correctness': result.correctness,
                });
            } catch (e) {
                 allResults.push({
                    'Configuration': subject.name,
                    'Time (ms)': 'CRASHED',
                    'Heap Used (KB)': 'N/A',
                    'Diff Size (ops)': 'N/A',
                    'Final Patch (B)': 'N/A',
                    'Correctness': '❌ FAILED',
                });
            }
        }
        allResults.sort((a, b) => {
            if (a['Time (ms)'] === 'CRASHED') return 1;
            if (b['Time (ms)'] === 'CRASHED') return -1;
            return parseFloat(a['Time (ms)']) - parseFloat(b['Time (ms)']);
        });
        console.table(allResults);
        console.log('\n');
    }
}

main().catch(console.error);