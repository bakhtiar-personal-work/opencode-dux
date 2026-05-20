import type { WebsearchConfig } from '../config';
import type { RemoteMcpConfig } from './types';
/**
 * Creates a websearch MCP config based on the provided configuration.
 * Supports Exa (default) and Tavily providers.
 * @see https://exa.ai  @see https://tavily.com
 */
export declare function createWebsearchConfig(config?: WebsearchConfig): RemoteMcpConfig;
export declare const websearch: RemoteMcpConfig;
