/**
 * Derive a set of active account names from the provider-keyed active map.
 *
 * The auth/switch system tracks one active name per provider in
 * `activeSubscriptionByProvider`, but the display layer should show a star
 * on every account whose name matches any active entry across providers.
 *
 * This helper bridges that gap: it collects all unique active names and
 * returns them as a Set for O(1) membership checks.
 */
export function deriveActiveNames(
  activeByProvider: Partial<Record<string, string>>,
): Set<string> {
  const names = new Set<string>();
  for (const name of Object.values(activeByProvider)) {
    if (name) names.add(name);
  }
  return names;
}
