import {
    obfuscateSource,
    obfuscateWithReport,
    normalizeOptions,
    type ObfuscationOptions,
    type ObfuscationSourceMap
} from 'ai-adversarial-obfuscator';
import { aiAdversarialObfuscator } from 'ai-adversarial-obfuscator/vite';

const options: ObfuscationOptions = {
    preset: 'strong',
    seed: 42,
    terms: ['SensitiveLabel']
};

const code: string = obfuscateSource('export const x = 1;', options);
const result = obfuscateWithReport(code, { preset: 'light', sourceMap: true });
const sourceMap: ObfuscationSourceMap | null = result.map;
const filename: string = result.report.fileName;
const actualSeed: number = normalizeOptions(options).seed;
const plugin = aiAdversarialObfuscator({
    ...options,
    exclude: [/vendor/, name => name.endsWith('.cjs')],
    chunkOptions: chunk => chunk.moduleIds.some(id => id.includes('/vendor/'))
        ? false : { preset: chunk.isEntry ? 'light' : 'strong' },
    budgets: { maxGzipBytes: 100_000, maxGrowthRatio: 20, onExceeded: 'error' },
    reportFile: false
});

void [filename, actualSeed, plugin, sourceMap];
