import type { PluginInput } from '@opencode-ai/plugin';
import type { CachedFetch, SecondaryModel } from './types';
type OpenCodeClient = PluginInput['client'];
export declare function readSecondaryModelFromConfig(directory: string): Promise<SecondaryModel[]>;
export declare function decideSecondaryModelUse(fetchResult: CachedFetch, prompt: string | undefined, secondaryModels: SecondaryModel[]): {
    use: boolean;
    reason: "no_prompt";
} | {
    use: boolean;
    reason: "no_secondary_model_configured";
} | {
    use: boolean;
    reason: "empty_content";
} | {
    use: boolean;
    reason: "content_too_short";
} | {
    use: boolean;
    reason: "prompt_present";
};
export declare function runSecondaryModelWithFallback(client: OpenCodeClient, directory: string, models: SecondaryModel[], prompt: string, content: string): Promise<{
    model: SecondaryModel;
    text: string;
    inputTruncated: boolean;
    inputChars: number;
    sourceChars: number;
}>;
export {};
