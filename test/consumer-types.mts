import {
    obfuscateSource,
    obfuscateWithReport,
    normalizeOptions,
    type ObfuscationOptions
} from 'ai-adversarial-obfuscator';
import { aiAdversarialObfuscator } from 'ai-adversarial-obfuscator/vite';

const options: ObfuscationOptions = {
    preset: 'strong',
    seed: 42,
    terms: ['SensitiveLabel']
};

const code: string = obfuscateSource('export const x = 1;', options);
const result = obfuscateWithReport(code, { preset: 'light' });
const filename: string = result.report.fileName;
const actualSeed: number = normalizeOptions(options).seed;
const plugin = aiAdversarialObfuscator({
    ...options,
    exclude: [/vendor/, name => name.endsWith('.cjs')],
    reportFile: false
});

void [filename, actualSeed, plugin];
