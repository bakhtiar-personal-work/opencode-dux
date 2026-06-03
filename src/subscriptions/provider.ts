/**
 * Provider definitions and display name mapping for subscription tracking.
 */

import type { SubscriptionProvider } from './types';

/** Mapping from full provider identifier to display label (capitalized). */
const PROVIDER_DISPLAY: Record<SubscriptionProvider, string> = {
  'opencode-go': 'Opencode-Go',
  codex: 'Codex',
  deepseek: 'DeepSeek',
  neuralwatt: 'Neuralwatt',
};

/** Ordered list of all supported providers. */
export const PROVIDERS: SubscriptionProvider[] = [
  'opencode-go',
  'neuralwatt',
  'deepseek',
  'codex',
];

/**
 * Resolve a raw string to a SubscriptionProvider.
 * Accepts full names (`opencode-go`) or display labels (`Opencode-Go`, `Codex`, `DeepSeek`, `Neuralwatt`).
 * Returns `undefined` if no match.
 */
export function resolveProvider(
  raw: string | undefined,
): SubscriptionProvider | undefined {
  if (!raw) return undefined;

  // Check display label (case-sensitive match)
  const displayMatch = Object.entries(PROVIDER_DISPLAY).find(
    ([, display]) => display.toLowerCase() === raw.toLowerCase(),
  );
  if (displayMatch) return displayMatch[0] as SubscriptionProvider;

  // Check full provider name (case-insensitive)
  const normalized = raw.toLowerCase();
  return PROVIDERS.find((p) => p.toLowerCase() === normalized);
}

/**
 * Return the display label for a provider (without brackets).
 * Example: `formatProviderLabel('opencode-go')` → `'Opencode-Go'`.
 */
export function formatProviderLabel(provider: SubscriptionProvider): string {
  return PROVIDER_DISPLAY[provider] ?? provider;
}

/**
 * Return the TUI display label with brackets.
 * Example: `tuiProviderLabel('opencode-go')` → `' [Opencode-Go]'`.
 */
export function tuiProviderLabel(provider: SubscriptionProvider): string {
  return ` [${formatProviderLabel(provider)}]`;
}
