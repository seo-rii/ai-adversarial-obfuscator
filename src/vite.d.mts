import type { Plugin } from 'vite';
import type { ObfuscationOptions, ObfuscationReport } from './core.mjs';

type ChunkPattern = string | RegExp | ((name: string) => boolean);
export type ChunkObfuscationOptions = Omit<ObfuscationOptions, 'sourceMap'>;

export interface ObfuscationChunk {
    readonly name: string;
    /** Preliminary output name; it can contain bundler hash placeholders. */
    readonly fileName: string;
    readonly moduleIds: readonly string[];
    readonly isEntry: boolean;
    readonly isDynamicEntry: boolean;
    readonly facadeModuleId: string | null;
}

export interface OutputBudgets {
    /** Limits apply to the sum of all JavaScript chunks in one output. */
    maxBytes?: number;
    maxGzipBytes?: number;
    maxBrotliBytes?: number;
    /** Final JavaScript bytes divided by the input bytes after minification. */
    maxGrowthRatio?: number;
    onExceeded?: 'error' | 'warn';
}

export interface EmittedChunkMetrics {
    fileName: string;
    bytes: number;
    gzipBytes: number;
    brotliBytes: number;
    sha256: string;
    mapBytes: number;
}

export interface ViteObfuscationReport {
    schemaVersion: 2;
    plugin: 'ai-adversarial-obfuscator';
    note: string;
    chunks: (ObfuscationReport & { chunk: string; transformMs: number; emitted: EmittedChunkMetrics })[];
    files: (EmittedChunkMetrics & { obfuscated: boolean })[];
    totals: {
        bytes: number;
        gzipBytes: number;
        brotliBytes: number;
        mapBytes: number;
        beforeBytes: number;
        growthRatio: number | null;
        transformMs: number;
    };
    budgetViolations: { metric: 'bytes' | 'gzipBytes' | 'brotliBytes' | 'growthRatio'; actual: number; limit: number }[];
}

export interface AdversarialViteOptions extends Omit<ObfuscationOptions, 'sourceMap'> {
    include?: ChunkPattern | ChunkPattern[];
    exclude?: ChunkPattern | ChunkPattern[];
    chunkOptions?: (chunk: ObfuscationChunk) => false | ChunkObfuscationOptions | undefined;
    budgets?: OutputBudgets;
    reportFile?: string | false;
}

export declare function aiAdversarialObfuscator(options?: AdversarialViteOptions): Plugin;
export default aiAdversarialObfuscator;
