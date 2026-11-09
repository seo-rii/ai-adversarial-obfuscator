import type { Plugin } from 'vite';
import type { ObfuscationOptions } from './core.mjs';

type ChunkPattern = string | RegExp | ((name: string) => boolean);

export interface AdversarialViteOptions extends ObfuscationOptions {
    include?: ChunkPattern | ChunkPattern[];
    exclude?: ChunkPattern | ChunkPattern[];
    reportFile?: string | false;
}

export declare function aiAdversarialObfuscator(options?: AdversarialViteOptions): Plugin;
export default aiAdversarialObfuscator;
