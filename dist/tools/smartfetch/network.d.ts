import type { BinaryFetch, DecodedBody, FetchResult, FetchWithRedirectsResult, LlmsProbeResult } from './types';
export declare function normalizeUrl(input: string): {
    url: string;
    upgradedToHttps: boolean;
    fallbackUrl: string | undefined;
    originalUrl: string;
};
export declare function isDocsLikeUrl(url: URL): boolean;
export declare function buildPermissionPatterns(normalized: ReturnType<typeof normalizeUrl>, shouldProbeLlmsTxt: boolean): string[];
export declare function buildAllowedOrigins(patterns: string[]): Set<string>;
export declare function canUseCanonicalCacheAlias(baseUrl: string, aliasUrl: string): boolean;
export declare function isBinaryContentType(contentType: string): boolean;
export declare function getBinaryKind(contentType: string): BinaryFetch['binaryKind'];
export declare function looksLikeHtmlText(text: string): boolean;
export declare function runWithScopedTimeout<T>(parentSignal: AbortSignal, timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T>;
export declare function readBodyLimited(response: Response, maxBytes?: number): Promise<{
    data: Uint8Array<ArrayBuffer>;
    truncated: boolean;
}>;
export declare function fetchWithRedirects(url: string, _timeoutMs: number, format: 'text' | 'markdown' | 'html', signal: AbortSignal, extraHeaders?: Record<string, string>, method?: 'GET' | 'HEAD', allowedOrigins?: Set<string>): Promise<FetchWithRedirectsResult>;
export declare function fetchWithUpgradeFallback(normalized: ReturnType<typeof normalizeUrl>, timeoutMs: number, format: 'text' | 'markdown' | 'html', signal: AbortSignal, extraHeaders?: Record<string, string>, method?: 'GET' | 'HEAD', allowedOrigins?: Set<string>): Promise<{
    result: FetchWithRedirectsResult;
    upgradedToHttps: boolean;
}>;
export declare function isHtmlLikeContentType(contentType: string): boolean;
export declare function decodeBody(data: Uint8Array, charset: string | undefined, contentType?: string): DecodedBody;
export declare function looksLikeTextBody(data: Uint8Array): boolean;
export declare function isGenericBinaryMime(contentType: string): boolean;
export declare function extractHeaderMetadata(headers: Headers, finalUrl: string): {
    contentType: string | undefined;
    charset: string | undefined;
    etag: string | undefined;
    lastModified: string | undefined;
    contentLength: number | undefined;
    filename: string | undefined;
};
export declare function buildConditionalHeaders(cached: FetchResult | undefined): Record<string, string> | undefined;
export declare function probeLlmsText(url: URL, timeoutMs: number, signal: AbortSignal, fallbackOrigin?: string): Promise<LlmsProbeResult>;
