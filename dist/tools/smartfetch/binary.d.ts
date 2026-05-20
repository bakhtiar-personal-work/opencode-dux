import type { BinaryFetch } from './types';
export declare function buildBinaryResultMessage(fetchResult: BinaryFetch, savedPath?: string): string;
export declare function saveBinary(binaryDir: string, data: Uint8Array, contentType: string, filename?: string): Promise<string>;
