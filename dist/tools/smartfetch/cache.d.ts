import { LRUCache } from 'lru-cache';
import type { FetchResult } from './types';
export declare const CACHE: LRUCache<string, FetchResult, unknown>;
export declare function buildCacheKey(url: string, extractMain: boolean, preferLlmsTxt: 'auto' | 'always' | 'never', saveBinary: boolean): string;
export declare function cacheFetchResult(fetchResult: FetchResult, extractMain: boolean, preferLlmsTxt: 'auto' | 'always' | 'never', saveBinary: boolean): void;
export declare function isInvalidLlmsResult(fetchResult: FetchResult | undefined): boolean;
