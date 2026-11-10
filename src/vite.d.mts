import type { Plugin } from 'vite';
import type { ObfuscationOptions } from './core.mjs';

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

export interface AdversarialViteOptions extends Omit<ObfuscationOptions, 'sourceMap'> {
    include?: ChunkPattern | ChunkPattern[];
    exclude?: ChunkPattern | ChunkPattern[];
    chunkOptions?: (chunk: ObfuscationChunk) => false | ChunkObfuscationOptions | undefined;
    reportFile?: string | false;
}

export declare function aiAdversarialObfuscator(options?: AdversarialViteOptions): Plugin;
export default aiAdversarialObfuscator;
