/**
 * Neuralwatt quota API scraper.
 *
 * Fetches usage data from the Neuralwatt REST API using Bearer token
 * authentication. Returns structured quota data including credit balance,
 * energy usage (kWh), and subscription details.
 *
 * Rate limit: 1 request per second per customer.
 */
import type { NeuralwattUsageEntry } from './types';
/**
 * Fetch Neuralwatt quota data via the REST API.
 */
export declare function scrapeNeuralwattQuota(apiKey: string, signal?: AbortSignal): Promise<NeuralwattUsageEntry>;
