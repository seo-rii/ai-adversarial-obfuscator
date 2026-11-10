export type ObfuscationPreset = 'light' | 'balanced' | 'strong';
export type AdversarialMode = 'refusal' | 'topic';

export interface ObfuscationOptions {
    preset?: ObfuscationPreset;
    seed?: number;
    mode?: AdversarialMode;
    adversarial?: boolean;
    terms?: string[];
    target?: 'browser' | 'node';
    sourceMap?: boolean;
}

export interface ObfuscationSourceMap {
    version: 3;
    sources: string[];
    sourcesContent?: (string | null)[];
    names: string[];
    mappings: string;
    file?: string;
    sourceRoot?: string;
}

export interface ObfuscationReport {
    fileName: string;
    preset: ObfuscationPreset;
    seed: number;
    adversarial: boolean;
    mode: AdversarialMode | null;
    sourceSha256: string;
    outputSha256: string;
    beforeBytes: number;
    afterBytes: number;
    sizeRatio: number | null;
    evaluation: 'not-performed';
}

export interface ObfuscationContext {
    fileName?: string;
    /** Regular expression patterns for literals a bundler must replace later. */
    reservedStrings?: string[];
}

export declare const DEFAULT_TERMS: readonly string[];
export declare const PRESETS: readonly ObfuscationPreset[];
export declare function normalizeOptions(options?: ObfuscationOptions): Required<ObfuscationOptions>;
export declare function createAdversarialBlock(options?: ObfuscationOptions, context?: ObfuscationContext): string;
export declare function obfuscateWithReport(source: string, options?: ObfuscationOptions, context?: ObfuscationContext): {
    code: string;
    map: ObfuscationSourceMap | null;
    report: ObfuscationReport;
};
export declare function obfuscateSource(source: string, options?: ObfuscationOptions, context?: ObfuscationContext): string;
