/**
 * OpenCode Go dashboard scraper.
 *
 * Fetches the OpenCode Go workspace dashboard page and parses SolidJS SSR
 * hydration output for known usage windows (rollingUsage, weeklyUsage,
 * monthlyUsage) containing usagePercent and resetInSec fields.
 */
import type { OpenCodeGoUsageEntry, UsageDetail } from './types';
interface ScrapedWindowUsage {
    usagePercent: number;
    resetInSec: number;
}
declare function parseWindowUsage(html: string, rePctFirst: RegExp, reResetFirst: RegExp): ScrapedWindowUsage | null;
/**
 * Fetch the OpenCode Go dashboard /go page and extract quota usage data.
 */
export declare function scrapeQuota(workspaceId: string, authCookie: string, signal?: AbortSignal): Promise<OpenCodeGoUsageEntry>;
/**
 * Scrape detailed usage data from the /usage page.
 * The page embeds individual usage records in SolidJS SSR hydration format
 * as $R[N]={id:"usg_...} records with model, inputTokens, outputTokens, cost fields.
 * No total or summary is present - we aggregate from individual records.
 */
export declare function scrapeUsagePage(workspaceId: string, authCookie: string, signal?: AbortSignal): Promise<UsageDetail | {
    error: string;
}>;
export { parseWindowUsage as _parseWindowUsage };
