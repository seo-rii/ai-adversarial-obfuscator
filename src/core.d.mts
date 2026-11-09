export type ObfuscationPreset = 'light' | 'balanced' | 'strong';
export type AdversarialMode = 'refusal' | 'topic';

export interface ObfuscationOptions {
    preset?: ObfuscationPreset;
    seed?: number;
    mode?: AdversarialMode;
    adversarial?: boolean;
    terms?: string[];
    target?: 'browser' | 'node';
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
}

export declare const DEFAULT_TERMS: readonly string[];
export declare const PRESETS: readonly ObfuscationPreset[];
export declare function normalizeOptions(options?: ObfuscationOptions): Required<ObfuscationOptions>;
export declare function createAdversarialBlock(options?: ObfuscationOptions, context?: ObfuscationContext): string;
export declare function obfuscateWithReport(source: string, options?: ObfuscationOptions, context?: ObfuscationContext): {
    code: string;
    report: ObfuscationReport;
};
export declare function obfuscateSource(source: string, options?: ObfuscationOptions, context?: ObfuscationContext): string;
